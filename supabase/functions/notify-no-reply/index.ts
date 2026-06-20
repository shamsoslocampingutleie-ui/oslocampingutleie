// Cron job: send 12-hour follow-up reminders to hosts and renters.
//
// Set up via Supabase Dashboard → Database → Extensions → pg_cron, then run:
//   select cron.schedule('no-reply-check', '0 * * * *',
//     $$select net.http_post(
//       url:='https://cglxodxiqpzrgwrfaqbr.supabase.co/functions/v1/notify-no-reply',
//       headers:='{"Authorization":"Bearer <service_role_key>","Content-Type":"application/json"}'::jsonb,
//       body:='{}'::jsonb) as request_id$$);
//
// What it checks every hour:
//   1. Pending booking requests where host has not responded in 12h → remind host
//   2. Active bookings where the last chat message is 12h old and the other party hasn't replied → remind them
//   3. Reminders are only sent ONCE per event (uses a `reminded_at` flag or checks messages table)

import { createClient } from "npm:@supabase/supabase-js@2";
import { sendEmail, emailLayout } from "../_shared/email.ts";
import { corsHeaders } from "../_shared/cors.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const APP_URL = "https://leieplattform.no";

function fmt(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("nb-NO", {
    day: "numeric",
    month: "long",
  });
}

async function getUserEmail(userId: string): Promise<string | null> {
  if (!userId) return null;
  const { data } = await supabase.auth.admin.getUserById(userId);
  return data?.user?.email ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Only allow service role calls
  const auth = req.headers.get("Authorization") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!auth.includes(serviceKey)) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const now = new Date();
  const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();
  // Window: 12–13h ago to avoid sending twice (cron runs hourly)
  const thirteenHoursAgo = new Date(now.getTime() - 13 * 60 * 60 * 1000).toISOString();

  const results = { pendingReminders: 0, chatReminders: 0, errors: 0 };

  // --- 1. PENDING BOOKING REQUESTS: remind host after 12h ---
  const { data: pendingBookings } = await supabase
    .from("bookings")
    .select("id, listing_id, renter_name, from_date, to_date, created_at")
    .eq("status", "pending")
    .lt("created_at", twelveHoursAgo)
    .gt("created_at", thirteenHoursAgo);

  for (const b of pendingBookings ?? []) {
    try {
      const { data: listing } = await supabase
        .from("listings")
        .select("title, owner")
        .eq("id", b.listing_id)
        .single();

      const hostEmail = await getUserEmail(listing?.owner ?? "");
      if (!hostEmail) continue;

      await sendEmail(
        hostEmail,
        `Påminnelse: Du har en ubesvart bookingforespørsel`,
        emailLayout(
          "Ubesvart leieforespørsel ⏰",
          `<p><strong>${b.renter_name}</strong> sendte en leieforespørsel for <strong>${listing?.title ?? "annonsen din"}</strong> for over 12 timer siden.</p>
          <div class="info-box">
            <p><strong>Periode:</strong> ${fmt(b.from_date)} → ${fmt(b.to_date)}</p>
            <p><strong>Leietaker:</strong> ${b.renter_name}</p>
          </div>
          <p>Logg inn og godkjenn eller avslå forespørselen. Leietakere booker hos den utleieren som svarer raskest.</p>
          <a href="${APP_URL}" class="btn">Svar på forespørsel →</a>`,
        ),
      );
      results.pendingReminders++;
    } catch (e) {
      console.error("[no-reply] pending reminder error:", e);
      results.errors++;
    }
  }

  // --- 2. CHAT MESSAGES: remind the other party after 12h ---
  // Find the latest message in each active booking thread
  const { data: latestMessages } = await supabase
    .from("messages")
    .select("booking_id, sender_id, sender_name, sender_role, text, created_at")
    .lt("created_at", twelveHoursAgo)
    .gt("created_at", thirteenHoursAgo)
    .order("created_at", { ascending: false });

  // Group by booking_id — keep only the latest per booking
  const seenBookings = new Set<string>();
  const latestPerBooking: typeof latestMessages = [];
  for (const msg of latestMessages ?? []) {
    if (!seenBookings.has(msg.booking_id)) {
      seenBookings.add(msg.booking_id);
      latestPerBooking.push(msg);
    }
  }

  for (const msg of latestPerBooking) {
    try {
      // Check if there's a newer message (meaning someone already replied)
      const { count } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("booking_id", msg.booking_id)
        .gt("created_at", msg.created_at);

      if (count && count > 0) continue; // already replied, skip

      // Get booking to find the other party
      const { data: booking } = await supabase
        .from("bookings")
        .select("id, listing_id, renter, renter_name, renter_email, status")
        .eq("id", msg.booking_id)
        .single();

      if (!booking || booking.status === "cancelled" || booking.status === "declined") continue;

      const { data: listing } = await supabase
        .from("listings")
        .select("title, owner")
        .eq("id", booking.listing_id)
        .single();

      const preview = (msg.text ?? "").slice(0, 120);

      if (msg.sender_role === "renter" || msg.sender_role === "user") {
        // Renter sent last → remind host
        const hostEmail = await getUserEmail(listing?.owner ?? "");
        if (!hostEmail) continue;
        await sendEmail(
          hostEmail,
          `Påminnelse: Ubesvart melding fra ${msg.sender_name}`,
          emailLayout(
            "Du har en ubesvart melding ⏰",
            `<p><strong>${msg.sender_name}</strong> sendte deg en melding for over 12 timer siden angående <strong>${listing?.title ?? "annonsen din"}</strong>:</p>
            <div class="info-box">
              <p style="font-style:italic">"${preview}${msg.text?.length > 120 ? "..." : ""}"</p>
            </div>
            <p>Husk å svare — leietakere foretrekker utleiere som svarer raskt.</p>
            <a href="${APP_URL}" class="btn">Svar nå →</a>`,
          ),
        );
        results.chatReminders++;
      } else {
        // Host sent last → remind renter
        const renterEmail = booking.renter_email;
        if (!renterEmail) continue;
        await sendEmail(
          renterEmail,
          `Påminnelse: Utleier har sendt deg en melding`,
          emailLayout(
            "Ubesvart melding fra utleier ⏰",
            `<p>Utleier har sendt deg en melding angående <strong>${listing?.title ?? "annonsen"}</strong> for over 12 timer siden:</p>
            <div class="info-box">
              <p style="font-style:italic">"${preview}${msg.text?.length > 120 ? "..." : ""}"</p>
            </div>
            <p>Logg inn og svar for å komme videre med bookingen.</p>
            <a href="${APP_URL}" class="btn">Svar nå →</a>`,
          ),
        );
        results.chatReminders++;
      }
    } catch (e) {
      console.error("[no-reply] chat reminder error:", e);
      results.errors++;
    }
  }

  console.log("[notify-no-reply] Done:", results);
  return new Response(JSON.stringify(results), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

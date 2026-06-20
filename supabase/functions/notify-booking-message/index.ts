import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { sendEmail, emailLayout } from "../_shared/email.ts";
import { insertNotification } from "../_shared/notify.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rateLimit.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!checkRateLimit(req, 20, 60_000)) return rateLimitResponse();

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const { data: userData } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { bookingId, messageText, senderName, senderRole, event } =
      await req.json();

    if (messageText && messageText.length > 2000) {
      return new Response(JSON.stringify({ error: "Message too long" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- CHAT MESSAGE (renter ↔ host) ---
    if (event === "chat_message" || !event) {
      const { data: booking } = await supabase
        .from("bookings")
        .select("id, renter, renter_name, renter_email, listing_id")
        .eq("id", bookingId)
        .single();

      if (!booking) {
        return new Response(JSON.stringify({ error: "Booking not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: listing } = await supabase
        .from("listings")
        .select("title, owner")
        .eq("id", booking.listing_id)
        .single();

      const preview = (messageText ?? "").slice(0, 200);
      const appUrl = "https://leieplattform.no";

      if (senderRole === "renter" || senderRole === "user") {
        // Renter sent → notify host
        const { data: hostUser } = await supabase.auth.admin.getUserById(
          listing?.owner ?? "",
        );
        const hostEmail = hostUser?.user?.email;
        if (hostEmail) {
          await sendEmail(
            hostEmail,
            `Ny melding fra ${senderName} — ${listing?.title ?? "booking"}`,
            emailLayout(
              "Du har fått en melding 📬",
              `<p><strong>${senderName}</strong> har sendt deg en melding angående <strong>${listing?.title ?? "annonsen din"}</strong>:</p>
              <div class="info-box">
                <p style="font-style:italic">"${preview}"</p>
              </div>
              <p>Logg inn og gå til <strong>Innboks</strong> for å svare.</p>
              <a href="${appUrl}" class="btn">Svar på melding →</a>`,
            ),
          );
        }
        if (listing?.owner) {
          await insertNotification(supabase, listing.owner, "chat_message",
            `Ny melding fra ${senderName}`,
            `"${preview.slice(0, 80)}"`,
            { bookingId, listingTitle: listing.title });
        }
      } else {
        // Host sent → notify renter
        const renterEmail = booking.renter_email;
        const renterName = booking.renter_name ?? "Leietaker";
        if (renterEmail) {
          await sendEmail(
            renterEmail,
            `Ny melding fra utleier — ${listing?.title ?? "booking"}`,
            emailLayout(
              "Du har fått et svar 📬",
              `<p>Utleier har svart på din booking-forespørsel for <strong>${listing?.title ?? "annonsen"}</strong>:</p>
              <div class="info-box">
                <p style="font-style:italic">"${preview}"</p>
              </div>
              <p>Logg inn for å lese hele samtalen og svare.</p>
              <a href="${appUrl}" class="btn">Gå til samtale →</a>`,
            ),
          );
        }
        if (booking.renter) {
          await insertNotification(supabase, booking.renter, "chat_message",
            `Ny melding fra utleier`,
            `${listing?.title ?? "booking"}: "${preview.slice(0, 80)}"`,
            { bookingId, listingTitle: listing?.title });
        }
      }
    }

    // --- BOOKING REQUEST (leietaker søker) → varsle utleier ---
    if (event === "booking_request") {
      const { data: booking } = await supabase
        .from("bookings")
        .select("id, renter_name, renter_email, from_date, to_date, listing_id")
        .eq("id", bookingId)
        .single();

      const { data: listing } = await supabase
        .from("listings")
        .select("title, owner")
        .eq("id", booking?.listing_id ?? "")
        .single();

      const { data: hostUser } = await supabase.auth.admin.getUserById(
        listing?.owner ?? "",
      );
      const hostEmail = hostUser?.user?.email;
      const from = booking?.from_date ?? "";
      const to = booking?.to_date ?? "";

      if (hostEmail && booking) {
        await sendEmail(
          hostEmail,
          `Ny leieforespørsel — ${listing?.title ?? "annonsen din"}`,
          emailLayout(
            "Du har fått en leieforespørsel 🎉",
            `<p><strong>${booking.renter_name}</strong> ønsker å leie <strong>${listing?.title ?? "annonsen din"}</strong>.</p>
            <div class="info-box">
              <p><strong>Periode:</strong> ${from} → ${to}</p>
              <p><strong>Leietaker:</strong> ${booking.renter_name}</p>
            </div>
            <p>Logg inn og gå til <strong>Utleier-dashbord</strong> for å godkjenne eller avvise forespørselen.</p>
            <a href="https://leieplattform.no" class="btn">Se forespørsel →</a>`,
          ),
        );
      }
      if (listing?.owner) {
        await insertNotification(supabase, listing.owner, "booking_request",
          `Ny leieforespørsel`,
          `${booking?.renter_name} ønsker å leie ${listing?.title ?? "annonsen din"} (${from} → ${to})`,
          { bookingId, listingTitle: listing.title });
      }
    }

    // --- BOOKING ACCEPTED → varsle leietaker ---
    if (event === "booking_accepted") {
      const { data: booking } = await supabase
        .from("bookings")
        .select("id, renter_name, renter_email, from_date, to_date, listing_id")
        .eq("id", bookingId)
        .single();

      const { data: listing } = await supabase
        .from("listings")
        .select("title, price_per_day")
        .eq("id", booking?.listing_id ?? "")
        .single();

      if (booking?.renter_email) {
        await sendEmail(
          booking.renter_email,
          `Bestillingen er godkjent — ${listing?.title ?? ""}`,
          emailLayout(
            "Forespørselen din er godkjent ✅",
            `<p>Godt nytt, ${booking.renter_name}! Utleier har godkjent din leieforespørsel.</p>
            <div class="info-box">
              <p><strong>Utstyr:</strong> ${listing?.title ?? ""}</p>
              <p><strong>Periode:</strong> ${booking.from_date} → ${booking.to_date}</p>
            </div>
            <p>Logg inn for å se detaljer, betale og sende meldinger til utleier.</p>
            <a href="https://leieplattform.no" class="btn">Se booking →</a>`,
          ),
        );
      }
      if (booking?.renter) {
        await insertNotification(supabase, booking.renter, "booking_accepted",
          `Forespørsel godkjent ✅`,
          `${listing?.title ?? "Booking"} er godkjent! (${booking.from_date} → ${booking.to_date})`,
          { bookingId, listingTitle: listing?.title });
      }
    }

    // --- BOOKING REJECTED → varsle leietaker ---
    if (event === "booking_rejected") {
      const { data: booking } = await supabase
        .from("bookings")
        .select("id, renter_name, renter_email, listing_id")
        .eq("id", bookingId)
        .single();

      const { data: listing } = await supabase
        .from("listings")
        .select("title")
        .eq("id", booking?.listing_id ?? "")
        .single();

      if (booking?.renter_email) {
        await sendEmail(
          booking.renter_email,
          `Forespørsel ikke godkjent — ${listing?.title ?? ""}`,
          emailLayout(
            "Forespørselen ble ikke godkjent",
            `<p>Hei ${booking.renter_name}, dessverre ble ikke leieforespørselen din godkjent denne gangen.</p>
            <div class="info-box">
              <p><strong>Utstyr:</strong> ${listing?.title ?? ""}</p>
            </div>
            <p>Du kan søke etter lignende utstyr på Leieplattform.</p>
            <a href="https://leieplattform.no" class="btn">Se andre annonser →</a>`,
          ),
        );
      }
      if (booking?.renter) {
        await insertNotification(supabase, booking.renter, "booking_rejected",
          `Forespørsel avslått`,
          `Din forespørsel for ${listing?.title ?? "annonsen"} ble ikke godkjent. Se etter andre annonser.`,
          { bookingId, listingTitle: listing?.title });
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[notify-booking-message]", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

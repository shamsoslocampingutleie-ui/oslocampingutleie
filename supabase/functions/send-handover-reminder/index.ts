// Cron job: send handover confirmation reminders and auto-release payouts.
//
// Run this daily via Supabase cron:
//   select cron.schedule('handover-reminder', '0 9 * * *',
//     $$select net.http_post(url:='https://<project>.supabase.co/functions/v1/send-handover-reminder',
//       headers:='{"Authorization":"Bearer <service_role_key>","Content-Type":"application/json"}'::jsonb,
//       body:='{}'::jsonb) as request_id$$);
//
// Or call it from your Supabase dashboard → Edge Functions → Trigger manually.
//
// Logic:
//   1. Booking is paid but payout not yet released.
//   2. Rental end date has passed.
//   3. If missing host confirmation → email host.
//      If missing renter confirmation → email renter.
//   4. If BOTH are unconfirmed and >7 days past end → auto-confirm both and release.
//   5. If BOTH are confirmed but payout not released → release now (failsafe).

import { createClient } from "npm:@supabase/supabase-js@2";
import { sendEmail, emailLayout } from "../_shared/email.ts";
import { corsHeaders } from "../_shared/cors.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const STRIPE_RELEASE_URL =
  `${Deno.env.get("SUPABASE_URL")}/functions/v1/stripe-release-payout-internal`;

function fmt(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("nb-NO", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

async function getUserEmail(userId: string): Promise<string | null> {
  const { data } = await supabase.auth.admin.getUserById(userId);
  return data?.user?.email ?? null;
}

async function triggerRelease(bookingId: string): Promise<void> {
  // Call the internal payout release (bypasses JWT check)
  try {
    await fetch(
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/stripe-release-payout`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "apikey": Deno.env.get("SUPABASE_ANON_KEY") ?? "",
          "x-internal-cron": "1",
        },
        body: JSON.stringify({ bookingId }),
      },
    );
  } catch (e) {
    console.error(`[release] Failed for booking ${bookingId}:`, e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Only allow service role or internal cron calls
  const auth = req.headers.get("Authorization") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!auth.includes(serviceKey)) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    .toISOString();

  // Fetch all paid, unreleased bookings where rental has ended
  const { data: bookings, error } = await supabase
    .from("bookings")
    .select(`
      id, listing_id, renter, host_id,
      from_date, to_date,
      host_confirmed_handover, renter_confirmed_handover,
      payout_released, paid, status,
      amount_total, platform_fee
    `)
    .eq("paid", true)
    .eq("payout_released", false)
    .lt("to_date", now.toISOString().split("T")[0])
    .neq("status", "cancelled");

  if (error) {
    console.error("[reminder] DB error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results = {
    checked: bookings?.length ?? 0,
    remindersHost: 0,
    remindersRenter: 0,
    autoReleased: 0,
    failsafeReleased: 0,
  };

  for (const b of bookings ?? []) {
    const bothConfirmed = b.host_confirmed_handover && b.renter_confirmed_handover;

    // Case 1: Both confirmed but payout not released (client-side trigger failed)
    if (bothConfirmed) {
      console.log(`[failsafe] Releasing payout for booking ${b.id}`);
      await triggerRelease(b.id);
      results.failsafeReleased++;
      continue;
    }

    // Case 2: Neither confirmed and >7 days past end date → auto-confirm and release
    if (!b.host_confirmed_handover && !b.renter_confirmed_handover) {
      const endDate = new Date(b.to_date);
      if (endDate < new Date(sevenDaysAgo)) {
        console.log(`[auto-confirm] Both unconfirmed 7d+ past end for booking ${b.id}`);
        await supabase
          .from("bookings")
          .update({
            host_confirmed_handover: true,
            renter_confirmed_handover: true,
            status: "completed",
          })
          .eq("id", b.id);

        await triggerRelease(b.id);
        results.autoReleased++;

        // Notify both
        const [hostEmail, renterEmail] = await Promise.all([
          getUserEmail(b.host_id),
          getUserEmail(b.renter),
        ]);

        const listingRes = await supabase
          .from("listings")
          .select("title")
          .eq("id", b.listing_id)
          .single();
        const title = listingRes.data?.title ?? "leieforholdet";

        if (hostEmail) {
          await sendEmail(
            hostEmail,
            "Utbetaling frigitt automatisk",
            emailLayout(
              "Utbetaling frigitt automatisk",
              `<p>Leieperioden for <strong>${title}</strong> (${fmt(b.from_date)} – ${fmt(b.to_date)}) ble automatisk avsluttet fordi ingen av partene bekreftet overlevering innen 7 dager.</p>
              <p>Vi har frigitt utbetalingen til din Stripe-konto. Beløpet vil vises innen 3–5 virkedager.</p>
              <a href="https://oslocampingutleie.no" class="btn">Gå til Mine bookinger</a>
              <div class="info-box"><p>Fremover: husk å bekrefte «Utlevering» i appen etter at leietaker har hentet utstyret.</p></div>`,
            ),
          );
        }
        if (renterEmail) {
          await sendEmail(
            renterEmail,
            "Leieperioden er avsluttet",
            emailLayout(
              "Leieperioden er avsluttet",
              `<p>Leieperioden for <strong>${title}</strong> (${fmt(b.from_date)} – ${fmt(b.to_date)}) ble automatisk avsluttet.</p>
              <p>Fremover: husk å bekrefte «Mottak» i appen etter at du har returnert utstyret — dette sikrer at depositumet ditt frigjøres raskere.</p>
              <a href="https://oslocampingutleie.no" class="btn">Se mine bookinger</a>`,
            ),
          );
        }
        continue;
      }
    }

    // Case 3: Only one party is missing confirmation → send reminder
    const listingRes = await supabase
      .from("listings")
      .select("title")
      .eq("id", b.listing_id)
      .single();
    const title = listingRes.data?.title ?? "leieforholdet";

    if (!b.host_confirmed_handover) {
      const hostEmail = await getUserEmail(b.host_id);
      if (hostEmail) {
        await sendEmail(
          hostEmail,
          `Påminnelse: Bekreft utlevering for ${title}`,
          emailLayout(
            "Husk å bekrefte utlevering",
            `<p>Leieperioden for <strong>${title}</strong> er avsluttet (${fmt(b.from_date)} – ${fmt(b.to_date)}), men du har ikke bekreftet utlevering ennå.</p>
            <p><strong>Pengene kan ikke utbetales til deg før du bekrefter.</strong></p>
            <a href="https://oslocampingutleie.no" class="btn">Bekreft utlevering nå →</a>
            <div class="info-box">
              <p>Logg inn → Mine bookinger → <strong>Bekreft utlevering</strong></p>
              <p>Hvis du ikke bekrefter innen 7 dager etter leieperiodens slutt, vil utbetalingen frigis automatisk.</p>
            </div>`,
          ),
        );
        results.remindersHost++;
      }
    }

    if (!b.renter_confirmed_handover) {
      const renterEmail = await getUserEmail(b.renter);
      if (renterEmail) {
        await sendEmail(
          renterEmail,
          `Påminnelse: Bekreft mottak for ${title}`,
          emailLayout(
            "Husk å bekrefte mottak",
            `<p>Leieperioden for <strong>${title}</strong> er avsluttet (${fmt(b.from_date)} – ${fmt(b.to_date)}), men du har ikke bekreftet mottak og retur ennå.</p>
            <a href="https://oslocampingutleie.no" class="btn">Bekreft mottak nå →</a>
            <div class="info-box">
              <p>Logg inn → Mine bookinger → <strong>Bekreft mottak</strong></p>
              <p>Bekreftelsen er viktig for at depositumet ditt frigjøres og utleieren får betalt.</p>
            </div>`,
          ),
        );
        results.remindersRenter++;
      }
    }
  }

  console.log("[reminder] Done:", results);
  return new Response(JSON.stringify(results), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

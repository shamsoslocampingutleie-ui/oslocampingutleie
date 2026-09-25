// Cancels a booking and issues a Stripe refund based on the LISTING'S OWN
// cancellation policy (listings.cancel_policy — host/flexible/moderate/
// strict), the same one shown to the renter on the listing page and in
// the public FAQ:
//   host     : no self-service refund — renter must contact the host
//   strict   : no refund ever (booking still cancels, 0% refund)
//   flexible : 100% refund if ≥ 48h before start, else 0%
//   moderate : 100% if ≥ 7 days, 50% if 1–6 days, blocked (<1 day, must
//              contact support) — this is also the fallback for any
//              unrecognized/legacy policy value.
//
// Only the renter or an admin can call this. Payout must not be released yet.
import Stripe from "npm:stripe@17";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rateLimit.ts";
import { sendEmail, emailLayout, escapeHtml } from "../_shared/email.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-06-20",
});

function fmt(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("nb-NO", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: userData, error: userErr } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    // Rate limit: 5 refund attempts per user per 5 minutes
    if (!await checkRateLimit(req, 5, 300_000)) return rateLimitResponse(corsHeaders);

    const { bookingId } = await req.json();
    if (!bookingId) {
      return new Response(JSON.stringify({ error: "bookingId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: booking, error: bookingErr } = await supabase
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .single();
    if (bookingErr || !booking) {
      return new Response(JSON.stringify({ error: "Booking ikke funnet" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Which cancellation policy applies -- this used to be ignored
    // entirely: every booking got the same hardcoded 7-day/50% ladder no
    // matter what the host picked in "Avbestillingspolicy" (host/
    // flexible/moderate/strict), even though the listing page and the
    // public FAQ both explicitly promise renters the policy the host
    // chose. A "strict" listing (promised: no refund after confirmation)
    // was actually refunding 100% for cancellations a week out, and a
    // "flexible" listing (promised: free within 48 hours) was actually
    // denying refunds inside that window. See cancelBooking()'s
    // _cancelPreview() in src/app.html for the identical client-side
    // preview shown before the renter confirms.
    const { data: policyListing } = await supabase
      .from("listings")
      .select("cancel_policy")
      .eq("id", booking.listing_id)
      .maybeSingle();
    const cancelPolicy = policyListing?.cancel_policy || "host";

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .single();
    const isAdmin = profile?.role === "admin";

    if (booking.renter !== userId && !isAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (booking.status === "cancelled") {
      return new Response(JSON.stringify({ error: "Bookingen er allerede avbestilt" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (booking.payout_released) {
      return new Response(
        JSON.stringify({ error: "Utbetaling er allerede frigitt — kontakt oss på kundeservice@oslocampingutleie.no" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const now = new Date();
    const startDate = new Date(booking.from_date);
    const daysUntilStart = Math.floor((startDate.getTime() - now.getTime()) / 86400000);

    // Not paid: just cancel, no refund needed
    if (!booking.paid) {
      await supabase
        .from("bookings")
        .update({
          status: "cancelled",
          cancelled_by: isAdmin ? "admin" : "renter",
          cancelled_at: now.toISOString(),
        })
        .eq("id", bookingId);

      return new Response(
        JSON.stringify({ cancelled: true, refundAmount: 0, refundMsg: "Bookingen er avbestilt." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Leieperioden er allerede startet
    if (daysUntilStart < 0) {
      return new Response(
        JSON.stringify({
          error: "Leieperioden er allerede startet. Kontakt oss på kundeservice@oslocampingutleie.no for hjelp.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // "host"-policy betyr utleier har valgt at avbestilling avtales
    // direkte med dem (se listingens "Avbestillingspolicy") -- ingen
    // automatisk selvbetjent refusjon her, samme prinsipp som FAQ-siden
    // og booking-detaljvisningen allerede lover renteren.
    if (cancelPolicy === "host") {
      return new Response(
        JSON.stringify({
          error: "Utleieren har valgt at avbestilling avtales direkte. Kontakt utleier via meldingsfunksjonen for å avtale avbestilling og eventuell refusjon.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const amountTotal = Number(booking.amount_total || 0);
    let refundPct: number;
    let refundMsg: string;
    if (cancelPolicy === "strict") {
      refundPct = 0;
      refundMsg = "Ingen refusjon (streng avbestillingspolicy) — bookingen kanselleres uten refusjon.";
    } else if (cancelPolicy === "flexible") {
      if (daysUntilStart >= 2) {
        refundPct = 100;
        refundMsg = "Hele beløpet refunderes (100%) — fleksibel avbestillingspolicy.";
      } else {
        refundPct = 0;
        refundMsg = "Mindre enn 48 timer til oppstart — fleksibel policy dekker fri avbestilling frem til 48 timer før oppstart, så ingen refusjon gis.";
      }
    } else {
      // "moderate" (og enhver ukjent/eldre verdi) -- den opprinnelige,
      // globale standardpolicyen denne funksjonen alltid brukte.
      if (daysUntilStart < 1) {
        return new Response(
          JSON.stringify({
            error: "Avbestilling mindre enn 24 timer før oppstart gir ikke automatisk refusjon. Kontakt oss på kundeservice@oslocampingutleie.no.",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      refundPct = daysUntilStart >= 7 ? 100 : 50;
      refundMsg = daysUntilStart >= 7
        ? "Hele beløpet refunderes (100%)."
        : "50% refunderes (avbestilling 1–6 dager før oppstart).";
    }

    const refundAmount = Math.round(amountTotal * refundPct / 100);
    const refundAmountOre = Math.round(refundAmount * 100);

    // Atomically claim the cancellation before calling Stripe. A plain
    // read-then-write here would let a double-click, a retry, or two open
    // tabs both pass every check above and both create a real refund.
    // Only proceed if THIS call is the one that actually flips the status
    // away from what we just read (and payout hasn't been released in the
    // meantime by a concurrent handover-confirmation).
    const { data: claimed, error: claimErr } = await supabase
      .from("bookings")
      .update({
        status: "cancelled",
        cancelled_by: isAdmin ? "admin" : "renter",
        cancelled_at: now.toISOString(),
      })
      .eq("id", bookingId)
      .eq("status", booking.status)
      .eq("payout_released", false)
      .select("id");
    if (claimErr) throw claimErr;
    if (!claimed || claimed.length === 0) {
      return new Response(
        JSON.stringify({ error: "Bookingen ble endret av en annen forespørsel akkurat nå. Last siden på nytt og prøv igjen." }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // A 0% outcome (strict policy, or flexible cancelled inside the
    // 48-hour window) is a real, valid cancellation with nothing to
    // refund -- Stripe's refunds.create rejects a zero amount, so skip
    // the API call entirely rather than treating it as an error.
    let refund: { id: string } | null = null;
    if (refundAmountOre > 0) {
      try {
        refund = await stripe.refunds.create({
          payment_intent: booking.payment_intent_id,
          amount: refundAmountOre,
          reason: "requested_by_customer",
          metadata: { booking_id: bookingId },
        }, {
          // Extra safety net beyond the DB claim above.
          idempotencyKey: `refund-${bookingId}`,
        });
      } catch (refundErr) {
        // Stripe call failed -- roll back our claim so the booking isn't
        // left marked cancelled with no actual refund issued.
        await supabase
          .from("bookings")
          .update({ status: booking.status, cancelled_by: null, cancelled_at: null })
          .eq("id", bookingId);
        throw refundErr;
      }
    }

    await supabase
      .from("bookings")
      .update({
        refund_id: refund?.id ?? null,
        refund_amount: refundAmount,
      })
      .eq("id", bookingId);

    // Send e-post til begge parter
    try {
      const { data: listing } = await supabase
        .from("listings")
        .select("title, owner")
        .eq("id", booking.listing_id)
        .single();

      const [renterAuth, hostAuth] = await Promise.all([
        supabase.auth.admin.getUserById(booking.renter),
        supabase.auth.admin.getUserById(listing?.owner ?? ""),
      ]);

      const title = escapeHtml(listing?.title ?? "leieforholdet");
      const fromFmt = fmt(booking.from_date);
      const toFmt = fmt(booking.to_date);

      if (renterAuth.data?.user?.email) {
        await sendEmail(
          renterAuth.data.user.email,
          `Booking avbestilt — ${title}`,
          emailLayout(
            "Booking avbestilt",
            `<p>Vi bekrefter at din booking av <strong>${title}</strong> (${fromFmt} – ${toFmt}) er avbestilt.</p>
            <div class="info-box">
              <p><strong>Refusjon:</strong> ${refundAmount.toLocaleString("nb-NO")} kr (${refundPct}%)</p>
              <p>Beløpet tilbakeføres til ditt betalingskort innen 5–10 virkedager via Stripe.</p>
            </div>
            <a href="https://leieplattform.no" class="btn">Finn et annet tilbud →</a>`,
          ),
        );
      }

      if (hostAuth.data?.user?.email) {
        await sendEmail(
          hostAuth.data.user.email,
          `Booking avbestilt — ${title}`,
          emailLayout(
            "En booking er avbestilt",
            `<p>Leietakeren har avbestilt bookingen av <strong>${title}</strong> (${fromFmt} – ${toFmt}).</p>
            <div class="info-box">
              <p>Dine datoer er nå ledige igjen for nye bookinger.</p>
              <p>Ingen utbetaling skjer for denne bookingen.</p>
            </div>
            <a href="https://leieplattform.no" class="btn">Se mine annonser →</a>`,
          ),
        );
      }
    } catch (emailErr) {
      console.error("[refund] Email send failed:", emailErr);
    }

    return new Response(
      JSON.stringify({ cancelled: true, refundAmount, refundMsg }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

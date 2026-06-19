// Cancels a booking and issues a Stripe refund based on cancellation policy.
//
// Policy (days until from_date at time of cancellation):
//   ≥ 7 days : 100% refund
//   1–6 days : 50% refund
//   < 1 day  : no automatic refund — contact admin
//
// Only the renter or an admin can call this. Payout must not be released yet.
import Stripe from "npm:stripe@17";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { sendEmail, emailLayout } from "../_shared/email.ts";

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

    // Samme dag — ikke automatisk refusjon
    if (daysUntilStart < 1) {
      return new Response(
        JSON.stringify({
          error: "Avbestilling mindre enn 24 timer før oppstart gir ikke automatisk refusjon. Kontakt oss på kundeservice@oslocampingutleie.no.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const amountTotal = Number(booking.amount_total || 0);
    const refundPct = daysUntilStart >= 7 ? 100 : 50;
    const refundMsg = daysUntilStart >= 7
      ? "Hele beløpet refunderes (100%)."
      : "50% refunderes (avbestilling 1–6 dager før oppstart).";

    const refundAmount = Math.round(amountTotal * refundPct / 100);
    const refundAmountOre = Math.round(refundAmount * 100);

    const refund = await stripe.refunds.create({
      payment_intent: booking.payment_intent_id,
      amount: refundAmountOre,
      reason: "requested_by_customer",
      metadata: { booking_id: bookingId },
    });

    await supabase
      .from("bookings")
      .update({
        status: "cancelled",
        cancelled_by: isAdmin ? "admin" : "renter",
        cancelled_at: now.toISOString(),
        refund_id: refund.id,
        refund_amount: refundAmount,
      })
      .eq("id", bookingId);

    // Send e-post til begge parter
    try {
      const { data: listing } = await supabase
        .from("listings")
        .select("title")
        .eq("id", booking.listing_id)
        .single();

      const [renterAuth, hostAuth] = await Promise.all([
        supabase.auth.admin.getUserById(booking.renter),
        supabase.auth.admin.getUserById(booking.host_id),
      ]);

      const title = listing?.title ?? "leieforholdet";
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
            <a href="https://oslocampingutleie.no" class="btn">Finn et annet tilbud →</a>`,
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
            <a href="https://oslocampingutleie.no" class="btn">Se mine annonser →</a>`,
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

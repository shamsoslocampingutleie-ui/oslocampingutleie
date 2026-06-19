// Releases the host's share of a paid booking to their connected Stripe
// account, once BOTH host and renter have confirmed handover.
//
// The platform receives 100% of the payment at checkout time (see
// stripe-checkout). Funds sit in the platform's Stripe balance until this
// function transfers the host's share (amount_total - platform_fee) out to
// the host's connected account. Listings without a connected account
// (platform-owned listings) never trigger a transfer — the platform keeps
// the full amount.
import Stripe from "npm:stripe@17";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { sendEmail, emailLayout } from "../_shared/email.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-06-20",
});

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

    // Allow internal cron calls (service role) to bypass user JWT check
    const isInternalCron = req.headers.get("x-internal-cron") === "1";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const isServiceRole = authHeader.replace("Bearer ", "") === serviceKey;

    let userId: string | null = null;
    if (!isInternalCron && !isServiceRole) {
      const { data: userData, error: userErr } = await supabase.auth.getUser(
        authHeader.replace("Bearer ", ""),
      );
      if (userErr || !userData?.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = userData.user.id;
    }

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
      return new Response(JSON.stringify({ error: "Booking not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: listing, error: listingErr } = await supabase
      .from("listings")
      .select("owner")
      .eq("id", booking.listing_id)
      .single();
    if (listingErr || !listing) {
      return new Response(JSON.stringify({ error: "Listing not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!isInternalCron && !isServiceRole && booking.renter !== userId && listing.owner !== userId) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Nothing to do yet, or already handled.
    if (
      !booking.host_confirmed_handover || !booking.renter_confirmed_handover
    ) {
      return new Response(JSON.stringify({ released: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!booking.paid || booking.payout_released) {
      return new Response(JSON.stringify({ released: !!booking.payout_released }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: host, error: hostErr } = await supabase
      .from("profiles")
      .select("stripe_account_id")
      .eq("id", listing.owner)
      .single();
    if (hostErr || !host) {
      return new Response(JSON.stringify({ error: "Host not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const amountTotal = Number(booking.amount_total || 0);
    const platformFee = Number(booking.platform_fee || 0);
    const payoutAmount = Math.round((amountTotal - platformFee) * 100);

    if (!host.stripe_account_id || payoutAmount <= 0) {
      // Platform-owned listing or nothing left to pay out.
      await supabase
        .from("bookings")
        .update({ payout_released: true })
        .eq("id", bookingId);
      return new Response(JSON.stringify({ released: true, transferred: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const pi = await stripe.paymentIntents.retrieve(booking.payment_intent_id);
    const transfer = await stripe.transfers.create({
      amount: payoutAmount,
      currency: "nok",
      destination: host.stripe_account_id,
      source_transaction: pi.latest_charge as string,
      metadata: { booking_id: bookingId },
    });

    await supabase
      .from("bookings")
      .update({ payout_released: true, transfer_id: transfer.id })
      .eq("id", bookingId);

    // Send payout confirmation email to host
    try {
      const { data: bookingFull } = await supabase
        .from("bookings")
        .select("renter, host_id, listing_id, from_date, to_date")
        .eq("id", bookingId)
        .single();
      if (bookingFull) {
        const { data: listing } = await supabase
          .from("listings")
          .select("title")
          .eq("id", bookingFull.listing_id)
          .single();
        const hostAuth = await supabase.auth.admin.getUserById(bookingFull.host_id);
        const hostEmail = hostAuth.data?.user?.email;
        const title = listing?.title ?? "leieforholdet";
        const payoutKr = (payoutAmount / 100).toLocaleString("nb-NO") + " kr";
        const fromFmt = new Date(bookingFull.from_date).toLocaleDateString("nb-NO", { day: "numeric", month: "long", year: "numeric" });
        const toFmt = new Date(bookingFull.to_date).toLocaleDateString("nb-NO", { day: "numeric", month: "long", year: "numeric" });

        if (hostEmail) {
          await sendEmail(
            hostEmail,
            `Utbetaling frigitt — ${title}`,
            emailLayout(
              "Utbetaling er på vei til deg ✓",
              `<p>Begge parter har bekreftet overlevering. Din utbetaling for <strong>${title}</strong> er nå frigitt og overføres til din Stripe-konto.</p>
              <div class="info-box">
                <p><strong>Utstyr:</strong> ${title}</p>
                <p><strong>Periode:</strong> ${fromFmt} – ${toFmt}</p>
                <p><strong>Utbetaling:</strong> <strong style="color:#14512E">${payoutKr}</strong></p>
              </div>
              <p>Beløpet vil vises på din bankkonto innen 3–5 virkedager via Stripe.</p>
              <a href="https://leieplattform.no" class="btn">Gå til Mine bookinger →</a>`,
            ),
          );
        }
      }
    } catch (emailErr) {
      console.error("[payout] Email send failed:", emailErr);
    }

    return new Response(
      JSON.stringify({ released: true, transferred: payoutAmount }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

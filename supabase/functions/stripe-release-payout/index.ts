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

    if (booking.renter !== userId && listing.owner !== userId) {
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

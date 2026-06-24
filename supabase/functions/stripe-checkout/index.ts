// Creates a Stripe Checkout Session for a booking.
// Fee structure:
//   - Renter pays: rent + 7% service fee + cleaning fee + deposit + transport
//   - Platform keeps: 7% service fee (from renter) + 10% platform fee (from host) = 17% of rent
//   - Host receives: 90% of rent + cleaning fee + deposit + transport (paid out after handover)
import Stripe from "npm:stripe@17";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rateLimit.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-06-20",
});

function nights(from: string, to: string) {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return Math.max(1, Math.round(ms / 86400000));
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

    const { bookingId, successUrl, cancelUrl, discountCode, transportFee: reqTransportFee } = await req.json();
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
    if (booking.renter !== userId) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (booking.status !== "accepted") {
      return new Response(
        JSON.stringify({ error: "Booking is not accepted yet" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    if (booking.paid) {
      return new Response(JSON.stringify({ error: "Already paid" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!booking.renter_phone?.trim() || !booking.renter_address?.trim()) {
      return new Response(
        JSON.stringify({
          error: "MISSING_CONTACT_INFO",
          message:
            "Telefonnummer og adresse må fylles ut før betaling.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const { data: listing, error: listingErr } = await supabase
      .from("listings")
      .select("*")
      .eq("id", booking.listing_id)
      .single();
    if (listingErr || !listing) {
      return new Response(JSON.stringify({ error: "Listing not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: host, error: hostErr } = await supabase
      .from("profiles")
      .select("stripe_account_id, stripe_charges_enabled")
      .eq("id", listing.owner)
      .single();
    if (hostErr || !host) {
      return new Response(JSON.stringify({ error: "Host not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const hasConnectedAccount = !!host.stripe_account_id;
    if (hasConnectedAccount && !host.stripe_charges_enabled) {
      return new Response(
        JSON.stringify({
          error:
            "Utleieren har ikke fullført Stripe-oppsettet sitt ennå. Kontakt utleier.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const n = nights(booking.from_date, booking.to_date);
    const rent = Number(listing.price_per_day) * n;

    // Validate and apply discount code (format: OCU-XXXXXX-N, max 20%)
    let discountPct = 0;
    if (discountCode && typeof discountCode === "string") {
      const m = discountCode.trim().toUpperCase().match(/^OCU-[A-Z0-9]{6}-(\d+)$/);
      if (m) {
        const pct = parseInt(m[1], 10);
        if (pct >= 1 && pct <= 20) discountPct = pct;
      }
    }
    const rentAfterDiscount = discountPct > 0
      ? Math.round(rent * (1 - discountPct / 100))
      : rent;
    const discountAmount = rent - rentAfterDiscount;

    const serviceFee = Math.round(rentAfterDiscount * 0.07); // 7% from renter
    const cleaningFee = Number(listing.cleaning_fee || 0);
    const deposit = listing.deposit_mode !== "incident"
      ? Number(listing.deposit || 0)
      : 0;
    // Transport fee: from request body (frontend validates against booking.wants_transport)
    const transportFeeAmount = booking.wants_transport && reqTransportFee && reqTransportFee > 0
      ? Math.round(Number(reqTransportFee))
      : 0;
    const amountTotal = rentAfterDiscount + serviceFee + cleaningFee + deposit + transportFeeAmount;
    // Platform fee = 7% from renter + 10% from host = 17% of rent. Host gets 90%.
    const platformFee = serviceFee + Math.round(rentAfterDiscount * 0.10);

    const amountTotalOre = Math.round(amountTotal * 100);
    // The platform always receives the full payment up front. The host's
    // share (amountTotal - platformFee) is only transferred out later, once
    // both parties confirm handover (see stripe-release-payout).
    const platformFeeOre = hasConnectedAccount
      ? Math.round(platformFee * 100)
      : amountTotalOre;

    const fallback = "https://leieplattform.no/";

    const renterIp = req.headers.get("x-forwarded-for")?.split(",")[0]
      .trim() ||
      req.headers.get("cf-connecting-ip") || "";
    if (renterIp) {
      await supabase
        .from("bookings")
        .update({ renter_ip: renterIp })
        .eq("id", bookingId);
    }

    let productName = listing.title;
    if (discountPct > 0 && transportFeeAmount > 0) {
      productName = `${listing.title} (${discountPct}% rabatt + levering)`;
    } else if (discountPct > 0) {
      productName = `${listing.title} (${discountPct}% rabatt)`;
    } else if (transportFeeAmount > 0) {
      productName = `${listing.title} (inkl. levering)`;
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      phone_number_collection: { enabled: true },
      billing_address_collection: "required",
      line_items: [
        {
          price_data: {
            currency: "nok",
            product_data: { name: productName },
            unit_amount: amountTotalOre,
          },
          quantity: 1,
        },
      ],
      payment_intent_data: { metadata: { booking_id: bookingId } },
      metadata: {
        booking_id: bookingId,
        platform_fee_ore: String(platformFeeOre),
        discount_code: discountCode ?? "",
        discount_pct: String(discountPct),
        transport_fee: String(transportFeeAmount),
      },
      success_url: successUrl || fallback,
      cancel_url: cancelUrl || fallback,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

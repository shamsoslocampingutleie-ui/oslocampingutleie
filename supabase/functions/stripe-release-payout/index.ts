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
    // isInternalCron header is not used for auth — service role key is the real gate
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const isServiceRole = authHeader.replace("Bearer ", "") === serviceKey;
    const isInternalCron = isServiceRole; // alias for readability

    let userId: string | null = null;
    if (!isServiceRole) {
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
    // A cancelled booking must never pay out, even if both handover flags
    // happen to be true (e.g. a same-day cancellation with a 0%-refund
    // policy still marks status='cancelled', or a stray confirmation
    // lands after stripe-refund already ran) -- protect_booking_fields()
    // guards WHO can set the handover flags, not WHETHER the booking is
    // still cancellable, and stripe-refund only checks payout_released
    // (not the reverse). Without this, a refunded booking could still
    // have its host share transferred out afterwards, paying out money
    // that was already sent back to the renter.
    if (booking.status === "cancelled") {
      return new Response(JSON.stringify({ released: false, reason: "cancelled" }), {
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

    // Atomically claim this payout before doing anything irreversible. The
    // earlier "if (!booking.paid || booking.payout_released) return" check
    // above is a plain read and does NOT prevent two concurrent calls (a
    // client-side trigger racing the daily cron failsafe, a network retry,
    // two browser tabs) from both passing it and both calling Stripe --
    // that would double-pay the host. Only proceed if THIS call is the one
    // that flips payout_released from false to true.
    const { data: claimed, error: claimErr } = await supabase
      .from("bookings")
      .update({ payout_released: true })
      .eq("id", bookingId)
      .eq("payout_released", false)
      .select("id");
    if (claimErr) throw claimErr;
    if (!claimed || claimed.length === 0) {
      // Another call already claimed (or is claiming) this payout.
      return new Response(JSON.stringify({ released: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!host.stripe_account_id || payoutAmount <= 0) {
      // Platform-owned listing or nothing left to pay out -- claim is
      // already recorded above, nothing else to do.
      return new Response(JSON.stringify({ released: true, transferred: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    try {
      const pi = await stripe.paymentIntents.retrieve(booking.payment_intent_id);
      const transfer = await stripe.transfers.create({
        amount: payoutAmount,
        currency: "nok",
        destination: host.stripe_account_id,
        source_transaction: pi.latest_charge as string,
        metadata: { booking_id: bookingId },
      }, {
        // Extra safety net beyond the DB claim above: if this exact
        // transfer is somehow submitted twice, Stripe itself dedupes it.
        idempotencyKey: `payout-${bookingId}`,
      });

      await supabase
        .from("bookings")
        .update({ transfer_id: transfer.id })
        .eq("id", bookingId);
    } catch (transferErr) {
      // The Stripe transfer itself failed -- release our claim so the
      // daily cron failsafe (or a manual retry) can try again instead of
      // the booking being stuck marked "released" with no actual transfer.
      await supabase
        .from("bookings")
        .update({ payout_released: false })
        .eq("id", bookingId);
      throw transferErr;
    }

    // Send payout confirmation email to host
    try {
      const { data: bookingFull } = await supabase
        .from("bookings")
        .select("renter, listing_id, from_date, to_date")
        .eq("id", bookingId)
        .single();
      if (bookingFull) {
        const { data: listingTitleRow } = await supabase
          .from("listings")
          .select("title")
          .eq("id", bookingFull.listing_id)
          .single();
        const title = listingTitleRow?.title ?? "leieforholdet";
        const hostAuth = await supabase.auth.admin.getUserById(listing.owner);
        const hostEmail = hostAuth.data?.user?.email;
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
              <a href="https://leieplattform.no/booking/${bookingId}" class="btn">Gå til Mine bookinger →</a>`,
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

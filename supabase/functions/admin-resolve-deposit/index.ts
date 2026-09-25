// Admin-only: resolves a withheld deposit (booking has extra_charges
// recorded -- damage/cleaning/toll -- from openHostReturnModal, so
// stripe-release-payout deliberately skipped the automatic full refund;
// see that function's comment). Admin decides how much of the deposit
// actually goes back to the renter after reviewing the documented claim.
//
// refundOre may be anywhere from 0 (renter gets nothing back, the full
// deposit stays in the platform's Stripe balance) up to the full
// deposit_amount (same outcome as if there'd been no claim at all).
// There is deliberately no automated "pay the host the withheld amount"
// step here -- that has never existed anywhere in this codebase for
// damage claims, and inventing one silently would move money based on a
// host-entered number nobody has verified. An admin who approves a
// damage deduction transfers the host's compensation manually via the
// Stripe dashboard, the same way this was already described to hosts
// ("kontakter leietaker/utleier manuelt").
import Stripe from "npm:stripe@17";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { sendEmail, emailLayout } from "../_shared/email.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-06-20",
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

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

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userData.user.id)
      .single();
    if (profile?.role !== "admin") {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { bookingId, refundOre } = await req.json();
    if (!bookingId || typeof refundOre !== "number" || refundOre < 0) {
      return new Response(JSON.stringify({ error: "bookingId og refundOre (>= 0) er påkrevd" }), {
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
    if (booking.deposit_refunded) {
      return new Response(JSON.stringify({ error: "Depositumet er allerede behandlet for denne bookingen" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const depositAmountOre = Math.round(Number(booking.deposit_amount || 0) * 100);
    if (refundOre > depositAmountOre) {
      return new Response(JSON.stringify({ error: "Beløpet kan ikke overstige depositumet" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Atomically claim, same pattern as stripe-refund/stripe-release-payout --
    // prevents a double-click or two admin tabs from both issuing a refund.
    const { data: claimed, error: claimErr } = await supabase
      .from("bookings")
      .update({ deposit_refunded: true })
      .eq("id", bookingId)
      .eq("deposit_refunded", false)
      .select("id");
    if (claimErr) throw claimErr;
    if (!claimed || claimed.length === 0) {
      return new Response(JSON.stringify({ error: "Depositumet ble nettopp behandlet av en annen forespørsel." }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let refundId: string | null = null;
    if (refundOre > 0) {
      try {
        const refund = await stripe.refunds.create({
          payment_intent: booking.payment_intent_id,
          amount: refundOre,
          reason: "requested_by_customer",
          metadata: { booking_id: bookingId, type: "deposit_release_admin_resolved" },
        }, {
          idempotencyKey: `deposit-refund-admin-${bookingId}`,
        });
        refundId = refund.id;
      } catch (refundErr) {
        await supabase.from("bookings").update({ deposit_refunded: false }).eq("id", bookingId);
        throw refundErr;
      }
    }

    await supabase
      .from("bookings")
      .update({ deposit_refund_id: refundId })
      .eq("id", bookingId);

    try {
      const { data: listing } = await supabase.from("listings").select("title").eq("id", booking.listing_id).single();
      const title = listing?.title ?? "leieforholdet";
      const renterEmail = booking.renter
        ? (await supabase.auth.admin.getUserById(booking.renter)).data?.user?.email
        : booking.renter_email;
      if (renterEmail) {
        const refundKr = (refundOre / 100).toLocaleString("nb-NO") + " kr";
        const depositKr = (depositAmountOre / 100).toLocaleString("nb-NO") + " kr";
        await sendEmail(
          renterEmail,
          `Depositum behandlet — ${title}`,
          emailLayout(
            "Depositumet ditt er behandlet",
            refundOre === depositAmountOre
              ? `<p>Depositumet for <strong>${title}</strong> er refundert i sin helhet til betalingskortet ditt.</p><div class="info-box"><p><strong>Refundert:</strong> ${refundKr}</p></div>`
              : `<p>Etter gjennomgang av utleiers rapport er depositumet for <strong>${title}</strong> (${depositKr}) delvis eller ikke refundert.</p><div class="info-box"><p><strong>Refundert:</strong> ${refundKr} av ${depositKr}</p></div><p>Kontakt oss på kundeservice@oslocampingutleie.no hvis du har spørsmål om dette.</p>`,
          ),
        );
      }
    } catch (emailErr) {
      console.error("[admin-resolve-deposit] Email send failed:", emailErr);
    }

    return new Response(JSON.stringify({ resolved: true, refundedOre: refundOre }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

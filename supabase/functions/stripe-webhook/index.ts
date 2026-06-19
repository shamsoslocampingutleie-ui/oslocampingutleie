// Stripe webhook: marks bookings as paid, sends confirmation emails,
// and tracks host onboarding status.
// Deploy with --no-verify-jwt — Stripe calls this without a Supabase JWT.
// Configure this URL in the Stripe Dashboard webhook settings and listen for:
//   checkout.session.completed
//   account.updated
import Stripe from "npm:stripe@17";
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendEmail, emailLayout } from "../_shared/email.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-06-20",
});
const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const webhookSecretConnect = Deno.env.get("STRIPE_WEBHOOK_SECRET_CONNECT")!;

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function fmt(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("nb-NO", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function nok(amount: number): string {
  return Math.round(amount).toLocaleString("nb-NO") + " kr";
}

async function sendPaymentConfirmationEmails(bookingId: string, amountTotal: number, platformFee: number) {
  try {
    const { data: booking } = await supabase
      .from("bookings")
      .select("renter, host_id, listing_id, from_date, to_date")
      .eq("id", bookingId)
      .single();
    if (!booking) return;

    const { data: listing } = await supabase
      .from("listings")
      .select("title, price_per_day, deposit, cleaning_fee")
      .eq("id", booking.listing_id)
      .single();

    const [renterAuth, hostAuth] = await Promise.all([
      supabase.auth.admin.getUserById(booking.renter),
      supabase.auth.admin.getUserById(booking.host_id),
    ]);

    const renterEmail = renterAuth.data?.user?.email;
    const hostEmail = hostAuth.data?.user?.email;
    const title = listing?.title ?? "leieforholdet";
    const hostPayout = nok(amountTotal - platformFee);

    // Email to RENTER: payment confirmed
    if (renterEmail) {
      await sendEmail(
        renterEmail,
        `Betaling bekreftet — ${title}`,
        emailLayout(
          "Betaling bekreftet ✓",
          `<p>Takk! Betalingen din er mottatt og pengene holdes trygt av Leieplattform til begge parter har bekreftet overlevering.</p>
          <div class="info-box">
            <p><strong>Hva du leier:</strong> ${title}</p>
            <p><strong>Periode:</strong> ${fmt(booking.from_date)} – ${fmt(booking.to_date)}</p>
            <p><strong>Betalt totalt:</strong> ${nok(amountTotal)}</p>
          </div>
          <p><strong>Viktig:</strong> Etter at du har hentet og returnert utstyret må du bekrefte dette i appen. Depositumet frigjøres etter begge parters bekreftelse.</p>
          <a href="https://leieplattform.no" class="btn">Gå til Mine bookinger →</a>
          <div class="info-box">
            <p>Pengene overføres til utleier <strong>kun</strong> etter at dere begge har bekreftet overlevering i appen. Ingen betaling skjer uten din bekreftelse.</p>
          </div>`,
        ),
      );
    }

    // Email to HOST: booking is paid, waiting for handover
    if (hostEmail) {
      await sendEmail(
        hostEmail,
        `Ny betalt booking — ${title}`,
        emailLayout(
          "En booking er betalt og klar",
          `<p>En leietaker har betalt for <strong>${title}</strong>. Pengene holdes trygt av Leieplattform inntil dere begge bekrefter overlevering.</p>
          <div class="info-box">
            <p><strong>Utstyr:</strong> ${title}</p>
            <p><strong>Periode:</strong> ${fmt(booking.from_date)} – ${fmt(booking.to_date)}</p>
            <p><strong>Din utbetaling (etter gebyr):</strong> ${hostPayout}</p>
          </div>
          <p><strong>Hva du må gjøre:</strong></p>
          <ol style="color:#3D4A41;line-height:1.8;padding-left:20px;margin:0 0 14px">
            <li>Lever utstyret til leietaker på avtalt dato</li>
            <li>Klikk <strong>"Bekreft utlevering"</strong> i appen</li>
            <li>Etter at leietaker også bekrefter mottak → pengene utbetales til din Stripe-konto</li>
          </ol>
          <a href="https://leieplattform.no" class="btn">Gå til Mine bookinger →</a>
          <div class="info-box">
            <p>Har ingen av dere bekreftet innen 7 dager etter leieperiodens slutt, frigis utbetalingen automatisk.</p>
          </div>`,
        ),
      );
    }
  } catch (e) {
    console.error("[webhook] Email send failed:", e);
  }
}

Deno.serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature!,
      webhookSecret,
    );
  } catch (err) {
    try {
      event = await stripe.webhooks.constructEventAsync(
        body,
        signature!,
        webhookSecretConnect,
      );
    } catch {
      return new Response(`Webhook signature error: ${err}`, { status: 400 });
    }
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;

      // Listing boost payment
      if (session.metadata?.boost_type === "listing_boost") {
        const listingId = session.metadata.listing_id;
        const days = parseInt(session.metadata.boost_days || "7", 10);
        if (listingId) {
          const boostedUntil = new Date(Date.now() + days * 86400000).toISOString();
          await supabase
            .from("listings")
            .update({ boosted_until: boostedUntil })
            .eq("id", listingId);
        }
        break;
      }

      const bookingId = session.metadata?.booking_id;
      if (bookingId) {
        const piId = session.payment_intent as string | null;
        const amountTotal = (session.amount_total ?? 0) / 100;
        const platformFee =
          Number(session.metadata?.platform_fee_ore ?? session.amount_total ?? 0) /
          100;

        await supabase
          .from("bookings")
          .update({
            paid: true,
            payment_intent_id: piId || "",
            amount_total: amountTotal,
            platform_fee: platformFee,
            stripe_customer_details: session.customer_details ?? null,
          })
          .eq("id", bookingId);

        // Send confirmation emails to both parties
        await sendPaymentConfirmationEmails(bookingId, amountTotal, platformFee);
      }
      break;
    }
    case "account.updated": {
      const account = event.data.object as Stripe.Account;
      await supabase
        .from("profiles")
        .update({ stripe_charges_enabled: !!account.charges_enabled })
        .eq("stripe_account_id", account.id);
      break;
    }
    default:
      break;
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});

// Stripe webhook: marks bookings as paid and tracks host onboarding status.
// Deploy with --no-verify-jwt — Stripe calls this without a Supabase JWT.
// Configure this URL in the Stripe Dashboard webhook settings and listen for:
//   checkout.session.completed
//   account.updated
import Stripe from "npm:stripe@17";
import { createClient } from "npm:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-06-20",
});
const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const webhookSecretConnect = Deno.env.get("STRIPE_WEBHOOK_SECRET_CONNECT")!;

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

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
          })
          .eq("id", bookingId);
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

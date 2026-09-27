// Creates a Stripe Checkout Session for spin (29 NOK) or egg (19 NOK) game.
// All revenue goes to the platform — no connected account transfer.
import Stripe from "npm:stripe@17";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-06-20",
});

// Same open-redirect guard as stripe-checkout/guest-checkout/stripe-boost --
// see stripe-boost/index.ts for the full rationale. Without it, a
// renter paying for a spin/egg could be redirected to an external page
// right after a real Stripe payment.
function safeRedirect(url: unknown): string {
  const fallback = "https://leieplattform.no/";
  if (typeof url !== "string") return fallback;
  try {
    const u = new URL(url);
    if (u.origin === "https://leieplattform.no") return url;
  } catch { /* fall through */ }
  return fallback;
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

    const { type, lid, successUrl, cancelUrl } = await req.json();
    if (!type || !lid) {
      return new Response(
        JSON.stringify({ error: "type og lid er påkrevd" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Validate that the listing has the game feature enabled by the host
    const { data: listing, error: listingErr } = await supabase
      .from("listings")
      .select("spin_enabled, egg_enabled")
      .eq("id", lid)
      .single();
    if (listingErr || !listing) {
      return new Response(JSON.stringify({ error: "Annonse ikke funnet" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const isEgg = type === "egg";
    if (isEgg && !listing.egg_enabled) {
      return new Response(
        JSON.stringify({ error: "Egg-spillet er ikke aktivert for denne annonsen" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!isEgg && !listing.spin_enabled) {
      return new Response(
        JSON.stringify({ error: "Lykkehjulet er ikke aktivert for denne annonsen" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const amountOre = isEgg ? 1900 : 2900;
    const productName = isEgg
      ? "🥚 Egg-knekking — bonus rabatt"
      : "🎡 Lykkehjul-spinn — rabattkode";
    const productDesc = isEgg
      ? "Knekk et egg og vinn ekstra rabatt på leien din."
      : "Spinn lykkehjulet og vinn opptil 20% rabatt på leien.";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "nok",
            product_data: {
              name: productName,
              description: productDesc,
            },
            unit_amount: amountOre,
          },
          quantity: 1,
        },
      ],
      metadata: {
        spin_type: type,
        lid,
        user_id: userData.user.id,
      },
      success_url: safeRedirect(successUrl),
      cancel_url: safeRedirect(cancelUrl),
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

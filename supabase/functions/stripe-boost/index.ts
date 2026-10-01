// Creates a Stripe Checkout Session for a 90 NOK listing boost (7 days).
// On success the webhook marks listings.boosted_until = now + 7 days.
import Stripe from "npm:stripe@17";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rateLimit.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-06-20",
});

// Same open-redirect guard as stripe-checkout/guest-checkout's
// safeRedirect() -- missing here despite this function taking the exact
// same client-suppliable successUrl/cancelUrl and passing it straight
// to Stripe. A host boosting their own listing could be sent to an
// external phishing page immediately after a real 90 NOK Stripe payment
// if successUrl/cancelUrl were ever attacker-influenced (a crafted
// link/bookmarklet triggering the request while the host is logged in).
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

    if (!await checkRateLimit(req, 10, 300_000)) return rateLimitResponse(corsHeaders);

    const { listingId, successUrl, cancelUrl } = await req.json();
    if (!listingId) {
      return new Response(JSON.stringify({ error: "listingId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: listing, error: listingErr } = await supabase
      .from("listings")
      .select("id, title, owner, boosted_until")
      .eq("id", listingId)
      .single();

    if (listingErr || !listing) {
      return new Response(JSON.stringify({ error: "Listing not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (listing.owner !== userData.user.id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // hostListings() (src/app.html) already disables the boost button
    // while boosted_until is in the future -- that's only a client-side
    // safeguard, nothing stopped calling this function directly (or a
    // double-click race before the button disables) and paying 90 kr
    // again for a boost window that's already active. Not a fraud risk
    // against the platform, but a real way for a host to accidentally
    // pay themselves twice for the same thing.
    if (listing.boosted_until && new Date(listing.boosted_until) > new Date()) {
      return new Response(
        JSON.stringify({ error: "Annonsen er allerede fremhevet. Vent til perioden er over før du fremhever på nytt." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "nok",
            product_data: {
              name: `Annonseløft 7 dager — ${listing.title}`,
              description: "Annonsen vises øverst i søkeresultater i 7 dager.",
            },
            unit_amount: 9000,
          },
          quantity: 1,
        },
      ],
      metadata: {
        boost_type: "listing_boost",
        listing_id: listingId,
        boost_days: "7",
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

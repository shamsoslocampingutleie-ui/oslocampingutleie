// Creates (or reuses) a Stripe Express connected account for the
// logged-in host and returns a one-time onboarding link.
import Stripe from "npm:stripe@17";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (!STRIPE_SECRET_KEY) {
      return new Response(
        JSON.stringify({ error: "STRIPE_SECRET_KEY er ikke konfigurert i Supabase Edge Function secrets. Legg til nøkkelen i Supabase Dashboard → Project Settings → Edge Functions." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const stripe = new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: "2024-06-20",
    });
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

    const { returnUrl, refreshUrl } = await req.json().catch(() => ({}));
    const fallback = "https://oslocampingutleie.no/";

    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("stripe_account_id, email")
      .eq("id", userId)
      .single();
    if (profileErr || !profile) {
      return new Response(JSON.stringify({ error: "Profile not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let accountId = profile.stripe_account_id;
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        country: "NO",
        email: profile.email,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_type: "individual",
      });
      accountId = account.id;
      await supabase
        .from("profiles")
        .update({ stripe_account_id: accountId })
        .eq("id", userId);
    }

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl || fallback,
      return_url: returnUrl || fallback,
      type: "account_onboarding",
    });

    return new Response(JSON.stringify({ url: accountLink.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

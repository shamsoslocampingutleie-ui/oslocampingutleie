// Authoritative source: queries Stripe API directly (never DB).
// Called on ?stripe=done redirect to eliminate race condition with account.updated webhook.
import Stripe from "npm:stripe@17";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-06-20",
});

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const { data: { user }, error: authErr } = await supabase.auth.getUser(
    authHeader.replace("Bearer ", ""),
  );
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_account_id")
    .eq("id", user.id)
    .single();

  if (!profile?.stripe_account_id) {
    return new Response(
      JSON.stringify({ charges_enabled: false, reason: "no_account" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Query Stripe directly — authoritative, not DB
  const account = await stripe.accounts.retrieve(profile.stripe_account_id);
  const chargesEnabled = !!account.charges_enabled;

  // Write back to DB for consistency (idempotent)
  await supabase
    .from("profiles")
    .update({ stripe_charges_enabled: chargesEnabled })
    .eq("id", user.id);

  return new Response(
    JSON.stringify({
      charges_enabled: chargesEnabled,
      account_id: account.id,
      details_submitted: account.details_submitted,
      payouts_enabled: account.payouts_enabled,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});

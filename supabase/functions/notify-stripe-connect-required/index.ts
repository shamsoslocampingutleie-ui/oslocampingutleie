// Admin-triggered batch email: reminds hosts who have never completed
// Stripe Connect onboarding (or started it but never finished, i.e.
// stripe_charges_enabled is not true) that bookings on their listings
// are blocked until it's done -- see the same gap fixed server-side in
// stripe-checkout/guest-checkout (20260925: a host with no connected
// account could previously have a renter pay in full with no way to
// ever transfer that host's share out). This is the outreach half of
// that fix: tell the affected hosts directly, by email, not just via
// an in-app dashboard banner they might not see.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { sendEmail, emailLayout } from "../_shared/email.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rateLimit.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (!await checkRateLimit(req, 5, 60_000)) return rateLimitResponse(corsHeaders);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const { data: userData } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: callerProfile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userData.user.id)
      .single();
    if (callerProfile?.role !== "admin") {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { userIds } = await req.json();
    if (!Array.isArray(userIds) || !userIds.length) {
      return new Response(JSON.stringify({ error: "userIds required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Re-verify server-side which of the given ids actually still need
    // this -- never trust the caller's list alone, since it may be
    // stale by the time this runs.
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, email, stripe_account_id, stripe_charges_enabled")
      .in("id", userIds.slice(0, 50));

    const results: Record<string, string> = {};
    for (const p of profiles ?? []) {
      const stillNeedsIt = !p.stripe_account_id || p.stripe_charges_enabled !== true;
      if (!stillNeedsIt) {
        results[p.id] = "skipped_already_connected";
        continue;
      }
      if (!p.email) {
        results[p.id] = "skipped_no_email";
        continue;
      }
      const firstName = (p.full_name || "").split(" ")[0] || "der";
      await sendEmail(
        p.email,
        "Fullfør Stripe-oppsettet for å motta betalinger",
        emailLayout(
          "Fullfør Stripe-oppsettet ditt",
          `<p>Hei ${escapeName(firstName)},</p>
          <p>Vi ser at du har annonser på Leieplattform, men at Stripe-oppsettet ditt ikke er fullført ennå.</p>
          <div class="info-box"><p><strong>Konsekvens:</strong> uten et fullført Stripe-oppsett kan leietakere ikke betale for annonsene dine, og bookinger blir blokkert helt til dette er i orden.</p></div>
          <p>Det tar bare noen minutter å fullføre: gå til utleier-dashbordet ditt → Økonomi → «Fullfør Stripe-oppsett».</p>
          <a href="https://leieplattform.no/utleier" class="btn">Fullfør Stripe-oppsett →</a>
          <p>Har du spørsmål, ta gjerne kontakt i chatten på leieplattform.no.</p>`,
        ),
      );
      results[p.id] = "emailed";
    }

    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[notify-stripe-connect-required]", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function escapeName(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Creates a Stripe Checkout Session for spin (29 NOK) or egg (19 NOK) game.
//
// DISABLED. The spin/egg feature itself was deliberately and completely
// removed from the frontend in e8cc01e ("produksjon-overhaul — fjern
// rabattspill" -- ~38KB of code and CSS taken out, June 2026) as part
// of a production-readiness cleanup. This backend function was missed
// in that cleanup and stayed deployed and callable, even though:
//   1. Nothing in src/app.html links to it anymore (grepped: zero
//      references to stripe-spin, spin_type, spin_enabled, egg_enabled,
//      "Lykkehjul" anywhere in the live frontend).
//   2. The reward this would need to grant -- a discount code applied
//      at checkout -- was independently disabled in stripe-checkout
//      for its own, separate, still-valid reason ("Discount codes are
//      disabled: they were validated purely by a client-suppliable
//      regex/percentage with no server-side issuance or redemption
//      tracking... re-enable only once codes are backed by a real
//      table"). Nothing on this codebase's current write path could
//      have honored a win from this game even if someone reached it.
// So anyone who found this endpoint directly (its URL was never secret)
// could have paid 19-29 NOK real money via a real Stripe charge for a
// reward that literally cannot be delivered anywhere in the app.
// Deleting the function outright needs an irreversible-action approval
// this session doesn't have; disabled it here instead -- refuses to
// create a Stripe session at all, so no payment can ever be taken by
// it, while the code stays in place if this feature is ever
// deliberately rebuilt with a real discount-code backing (matching
// stripe-checkout's own "re-enable only once..." condition).
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve((req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  return new Response(
    JSON.stringify({
      error: "Denne funksjonen er ikke lenger tilgjengelig.",
    }),
    { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});

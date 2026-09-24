// Verifies a Norwegian organisasjonsnummer against the public
// Brønnøysundregistrene Enhetsregisteret (an authoritative government
// registry -- deterministic and free, so there's no reason to reach for
// an LLM guess here) and, when called with a logged-in user's token,
// persists the result onto that user's own profile.
//
// Called in two contexts:
//  1. Unauthenticated, from the registration form, purely as a live
//     preview before the account even exists yet (no apikey/Authorization
//     bearer -- Supabase's gateway still requires the anon apikey header,
//     same as guest-checkout). Nothing is written to the database.
//  2. Authenticated (Authorization: Bearer <user JWT>), either right
//     after a new company account's first login or from the profile page
//     when adding/updating company info. This branch re-runs the exact
//     same check server-side (never trusts a client claim that step 1
//     already passed) and, only if it independently verifies, writes
//     account_type/company_name/org_number/org_verified=true using the
//     service role. See protect_profile_fields() in the matching
//     migration for why org_verified can never be set any other way.
//  3. Authenticated AND admin, with a target_user_id: same as (2) but
//     writes onto that other user's profile instead of the caller's own
//     -- for the admin "Endre bruker" panel switching an existing
//     account between private/company. Still always re-verifies against
//     Brreg itself first; target_user_id is silently ignored (falls back
//     to self) for a non-admin caller, so this can never be used to write
//     to someone else's profile without an admin token.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rateLimit.ts";

function err(status: number, msg: string) {
  return new Response(JSON.stringify({ valid: false, error: msg }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Norwegian organisasjonsnummer check digit (MOD11) -- the same algorithm
// Brønnøysundregistrene itself uses. Rejects obviously-fake/mistyped
// numbers before spending a request on their API.
function validChecksum(n: string): boolean {
  if (!/^\d{9}$/.test(n)) return false;
  const w = [3, 2, 7, 6, 5, 4, 3, 2];
  const d = n.split("").map(Number);
  const sum = w.reduce((s, wi, i) => s + wi * d[i], 0);
  const rem = sum % 11;
  const check = rem === 0 ? 0 : 11 - rem;
  return check !== 10 && check === d[8];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err(405, "Method not allowed");
  // Reachable without login (registration-time preview), so IP rate
  // limiting is the only thing stopping it being used to hammer Brreg's
  // API or scrape company data through this proxy.
  if (!await checkRateLimit(req, 10, 300_000)) return rateLimitResponse(corsHeaders);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err(400, "Ugyldig JSON");
  }

  const raw = String(body.org_number ?? "").replace(/\s+/g, "");
  if (!validChecksum(raw)) {
    return err(400, "Ugyldig organisasjonsnummer (feil sjekksum).");
  }

  let brreg: Record<string, unknown>;
  try {
    const r = await fetch(`https://data.brreg.no/enhetsregisteret/api/enheter/${raw}`);
    if (r.status === 404) {
      return err(404, "Fant ikke organisasjonsnummeret i Brønnøysundregistrene.");
    }
    if (!r.ok) {
      return err(502, "Kunne ikke slå opp organisasjonsnummeret akkurat nå. Prøv igjen.");
    }
    brreg = await r.json();
  } catch (e) {
    console.error("[verify-org-number] brreg lookup failed:", e);
    return err(502, "Kunne ikke slå opp organisasjonsnummeret akkurat nå. Prøv igjen.");
  }

  if (brreg.slettedato) {
    return err(400, "Dette organisasjonsnummeret er avviklet i Brønnøysundregistrene.");
  }

  const name = String(brreg.navn ?? "").trim();
  const orgFormObj = brreg.organisasjonsform as Record<string, unknown> | undefined;
  const orgForm = orgFormObj?.beskrivelse ?? null;

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (token) {
    try {
      const sb = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const { data: userData } = await sb.auth.getUser(token);
      if (userData?.user) {
        let writeId = userData.user.id;
        const requestedTarget = typeof body.target_user_id === "string" ? body.target_user_id : null;
        if (requestedTarget && requestedTarget !== userData.user.id) {
          const { data: callerProfile } = await sb
            .from("profiles")
            .select("role")
            .eq("id", userData.user.id)
            .maybeSingle();
          // Only an admin caller may target someone else's profile --
          // anyone else's target_user_id is silently ignored and this
          // just verifies/persists onto their own account instead, same
          // as if they hadn't sent it at all.
          if (callerProfile?.role === "admin") writeId = requestedTarget;
        }
        await sb.from("profiles").update({
          account_type: "company",
          company_name: name,
          org_number: raw,
          org_verified: true,
        }).eq("id", writeId);
      }
    } catch (e) {
      console.error("[verify-org-number] persist failed:", e);
      // Fall through and still return the lookup result -- the client
      // can retry the save even if this write failed.
    }
  }

  return new Response(JSON.stringify({
    valid: true,
    org_number: raw,
    name,
    org_form: orgForm,
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

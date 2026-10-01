// Verifies a Google reCAPTCHA v2 ("I'm not a robot" checkbox) token
// server-side before registration is allowed to proceed. Called from
// authRegister() (src/app.html) BEFORE sb.auth.signUp() -- the client
// widget alone only stops bots that don't bother executing the page's
// JS; this is the actual gate, since the secret key (and therefore the
// real verification) can only live server-side.
//
// Not a Postgres "Before User Created" Auth Hook: that would need the
// synchronous `http` extension (this project only has the async
// `pg_net`, used everywhere else for fire-and-forget cron calls), and
// a mistake in an Auth Hook risks breaking ALL registration with no
// easy way to verify it live before enabling it. This is the same,
// already-proven pattern as every other edge function in this project
// (verify-license, verify-org-number) -- a pre-flight check the client
// calls first, testable in isolation, that can't take down signUp()
// itself if something's wrong with it.
//
// Not airtight: a determined attacker could skip this entirely and
// call sb.auth.signUp() directly against Supabase's API. That's a real
// limitation of this approach, same as most reCAPTCHA integrations
// that don't invest in a full Auth Hook. Realistic threat model here
// (a Norwegian rental marketplace) is cheap/simple bot scripts hitting
// the public form, not a targeted attacker reverse-engineering the API
// -- this stops that class of abuse.
import { corsHeaders } from "../_shared/cors.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rateLimit.ts";

const RECAPTCHA_SECRET_KEY = Deno.env.get("RECAPTCHA_SECRET_KEY") ?? "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  // No session exists yet at this point (this runs before signUp()), so
  // rate limit by IP alone -- same as every other pre-auth public
  // endpoint in this project (campaign-submit, mobile-upload).
  if (!await checkRateLimit(req, 10, 60_000)) return rateLimitResponse(corsHeaders);

  try {
    if (!RECAPTCHA_SECRET_KEY) {
      // Fail closed -- if the secret was never configured, treat every
      // attempt as unverified rather than silently letting everyone
      // through (which would make this whole feature a no-op no one
      // would notice was broken).
      return new Response(JSON.stringify({ success: false, error: "not_configured" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { token } = await req.json();
    if (!token || typeof token !== "string") {
      return new Response(JSON.stringify({ success: false, error: "missing_token" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const verifyRes = await fetch("https://www.google.com/recaptcha/api/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: RECAPTCHA_SECRET_KEY, response: token }),
    });
    const verifyJson = await verifyRes.json().catch(() => ({ success: false }));

    return new Response(JSON.stringify({ success: !!verifyJson.success }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[verify-recaptcha]", err);
    // Fail closed here too -- an unexpected error means we couldn't
    // confirm the token is real, so don't treat it as verified.
    return new Response(JSON.stringify({ success: false, error: "internal_error" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

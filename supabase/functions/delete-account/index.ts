// Self-service account deletion. Found missing during a master-prompt
// review (§26, "sletting av konto"): the only path was "contact an
// admin in chat", who deletes manually on request.
//
// The actual anonymize-in-place logic lives in
// ../_shared/anonymizeAccount.ts -- shared with admin-delete-user,
// see that file's header for the full cascade-delete risk this avoids.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rateLimit.ts";
import { anonymizeAccount } from "../_shared/anonymizeAccount.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (!await checkRateLimit(req, 5, 300_000)) return rateLimitResponse(corsHeaders);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const { data: userData, error: userErr } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Always the caller's own account -- never accept a client-supplied
    // target id for a destructive action like this.
    const userId = userData.user.id;

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .single();
    if (profile?.role === "admin") {
      return new Response(
        JSON.stringify({ error: "Adminkontoer kan ikke slettes selv. Kontakt en annen administrator." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const result = await anonymizeAccount(supabase, userId);
    if (!result.ok) {
      return new Response(
        JSON.stringify({ error: result.error, blockedCount: result.blockedCount }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[delete-account]", err);
    await supabase.from("error_logs").insert({
      message: "[delete-account] Unhandled failure",
      stack: String(err).slice(0, 4000),
      url: "edge-function:delete-account",
      user_agent: "server",
    }).catch(() => {});
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

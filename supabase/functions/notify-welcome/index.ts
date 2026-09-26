// Sends a welcome email right after a successful signup. Found missing
// during a "first 5 minutes" review (master-prompt §26): handle_new_user()
// creates the profile row and logs the registration, but nothing ever
// emailed the new user anything beyond Supabase's own built-in
// "confirm your email" message -- no welcome, no pointer to what to do
// next. Called directly from authRegister() right after sb.auth.signUp()
// succeeds (not from the DB trigger -- that would need the service-role
// secret embedded in a migration, which this project deliberately never
// does; every existing cron job's equivalent secret was set up live,
// never committed). Best-effort: never blocks or fails signup itself.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { sendEmail, emailLayout, escapeHtml } from "../_shared/email.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rateLimit.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  // Generous but bounded -- this fires once per real signup, never
  // meant to be called in a loop.
  if (!await checkRateLimit(req, 20, 60_000)) return rateLimitResponse(corsHeaders);

  try {
    const { email, fullName } = await req.json();
    if (!email || typeof email !== "string") {
      return new Response(JSON.stringify({ error: "email required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const firstName = (fullName || "").trim().split(" ")[0] || "der";

    await sendEmail(
      email,
      "Velkommen til Leieplattform! 🎉",
      emailLayout(
        "Velkommen, " + escapeHtml(firstName) + "! 🎉",
        `<p>Bra å ha deg med på Leieplattform — Norges markedsplass for utleie av campingvogn, bobil, båt, bil, tilhenger, verktøy og fritidsutstyr.</p>
        <p>Husk å bekrefte e-postadressen din via lenken vi nettopp sendte, så er kontoen din klar.</p>
        <div class="info-box"><p><strong>Kom i gang:</strong><br>
        🔍 Finn noe å leie — bla gjennom annonser i ditt område<br>
        💰 Har du utstyr som står ubrukt? Legg det ut gratis — 0 % plattformgebyr det første året</p></div>
        <a href="https://leieplattform.no" class="btn">Utforsk Leieplattform →</a>
        <p>Har du spørsmål, er vi bare en chat unna — vi svarer normalt innen én virkedag.</p>`,
      ),
    );

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[notify-welcome]", err);
    // Never fail the caller over an email hiccup.
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

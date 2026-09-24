import { createClient } from "npm:@supabase/supabase-js@2";
import { checkRateLimit, rateLimitResponse } from "../_shared/rateLimit.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, apikey, authorization",
  "Content-Type": "application/json",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  // Fully public, no auth -- the per-email uniqueness check below stops a
  // repeat submission from the same address, but nothing previously
  // stopped a burst of inserts (junk campaign_entries rows, or using the
  // 409 "already registered" response to enumerate whether a specific
  // email entered) using a fresh email each time.
  if (!await checkRateLimit(req, 5, 300_000)) return rateLimitResponse(CORS);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    null;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Ugyldig forespørsel." }), { status: 400, headers: CORS });
  }

  const { name, email, predictedHome, predictedAway } = body as {
    name?: string;
    email?: string;
    predictedHome?: number;
    predictedAway?: number;
  };

  // Validate fields
  if (!name || typeof name !== "string" || name.trim().length < 2) {
    return new Response(JSON.stringify({ error: "Fyll inn et gyldig navn (minst 2 tegn)." }), { status: 400, headers: CORS });
  }
  if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return new Response(JSON.stringify({ error: "Fyll inn en gyldig e-postadresse." }), { status: 400, headers: CORS });
  }
  const home = Number(predictedHome);
  const away = Number(predictedAway);
  if (!Number.isInteger(home) || home < 0 || home > 20) {
    return new Response(JSON.stringify({ error: "Ugyldig målscore for Norge (0–20)." }), { status: 400, headers: CORS });
  }
  if (!Number.isInteger(away) || away < 0 || away > 20) {
    return new Response(JSON.stringify({ error: "Ugyldig målscore for Brasil (0–20)." }), { status: 400, headers: CORS });
  }

  // Check campaign is open
  const { data: config } = await sb.from("campaign_config").select("enabled, competition_open").eq("id", 1).single();
  if (!config?.enabled || !config?.competition_open) {
    return new Response(JSON.stringify({ error: "Konkurransen er ikke åpen." }), { status: 403, headers: CORS });
  }

  // Check for duplicate email
  const { data: existing } = await sb
    .from("campaign_entries")
    .select("id")
    .eq("email", email.trim().toLowerCase())
    .maybeSingle();
  if (existing) {
    return new Response(JSON.stringify({ error: "Denne e-postadressen er allerede påmeldt. Kun én deltakelse per person." }), { status: 409, headers: CORS });
  }

  // Insert entry
  const { error: insertError } = await sb.from("campaign_entries").insert({
    name: name.trim(),
    email: email.trim().toLowerCase(),
    predicted_home: home,
    predicted_away: away,
    ip_address: ip,
  });

  if (insertError) {
    if (insertError.code === "23505") {
      return new Response(JSON.stringify({ error: "Denne e-postadressen er allerede påmeldt." }), { status: 409, headers: CORS });
    }
    console.error("[campaign-submit] insert error:", insertError);
    return new Response(JSON.stringify({ error: "Noe gikk galt. Prøv igjen." }), { status: 500, headers: CORS });
  }

  // Log
  await sb.from("campaign_admin_log").insert({
    action: "entry_submitted",
    performed_by: email.trim().toLowerCase(),
    ip_address: ip,
    details: { name: name.trim(), predicted_home: home, predicted_away: away },
  }).then(() => {}, () => {});

  return new Response(JSON.stringify({ ok: true, message: "Takk for din deltakelse! Du er nå med i trekningen." }), { headers: CORS });
});

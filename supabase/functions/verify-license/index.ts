import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { sendEmail } from "../_shared/email.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rateLimit.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });
const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") ?? "kundeservice@oslocampingutleie.no";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!checkRateLimit(req, 5, 60_000)) return rateLimitResponse();

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
  if (authErr || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const { imageUrl, type = "license" } = await req.json();
    if (!imageUrl || typeof imageUrl !== "string") return new Response(JSON.stringify({ error: "imageUrl required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) return new Response(JSON.stringify({ error: "Could not fetch image" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const contentType = imgRes.headers.get("content-type") || "image/jpeg";
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    const mediaType = (allowed.includes(contentType) ? contentType : "image/jpeg") as "image/jpeg" | "image/png" | "image/webp" | "image/gif";
    const buffer = await imgRes.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));

    const isIdentity = type === "identity";

    const prompt = isIdentity
      ? `Du er et dokumentverifiseringssystem. Analyser dette bildet og avgjør om det er et gyldig identitetsdokument.

Godkjente dokumenter:
- Nasjonalt ID-kort (fra hvilket som helst land)
- Pass
- Offisielt brev eller dokument som inneholder personens fulle navn og adresse (bankbrev, offentlig brev, fakturaer fra offentlige etater)
- Oppholdstillatelse eller annet offentlig ID-dokument

IKKE godkjent: bilder av personer, selfies, tilfeldige bilder, kvitteringer, uoffisielle dokumenter.

Svar KUN med gyldig JSON:
{
  "isValid": true or false,
  "documentType": "kort type beskrivelse på norsk, eller null",
  "confidence": "high", "medium", or "low",
  "reason": "én setning på norsk"
}`
      : `You are a document verification system. Analyze this image and determine if it is a valid European driver's license.
European countries include all EU member states plus Norway, Iceland, Liechtenstein, Switzerland, UK, Serbia, Montenegro, Albania, North Macedonia, Bosnia, Moldova and other European nations.
Respond ONLY with valid JSON:
{
  "isDriversLicense": true or false,
  "isEuropean": true or false,
  "country": "country name in Norwegian, or null",
  "confidence": "high", "medium", or "low",
  "reason": "one sentence in Norwegian"
}`;

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 300,
      messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: mediaType, data: base64 } }, { type: "text", text: prompt }] }],
    });

    const rawText = message.content[0].type === "text" ? message.content[0].text.trim() : "";
    let result: Record<string, unknown>;
    try { result = JSON.parse(rawText); }
    catch { return new Response(JSON.stringify({ error: "Analyse feilet, prøv igjen." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }

    const verified = isIdentity
      ? result.isValid === true && (result.confidence === "high" || result.confidence === "medium")
      : result.isDriversLicense === true && result.isEuropean === true && (result.confidence === "high" || result.confidence === "medium");

    // Hent brukerinfo for admin-varselet
    const { data: profile } = await supabase.from("profiles").select("full_name, email").eq("id", user.id).single();

    // Lagre resultat + doc_type + AI-verdict (admin_reviewed = false = trenger gjennomgang)
    await supabase.from("profiles").update({
      drivers_license_verified: verified,
      drivers_license_ai_result: verified,
      drivers_license_admin_reviewed: false,
      drivers_license_doc_type: type,
      drivers_license_country: (result.country ?? result.documentType ?? null) as string | null,
    }).eq("id", user.id);

    // Send e-post til admin
    const docLabel = isIdentity ? "ID-dokument" : "Førerkort";
    const aiLabel = verified ? "✅ Godkjent av AI" : "❌ Avvist av AI";
    const userName = profile?.full_name || profile?.email || user.email || user.id;
    const adminUrl = "https://leieplattform.no/app.html#admin";

    await sendEmail(
      ADMIN_EMAIL,
      `NY ID-opplasting: ${userName} — ${aiLabel}`,
      `<!DOCTYPE html><html lang="nb"><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#F0F4F0;font-family:sans-serif;">
<table cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#F0F4F0;"><tr><td align="center" style="padding:32px 16px;">
<table cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:520px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.08);">
<tr><td style="background:#14512E;padding:20px 28px;"><span style="font-size:18px;font-weight:800;color:#fff;">Oslo Camping Utleie — Admin</span></td></tr>
<tr><td style="padding:28px;">
<h2 style="margin:0 0 16px;font-size:20px;color:#14512E;">Ny ID-opplasting krever gjennomgang</h2>
<table cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#F6FAF7;border-radius:12px;padding:16px;margin-bottom:20px;">
<tr><td style="padding:4px 0;font-size:14px;color:#3D4A41;"><b>Bruker:</b> ${userName}</td></tr>
<tr><td style="padding:4px 0;font-size:14px;color:#3D4A41;"><b>E-post:</b> ${profile?.email || user.email}</td></tr>
<tr><td style="padding:4px 0;font-size:14px;color:#3D4A41;"><b>Dokumenttype:</b> ${docLabel}</td></tr>
<tr><td style="padding:4px 0;font-size:14px;color:#3D4A41;"><b>AI-vurdering:</b> ${aiLabel} (${result.confidence || "?"})</td></tr>
<tr><td style="padding:4px 0;font-size:14px;color:#3D4A41;"><b>Grunn (AI):</b> ${result.reason || "-"}</td></tr>
</table>
<p style="margin:0 0 8px;font-size:14px;color:#3D4A41;">Se bildet og godkjenn eller avvis i admin-panelet:</p>
<table cellspacing="0" cellpadding="0" border="0"><tr><td style="background:#14512E;border-radius:999px;">
<a href="${adminUrl}" style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:700;color:#fff;text-decoration:none;border-radius:999px;">→ Gå til admin-panel</a>
</td></tr></table>
</td></tr>
<tr><td style="background:#F6FAF7;border-top:1px solid #E8EDE8;padding:16px 28px;text-align:center;">
<p style="margin:0;font-size:12px;color:#9BA8A0;">Oslo Camping Utleie · <a href="mailto:kundeservice@oslocampingutleie.no" style="color:#14512E;">kundeservice@oslocampingutleie.no</a></p>
</td></tr>
</table></td></tr></table></body></html>`
    ).catch(e => console.warn("[verify-license] Admin email failed:", e));

    return new Response(
      JSON.stringify({ verified, country: result.country ?? null, documentType: result.documentType ?? null, reason: result.reason, confidence: result.confidence }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[verify-license]", err);
    return new Response(JSON.stringify({ error: "Intern feil, prøv igjen." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

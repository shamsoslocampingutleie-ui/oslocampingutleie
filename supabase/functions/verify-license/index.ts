import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rateLimit.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const anthropic = new Anthropic({
  apiKey: Deno.env.get("ANTHROPIC_API_KEY")!,
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!checkRateLimit(req, 5, 60_000)) return rateLimitResponse();

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: { user }, error: authErr } = await supabase.auth.getUser(
    authHeader.replace("Bearer ", ""),
  );
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { imageUrl, type = "license" } = await req.json();
    if (!imageUrl || typeof imageUrl !== "string") {
      return new Response(JSON.stringify({ error: "imageUrl required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) {
      return new Response(JSON.stringify({ error: "Could not fetch image" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const contentType = imgRes.headers.get("content-type") || "image/jpeg";
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    const mediaType = allowed.includes(contentType) ? contentType : "image/jpeg";
    const buffer = await imgRes.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));

    const isIdentityCheck = type === "identity";

    const prompt = isIdentityCheck
      ? `Du er et dokumentverifiseringssystem. Analyser dette bildet og avgjør om det er et gyldig identitetsdokument.

Godkjente dokumenter:
- Nasjonalt ID-kort (fra hvilket som helst land)
- Pass
- Offisielt brev eller dokument som inneholder personens fulle navn og adresse (f.eks. bankbrev, offentlig brev, fakturaer fra offentlige etater)
- Oppholdstillatelse eller annet offentlig ID-dokument

IKKE godkjent: bilder av personer, selfies, tilfeldige bilder, kvitteringer, uoffisielle dokumenter.

Svar KUN med gyldig JSON — ingen markdown, ingen forklaring:
{
  "isValid": true or false,
  "documentType": "kort type beskrivelse på norsk, eller null",
  "confidence": "high", "medium", or "low",
  "reason": "én setning på norsk som forklarer avgjørelsen"
}`
      : `You are a document verification system. Analyze this image and determine if it is a valid European driver's license.

European countries include all EU member states plus Norway, Iceland, Liechtenstein, Switzerland, United Kingdom, Serbia, Montenegro, Albania, North Macedonia, Bosnia and Herzegovina, Moldova, and other European nations.

Respond ONLY with valid JSON — no markdown, no explanation:
{
  "isDriversLicense": true or false,
  "isEuropean": true or false,
  "country": "country name in Norwegian, or null",
  "confidence": "high", "medium", or "low",
  "reason": "one sentence in Norwegian explaining the decision"
}`;

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
                data: base64,
              },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
    });

    const rawText = message.content[0].type === "text" ? message.content[0].text.trim() : "";
    let result: Record<string, unknown>;
    try {
      result = JSON.parse(rawText);
    } catch {
      console.error("[verify-license] Claude returned non-JSON:", rawText);
      return new Response(
        JSON.stringify({ error: "Analyse feilet, prøv igjen." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let verified: boolean;
    if (isIdentityCheck) {
      verified = result.isValid === true &&
        (result.confidence === "high" || result.confidence === "medium");
    } else {
      verified = result.isDriversLicense === true && result.isEuropean === true &&
        (result.confidence === "high" || result.confidence === "medium");
    }

    await supabase.from("profiles").update({
      drivers_license_verified: verified,
      drivers_license_country: (result.country ?? result.documentType ?? null) as string | null,
    }).eq("id", user.id);

    return new Response(
      JSON.stringify({
        verified,
        country: result.country ?? null,
        documentType: result.documentType ?? null,
        reason: result.reason,
        confidence: result.confidence,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[verify-license]", err);
    return new Response(
      JSON.stringify({ error: "Intern feil, prøv igjen." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

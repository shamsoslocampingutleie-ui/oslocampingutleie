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
    const { imageUrl } = await req.json();
    if (!imageUrl || typeof imageUrl !== "string") {
      return new Response(JSON.stringify({ error: "imageUrl required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch the image and convert to base64
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

    // Ask Claude to verify the license
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
            {
              type: "text",
              text: `You are a document verification system. Analyze this image and determine if it is a valid European driver's license.

European countries include all EU member states (Austria, Belgium, Bulgaria, Croatia, Cyprus, Czech Republic, Denmark, Estonia, Finland, France, Germany, Greece, Hungary, Ireland, Italy, Latvia, Lithuania, Luxembourg, Malta, Netherlands, Poland, Portugal, Romania, Slovakia, Slovenia, Spain, Sweden), plus Norway, Iceland, Liechtenstein, Switzerland, United Kingdom, Serbia, Montenegro, Albania, North Macedonia, Bosnia and Herzegovina, Moldova, and other European nations.

Respond ONLY with valid JSON — no markdown, no explanation:
{
  "isDriversLicense": true or false,
  "isEuropean": true or false,
  "country": "country name in Norwegian, or null",
  "confidence": "high", "medium", or "low",
  "reason": "one sentence in Norwegian explaining the decision"
}`,
            },
          ],
        },
      ],
    });

    const rawText = message.content[0].type === "text" ? message.content[0].text.trim() : "";
    let result: {
      isDriversLicense: boolean;
      isEuropean: boolean;
      country: string | null;
      confidence: string;
      reason: string;
    };
    try {
      result = JSON.parse(rawText);
    } catch {
      console.error("[verify-license] Claude returned non-JSON:", rawText);
      return new Response(
        JSON.stringify({ error: "Analyse feilet, prøv igjen." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const verified = result.isDriversLicense === true && result.isEuropean === true &&
      (result.confidence === "high" || result.confidence === "medium");

    // Update profile
    await supabase.from("profiles").update({
      drivers_license_verified: verified,
      drivers_license_country: result.country ?? null,
    }).eq("id", user.id);

    return new Response(
      JSON.stringify({
        verified,
        country: result.country,
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

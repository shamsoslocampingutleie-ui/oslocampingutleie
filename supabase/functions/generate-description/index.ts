import { corsHeaders } from "../_shared/cors.ts";

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const { title, category, specs, location, price } = await req.json().catch(() => ({}));
  if (!title) return new Response(JSON.stringify({ error: "title required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  if (!ANTHROPIC_KEY) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY ikke satt" }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const prompt = `Skriv en kort, engasjerende norsk utleieannonse-beskrivelse (2-3 setninger, maks 200 ord) for følgende:
Tittel: ${title}
Kategori: ${category || "utleie"}
Sted: ${location || "Norge"}
Pris: ${price ? price + " kr/dag" : "ikke oppgitt"}
Egenskaper: ${specs || "ikke oppgitt"}

Beskriv hva utleiegjenstanden tilbyr leietakeren. Vær konkret, vennlig og tillitsvekkende. Ikke bruk kunstig jargon. Skriv kun beskrivelsen, ingen tittel eller ekstra tekst.`;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!r.ok) {
    const err = await r.text();
    console.error("[gen-desc] Anthropic error:", err);
    return new Response(JSON.stringify({ error: "AI-tjeneste utilgjengelig" }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const data = await r.json();
  const description = data.content?.[0]?.text?.trim() ?? "";

  return new Response(JSON.stringify({ description }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

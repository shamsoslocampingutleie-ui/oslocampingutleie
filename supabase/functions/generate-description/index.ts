import { corsHeaders } from "../_shared/cors.ts";

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

// Replace visually similar Cyrillic characters with Latin equivalents
function sanitizeCyrillic(text: string): string {
  const map: Record<string, string> = {
    "а": "a", "А": "A", // а А
    "е": "e", "Е": "E", // е Е
    "о": "o", "О": "O", // о О
    "р": "r", "Р": "R", // р Р
    "с": "c", "С": "C", // с С
    "х": "x", "Х": "X", // х Х
    "у": "u", "У": "U", // у У
    "і": "i", "І": "I", // і І
    "п": "p", "П": "P", // п П
    "в": "b", "В": "B", // в В (close enough)
    "т": "t", "Т": "T", // т Т
    "й": "u", "Й": "U", // й Й
    "к": "k", "К": "K", // к К
    "м": "m", "М": "M", // м М
    "и": "u", "И": "U", // и И
    "н": "n", "Н": "N", // н Н
    "́": "",                  // combining acute accent
  };
  return text.split("").map(ch => map[ch] ?? ch).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const { title, category, specs, location, price } = await req.json().catch(() => ({}));
  if (!title) return new Response(JSON.stringify({ error: "title required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  if (!ANTHROPIC_KEY) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY ikke satt" }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const systemPrompt = `Du er en profesjonell norsk tekstforfatter som skriver korte, engasjerende utleieannonser.

Regler:
- Korrekt norsk bokmål, ingen skrivefeil
- Kun standard latinske bokstaver — aldri kyrilliske, greske eller andre tegnsett
- Riktig bøyning (bestemt entall: maskinen, campingvognen, bobilen)
- 2–4 setninger, maks 180 ord
- Konkret og vennlig tone, ingen klisjeer
- Fremhev de viktigste egenskapene naturlig
- Kun beskrivelsesteksten — ingen tittel eller ekstra tekst`;

  const userPrompt = `Tittel: ${title}
Kategori: ${category || "utleie"}
Sted: ${location || "Norge"}
Pris: ${price ? price + " kr/dag" : "ikke oppgitt"}
Egenskaper: ${specs || "ikke oppgitt"}`;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 350,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!r.ok) {
    const err = await r.text();
    console.error("[gen-desc] Anthropic error:", err);
    return new Response(JSON.stringify({ error: "AI-tjeneste utilgjengelig" }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const data = await r.json();
  const raw = data.content?.[0]?.text?.trim() ?? "";
  const description = sanitizeCyrillic(raw);

  return new Response(JSON.stringify({ description }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

// Public, no-login-required unsubscribe link for marketing email
// (see send-newsletter). GET /unsubscribe?u=<userId>&t=<token>.
// Deployed with verify_jwt=false -- this must work for someone who
// clicked a link in their email client, who has no Supabase session.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyUnsubToken } from "../_shared/unsubToken.ts";

function page(title: string, message: string): Response {
  const html = `<!DOCTYPE html><html lang="nb"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — Leieplattform</title>
<style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#FBFAF7;color:#15201A;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
.card{max-width:420px;background:#fff;border-radius:16px;padding:36px 32px;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,.08)}
h1{color:#14512E;font-size:20px;margin:0 0 12px}p{color:#3D4A41;line-height:1.6;margin:0 0 20px}
a{display:inline-block;background:#14512E;color:#fff;padding:12px 24px;border-radius:999px;text-decoration:none;font-weight:700;font-size:14px}</style>
</head><body><div class="card"><h1>${title}</h1><p>${message}</p><a href="https://leieplattform.no">Til forsiden</a></div></body></html>`;
  return new Response(html, { headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const userId = url.searchParams.get("u") ?? "";
  const token = url.searchParams.get("t") ?? "";

  if (!(await verifyUnsubToken(userId, token))) {
    return page("Ugyldig lenke", "Denne avmeldingslenken er ugyldig eller utløpt. Kontakt oss i chatten på leieplattform.no hvis du fortsatt mottar e-post du ikke ønsker.");
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    await supabase.from("profiles").update({ marketing_consent: false }).eq("id", userId);
    return page("Du er avmeldt", "Du vil ikke lenger motta nyhetsbrev fra Leieplattform. Du får fortsatt viktige e-poster knyttet til dine egne bookinger og annonser.");
  } catch (err) {
    console.error("[unsubscribe]", err);
    return page("Noe gikk galt", "Klarte ikke å behandle avmeldingen akkurat nå. Prøv igjen senere, eller kontakt oss i chatten.");
  }
});

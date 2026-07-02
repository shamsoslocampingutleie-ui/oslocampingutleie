import { createClient } from "npm:@supabase/supabase-js@2";
import { sendEmail, emailLayout } from "../_shared/email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: corsHeaders });
  }

  let body: { email?: string; redirect_to?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: corsHeaders });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return new Response(JSON.stringify({ error: "Ugyldig e-postadresse." }), { status: 400, headers: corsHeaders });
  }

  const redirectTo = body.redirect_to ?? "https://leieplattform.no";

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Check if user exists (do NOT reveal if they don't — always return success)
  const { data: link, error: linkErr } = await sb.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo },
  });

  if (!linkErr && link?.properties?.action_link) {
    const resetUrl = link.properties.action_link;
    const html = emailLayout("Tilbakestill passord", `
      <p>Vi mottok en forespørsel om å tilbakestille passordet for din konto på Leieplattform.</p>
      <p>Klikk på knappen under for å sette et nytt passord. Lenken er gyldig i 60 minutter.</p>
      <a class="btn" href="${resetUrl}">Sett nytt passord →</a>
      <p style="font-size:13px;color:#888;margin-top:16px">Hvis du ikke ba om dette, kan du ignorere denne e-posten. Passordet ditt forblir uendret.</p>
    `);

    try {
      await sendEmail(email, "Tilbakestill passordet ditt – Leieplattform", html);
    } catch (e) {
      console.error("[send-reset-email] Resend error:", e);
      // Still return success so we don't reveal account existence
    }
  } else if (linkErr) {
    console.warn("[send-reset-email] generateLink error (silent):", linkErr.message);
    // User may not exist — return success anyway (security: don't reveal)
  }

  // Always return success (security: don't reveal if email is registered)
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

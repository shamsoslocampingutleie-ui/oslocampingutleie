import { Webhook } from "npm:standardwebhooks@1.0.0";
import { sendEmail, emailLayout } from "../_shared/email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Set via `supabase secrets set SEND_EMAIL_HOOK_SECRET=...` using the secret
// shown when enabling Authentication -> Hooks -> Send Email in the Supabase
// dashboard. Until it's set, requests are accepted unverified (so email
// keeps working) but a warning is logged on every call.
const hookSecret = Deno.env.get("SEND_EMAIL_HOOK_SECRET");

// Supabase Auth Hooks require hook errors in this exact shape to surface a
// real message to the client — anything else (e.g. a plain `{error: "..."}`)
// gets swallowed and the caller sees an empty error / "{}".
function hookError(httpCode: number, message: string): Response {
  return new Response(JSON.stringify({ error: { http_code: httpCode, message } }), {
    status: httpCode,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const rawBody = await req.text();

  if (hookSecret) {
    try {
      new Webhook(hookSecret).verify(rawBody, Object.fromEntries(req.headers));
    } catch (e) {
      console.error("[auth-email-hook] signature verification failed:", e);
      return hookError(401, "Invalid signature");
    }
  } else {
    console.warn(
      "[auth-email-hook] SEND_EMAIL_HOOK_SECRET is not set — accepting this request WITHOUT verifying it came from Supabase. " +
      "Configure the Send Email hook secret in Supabase Dashboard -> Authentication -> Hooks, then set it as an Edge Function secret to close this gap.",
    );
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return hookError(400, "Invalid JSON");
  }

  const user = payload.user as Record<string, unknown>;
  const emailData = payload.email_data as Record<string, unknown>;
  const to = user?.email as string;

  if (!to || !emailData) {
    return hookError(400, "Missing user or email_data");
  }

  const actionType = emailData.email_action_type as string;
  const tokenHash = emailData.token_hash as string;
  const siteUrl = (emailData.site_url as string) || "https://leieplattform.no";
  const redirectTo = (emailData.redirect_to as string) || siteUrl;

  let subject = "";
  let html = "";

  if (actionType === "recovery") {
    const url = `${siteUrl}/app.html#type=recovery&token_hash=${tokenHash}&redirect_to=${encodeURIComponent(redirectTo)}`;
    subject = "Tilbakestill passordet ditt";
    html = emailLayout("Tilbakestill passord", `
      <p>Vi mottok en forespørsel om å tilbakestille passordet for din konto.</p>
      <p>Klikk på knappen under for å sette et nytt passord. Lenken er gyldig i 60 minutter.</p>
      <a class="btn" href="${url}">Sett nytt passord →</a>
      <p style="font-size:13px;color:#888">Hvis du ikke ba om dette, kan du ignorere denne e-posten. Passordet ditt forblir uendret.</p>
    `);
  } else if (actionType === "signup") {
    const url = `${siteUrl}/app.html#type=signup&token_hash=${tokenHash}&redirect_to=${encodeURIComponent(redirectTo)}`;
    subject = "Bekreft e-postadressen din";
    html = emailLayout("Bekreft konto", `
      <p>Takk for at du registrerte deg!</p>
      <p>Klikk på knappen under for å bekrefte e-postadressen din og aktivere kontoen.</p>
      <a class="btn" href="${url}">Bekreft e-post →</a>
      <p style="font-size:13px;color:#888">Lenken er gyldig i 24 timer.</p>
    `);
  } else if (actionType === "invite") {
    const url = `${siteUrl}/app.html#type=invite&token_hash=${tokenHash}&redirect_to=${encodeURIComponent(redirectTo)}`;
    subject = "Du er invitert til Leieplattform";
    html = emailLayout("Invitasjon", `
      <p>Du har blitt invitert til å opprette en konto.</p>
      <a class="btn" href="${url}">Aksepter invitasjon →</a>
    `);
  } else if (actionType === "email_change") {
    const url = `${siteUrl}/app.html#type=email_change&token_hash=${tokenHash}&redirect_to=${encodeURIComponent(redirectTo)}`;
    subject = "Bekreft ny e-postadresse";
    html = emailLayout("Bekreft e-postendring", `
      <p>Klikk på knappen under for å bekrefte din nye e-postadresse.</p>
      <a class="btn" href="${url}">Bekreft ny e-post →</a>
    `);
  } else {
    // Unknown action — let Supabase handle it
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    await sendEmail(to, subject, html);
  } catch (e) {
    console.error("[auth-email-hook] sendEmail error:", e);
    return new Response(JSON.stringify({ error: "Email send failed" }), { status: 500 });
  }

  return new Response(JSON.stringify({}), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

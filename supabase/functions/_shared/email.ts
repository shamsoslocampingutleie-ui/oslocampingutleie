// Shared email utility — uses Resend API.
// Set RESEND_API_KEY and FROM_EMAIL in Supabase secrets.
// If RESEND_API_KEY is missing, emails are logged only (dev/test mode).
import { createClient } from "npm:@supabase/supabase-js@2";

const FROM = Deno.env.get("FROM_EMAIL") ?? "Leieplattform <noreply@leieplattform.no>";
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";

// A Resend failure previously only ever showed up in this function's own
// Deno logs (console.error), which nobody was routinely checking -- a
// host reported live never getting a notification email with no error
// surfaced anywhere admin could see. Best-effort mirror of a real send
// failure into error_logs, the same table/panel admin -> Feillogg
// already reads for client-side errors, so a broken send is visible in
// one place instead of requiring a separate check of Supabase's own
// function-log UI.
let _errLogClient: ReturnType<typeof createClient> | null = null;
function _errLogSb() {
  if (_errLogClient) return _errLogClient;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  _errLogClient = createClient(url, key);
  return _errLogClient;
}
async function _logEmailFailure(to: string, subject: string, detail: string) {
  try {
    const sb = _errLogSb();
    if (!sb) return;
    await sb.from("error_logs").insert({
      message: `[email] Send failed to ${to}: ${subject}`,
      stack: detail.slice(0, 4000),
      url: "edge-function:send-email",
      user_agent: "server",
    });
  } catch {
    // Never let logging the failure become its own unhandled failure.
  }
}

export function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  if (!RESEND_KEY) {
    console.warn(`[email] No RESEND_API_KEY — would send to ${to}: ${subject}`);
    await _logEmailFailure(to, subject, "RESEND_API_KEY is not configured — email was never sent.");
    return;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM, to, subject, html }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[email] Resend error ${res.status}: ${body}`);
      await _logEmailFailure(to, subject, `Resend ${res.status}: ${body}`);
    }
  } catch (e) {
    console.error(`[email] sendEmail threw:`, e);
    await _logEmailFailure(to, subject, `Threw: ${String((e as Error)?.message ?? e)}`);
  }
}

export function emailLayout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="nb">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;padding:0;background:#f0f7f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#15201A}
  .wrap{max-width:560px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.08)}
  .hdr{background:#14512E;padding:24px 32px}
  .hdr a{color:#fff;text-decoration:none;font-weight:700;font-size:18px;letter-spacing:-.01em}
  .body{padding:32px}
  h1{color:#14512E;font-size:22px;margin:0 0 16px;line-height:1.2}
  p{color:#3D4A41;line-height:1.65;margin:0 0 14px;font-size:15px}
  .btn{display:inline-block;background:#14512E;color:#fff;padding:13px 28px;border-radius:999px;text-decoration:none;font-weight:700;font-size:15px;margin:8px 0 20px}
  .info-box{background:#f0f7f2;border-left:3px solid #14512E;border-radius:0 10px 10px 0;padding:14px 18px;margin:16px 0}
  .info-box p{margin:0;font-size:14px;color:#3D4A41}
  .info-box strong{color:#14512E}
  .ftr{padding:20px 32px;border-top:1px solid #E3E6DD;text-align:center}
  .ftr p{font-size:12px;color:#6B776E;margin:0}
  .ftr a{color:#14512E;text-decoration:none}
</style>
</head>
<body>
<div class="wrap">
  <div class="hdr"><a href="https://leieplattform.no">Leieplattform</a></div>
  <div class="body">
    <h1>${title}</h1>
    ${body}
  </div>
  <div class="ftr">
    <p>Leieplattform · <a href="https://leieplattform.no">leieplattform.no</a></p>
    <p style="margin-top:4px">Spørsmål? Vi svarer ikke på denne adressen — <a href="https://leieplattform.no">kontakt oss i chatten på leieplattform.no</a></p>
    <p style="margin-top:8px">Finner du ikke denne e-posten senere? Sjekk søppelpost-/spam-mappen din, og merk gjerne <strong>leieplattform.no</strong> som trygg avsender.</p>
  </div>
</div>
</body></html>`;
}

// Admin-triggered monthly newsletter send. Growth plan item #9 -- the
// consent mechanism (profiles.marketing_consent, opt-in checkbox at
// registration, unchecked by default) was built first; this is the
// send side. Deliberately NOT a cron: content (new listings, a
// featured host, etc.) is an editorial decision each month, not
// something safe to generate and blast out unattended. An admin calls
// this with a subject + HTML body when the month's content is ready.
//
//   curl -X POST https://<project>.supabase.co/functions/v1/send-newsletter \
//     -H "Authorization: Bearer <admin's own JWT>" \
//     -H "Content-Type: application/json" \
//     -d '{"subject":"...","bodyHtml":"<p>...</p>","dryRun":true}'
//
// dryRun:true (default) returns the recipient count without sending
// anything -- always check this first before a real send, there's no
// undo on an email blast.
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendEmail } from "../_shared/email.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { unsubToken, unsubUrl } from "../_shared/unsubToken.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

function newsletterLayout(subject: string, bodyHtml: string, unsubLink: string): string {
  return `<!DOCTYPE html>
<html lang="nb"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;padding:0;background:#f0f7f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#15201A}
  .wrap{max-width:560px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.08)}
  .hdr{background:#14512E;padding:24px 32px}
  .hdr a{color:#fff;text-decoration:none;font-weight:700;font-size:18px;letter-spacing:-.01em}
  .body{padding:32px}
  h1{color:#14512E;font-size:22px;margin:0 0 16px;line-height:1.2}
  p{color:#3D4A41;line-height:1.65;margin:0 0 14px;font-size:15px}
  .ftr{padding:20px 32px;border-top:1px solid #E3E6DD;text-align:center}
  .ftr p{font-size:12px;color:#6B776E;margin:0}
  .ftr a{color:#14512E;text-decoration:none}
</style>
</head><body>
<div class="wrap">
  <div class="hdr"><a href="https://leieplattform.no">Leieplattform</a></div>
  <div class="body"><h1>${subject}</h1>${bodyHtml}</div>
  <div class="ftr">
    <p>Leieplattform · <a href="https://leieplattform.no">leieplattform.no</a></p>
    <p style="margin-top:8px">Du får denne e-posten fordi du samtykket til nyhetsbrev fra Leieplattform.<br><a href="${unsubLink}">Meld meg av nyhetsbrevet</a></p>
  </div>
</div>
</body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      SUPABASE_URL,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: userData, error: userErr } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: caller } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userData.user.id)
      .single();
    if (!caller || caller.role !== "admin") {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { subject, bodyHtml, dryRun } = await req.json();
    if (!subject || !bodyHtml) {
      return new Response(JSON.stringify({ error: "subject and bodyHtml required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const isDryRun = dryRun !== false; // default true -- see header comment

    const { data: recipients, error: qErr } = await supabase
      .from("profiles")
      .select("id, email")
      .eq("marketing_consent", true)
      .eq("suspended", false)
      .not("email", "is", null);
    if (qErr) throw qErr;

    const list = (recipients ?? []).filter((r) => !!r.email);

    if (isDryRun) {
      return new Response(JSON.stringify({ ok: true, dryRun: true, recipientCount: list.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let sent = 0;
    // Sequential, not Promise.all -- this can be hundreds of recipients
    // and Resend (like most providers) rate-limits; a slow, reliable
    // send beats a fast one that gets throttled or half-fails.
    for (const r of list) {
      const token = await unsubToken(r.id);
      const link = unsubUrl(SUPABASE_URL, r.id, token);
      await sendEmail(r.email as string, subject, newsletterLayout(subject, bodyHtml, link));
      sent++;
    }

    return new Response(JSON.stringify({ ok: true, dryRun: false, sent }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[send-newsletter]", err);
    try {
      const supabase = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      await supabase.from("error_logs").insert({
        message: "[send-newsletter] Unhandled failure",
        stack: String(err).slice(0, 4000),
        url: "edge-function:send-newsletter",
        user_agent: "server",
      });
    } catch { /* never let logging the failure become its own unhandled failure */ }
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

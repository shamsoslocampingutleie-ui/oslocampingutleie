import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { sendEmail } from "../_shared/email.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 1500;
const MAX_RETRIES = 3;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function sendWithRetry(
  to: string,
  subject: string,
  html: string,
  attempt = 0,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await sendEmail(to, subject, html);
    return { ok: true };
  } catch (err) {
    if (attempt < MAX_RETRIES - 1) {
      await sleep(1000 * Math.pow(2, attempt));
      return sendWithRetry(to, subject, html, attempt + 1);
    }
    return { ok: false, error: String(err) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Admin-only: verify caller is admin
  const authHeader = req.headers.get("Authorization") ?? "";
  const { data: { user }, error: authErr } = await supabase.auth.getUser(
    authHeader.replace("Bearer ", ""),
  );
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") {
    return new Response(JSON.stringify({ error: "Admin only" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body = await req.json().catch(() => ({}));
  const {
    campaign_id,
    subject,
    html_body,
    dry_run = true,
  } = body;

  if (!campaign_id || !subject || !html_body) {
    return new Response(
      JSON.stringify({ error: "campaign_id, subject og html_body er påkrevd" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Kill switch
  const bulkEnabled = Deno.env.get("EMAIL_BULK_SEND_ENABLED") === "true";
  if (!dry_run && !bulkEnabled) {
    return new Response(
      JSON.stringify({
        error:
          "Bulk sending er deaktivert. Sett EMAIL_BULK_SEND_ENABLED=true i secrets.",
      }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Fetch all host users
  const { data: hosts, error: hostErr } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .eq("role", "user")
    .not("email", "is", null)
    .neq("email", "");

  if (hostErr || !hosts) {
    return new Response(
      JSON.stringify({ error: "Klarte ikke hente utleiere: " + hostErr?.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const validHosts = hosts.filter((h) => h.email && h.email.includes("@"));

  if (dry_run) {
    return new Response(
      JSON.stringify({
        dry_run: true,
        campaign_id,
        total_recipients: validHosts.length,
        sample: validHosts.slice(0, 5).map((h) => ({ name: h.full_name, email: h.email })),
        message: "Dry-run fullført. Sett dry_run=false for å sende.",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Check already-sent (idempotency)
  const { data: alreadySent } = await supabase
    .from("bulk_email_log")
    .select("user_id")
    .eq("campaign_id", campaign_id)
    .eq("status", "sent");

  const alreadySentIds = new Set((alreadySent || []).map((r: { user_id: string }) => r.user_id));
  const toSend = validHosts.filter((h) => !alreadySentIds.has(h.id));

  console.log(
    `[bulk-email] Campaign: ${campaign_id} | Total: ${validHosts.length} | Already sent: ${alreadySentIds.size} | Queued: ${toSend.length}`,
  );

  let sentCount = 0;
  let failCount = 0;
  const failures: string[] = [];

  // Process in batches
  for (let i = 0; i < toSend.length; i += BATCH_SIZE) {
    const batch = toSend.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    console.log(`[bulk-email] Batch ${batchNum} — ${batch.length} mottakere`);

    await Promise.all(
      batch.map(async (host) => {
        const personalizedHtml = html_body
          .replace(/{{name}}/g, host.full_name || "Utleier")
          .replace(/{{email}}/g, host.email);

        const result = await sendWithRetry(host.email, subject, personalizedHtml);

        if (result.ok) {
          sentCount++;
          await supabase.from("bulk_email_log").upsert({
            campaign_id,
            user_id: host.id,
            email: host.email,
            status: "sent",
            sent_at: new Date().toISOString(),
          }, { onConflict: "campaign_id,user_id" });
        } else {
          failCount++;
          failures.push(`${host.email}: ${result.error}`);
          await supabase.from("bulk_email_log").upsert({
            campaign_id,
            user_id: host.id,
            email: host.email,
            status: "failed",
            error: result.error,
          }, { onConflict: "campaign_id,user_id" });
        }
      }),
    );

    if (i + BATCH_SIZE < toSend.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  console.log(
    `[bulk-email] Done. Sent: ${sentCount} | Failed: ${failCount} | Skipped (idempotent): ${alreadySentIds.size}`,
  );

  return new Response(
    JSON.stringify({
      campaign_id,
      total_targeted: validHosts.length,
      already_sent_idempotent: alreadySentIds.size,
      queued: toSend.length,
      sent_successfully: sentCount,
      failed: failCount,
      failure_reasons: failures.slice(0, 20),
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});

// Cron job (daily): remind an approved host who has never published a
// single listing. See the migration this depends on
// (20260928120000_unpublished_host_reminder.sql) for the full
// rationale -- this mirrors a real, currently-running Turo host-growth
// tactic (verified via web search: a cash incentive specifically for
// "hosts who previously created a host account but haven't completed
// their first vehicle listing"), applied to a segment this platform's
// own funnel data shows is stalling on momentum, not validation errors
// (zero recorded listing_publish_blocked events).
//
//   select cron.schedule('remind-unpublished-host', '0 10 * * *',
//     $$select net.http_post(url:='https://<project>.supabase.co/functions/v1/remind-unpublished-host',
//       headers:='{"Authorization":"Bearer <service_role_key>","Content-Type":"application/json"}'::jsonb,
//       body:='{}'::jsonb) as request_id$$);
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendEmail, emailLayout, escapeHtml } from "../_shared/email.ts";
import { insertNotification } from "../_shared/notify.ts";
import { corsHeaders } from "../_shared/cors.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function firePush(userId: string, title: string, body: string, url = "/") {
  fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-push`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify({ userId, title, body, url }),
  }).catch((e) => console.warn("[push]", e));
}

// First nudge a couple of days after approval -- give them a normal
// chance to just do it. Then once more a week later. Two total,
// spaced out: this is a small, high-intent segment where a barrage of
// emails would read as spammy, not helpful.
const GRACE_HOURS = 48;
const REMIND_EVERY_DAYS = 7;
const MAX_REMINDERS = 2;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { data: approvedHosts } = await supabase
      .from("profiles")
      .select("id, full_name, email, host_applied_at, created_at, unpublished_host_reminder_sent_at")
      .eq("host_approved", true)
      .lt("host_applied_at", new Date(Date.now() - GRACE_HOURS * 3600_000).toISOString());

    if (!approvedHosts?.length) {
      return new Response(JSON.stringify({ ok: true, emailed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: listingRows } = await supabase.from("listings").select("owner");
    const ownersWithListings = new Set((listingRows ?? []).map((l) => l.owner));

    const due = approvedHosts.filter((h) => {
      if (ownersWithListings.has(h.id)) return false;
      if (!h.unpublished_host_reminder_sent_at) return true;
      return new Date(h.unpublished_host_reminder_sent_at) < new Date(Date.now() - REMIND_EVERY_DAYS * 86400_000);
    });

    let emailed = 0;
    for (const host of due) {
      // Cap total reminders per host -- we don't track a count column,
      // so approximate it from how long it's been since first eligible
      // (host_applied_at) versus the reminder cadence: if more than
      // MAX_REMINDERS * REMIND_EVERY_DAYS days have passed with them
      // still unpublished, stop nagging -- a live person (support chat)
      // is the better channel from here, not more automated email.
      const daysSinceApplied = (Date.now() - new Date(host.host_applied_at ?? host.created_at).getTime()) / 86400_000;
      if (daysSinceApplied > MAX_REMINDERS * REMIND_EVERY_DAYS + 3) continue;

      if (!host.email) continue;
      const firstName = (host.full_name || "").split(" ")[0] || "der";

      await sendEmail(
        host.email,
        "Klar til å legge ut din første annonse?",
        emailLayout(
          "Du er godkjent — bare ett steg igjen 🎉",
          `<p>Hei ${escapeHtml(firstName)},</p>
          <p>Du ble godkjent som utleier på Leieplattform, men har ikke lagt ut en annonse ennå.</p>
          <div class="info-box"><p>Det tar under 2 minutter: kun bilde, tittel, sted og pris er påkrevd — resten kan du fylle inn senere. Første år er det <strong>0 % plattformgebyr</strong>, så alt du tjener er ditt.</p></div>
          <a href="https://leieplattform.no/legg-ut" class="btn">Legg ut din første annonse →</a>
          <p>Noe som stopper deg, eller spørsmål om hvordan det fungerer? Bare svar på chatten på leieplattform.no — vi hjelper deg gjerne i gang.</p>`,
        ),
      );
      emailed++;

      const nt = "Klar til å legge ut din første annonse?";
      const nb = "Du er godkjent som utleier — det tar under 2 minutter å legge ut din første annonse.";
      await insertNotification(supabase, host.id, "reminder", nt, nb, {});
      firePush(host.id, nt, nb, "/legg-ut");

      await supabase
        .from("profiles")
        .update({ unpublished_host_reminder_sent_at: new Date().toISOString() })
        .eq("id", host.id);
    }

    return new Response(JSON.stringify({ ok: true, emailed, checked: due.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[remind-unpublished-host]", err);
    try {
      await supabase.from("error_logs").insert({
        message: "[remind-unpublished-host] Unhandled failure",
        stack: String(err).slice(0, 4000),
        url: "edge-function:remind-unpublished-host",
        user_agent: "server",
      });
    } catch { /* never let logging the failure become its own unhandled failure */ }
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

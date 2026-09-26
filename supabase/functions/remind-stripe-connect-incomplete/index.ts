// Cron job (weekly): email any host with an active listing whose
// Stripe Connect setup is still incomplete (no account, or an account
// that never finished onboarding). Self-terminating per host: once
// stripe_charges_enabled becomes true the query stops matching them,
// so there's no need to track "resolved" separately.
//
// Not admin-JWT-gated like notify-stripe-connect-required (the manual
// admin-triggered version of this same email) -- this is invoked only
// by pg_cron with a service_role bearer, like the other cron jobs in
// this project (auto-clean-errors, handover-reminder-daily). See
// 20260926090000_stripe_connect_reminder_cron.sql for why the actual
// cron.schedule() call isn't in a migration file.
//
//   select cron.schedule('remind-stripe-connect-incomplete', '0 10 * * 1',
//     $$select net.http_post(url:='https://<project>.supabase.co/functions/v1/remind-stripe-connect-incomplete',
//       headers:='{"Authorization":"Bearer <service_role_key>","Content-Type":"application/json"}'::jsonb,
//       body:='{}'::jsonb) as request_id$$);
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendEmail, emailLayout, escapeHtml } from "../_shared/email.ts";
import { corsHeaders } from "../_shared/cors.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const REMIND_EVERY_DAYS = 7;
// Give a brand-new host a day to see the in-app dashboard banner /
// finish onboarding on their own before the first automated email --
// avoids emailing someone literally minutes after they list something.
const GRACE_HOURS = 24;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const { data: owners } = await supabase
      .from("listings")
      .select("owner")
      .lt("created_at", new Date(Date.now() - GRACE_HOURS * 3600_000).toISOString());
    const ownerIds = [...new Set((owners ?? []).map((o) => o.owner))];
    if (!ownerIds.length) {
      return new Response(JSON.stringify({ ok: true, emailed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cutoff = new Date(Date.now() - REMIND_EVERY_DAYS * 86400_000);
    // Filtered in code, not via chained .or() calls -- PostgREST ANDs
    // separate query params together, but relying on that for two
    // *different* OR-groups combined with AND is easy to get subtly
    // wrong for something that sends real email, so fetch the (small)
    // non-admin owner set and apply both conditions explicitly instead.
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, email, role, stripe_account_id, stripe_charges_enabled, stripe_reminder_sent_at")
      .in("id", ownerIds)
      .neq("role", "admin");

    let emailed = 0;
    for (const p of profiles ?? []) {
      const stillIncomplete = !p.stripe_account_id || p.stripe_charges_enabled !== true;
      const dueForReminder = !p.stripe_reminder_sent_at || new Date(p.stripe_reminder_sent_at) < cutoff;
      if (!stillIncomplete || !dueForReminder || !p.email) continue;

      const firstName = (p.full_name || "").split(" ")[0] || "der";
      await sendEmail(
        p.email,
        "Fullfør Stripe-oppsettet for å motta betalinger",
        emailLayout(
          "Fullfør Stripe-oppsettet ditt",
          `<p>Hei ${escapeHtml(firstName)},</p>
          <p>Du har annonser på Leieplattform, men Stripe-oppsettet ditt er ikke fullført ennå.</p>
          <div class="info-box"><p><strong>Konsekvens:</strong> uten et fullført Stripe-oppsett kan leietakere ikke betale for annonsene dine, og bookinger blir blokkert helt til dette er i orden.</p></div>
          <p>Det tar bare noen minutter: gå til utleier-dashbordet ditt → Økonomi → «Fullfør Stripe-oppsett».</p>
          <a href="https://leieplattform.no/utleier" class="btn">Fullfør Stripe-oppsett →</a>`,
        ),
      );
      await supabase
        .from("profiles")
        .update({ stripe_reminder_sent_at: new Date().toISOString() })
        .eq("id", p.id);
      emailed++;
    }

    return new Response(JSON.stringify({ ok: true, emailed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[remind-stripe-connect-incomplete]", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// Daily cron: completes a promise the site already makes but never
// kept. renderGrid()'s zero-result empty state (src/app.html) lets a
// visitor leave their email to "get notified when something matching
// shows up" -- demand_signals rows were being written (see
// 20260926130000_demand_signals_and_track_contact_requests.sql) and
// read ONLY by admin, for demand measurement. Nothing ever actually
// sent the email the UI promises. For every unnotified signal, checks
// whether any active listing now matches (category exact-or-any,
// location loose substring match -- both fields are free text, there's
// no structured geo match to do here) and emails + marks notified if so.
//
//   select cron.schedule('match-demand-signals', '0 8 * * *',
//     $$select net.http_post(url:='https://<project>.supabase.co/functions/v1/match-demand-signals',
//       headers:='{"Authorization":"Bearer <service_role_key>","Content-Type":"application/json"}'::jsonb,
//       body:='{}'::jsonb) as request_id$$);
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendEmail, emailLayout, escapeHtml } from "../_shared/email.ts";
import { corsHeaders } from "../_shared/cors.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const CAT_NAME: Record<string, string> = {
  camping: "Campingvogn",
  mobil: "Bobil",
  car: "Bil",
  trailer: "Tilhenger",
  boat: "Båt",
  tool: "Verktøy",
  tent: "Taktelt",
  maskiner: "Maskiner",
  fritid: "Fritidsutstyr",
  stillas: "Stillas",
  diverse: "Diverse",
};

function nok(n: number): string {
  return Math.round(n).toLocaleString("nb-NO");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { data: signals } = await supabase
      .from("demand_signals")
      .select("id, email, category, location")
      .eq("notified", false);

    if (!signals?.length) {
      return new Response(JSON.stringify({ ok: true, emailed: 0, checked: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: listings } = await supabase
      .from("listings")
      .select("id, title, category, location, price_per_day")
      .eq("status", "active");

    let emailed = 0;
    for (const sig of signals) {
      const sigLoc = (sig.location || "").trim().toLowerCase();
      const matches = (listings ?? []).filter((l) => {
        const catOk = !sig.category || l.category === sig.category;
        const locOk = !sigLoc || (l.location || "").toLowerCase().includes(sigLoc);
        return catOk && locOk;
      });
      if (matches.length === 0) continue;
      if (!sig.email) {
        // Nothing to send to -- still mark notified so this row doesn't
        // get re-checked forever once it's matched once.
        await supabase.from("demand_signals").update({ notified: true }).eq("id", sig.id);
        continue;
      }

      const top = matches.slice(0, 5);
      const itemsHtml = top
        .map((l) =>
          `<div class="info-box" style="margin-bottom:8px"><p style="margin:0"><strong>${escapeHtml(l.title)}</strong><br>${escapeHtml(l.location || "")} · ${nok(Number(l.price_per_day) || 0)} kr/dag</p></div>`
        )
        .join("");
      const catLabel = sig.category ? CAT_NAME[sig.category] ?? sig.category : "utstyr";
      const locLabel = sig.location ? " i " + escapeHtml(sig.location) : "";

      await sendEmail(
        sig.email,
        `Nå er det ${catLabel.toLowerCase()}${locLabel} å leie! 🎉`,
        emailLayout(
          "Noe som matcher er nå tilgjengelig",
          `<p>Du ba om å få beskjed når det dukket opp ${catLabel.toLowerCase()}${locLabel} å leie på Leieplattform. Nå er det det:</p>
          ${itemsHtml}
          <a href="https://leieplattform.no" class="btn">Se alle annonser →</a>
          <p>Dette er en engangsvarsling for dette søket — meld deg gjerne på igjen fra et nytt søk senere.</p>`,
        ),
      );
      await supabase.from("demand_signals").update({ notified: true }).eq("id", sig.id);
      emailed++;
    }

    return new Response(JSON.stringify({ ok: true, emailed, checked: signals.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[match-demand-signals]", err);
    try {
      await supabase.from("error_logs").insert({
        message: "[match-demand-signals] Unhandled failure",
        stack: String(err).slice(0, 4000),
        url: "edge-function:match-demand-signals",
        user_agent: "server",
      });
    } catch { /* never let logging the failure become its own unhandled failure */ }
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

import { createClient } from "npm:@supabase/supabase-js@2";
import { checkRateLimit, rateLimitResponse } from "../_shared/rateLimit.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, apikey, authorization",
  "Content-Type": "application/json",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

function csvEscape(v: unknown): string {
  const s = String(v ?? "").replace(/"/g, '""');
  return `"${s}"`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const adminPassword = Deno.env.get("CAMPAIGN_ADMIN_PASSWORD");
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    null;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Ugyldig forespørsel." }, 400);
  }

  const { password, action } = body as { password?: string; action?: string };

  // Rate limit password attempts before checking it, so it can't be brute-forced:
  // 5 attempts per IP per 5 minutes, regardless of whether the password is correct.
  if (!await checkRateLimit(req, 5, 300_000)) return rateLimitResponse(CORS);

  // Auth check
  if (!adminPassword || password !== adminPassword) {
    return json({ error: "Ugyldig passord." }, 401);
  }

  async function logAction(act: string, details?: unknown) {
    await sb.from("campaign_admin_log").insert({
      action: act,
      performed_by: "admin",
      ip_address: ip,
      details: details ?? null,
    }).then(() => {}, () => {});
  }

  // ── get_config ──
  if (action === "get_config") {
    const { data, error } = await sb.from("campaign_config").select("*").eq("id", 1).single();
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, config: data });
  }

  // ── update_config ──
  if (action === "update_config") {
    const allowed = ["enabled", "competition_open", "football_rain", "popup_enabled", "countdown_enabled", "match_date", "match_teams"];
    const updates: Record<string, unknown> = {};
    for (const k of allowed) {
      if (k in body) updates[k] = (body as Record<string, unknown>)[k];
    }
    if (Object.keys(updates).length === 0) return json({ error: "Ingen felter å oppdatere." }, 400);
    const { error } = await sb.from("campaign_config").update(updates).eq("id", 1);
    if (error) return json({ error: error.message }, 500);
    await logAction("update_config", updates);
    return json({ ok: true });
  }

  // ── list_entries ──
  if (action === "list_entries" || action === "export_csv") {
    const { search, sortBy, sortDir, dateFrom, dateTo } = body as {
      search?: string;
      sortBy?: string;
      sortDir?: string;
      dateFrom?: string;
      dateTo?: string;
    };
    const col = ["name", "email", "created_at"].includes(sortBy ?? "") ? sortBy! : "created_at";
    const dir = sortDir === "asc";

    let q = sb.from("campaign_entries").select("*").order(col, { ascending: dir });

    if (search?.trim()) {
      const s = search.trim();
      q = q.or(`name.ilike.%${s}%,email.ilike.%${s}%`);
    }
    if (dateFrom) q = q.gte("created_at", dateFrom);
    if (dateTo) q = q.lte("created_at", dateTo);

    const { data, error } = await q;
    if (error) return json({ error: error.message }, 500);

    if (action === "export_csv") {
      const header = "Navn,E-post,Tipp Norge,Tipp Brasil,Tidspunkt,IP\n";
      const rows = (data ?? []).map((e) =>
        [csvEscape(e.name), csvEscape(e.email), e.predicted_home, e.predicted_away, csvEscape(e.created_at), csvEscape(e.ip_address)].join(",")
      ).join("\n");
      await logAction("export_csv", { count: data?.length ?? 0 });
      return new Response(header + rows, {
        headers: {
          ...CORS,
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="kampanje-deltakere.csv"`,
        },
      });
    }

    return json({ ok: true, entries: data ?? [], total: data?.length ?? 0 });
  }

  // ── register_result ──
  if (action === "register_result") {
    const { homeScore, awayScore } = body as { homeScore?: number; awayScore?: number };
    const h = Number(homeScore);
    const a = Number(awayScore);
    if (!Number.isInteger(h) || h < 0 || h > 20 || !Number.isInteger(a) || a < 0 || a > 20) {
      return json({ error: "Ugyldig sluttresultat." }, 400);
    }
    const { error } = await sb.from("campaign_config").update({
      final_home_score: h,
      final_away_score: a,
      competition_open: false,
    }).eq("id", 1);
    if (error) return json({ error: error.message }, 500);
    await logAction("register_result", { home: h, away: a });
    return json({ ok: true, message: `Resultat registrert: ${h}–${a}` });
  }

  // ── draw_winner / draw_random_winner ──
  if (action === "draw_winner" || action === "draw_random_winner") {
    // Check not already drawn
    const { data: cfg } = await sb.from("campaign_config").select("winner_drawn, final_home_score, final_away_score").eq("id", 1).single();
    if (cfg?.winner_drawn) return json({ error: "Vinner er allerede trukket." }, 409);

    const { data: allEntries } = await sb.from("campaign_entries").select("*");
    const total = allEntries?.length ?? 0;

    let pool = allEntries ?? [];
    let correctCount = total;

    if (action === "draw_winner") {
      if (cfg?.final_home_score == null || cfg?.final_away_score == null) {
        return json({ error: "Sluttresultat er ikke registrert ennå." }, 400);
      }
      pool = pool.filter((e) => e.predicted_home === cfg.final_home_score && e.predicted_away === cfg.final_away_score);
      correctCount = pool.length;
      if (pool.length === 0) {
        return json({ ok: false, noCorrect: true, totalEntries: total, message: "Ingen deltakere tippet riktig. Bruk draw_random_winner for å trekke blant alle." });
      }
    }

    if (pool.length === 0) return json({ error: "Ingen deltakere i trekningen." }, 400);

    // CSPRNG pick
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    const idx = buf[0] % pool.length;
    const winner = pool[idx];

    const { error: updateErr } = await sb.from("campaign_config").update({
      winner_drawn: true,
      winner_entry_id: winner.id,
      draw_timestamp: new Date().toISOString(),
      draw_performed_by: "admin",
    }).eq("id", 1);
    if (updateErr) return json({ error: updateErr.message }, 500);

    await logAction(action, { winner_id: winner.id, winner_name: winner.name, winner_email: winner.email, correct_count: correctCount, total });

    return json({
      ok: true,
      winner: { name: winner.name, email: winner.email, predicted_home: winner.predicted_home, predicted_away: winner.predicted_away, created_at: winner.created_at },
      correctCount,
      totalEntries: total,
    });
  }

  // ── get_draw_result ──
  if (action === "get_draw_result") {
    const { data: cfg } = await sb.from("campaign_config").select("winner_drawn, winner_entry_id, draw_timestamp, draw_performed_by, final_home_score, final_away_score").eq("id", 1).single();
    if (!cfg?.winner_drawn || !cfg?.winner_entry_id) {
      return json({ ok: true, drawn: false });
    }
    const { data: winner } = await sb.from("campaign_entries").select("name, email, predicted_home, predicted_away, created_at").eq("id", cfg.winner_entry_id).single();
    return json({ ok: true, drawn: true, winner, drawTimestamp: cfg.draw_timestamp, performedBy: cfg.draw_performed_by, finalScore: { home: cfg.final_home_score, away: cfg.final_away_score } });
  }

  // ── get_logs ──
  if (action === "get_logs") {
    const { data, error } = await sb.from("campaign_admin_log").select("*").order("created_at", { ascending: false }).limit(100);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, logs: data ?? [] });
  }

  // ── disable_campaign ──
  if (action === "disable_campaign") {
    const { error } = await sb.from("campaign_config").update({ enabled: false, competition_open: false }).eq("id", 1);
    if (error) return json({ error: error.message }, 500);
    await logAction("disable_campaign");
    return json({ ok: true, message: "Kampanjen er deaktivert." });
  }

  return json({ error: "Ukjent handling: " + action }, 400);
});

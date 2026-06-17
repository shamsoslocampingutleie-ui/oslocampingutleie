// Automatic error log cleanup — call daily via pg_cron or Supabase scheduler.
//
// Deletes:
//   1. All error_logs older than 14 days
//   2. Duplicates (same message, keeps only the newest per unique message)
//
// Schedule with pg_cron in Supabase SQL editor:
//   select cron.schedule(
//     'auto-clean-errors',
//     '0 3 * * *',
//     $$select net.http_post(
//       url:='https://<project-ref>.supabase.co/functions/v1/auto-clean-errors',
//       headers:='{"Authorization":"Bearer <service_role_key>","Content-Type":"application/json"}'::jsonb,
//       body:='{}'::jsonb
//     ) as request_id$$
//   );
//
// Replace <project-ref> with your Supabase project ID and <service_role_key>
// with your service role key (found in Supabase → Settings → API).

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const auth = req.headers.get("Authorization") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!auth.includes(serviceKey)) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results = { deletedOld: 0, deletedDuplicates: 0 };

  // 1. Delete errors older than 14 days
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { count: oldCount } = await supabase
    .from("error_logs")
    .delete({ count: "exact" })
    .lt("created_at", cutoff);
  results.deletedOld = oldCount ?? 0;

  // 2. Deduplicate: for each unique message, keep only the newest row
  const { data: all } = await supabase
    .from("error_logs")
    .select("id, message, created_at")
    .order("created_at", { ascending: false });

  if (all && all.length > 0) {
    const seen = new Set<string>();
    const toDelete: string[] = [];
    for (const row of all) {
      const key = String(row.message).slice(0, 120);
      if (seen.has(key)) {
        toDelete.push(row.id);
      } else {
        seen.add(key);
      }
    }
    if (toDelete.length > 0) {
      const CHUNK = 100;
      for (let i = 0; i < toDelete.length; i += CHUNK) {
        await supabase
          .from("error_logs")
          .delete()
          .in("id", toDelete.slice(i, i + CHUNK));
      }
      results.deletedDuplicates = toDelete.length;
    }
  }

  console.log("[auto-clean-errors]", results);
  return new Response(JSON.stringify(results), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const sql = `
    ALTER TABLE profiles
      ADD COLUMN IF NOT EXISTS host_id_status text NOT NULL DEFAULT 'none'
        CHECK (host_id_status IN ('none','pending','approved','rejected')),
      ADD COLUMN IF NOT EXISTS host_id_doc_url text,
      ADD COLUMN IF NOT EXISTS host_id_doc_type text,
      ADD COLUMN IF NOT EXISTS host_id_submitted_at timestamptz,
      ADD COLUMN IF NOT EXISTS host_id_reviewed_at timestamptz,
      ADD COLUMN IF NOT EXISTS host_id_reject_reason text;

    -- Admin bypass: service role can always update host_id fields
    -- RLS: users can read/update their own host_id_status (read only after submit)
  `;

  // Use pg directly via the Deno postgres driver
  const dbUrl = Deno.env.get("SUPABASE_DB_URL");
  if (!dbUrl) {
    return new Response(JSON.stringify({ error: "No SUPABASE_DB_URL" }), { status: 500 });
  }

  const { Pool } = await import("npm:pg@8");
  const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();
  try {
    await client.query(sql);
    await client.release();
    await pool.end();
  } catch (err) {
    await client.release();
    await pool.end();
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
});

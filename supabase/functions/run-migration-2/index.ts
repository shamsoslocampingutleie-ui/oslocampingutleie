Deno.serve(async (_req) => {
  const dbUrl = Deno.env.get("SUPABASE_DB_URL");
  if (!dbUrl) {
    return new Response(JSON.stringify({ error: "No SUPABASE_DB_URL" }), { status: 500 });
  }

  const sql = `
    CREATE TABLE IF NOT EXISTS active_visitors (
      session_id text PRIMARY KEY,
      country text,
      city text,
      flag text,
      current_page text,
      user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
      user_name text,
      last_seen timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE active_visitors ENABLE ROW LEVEL SECURITY;
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname='public' AND tablename='active_visitors' AND policyname='anon_upsert_own_session'
      ) THEN
        CREATE POLICY anon_upsert_own_session ON active_visitors
          FOR ALL USING (true) WITH CHECK (true);
      END IF;
    END$$;
  `;

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

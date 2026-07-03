-- Campaign: Norge vs Brasil tippekonkurranse

CREATE TABLE IF NOT EXISTS campaign_config (
  id int PRIMARY KEY DEFAULT 1,
  enabled boolean NOT NULL DEFAULT true,
  competition_open boolean NOT NULL DEFAULT true,
  winner_drawn boolean NOT NULL DEFAULT false,
  football_rain boolean NOT NULL DEFAULT true,
  popup_enabled boolean NOT NULL DEFAULT true,
  countdown_enabled boolean NOT NULL DEFAULT true,
  match_date timestamptz NOT NULL DEFAULT '2026-07-15 20:00:00+02',
  match_teams text NOT NULL DEFAULT 'Norge vs Brasil',
  final_home_score int,
  final_away_score int,
  draw_timestamp timestamptz,
  draw_performed_by text,
  winner_entry_id uuid,
  CONSTRAINT single_row CHECK (id = 1)
);

CREATE TABLE IF NOT EXISTS campaign_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  predicted_home int NOT NULL CHECK (predicted_home >= 0 AND predicted_home <= 20),
  predicted_away int NOT NULL CHECK (predicted_away >= 0 AND predicted_away <= 20),
  created_at timestamptz NOT NULL DEFAULT now(),
  ip_address text,
  CONSTRAINT unique_email UNIQUE (email)
);

CREATE TABLE IF NOT EXISTS campaign_admin_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,
  performed_by text,
  ip_address text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Add FK after both tables exist
ALTER TABLE campaign_config
  ADD CONSTRAINT fk_winner_entry
  FOREIGN KEY (winner_entry_id) REFERENCES campaign_entries(id)
  ON DELETE SET NULL
  NOT VALID;

-- RLS
ALTER TABLE campaign_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_admin_log ENABLE ROW LEVEL SECURITY;

-- campaign_config: anyone can read
CREATE POLICY "public_read_config" ON campaign_config
  FOR SELECT USING (true);

-- campaign_entries: anon can insert (one per email enforced by UNIQUE), no public read
CREATE POLICY "anon_insert_entry" ON campaign_entries
  FOR INSERT WITH CHECK (true);

-- campaign_admin_log: no public access (service role only)

-- Seed default config
INSERT INTO campaign_config (id, match_date, match_teams)
VALUES (1, '2026-07-15 20:00:00+02', 'Norge vs Brasil')
ON CONFLICT (id) DO NOTHING;

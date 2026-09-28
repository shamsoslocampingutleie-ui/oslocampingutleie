-- bulk_email_log has existed live and in active use by
-- bulk-email-hosts/index.ts (upsert on conflict "campaign_id,user_id")
-- since before this migration history existed for it -- found via a
-- live query while auditing, table exists and is queryable, but no
-- migration file in this repo ever created it. That's a real gap: a
-- fresh environment built from this migration history (a new
-- Supabase project, a CI check, `supabase db reset`) would be missing
-- a table the deployed function depends on. `create table if not
-- exists` is a no-op against the live table (nothing here alters
-- existing data or breaks the running function) and just brings the
-- schema history in sync with what's actually deployed.
create table if not exists public.bulk_email_log (
  id uuid primary key default gen_random_uuid(),
  campaign_id text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  email text not null,
  status text not null check (status in ('sent', 'failed')),
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (campaign_id, user_id)
);

alter table public.bulk_email_log enable row level security;

-- service_role only (the edge function's own client) -- same pattern
-- as registration_log: an operational/audit trail a client should
-- never be able to read or forge.
drop policy if exists "bulk_email_log_service_role_only" on public.bulk_email_log;
create policy "bulk_email_log_service_role_only" on public.bulk_email_log
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

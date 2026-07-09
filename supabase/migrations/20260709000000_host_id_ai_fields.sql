-- AI verification results for host identity documents.
-- Populated by the verify-license Edge Function when type='host_id'.
alter table public.profiles
  add column if not exists host_id_ai_result boolean default null,
  add column if not exists host_id_ai_confidence text default null,
  add column if not exists host_id_ai_reason text default null;

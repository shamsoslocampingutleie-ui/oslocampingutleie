-- profiles had ZERO indexes beyond its primary key -- verified live via
-- pg_indexes while auditing. Harmless today (profile count is tiny), but
-- profiles is specifically the table this entire session's explicit goal
-- (flere utleiere, flere bookinger -- more hosts, more users) grows the
-- fastest: every new signup is a new profiles row. Fixing it now, while
-- it's free, beats rediscovering it as a slow query once growth actually
-- happens.
--
-- Three real, recurring access patterns (grepped src/app.html and every
-- edge function):
--   - host_approved = true/false: admin's pending-hosts panel,
--     remind-unpublished-host, adminHosts() dot-badge count.
--   - role = 'admin': looked up by id (already PK-fast) in most places,
--     but bulk-email-hosts/send-newsletter/notify-host-application all
--     scan by role or combine it with host_approved/marketing_consent.
--   - marketing_consent = true: send-newsletter, bulk-email-hosts (added
--     this session) -- scans the whole table to build a recipient list.
create index if not exists idx_profiles_host_approved
  on public.profiles (host_approved);

create index if not exists idx_profiles_role
  on public.profiles (role);

create index if not exists idx_profiles_marketing_consent
  on public.profiles (marketing_consent) where marketing_consent = true;

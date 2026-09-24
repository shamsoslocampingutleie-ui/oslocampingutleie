-- upload_sessions existed in production but was never in a tracked
-- migration (created directly via the SQL editor at some point) --
-- found and verified during the same security pass as wishlists (see
-- 20260925140000). Verified live via the Supabase dashboard: RLS is
-- enabled and the existing "owner_all" policy correctly scopes access
-- to `auth.uid() = user_id` (no separate WITH CHECK, so it applies to
-- inserts too). Consistent with how this table is actually used: the
-- desktop side (that creates the session and polls it for a result)
-- does so as the logged-in owning user, direct client reads/writes
-- correctly scoped by this policy; the phone side (mobile-upload edge
-- function) never touches this table via RLS at all -- it looks up
-- and updates the row by the opaque token value using the service
-- role, which bypasses RLS entirely, as designed.
--
-- As with wishlists, this intentionally omits `create table` -- only
-- the columns actually referenced from src/app.html (token, user_id,
-- expires_at, image_url) are known here, and guessing the rest risks
-- recording something that doesn't match what's actually live. This
-- only (re-)asserts the already-correct RLS state, a safe no-op
-- either way.
alter table public.upload_sessions enable row level security;

drop policy if exists "owner_all" on public.upload_sessions;
create policy "owner_all" on public.upload_sessions for all
  using (auth.uid() = user_id);

-- Follow-up to 20260925220000: that migration dropped the tracked
-- "Profiles are viewable by everyone" policy, but the live database also
-- had a SECOND, never-tracked policy -- "profiles_read_all", using
-- (true) -- created directly via the SQL editor at some point (same
-- untracked-object pattern already found for the wishlists/
-- upload_sessions tables earlier). Since RLS policies are OR'd together,
-- this one alone kept the entire table publicly readable even after the
-- first migration applied -- verified live: a fresh unauthenticated
-- REST query still returned full_name/email after 20260925220000 ran.
--
-- Also found "Users can view own profile" and "profiles_update_own" --
-- exact duplicates (by qual) of the tracked "Users can view own profile,
-- admins view all" / "Users can update own profile" policies, from the
-- same untracked source. Harmless (same restriction, not a leak) but
-- redundant -- dropped for a clean, single source of truth per action.
drop policy if exists "profiles_read_all" on public.profiles;
drop policy if exists "Users can view own profile" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;

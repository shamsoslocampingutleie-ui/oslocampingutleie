-- CRITICAL SECURITY FIX: the original select policy on public.profiles,
-- "Profiles are viewable by everyone" using (true), made the ENTIRE
-- table -- full_name, email, phone, address, stripe_account_id,
-- drivers_license_front/back (ID document image URLs), host_id_doc_url,
-- org_number, everything -- readable by anyone on the internet via the
-- public/publishable API key, no login required. Found live via a direct
-- unauthenticated REST query during a routine RLS audit.
--
-- This was almost certainly a leftover from before public.profiles_public
-- (see 20260924140000_company_accounts.sql) existed as the actual safe,
-- limited surface (id, full_name, avatar_url, bio, is_company,
-- company_name) for "show the host's name/avatar on a listing" --
-- profiles_public is `security_invoker = false`, so it keeps working
-- exactly as before regardless of this change.
--
-- Every legitimate direct read of the base table was already scoped to
-- either the caller's own row (loadProfile() during login) or gated
-- behind an admin-only client code path (adminUsers(), adminHosts(),
-- adminBookings()'s _ensureAdminHostPhones(), renderAdmin()'s pending-
-- host-applications badge count) -- verified by reading every
-- `.from("profiles").select(...)` call site in src/app.html before
-- writing this migration. None of them break with this tightened policy.
drop policy if exists "Profiles are viewable by everyone" on public.profiles;
create policy "Users can view own profile, admins view all"
  on public.profiles for select
  using (auth.uid() = id or public.is_admin());

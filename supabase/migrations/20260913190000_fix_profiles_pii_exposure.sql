-- Security fix: "Profiles are viewable by everyone" used `using (true)` with
-- no `to authenticated` restriction, so ANY unauthenticated visitor could
-- read every column of every row via the public REST API with just the
-- anon key -- including email, phone, address, driver's-license photo
-- URLs, stripe_account_id, suspended and role. Restrict reads to the
-- owner and admins, and expose only the safe, non-sensitive columns other
-- users legitimately need (host name/avatar/bio shown on listings) via a
-- dedicated view.

drop policy if exists "Profiles are viewable by everyone" on public.profiles;
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id or public.is_admin());

create or replace view public.profiles_public
  with (security_invoker = false) as
  select id, full_name, avatar_url, bio
  from public.profiles;

comment on view public.profiles_public is
  'Safe, non-sensitive profile columns visible to any visitor (e.g. host name/avatar shown on listings). Deliberately excludes email, phone, address, license documents, stripe_account_id, role, suspended, etc.';

grant select on public.profiles_public to anon, authenticated;

-- Two things in one migration:
--
-- 1. contact_requests was found live (pg_policies) but untracked --
--    same "created directly against the database, never captured"
--    pattern found repeatedly this session (wishlists, upload_sessions,
--    profiles_read_all, the listings_* policy duplicates). Asserting
--    it here with `if not exists` / `drop policy if exists` so it's
--    safe to run against the live table.
--
-- 2. demand_signals: new. Growth-strategy review (§24, marketplace
--    liquidity) found the real bottleneck is likely supply
--    concentration, not visitor traffic -- but there was no way to
--    quantify WHERE demand exists without supply. The zero-result
--    search state already turns into a host-recruitment CTA
--    (renderGrid()); this adds a genuine, real capture of "notify me"
--    interest right there, giving admin actual geographic/category
--    demand data instead of a guess. Explicitly the honest alternative
--    to inflating the numbers shown elsewhere on the site.
create table if not exists public.contact_requests (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  name text not null,
  email text not null,
  phone text not null default '',
  subject text not null default '',
  message text not null,
  user_id uuid references public.profiles(id) on delete set null,
  status text not null default 'new',
  admin_note text not null default ''
);
alter table public.contact_requests enable row level security;
drop policy if exists "contact_requests_insert" on public.contact_requests;
create policy "contact_requests_insert" on public.contact_requests
  for insert with check (true);
drop policy if exists "contact_requests_select" on public.contact_requests;
create policy "contact_requests_select" on public.contact_requests
  for select using (public.is_admin());
drop policy if exists "contact_requests_update" on public.contact_requests;
create policy "contact_requests_update" on public.contact_requests
  for update using (public.is_admin()) with check (public.is_admin());

create table if not exists public.demand_signals (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  email text not null,
  category text,
  location text,
  notified boolean not null default false
);
alter table public.demand_signals enable row level security;
drop policy if exists "demand_signals_insert" on public.demand_signals;
create policy "demand_signals_insert" on public.demand_signals
  for insert with check (true);
drop policy if exists "demand_signals_select" on public.demand_signals;
create policy "demand_signals_select" on public.demand_signals
  for select using (public.is_admin());

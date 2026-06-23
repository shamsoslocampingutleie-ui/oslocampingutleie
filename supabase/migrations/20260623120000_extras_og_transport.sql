-- ============================================================
-- EXTRAS + TRANSPORT SYSTEM (2026-06-23)
-- ============================================================

create table if not exists public.listing_extras (
  id           uuid primary key default gen_random_uuid(),
  listing_id   uuid references public.listings(id) on delete cascade,
  name         text not null,
  description  text,
  price        numeric not null default 0,
  pricing_type text not null default 'fixed' check (pricing_type in ('fixed','per_day','per_booking','per_unit')),
  category     text default '',
  is_active    boolean not null default true,
  sort_order   int default 0,
  created_at   timestamptz not null default now()
);
alter table public.listing_extras enable row level security;
drop policy if exists "extras_read" on public.listing_extras;
create policy "extras_read" on public.listing_extras for select using (true);
drop policy if exists "extras_write" on public.listing_extras;
create policy "extras_write" on public.listing_extras for all
  using (auth.uid() in (select owner from public.listings where id = listing_id))
  with check (auth.uid() in (select owner from public.listings where id = listing_id));

create table if not exists public.transport_options (
  id           uuid primary key default gen_random_uuid(),
  listing_id   uuid references public.listings(id) on delete cascade,
  name         text not null,
  description  text,
  price        numeric not null default 0,
  pricing_mode text not null default 'fixed' check (pricing_mode in ('fixed','manual','zone','distance')),
  rule_json    jsonb,
  is_active    boolean not null default true,
  sort_order   int default 0,
  created_at   timestamptz not null default now()
);
alter table public.transport_options enable row level security;
drop policy if exists "transport_read" on public.transport_options;
create policy "transport_read" on public.transport_options for select using (true);
drop policy if exists "transport_write" on public.transport_options;
create policy "transport_write" on public.transport_options for all
  using (auth.uid() in (select owner from public.listings where id = listing_id))
  with check (auth.uid() in (select owner from public.listings where id = listing_id));

create table if not exists public.booking_extras (
  id             uuid primary key default gen_random_uuid(),
  booking_id     uuid references public.bookings(id) on delete cascade,
  extra_id       uuid references public.listing_extras(id) on delete set null,
  extra_name     text not null,
  quantity       int not null default 1,
  price_snapshot numeric not null,
  pricing_type   text not null,
  created_at     timestamptz not null default now()
);
alter table public.booking_extras enable row level security;
drop policy if exists "bextras_access" on public.booking_extras;
create policy "bextras_access" on public.booking_extras for all
  using (auth.uid() in (
    select b.renter from public.bookings b where b.id = booking_id
    union
    select l.owner from public.bookings b join public.listings l on l.id = b.listing_id where b.id = booking_id
  ));

create table if not exists public.booking_transport (
  id                  uuid primary key default gen_random_uuid(),
  booking_id          uuid references public.bookings(id) on delete cascade,
  transport_option_id uuid references public.transport_options(id) on delete set null,
  transport_name      text not null,
  price_snapshot      numeric not null,
  pricing_mode        text not null,
  created_at          timestamptz not null default now()
);
alter table public.booking_transport enable row level security;
drop policy if exists "btransport_access" on public.booking_transport;
create policy "btransport_access" on public.booking_transport for all
  using (auth.uid() in (
    select b.renter from public.bookings b where b.id = booking_id
    union
    select l.owner from public.bookings b join public.listings l on l.id = b.listing_id where b.id = booking_id
  ));
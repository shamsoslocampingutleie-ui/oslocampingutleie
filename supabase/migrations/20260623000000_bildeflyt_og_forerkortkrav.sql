-- ============================================================
-- BILDEFLYT + FØRERKORT (2026-06-23)
-- ============================================================

-- 1) Førerkort på profiles
alter table public.profiles
  add column if not exists drivers_license_front text default null,
  add column if not exists drivers_license_back  text default null,
  add column if not exists drivers_license_verified boolean not null default false;

-- 2) Booking-dokumenter (før/etter-bilder, førerkort knyttet til booking)
create table if not exists public.booking_documents (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid references public.bookings(id) on delete cascade,
  user_id     uuid references public.profiles(id) on delete set null,
  type        text not null check (type in ('before_photos','after_photos','drivers_license','damage_evidence')),
  url         text not null,
  note        text,
  created_at  timestamptz not null default now()
);
alter table public.booking_documents enable row level security;

-- Utleier og leietaker i samme booking kan se dokumenter
drop policy if exists "booking_docs_select" on public.booking_documents;
create policy "booking_docs_select" on public.booking_documents for select
  using (
    auth.uid() = user_id
    or auth.uid() in (
      select b.renter from public.bookings b where b.id = booking_id
      union
      select l.owner from public.bookings b
        join public.listings l on l.id = b.listing_id
       where b.id = booking_id
    )
  );

drop policy if exists "booking_docs_insert" on public.booking_documents;
create policy "booking_docs_insert" on public.booking_documents for insert
  with check (auth.uid() = user_id);

-- 3) Storage-buckets
insert into storage.buckets (id, name, public)
  values ('drivers-license', 'drivers-license', false)
  on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
  values ('booking-photos', 'booking-photos', false)
  on conflict (id) do nothing;

-- Tilgangspolicyer for drivers-license (kun eieren)
drop policy if exists "license_upload" on storage.objects;
create policy "license_upload" on storage.objects for insert
  with check (bucket_id = 'drivers-license' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "license_read" on storage.objects;
create policy "license_read" on storage.objects for select
  using (bucket_id = 'drivers-license' and auth.uid()::text = (storage.foldername(name))[1]);

-- Tilgangspolicyer for booking-photos (partene i bookingen)
drop policy if exists "booking_photos_upload" on storage.objects;
create policy "booking_photos_upload" on storage.objects for insert
  with check (bucket_id = 'booking-photos' and auth.uid() is not null);

drop policy if exists "booking_photos_read" on storage.objects;
create policy "booking_photos_read" on storage.objects for select
  using (bucket_id = 'booking-photos' and auth.uid() is not null);
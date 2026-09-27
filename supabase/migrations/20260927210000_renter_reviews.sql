-- Renter reviews: hosts rate/review renters after a completed booking.
--
-- Why: the platform already has one-directional trust -- renters review
-- listings (public.reviews), visible to everyone browsing. But nothing
-- let a host warn future hosts about a bad renter (late return, damage,
-- no-show, rude at handover). For a peer-to-peer marketplace whose own
-- liability language puts responsibility squarely on host and renter
-- ("ansvaret ligger hos utleier og leietaker"), giving hosts zero way to
-- act on that responsibility -- no track record, no accountability
-- signal before accepting a stranger's booking request -- was a real
-- trust & safety gap, not just a missing nice-to-have.
--
-- Deliberately mirrors public.reviews' shape and insert/select pattern
-- (one row per booking, inserted by the reviewing party once the
-- booking is completed) rather than inventing a new convention.
create table if not exists public.renter_reviews (
  id bigint generated always as identity primary key,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  host_id uuid not null references public.profiles(id) on delete cascade,
  renter_id uuid references public.profiles(id) on delete cascade,
  renter_name text not null default '',
  rating smallint not null check (rating >= 1 and rating <= 5),
  text text not null default '',
  created_at timestamptz not null default now(),
  unique (booking_id)
);
alter table public.renter_reviews enable row level security;

drop policy if exists renter_reviews_insert on public.renter_reviews;
create policy renter_reviews_insert on public.renter_reviews for insert
  with check (
    host_id = auth.uid()
    and exists (
      select 1 from public.bookings b
      join public.listings l on l.id = b.listing_id
      where b.id = booking_id and l.owner = auth.uid() and b.status = 'completed'
    )
  );

-- Logged-in only, not fully public like listing reviews (using(true)) --
-- this is reputation data about individual people, not marketing
-- content for equipment; visible to any authenticated user (any host
-- deciding whether to accept a request) and to the renter themselves,
-- never to anonymous visitors.
drop policy if exists renter_reviews_select on public.renter_reviews;
create policy renter_reviews_select on public.renter_reviews for select
  using (auth.uid() is not null);

drop policy if exists renter_reviews_delete on public.renter_reviews;
create policy renter_reviews_delete on public.renter_reviews for delete
  using (public.is_admin());

create index if not exists renter_reviews_renter_id_idx on public.renter_reviews (renter_id);
create index if not exists renter_reviews_booking_id_idx on public.renter_reviews (booking_id);

-- Mirrors bookings.reviewed (renter reviewed the listing); this is the
-- other direction -- host reviewed the renter.
alter table public.bookings add column if not exists renter_reviewed boolean not null default false;

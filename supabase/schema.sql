-- Leieplattform - Supabase schema
-- Kjores i Supabase SQL Editor. Trygt a kjore flere ganger.
-- Legger kun til det som mangler, endrer ikke eksisterende data.

-- 1) PROFILES
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists role text not null default 'user';
alter table public.profiles add column if not exists mode text not null default 'rent';
alter table public.profiles add column if not exists updated_at timestamptz not null default now();
alter table public.profiles add column if not exists avatar_url text not null default '';
alter table public.profiles add column if not exists bio text not null default '';
alter table public.profiles add column if not exists phone text not null default '';

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_role_check'
  ) then
    alter table public.profiles add constraint profiles_role_check check (role in ('user', 'admin'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_mode_check'
  ) then
    alter table public.profiles add constraint profiles_mode_check check (mode in ('rent', 'host'));
  end if;
end $$;

comment on table public.profiles is 'Public profile linked to auth.users.';

-- Auto-create profile row when a user signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;

  insert into public.registration_log (user_id, email, full_name, phone)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'phone'
  );

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 2) LISTINGS
create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles (id) on delete cascade,
  category text not null,
  title text not null,
  location text not null,
  price_per_day numeric(10, 2) not null check (price_per_day >= 0),
  deposit numeric(10, 2) not null default 0 check (deposit >= 0),
  deposit_mode text not null default 'upfront',
  min_days int not null default 1 check (min_days >= 1),
  status text not null default 'active',
  specs jsonb not null default '[]'::jsonb,
  feats jsonb not null default '[]'::jsonb,
  description text not null default '',
  terms text not null default '',
  created_at timestamptz not null default now()
);

alter table public.listings add column if not exists cleaning_fee numeric(10, 2) not null default 0 check (cleaning_fee >= 0);
alter table public.listings add column if not exists rating numeric(2, 1) not null default 0;
alter table public.listings add column if not exists reviews_count int not null default 0;
alter table public.listings add column if not exists blocked_dates jsonb not null default '[]'::jsonb;
alter table public.listings add column if not exists updated_at timestamptz not null default now();

do $$ begin
  -- Drop and recreate category check to include all supported categories
  alter table public.listings drop constraint if exists listings_category_check;
  alter table public.listings add constraint listings_category_check
    check (category in ('camping', 'mobil', 'car', 'boat', 'trailer', 'tool', 'tent', 'maskiner', 'fritid', 'stillas', 'diverse'));
  if not exists (
    select 1 from pg_constraint where conname = 'listings_category_check'
  ) then
    alter table public.listings add constraint listings_category_check
      check (category in ('camping', 'mobil', 'car', 'boat', 'trailer', 'tool', 'tent', 'maskiner', 'fritid', 'stillas', 'diverse'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'listings_deposit_mode_check'
  ) then
    alter table public.listings add constraint listings_deposit_mode_check
      check (deposit_mode in ('upfront', 'incident'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'listings_status_check'
  ) then
    alter table public.listings add constraint listings_status_check
      check (status in ('active', 'paused'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'listings_rating_check'
  ) then
    alter table public.listings add constraint listings_rating_check
      check (rating >= 0 and rating <= 5);
  end if;
end $$;

comment on table public.listings is 'Listings created by hosts.';

create index if not exists listings_owner_idx on public.listings (owner);
create index if not exists listings_category_idx on public.listings (category);
create index if not exists listings_status_idx on public.listings (status);

-- 3) BOOKINGS
create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  renter uuid references public.profiles (id) on delete set null,
  renter_name text not null,
  from_date date not null,
  to_date date not null,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

alter table public.bookings add column if not exists renter_email text not null default '';
alter table public.bookings add column if not exists updated_at timestamptz not null default now();
alter table public.bookings add column if not exists host_confirmed_handover boolean not null default false;
alter table public.bookings add column if not exists renter_confirmed_handover boolean not null default false;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'bookings_status_check'
  ) then
    alter table public.bookings add constraint bookings_status_check
      check (status in ('pending', 'accepted', 'declined', 'cancelled', 'completed'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'bookings_dates_valid'
  ) then
    alter table public.bookings add constraint bookings_dates_valid check (to_date > from_date);
  end if;
end $$;

comment on table public.bookings is 'Booking requests for a listing.';

create index if not exists bookings_listing_id_idx on public.bookings (listing_id);
create index if not exists bookings_renter_idx on public.bookings (renter);
create index if not exists bookings_renter_email_idx on public.bookings (renter_email);
create index if not exists bookings_status_idx on public.bookings (status);

-- 4) updated_at triggers
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute procedure public.set_updated_at();

drop trigger if exists listings_set_updated_at on public.listings;
create trigger listings_set_updated_at
  before update on public.listings
  for each row execute procedure public.set_updated_at();

drop trigger if exists bookings_set_updated_at on public.bookings;
create trigger bookings_set_updated_at
  before update on public.bookings
  for each row execute procedure public.set_updated_at();

-- Prevent double-booking: block accepting a booking whose dates overlap
-- another already-accepted booking on the same listing.
create or replace function public.prevent_double_booking()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.status = 'accepted' and (old is null or old.status is distinct from 'accepted') then
    if exists (
      select 1 from public.bookings b
      where b.listing_id = new.listing_id
        and b.id <> new.id
        and b.status = 'accepted'
        and b.from_date < new.to_date
        and b.to_date > new.from_date
    ) then
      raise exception 'DOUBLE_BOOKING: Denne perioden er allerede akseptert for en annen leietaker.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_double_booking on public.bookings;
create trigger trg_prevent_double_booking
  before insert or update on public.bookings
  for each row execute function public.prevent_double_booking();

-- Lock down financial/audit fields on bookings so only edge functions
-- (service_role) or admins can set them — a renter/host issuing a raw
-- client update could otherwise fake paid/accepted status, payouts,
-- or refunds. See protect_profile_fields() for the same pattern.
create or replace function public.protect_booking_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  if public.is_admin() then
    return new;
  end if;
  new.payment_intent_id := old.payment_intent_id;
  new.paid := old.paid;
  new.amount_total := old.amount_total;
  new.platform_fee := old.platform_fee;
  new.payout_released := old.payout_released;
  new.transfer_id := old.transfer_id;
  new.stripe_customer_details := old.stripe_customer_details;
  new.refund_id := old.refund_id;
  new.refund_amount := old.refund_amount;
  new.cancelled_by := old.cancelled_by;
  new.cancelled_at := old.cancelled_at;
  new.renter_ip := old.renter_ip;
  new.listing_id := old.listing_id;
  new.renter := old.renter;
  new.from_date := old.from_date;
  new.to_date := old.to_date;

  -- host_confirmed_handover / renter_confirmed_handover are deliberately
  -- client-settable (that's how confirmHandover() works), but each can
  -- only be changed by the party it actually represents -- otherwise
  -- either side could fake the OTHER party's confirmation and force
  -- stripe-release-payout to fire without a real mutual handover. See
  -- 20260925100000_protect_handover_confirmation_fields.sql.
  if new.host_confirmed_handover is distinct from old.host_confirmed_handover then
    if not exists (
      select 1 from public.listings l
      where l.id = old.listing_id and l.owner = auth.uid()
    ) then
      new.host_confirmed_handover := old.host_confirmed_handover;
    end if;
  end if;

  if new.renter_confirmed_handover is distinct from old.renter_confirmed_handover then
    if old.renter is distinct from auth.uid() then
      new.renter_confirmed_handover := old.renter_confirmed_handover;
    end if;
  end if;

  -- Only the listing owner (or admin/service_role, already returned above)
  -- may move a booking into 'accepted' or 'declined' -- that's the host's
  -- approval decision. Without this a renter could self-accept their own
  -- pending request via a direct client update, skipping host approval
  -- entirely (and, for non-instant-book listings, unlocking the "Betal
  -- med Stripe" button, which only checks status === 'accepted').
  if new.status is distinct from old.status and new.status in ('accepted', 'declined') then
    if not exists (
      select 1 from public.listings l
      where l.id = old.listing_id and l.owner = auth.uid()
    ) then
      new.status := old.status;
    end if;
  end if;

  -- reviews_insert requires status = 'completed' before a review can be
  -- posted, so 'completed' must never be reachable without a real mutual
  -- handover -- otherwise a renter could fabricate a review on any
  -- listing via a free, never-accepted booking request. Only allow it
  -- when both confirmation flags are genuinely true in this same row
  -- (see 20260925120000_protect_completed_status.sql).
  if new.status is distinct from old.status and new.status = 'completed' then
    if not (coalesce(new.host_confirmed_handover, false) and coalesce(new.renter_confirmed_handover, false)) then
      new.status := old.status;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists protect_booking_fields_trigger on public.bookings;
create trigger protect_booking_fields_trigger
  before update on public.bookings
  for each row execute function public.protect_booking_fields();

-- 5) Row Level Security (RLS)
alter table public.profiles enable row level security;
alter table public.listings enable row level security;
alter table public.bookings enable row level security;

-- PROFILES
drop policy if exists "Profiles are viewable by everyone" on public.profiles;
create policy "Profiles are viewable by everyone"
  on public.profiles for select
  using (true);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- LISTINGS
drop policy if exists "Active listings are viewable by everyone" on public.listings;
create policy "Active listings are viewable by everyone"
  on public.listings for select
  using (status = 'active' or owner = auth.uid());

drop policy if exists "Owners can insert their listings" on public.listings;
create policy "Owners can insert their listings"
  on public.listings for insert
  with check (owner = auth.uid());

drop policy if exists "Owners can update their listings" on public.listings;
create policy "Owners can update their listings"
  on public.listings for update
  using (owner = auth.uid());

drop policy if exists "Owners can delete their listings" on public.listings;
create policy "Owners can delete their listings"
  on public.listings for delete
  using (owner = auth.uid());

drop policy if exists "Admins can delete any listing" on public.listings;
create policy "Admins can delete any listing"
  on public.listings for delete
  using (public.is_admin());

-- Row ownership alone isn't enough for DELETE: bookings.listing_id is
-- "on delete cascade", so without this a host could delete a listing
-- with a paid/accepted/completed booking still attached and silently
-- wipe out that booking's entire financial/audit trail (and any review
-- referencing it) -- e.g. to destroy evidence after a payment dispute.
-- See 20260925130000_prevent_listing_deletion_with_booking_history.sql.
create or replace function public.prevent_listing_deletion_with_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return old;
  end if;
  if public.is_admin() then
    return old;
  end if;

  if exists (
    select 1 from public.bookings b
    where b.listing_id = old.id
      and (b.paid = true or b.status in ('pending_payment', 'accepted', 'completed'))
  ) then
    raise exception 'LISTING_HAS_BOOKINGS: Denne annonsen har bookinger med betaling eller en gjennomført leie, og kan ikke slettes. Sett den til Pauset i stedet.';
  end if;

  return old;
end;
$$;

drop trigger if exists prevent_listing_deletion_with_history_trigger on public.listings;
create trigger prevent_listing_deletion_with_history_trigger
  before delete on public.listings
  for each row execute function public.prevent_listing_deletion_with_history();

-- BOOKINGS
drop policy if exists "Renters can view own bookings" on public.bookings;
create policy "Renters can view own bookings"
  on public.bookings for select
  using (
    renter = auth.uid()
    or exists (
      select 1 from public.listings l
      where l.id = bookings.listing_id and l.owner = auth.uid()
    )
  );

drop policy if exists "Renters can create bookings" on public.bookings;
create policy "Renters can create bookings"
  on public.bookings for insert
  with check (renter = auth.uid());

-- NOTE: an earlier version of this policy added a WITH CHECK clause
-- with a subquery back onto bookings itself (comparing NEW to OLD
-- per protected column) to stop renter/host from faking paid/status/
-- payout fields. That pattern causes Postgres to raise "infinite
-- recursion detected in policy for relation bookings" for every
-- update a real renter or host makes (42P17) — it is not a viable
-- pattern for self-referencing checks. Field protection now lives in
-- protect_booking_fields() below (a BEFORE UPDATE trigger, which reads
-- OLD/NEW directly with no RLS re-entry), so this policy only needs to
-- gate row ownership.
drop policy if exists "Renter can update own non-critical fields" on public.bookings;
drop policy if exists "Host can update own listing bookings" on public.bookings;
drop policy if exists "Renter or host can update bookings" on public.bookings;
drop policy if exists "Admins can delete any booking" on public.bookings;
create policy "Admins can delete any booking"
  on public.bookings for delete
  using (public.is_admin());

create policy "bookings_update_owner"
  on public.bookings for update
  using (
    renter = auth.uid()
    or exists (
      select 1 from public.listings l
      where l.id = bookings.listing_id and l.owner = auth.uid()
    )
  )
  with check (
    renter = auth.uid()
    or exists (
      select 1 from public.listings l
      where l.id = bookings.listing_id and l.owner = auth.uid()
    )
  );

-- 6) Step 3 additions

-- Optional Stripe payment link per listing
alter table public.listings add column if not exists stripe_link text not null default '';

-- Let everyone see accepted booking dates, so the availability
-- calendar works for visitors who are not logged in.
drop policy if exists "Accepted bookings are viewable for availability" on public.bookings;
create policy "Accepted bookings are viewable for availability"
  on public.bookings for select
  using (status = 'accepted');

-- 7) Profile avatars (Supabase Storage)
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "Avatar images are publicly accessible" on storage.objects;
create policy "Avatar images are publicly accessible"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "Users can upload their own avatar" on storage.objects;
create policy "Users can upload their own avatar"
  on storage.objects for insert
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can update their own avatar" on storage.objects;
create policy "Users can update their own avatar"
  on storage.objects for update
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can delete their own avatar" on storage.objects;
create policy "Users can delete their own avatar"
  on storage.objects for delete
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- 8) Email notifications to hosts on new booking requests (via Resend)
create extension if not exists pg_net;
create extension if not exists supabase_vault;

-- NOTE: After running this file, set your Resend API key once (do NOT commit it):
--   select vault.create_secret('re_xxxxxxxxxxxxxxxxxxxxxxxx', 'resend_api_key');
-- And update the "from" address below to a verified sender on your Resend domain.

create or replace function public.notify_host_new_booking()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_host_email text;
  v_host_name text;
  v_listing_title text;
  v_api_key text;
begin
  select p.email, p.full_name, l.title
    into v_host_email, v_host_name, v_listing_title
  from public.listings l
  join public.profiles p on p.id = l.owner
  where l.id = new.listing_id;

  select decrypted_secret into v_api_key
  from vault.decrypted_secrets where name = 'resend_api_key';

  if v_api_key is null or v_host_email is null then
    return new;
  end if;

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_api_key,
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'from', 'Leieplattform <varsler@leieplattform.no>',
      'to', v_host_email,
      'subject', 'Ny leieforespørsel: ' || v_listing_title,
      'html',
        '<div style="font-family:''Helvetica Neue'',Arial,sans-serif;max-width:480px;margin:0 auto;background:#F7F5F0;border-radius:16px;overflow:hidden">' ||
          '<div style="background:#14512E;padding:28px 32px">' ||
            '<p style="margin:0;color:#CFE3D5;font-size:12px;letter-spacing:.12em;text-transform:uppercase;font-weight:600">Leieplattform</p>' ||
            '<h1 style="margin:8px 0 0;color:#ffffff;font-size:22px;font-weight:700;font-family:inherit">Ny leieforespørsel</h1>' ||
          '</div>' ||
          '<div style="padding:28px 32px">' ||
            '<p style="margin:0 0 16px;color:#15201A;font-size:16px;line-height:1.6">Hei ' || coalesce(v_host_name, '') || ',</p>' ||
            '<p style="margin:0 0 24px;color:#15201A;font-size:16px;line-height:1.6"><strong>' || new.renter_name || '</strong> ønsker å leie <strong>' || v_listing_title || '</strong> fra <strong>' || new.from_date || '</strong> til <strong>' || new.to_date || '</strong>.</p>' ||
            '<a href="https://leieplattform.no/?view=requests" style="display:inline-block;padding:13px 28px;background:#14512E;color:#ffffff;text-decoration:none;border-radius:999px;font-weight:600;font-size:15px">Logg inn og se forespørselen</a>' ||
            '<p style="margin:28px 0 0;color:#6B776E;font-size:13px;line-height:1.6">Denne e-posten kan ikke besvares. Logg inn på <a href="https://leieplattform.no/" style="color:#14512E;text-decoration:underline">leieplattform.no</a> for å se og administrere alt.</p>' ||
          '</div>' ||
        '</div>'
    )
  );

  return new;
end;
$$;

drop trigger if exists on_booking_created_notify_host on public.bookings;
create trigger on_booking_created_notify_host
  after insert on public.bookings
  for each row execute procedure public.notify_host_new_booking();

-- 9) Stripe Connect (platform takes a cut on each booking payment)
-- stripe_account_id: the host's connected Express account (acct_...)
-- stripe_charges_enabled: true once the host has finished Stripe onboarding
alter table public.profiles add column if not exists stripe_account_id text not null default '';
alter table public.profiles add column if not exists stripe_charges_enabled boolean not null default false;

-- payment_intent_id / amount_total / platform_fee are filled in by the
-- stripe-webhook edge function (service role) once payment succeeds.
alter table public.bookings add column if not exists payment_intent_id text not null default '';
alter table public.bookings add column if not exists paid boolean not null default false;
alter table public.bookings add column if not exists amount_total numeric(10, 2);
alter table public.bookings add column if not exists platform_fee numeric(10, 2);

-- Funds are held by the platform until both host and renter confirm
-- handover (host_confirmed_handover + renter_confirmed_handover). Only
-- then is the host's share transferred out, via stripe-release-payout.
alter table public.bookings add column if not exists payout_released boolean not null default false;
alter table public.bookings add column if not exists transfer_id text not null default '';

-- 10) Admin access (RLS bypass for role = 'admin')
-- The admin panel lists/pauses ALL listings and views ALL bookings,
-- but the policies above only let owners/renters see or change their own
-- rows. Without this, admin actions silently no-op (RLS blocks the write)
-- and admins only see their own data.
create or replace function public.is_admin()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

drop policy if exists "Admins can view all listings" on public.listings;
create policy "Admins can view all listings"
  on public.listings for select
  using (public.is_admin());

drop policy if exists "Admins can update any listing" on public.listings;
create policy "Admins can update any listing"
  on public.listings for update
  using (public.is_admin());

drop policy if exists "Admins can view all bookings" on public.bookings;
create policy "Admins can view all bookings"
  on public.bookings for select
  using (public.is_admin());

drop policy if exists "Admins can update any booking" on public.bookings;
create policy "Admins can update any booking"
  on public.bookings for update
  using (public.is_admin());

-- 11) Instant booking: hosts can let renters book without approval.
-- When true, new booking requests for this listing are created with
-- status "accepted" right away instead of "pending".
alter table public.listings add column if not exists instant_book boolean not null default false;

-- 12) Listing photos (Supabase Storage)
alter table public.listings add column if not exists images jsonb not null default '[]'::jsonb;

insert into storage.buckets (id, name, public)
values ('listing-images', 'listing-images', true)
on conflict (id) do nothing;

-- Files are stored under <owner-uuid>/<filename>. Owners (and admins) can
-- manage their own folder; anyone can view (bucket is public).
drop policy if exists "Listing images are publicly accessible" on storage.objects;
create policy "Listing images are publicly accessible"
  on storage.objects for select
  using (bucket_id = 'listing-images');

drop policy if exists "Owners can upload listing images" on storage.objects;
create policy "Owners can upload listing images"
  on storage.objects for insert
  with check (bucket_id = 'listing-images' and (auth.uid()::text = (storage.foldername(name))[1] or public.is_admin()));

drop policy if exists "Owners can update listing images" on storage.objects;
create policy "Owners can update listing images"
  on storage.objects for update
  using (bucket_id = 'listing-images' and (auth.uid()::text = (storage.foldername(name))[1] or public.is_admin()));

drop policy if exists "Owners can delete listing images" on storage.objects;
create policy "Owners can delete listing images"
  on storage.objects for delete
  using (bucket_id = 'listing-images' and (auth.uid()::text = (storage.foldername(name))[1] or public.is_admin()));

-- 13) Account suspension
-- Suspended users keep their account/data but cannot log in or use the
-- platform until an admin lifts the suspension. Hard deletion of a user
-- (auth.users row) is handled by the "admin-delete-user" edge function,
-- which cascades to profiles/listings/bookings via "on delete cascade".
alter table public.profiles add column if not exists suspended boolean not null default false;

drop policy if exists "Admins can update any profile" on public.profiles;
create policy "Admins can update any profile"
  on public.profiles for update
  using (public.is_admin());

-- 14) Indexes for messages/reviews lookups (tables created separately)
create index if not exists messages_booking_id_idx on public.messages (booking_id);
create index if not exists reviews_listing_id_idx on public.reviews (listing_id);

-- 15) Prevent users from escalating their own privileges. The
-- "Users can update own profile" policy lets any user update their own
-- row, but has no column-level restriction — without this trigger a
-- user could PATCH their own profile to set role=admin, suspended=false,
-- or fake stripe_account_id/stripe_charges_enabled. Admins (checked via
-- is_admin()) and the service role (used by edge functions) can still
-- change these fields normally.
-- fee_waiver_until (added 2026-09-22): a host keeps 100% of rent (no
-- host-side platform fee) on bookings until this timestamp. Set
-- automatically for one year the instant host_approved transitions to
-- true, below — never directly client-writable, same protection pattern
-- as host_approved/host_id_status. See migrations/20260922120000_*.sql.
alter table public.profiles
  add column if not exists fee_waiver_until timestamptz default null;

create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_privileged boolean;
begin
  is_privileged := auth.role() = 'service_role'
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');

  if not is_privileged then
    new.role := old.role;
    new.suspended := old.suspended;
    new.stripe_account_id := old.stripe_account_id;
    new.stripe_charges_enabled := old.stripe_charges_enabled;

    new.drivers_license_verified := old.drivers_license_verified;
    new.drivers_license_admin_reviewed := old.drivers_license_admin_reviewed;
    new.host_id_reviewed_at := old.host_id_reviewed_at;
    new.host_id_reject_reason := old.host_id_reject_reason;

    if new.host_approved is distinct from old.host_approved then
      if new.host_approved is distinct from false then
        new.host_approved := old.host_approved;
      end if;
    end if;

    if new.host_id_status is distinct from old.host_id_status then
      if new.host_id_status is distinct from 'pending' then
        new.host_id_status := old.host_id_status;
      end if;
    end if;

    -- Never directly client-writable; only the block below (which runs
    -- for every actor, privileged or not) sets it.
    new.fee_waiver_until := old.fee_waiver_until;
  end if;

  -- Start (or restart) the free-year clock exactly when host_approved
  -- legitimately flips to true. For a non-privileged actor this only
  -- fires if new.host_approved somehow survived the block above as true,
  -- which it can't -- so a self-approval attempt never grants a waiver.
  if new.host_approved is true and old.host_approved is distinct from true then
    new.fee_waiver_until := now() + interval '1 year';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_profile_fields_trigger on public.profiles;
create trigger protect_profile_fields_trigger
  before update on public.profiles
  for each row execute function public.protect_profile_fields();

-- 16) Client-side error log, for basic error monitoring. Any client
-- (including anonymous visitors) can report an error; only admins can
-- read the log (visible in the admin dashboard).
create table if not exists public.error_logs (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid references public.profiles(id) on delete set null,
  message text not null,
  stack text,
  url text,
  user_agent text,
  constraint error_logs_message_len check (char_length(message) <= 2000),
  constraint error_logs_stack_len check (stack is null or char_length(stack) <= 4000)
);
alter table public.error_logs enable row level security;

drop policy if exists error_logs_insert on public.error_logs;
create policy error_logs_insert on public.error_logs for insert with check (true);

drop policy if exists error_logs_read on public.error_logs;
create policy error_logs_read on public.error_logs for select using (public.is_admin());

drop policy if exists error_logs_delete on public.error_logs;
create policy error_logs_delete on public.error_logs for delete using (public.is_admin());

create index if not exists error_logs_created_at_idx on public.error_logs (created_at desc);

-- 17) Tighten the (unused) "listing-photos" storage bucket to match
-- "listing-images": only the owner of a per-user folder, or an admin, may
-- upload into it.
drop policy if exists photos_write on storage.objects;
create policy photos_write on storage.objects for insert
  with check (
    bucket_id = 'listing-photos'
    and (auth.uid()::text = (storage.foldername(name))[1] or public.is_admin())
  );

-- 18) Require renter contact details (phone, address) before payment, so
-- bookings can be traced and hosts/admins can reach the renter. The values
-- are snapshotted onto the booking (separate from the profile) so they
-- remain even if the renter later edits their profile. The IP address at
-- checkout time and Stripe's own verified billing details are stored for
-- fraud prevention / dispute resolution (see privacy policy).
alter table public.profiles add column if not exists address text not null default '';

alter table public.bookings add column if not exists renter_phone text not null default '';
alter table public.bookings add column if not exists renter_address text not null default '';
alter table public.bookings add column if not exists renter_ip text not null default '';
alter table public.bookings add column if not exists stripe_customer_details jsonb;

-- 19) Listing cancellation policy, transport delivery fee, and transport description.
--     Also fixes the category constraint to include 'tent' and 'maskiner'
--     which are offered in the app but were missing from the check.
alter table public.listings add column if not exists cancel_policy text not null default 'host';
alter table public.listings add column if not exists transport_fee numeric(10,2) not null default 0 check (transport_fee >= 0);
alter table public.listings add column if not exists transport_desc text not null default '';

-- Drop and re-create the category constraint (all 11 supported categories)
alter table public.listings drop constraint if exists listings_category_check;
alter table public.listings add constraint listings_category_check
  check (category in ('camping','mobil','car','boat','trailer','tool','tent','maskiner','fritid','stillas','diverse'));

-- 20) Transport opt-in and post-rental extra charges on bookings.
alter table public.bookings add column if not exists wants_transport boolean not null default false;
alter table public.bookings add column if not exists extra_charges jsonb not null default '{}'::jsonb;

-- 21) Persistent chat messages between host and renter (off-platform
--     contact detection + admin oversight happen in the app layer).
-- NOTE: id is uuid and booking_id is plain text on the live table —
-- this create-table statement is a no-op there (table already exists)
-- and is kept here only for a fresh install. booking_id can't be a
-- real FK to bookings(id) because it also holds the non-booking
-- 'direct-<userId>' and 'inquiry:<listingId>:<renterId>' thread keys
-- described where messages_select/insert/update are defined below.
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  booking_id text not null,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  sender_name text not null default '',
  sender_role text not null default 'renter',
  text text not null,
  flagged boolean not null default false,
  flag_reason text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.messages enable row level security;

-- NOTE: booking_id also accepts two text-based (non-FK) conventions,
-- neither of which points at a real bookings row:
--   'direct-<userId>'              — admin <-> user 1:1 support chat
--   'inquiry:<listingId>:<renterId>' — pre-booking question about a
--                                      listing, before any booking
--                                      exists (see 20260913090000
--                                      migration for why this replaced
--                                      the earlier, broken approach of
--                                      inserting a fake bookings row).
-- is_admin() must be checked here too, not just on select/update: admin
-- needs to be able to send the FIRST message in a brand new
-- direct-<userId> thread, which the direct-% clause below can't grant
-- since <userId> there is never the admin's own id (found live —
-- admin could reply once a user wrote first, but never start a chat).
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert
  with check (
    sender_id = auth.uid()
    and (
      public.is_admin()
      or exists (
        select 1 from public.bookings b
        where b.id::text = booking_id
          and (
            b.renter = auth.uid()
            or exists (select 1 from public.listings l where l.id = b.listing_id and l.owner = auth.uid())
          )
      )
      or (booking_id like 'direct-%' and booking_id = 'direct-' || auth.uid()::text)
      or (
        booking_id like 'inquiry:%'
        and (
          split_part(booking_id, ':', 3) = auth.uid()::text
          or exists (
            select 1 from public.listings l
            where l.id::text = split_part(booking_id, ':', 2) and l.owner = auth.uid()
          )
        )
      )
    )
  );

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select
  using (
    public.is_admin()
    or exists (
      select 1 from public.bookings b
      where b.id::text = booking_id
        and (
          b.renter = auth.uid()
          or exists (select 1 from public.listings l where l.id = b.listing_id and l.owner = auth.uid())
        )
    )
    or (booking_id like 'direct-%' and booking_id = 'direct-' || auth.uid()::text)
    or (
      booking_id like 'inquiry:%'
      and (
        split_part(booking_id, ':', 3) = auth.uid()::text
        or exists (
          select 1 from public.listings l
          where l.id::text = split_part(booking_id, ':', 2) and l.owner = auth.uid()
        )
      )
    )
  );

drop policy if exists "messages_delete" on public.messages;
create policy "messages_delete" on public.messages for delete
  using (public.is_admin());

-- Manglet helt: uten denne feilet all "merk som lest" (read_at) stille,
-- både i vanlig booking-chat og i admin sin direktemelding-varselprikk.
--
-- NOTE: the first version of this policy tried to lock every other
-- column with a WITH CHECK subquery comparing NEW to OLD via
-- "(select m.col from public.messages m where m.id = messages.id)".
-- That pattern makes Postgres raise "infinite recursion detected in
-- policy for relation messages" (42P17) on every single update — it
-- silently broke this feature from the moment it was added. Field
-- protection now lives in protect_message_fields() below (a trigger,
-- which reads OLD/NEW directly with no RLS re-entry); this policy only
-- gates who may touch the row at all.
drop policy if exists messages_update on public.messages;
create policy messages_update on public.messages for update
  using (
    public.is_admin()
    or exists (
      select 1 from public.bookings b
      where b.id::text = booking_id
        and (
          b.renter = auth.uid()
          or exists (select 1 from public.listings l where l.id = b.listing_id and l.owner = auth.uid())
        )
    )
    or (booking_id like 'direct-%' and booking_id = 'direct-' || auth.uid()::text)
    or (
      booking_id like 'inquiry:%'
      and (
        split_part(booking_id, ':', 3) = auth.uid()::text
        or exists (
          select 1 from public.listings l
          where l.id::text = split_part(booking_id, ':', 2) and l.owner = auth.uid()
        )
      )
    )
  )
  with check (
    public.is_admin()
    or exists (
      select 1 from public.bookings b
      where b.id::text = booking_id
        and (
          b.renter = auth.uid()
          or exists (select 1 from public.listings l where l.id = b.listing_id and l.owner = auth.uid())
        )
    )
    or (booking_id like 'direct-%' and booking_id = 'direct-' || auth.uid()::text)
    or (
      booking_id like 'inquiry:%'
      and (
        split_part(booking_id, ':', 3) = auth.uid()::text
        or exists (
          select 1 from public.listings l
          where l.id::text = split_part(booking_id, ':', 2) and l.owner = auth.uid()
        )
      )
    )
  );

create or replace function public.protect_message_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  if public.is_admin() then
    return new;
  end if;
  new.booking_id := old.booking_id;
  new.sender_id := old.sender_id;
  new.sender_name := old.sender_name;
  new.sender_role := old.sender_role;
  new.text := old.text;
  new.flagged := old.flagged;
  new.flag_reason := old.flag_reason;
  new.created_at := old.created_at;
  return new;
end;
$$;

drop trigger if exists protect_message_fields_trigger on public.messages;
create trigger protect_message_fields_trigger
  before update on public.messages
  for each row execute function public.protect_message_fields();

create index if not exists messages_booking_id_idx2 on public.messages (booking_id);

-- 22) Reviews — persisted ratings from renters after completed bookings.
create table if not exists public.reviews (
  id bigint generated always as identity primary key,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id) on delete cascade,
  reviewer_name text not null default '',
  rating smallint not null check (rating >= 1 and rating <= 5),
  text text not null default '',
  created_at timestamptz not null default now()
);
alter table public.reviews enable row level security;

drop policy if exists reviews_insert on public.reviews;
create policy reviews_insert on public.reviews for insert
  with check (
    reviewer_id = auth.uid()
    and exists (
      select 1 from public.bookings b
      where b.id = booking_id and b.renter = auth.uid() and b.status = 'completed'
    )
  );

drop policy if exists reviews_select on public.reviews;
create policy reviews_select on public.reviews for select using (true);

create index if not exists reviews_listing_id_idx2 on public.reviews (listing_id);
create index if not exists reviews_booking_id_idx on public.reviews (booking_id);

-- reviewed flag on bookings — set true once a review is submitted
alter table public.bookings add column if not exists reviewed boolean not null default false;

-- 23) Analytics — real-time active visitors and event tracking.
create table if not exists public.active_visitors (
  session_id text primary key,
  country text not null default '',
  city text not null default '',
  flag text not null default '',
  current_page text not null default 'home',
  user_id uuid references public.profiles(id) on delete set null,
  user_name text,
  last_seen timestamptz not null default now()
);
alter table public.active_visitors enable row level security;

drop policy if exists active_visitors_upsert on public.active_visitors;
create policy active_visitors_upsert on public.active_visitors for all
  using (true) with check (true);

drop policy if exists active_visitors_read on public.active_visitors;
create policy active_visitors_read on public.active_visitors for select
  using (public.is_admin() or session_id = current_setting('app.session_id', true));

create table if not exists public.analytics_events (
  id bigint generated always as identity primary key,
  session_id text not null,
  event_type text not null,
  event_data jsonb,
  country text not null default '',
  city text not null default '',
  flag text not null default '',
  user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.analytics_events enable row level security;

drop policy if exists analytics_events_insert on public.analytics_events;
create policy analytics_events_insert on public.analytics_events for insert with check (true);

drop policy if exists analytics_events_read on public.analytics_events;
create policy analytics_events_read on public.analytics_events for select using (public.is_admin());

create index if not exists analytics_events_type_idx on public.analytics_events (event_type, created_at desc);
create index if not exists active_visitors_last_seen_idx on public.active_visitors (last_seen desc);

-- 24) Featured listings — admin can mark listings as featured so they
--     appear first in the grid and show a highlighted badge.
alter table public.listings add column if not exists featured boolean not null default false;

-- 25) Boosted listings — paid or admin-granted time-limited boost.
--     boosted_until: timestamp until which the listing is boosted.
--     Separate from featured (permanent admin highlight).
alter table public.listings add column if not exists boosted_until timestamptz;

-- 25b) awaiting_host_approval — see protect_listing_approval_gate() below
--      for the full explanation. True while the listing was created
--      before its owner was an approved host.
alter table public.listings add column if not exists awaiting_host_approval boolean not null default false;

-- 26) Cancellation & refund tracking on bookings.
alter table public.bookings add column if not exists cancelled_by text;
alter table public.bookings add column if not exists cancelled_at timestamptz;
alter table public.bookings add column if not exists refund_id text not null default '';
alter table public.bookings add column if not exists refund_amount numeric(10, 2);

-- 27) Auto-release cron: run send-handover-reminder daily at 09:00.
--     Sends handover reminders and auto-confirms + releases payout after 7 days.
--     Run once in Supabase SQL editor (replace <project-ref> and <service_role_key>):
--
--   select cron.schedule(
--     'send-handover-reminder',
--     '0 9 * * *',
--     $$select net.http_post(
--       url:='https://<project-ref>.supabase.co/functions/v1/send-handover-reminder',
--       headers:='{"Authorization":"Bearer <service_role_key>","Content-Type":"application/json"}'::jsonb,
--       body:='{}'::jsonb
--     ) as request_id$$
--   );

-- 28) REGISTRATION LOG — persistent, survives account deletion (no FK to auth.users)
--     Stores name, email, phone at registration time for fraud/security tracing.
create table if not exists public.registration_log (
  id uuid default gen_random_uuid() primary key,
  user_id uuid,                          -- stored as uuid but no FK constraint
  email text not null,
  full_name text,
  phone text,
  registered_at timestamptz not null default now()
);

-- Only service_role can read/write — no public access
alter table public.registration_log enable row level security;

-- Done. Example listings are inserted from the app itself (only if the
-- table is empty), since they must reference an existing auth user.

-- 29) NOTIFICATIONS — in-app varsler med Supabase Realtime
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  read boolean not null default false,
  data jsonb,
  created_at timestamptz not null default now()
);
alter table public.notifications enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='notifications' and policyname='notifications_own_select') then
    create policy "notifications_own_select" on public.notifications for select using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename='notifications' and policyname='notifications_own_update') then
    create policy "notifications_own_update" on public.notifications for update using (auth.uid() = user_id);
  end if;
end $$;
-- Aktiver Realtime for notifications
alter publication supabase_realtime add table public.notifications;

-- 30) BOOKING REMINDERS — påminnelser for ventende handlinger
-- Håndteres av send-handover-reminder edge function (cron 09:00 daglig)
-- Varsler sendes også in-app via notifications-tabellen

-- Indeks for raske oppslag
create index if not exists notifications_user_unread on public.notifications (user_id, read, created_at desc);

-- 31) RATE LIMITING — global rate limit via Supabase
create table if not exists public.rate_limits (
  key text primary key,
  count integer not null default 0,
  expires_at timestamptz not null
);
alter table public.rate_limits enable row level security;

create or replace function public.increment_rate_limit(
  p_key text,
  p_limit integer,
  p_ttl_seconds integer
) returns boolean
language plpgsql security definer
as $$
declare
  v_count integer;
  v_now timestamptz := now();
begin
  insert into public.rate_limits(key, count, expires_at)
    values (p_key, 1, v_now + (p_ttl_seconds || ' seconds')::interval)
  on conflict (key) do update
    set count = case
      when public.rate_limits.expires_at < v_now
        then 1
      else public.rate_limits.count + 1
    end,
    expires_at = case
      when public.rate_limits.expires_at < v_now
        then v_now + (p_ttl_seconds || ' seconds')::interval
      else public.rate_limits.expires_at
    end
  returning count into v_count;

  return v_count <= p_limit;
end;
$$;

-- Rydd opp utløpte rate limit entries med pg_cron (valgfritt)
-- select cron.schedule('cleanup-rate-limits', '*/5 * * * *',
--   $$delete from public.rate_limits where expires_at < now()$$);

-- 32) PUSH SUBSCRIPTIONS — Web Push (VAPID)
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='push_subscriptions' and policyname='push_subs_own') then
    create policy "push_subs_own" on public.push_subscriptions for all using (auth.uid() = user_id);
  end if;
end $$;
create index if not exists push_subs_user on public.push_subscriptions (user_id);

-- 33) Performance indexes for common query patterns at scale
-- listings: boosted/featured sorting used in home feed
create index if not exists listings_boosted_idx on public.listings (boosted_until desc nulls last) where status = 'active';
create index if not exists listings_featured_idx on public.listings (featured, created_at desc) where status = 'active';
-- bookings: host dashboard looks up bookings by listing owner (via listing_id join)
create index if not exists bookings_listing_status_idx on public.bookings (listing_id, status);
-- messages: unread count per booking
create index if not exists messages_created_at_idx on public.messages (booking_id, created_at desc);
-- analytics: cleanup of old events
create index if not exists analytics_events_created_idx on public.analytics_events (created_at desc);
-- active_visitors cleanup
create index if not exists active_visitors_session_seen_idx on public.active_visitors (session_id, last_seen desc);

-- ============================================================
-- BILDEFLYT + FØRERKORT (2026-06-23)
-- ============================================================

-- 1) Førerkort på profiles
alter table public.profiles
  add column if not exists drivers_license_front text default null,
  add column if not exists drivers_license_back  text default null,
  add column if not exists drivers_license_verified boolean not null default false,
  add column if not exists drivers_license_country  text default null;

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

-- Utleier og leietaker i samme booking kan se dokumenter, samt admin
drop policy if exists "booking_docs_select" on public.booking_documents;
create policy "booking_docs_select" on public.booking_documents for select
  using (
    auth.uid() = user_id
    or public.is_admin()
    or auth.uid() in (
      select b.renter from public.bookings b where b.id = booking_id
      union
      select l.owner from public.bookings b
        join public.listings l on l.id = b.listing_id
       where b.id = booking_id
    )
  );

drop policy if exists "booking_docs_delete" on public.booking_documents;
create policy "booking_docs_delete" on public.booking_documents for delete
  using (public.is_admin());

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

-- Tilgangspolicyer for drivers-license (eieren + admin for verifisering)
drop policy if exists "license_upload" on storage.objects;
create policy "license_upload" on storage.objects for insert
  with check (bucket_id = 'drivers-license' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "license_read" on storage.objects;
create policy "license_read" on storage.objects for select
  using (bucket_id = 'drivers-license' and (auth.uid()::text = (storage.foldername(name))[1] or public.is_admin()));

-- Manglet helt: uten denne feilet sletting av ID-dokumenter stille både
-- ved godkjenning/avvisning (admin) og når en bruker fjerner sitt eget
-- opplastede førerkort — dokumentene ble aldri faktisk slettet.
drop policy if exists "license_delete" on storage.objects;
create policy "license_delete" on storage.objects for delete
  using (bucket_id = 'drivers-license' and (auth.uid()::text = (storage.foldername(name))[1] or public.is_admin()));

-- Tilgangspolicyer for booking-photos (partene i bookingen)


-- Scoped 2026-09-24 (see migrations/20260924100000_scope_booking_photos_access.sql):
-- previously any authenticated user could read/write any booking's photo
-- folder here, not just its actual renter/host.
drop policy if exists "booking_photos_upload" on storage.objects;
create policy "booking_photos_upload" on storage.objects for insert
  with check (
    bucket_id = 'booking-photos'
    and (
      public.is_admin()
      or exists (
        select 1 from public.bookings b
        left join public.listings l on l.id = b.listing_id
        where b.id::text = (storage.foldername(name))[1]
          and (b.renter = auth.uid() or l.owner = auth.uid())
      )
    )
  );

drop policy if exists "booking_photos_read" on storage.objects;
create policy "booking_photos_read" on storage.objects for select
  using (
    bucket_id = 'booking-photos'
    and (
      public.is_admin()
      or exists (
        select 1 from public.bookings b
        left join public.listings l on l.id = b.listing_id
        where b.id::text = (storage.foldername(name))[1]
          and (b.renter = auth.uid() or l.owner = auth.uid())
      )
    )
  );

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
  using (public.is_admin() or auth.uid() in (select owner from public.listings where id = listing_id))
  with check (public.is_admin() or auth.uid() in (select owner from public.listings where id = listing_id));

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
  using (public.is_admin() or auth.uid() in (select owner from public.listings where id = listing_id))
  with check (public.is_admin() or auth.uid() in (select owner from public.listings where id = listing_id));

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

-- ============================================================
-- DISPOSABLE EMAIL BLOCKING (2026-09-22)
-- ============================================================
-- Server-side backstop for the client-side check in authRegister()
-- (src/app.html) -- see migrations/20260922130000_block_disposable_email_domains.sql
-- for the full explanation. Blocks signup via auth.users insert directly,
-- so it can't be bypassed by calling supabase.auth.signUp() outside the UI.

create or replace function public.reject_disposable_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  domain text;
  blocked text[] := array[
    'mailinator.com','tempmail.com','temp-mail.org','10minutemail.com','10minutemail.net',
    'guerrillamail.com','guerrillamail.info','guerrillamail.biz','guerrillamail.de',
    'sharklasers.com','yopmail.com','yopmail.fr','yopmail.net','throwawaymail.com',
    'trashmail.com','trashmail.net','getnada.com','fakeinbox.com','mailnesia.com',
    'mintemail.com','maildrop.cc','dispostable.com','spamgourmet.com','mytemp.email',
    'moakt.com','emailondeck.com','tempinbox.com','tempmailo.com','tempr.email',
    'harakirimail.com','mohmal.com','burnermail.io','33mail.com','mailcatch.com',
    'inboxkitten.com','discard.email','discardmail.com','spambog.com',
    'tempmailaddress.com','luxusmail.org','anonbox.net','mailsac.com','emailfake.com',
    'fakemailgenerator.com','crazymailing.com'
  ];
begin
  domain := lower(split_part(new.email, '@', 2));
  if domain = any(blocked) then
    raise exception 'Engangs-/midlertidige e-postadresser er ikke tillatt. Bruk din vanlige e-post.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists reject_disposable_email_trigger on auth.users;
create trigger reject_disposable_email_trigger
  before insert on auth.users
  for each row execute function public.reject_disposable_email();

-- ============================================================
-- LISTINGS AWAIT HOST APPROVAL (2026-09-24)
-- ============================================================
-- See migrations/20260924090000_listings_await_host_approval.sql for the
-- full explanation. Hosts can create listings while their application is
-- pending; this trigger stops the existing self-service Pause/Activate
-- toggle (hostListings() in src/app.html) from being used to bring one
-- live before an admin has actually approved the host.

create or replace function public.protect_listing_approval_gate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  if exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    return new;
  end if;

  if old.awaiting_host_approval is true then
    new.awaiting_host_approval := true;
    new.status := 'paused';
  end if;

  -- boosted_until (only stripe-boost's webhook, after real payment) and
  -- featured (only an admin, manually) were fully client-writable by the
  -- listing's own owner before this -- see
  -- 20260925110000_protect_listing_featured_and_boost.sql.
  new.featured := old.featured;
  new.boosted_until := old.boosted_until;

  return new;
end;
$$;

drop trigger if exists protect_listing_approval_gate_trigger on public.listings;
create trigger protect_listing_approval_gate_trigger
  before update on public.listings
  for each row execute function public.protect_listing_approval_gate();

-- ============================================================
-- COMPANY (FIRMA) ACCOUNTS (2026-09-24)
-- ============================================================
-- See migrations/20260924140000_company_accounts.sql for the full
-- explanation. This block was missing from schema.sql until now --
-- appended late, during a sync pass, not at time of migration.
alter table public.profiles
  add column if not exists account_type text not null default 'private',
  add column if not exists company_name text not null default '',
  add column if not exists org_number text default null,
  add column if not exists org_verified boolean not null default false;

do $$ begin
  alter table public.profiles
    add constraint profiles_account_type_check check (account_type in ('private','company'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.profiles
    add constraint profiles_org_number_format_check check (org_number is null or org_number ~ '^[0-9]{9}$');
exception when duplicate_object then null; end $$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, phone, account_type, company_name, org_number)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    coalesce(new.raw_user_meta_data->>'phone', ''),
    case when new.raw_user_meta_data->>'account_type' = 'company' then 'company' else 'private' end,
    coalesce(new.raw_user_meta_data->>'company_name', ''),
    nullif(new.raw_user_meta_data->>'org_number', '')
  )
  on conflict (id) do nothing;

  insert into public.registration_log (user_id, email, full_name, phone)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'phone'
  );

  return new;
end;
$$;

create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_privileged boolean;
begin
  is_privileged := auth.role() = 'service_role'
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');

  if not is_privileged then
    new.role := old.role;
    new.suspended := old.suspended;
    new.stripe_account_id := old.stripe_account_id;
    new.stripe_charges_enabled := old.stripe_charges_enabled;

    new.drivers_license_verified := old.drivers_license_verified;
    new.drivers_license_admin_reviewed := old.drivers_license_admin_reviewed;
    new.host_id_reviewed_at := old.host_id_reviewed_at;
    new.host_id_reject_reason := old.host_id_reject_reason;

    if new.host_approved is distinct from old.host_approved then
      if new.host_approved is distinct from false then
        new.host_approved := old.host_approved;
      end if;
    end if;

    if new.host_id_status is distinct from old.host_id_status then
      if new.host_id_status is distinct from 'pending' then
        new.host_id_status := old.host_id_status;
      end if;
    end if;

    if new.org_verified is distinct from old.org_verified then
      if new.org_verified is distinct from false then
        new.org_verified := old.org_verified;
      end if;
    end if;

    new.fee_waiver_until := old.fee_waiver_until;
  end if;

  if new.host_approved is true and old.host_approved is distinct from true then
    new.fee_waiver_until := now() + interval '1 year';
  end if;

  if new.org_number is distinct from old.org_number
     and new.org_verified is not distinct from old.org_verified then
    new.org_verified := false;
  end if;

  return new;
end;
$$;

create or replace view public.profiles_public
  with (security_invoker = false) as
  select id, full_name, avatar_url, bio,
    (account_type = 'company' and org_verified) as is_company,
    case when account_type = 'company' and org_verified then company_name else null end as company_name
  from public.profiles;

-- ============================================================
-- CHAT IMAGES + REALTIME PUBLICATION (2026-09-25)
-- ============================================================
-- See migrations/20260925090000_chat_images_and_realtime.sql.
alter table public.messages
  add column if not exists image_url text default null;

do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.bookings;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.listings;
exception when duplicate_object then null; end $$;

-- ============================================================
-- WISHLISTS + UPLOAD_SESSIONS RLS (2026-09-25)
-- ============================================================
-- See migrations/20260925140000_track_wishlists_table.sql and
-- 20260925150000_track_upload_sessions_table.sql -- both tables existed
-- in production before being captured here; only the RLS state (verified
-- live) is asserted, not a full `create table`.
alter table public.wishlists enable row level security;

drop policy if exists "wishlists_all" on public.wishlists;
create policy "wishlists_all" on public.wishlists for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

alter table public.upload_sessions enable row level security;

drop policy if exists "owner_all" on public.upload_sessions;
create policy "owner_all" on public.upload_sessions for all
  using (auth.uid() = user_id);

-- ============================================================
-- CAR/BOBIL KM TERMS (2026-09-25)
-- ============================================================
-- See migrations/20260925160000_car_km_terms.sql.
alter table public.listings
  add column if not exists included_km_per_day integer default null,
  add column if not exists extra_km_price numeric default null;

do $$ begin
  alter table public.listings
    add constraint listings_included_km_per_day_check check (included_km_per_day is null or included_km_per_day >= 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.listings
    add constraint listings_extra_km_price_check check (extra_km_price is null or extra_km_price >= 0);
exception when duplicate_object then null; end $$;

-- ============================================================
-- LISTING ID-CHECK MODE (2026-09-25)
-- ============================================================
-- See migrations/20260925180000_listing_id_check_mode.sql. Hosts choose,
-- per listing, whether renters must upload ID through the platform
-- ('upload', the existing default) or whether the host checks it
-- themselves in person at handover ('in_person').
alter table public.listings
  add column if not exists id_check_mode text not null default 'upload';

do $$ begin
  alter table public.listings
    add constraint listings_id_check_mode_check check (id_check_mode in ('upload','in_person'));
exception when duplicate_object then null; end $$;

-- ============================================================
-- FREEZE HANDOVER FLAGS AFTER CANCEL (2026-09-25)
-- ============================================================
-- See migrations/20260925190000_freeze_handover_flags_after_cancel.sql.
-- Replaces protect_booking_fields() with a version that also freezes
-- host_confirmed_handover/renter_confirmed_handover once a booking is
-- cancelled (previously only WHO could set them was restricted, not
-- WHETHER the booking was still cancellable).
create or replace function public.protect_booking_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  if public.is_admin() then
    return new;
  end if;
  new.payment_intent_id := old.payment_intent_id;
  new.paid := old.paid;
  new.amount_total := old.amount_total;
  new.platform_fee := old.platform_fee;
  new.payout_released := old.payout_released;
  new.transfer_id := old.transfer_id;
  new.stripe_customer_details := old.stripe_customer_details;
  new.refund_id := old.refund_id;
  new.refund_amount := old.refund_amount;
  new.cancelled_by := old.cancelled_by;
  new.cancelled_at := old.cancelled_at;
  new.renter_ip := old.renter_ip;
  new.listing_id := old.listing_id;
  new.renter := old.renter;
  new.from_date := old.from_date;
  new.to_date := old.to_date;

  if old.status = 'cancelled' then
    new.host_confirmed_handover := old.host_confirmed_handover;
    new.renter_confirmed_handover := old.renter_confirmed_handover;
  end if;

  if new.host_confirmed_handover is distinct from old.host_confirmed_handover then
    if not exists (
      select 1 from public.listings l
      where l.id = old.listing_id and l.owner = auth.uid()
    ) then
      new.host_confirmed_handover := old.host_confirmed_handover;
    end if;
  end if;

  if new.renter_confirmed_handover is distinct from old.renter_confirmed_handover then
    if old.renter is distinct from auth.uid() then
      new.renter_confirmed_handover := old.renter_confirmed_handover;
    end if;
  end if;

  if new.status is distinct from old.status and new.status in ('accepted', 'declined') then
    if not exists (
      select 1 from public.listings l
      where l.id = old.listing_id and l.owner = auth.uid()
    ) then
      new.status := old.status;
    end if;
  end if;

  if new.status is distinct from old.status and new.status = 'completed' then
    if not (coalesce(new.host_confirmed_handover, false) and coalesce(new.renter_confirmed_handover, false)) then
      new.status := old.status;
    end if;
  end if;

  return new;
end;
$$;

-- ============================================================
-- DEPOSIT HELD, NOT PAID TO HOST (2026-09-25)
-- ============================================================
-- See migrations/20260925200000_deposit_held_not_paid_to_host.sql.
-- CRITICAL: the deposit portion of a booking's payment was being
-- transferred to the HOST along with the rent at payout time, instead of
-- staying in the platform's balance as every renter-facing surface
-- promises ("Depositum (holdes av plattformen)" on the booking summary,
-- "Det holdes sikkert av plattformen og refunderes automatisk etter
-- fullført overlevering uten skader" in the FAQ). stripe-release-payout
-- computed payoutAmount as amount_total - platform_fee, and platform_fee
-- was only ever the ~20% rent-based service fee -- it never subtracted
-- the deposit, so 100% of every deposit silently left the platform's
-- Stripe balance forever with no refund mechanism at all.
--
-- Found via a live data check (12 active listings, all deposit_mode =
-- 'upfront', 9 with a nonzero deposit) with zero paid bookings yet --
-- a real, high-impact, not-yet-triggered bug, fixed before the first
-- real transaction rather than after.
--
-- deposit_amount is snapshotted at checkout time (like platform_fee
-- already was) so a host later changing their listing's deposit doesn't
-- retroactively change what a specific booking owes/refunds.
alter table public.bookings
  add column if not exists deposit_amount numeric not null default 0,
  add column if not exists deposit_refunded boolean not null default false,
  add column if not exists deposit_refund_id text;

do $$ begin
  alter table public.bookings
    add constraint bookings_deposit_amount_check check (deposit_amount >= 0);
exception when duplicate_object then null; end $$;

-- Same column-level protection pattern as the other Stripe-derived
-- booking fields (payment_intent_id, paid, amount_total, platform_fee,
-- ...) in protect_booking_fields() -- these must only ever be written by
-- the service role (stripe-webhook / stripe-release-payout), never by a
-- renter or host directly.
create or replace function public.protect_booking_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  if public.is_admin() then
    return new;
  end if;
  new.payment_intent_id := old.payment_intent_id;
  new.paid := old.paid;
  new.amount_total := old.amount_total;
  new.platform_fee := old.platform_fee;
  new.payout_released := old.payout_released;
  new.transfer_id := old.transfer_id;
  new.stripe_customer_details := old.stripe_customer_details;
  new.refund_id := old.refund_id;
  new.refund_amount := old.refund_amount;
  new.cancelled_by := old.cancelled_by;
  new.cancelled_at := old.cancelled_at;
  new.renter_ip := old.renter_ip;
  new.listing_id := old.listing_id;
  new.renter := old.renter;
  new.from_date := old.from_date;
  new.to_date := old.to_date;
  new.deposit_amount := old.deposit_amount;
  new.deposit_refunded := old.deposit_refunded;
  new.deposit_refund_id := old.deposit_refund_id;

  if old.status = 'cancelled' then
    new.host_confirmed_handover := old.host_confirmed_handover;
    new.renter_confirmed_handover := old.renter_confirmed_handover;
  end if;

  if new.host_confirmed_handover is distinct from old.host_confirmed_handover then
    if not exists (
      select 1 from public.listings l
      where l.id = old.listing_id and l.owner = auth.uid()
    ) then
      new.host_confirmed_handover := old.host_confirmed_handover;
    end if;
  end if;

  if new.renter_confirmed_handover is distinct from old.renter_confirmed_handover then
    if old.renter is distinct from auth.uid() then
      new.renter_confirmed_handover := old.renter_confirmed_handover;
    end if;
  end if;

  if new.status is distinct from old.status and new.status in ('accepted', 'declined') then
    if not exists (
      select 1 from public.listings l
      where l.id = old.listing_id and l.owner = auth.uid()
    ) then
      new.status := old.status;
    end if;
  end if;

  if new.status is distinct from old.status and new.status = 'completed' then
    if not (coalesce(new.host_confirmed_handover, false) and coalesce(new.renter_confirmed_handover, false)) then
      new.status := old.status;
    end if;
  end if;

  return new;
end;
$$;

-- ============================================================
-- RETURN CONFIRMATION STEP (2026-09-25)
-- ============================================================
-- See migrations/20260925210000_return_confirmation_step.sql.
-- Follow-up to 20260925200000 (deposit held, not paid to host): the only
-- existing confirmation pair (host_confirmed_handover / renter_confirmed_
-- handover) fires at PICKUP -- the host's own confirmation email
-- instructs "1. Lever utstyret... 2. Klikk Bekreft utlevering... 3.
-- pengene utbetales" -- so both the rent payout AND, after the deposit
-- fix, the deposit refund were about to release essentially at the start
-- of the rental, before it had really happened. That gives the deposit
-- (whose whole purpose is protecting against damage/non-return) almost
-- no real protective window.
--
-- Adds a second, genuinely separate confirmation pair for the RETURN.
-- Payout release and deposit refund now gate on THIS pair instead; the
-- pickup pair remains as pure documentation/dispute-evidence ("yes, I
-- received it in this condition") with no money movement tied to it.
alter table public.bookings
  add column if not exists host_confirmed_return boolean not null default false,
  add column if not exists renter_confirmed_return boolean not null default false;

create or replace function public.protect_booking_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  if public.is_admin() then
    return new;
  end if;
  new.payment_intent_id := old.payment_intent_id;
  new.paid := old.paid;
  new.amount_total := old.amount_total;
  new.platform_fee := old.platform_fee;
  new.payout_released := old.payout_released;
  new.transfer_id := old.transfer_id;
  new.stripe_customer_details := old.stripe_customer_details;
  new.refund_id := old.refund_id;
  new.refund_amount := old.refund_amount;
  new.cancelled_by := old.cancelled_by;
  new.cancelled_at := old.cancelled_at;
  new.renter_ip := old.renter_ip;
  new.listing_id := old.listing_id;
  new.renter := old.renter;
  new.from_date := old.from_date;
  new.to_date := old.to_date;
  new.deposit_amount := old.deposit_amount;
  new.deposit_refunded := old.deposit_refunded;
  new.deposit_refund_id := old.deposit_refund_id;

  if old.status = 'cancelled' then
    new.host_confirmed_handover := old.host_confirmed_handover;
    new.renter_confirmed_handover := old.renter_confirmed_handover;
    new.host_confirmed_return := old.host_confirmed_return;
    new.renter_confirmed_return := old.renter_confirmed_return;
  end if;

  if new.host_confirmed_handover is distinct from old.host_confirmed_handover then
    if not exists (
      select 1 from public.listings l
      where l.id = old.listing_id and l.owner = auth.uid()
    ) then
      new.host_confirmed_handover := old.host_confirmed_handover;
    end if;
  end if;

  if new.renter_confirmed_handover is distinct from old.renter_confirmed_handover then
    if old.renter is distinct from auth.uid() then
      new.renter_confirmed_handover := old.renter_confirmed_handover;
    end if;
  end if;

  -- Same ownership rule, extended to the new return-confirmation flags.
  if new.host_confirmed_return is distinct from old.host_confirmed_return then
    if not exists (
      select 1 from public.listings l
      where l.id = old.listing_id and l.owner = auth.uid()
    ) then
      new.host_confirmed_return := old.host_confirmed_return;
    end if;
  end if;

  if new.renter_confirmed_return is distinct from old.renter_confirmed_return then
    if old.renter is distinct from auth.uid() then
      new.renter_confirmed_return := old.renter_confirmed_return;
    end if;
  end if;

  if new.status is distinct from old.status and new.status in ('accepted', 'declined') then
    if not exists (
      select 1 from public.listings l
      where l.id = old.listing_id and l.owner = auth.uid()
    ) then
      new.status := old.status;
    end if;
  end if;

  -- 'completed' now requires BOTH pairs -- pickup AND return -- to be
  -- genuinely confirmed by both parties, not just pickup.
  if new.status is distinct from old.status and new.status = 'completed' then
    if not (
      coalesce(new.host_confirmed_handover, false) and coalesce(new.renter_confirmed_handover, false)
      and coalesce(new.host_confirmed_return, false) and coalesce(new.renter_confirmed_return, false)
    ) then
      new.status := old.status;
    end if;
  end if;

  return new;
end;
$$;

-- ============================================================
-- CRITICAL: FIX PUBLIC PROFILES READ LEAK (2026-09-25)
-- ============================================================
-- See migrations/20260925220000_fix_profiles_public_read_leak.sql and
-- 20260925220100_drop_untracked_profiles_read_all.sql. The original
-- "Profiles are viewable by everyone" using (true) policy (defined
-- earlier in this file, "5) Row Level Security (RLS)" section) plus an
-- untracked duplicate "profiles_read_all" policy (created directly via
-- the SQL editor at some point, never captured in a migration) together
-- made the entire profiles table -- full_name, email, phone, address,
-- stripe_account_id, drivers_license_front/back, org_number, everything
-- -- readable by anyone on the internet with no login. Found live via a
-- direct unauthenticated REST query during a routine RLS audit.
drop policy if exists "Profiles are viewable by everyone" on public.profiles;
drop policy if exists "profiles_read_all" on public.profiles;
drop policy if exists "Users can view own profile" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
create policy "Users can view own profile, admins view all"
  on public.profiles for select
  using (auth.uid() = id or public.is_admin());

-- ============================================================
-- AUDIT TRAIL TIMESTAMPS (2026-09-25)
-- ============================================================
-- See migrations/20260925230000_audit_trail_timestamps.sql.
-- Found via a direct compliance check against the pasted
-- "MASTERPROMPT – EKSTREM SIKKERHET OG KONTROLL FOR UTLEIEPLATTFORM"
-- (section 10, "Dokumentasjon og sporbarhet"): critical security events
-- must be logged with WHO and WHEN, not just a boolean outcome.
--
-- host_confirmed_handover / renter_confirmed_handover / host_confirmed_
-- return / renter_confirmed_return were booleans only -- no record of
-- WHEN pickup/return was actually confirmed. Likewise
-- drivers_license_admin_reviewed had no reviewer identity or timestamp,
-- so a manual ID-verification override (section 8: "Ingen manuell
-- bypass" without full traceability) couldn't actually be traced to a
-- specific admin at a specific time.
alter table public.bookings
  add column if not exists host_confirmed_handover_at timestamptz,
  add column if not exists renter_confirmed_handover_at timestamptz,
  add column if not exists host_confirmed_return_at timestamptz,
  add column if not exists renter_confirmed_return_at timestamptz;

alter table public.profiles
  add column if not exists drivers_license_reviewed_at timestamptz,
  add column if not exists drivers_license_reviewed_by uuid references public.profiles(id),
  add column if not exists host_id_reviewed_by uuid references public.profiles(id);

-- Stamp the timestamp columns server-side (never client-supplied) at the
-- exact moment each flag flips true, so a client can't backdate its own
-- audit trail.
create or replace function public.stamp_booking_confirmation_times()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.host_confirmed_handover is true and old.host_confirmed_handover is distinct from true then
    new.host_confirmed_handover_at := now();
  end if;
  if new.renter_confirmed_handover is true and old.renter_confirmed_handover is distinct from true then
    new.renter_confirmed_handover_at := now();
  end if;
  if new.host_confirmed_return is true and old.host_confirmed_return is distinct from true then
    new.host_confirmed_return_at := now();
  end if;
  if new.renter_confirmed_return is true and old.renter_confirmed_return is distinct from true then
    new.renter_confirmed_return_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists stamp_booking_confirmation_times_trigger on public.bookings;
create trigger stamp_booking_confirmation_times_trigger
  before update on public.bookings
  for each row execute function public.stamp_booking_confirmation_times();

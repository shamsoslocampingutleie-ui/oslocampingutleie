-- Oslo Camping Utleie - Supabase schema
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
  if not exists (
    select 1 from pg_constraint where conname = 'listings_category_check'
  ) then
    alter table public.listings add constraint listings_category_check
      check (category in ('camping', 'mobil', 'car', 'boat', 'trailer', 'tool'));
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

drop policy if exists "Renter or host can update bookings" on public.bookings;
create policy "Renter or host can update bookings"
  on public.bookings for update
  using (
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
      'from', 'Oslo Camping Utleie <varsler@oslocampingutleie.no>',
      'to', v_host_email,
      'subject', 'Ny leieforespørsel: ' || v_listing_title,
      'html',
        '<div style="font-family:''Helvetica Neue'',Arial,sans-serif;max-width:480px;margin:0 auto;background:#F7F5F0;border-radius:16px;overflow:hidden">' ||
          '<div style="background:#14512E;padding:28px 32px">' ||
            '<p style="margin:0;color:#CFE3D5;font-size:12px;letter-spacing:.12em;text-transform:uppercase;font-weight:600">Oslo Camping Utleie</p>' ||
            '<h1 style="margin:8px 0 0;color:#ffffff;font-size:22px;font-weight:700;font-family:inherit">Ny leieforespørsel</h1>' ||
          '</div>' ||
          '<div style="padding:28px 32px">' ||
            '<p style="margin:0 0 16px;color:#15201A;font-size:16px;line-height:1.6">Hei ' || coalesce(v_host_name, '') || ',</p>' ||
            '<p style="margin:0 0 24px;color:#15201A;font-size:16px;line-height:1.6"><strong>' || new.renter_name || '</strong> ønsker å leie <strong>' || v_listing_title || '</strong> fra <strong>' || new.from_date || '</strong> til <strong>' || new.to_date || '</strong>.</p>' ||
            '<a href="https://oslocampingutleie.no/?view=requests" style="display:inline-block;padding:13px 28px;background:#14512E;color:#ffffff;text-decoration:none;border-radius:999px;font-weight:600;font-size:15px">Logg inn og se forespørselen</a>' ||
            '<p style="margin:28px 0 0;color:#6B776E;font-size:13px;line-height:1.6">Denne e-posten kan ikke besvares. Logg inn på <a href="https://oslocampingutleie.no/" style="color:#14512E;text-decoration:underline">oslocampingutleie.no</a> for å se og administrere alt.</p>' ||
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
create or replace function public.protect_profile_fields()
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
  new.role := old.role;
  new.suspended := old.suspended;
  new.stripe_account_id := old.stripe_account_id;
  new.stripe_charges_enabled := old.stripe_charges_enabled;
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

-- Done. Example listings are inserted from the app itself (only if the
-- table is empty), since they must reference an existing auth user.

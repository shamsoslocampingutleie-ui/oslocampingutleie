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
create table if not exists public.messages (
  id bigint generated always as identity primary key,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  sender_name text not null default '',
  sender_role text not null default 'renter',
  text text not null,
  flagged boolean not null default false,
  flag_reason text,
  created_at timestamptz not null default now()
);
alter table public.messages enable row level security;

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.bookings b
      where b.id = booking_id
        and (
          b.renter = auth.uid()
          or exists (select 1 from public.listings l where l.id = b.listing_id and l.owner = auth.uid())
        )
    )
  );

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select
  using (
    public.is_admin()
    or exists (
      select 1 from public.bookings b
      where b.id = booking_id
        and (
          b.renter = auth.uid()
          or exists (select 1 from public.listings l where l.id = b.listing_id and l.owner = auth.uid())
        )
    )
  );

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

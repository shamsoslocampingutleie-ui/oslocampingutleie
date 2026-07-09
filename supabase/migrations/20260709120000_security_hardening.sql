-- ============================================================
-- 2026-07-09: Security hardening
-- ============================================================

-- 1. Rate limiting RPC used by edge functions (verify-license, stripe-checkout, etc.)
--    Key format: "<ip>:<window_bucket>"
--    Returns true if under limit, false if over.

-- rate_limits table may already exist from a prior partial migration.
-- Recreate it cleanly with the correct schema.
drop table if exists public.rate_limits;
create table public.rate_limits (
  key        text primary key,
  count      integer not null default 0,
  window_end timestamptz not null
);

create index rate_limits_window_end_idx on public.rate_limits (window_end);

-- RPC is called by edge functions using the service role key only.
alter table public.rate_limits enable row level security;
-- No policies = client JS cannot touch this table at all.

create or replace function public.increment_rate_limit(
  p_key        text,
  p_limit      integer,
  p_ttl_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now       timestamptz := now();
  v_window    timestamptz := v_now + (p_ttl_seconds || ' seconds')::interval;
  v_count     integer;
begin
  -- Remove stale entry if window has passed
  delete from public.rate_limits
  where key = p_key and window_end < v_now;

  -- Upsert: increment counter or start new window
  insert into public.rate_limits (key, count, window_end)
  values (p_key, 1, v_window)
  on conflict (key) do update
    set count = rate_limits.count + 1
  returning count into v_count;

  return v_count <= p_limit;
end;
$$;

revoke execute on function public.increment_rate_limit from public, anon, authenticated;
grant execute on function public.increment_rate_limit to service_role;


-- 2. Tighten booking_documents RLS: add admin access (was missing from original policy).
--    Replace the existing booking_docs_select policy with one that also grants admins full read.

drop policy if exists "booking_docs_select" on public.booking_documents;
create policy "booking_docs_select" on public.booking_documents for select
  using (
    public.is_admin()
    or auth.uid() = user_id
    or auth.uid() in (
      select b.renter from public.bookings b where b.id = booking_id
      union
      select l.owner from public.bookings b
        join public.listings l on l.id = b.listing_id
       where b.id = booking_id
    )
  );


-- 3. Add index for rate_limits cleanup (already above, confirming exists)
create index if not exists rate_limits_key_idx on public.rate_limits (key);


-- 4. Input length constraints on user-controlled columns
--    Prevent extremely long strings from being inserted.

alter table public.profiles
  alter column full_name type varchar(200),
  alter column bio type varchar(2000),
  alter column phone type varchar(30),
  alter column address type varchar(300);

alter table public.listings
  alter column title type varchar(200),
  alter column location type varchar(200),
  alter column description type varchar(10000);

alter table public.bookings
  alter column renter_name type varchar(200),
  alter column renter_phone type varchar(30),
  alter column renter_address type varchar(300);

alter table public.messages
  alter column text type varchar(5000);

alter table public.reviews
  alter column text type varchar(3000),
  alter column reviewer_name type varchar(200);

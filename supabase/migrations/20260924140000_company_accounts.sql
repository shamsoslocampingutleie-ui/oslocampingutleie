-- Company (firma) accounts: a profile can register as a business instead
-- of a private individual, so companies that rent out equipment can list
-- under their real registered identity. account_type/company_name/
-- org_number come from the client (registration form or profile-edit),
-- same trust level as full_name/phone always had -- but org_verified is
-- NEVER settable by the client. It's only ever flipped to true by the
-- verify-org-number edge function (service role), which independently
-- re-checks the org number against Brønnøysundregistrene's public
-- Enhetsregisteret before writing anything. See protect_profile_fields()
-- below and supabase/functions/verify-org-number/index.ts.
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

-- Auto-create profile row when a user signs up. Extended to also carry
-- phone (previously silently dropped here -- it was only ever meant to be
-- backfilled by a client-side fallback in loadProfile(), but that fallback
-- checks `t.full_name === e.email` to decide whether to backfill, and
-- full_name is already correct by the time that check runs since this
-- trigger sets it immediately at signup, so the phone backfill never
-- actually fired) and the new company-account fields from signup
-- metadata.
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

-- Extend the existing column-level protection trigger: org_verified can
-- only ever be set to true by a privileged actor (service_role / admin --
-- in practice only the verify-org-number edge function, right after it
-- has independently re-checked the number against Brønnøysundregistrene).
-- A non-privileged client can clear it (set false) but never grant it to
-- itself. Changing org_number without the same call also setting
-- org_verified always drops org_verified back to false, so a previously
-- verified number can't be silently swapped for an unverified one while
-- keeping the verified badge.
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

  -- A changed org_number invalidates any existing verification, unless
  -- this same write is the one setting org_verified (i.e. the
  -- verify-org-number edge function's own persist step).
  if new.org_number is distinct from old.org_number
     and new.org_verified is not distinct from old.org_verified then
    new.org_verified := false;
  end if;

  return new;
end;
$$;

-- Surface the verified-company badge to anyone browsing a listing, same
-- trust level as the name/avatar/bio already exposed here -- a Norwegian
-- org number and its registered name are public registry data by
-- definition, not personal information. org_number/account_type stay out
-- (org_verified + company_name are all a renter needs to see the badge).
create or replace view public.profiles_public
  with (security_invoker = false) as
  select id, full_name, avatar_url, bio,
    (account_type = 'company' and org_verified) as is_company,
    case when account_type = 'company' and org_verified then company_name else null end as company_name
  from public.profiles;


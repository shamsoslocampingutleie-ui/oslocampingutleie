-- New-host fee waiver: every host's first 12 months after approval are
-- free of the host-side 10% platform fee (they keep 100% of rent instead
-- of 90%). The renter-side 10% service fee is unaffected.
--
-- fee_waiver_until is never client-writable, by design (see
-- protect_profile_fields() below) -- it is only ever set by this trigger,
-- the instant a profile's host_approved is (re)approved by an admin or
-- service_role. A raw client update to this column is always reverted for
-- non-privileged actors, the same way host_approved/host_id_status already
-- are, so a host cannot self-grant or extend their own waiver.

alter table public.profiles
  add column if not exists fee_waiver_until timestamptz default null;

comment on column public.profiles.fee_waiver_until is
  'Host keeps 100% of rent (no host-side platform fee) on bookings until this timestamp. Set automatically for one year when host_approved transitions to true -- see protect_profile_fields().';

-- One-off backfill: the handful of hosts already approved before this
-- migration get the same first-year waiver starting now, rather than
-- being penalized for having joined first.
update public.profiles
  set fee_waiver_until = now() + interval '1 year'
  where host_approved = true and fee_waiver_until is null;

-- Rebuild protect_profile_fields() with an is_privileged flag instead of
-- early returns, so the fee_waiver_until logic below can run for every
-- actor (needed for the admin/service_role path) while still being
-- protected from direct client writes (needed for the owner path) --
-- see the file header above for why.
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

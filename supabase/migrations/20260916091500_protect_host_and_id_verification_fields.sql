-- protect_profile_fields() guarded role/suspended/stripe_* but left the
-- entire host-approval and ID-verification trust chain writable by any
-- authenticated user via a raw client update:
--   sb.from('profiles').update({host_approved: true}).eq('id', session.id)
--   sb.from('profiles').update({host_id_status: 'approved'}).eq('id', session.id)
--   sb.from('profiles').update({drivers_license_verified: true}).eq('id', session.id)
-- all succeeded under RLS (owner-update policy has no column restriction),
-- letting a user self-grant host status or self-verify their own ID,
-- silently defeating the review workflow the product's "verified
-- profiles" safety claim depends on.
--
-- Fully protected (never legitimately self-set, always revert for
-- non-admin/non-service_role):
--   drivers_license_verified, drivers_license_admin_reviewed,
--   host_id_reviewed_at, host_id_reject_reason
--
-- Transition-restricted (the owner's own legitimate actions — applying,
-- or submitting a document for review — still work; anything else
-- reverts):
--   host_approved: owner may only move it to false (apply); true/null
--   stay admin/service_role-only.
--   host_id_status: owner may only move it to 'pending' (submit for
--   review); 'approved'/'rejected' stay admin/service_role-only.
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

  return new;
end;
$$;

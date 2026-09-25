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

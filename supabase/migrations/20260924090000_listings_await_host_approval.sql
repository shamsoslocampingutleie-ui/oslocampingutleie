-- Lets a host create listings while their host application (and ID
-- verification) is still pending, instead of blocking listing creation
-- entirely until approved -- see startNewListing()/publishListing() in
-- src/app.html. The listing is what's gated now, not the ability to make
-- one: it's inserted paused with awaiting_host_approval=true, hidden from
-- renters by the existing "status = 'active' or owner = auth.uid()" select
-- policy, and auto-activated by approveHost() the moment the host is
-- approved. If they're never approved, it just stays paused/hidden
-- (admin can still delete it manually, same as any listing today).
--
-- awaiting_host_approval is protected the same way fee_waiver_until is:
-- the host dashboard already has a self-service Pause/Activate toggle
-- (hostListings() in src/app.html) that does a plain
-- `update listings set status = ...` with no awareness of this gate --
-- without server-side protection, a pending host could just click
-- "Aktiver" on their own listing and publish it before anyone reviewed
-- them, defeating the entire point.

alter table public.listings
  add column if not exists awaiting_host_approval boolean not null default false;

comment on column public.listings.awaiting_host_approval is
  'True while the listing was created before its owner was an approved host. Forces status back to paused for any non-admin update until approveHost() clears it.';

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

  -- Still awaiting approval going into this update: no non-admin action
  -- (including the owner's own Pause/Activate toggle) can bring it live
  -- or clear the flag. Once approveHost() flips this off, the row is a
  -- normal listing again and this branch no longer applies.
  if old.awaiting_host_approval is true then
    new.awaiting_host_approval := true;
    new.status := 'paused';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_listing_approval_gate_trigger on public.listings;
create trigger protect_listing_approval_gate_trigger
  before update on public.listings
  for each row execute function public.protect_listing_approval_gate();

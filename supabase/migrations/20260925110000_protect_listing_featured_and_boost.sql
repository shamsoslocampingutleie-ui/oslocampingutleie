-- Security finding: "Owners can update their listings" RLS only checks
-- row ownership (owner = auth.uid()), with zero per-column restriction.
-- Unlike profiles/bookings, listings had no protect_*_fields() trigger
-- at all before this -- protect_listing_approval_gate() only ever
-- touched awaiting_host_approval/status. Two columns are meant to be
-- set exclusively by privileged actors but were fully client-writable
-- by the listing's own owner:
--
--   boosted_until -- only meant to be set by stripe-boost's webhook
--                     after a real 90 kr payment (see that function's
--                     own comment: "On success the webhook marks
--                     listings.boosted_until = now + 7 days"). A host
--                     could set this directly themselves and get a free
--                     7-day top-of-search boost -- a straight revenue
--                     bypass, not just a display glitch.
--
--   featured       -- only meant to be set by an admin, manually, for
--                     free ("Admin: merk som anbefalt uten betaling" --
--                     see hostListings() in src/app.html). A host could
--                     set this on their own listing and get the "⭐
--                     Anbefalt" badge, which is supposed to read as a
--                     platform editorial endorsement, not something a
--                     host can grant themselves.
--
-- Both are now protected the same way every other privileged-only field
-- in this codebase is: reverted to the old value for any non-privileged
-- actor. service_role (stripe-boost's webhook) and admin (the
-- "Fremhev gratis" button) are unaffected.

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
  -- or clear the flag. Once approveHost() clears this off, the row is a
  -- normal listing again and this branch no longer applies.
  if old.awaiting_host_approval is true then
    new.awaiting_host_approval := true;
    new.status := 'paused';
  end if;

  new.featured := old.featured;
  new.boosted_until := old.boosted_until;

  return new;
end;
$$;

-- Security finding: bookings_update_owner's RLS policy only checks
-- "is this actor a party to the booking at all" (renter = auth.uid() OR
-- listing owner = auth.uid()) -- it has no per-column restriction, and
-- protect_booking_fields() never protected host_confirmed_handover /
-- renter_confirmed_handover (they're deliberately client-settable, since
-- that's how confirmHandover() in src/app.html works). Combined, that
-- meant EITHER party could set EITHER flag directly:
--
--   sb.from('bookings').update({ renter_confirmed_handover: true }).eq('id', bookingId)
--
-- ...called by the HOST, with no check that the caller is actually the
-- renter. Since stripe-release-payout releases funds the instant BOTH
-- flags are true, a dishonest host could fake the renter's confirmation
-- themselves (renter never received the item, or disputes its condition)
-- and force their own payout early -- defeating the entire point of the
-- two-party handover check this platform advertises as a safety
-- guarantee ("Betaling holdes trygt... til begge parter har bekreftet").
-- Symmetrically, a renter could fake the host's confirmation, though
-- that direction has no obvious benefit to the renter themselves.
--
-- Fix: each flag can now only be changed by the party it actually
-- represents -- host_confirmed_handover by the listing owner,
-- renter_confirmed_handover by the booking's renter. Anyone else's
-- attempt to change it is silently reverted to the old value, same
-- pattern as every other protected column here.

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

  -- Second, more serious finding from the same pass: bookings_update_owner
  -- lets a renter update their OWN booking row at all (needed for the
  -- legitimate cancelBooking() flow), but nothing stopped them from
  -- setting status straight to 'accepted' or 'declined' themselves --
  -- those are supposed to be the HOST's decision on a pending request.
  -- A renter could self-accept their own request via a direct client
  -- update, fully skipping host approval (and, for a non-instant-book
  -- listing, immediately unlocking the "Betal med Stripe" button, which
  -- only checks status === 'accepted'). Only the listing owner may move
  -- status into either of these two values now.
  if new.status is distinct from old.status and new.status in ('accepted', 'declined') then
    if not exists (
      select 1 from public.listings l
      where l.id = old.listing_id and l.owner = auth.uid()
    ) then
      new.status := old.status;
    end if;
  end if;

  return new;
end;
$$;

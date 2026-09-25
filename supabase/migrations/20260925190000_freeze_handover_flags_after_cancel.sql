-- Found while auditing stripe-release-payout for the same class of gap
-- just fixed in stripe-refund (refund ignoring the listing's own
-- cancellation policy): protect_booking_fields() restricts WHO can set
-- host_confirmed_handover/renter_confirmed_handover (only the matching
-- party), but never WHETHER the booking is still cancellable. A renter
-- or host could still flip their own handover flag to true on an
-- already-cancelled (and possibly already-refunded) booking, which --
-- combined with stripe-release-payout only checking payout_released, not
-- status -- could let a cancelled booking's host share still be
-- transferred out after the renter was already refunded. That function
-- now also refuses to pay out a cancelled booking (defense #1); this is
-- defense #2, one layer earlier: once a booking is cancelled, its
-- handover-confirmation flags are frozen for non-privileged actors, so
-- the confusing "cancelled AND both-confirmed" state can no longer be
-- reached in the first place.
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

  -- Once cancelled, a booking's handover-confirmation flags are frozen
  -- for non-privileged actors -- see migration header above.
  if old.status = 'cancelled' then
    new.host_confirmed_handover := old.host_confirmed_handover;
    new.renter_confirmed_handover := old.renter_confirmed_handover;
  end if;

  -- host_confirmed_handover / renter_confirmed_handover are deliberately
  -- client-settable (that's how confirmHandover() works), but each can
  -- only be changed by the party it actually represents -- otherwise
  -- either side could fake the OTHER party's confirmation and force
  -- stripe-release-payout to fire without a real mutual handover. See
  -- 20260925100000_protect_handover_confirmation_fields.sql.
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

  -- Only the listing owner (or admin/service_role, already returned above)
  -- may move a booking into 'accepted' or 'declined' -- that's the host's
  -- approval decision. Without this a renter could self-accept their own
  -- pending request via a direct client update, skipping host approval
  -- entirely (and, for non-instant-book listings, unlocking the "Betal
  -- med Stripe" button, which only checks status === 'accepted').
  if new.status is distinct from old.status and new.status in ('accepted', 'declined') then
    if not exists (
      select 1 from public.listings l
      where l.id = old.listing_id and l.owner = auth.uid()
    ) then
      new.status := old.status;
    end if;
  end if;

  -- reviews_insert requires status = 'completed' before a review can be
  -- posted, so 'completed' must never be reachable without a real mutual
  -- handover -- otherwise a renter could fabricate a review on any
  -- listing via a free, never-accepted booking request. Only allow it
  -- when both confirmation flags are genuinely true in this same row
  -- (see 20260925120000_protect_completed_status.sql).
  if new.status is distinct from old.status and new.status = 'completed' then
    if not (coalesce(new.host_confirmed_handover, false) and coalesce(new.renter_confirmed_handover, false)) then
      new.status := old.status;
    end if;
  end if;

  return new;
end;
$$;

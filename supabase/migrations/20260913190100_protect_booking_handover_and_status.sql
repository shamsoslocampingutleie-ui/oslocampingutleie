-- Security fix: protect_booking_fields() locks down payment/payout fields
-- but never protected host_confirmed_handover / renter_confirmed_handover
-- or status. Since bookings_update_owner lets either the renter or the
-- listing owner update any column on their own booking row, this let:
--  (a) a host set BOTH handover-confirmation flags themselves and trigger
--      stripe-release-payout before the renter ever actually confirmed
--      receiving the item, and
--  (b) a renter set status='accepted' on their own pending request,
--      bypassing the host's manual-approval step, then pay via
--      stripe-checkout (which only checks status = 'accepted').
--
-- Fix: each party may only set their OWN handover-confirmation flag, and
-- status may only move to 'accepted'/'declined' via the listing owner,
-- 'completed' only as the natural byproduct of both flags being true, and
-- 'cancelled' is left open (both renter and host legitimately cancel their
-- own bookings today). service_role and admins are unaffected.

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

  -- Each side may only confirm their OWN handover flag.
  if old.renter = auth.uid() then
    new.host_confirmed_handover := old.host_confirmed_handover;
  elsif exists (select 1 from public.listings l where l.id = old.listing_id and l.owner = auth.uid()) then
    new.renter_confirmed_handover := old.renter_confirmed_handover;
  else
    new.host_confirmed_handover := old.host_confirmed_handover;
    new.renter_confirmed_handover := old.renter_confirmed_handover;
  end if;

  -- Status transitions: only the listing owner may accept/decline; only
  -- both confirmation flags being true may move a booking to 'completed';
  -- cancellation stays open to either party; anything else is a no-op for
  -- non-privileged callers.
  if new.status is distinct from old.status then
    if new.status in ('accepted', 'declined') then
      if not exists (select 1 from public.listings l where l.id = old.listing_id and l.owner = auth.uid()) then
        new.status := old.status;
      end if;
    elsif new.status = 'completed' then
      if old.status <> 'accepted' or not (new.host_confirmed_handover and new.renter_confirmed_handover) then
        new.status := old.status;
      end if;
    elsif new.status <> 'cancelled' then
      new.status := old.status;
    end if;
  end if;

  return new;
end;
$$;

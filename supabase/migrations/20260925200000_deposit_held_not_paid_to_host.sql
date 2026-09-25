-- CRITICAL: the deposit portion of a booking's payment was being
-- transferred to the HOST along with the rent at payout time, instead of
-- staying in the platform's balance as every renter-facing surface
-- promises ("Depositum (holdes av plattformen)" on the booking summary,
-- "Det holdes sikkert av plattformen og refunderes automatisk etter
-- fullført overlevering uten skader" in the FAQ). stripe-release-payout
-- computed payoutAmount as amount_total - platform_fee, and platform_fee
-- was only ever the ~20% rent-based service fee -- it never subtracted
-- the deposit, so 100% of every deposit silently left the platform's
-- Stripe balance forever with no refund mechanism at all.
--
-- Found via a live data check (12 active listings, all deposit_mode =
-- 'upfront', 9 with a nonzero deposit) with zero paid bookings yet --
-- a real, high-impact, not-yet-triggered bug, fixed before the first
-- real transaction rather than after.
--
-- deposit_amount is snapshotted at checkout time (like platform_fee
-- already was) so a host later changing their listing's deposit doesn't
-- retroactively change what a specific booking owes/refunds.
alter table public.bookings
  add column if not exists deposit_amount numeric not null default 0,
  add column if not exists deposit_refunded boolean not null default false,
  add column if not exists deposit_refund_id text;

do $$ begin
  alter table public.bookings
    add constraint bookings_deposit_amount_check check (deposit_amount >= 0);
exception when duplicate_object then null; end $$;

-- Same column-level protection pattern as the other Stripe-derived
-- booking fields (payment_intent_id, paid, amount_total, platform_fee,
-- ...) in protect_booking_fields() -- these must only ever be written by
-- the service role (stripe-webhook / stripe-release-payout), never by a
-- renter or host directly.
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
  new.deposit_amount := old.deposit_amount;
  new.deposit_refunded := old.deposit_refunded;
  new.deposit_refund_id := old.deposit_refund_id;

  if old.status = 'cancelled' then
    new.host_confirmed_handover := old.host_confirmed_handover;
    new.renter_confirmed_handover := old.renter_confirmed_handover;
  end if;

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

  if new.status is distinct from old.status and new.status in ('accepted', 'declined') then
    if not exists (
      select 1 from public.listings l
      where l.id = old.listing_id and l.owner = auth.uid()
    ) then
      new.status := old.status;
    end if;
  end if;

  if new.status is distinct from old.status and new.status = 'completed' then
    if not (coalesce(new.host_confirmed_handover, false) and coalesce(new.renter_confirmed_handover, false)) then
      new.status := old.status;
    end if;
  end if;

  return new;
end;
$$;

-- Follow-up to 20260925200000 (deposit held, not paid to host): the only
-- existing confirmation pair (host_confirmed_handover / renter_confirmed_
-- handover) fires at PICKUP -- the host's own confirmation email
-- instructs "1. Lever utstyret... 2. Klikk Bekreft utlevering... 3.
-- pengene utbetales" -- so both the rent payout AND, after the deposit
-- fix, the deposit refund were about to release essentially at the start
-- of the rental, before it had really happened. That gives the deposit
-- (whose whole purpose is protecting against damage/non-return) almost
-- no real protective window.
--
-- Adds a second, genuinely separate confirmation pair for the RETURN.
-- Payout release and deposit refund now gate on THIS pair instead; the
-- pickup pair remains as pure documentation/dispute-evidence ("yes, I
-- received it in this condition") with no money movement tied to it.
alter table public.bookings
  add column if not exists host_confirmed_return boolean not null default false,
  add column if not exists renter_confirmed_return boolean not null default false;

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
    new.host_confirmed_return := old.host_confirmed_return;
    new.renter_confirmed_return := old.renter_confirmed_return;
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

  -- Same ownership rule, extended to the new return-confirmation flags.
  if new.host_confirmed_return is distinct from old.host_confirmed_return then
    if not exists (
      select 1 from public.listings l
      where l.id = old.listing_id and l.owner = auth.uid()
    ) then
      new.host_confirmed_return := old.host_confirmed_return;
    end if;
  end if;

  if new.renter_confirmed_return is distinct from old.renter_confirmed_return then
    if old.renter is distinct from auth.uid() then
      new.renter_confirmed_return := old.renter_confirmed_return;
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

  -- 'completed' now requires BOTH pairs -- pickup AND return -- to be
  -- genuinely confirmed by both parties, not just pickup.
  if new.status is distinct from old.status and new.status = 'completed' then
    if not (
      coalesce(new.host_confirmed_handover, false) and coalesce(new.renter_confirmed_handover, false)
      and coalesce(new.host_confirmed_return, false) and coalesce(new.renter_confirmed_return, false)
    ) then
      new.status := old.status;
    end if;
  end if;

  return new;
end;
$$;

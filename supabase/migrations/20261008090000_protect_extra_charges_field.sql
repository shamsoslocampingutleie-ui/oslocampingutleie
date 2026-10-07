-- Full RLS/trigger-revisjon fant et reelt hull: protect_booking_fields()
-- låser eksplisitt amount_total, platform_fee, payout_released,
-- deposit_amount, deposit_refunded og hvert annet pengerelatert felt
-- til gammel verdi for alle utenom service_role/admin -- men
-- extra_charges (skadekrav-feltet host registrerer ved retur, se
-- openHostReturnModal i src/app.html) var fraværende fra listen.
--
-- bookings_update_owner (RLS) tillater BÅDE leietaker OG utleier å
-- oppdatere en booking de er part i. Uten denne triggerfiksen kunne en
-- uærlig leietaker kalle
--   sb.from('bookings').update({extra_charges:{}}).eq('id', bookingId)
-- og nullstille et reelt skadekrav utleier nettopp registrerte, før
-- admin rekker å se det -- siden stripe-release-payout (depositum-
-- tilbakeholdelse) og notify-booking-message (admin-varsling) begge
-- leser extra_charges på det tidspunktet funksjonen faktisk kjører,
-- ikke på tidspunktet host opprinnelig satte det.
--
-- Samme mønster som host_confirmed_return like over i samme funksjon:
-- kun utleier (owner av listingen) kan endre feltet, uansett hvilken
-- retning endringen går.
create or replace function public.protect_booking_fields()
returns trigger
language plpgsql
security definer
set search_path to 'public'
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
    new.extra_charges := old.extra_charges;
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

  -- New: extra_charges (damage/cleaning/toll claim) -- only the host
  -- who owns the listing may ever set or change this, in either
  -- direction. Found live-unprotected during a full RLS/trigger audit.
  if new.extra_charges is distinct from old.extra_charges then
    if not exists (
      select 1 from public.listings l
      where l.id = old.listing_id and l.owner = auth.uid()
    ) then
      new.extra_charges := old.extra_charges;
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

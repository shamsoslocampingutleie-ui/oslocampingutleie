-- Security finding, surfaced by re-checking the consequences of the
-- previous fix: 'completed' was deliberately left out of the
-- accepted/declined status guard (20260925100000) because it's a
-- legitimate side effect of confirmHandover() -- but that also meant
-- 'completed' remained fully client-settable with NO check that a real
-- mutual handover ever happened.
--
-- reviews_insert requires booking.status = 'completed' before a review
-- can be posted. Combined, a renter could: send a booking request for
-- ANY listing (free, no payment, doesn't even need to be accepted),
-- directly set status = 'completed' on their own booking row via a
-- plain client update, then post a review -- a fully fabricated review
-- on a rental that never happened, for any listing on the platform.
-- That's exactly the "bruke falske anmeldelser" failure mode this
-- platform (and this agent) must never enable.
--
-- Fix: status may only become 'completed' if, in the very same row
-- after this update, BOTH host_confirmed_handover and
-- renter_confirmed_handover are true. Since those two flags are
-- already protected (each only settable by the party it represents --
-- see 20260925100000), and an UPDATE statement that doesn't mention a
-- column carries its OLD value into NEW unchanged, this correctly
-- allows confirmHandover()'s real flow (whichever party confirms last
-- submits {[their_flag]: true, status: 'completed'} in one call, with
-- the other flag already true from before) while blocking a bare
-- {status: 'completed'} with no genuine mutual confirmation behind it.

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

-- Fix: two clients confirming handover near-simultaneously never
-- transitioned a booking to 'completed'. Each client only sent
-- status:'completed' when ITS OWN stale in-memory cache already believed
-- the other party had confirmed -- so in a genuine race (both taps within
-- moments of each other, exactly the real-world "meet up and hand over
-- the keys" flow this product is designed around), neither client's
-- update includes the status change, and the booking stays stuck at
-- 'accepted' forever even though both confirmation flags are true.
--
-- Fix this server-side instead of relying on client-side "did I already
-- know" logic: whenever an update leaves both handover flags true on a
-- currently-accepted booking, derive status='completed' unconditionally.
-- This is safe even under true concurrency because Postgres serializes
-- UPDATEs to the same row -- the second of two "simultaneous" confirms
-- always sees the first one's committed flag as its OLD value, so by the
-- time the second update runs, both flags are visible together.

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

  -- Derive completion unconditionally (covers the race case above, where
  -- neither individual update explicitly requested the status change).
  if new.status = 'accepted' and new.host_confirmed_handover and new.renter_confirmed_handover then
    new.status := 'completed';
  end if;

  return new;
end;
$$;

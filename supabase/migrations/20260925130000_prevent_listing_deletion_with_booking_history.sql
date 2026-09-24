-- Security/data-integrity finding: "Owners can delete their listings" has
-- no restriction beyond ownership, and bookings.listing_id is
-- `references public.listings(id) on delete cascade` -- so a host could
-- delete a listing with a PAID, ACCEPTED, or even COMPLETED booking
-- still attached, and Postgres would silently cascade-delete that
-- booking row (renter info, dates, amount_total, paid, payout_released,
-- refund_id — the entire financial/audit trail) along with any reviews
-- referencing it (reviews.booking_id also cascades). deleteListing()'s
-- own confirm dialog in src/app.html already warns "fjerner også
-- tilhørende forespørsler" (also removes associated requests) -- this
-- was working exactly as coded, just never meant to reach real
-- transactions.
--
-- Concretely exploitable as fraud/evidence destruction: a host receives
-- payment, a dispute arises (item not as described, damaged, never
-- delivered), and the host deletes the listing -- the booking, the
-- payment reference, and any review are simply gone, with no trace and
-- no way for the renter or platform support to reconstruct what
-- happened.
--
-- Fix: block deleting a listing that has any booking with real stakes
-- attached (paid, or in a state that implies a real commitment: pending
-- payment, accepted, or completed). A listing with only pending
-- (never-accepted) or already cancelled/declined requests can still be
-- deleted freely -- no money or completed rental is at risk there.
-- Admin/service_role bypass this (e.g. removing a fraudulent listing
-- entirely is a legitimate moderation action) the same as every other
-- privileged-bypass trigger in this schema. Uses the same
-- raise-a-tagged-exception + client string-match pattern as
-- prevent_double_booking()'s DOUBLE_BOOKING, so the host gets a clear
-- explanation instead of a silent no-op or a generic error.

create or replace function public.prevent_listing_deletion_with_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return old;
  end if;
  if public.is_admin() then
    return old;
  end if;

  if exists (
    select 1 from public.bookings b
    where b.listing_id = old.id
      and (b.paid = true or b.status in ('pending_payment', 'accepted', 'completed'))
  ) then
    raise exception 'LISTING_HAS_BOOKINGS: Denne annonsen har bookinger med betaling eller en gjennomført leie, og kan ikke slettes. Sett den til Pauset i stedet.';
  end if;

  return old;
end;
$$;

drop trigger if exists prevent_listing_deletion_with_history_trigger on public.listings;
create trigger prevent_listing_deletion_with_history_trigger
  before delete on public.listings
  for each row execute function public.prevent_listing_deletion_with_history();

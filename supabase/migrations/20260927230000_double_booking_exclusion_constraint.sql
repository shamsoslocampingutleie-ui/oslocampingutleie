-- prevent_double_booking() (existing trigger, see schema.sql) does a
-- SELECT EXISTS(...) check before allowing a booking to become
-- 'accepted'. That's a plain check-then-act: two concurrent
-- transactions accepting two different pending requests for
-- overlapping dates on the same listing can both run their SELECT
-- before either commits, so neither sees the other's pending change --
-- the classic race a trigger-level check alone cannot close. For a
-- rental platform this is the single worst possible failure mode: a
-- renter shows up and the host has already handed the equipment to
-- someone else for the same dates.
--
-- A real host racing to click "Godta" on two overlapping requests
-- within milliseconds of each other is rare, but not the point --
-- an exclusion constraint is the textbook-correct fix and costs
-- nothing to have as the actual safety net underneath the trigger
-- (which still runs first and gives a friendlier custom error message
-- for the common, non-race case).
create extension if not exists btree_gist;

alter table public.bookings
  add constraint no_overlapping_accepted_bookings
  exclude using gist (
    listing_id with =,
    daterange(from_date, to_date, '[)') with &&
  )
  where (status = 'accepted');

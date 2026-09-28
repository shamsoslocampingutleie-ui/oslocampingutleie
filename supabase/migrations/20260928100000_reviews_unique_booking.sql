-- reviews (renter -> listing) had no constraint stopping the same
-- booking from being reviewed twice -- reviews_insert only checks the
-- booking is the caller's own and is 'completed', nothing prevents a
-- second insert for the same booking_id. submitReview() (src/app.html)
-- guards this client-side by disabling the review button once
-- bookings.reviewed is set, but that's a soft guard: if the reviewed
-- flag update fails after the insert succeeds (network hiccup), or two
-- tabs are open, or the insert is called directly, a renter could
-- submit multiple reviews for one booking, skewing a listing's rating.
-- renter_reviews (the other direction, added this session) already has
-- unique(booking_id) for exactly this reason -- this brings the older,
-- pre-existing table in line with it.
alter table public.reviews
  add constraint reviews_booking_id_unique unique (booking_id);

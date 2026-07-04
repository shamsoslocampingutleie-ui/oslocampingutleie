-- Allow 'pending_payment' status for bookings awaiting Stripe payment.
-- Bookings are created with this status for instant_book listings, and
-- upgraded to 'accepted' by the stripe-webhook when payment is confirmed.
alter table public.bookings drop constraint if exists bookings_status_check;
alter table public.bookings add constraint bookings_status_check
  check (status in ('pending', 'pending_payment', 'accepted', 'declined', 'cancelled', 'completed', 'disputed'));

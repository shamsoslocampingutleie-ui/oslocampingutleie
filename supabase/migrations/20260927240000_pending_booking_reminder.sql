-- Backs the daily remind-pending-booking cron job: last time a host
-- was reminded about a still-unanswered pending request, so the job
-- only re-sends every 2 days rather than once per run. Mirrors
-- profiles.stripe_reminder_sent_at (same pattern, different table).
alter table public.bookings
  add column if not exists host_reminder_sent_at timestamptz;

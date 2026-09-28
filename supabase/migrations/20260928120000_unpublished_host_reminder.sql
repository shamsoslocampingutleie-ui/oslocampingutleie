-- Backs the daily remind-unpublished-host cron: last time an approved
-- host with zero listings was reminded to finish their first one.
-- Mirrors profiles.stripe_reminder_sent_at / bookings.host_reminder_sent_at
-- (same pattern, different segment).
--
-- Why this segment specifically: Turo's own 2026 host-growth push
-- (verified via web search while building this) targets exactly this
-- group -- "hosts who previously created a host account but haven't
-- completed their first vehicle listing" -- with a real cash incentive
-- once their first listing completes a trip. On this platform the
-- segment is small right now (checked live: 3 approved hosts total, 1
-- with zero listings), but it's a real, high-intent group -- someone
-- who already went through applying and got approved, not a cold
-- lead -- and the funnel data shows zero recorded listing_publish_blocked
-- events, meaning people who start a listing aren't hitting validation
-- errors, they're just losing momentum. A well-timed nudge is a
-- proven, low-risk intervention for exactly that failure mode.
alter table public.profiles
  add column if not exists unpublished_host_reminder_sent_at timestamptz;

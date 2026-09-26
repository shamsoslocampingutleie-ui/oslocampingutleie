-- Makes the "your Stripe setup isn't finished" outreach a standing
-- safeguard instead of a one-off admin action. Sent manually once to
-- the 4 hosts affected right now (see notify-stripe-connect-required),
-- but any host who signs up later, starts a listing, and never
-- finishes Stripe Connect would otherwise only ever see the in-app
-- dashboard banner -- easy to miss if they don't log back in. This
-- column backs a weekly, self-terminating reminder email (stops once
-- stripe_charges_enabled becomes true, since that's the query filter
-- in remind-stripe-connect-incomplete) via a cron-invoked edge
-- function.
alter table public.profiles
  add column if not exists stripe_reminder_sent_at timestamptz;

-- The cron.schedule() call itself is intentionally NOT run here: like
-- the other three jobs in cron.job (auto-clean-errors,
-- delete-expired-license-docs, handover-reminder-daily), it needs a
-- live service_role bearer token in its command text, which must never
-- be committed to a migration file that lands in git history. It was
-- scheduled directly against the linked project instead, in the same
-- ad-hoc way those three already were. Shape, for reference:
--
--   select cron.schedule(
--     'remind-stripe-connect-incomplete',
--     '0 10 * * 1', -- Mondays 10:00 UTC
--     $$select net.http_post(
--         url:='https://<project-ref>.supabase.co/functions/v1/remind-stripe-connect-incomplete',
--         headers:='{"Authorization":"Bearer <service_role_key>","Content-Type":"application/json"}'::jsonb,
--         body:='{}'::jsonb
--       ) as request_id$$
--   );

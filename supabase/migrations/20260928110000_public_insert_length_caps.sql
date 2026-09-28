-- demand_signals and contact_requests both allow a fully open,
-- unauthenticated insert (with check (true)) -- correct for what
-- they're for (an anonymous "notify me" or contact form), but neither
-- table had a size limit on any text column. Postgres RLS has no
-- concept of per-IP rate limiting (only the edge-function-fronted
-- forms in this project, e.g. campaign-submit, get that via
-- checkRateLimit), so the cheap, safe mitigation available at the
-- table level is capping payload size -- stops someone from using
-- either open endpoint to store an arbitrarily large blob of text per
-- row. Generous limits; no legitimate form submission is anywhere
-- close to them.
--
-- Written idempotently (check pg_constraint first) -- a first attempt
-- at this migration found contact_requests_name_len already existed
-- live (this table was previously "found live, untracked", so it may
-- carry constraints no migration here recorded either).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'demand_signals_email_len') then
    alter table public.demand_signals add constraint demand_signals_email_len check (char_length(email) <= 320);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'demand_signals_category_len') then
    alter table public.demand_signals add constraint demand_signals_category_len check (category is null or char_length(category) <= 200);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'demand_signals_location_len') then
    alter table public.demand_signals add constraint demand_signals_location_len check (location is null or char_length(location) <= 200);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contact_requests_name_len') then
    alter table public.contact_requests add constraint contact_requests_name_len check (char_length(name) <= 200);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contact_requests_email_len') then
    alter table public.contact_requests add constraint contact_requests_email_len check (char_length(email) <= 320);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contact_requests_phone_len') then
    alter table public.contact_requests add constraint contact_requests_phone_len check (char_length(phone) <= 50);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contact_requests_subject_len') then
    alter table public.contact_requests add constraint contact_requests_subject_len check (char_length(subject) <= 300);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contact_requests_message_len') then
    alter table public.contact_requests add constraint contact_requests_message_len check (char_length(message) <= 5000);
  end if;
end $$;

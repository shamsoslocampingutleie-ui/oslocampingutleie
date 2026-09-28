-- Adds a real, GDPR-compliant marketing-consent flag. Before this,
-- there was no opt-in mechanism anywhere in the product -- no column,
-- no checkbox -- so a monthly newsletter (growth plan item #9) could
-- never legally be sent to anyone. This only adds the mechanism and
-- backfills existing users to false (opted out); it does NOT grant
-- consent to anyone retroactively. Existing users who want in have to
-- opt in themselves later (e.g. from account settings), same as new
-- signups do at registration.
alter table public.profiles
  add column if not exists marketing_consent boolean not null default false;

-- Capture it at signup from the same SECURITY DEFINER trigger that
-- already writes the profiles row (see 20260916090000_fix_registration_log_never_written.sql).
-- Unchecked checkbox on the client -> raw_user_meta_data has no
-- 'marketing_consent' key -> coalesce to false, never true by default.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, marketing_consent)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    coalesce((new.raw_user_meta_data->>'marketing_consent')::boolean, false)
  )
  on conflict (id) do nothing;

  insert into public.registration_log (user_id, email, full_name, phone)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'phone'
  );

  return new;
end;
$$;

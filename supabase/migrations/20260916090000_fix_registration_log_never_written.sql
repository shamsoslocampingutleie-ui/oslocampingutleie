-- registration_log is intentionally service_role-only (no insert policy,
-- by design, so the fraud/security trail can't be forged by the client
-- whose registration it records). But the client called
-- sb.from("registration_log").insert(...) directly from app.html,
-- wrapped in try{}catch(_){} — so it has always failed RLS and been
-- silently swallowed. The log has never recorded a single row since
-- the feature was built.
--
-- Fix: write it from the existing SECURITY DEFINER trigger that already
-- creates the profiles row on signup, which runs with elevated
-- privileges and legitimately bypasses RLS. The client-side insert
-- attempt in app.html is removed in the same deploy as this migration.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email))
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

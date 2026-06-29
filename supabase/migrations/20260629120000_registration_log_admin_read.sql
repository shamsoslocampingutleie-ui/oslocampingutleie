-- ============================================================
-- 2026-06-29: registration_log — admin-lesetilgang
-- ============================================================
-- registration_log ble opprettet med RLS aktivert men uten noen policies,
-- noe som betyr at kun service_role kan lese tabellen (RLS blokkerer alt annet).
-- Admins trenger å kunne se denne tabellen fra app-dashbordet for svindelsporing.

-- Admins kan lese alle registreringslogger (svindelsporing, sikkerhet)
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'registration_log'
    and policyname = 'registration_log_admin_read'
  ) then
    create policy "registration_log_admin_read"
      on public.registration_log
      for select
      using (public.is_admin());
  end if;
end $$;

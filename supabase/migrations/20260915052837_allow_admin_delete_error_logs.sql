-- error_logs had RLS enabled with only insert/select policies, so the
-- admin dashboard's manual "Clean up" and "Delete all" buttons silently
-- deleted 0 rows (PostgREST returns 204 even when RLS filters out every
-- row). Add a delete policy matching the existing read policy so admins
-- can actually clear the log by hand, not just via the scheduled
-- service-role cron cleanup.
drop policy if exists error_logs_delete on public.error_logs;
create policy error_logs_delete on public.error_logs for delete using (public.is_admin());

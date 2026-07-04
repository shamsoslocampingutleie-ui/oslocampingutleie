-- Allow admins to delete any booking from the admin panel.
drop policy if exists "Admins can delete any booking" on public.bookings;
create policy "Admins can delete any booking"
  on public.bookings for delete
  using (public.is_admin());

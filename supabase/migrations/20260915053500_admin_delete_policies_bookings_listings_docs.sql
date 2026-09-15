-- Same bug class as error_logs: RLS was missing policies for actions the
-- admin UI already performs, so those buttons silently succeed (0 rows
-- affected) instead of doing anything.
--
-- 1) Admin "Slett booking" in the admin bookings panel had no delete
--    policy on bookings at all.
-- 2) Admin "Slett" on another host's listing (admin listings panel) only
--    had the owner-only delete policy, so it never worked for listings
--    admin doesn't own.
-- 3) booking_documents (renter driver's licences) had no admin bypass on
--    select at all, so the admin ID-verification panel only ever showed
--    documents tied to bookings on admin's own listings, not the whole
--    platform. The reject/delete button had the same gap.

drop policy if exists "Admins can delete any booking" on public.bookings;
create policy "Admins can delete any booking"
  on public.bookings for delete
  using (public.is_admin());

drop policy if exists "Admins can delete any listing" on public.listings;
create policy "Admins can delete any listing"
  on public.listings for delete
  using (public.is_admin());

drop policy if exists "booking_docs_select" on public.booking_documents;
create policy "booking_docs_select" on public.booking_documents for select
  using (
    auth.uid() = user_id
    or public.is_admin()
    or auth.uid() in (
      select b.renter from public.bookings b where b.id = booking_id
      union
      select l.owner from public.bookings b
        join public.listings l on l.id = b.listing_id
       where b.id = booking_id
    )
  );

drop policy if exists "booking_docs_delete" on public.booking_documents;
create policy "booking_docs_delete" on public.booking_documents for delete
  using (public.is_admin());

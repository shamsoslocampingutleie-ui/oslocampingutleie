-- Full security review finding: booking_photos_read (and _upload) only
-- ever checked `auth.uid() is not null` -- ANY logged-in user could read
-- (and write into) ANY booking's photo folder in the private
-- 'booking-photos' bucket, not just the two parties to that booking.
-- Upload paths are {bookingId}/renter_id/... (see src/app.html), so this
-- meant every renter-ID photo, damage-evidence photo, and before/after
-- handover photo on the platform was readable by any authenticated
-- stranger who had (or could enumerate/guess) a booking id -- and now
-- that /booking/{id} links go out in emails, booking ids are considerably
-- more exposed than before. Scoped both policies to admin + the
-- booking's actual renter/host, the same trust boundary already used for
-- the booking_documents table and booking_transport.

drop policy if exists "booking_photos_read" on storage.objects;
create policy "booking_photos_read" on storage.objects for select
  using (
    bucket_id = 'booking-photos'
    and (
      public.is_admin()
      or exists (
        select 1 from public.bookings b
        left join public.listings l on l.id = b.listing_id
        where b.id::text = (storage.foldername(name))[1]
          and (b.renter = auth.uid() or l.owner = auth.uid())
      )
    )
  );

drop policy if exists "booking_photos_upload" on storage.objects;
create policy "booking_photos_upload" on storage.objects for insert
  with check (
    bucket_id = 'booking-photos'
    and (
      public.is_admin()
      or exists (
        select 1 from public.bookings b
        left join public.listings l on l.id = b.listing_id
        where b.id::text = (storage.foldername(name))[1]
          and (b.renter = auth.uid() or l.owner = auth.uid())
      )
    )
  );

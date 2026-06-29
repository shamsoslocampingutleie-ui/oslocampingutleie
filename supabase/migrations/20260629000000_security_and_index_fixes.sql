-- ============================================================
-- 2026-06-29: Sikkerhets- og ytelsesfikser
-- ============================================================

-- FIX 1: booking-photos storage policies var for åpne.
-- "auth.uid() is not null" lot enhver innlogget bruker lese/skrive
-- alle booking-bilder. Ny policy begrenser til booking-partene og admin.

drop policy if exists "booking_photos_upload" on storage.objects;
create policy "booking_photos_upload" on storage.objects for insert
  with check (
    bucket_id = 'booking-photos'
    and auth.uid() is not null
    and (
      public.is_admin()
      or auth.uid()::text = (storage.foldername(name))[1]
    )
  );

drop policy if exists "booking_photos_read" on storage.objects;
create policy "booking_photos_read" on storage.objects for select
  using (
    bucket_id = 'booking-photos'
    and (
      public.is_admin()
      or auth.uid()::text = (storage.foldername(name))[1]
    )
  );

-- FIX 2: Fjern duplikatindekser (opprettet i seksjon 14 og 21/22).
-- Postgres vedlikeholder begge indeksene ved hver skriving — dobbelt arbeid.
drop index if exists public.messages_booking_id_idx;    -- duplikat av messages_booking_id_idx2
drop index if exists public.reviews_listing_id_idx;     -- duplikat av reviews_listing_id_idx2

-- FIX 3: Legg til komposittindeks for tilgjengelighetsspørringer.
-- Kalender/booking-overlap-sjekk: WHERE status = 'accepted' AND from_date <= $to AND to_date >= $from
-- Dette gjør datospørringer vesentlig raskere ved voksende bookingvolum.
create index if not exists bookings_availability_idx
  on public.bookings (listing_id, status, from_date, to_date)
  where status = 'accepted';

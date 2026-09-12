-- ============================================================
-- 2026-09-12: ID-kontroll — admin-tilgang + manglende slette-policy
-- ============================================================
-- Bakgrunn: "drivers-license" storage-bucket (private) hadde kun to
-- policyer: opplasting og lesing, begge begrenset til eieren selv.
--
-- Konsekvens 1: Admin sitt ID-kontroll-panel kunne aldri faktisk vise
-- opplastede førerkort/legitimasjon for godkjenning — _signedSrc()
-- feilet stille ("Bilde utilgjengelig") fordi admin ikke er eieren.
--
-- Konsekvens 2: Det fantes ingen DELETE-policy i det hele tatt for
-- denne bucketen. Koden i appen prøver å slette dokumentet etter
-- godkjenning/avvisning (og når en bruker fjerner sin egen opplastede
-- legitimasjon), men dette har alltid feilet stille — dokumentene ble
-- aldri faktisk fjernet fra lagring. Med sensitive ID-dokumenter er
-- dette et reelt personvern-/dataminimeringsproblem.

drop policy if exists "license_read" on storage.objects;
create policy "license_read" on storage.objects for select
  using (bucket_id = 'drivers-license' and (auth.uid()::text = (storage.foldername(name))[1] or public.is_admin()));

drop policy if exists "license_delete" on storage.objects;
create policy "license_delete" on storage.objects for delete
  using (bucket_id = 'drivers-license' and (auth.uid()::text = (storage.foldername(name))[1] or public.is_admin()));

-- Same storage-level audit as the listings RLS cleanup
-- (20260926110000): a "listing-photos" bucket exists live, public,
-- with its own photos_write/photos_read policies -- but neither the
-- bucket name nor either policy name appears in any migration or
-- prior schema.sql, and nothing in src/app.html or supabase/functions
-- ever references "listing-photos" (only "listing-images", the real,
-- tracked bucket that the app actually uses for annonse photos).
-- Confirmed live: 0 objects in the bucket. Dead, untracked
-- configuration -- a public bucket authenticated users could still
-- write into for no reason, serving nothing. Removing bucket + both
-- policies.
drop policy if exists "photos_write" on storage.objects;
drop policy if exists "photos_read" on storage.objects;
-- The bucket row itself is removed separately via the Storage API
-- (supabase storage rm), not here -- direct SQL DELETE against
-- storage.buckets is rejected by Supabase (SQLSTATE 42501: "Direct
-- deletion from storage tables is not allowed. Use the Storage API
-- instead."). With no policies left on it, the bucket is already
-- inaccessible to every client regardless.

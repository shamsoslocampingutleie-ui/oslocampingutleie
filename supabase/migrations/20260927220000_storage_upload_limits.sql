-- Storage buckets had no server-side file-size or MIME-type limits at
-- all -- every upload path in the client (avatar, listing photos,
-- driver's license, booking handover/return photos) restricts the file
-- picker to accept="image/*" and compresses before upload, but that is
-- purely a client-side convenience with zero enforcement: anyone with a
-- valid JWT could call the Storage API directly and upload an
-- arbitrarily large file of any type to any of these buckets. Two real
-- consequences: unbounded storage-cost/DoS exposure (no cap on file
-- size or count), and a stored-content risk on the two PUBLIC buckets
-- (avatars, listing-images) -- an uploaded .html file would be served
-- back with its original content-type, i.e. executable-in-browser
-- content on a trusted-looking Supabase storage URL.
--
-- This does not change any application behavior for real users --
-- every upload path already only ever sends image/* -- it just makes
-- the server actually enforce what the client already assumes.
update storage.buckets set
  file_size_limit = 8388608, -- 8 MB: generous for a compressed profile photo
  allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic','image/heif','image/gif']
where id = 'avatars';

update storage.buckets set
  file_size_limit = 15728640, -- 15 MB
  allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic','image/heif','image/gif']
where id = 'listing-images';

update storage.buckets set
  file_size_limit = 15728640,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic','image/heif','image/gif']
where id = 'drivers-license';

update storage.buckets set
  file_size_limit = 15728640,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic','image/heif','image/gif']
where id = 'booking-photos';

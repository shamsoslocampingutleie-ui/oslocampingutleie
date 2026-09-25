-- Found while fixing the same storage-orphan class of bug for avatars
-- as was already fixed for listing-images: the avatars bucket had
-- select/insert/update storage.objects policies but NO delete policy
-- at all. Without this, the client-side cleanup (removing a stale
-- avatar file left behind when a user uploads a new one under a
-- different file extension) would fail silently under RLS -- upload
-- only overwrites an identical path, so switching image format
-- between uploads orphans the old file in storage forever otherwise.
drop policy if exists "Users can delete their own avatar" on storage.objects;
create policy "Users can delete their own avatar"
  on storage.objects for delete
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- Two fixes, bundled because they both touch the chat experience:
--
-- 1) Chat was never actually real-time. openChat() subscribes to
--    postgres_changes on public.messages with no polling fallback (unlike
--    the admin dashboards, which poll every 5s *and* attempt realtime) --
--    but public.messages was never added to the supabase_realtime
--    publication (only public.notifications was, from an earlier
--    migration). A Postgres publication is what actually feeds the
--    replication stream Realtime listens to; subscribing client-side to
--    a table that isn't published silently receives nothing, forever.
--    Same root problem for public.bookings and public.listings, whose
--    admin/host dashboard subscriptions were quietly doing nothing and
--    riding entirely on their 5s poll fallback. Client-side filters
--    (e.g. booking_id=eq.<id>) are matched against the row RLS already
--    scopes to the connecting user's own JWT, so this doesn't expose
--    anything a direct query wouldn't already allow that user to read.
--
-- 2) Adds messages.image_url so a chat message can carry a photo,
--    uploaded to the existing private 'booking-photos' bucket (already
--    scoped to admin + the booking's renter/host -- see
--    20260924100000_scope_booking_photos_access.sql) under
--    {bookingId}/chat/... -- no new bucket or storage policy needed.

alter table public.messages
  add column if not exists image_url text default null;

do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.bookings;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.listings;
exception when duplicate_object then null; end $$;

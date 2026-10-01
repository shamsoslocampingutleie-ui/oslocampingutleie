-- messages had NO index beyond its primary key (id) -- verified live via
-- pg_indexes while auditing. Every real query against this table filters
-- on booking_id (grepped src/app.html: ~15 call sites, almost all
-- .eq('booking_id', ...).order('created_at', ...), plus two admin
-- .like('booking_id', 'direct-%'/'inquiry:%') prefix scans for the
-- synthetic direct-message/inquiry thread ids) -- every chat open, every
-- inbox load, and the admin unread-message poll (on a realtime
-- subscription firing on every INSERT) has been doing a full sequential
-- scan of the entire table. Harmless at today's row count; compounds
-- badly as bookings/chat volume grows, and the admin unread poll alone
-- runs on every new message platform-wide.
--
-- Two indexes, matching the two real access patterns:
--   1. (booking_id, created_at) -- serves the exact-match + order-by
--      queries, which is nearly everything.
--   2. booking_id text_pattern_ops -- a plain btree index on a text
--      column (default, non-C collation -- verified live) can't serve a
--      LIKE 'prefix%' scan; text_pattern_ops is specifically what makes
--      that usable, for the two admin prefix queries above.
create index if not exists idx_messages_booking_created
  on public.messages (booking_id, created_at);

create index if not exists idx_messages_booking_id_pattern
  on public.messages (booking_id text_pattern_ops);

-- Two call sites load the latest 500 messages platform-wide with no
-- booking_id filter at all (admin "all messages" overview) -- order-by
-- with no filter, so only created_at helps here.
create index if not exists idx_messages_created_at
  on public.messages (created_at desc);

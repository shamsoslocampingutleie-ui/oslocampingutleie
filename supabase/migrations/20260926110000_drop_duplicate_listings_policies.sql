-- Found via a full pg_policies audit prompted by the earlier profiles
-- leak (see 20260925220100_drop_untracked_profiles_read_all.sql): the
-- listings table carries a 4th instance this session of the same
-- "untracked database object" pattern (after wishlists, upload_sessions
-- and profiles_read_all) -- listings_read/insert/update/delete exist
-- live but appear in no migration and no prior version of schema.sql,
-- meaning they were created directly against the database at some
-- point and never captured.
--
-- Unlike the profiles case, these are NOT a security leak: each one's
-- qual/with_check is byte-for-byte identical to its already-tracked,
-- human-readable-named counterpart ("Active listings are viewable by
-- everyone" / "Owners can insert/update/delete their listings") --
-- confirmed live before writing this migration. They're pure
-- redundancy (RLS evaluates both on every query for no extra access
-- granted), not a gap. Dropping the untracked duplicates only, keeping
-- the tracked originals.
drop policy if exists "listings_read" on public.listings;
drop policy if exists "listings_insert" on public.listings;
drop policy if exists "listings_update" on public.listings;
drop policy if exists "listings_delete" on public.listings;

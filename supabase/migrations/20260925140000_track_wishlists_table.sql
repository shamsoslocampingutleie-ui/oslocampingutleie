-- wishlists existed in production but was never captured in a tracked
-- migration (created directly via the SQL editor at some point) --
-- found while auditing every table's RLS during a security pass.
-- Verified live via the Supabase dashboard: RLS is enabled and the
-- existing "wishlists_all" policy correctly scopes every command to
-- `user_id = auth.uid()` (an anonymous/unauthenticated caller has
-- auth.uid() = null, and `user_id = null` is never true, so they get
-- zero rows). Not deliberately vulnerable, just undocumented.
--
-- This migration intentionally does NOT include a `create table` --
-- the dashboard only showed id/user_id in the visible columns, and
-- guessing the rest (listing_id's exact type/FK, any other columns,
-- constraints) risks recording something that doesn't match what's
-- actually live. It only (re-)asserts the RLS state already verified
-- by screenshot, which is a safe no-op against the real table either
-- way. The full column list still belongs in version control --
-- ideally via `supabase db pull`, which needs Docker and wasn't
-- available in this environment; a plain `\d wishlists` (or the
-- Table Editor's "..." → "View table definition") pasted back gets
-- this finished properly.
alter table public.wishlists enable row level security;

drop policy if exists "wishlists_all" on public.wishlists;
create policy "wishlists_all" on public.wishlists for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

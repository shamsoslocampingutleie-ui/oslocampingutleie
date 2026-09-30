-- Same class of gap as bulk_email_log (20260928140000): push_subscriptions
-- exists live, is actively read/written from src/app.html (_enableAdminPush
-- et al.) and several notify-*/send-push edge functions, has correct RLS
-- already (auth.uid() = user_id, verified live), but no migration file in
-- this repo ever created it -- same "must have been made directly via
-- dashboard/SQL editor" gap, same fix: bring the tracked history in sync
-- with what's actually deployed. `create table if not exists` is a no-op
-- against the live table.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

-- Matches the live policy exactly (verified via pg_policies before
-- writing this): owner-only, applies to all commands including insert.
drop policy if exists "push_subs_own" on public.push_subscriptions;
create policy "push_subs_own" on public.push_subscriptions
  for all using (auth.uid() = user_id);

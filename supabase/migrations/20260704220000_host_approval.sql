-- Host approval: new hosts must be manually approved by admin before listing.
-- null = never applied, false = pending review, true = approved
alter table public.profiles
  add column if not exists host_approved boolean default null,
  add column if not exists host_applied_at timestamptz default null;

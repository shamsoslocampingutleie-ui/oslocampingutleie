-- Requested feature: hosts can choose, per listing, whether renters must
-- upload identification through the platform before booking ('upload',
-- the existing default/behaviour) or whether the host will check ID
-- themselves in person at handover ('in_person', skips the upload
-- requirement client-side for that listing).
alter table public.listings
  add column if not exists id_check_mode text not null default 'upload';

do $$ begin
  alter table public.listings
    add constraint listings_id_check_mode_check check (id_check_mode in ('upload','in_person'));
exception when duplicate_object then null; end $$;

-- Requested feature: car (category='car') listings can specify how many
-- kilometres are included per rental day, and the price per additional
-- km beyond that -- standard terms for peer-to-peer car rental that
-- didn't have a dedicated field before (hosts would otherwise have to
-- write it into the free-text description/terms, easy to miss and not
-- shown as a clear spec to renters).
alter table public.listings
  add column if not exists included_km_per_day integer default null,
  add column if not exists extra_km_price numeric default null;

do $$ begin
  alter table public.listings
    add constraint listings_included_km_per_day_check check (included_km_per_day is null or included_km_per_day >= 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.listings
    add constraint listings_extra_km_price_check check (extra_km_price is null or extra_km_price >= 0);
exception when duplicate_object then null; end $$;

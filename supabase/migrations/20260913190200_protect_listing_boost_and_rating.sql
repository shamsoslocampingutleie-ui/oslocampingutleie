-- Security fix: listings has no field-protection trigger at all, and
-- "Owners can update their listings" lets an owner update any column on
-- their own row. `boosted_until` is meant to be set only by the paid
-- stripe-boost webhook flow (supabase/functions/stripe-webhook), and
-- `rating`/`reviews_count` are meant to be a computed reflection of real
-- reviews -- but any listing owner could instead PATCH these directly,
-- bypassing payment for boost placement or faking review stats.
--
-- Note: `featured` is intentionally free and host-toggleable (the "Fremhev"
-- button in the host dashboard) and is left untouched here.

create or replace function public.protect_listing_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  if public.is_admin() then
    return new;
  end if;
  new.boosted_until := old.boosted_until;
  new.rating := old.rating;
  new.reviews_count := old.reviews_count;
  return new;
end;
$$;

drop trigger if exists protect_listing_fields_trigger on public.listings;
create trigger protect_listing_fields_trigger
  before update on public.listings
  for each row execute function public.protect_listing_fields();

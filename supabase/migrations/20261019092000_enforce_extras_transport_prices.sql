-- booking_extras/booking_transport skrives av leietakeren selv (RLS
-- bextras_access/btransport_access), inkludert price_snapshot -- og
-- stripe-checkout summerer nettopp price_snapshot inn i beløpet som
-- belastes. En leietaker kunne dermed sette 0 eller et negativt beløp og
-- trekke ned totalen, eller legge til ekstrautstyr fra en annen annonse.
-- Disse triggerne henter navn/pris/prismodell fra annonsens egne tabeller
-- og avviser valg som ikke hører til bookingens annonse.
create or replace function public.enforce_booking_extra_price()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_extra public.listing_extras%rowtype;
begin
  select le.* into v_extra
  from public.listing_extras le
  join public.bookings b on b.listing_id = le.listing_id
  where le.id = new.extra_id
    and b.id = new.booking_id
    and coalesce(le.is_active, true);
  if not found then
    raise exception 'INVALID_EXTRA: Ekstrautstyret hører ikke til denne annonsen.';
  end if;
  new.extra_name := v_extra.name;
  new.price_snapshot := greatest(coalesce(v_extra.price, 0), 0);
  new.pricing_type := coalesce(v_extra.pricing_type, 'fixed');
  new.quantity := 1;
  return new;
end;
$$;

drop trigger if exists enforce_booking_extra_price on public.booking_extras;
create trigger enforce_booking_extra_price
  before insert or update on public.booking_extras
  for each row execute function public.enforce_booking_extra_price();

create or replace function public.enforce_booking_transport_price()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_opt public.transport_options%rowtype;
begin
  select t.* into v_opt
  from public.transport_options t
  join public.bookings b on b.listing_id = t.listing_id
  where t.id = new.transport_option_id
    and b.id = new.booking_id
    and coalesce(t.is_active, true);
  if not found then
    raise exception 'INVALID_TRANSPORT: Transportvalget hører ikke til denne annonsen.';
  end if;
  new.transport_name := v_opt.name;
  new.price_snapshot := greatest(coalesce(v_opt.price, 0), 0);
  new.pricing_mode := coalesce(v_opt.pricing_mode, 'fixed');
  return new;
end;
$$;

drop trigger if exists enforce_booking_transport_price on public.booking_transport;
create trigger enforce_booking_transport_price
  before insert or update on public.booking_transport
  for each row execute function public.enforce_booking_transport_price();

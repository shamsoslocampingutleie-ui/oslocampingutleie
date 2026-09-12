-- ============================================================
-- 2026-09-12: hindre dobbeltbooking av samme annonse/periode
-- ============================================================
-- Bakgrunn: acceptBooking() i appen gjorde en ubetinget UPDATE av
-- status til 'accepted' uten noen sjekk for om annonsen allerede var
-- akseptert av en annen leietaker i samme (eller overlappende)
-- periode. En utleier kunne dermed godta to forespørsler for samme
-- utstyr i samme periode, begge kunne betales via Stripe, og
-- plattformen ville da skylde to leietakere det samme fysiske
-- utstyret. Dette er nå sperret på databasenivå (autoritativ kilde),
-- i tillegg til en sjekk i appen for en tydelig feilmelding før man
-- i det hele tatt treffer databasen.

create or replace function public.prevent_double_booking()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.status = 'accepted' and (old is null or old.status is distinct from 'accepted') then
    if exists (
      select 1 from public.bookings b
      where b.listing_id = new.listing_id
        and b.id <> new.id
        and b.status = 'accepted'
        and b.from_date < new.to_date
        and b.to_date > new.from_date
    ) then
      raise exception 'DOUBLE_BOOKING: Denne perioden er allerede akseptert for en annen leietaker.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_double_booking on public.bookings;
create trigger trg_prevent_double_booking
  before insert or update on public.bookings
  for each row execute function public.prevent_double_booking();

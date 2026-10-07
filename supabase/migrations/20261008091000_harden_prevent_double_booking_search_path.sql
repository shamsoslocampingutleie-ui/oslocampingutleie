-- Full SECURITY DEFINER-revisjon fant denne som eneste funksjon av 14
-- uten eksplisitt search_path -- et klassisk "search path hijacking"-
-- mønster Postgres/Supabase sin egen sikkerhetslinting flagger.
-- Reell utnyttbarhet er lav her (funksjonen bruker allerede kun
-- fullt kvalifiserte public.bookings-referanser), men dette er gratis,
-- risikofri herding for konsistens med alle de 13 andre SECURITY
-- DEFINER-funksjonene i skjemaet. Ingen atferdsendring.
create or replace function public.prevent_double_booking()
returns trigger
language plpgsql
security definer
set search_path to 'public'
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

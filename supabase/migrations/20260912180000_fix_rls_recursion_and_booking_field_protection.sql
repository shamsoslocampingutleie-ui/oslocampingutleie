-- ============================================================
-- 2026-09-12: kritisk fiks — RLS-rekursjon + finansielle felt på bookings
-- ============================================================
-- To separate, alvorlige problemer funnet under en full QA-gjennomgang:
--
-- 1) "Renter can update own non-critical fields" og "Host can update
--    own listing bookings" (policyer som fantes direkte i den levende
--    databasen, men ALDRI ble reflektert tilbake i schema.sql) brukte
--    et with_check-mønster som sammenlignet hvert beskyttet felt mot
--    en subquery på SAMME tabell:
--      not (paid is distinct from (select b.paid from bookings b where b.id = bookings.id))
--    Dette mønsteret gjør at Postgres kaster
--    "infinite recursion detected in policy for relation bookings"
--    (feilkode 42P17) for HVER ENESTE oppdatering en vanlig innlogget
--    bruker gjør — altså var godkjenn/avslå booking, avbestilling,
--    bekreft-utlevering og kontaktinfo-lagring reelt ødelagt i
--    produksjon for alle ikke-admin-brukere. Verifisert direkte mot
--    databasen (simulert ekte JWT + rolle "authenticated").
--
-- 2) Samme mønster ble brukt i migrasjon 20260912140000 for
--    "messages_update" (bygget tidligere i denne økten) — som betyr at
--    "merk som lest"-funksjonen (både vanlig chat og admins
--    varselprikk for nye meldinger) har vært ødelagt fra det
--    øyeblikket den ble laget. Også verifisert og bekreftet ødelagt,
--    nå fikset.
--
-- Løsning: feltbeskyttelse flyttes fra RLS with_check (som må unngå
-- selv-refererende subqueries) til BEFORE UPDATE-triggere som leser
-- OLD/NEW direkte — samme mønster som den allerede eksisterende
-- protect_profile_fields(). Triggere går ikke via RLS på nytt og kan
-- derfor ikke rekursere.
--
-- Begge fikser er verifisert direkte mot databasen i en rullet-tilbake
-- transaksjon: (a) ekte eier/utleier kan nå oppdatere sin egen
-- booking/melding uten rekursjonsfeil, og (b) et forsøk på å sette
-- paid=true/status='accepted' direkte som ikke-service-role blir
-- fortsatt reversert av protect_booking_fields().

-- --- bookings: erstatt de rekursjon-utsatte policyene ---
drop policy if exists "Renter can update own non-critical fields" on public.bookings;
drop policy if exists "Host can update own listing bookings" on public.bookings;
drop policy if exists "Renter or host can update bookings" on public.bookings;
drop policy if exists "bookings_update_owner" on public.bookings;
create policy "bookings_update_owner"
  on public.bookings for update
  using (
    renter = auth.uid()
    or exists (select 1 from public.listings l where l.id = bookings.listing_id and l.owner = auth.uid())
  )
  with check (
    renter = auth.uid()
    or exists (select 1 from public.listings l where l.id = bookings.listing_id and l.owner = auth.uid())
  );

-- protect_booking_fields() itself was already created and applied in
-- migration 20260912160000_prevent_double_booking's companion run
-- earlier the same day — re-declared here (create or replace) so this
-- migration is self-contained and safe to replay.
create or replace function public.protect_booking_fields()
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
  new.payment_intent_id := old.payment_intent_id;
  new.paid := old.paid;
  new.amount_total := old.amount_total;
  new.platform_fee := old.platform_fee;
  new.payout_released := old.payout_released;
  new.transfer_id := old.transfer_id;
  new.stripe_customer_details := old.stripe_customer_details;
  new.refund_id := old.refund_id;
  new.refund_amount := old.refund_amount;
  new.cancelled_by := old.cancelled_by;
  new.cancelled_at := old.cancelled_at;
  new.renter_ip := old.renter_ip;
  new.listing_id := old.listing_id;
  new.renter := old.renter;
  new.from_date := old.from_date;
  new.to_date := old.to_date;
  return new;
end;
$$;

drop trigger if exists protect_booking_fields_trigger on public.bookings;
create trigger protect_booking_fields_trigger
  before update on public.bookings
  for each row execute function public.protect_booking_fields();

-- --- messages: same fix ---
drop policy if exists "messages_update" on public.messages;
create policy "messages_update" on public.messages for update
  using (
    public.is_admin()
    or exists (
      select 1 from public.bookings b
      where b.id::text = booking_id
        and (
          b.renter = auth.uid()
          or exists (select 1 from public.listings l where l.id = b.listing_id and l.owner = auth.uid())
        )
    )
    or (booking_id like 'direct-%' and booking_id = 'direct-' || auth.uid()::text)
  )
  with check (
    public.is_admin()
    or exists (
      select 1 from public.bookings b
      where b.id::text = booking_id
        and (
          b.renter = auth.uid()
          or exists (select 1 from public.listings l where l.id = b.listing_id and l.owner = auth.uid())
        )
    )
    or (booking_id like 'direct-%' and booking_id = 'direct-' || auth.uid()::text)
  );

create or replace function public.protect_message_fields()
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
  new.booking_id := old.booking_id;
  new.sender_id := old.sender_id;
  new.sender_name := old.sender_name;
  new.sender_role := old.sender_role;
  new.text := old.text;
  new.flagged := old.flagged;
  new.flag_reason := old.flag_reason;
  new.created_at := old.created_at;
  return new;
end;
$$;

drop trigger if exists protect_message_fields_trigger on public.messages;
create trigger protect_message_fields_trigger
  before update on public.messages
  for each row execute function public.protect_message_fields();

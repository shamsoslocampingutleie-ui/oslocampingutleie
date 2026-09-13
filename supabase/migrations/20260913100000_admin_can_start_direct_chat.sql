-- ============================================================
-- 2026-09-13: admin kunne ikke starte en ny samtale
-- ============================================================
-- Bakgrunn: messages_insert sin with_check tillot en avsender å
-- skrive til et 'direct-<userId>'-tråd kun når <userId> var deres
-- EGEN auth.uid() — riktig for en vanlig bruker som skriver til admin
-- (direct-<sin egen id>), men det fantes ingen is_admin()-unntak i det
-- hele tatt. Dermed kunne admin aldri sende den FØRSTE meldingen i en
-- ny samtale (direct-<en annen brukers id>) — kun svare i tråder der
-- brukeren allerede hadde skrevet først. messages_select/messages_update
-- hadde riktignok admin-unntak, bare ikke insert.

drop policy if exists "messages_insert" on public.messages;
drop policy if exists messages_insert on public.messages;
create policy "messages_insert" on public.messages for insert
  with check (
    sender_id = auth.uid()
    and (
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
      or (
        booking_id like 'inquiry:%'
        and (
          split_part(booking_id, ':', 3) = auth.uid()::text
          or exists (
            select 1 from public.listings l
            where l.id::text = split_part(booking_id, ':', 2) and l.owner = auth.uid()
          )
        )
      )
    )
  );

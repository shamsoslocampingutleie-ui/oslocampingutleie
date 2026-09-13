-- ============================================================
-- 2026-09-13: pre-booking "Spør utleier" var reelt ødelagt + admin
-- manglet mulighet til å slette samtaler
-- ============================================================
-- Bakgrunn: "Spør utleier" (spørsmål om en annonse FØR booking)
-- opprettet en rad i bookings med from_date/to_date=null og
-- status='question' — men from_date/to_date er NOT NULL, og
-- 'question' er ikke en gyldig verdi i bookings_status_check.
-- INSERT-en har derfor alltid feilet. Selv om den hadde lyktes,
-- fantes det ingen utleier-visning som noensinne ville vist en
-- booking med status='question' — funksjonen var koblet fra i
-- begge ender.
--
-- Løsning: gjenbruk samme tekstbaserte booking_id-mønster som
-- allerede er bevist å fungere for admin sin direktemelding-chat
-- ('direct-<userId>'), men for spørsmål om en annonse:
--   'inquiry:<listingId>:<renterId>'
-- (kolon som skilletegn, ikke bindestrek — UUID-er inneholder
-- bindestreker, så en bindestrek-splitt ville vært tvetydig.)

drop policy if exists "messages_select" on public.messages;
create policy "messages_select" on public.messages for select
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
  );

drop policy if exists "messages_insert" on public.messages;
create policy "messages_insert" on public.messages for insert
  with check (
    sender_id = auth.uid()
    and (
      exists (
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
  );

-- Admin can delete any conversation (per explicit request — a way to
-- clear test/unwanted threads). No delete policy existed on messages
-- at all before this.
drop policy if exists "messages_delete" on public.messages;
create policy "messages_delete" on public.messages for delete
  using (public.is_admin());

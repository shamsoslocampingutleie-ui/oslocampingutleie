-- ============================================================
-- 2026-09-12: messages UPDATE-policy + admin varsel for nye meldinger
-- ============================================================
-- Bakgrunn: "messages"-tabellen hadde kun INSERT og SELECT-policyer.
-- Det fantes ingen UPDATE-policy i det hele tatt, som betyr at ALL
-- "merk som lest" (read_at)-funksjonalitet i appen alltid har feilet
-- stille — både den vanlige booking-chatten (markMessagesRead) og
-- den nye varselprikken for admin i "Samtaler"-fanen.

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
    booking_id is not distinct from (select m.booking_id from public.messages m where m.id = messages.id)
    and sender_id is not distinct from (select m.sender_id from public.messages m where m.id = messages.id)
    and sender_name is not distinct from (select m.sender_name from public.messages m where m.id = messages.id)
    and sender_role is not distinct from (select m.sender_role from public.messages m where m.id = messages.id)
    and text is not distinct from (select m.text from public.messages m where m.id = messages.id)
    and flagged is not distinct from (select m.flagged from public.messages m where m.id = messages.id)
    and flag_reason is not distinct from (select m.flag_reason from public.messages m where m.id = messages.id)
    and created_at is not distinct from (select m.created_at from public.messages m where m.id = messages.id)
  );

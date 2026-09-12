-- ============================================================
-- 2026-09-12: extras/transport-options — admin skrivetilgang
-- ============================================================
-- Bakgrunn: "listing_extras" og "transport_options" hadde write-policyer
-- kun for eieren av annonsen (auth.uid() = listings.owner). Admin fikk
-- nylig mulighet til å redigere ALLE annonser (ikke bare egne), men når
-- admin la til et "ekstra" (f.eks. tilleggsutstyr/pris) på en annonse
-- eid av en annen utleier, feilet insert/delete stille pga RLS — appen
-- viste likevel "Lagt til ✓" fordi feilkoden fra Supabase ikke ble sjekket.
-- Dette så ut som om feltet for ekstra pris "ikke fantes".

drop policy if exists "extras_write" on public.listing_extras;
create policy "extras_write" on public.listing_extras for all
  using (public.is_admin() or auth.uid() in (select owner from public.listings where id = listing_id))
  with check (public.is_admin() or auth.uid() in (select owner from public.listings where id = listing_id));

drop policy if exists "transport_write" on public.transport_options;
create policy "transport_write" on public.transport_options for all
  using (public.is_admin() or auth.uid() in (select owner from public.listings where id = listing_id))
  with check (public.is_admin() or auth.uid() in (select owner from public.listings where id = listing_id));

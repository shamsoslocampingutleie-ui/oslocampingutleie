-- active_visitors-heartbeaten feilet for nesten alle besøkende med
-- "new row violates row-level security policy" (401). Klienten bruker
-- upsert (INSERT ... ON CONFLICT DO UPDATE), og Postgres krever da at
-- raden også passerer SELECT-policyen -- som kun tillater admin. Resultat:
-- admin sin "Aktive besøkende"-visning var nesten alltid tom.
--
-- Å åpne SELECT for alle ville lekke navn/by til andre besøkende, så i
-- stedet går skrivingen via en SECURITY DEFINER-funksjon. user_id og
-- user_name hentes fra JWT/profil på serveren, aldri fra klienten.
create or replace function public.touch_active_visitor(
  p_session_id text,
  p_country text default '',
  p_city text default '',
  p_flag text default '',
  p_page text default 'home'
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
begin
  if p_session_id is null or length(p_session_id) < 6 or length(p_session_id) > 64 then
    return;
  end if;
  if v_uid is not null then
    select full_name into v_name from public.profiles where id = v_uid;
  end if;
  insert into public.active_visitors as av
    (session_id, country, city, flag, current_page, user_id, user_name, last_seen)
  values (
    p_session_id,
    left(coalesce(p_country, ''), 8),
    left(coalesce(p_city, ''), 80),
    left(coalesce(p_flag, ''), 16),
    left(coalesce(nullif(p_page, ''), 'home'), 80),
    v_uid,
    left(v_name, 120),
    now()
  )
  on conflict (session_id) do update set
    country = excluded.country,
    city = excluded.city,
    flag = excluded.flag,
    current_page = excluded.current_page,
    user_id = excluded.user_id,
    user_name = excluded.user_name,
    last_seen = now();
end;
$$;

revoke all on function public.touch_active_visitor(text, text, text, text, text) from public;
grant execute on function public.touch_active_visitor(text, text, text, text, text) to anon, authenticated;

-- Direkte skriving fra klienten trengs ikke lenger; fjern de åpne
-- policyene slik at ingen kan overskrive andres økter.
drop policy if exists anon_insert_visitor on public.active_visitors;
drop policy if exists anon_update_visitor on public.active_visitors;
drop policy if exists active_visitors_upsert on public.active_visitors;

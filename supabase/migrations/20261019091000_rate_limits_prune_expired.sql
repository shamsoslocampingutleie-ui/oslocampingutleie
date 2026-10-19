-- increment_rate_limit() slettet bare utløpte rader for samme nøkkel, men
-- nøkkelen inneholder selve tidsvinduet (ip:vindu), så den samme nøkkelen
-- brukes aldri igjen etter at vinduet er over. Gamle rader ble derfor
-- liggende for alltid (eldste fra juli 2026). Nå ryddes alle utløpte rader.
create or replace function public.increment_rate_limit(p_key text, p_limit integer, p_ttl_seconds integer)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_now       timestamptz := now();
  v_window    timestamptz := v_now + (p_ttl_seconds || ' seconds')::interval;
  v_count     integer;
begin
  delete from public.rate_limits
  where window_end < v_now;

  insert into public.rate_limits (key, count, window_end)
  values (p_key, 1, v_window)
  on conflict (key) do update
    set count = rate_limits.count + 1
  returning count into v_count;

  return v_count <= p_limit;
end;
$$;

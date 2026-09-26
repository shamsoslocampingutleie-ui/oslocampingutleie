-- User feedback: 60 days was too generous for the referral reward.
-- Reduce to 30 days (both here and in the matching UI copy on the
-- "Del & tjen" page / host-overview nudge banner).
create or replace function public.reward_referral_on_first_listing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ref_id uuid;
  already_rewarded boolean;
  is_approved boolean;
  listing_count int;
begin
  select host_approved, referred_by, referral_rewarded
    into is_approved, ref_id, already_rewarded
    from public.profiles where id = new.owner;

  if is_approved is not true or ref_id is null or coalesce(already_rewarded, true) then
    return new;
  end if;

  select count(*) into listing_count from public.listings where owner = new.owner;
  if listing_count > 1 then
    return new; -- not their first listing
  end if;

  update public.profiles
    set fee_waiver_until = greatest(coalesce(fee_waiver_until, now()), now()) + interval '30 days'
    where id = ref_id;

  update public.profiles set referral_rewarded = true where id = new.owner;

  return new;
end;
$$;

-- Found while building growth measures at the user's explicit request
-- ("flere utleiere maks 20 annonser innen 30 dager"): the existing
-- "Del & tjen" (Share & Earn) host-dashboard page generates a shareable
-- link with ?ref={userId} and even promises rewards in its own name --
-- but nothing anywhere (client or database) ever reads that query
-- param, records who referred whom, or grants any reward. It's purely
-- decorative. With only 10 total registered users (7 already hosts, 0
-- pending applications, per a live admin-panel check), turning each
-- existing user into a real channel to their own offline network is the
-- highest-leverage lever available -- this makes that actually work.
--
-- referred_by is captured once at signup (from auth signUp metadata,
-- like account_type/company_name already are) and never changeable
-- afterward by the client. referral_rewarded prevents a referrer being
-- rewarded twice for the same referred user.
alter table public.profiles
  add column if not exists referred_by uuid references public.profiles(id) on delete set null,
  add column if not exists referral_rewarded boolean not null default false;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  ref uuid;
begin
  -- Only accept a referred_by that actually names an existing profile,
  -- and never allow a self-referral (a signup can't name its own not-
  -- yet-created id, but guard anyway since this value ultimately comes
  -- from client-suppliable auth metadata).
  begin
    ref := nullif(new.raw_user_meta_data->>'referred_by', '')::uuid;
  exception when others then
    ref := null;
  end;
  if ref is not null and (ref = new.id or not exists (select 1 from public.profiles where id = ref)) then
    ref := null;
  end if;

  insert into public.profiles (id, email, full_name, phone, account_type, company_name, org_number, referred_by)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    coalesce(new.raw_user_meta_data->>'phone', ''),
    case when new.raw_user_meta_data->>'account_type' = 'company' then 'company' else 'private' end,
    coalesce(new.raw_user_meta_data->>'company_name', ''),
    nullif(new.raw_user_meta_data->>'org_number', ''),
    ref
  )
  on conflict (id) do nothing;

  insert into public.registration_log (user_id, email, full_name, phone)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'phone'
  );

  return new;
end;
$$;

-- Reward: the first time a referred user's FIRST-EVER listing is
-- created, extend the REFERRER's fee_waiver_until by 60 days (stacks on
-- top of whatever they already have, e.g. their own new-host year).
-- Gated on the referred user already being an approved host at that
-- moment (host_approved = true) -- a listing can be created while an
-- application is still pending (see 20260924090000), and rewarding a
-- referral before the referred account is even a real approved host
-- would be gameable. Fires once per referred user (referral_rewarded).
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
    set fee_waiver_until = greatest(coalesce(fee_waiver_until, now()), now()) + interval '60 days'
    where id = ref_id;

  update public.profiles set referral_rewarded = true where id = new.owner;

  return new;
end;
$$;

drop trigger if exists reward_referral_on_first_listing_trigger on public.listings;
create trigger reward_referral_on_first_listing_trigger
  after insert on public.listings
  for each row execute function public.reward_referral_on_first_listing();

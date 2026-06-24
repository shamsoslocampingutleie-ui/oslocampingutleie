-- Weekly and monthly discount percentages for hosts
alter table public.listings
  add column if not exists weekly_discount  smallint not null default 0 check (weekly_discount  between 0 and 80),
  add column if not exists monthly_discount smallint not null default 0 check (monthly_discount between 0 and 80);

comment on column public.listings.weekly_discount  is 'Discount % applied when rental >= 7 days';
comment on column public.listings.monthly_discount is 'Discount % applied when rental >= 28 days';

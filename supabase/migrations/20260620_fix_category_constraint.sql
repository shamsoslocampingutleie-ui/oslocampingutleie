-- Fix: listings_category_check constraint was missing tent, maskiner, fritid, stillas, diverse
-- Run this in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/cglxodxiqpzrgwrfaqbr/sql/new

alter table public.listings drop constraint if exists listings_category_check;

alter table public.listings add constraint listings_category_check
  check (category in ('camping', 'mobil', 'car', 'boat', 'trailer', 'tool', 'tent', 'maskiner', 'fritid', 'stillas', 'diverse'));

-- Fix: listings_category_check constraint was missing tent, maskiner, fritid, stillas, diverse
-- This caused all insert attempts with those categories to fail silently with a generic error
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/cglxodxiqpzrgwrfaqbr/sql/new

alter table public.listings drop constraint if exists listings_category_check;

alter table public.listings add constraint listings_category_check
  check (category in (
    'camping',   -- Campingvogn
    'mobil',     -- Bobil
    'car',       -- Bil
    'boat',      -- Båt
    'trailer',   -- Tilhenger
    'tool',      -- Verktøy
    'tent',      -- Taktelt
    'maskiner',  -- Maskiner
    'fritid',    -- Fritidsutstyr
    'stillas',   -- Stillas
    'diverse'    -- Diverse
  ));

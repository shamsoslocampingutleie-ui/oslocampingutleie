-- The verify-license edge function now also has the AI extract the name
-- printed on an uploaded driver's licence / ID document and compare it
-- against the user's registered full_name, so a document that looks
-- genuine but belongs to someone else no longer passes automatically.
-- These columns store that verdict for the admin review UI.
alter table public.profiles
  add column if not exists drivers_license_ai_name_match boolean,
  add column if not exists host_id_ai_name_match boolean;

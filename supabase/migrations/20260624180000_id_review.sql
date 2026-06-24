-- Admin can review AI verdicts and delete images after approval
alter table public.profiles
  add column if not exists drivers_license_admin_reviewed boolean not null default false,
  add column if not exists drivers_license_doc_type text,        -- 'license' or 'identity'
  add column if not exists drivers_license_ai_result boolean;    -- AI's original verdict (before admin override)

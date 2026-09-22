-- Server-side backstop for the client-side disposable-email check in
-- authRegister() (src/app.html). Supabase's email-confirmation step only
-- proves an inbox exists and received that one link -- a throwaway inbox
-- from mailinator.com/10minutemail.com/etc. passes that just as easily as
-- a real one, so it was never actually gating anything about identity.
-- The client-side check stops the casual/lazy path; this trigger closes
-- the "call supabase.auth.signUp() directly, skip the UI" bypass, since
-- it runs inside Postgres itself, before the row is even written.
--
-- Kept intentionally small and reviewable rather than exhaustive -- new
-- disposable services appear constantly; this blocks the well-known,
-- long-lived ones. Update both this list and DISPOSABLE_EMAIL_DOMAINS in
-- src/app.html together if either changes.

create or replace function public.reject_disposable_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  domain text;
  blocked text[] := array[
    'mailinator.com','tempmail.com','temp-mail.org','10minutemail.com','10minutemail.net',
    'guerrillamail.com','guerrillamail.info','guerrillamail.biz','guerrillamail.de',
    'sharklasers.com','yopmail.com','yopmail.fr','yopmail.net','throwawaymail.com',
    'trashmail.com','trashmail.net','getnada.com','fakeinbox.com','mailnesia.com',
    'mintemail.com','maildrop.cc','dispostable.com','spamgourmet.com','mytemp.email',
    'moakt.com','emailondeck.com','tempinbox.com','tempmailo.com','tempr.email',
    'harakirimail.com','mohmal.com','burnermail.io','33mail.com','mailcatch.com',
    'inboxkitten.com','discard.email','discardmail.com','spambog.com',
    'tempmailaddress.com','luxusmail.org','anonbox.net','mailsac.com','emailfake.com',
    'fakemailgenerator.com','crazymailing.com'
  ];
begin
  domain := lower(split_part(new.email, '@', 2));
  if domain = any(blocked) then
    raise exception 'Engangs-/midlertidige e-postadresser er ikke tillatt. Bruk din vanlige e-post.'
      using errcode = '23514'; -- check_violation: Supabase Auth surfaces this as a 400, not a 500
  end if;
  return new;
end;
$$;

drop trigger if exists reject_disposable_email_trigger on auth.users;
create trigger reject_disposable_email_trigger
  before insert on auth.users
  for each row execute function public.reject_disposable_email();

-- ============================================================================
-- AgriWert – Einladungssystem (Nachtrag zu supabase-schema.sql)
-- ----------------------------------------------------------------------------
-- Im Supabase SQL-Editor EINMAL ausführen.
--
-- Was das bewirkt:
--   * Neue Tabelle "einladungen" – der Admin trägt dort E-Mails ein.
--   * Der Registrierungs-Schutz zieht um: Es darf sich zwar jeder auf der
--     Registrierungsseite VERSUCHEN anzumelden, aber die Datenbank lässt
--     ausschliesslich eingeladene E-Mail-Adressen durch. Alle anderen werden
--     mit einer Fehlermeldung abgewiesen.
--   * Die eingeladene Person wählt ihr Passwort selbst.
--   * Die Rolle wird schon bei der Einladung festgelegt.
--
-- Sicherheit: Der Schutz sitzt in der Datenbank (Trigger), nicht im Browser.
-- Er lässt sich darum von aussen nicht umgehen.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1) Tabelle für Einladungen
-- ----------------------------------------------------------------------------
create table if not exists public.einladungen (
  id             uuid primary key default gen_random_uuid(),
  email          text not null,
  rolle          text not null default 'verkaeufer',
  eingeladen_von uuid references auth.users (id) on delete set null,
  verwendet_am   timestamptz,                       -- null = noch offen
  verwendet_von  uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now()
);

comment on table public.einladungen is
  'Vom Admin eingeladene E-Mail-Adressen. Nur diese dürfen sich registrieren.';

-- Pro E-Mail darf nur EINE offene Einladung existieren
create unique index if not exists einladungen_offene_email
  on public.einladungen (lower(email))
  where verwendet_am is null;


-- ----------------------------------------------------------------------------
-- 2) Registrierungs-Schutz: ersetzt die bisherige handle_new_user()
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  ist_erster boolean;
  einladung  public.einladungen%rowtype;
begin
  -- Der allererste Benutzer überhaupt wird Admin und braucht keine Einladung.
  select count(*) = 0 into ist_erster from public.profiles;

  if ist_erster then
    insert into public.profiles (id, email, full_name, role)
    values (
      new.id, new.email,
      coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
      'admin'
    );
    return new;
  end if;

  -- Alle weiteren brauchen eine offene Einladung auf ihre E-Mail-Adresse.
  select * into einladung
    from public.einladungen
   where lower(email) = lower(new.email)
     and verwendet_am is null
   limit 1;

  if not found then
    raise exception 'KEINE_EINLADUNG'
      using hint = 'Für diese E-Mail-Adresse liegt keine offene Einladung vor.';
  end if;

  -- Profil mit der bei der Einladung festgelegten Rolle anlegen
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id, new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    einladung.rolle
  );

  -- Einladung als verbraucht markieren
  update public.einladungen
     set verwendet_am = now(), verwendet_von = new.id
   where id = einladung.id;

  return new;
end;
$$;

-- Trigger sicherheitshalber neu setzen
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ----------------------------------------------------------------------------
-- 3) Sicherheitsregeln: nur der Admin sieht und verwaltet Einladungen
-- ----------------------------------------------------------------------------
alter table public.einladungen enable row level security;

drop policy if exists "einladungen_admin" on public.einladungen;
create policy "einladungen_admin" on public.einladungen
  for all to authenticated
  using (public.ist_admin())
  with check (public.ist_admin());

-- ============================================================================
-- Fertig. Danach in den Projekt-Einstellungen noch:
--   Authentication → Sign In / Providers → Email
--     * "Allow new users to sign up"  → EIN   (der Trigger oben schützt jetzt)
--     * "Confirm email"               → AUS   (sonst braucht es E-Mail-Versand)
-- ============================================================================

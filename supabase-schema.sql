-- ============================================================================
-- AgriWert – Datenbankschema (Etappe 1)
-- ----------------------------------------------------------------------------
-- Dieses Skript im Supabase SQL-Editor EINMAL ausführen.
-- (Supabase-Dashboard → linkes Menü "SQL Editor" → "New query" → einfügen → RUN)
--
-- Es legt an:
--   * Tabelle profiles        – Benutzerprofile + Rolle
--   * Tabelle settings         – vom Admin anpassbare Preis-Faktoren
--   * Tabelle machines         – die Landmaschinen (alle sehen alles)
--   * Tabelle machine_photos   – Fotos zu einer Maschine
--   * Row-Level-Security (RLS) – Sicherheitsregeln, wer was darf
--   * Automatik: neues Profil bei Registrierung, updated_at aktualisieren
--
-- Den Storage-Bucket "machine-photos" legst du separat im Dashboard an
-- (siehe README.md, Schritt 4).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1) PROFILES – ein Profil pro angemeldetem Benutzer
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text,
  -- Rollen laut Anforderung: admin, geschaeftsfuehrer, verkaufsleiter,
  -- verkaeufer, werkstatt, sachverstaendiger, gast
  role        text not null default 'gast',
  created_at  timestamptz not null default now()
);

comment on table public.profiles is 'Benutzerprofile mit Rolle. Verknüpft mit auth.users.';


-- ----------------------------------------------------------------------------
-- 2) SETTINGS – genau EINE Zeile; enthält alle anpassbaren Preis-Faktoren
--    Der Admin kann diese Werte in der App (Einstellungen) ändern.
-- ----------------------------------------------------------------------------
create table if not exists public.settings (
  id                          int primary key default 1,
  waehrung                    text  not null default 'CHF',
  -- Wertverlust
  wertverlust_jahr_prozent    numeric not null default 6,    -- % pro Jahr Alter
  wertverlust_pro_100h_prozent numeric not null default 1,   -- % je 100 Betriebsstunden
  -- Zustand (Note 1–10)
  zustand_neutral             numeric not null default 5,     -- Note ohne Zu-/Abschlag
  zustand_pro_punkt_prozent   numeric not null default 4,     -- % je Punkt Abweichung
  -- Untergrenze: Preis nie unter X % des Neupreises
  mindest_restwert_prozent    numeric not null default 10,
  -- Ausstattungs-Zuschläge in CHF, frei erweiterbar:  {"Frontlader": 4000, ...}
  ausstattung_zuschlaege      jsonb not null default '{
    "Klimaanlage": 800,
    "Luftsitz": 500,
    "Kabinenfederung": 1500,
    "Vorderachsfederung": 2500,
    "Fronthydraulik": 3000,
    "Frontzapfwelle": 2000,
    "Frontlader": 5000,
    "Druckluftanlage": 1200,
    "ISOBUS": 2500,
    "GPS": 3000,
    "RTK": 6000,
    "Lenksystem": 4000,
    "K80": 800,
    "Zusatzbeleuchtung": 400,
    "Kamera": 600,
    "Klimaautomatik": 1000
  }'::jsonb,
  -- constraint, damit es immer nur eine einzige Einstellungs-Zeile gibt
  constraint settings_singleton check (id = 1)
);

comment on table public.settings is 'Globale, vom Admin anpassbare Preis-Faktoren (nur 1 Zeile).';

-- Standard-Zeile anlegen (falls noch nicht vorhanden)
insert into public.settings (id) values (1)
  on conflict (id) do nothing;


-- ----------------------------------------------------------------------------
-- 3) MACHINES – die Landmaschinen
-- ----------------------------------------------------------------------------
create table if not exists public.machines (
  id                uuid primary key default gen_random_uuid(),
  created_by        uuid references auth.users (id) on delete set null,
  -- Stammdaten
  hersteller        text,
  marke             text,
  modell            text,
  typ               text,
  seriennummer      text,
  fahrgestellnummer text,
  baujahr           int,
  betriebsstunden   int,
  motorstunden      int,
  motorleistung     int,      -- PS
  standort          text,
  besitzer          text,
  -- Preis-relevant
  neupreis          numeric,  -- CHF, Basis für die Berechnung
  zustand_gesamt    int default 5,   -- Note 1–10
  -- Freitext + Ausstattung
  notizen           text,
  ausstattung       jsonb not null default '[]'::jsonb,  -- z.B. ["GPS","Frontlader"]
  -- berechneter Preis (wird beim Speichern von der App eingetragen)
  berechneter_preis numeric,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.machines is 'Landmaschinen. Alle angemeldeten Benutzer sehen und bearbeiten alle.';


-- ----------------------------------------------------------------------------
-- 4) MACHINE_PHOTOS – Fotos zu einer Maschine
-- ----------------------------------------------------------------------------
create table if not exists public.machine_photos (
  id          uuid primary key default gen_random_uuid(),
  machine_id  uuid not null references public.machines (id) on delete cascade,
  storage_path text not null,          -- Pfad im Storage-Bucket
  kategorie   text default 'Sonstige', -- Vorderseite, Motor, Kabine, Reifen ...
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

comment on table public.machine_photos is 'Fotos zu einer Maschine (Verweis in den Storage-Bucket).';


-- ----------------------------------------------------------------------------
-- 5) AUTOMATIK
-- ----------------------------------------------------------------------------

-- 5a) Bei jeder neuen Registrierung automatisch ein Profil anlegen.
--     Der allererste Benutzer wird automatisch Admin.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  ist_erster boolean;
begin
  select count(*) = 0 into ist_erster from public.profiles;

  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    case when ist_erster then 'admin' else 'gast' end
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- 5b) updated_at bei jeder Änderung an machines automatisch aktualisieren
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists machines_set_updated_at on public.machines;
create trigger machines_set_updated_at
  before update on public.machines
  for each row execute function public.set_updated_at();


-- ----------------------------------------------------------------------------
-- 6) ROW-LEVEL-SECURITY (RLS) – wer darf was
--    Grundregel Etappe 1: Wer angemeldet ist, sieht & bearbeitet alle Maschinen.
-- ----------------------------------------------------------------------------

-- Hilfsfunktion: ist der aktuelle Benutzer Admin?
create or replace function public.ist_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- --- profiles ---
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_all" on public.profiles;
create policy "profiles_select_all" on public.profiles
  for select to authenticated using (true);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated using (id = auth.uid());

-- Admin darf alle Profile ändern (z. B. Rollen vergeben)
drop policy if exists "profiles_admin_update" on public.profiles;
create policy "profiles_admin_update" on public.profiles
  for update to authenticated using (public.ist_admin());

-- --- settings ---
alter table public.settings enable row level security;

drop policy if exists "settings_select_all" on public.settings;
create policy "settings_select_all" on public.settings
  for select to authenticated using (true);

-- Nur Admin darf Faktoren ändern
drop policy if exists "settings_admin_update" on public.settings;
create policy "settings_admin_update" on public.settings
  for update to authenticated using (public.ist_admin());

-- --- machines ---  (alle sehen alles / alle bearbeiten alles)
alter table public.machines enable row level security;

drop policy if exists "machines_select_all" on public.machines;
create policy "machines_select_all" on public.machines
  for select to authenticated using (true);

drop policy if exists "machines_insert" on public.machines;
create policy "machines_insert" on public.machines
  for insert to authenticated with check (auth.uid() = created_by);

drop policy if exists "machines_update_all" on public.machines;
create policy "machines_update_all" on public.machines
  for update to authenticated using (true);

-- Löschen darf: Ersteller oder Admin
drop policy if exists "machines_delete" on public.machines;
create policy "machines_delete" on public.machines
  for delete to authenticated using (created_by = auth.uid() or public.ist_admin());

-- --- machine_photos ---
alter table public.machine_photos enable row level security;

drop policy if exists "photos_select_all" on public.machine_photos;
create policy "photos_select_all" on public.machine_photos
  for select to authenticated using (true);

drop policy if exists "photos_insert" on public.machine_photos;
create policy "photos_insert" on public.machine_photos
  for insert to authenticated with check (auth.uid() = created_by);

drop policy if exists "photos_delete" on public.machine_photos;
create policy "photos_delete" on public.machine_photos
  for delete to authenticated using (created_by = auth.uid() or public.ist_admin());


-- ----------------------------------------------------------------------------
-- 7) REALTIME – Änderungen live an alle Clients senden
-- ----------------------------------------------------------------------------
-- Fügt die Tabellen zur Realtime-Publikation hinzu (Fehler ignorieren, falls
-- schon vorhanden).
do $$
begin
  alter publication supabase_realtime add table public.machines;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.machine_photos;
exception when duplicate_object then null;
end $$;

-- ============================================================================
-- Fertig. Weiter geht es mit dem Storage-Bucket – siehe README.md.
-- ============================================================================

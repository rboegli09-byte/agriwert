-- ============================================================================
-- AgriWert – Etappe 2: vollständige Bewertung
-- ----------------------------------------------------------------------------
-- Im Supabase SQL-Editor EINMAL ausführen (nach schema/storage/einladungen).
-- Das Skript ist gefahrlos wiederholbar (alles "if not exists" / "or replace").
--
-- Inhalt:
--   1) Stammdaten vervollständigen (Erstzulassung, Hubraum, Zylinder, ...)
--   2) Ergebnisfelder der automatischen Bewertung + alle Preisarten
--   3) Konflikterkennung (Spalte version)
--   4) Tabelle baugruppen   – technische Bewertung je Baugruppe
--   5) Tabelle reifen
--   6) Tabelle schaeden
--   7) Tabelle kommentare
--   8) Tabelle aufgaben
--   9) Tabelle vergleichsmaschinen – Marktvergleich
--  10) Tabelle machine_verlauf – Audit-Log / Änderungsverlauf
--  11) Einstellungen für die neuen Preis-Faktoren
--  12) RLS, Realtime, Automatik
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1) STAMMDATEN vervollständigen
-- ----------------------------------------------------------------------------
alter table public.machines add column if not exists erstzulassung   date;
alter table public.machines add column if not exists hubraum         int;    -- cm³
alter table public.machines add column if not exists zylinder        int;
alter table public.machines add column if not exists gewicht         int;    -- kg
alter table public.machines add column if not exists servicehistorie text;
alter table public.machines add column if not exists steuerventile   int;    -- Anzahl

-- ----------------------------------------------------------------------------
-- 2) ERGEBNISSE der automatischen Bewertung + Preisarten
-- ----------------------------------------------------------------------------
alter table public.machines add column if not exists zustand_technisch numeric; -- 1–10, aus Baugruppen
alter table public.machines add column if not exists zustand_optisch   numeric; -- 1–10, Lack/Karosserie/Kabine
alter table public.machines add column if not exists zustandsindex     numeric; -- 0–100
alter table public.machines add column if not exists reparaturkosten   numeric; -- Summe aus Baugruppen + Schäden

alter table public.machines add column if not exists marktwert      numeric;
alter table public.machines add column if not exists ankaufspreis   numeric;
alter table public.machines add column if not exists eintauschpreis numeric;
alter table public.machines add column if not exists verkaufspreis  numeric;
alter table public.machines add column if not exists preisband_von  numeric;
alter table public.machines add column if not exists preisband_bis  numeric;

comment on column public.machines.berechneter_preis is
  'Bleibt als Marktwert-Kurzfeld bestehen (Kompatibilität mit Etappe 1).';

-- ----------------------------------------------------------------------------
-- 3) KONFLIKTERKENNUNG
--    Jede Änderung erhöht "version". Die App schickt die Version mit, die sie
--    geladen hat. Stimmt sie nicht mehr, hat jemand anders zwischenzeitlich
--    gespeichert -> die App meldet den Konflikt, statt still zu überschreiben.
-- ----------------------------------------------------------------------------
alter table public.machines add column if not exists version int not null default 1;

create or replace function public.machines_version_hoch()
returns trigger language plpgsql as $$
begin
  new.version = coalesce(old.version, 1) + 1;
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists machines_set_updated_at on public.machines;
drop trigger if exists machines_version on public.machines;
create trigger machines_version
  before update on public.machines
  for each row execute function public.machines_version_hoch();


-- ----------------------------------------------------------------------------
-- 4) BAUGRUPPEN – technische Bewertung
-- ----------------------------------------------------------------------------
create table if not exists public.baugruppen (
  id               uuid primary key default gen_random_uuid(),
  machine_id       uuid not null references public.machines (id) on delete cascade,
  name             text not null,           -- Motor, Getriebe, ...
  note             int  check (note between 1 and 10),
  zustand          text,                    -- Kurzbeschrieb des Zustands
  bemerkungen      text,
  schaeden         text,
  reparaturbedarf  boolean not null default false,
  reparaturkosten  numeric default 0,
  sortierung       int default 0,
  updated_at       timestamptz not null default now(),
  unique (machine_id, name)
);

comment on table public.baugruppen is 'Bewertung 1–10 je Baugruppe einer Maschine.';

-- Standard-Baugruppen laut Anforderung – werden bei jeder neuen Maschine angelegt
create or replace function public.standard_baugruppen()
returns text[] language sql immutable as $$
  select array[
    'Motor', 'Getriebe', 'Kupplung', 'Vorderachse', 'Hinterachse',
    'Bremsanlage', 'Hydraulik', 'Elektrik', 'Lenkung', 'Zapfwelle',
    'Kabine', 'Lack', 'Karosserie'
  ];
$$;

-- Beim Anlegen einer Maschine automatisch alle Baugruppen erzeugen (Note 5 = neutral)
create or replace function public.baugruppen_anlegen()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  n text;
  i int := 0;
begin
  foreach n in array public.standard_baugruppen() loop
    insert into public.baugruppen (machine_id, name, note, sortierung)
    values (new.id, n, 5, i)
    on conflict (machine_id, name) do nothing;
    i := i + 1;
  end loop;
  return new;
end;
$$;

drop trigger if exists machines_baugruppen_anlegen on public.machines;
create trigger machines_baugruppen_anlegen
  after insert on public.machines
  for each row execute function public.baugruppen_anlegen();


-- ----------------------------------------------------------------------------
-- 5) REIFEN
-- ----------------------------------------------------------------------------
create table if not exists public.reifen (
  id          uuid primary key default gen_random_uuid(),
  machine_id  uuid not null references public.machines (id) on delete cascade,
  position    text not null,          -- Vorne links, Hinten rechts, Ersatzrad ...
  hersteller  text,
  dimension   text,                   -- z. B. 540/65 R28
  profil      text,
  verschleiss int check (verschleiss between 0 and 100),  -- % abgefahren
  alter_jahre int,
  zustand     int check (zustand between 1 and 10),
  schaeden    text,
  created_at  timestamptz not null default now()
);

comment on table public.reifen is 'Reifen je Maschine, inkl. Verschleiss in Prozent.';


-- ----------------------------------------------------------------------------
-- 6) SCHÄDEN
-- ----------------------------------------------------------------------------
create table if not exists public.schaeden (
  id                  uuid primary key default gen_random_uuid(),
  machine_id          uuid not null references public.machines (id) on delete cascade,
  titel               text not null,
  beschreibung        text,
  ursache             text,
  prioritaet          text not null default 'mittel',  -- hoch | mittel | tief
  reparaturempfehlung text,
  kostenschaetzung    numeric default 0,
  created_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now()
);

comment on table public.schaeden is 'Einzelne Schäden mit Priorität und Kostenschätzung.';


-- ----------------------------------------------------------------------------
-- 7) KOMMENTARE
-- ----------------------------------------------------------------------------
create table if not exists public.kommentare (
  id         uuid primary key default gen_random_uuid(),
  machine_id uuid not null references public.machines (id) on delete cascade,
  text       text not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);


-- ----------------------------------------------------------------------------
-- 8) AUFGABEN
-- ----------------------------------------------------------------------------
create table if not exists public.aufgaben (
  id            uuid primary key default gen_random_uuid(),
  machine_id    uuid not null references public.machines (id) on delete cascade,
  titel         text not null,
  zugewiesen_an uuid references auth.users (id) on delete set null,
  faellig_am    date,
  erledigt      boolean not null default false,
  erledigt_am   timestamptz,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now()
);


-- ----------------------------------------------------------------------------
-- 9) VERGLEICHSMASCHINEN – Marktvergleich
--    Hinweis: Automatisches Befüllen aus Portalen ist rechtlich nicht zulässig.
--    Die Einträge werden erfasst oder später über eine lizenzierte API geladen.
-- ----------------------------------------------------------------------------
create table if not exists public.vergleichsmaschinen (
  id              uuid primary key default gen_random_uuid(),
  machine_id      uuid not null references public.machines (id) on delete cascade,
  hersteller      text,
  modell          text,
  typ             text,
  baujahr         int,
  betriebsstunden int,
  ausstattung     text,
  region          text,
  zustand         int check (zustand between 1 and 10),
  angebotspreis   numeric,
  quelle          text,
  quelle_url      text,
  stand_am        date,                -- Aktualität
  vergleichbarkeit int check (vergleichbarkeit between 0 and 100), -- % , automatisch berechnet
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now()
);


-- ----------------------------------------------------------------------------
-- 10) AUDIT-LOG / ÄNDERUNGSVERLAUF
-- ----------------------------------------------------------------------------
create table if not exists public.machine_verlauf (
  id         uuid primary key default gen_random_uuid(),
  machine_id uuid references public.machines (id) on delete cascade,
  tabelle    text not null,
  aktion     text not null,         -- INSERT | UPDATE | DELETE
  feld       text,
  alt_wert   text,
  neu_wert   text,
  benutzer   uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists machine_verlauf_idx
  on public.machine_verlauf (machine_id, created_at desc);

comment on table public.machine_verlauf is
  'Lückenloser Änderungsverlauf. Wird per Trigger gefüllt und ist nicht änderbar.';

-- Trigger: schreibt jede Feldänderung an machines mit
create or replace function public.machines_verlauf_schreiben()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  feld     text;
  alt_json jsonb := to_jsonb(old);
  neu_json jsonb := to_jsonb(new);
  ignoriert text[] := array['updated_at', 'version'];
begin
  if tg_op = 'INSERT' then
    insert into public.machine_verlauf (machine_id, tabelle, aktion, benutzer)
    values (new.id, 'machines', 'INSERT', auth.uid());
    return new;
  end if;

  if tg_op = 'DELETE' then
    insert into public.machine_verlauf (machine_id, tabelle, aktion, benutzer)
    values (old.id, 'machines', 'DELETE', auth.uid());
    return old;
  end if;

  -- UPDATE: jedes geänderte Feld einzeln protokollieren
  for feld in select jsonb_object_keys(neu_json) loop
    if feld = any(ignoriert) then continue; end if;
    if alt_json -> feld is distinct from neu_json -> feld then
      insert into public.machine_verlauf
        (machine_id, tabelle, aktion, feld, alt_wert, neu_wert, benutzer)
      values (new.id, 'machines', 'UPDATE', feld,
              alt_json ->> feld, neu_json ->> feld, auth.uid());
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists machines_verlauf on public.machines;
create trigger machines_verlauf
  after insert or update or delete on public.machines
  for each row execute function public.machines_verlauf_schreiben();


-- ----------------------------------------------------------------------------
-- 11) EINSTELLUNGEN für die neuen Preis-Faktoren (alle admin-anpassbar)
-- ----------------------------------------------------------------------------
alter table public.settings add column if not exists ankauf_prozent      numeric not null default 75;
alter table public.settings add column if not exists eintausch_prozent   numeric not null default 85;
alter table public.settings add column if not exists verkauf_prozent     numeric not null default 115;
alter table public.settings add column if not exists preisband_prozent   numeric not null default 10;
alter table public.settings add column if not exists reparatur_abzug_prozent numeric not null default 100;
-- Gewichtung technischer vs. optischer Zustand im Gesamt-Zustandsindex
alter table public.settings add column if not exists gewicht_technisch   numeric not null default 70;
alter table public.settings add column if not exists gewicht_optisch     numeric not null default 30;
-- Abzug pro Prozent Reifenverschleiss (auf den Marktwert)
alter table public.settings add column if not exists reifen_abzug_prozent numeric not null default 0.02;

comment on column public.settings.ankauf_prozent is 'Ankaufspreis = Marktwert × diesem Prozentsatz.';
comment on column public.settings.preisband_prozent is 'Preisband = Marktwert ± diesem Prozentsatz.';

-- Fehlende Ausstattungspunkte aus dem Anforderungskatalog ergänzen
update public.settings
   set ausstattung_zuschlaege = ausstattung_zuschlaege
     || '{"Frontladerkonsole": 1500, "Piton Fix": 900, "Arbeitsscheinwerfer": 500,
          "Zusatzhydraulik": 1800}'::jsonb
 where id = 1;


-- ----------------------------------------------------------------------------
-- 12) SICHERHEIT (RLS) – gleiche Grundregel: angemeldet = sehen & bearbeiten
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['baugruppen', 'reifen', 'schaeden', 'kommentare',
                           'aufgaben', 'vergleichsmaschinen']
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists "%s_select" on public.%I', t, t);
    execute format('create policy "%s_select" on public.%I for select to authenticated using (true)', t, t);

    execute format('drop policy if exists "%s_insert" on public.%I', t, t);
    execute format('create policy "%s_insert" on public.%I for insert to authenticated with check (true)', t, t);

    execute format('drop policy if exists "%s_update" on public.%I', t, t);
    execute format('create policy "%s_update" on public.%I for update to authenticated using (true)', t, t);

    execute format('drop policy if exists "%s_delete" on public.%I', t, t);
    execute format('create policy "%s_delete" on public.%I for delete to authenticated using (true)', t, t);
  end loop;
end $$;

-- Verlauf: lesen erlaubt, ändern/löschen NIEMANDEM (auch dem Admin nicht).
-- Nur der Trigger (security definer) schreibt hinein -> Log bleibt beweiskräftig.
alter table public.machine_verlauf enable row level security;

drop policy if exists "verlauf_select" on public.machine_verlauf;
create policy "verlauf_select" on public.machine_verlauf
  for select to authenticated using (true);


-- ----------------------------------------------------------------------------
-- 13) REALTIME für die neuen Tabellen
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['baugruppen', 'reifen', 'schaeden', 'kommentare', 'aufgaben']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ============================================================================
-- Fertig.
-- ============================================================================

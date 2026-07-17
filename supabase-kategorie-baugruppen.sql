-- ============================================================================
-- AgriWert – Baugruppen und Motor-Felder je Kategorie
-- ----------------------------------------------------------------------------
-- WICHTIG: Im AgriWert-Projekt ausführen!
--   https://supabase.com/dashboard/project/wttxabjxbcwjhbqlikit/sql/new
--
-- Was das bewirkt:
--   * Neue Kategorie "Futtertechnik"
--   * Jede Kategorie bekommt EIGENE Standard-Baugruppen (Traktor: Motor,
--     Getriebe, Zapfwelle …; Anhänger: Achsen, Bremsen, Aufbau …).
--   * Jede Kategorie weiss, ob sie einen eigenen Motor hat (hat_motor).
--     Danach richtet sich, ob die App Motor-Felder zeigt.
--   * Neue Maschinen bekommen die Baugruppen IHRER Kategorie. Wird die
--     Kategorie gewechselt, kommen die fehlenden Baugruppen dazu – schon
--     erfasste Bewertungen bleiben erhalten.
--   * Alles bleibt vom Admin anpassbar.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1) Neue Spalten an den Kategorien
-- ----------------------------------------------------------------------------
alter table public.kategorien
  add column if not exists hat_motor boolean not null default true;

alter table public.kategorien
  add column if not exists standard_baugruppen text[];

comment on column public.kategorien.hat_motor is
  'true = eigener Motor (Traktor, Mähdrescher). false = Anbaugerät/Anhänger.';
comment on column public.kategorien.standard_baugruppen is
  'Baugruppen, die neue Maschinen dieser Kategorie bekommen. NULL = globale Vorgabe.';


-- ----------------------------------------------------------------------------
-- 2) Neue Kategorie
-- ----------------------------------------------------------------------------
insert into public.kategorien (name, sortierung, hat_motor, wertverlust_jahr_prozent)
values ('Futtertechnik', 45, false, 7)
on conflict (name) do nothing;


-- ----------------------------------------------------------------------------
-- 3) Motor-Flag und Baugruppen je Kategorie setzen
--    (Vorschläge – der Admin kann alles in der App ändern.)
-- ----------------------------------------------------------------------------

update public.kategorien set hat_motor = true, standard_baugruppen = array[
  'Motor','Getriebe','Kupplung','Vorderachse','Hinterachse','Bremsanlage',
  'Hydraulik','Elektrik','Lenkung','Zapfwelle','Kabine','Lack','Karosserie'
] where name = 'Traktoren';

update public.kategorien set hat_motor = true, standard_baugruppen = array[
  'Motor','Fahrantrieb','Dreschwerk','Reinigung','Schneidwerk','Strohhäcksler',
  'Korntank / Entladung','Hydraulik','Elektrik','Kabine','Lack'
] where name = 'Mähdrescher';

update public.kategorien set hat_motor = true, standard_baugruppen = array[
  'Motor','Fahrantrieb','Einzug','Häckseltrommel','Corncracker','Auswurfkrümmer',
  'Hydraulik','Elektrik','Kabine','Lack'
] where name = 'Feldhäcksler';

update public.kategorien set hat_motor = false, standard_baugruppen = array[
  'Anbau / Deichsel','Kreisel','Zinken','Getriebe','Gelenkwelle','Hydraulik',
  'Fahrwerk','Rahmen','Lack'
] where name = 'Heuernte';

update public.kategorien set hat_motor = false, standard_baugruppen = array[
  'Aufbau / Behälter','Mischwerk','Getriebe','Gelenkwelle','Wiegeeinrichtung',
  'Austrag','Hydraulik','Fahrwerk','Rahmen','Lack'
] where name = 'Futtertechnik';

update public.kategorien set hat_motor = false, standard_baugruppen = array[
  'Rahmen','Dreipunktanbau','Arbeitswerkzeuge','Walze','Hydraulik','Lack'
] where name = 'Bodenbearbeitung';

update public.kategorien set hat_motor = false, standard_baugruppen = array[
  'Rahmen','Saatguttank','Dosiereinheit','Säschare','Fahrwerk','Elektronik',
  'Hydraulik','Lack'
] where name = 'Sätechnik';

update public.kategorien set hat_motor = false, standard_baugruppen = array[
  'Tank','Pumpe','Spritzgestänge','Düsen','Steuerung','Fahrwerk','Rahmen','Lack'
] where name = 'Pflanzenschutz';

update public.kategorien set hat_motor = false, standard_baugruppen = array[
  'Behälter','Streuwerk','Getriebe','Gelenkwelle','Fahrwerk','Rahmen','Lack'
] where name = 'Düngetechnik';

update public.kategorien set hat_motor = false, standard_baugruppen = array[
  'Anhängung / Deichsel','Achsen','Bremsanlage','Fahrwerk / Federung','Aufbau',
  'Bordwände','Elektrik / Beleuchtung','Hydraulik','Lack'
] where name = 'Transport / Anhänger';

update public.kategorien set hat_motor = true, standard_baugruppen = array[
  'Motor','Fahrantrieb','Hubgerüst','Hydraulik','Achsen','Bremsanlage',
  'Lenkung','Elektrik','Kabine','Lack'
] where name = 'Hoflader / Teleskop';

update public.kategorien set hat_motor = true, standard_baugruppen = array[
  'Motor','Fahrantrieb','Geräteaufnahme','Hydraulik','Achsen','Bremsanlage',
  'Lenkung','Elektrik','Kabine','Lack'
] where name = 'Kommunaltechnik';

-- "Sonstige" behält die globale Standardliste (standard_baugruppen bleibt NULL).


-- ----------------------------------------------------------------------------
-- 4) Trigger: Baugruppen nach Kategorie anlegen (beim Erstellen)
-- ----------------------------------------------------------------------------
create or replace function public.baugruppen_anlegen()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  liste text[];
  n text;
  i int := 0;
begin
  select k.standard_baugruppen into liste
    from public.kategorien k where k.id = new.kategorie_id;

  -- Keine Kategorie oder keine eigene Liste -> globale Vorgabe (13)
  if liste is null then
    liste := public.standard_baugruppen();
  end if;

  foreach n in array liste loop
    insert into public.baugruppen (machine_id, name, note, sortierung)
    values (new.id, n, 5, i)
    on conflict (machine_id, name) do nothing;
    i := i + 1;
  end loop;
  return new;
end;
$$;


-- ----------------------------------------------------------------------------
-- 5) Trigger: bei Kategoriewechsel fehlende Baugruppen ergänzen
--    Nicht löschen! Bereits erfasste Bewertungen bleiben erhalten.
-- ----------------------------------------------------------------------------
create or replace function public.baugruppen_sync_kategorie()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  liste text[];
  n text;
  i int := 0;
begin
  if new.kategorie_id is distinct from old.kategorie_id then
    select k.standard_baugruppen into liste
      from public.kategorien k where k.id = new.kategorie_id;
    if liste is null then
      liste := public.standard_baugruppen();
    end if;

    foreach n in array liste loop
      insert into public.baugruppen (machine_id, name, note, sortierung)
      values (new.id, n, 5, i)
      on conflict (machine_id, name) do nothing;
      i := i + 1;
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists machines_baugruppen_sync on public.machines;
create trigger machines_baugruppen_sync
  after update of kategorie_id on public.machines
  for each row execute function public.baugruppen_sync_kategorie();

-- ============================================================================
-- Fertig.
-- ============================================================================

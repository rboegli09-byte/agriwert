-- ============================================================================
-- AgriWert – Status-Ablauf mit Freigaben
-- ----------------------------------------------------------------------------
-- WICHTIG: Im SQL-Editor des AgriWert-Projekts ausführen!
--   https://supabase.com/dashboard/project/wttxabjxbcwjhbqlikit/sql/new
--   (Nicht im Printox-Projekt – dort gibt es keine machines-Tabelle.)
--
-- Ablauf einer Maschine:
--
--   Entwurf  →  BEWERTET  →  FREIGEGEBEN  →  EINGEKAUFT  →  VERKAUFT
--               (angelegt)   (2× Okey)       (Knopf)        (Knopf)
--
-- Die Umschaltung auf "freigegeben" macht die DATENBANK selbst, sobald genug
-- Freigaben da sind. Das ist wichtig: Würde der Browser den Status setzen,
-- könnte man ihn mit den richtigen Handgriffen auch ohne Freigaben setzen.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1) STATUS an der Maschine
-- ----------------------------------------------------------------------------
alter table public.machines
  add column if not exists status text not null default 'bewertet';

do $$
begin
  alter table public.machines
    add constraint machines_status_gueltig
    check (status in ('bewertet', 'freigegeben', 'eingekauft', 'verkauft'));
exception when duplicate_object then null;
end $$;

create index if not exists machines_status_idx on public.machines (status);

comment on column public.machines.status is
  'bewertet -> freigegeben (2 Freigaben) -> eingekauft -> verkauft';


-- ----------------------------------------------------------------------------
-- 2) FELDER für Ankauf und Verkauf
-- ----------------------------------------------------------------------------
alter table public.machines add column if not exists eingekauft_am  timestamptz;
alter table public.machines add column if not exists eingekauft_von uuid references auth.users (id) on delete set null;

alter table public.machines add column if not exists verkauft_am              date;
alter table public.machines add column if not exists verkauft_von             uuid references auth.users (id) on delete set null;
alter table public.machines add column if not exists verkaufspreis_tatsaechlich numeric;
alter table public.machines add column if not exists kaeufer                  text;

comment on column public.machines.verkaufspreis_tatsaechlich is
  'Was wirklich bezahlt wurde – im Gegensatz zum berechneten verkaufspreis.';


-- ----------------------------------------------------------------------------
-- 3) FREIGABEN – wer hat den Preis abgesegnet
-- ----------------------------------------------------------------------------
create table if not exists public.freigaben (
  id         uuid primary key default gen_random_uuid(),
  machine_id uuid not null references public.machines (id) on delete cascade,
  benutzer   uuid not null references auth.users (id) on delete cascade,
  bemerkung  text,
  created_at timestamptz not null default now(),
  -- Jede Person kann nur EINMAL freigeben
  unique (machine_id, benutzer)
);

comment on table public.freigaben is
  'Okey einer Person zum Preis einer Maschine. Ab genug Freigaben wechselt der Status automatisch.';


-- ----------------------------------------------------------------------------
-- 4) Wie viele Freigaben nötig sind – vom Admin einstellbar
-- ----------------------------------------------------------------------------
alter table public.settings
  add column if not exists freigaben_noetig int not null default 2;

comment on column public.settings.freigaben_noetig is
  'Anzahl Okeys, die eine Maschine von "bewertet" auf "freigegeben" schalten.';


-- ----------------------------------------------------------------------------
-- 5) AUTOMATIK: Status anhand der Freigaben setzen
--    Läuft in der Datenbank, damit der Status nicht vom Browser aus
--    manipuliert werden kann.
-- ----------------------------------------------------------------------------
create or replace function public.status_nach_freigaben()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  m_id      uuid := coalesce(new.machine_id, old.machine_id);
  anzahl    int;
  noetig    int;
  aktuell   text;
begin
  select count(*) into anzahl from public.freigaben where machine_id = m_id;
  select coalesce(freigaben_noetig, 2) into noetig from public.settings where id = 1;
  select status into aktuell from public.machines where id = m_id;

  -- Nur zwischen "bewertet" und "freigegeben" hin und her schalten.
  -- Ist eine Maschine bereits eingekauft oder verkauft, ändert eine
  -- nachträgliche Freigabe daran nichts mehr.
  if aktuell in ('bewertet', 'freigegeben') then
    update public.machines
       set status = case when anzahl >= noetig then 'freigegeben' else 'bewertet' end
     where id = m_id
       and status is distinct from (case when anzahl >= noetig then 'freigegeben' else 'bewertet' end);
  end if;

  return null;
end;
$$;

drop trigger if exists freigaben_status_setzen on public.freigaben;
create trigger freigaben_status_setzen
  after insert or delete on public.freigaben
  for each row execute function public.status_nach_freigaben();


-- ----------------------------------------------------------------------------
-- 6) SICHERHEIT
--    Lesen: alle. Freigeben: nur für sich selbst (man kann nicht im Namen
--    einer anderen Person zustimmen). Zurückziehen: nur die eigene Freigabe.
-- ----------------------------------------------------------------------------
alter table public.freigaben enable row level security;

drop policy if exists "freigaben_select" on public.freigaben;
create policy "freigaben_select" on public.freigaben
  for select to authenticated using (true);

drop policy if exists "freigaben_insert_eigene" on public.freigaben;
create policy "freigaben_insert_eigene" on public.freigaben
  for insert to authenticated with check (benutzer = auth.uid());

drop policy if exists "freigaben_delete_eigene" on public.freigaben;
create policy "freigaben_delete_eigene" on public.freigaben
  for delete to authenticated using (benutzer = auth.uid() or public.ist_admin());


-- ----------------------------------------------------------------------------
-- 7) REALTIME
-- ----------------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.freigaben;
exception when duplicate_object then null;
end $$;


-- ----------------------------------------------------------------------------
-- 8) Bestehende Maschinen bekommen den Startstatus
-- ----------------------------------------------------------------------------
update public.machines set status = 'bewertet'
 where status is null and entwurf = false;

-- ============================================================================
-- Fertig.
-- ============================================================================

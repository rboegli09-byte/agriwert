-- ============================================================================
-- AgriWert – Sammel-Skript: alles Offene auf einmal
-- ----------------------------------------------------------------------------
-- Im Supabase SQL-Editor EINMAL ausführen. Gefahrlos wiederholbar.
--
-- Enthält:
--   TEIL 1 – Entwurf-Spalte: neue Maschinen bekommen sofort eine ID, damit
--            beim Erstellen ALLE Reiter nutzbar sind. Entwürfe erscheinen
--            nicht in der Liste, bis sie angelegt werden.
--   TEIL 2 – Kategorien (Traktoren, Heuernte …) und Marken
--   TEIL 3 – Löschrechte für Fotos begradigen
-- ============================================================================


-- ############################################################################
-- TEIL 1 – ENTWÜRFE
-- ############################################################################

alter table public.machines
  add column if not exists entwurf boolean not null default false;

comment on column public.machines.entwurf is
  'true = wird gerade erstellt und ist noch nicht angelegt. Wird in Liste und Dashboard ausgeblendet.';

create index if not exists machines_entwurf_idx on public.machines (entwurf);

-- Aufräumhilfe: Entwürfe, die älter als 2 Tage sind, gehören niemandem mehr.
-- (Wird nicht automatisch ausgeführt – bei Bedarf von Hand aufrufen:
--    select public.entwuerfe_aufraeumen();
--  Die zugehörigen Fotodateien im Speicher bleiben dabei allerdings liegen,
--  darum löscht die App Entwürfe normalerweise selbst über den Abbrechen-Knopf.)
create or replace function public.entwuerfe_aufraeumen()
returns int language plpgsql security definer set search_path = public as $$
declare geloescht int;
begin
  delete from public.machines
   where entwurf = true and created_at < now() - interval '2 days';
  get diagnostics geloescht = row_count;
  return geloescht;
end;
$$;


-- ############################################################################
-- TEIL 2 – KATEGORIEN UND MARKEN
-- ############################################################################

create table if not exists public.kategorien (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  sortierung  int  not null default 0,
  -- NULL = allgemeinen Wert aus settings verwenden
  wertverlust_jahr_prozent     numeric,
  wertverlust_pro_100h_prozent numeric,
  mindest_restwert_prozent     numeric,
  created_at  timestamptz not null default now()
);

create table if not exists public.marken (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_at timestamptz not null default now()
);

alter table public.machines
  add column if not exists kategorie_id uuid references public.kategorien (id) on delete set null;

create index if not exists machines_kategorie_idx on public.machines (kategorie_id);

-- Startwerte (Vorschläge – jederzeit in der App änderbar)
insert into public.kategorien (name, sortierung, wertverlust_jahr_prozent) values
  ('Traktoren',            10, 6),
  ('Mähdrescher',          20, 8),
  ('Feldhäcksler',         30, 8),
  ('Heuernte',             40, 7),
  ('Bodenbearbeitung',     50, 5),
  ('Sätechnik',            60, 6),
  ('Pflanzenschutz',       70, 7),
  ('Düngetechnik',         80, 7),
  ('Transport / Anhänger', 90, 4),
  ('Hoflader / Teleskop', 100, 6),
  ('Kommunaltechnik',     110, 6),
  ('Sonstige',            120, null)
on conflict (name) do nothing;

insert into public.marken (name) values
  ('Fendt'), ('John Deere'), ('Case IH'), ('New Holland'), ('Claas'),
  ('Massey Ferguson'), ('Deutz-Fahr'), ('Valtra'), ('Kubota'), ('Steyr'),
  ('Lindner'), ('Same'), ('Landini'), ('McCormick'), ('JCB'),
  ('Krone'), ('Pöttinger'), ('Kuhn'), ('Amazone'), ('Horsch'),
  ('Lely'), ('Vicon'), ('Rauch'), ('Hardi'), ('Bergmann'),
  ('Aebi'), ('Reform'), ('Rapid'), ('Schilter'), ('Bucher')
on conflict (name) do nothing;

-- Sicherheitsregeln
alter table public.kategorien enable row level security;

drop policy if exists "kategorien_select" on public.kategorien;
create policy "kategorien_select" on public.kategorien
  for select to authenticated using (true);

drop policy if exists "kategorien_admin_insert" on public.kategorien;
create policy "kategorien_admin_insert" on public.kategorien
  for insert to authenticated with check (public.ist_admin());

drop policy if exists "kategorien_admin_update" on public.kategorien;
create policy "kategorien_admin_update" on public.kategorien
  for update to authenticated using (public.ist_admin());

drop policy if exists "kategorien_admin_delete" on public.kategorien;
create policy "kategorien_admin_delete" on public.kategorien
  for delete to authenticated using (public.ist_admin());

alter table public.marken enable row level security;

drop policy if exists "marken_select" on public.marken;
create policy "marken_select" on public.marken
  for select to authenticated using (true);

drop policy if exists "marken_insert" on public.marken;
create policy "marken_insert" on public.marken
  for insert to authenticated with check (true);

drop policy if exists "marken_admin_delete" on public.marken;
create policy "marken_admin_delete" on public.marken
  for delete to authenticated using (public.ist_admin());

-- Realtime
do $$
begin
  alter publication supabase_realtime add table public.kategorien;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.marken;
exception when duplicate_object then null;
end $$;


-- ############################################################################
-- TEIL 3 – LÖSCHRECHTE FÜR FOTOS
-- ############################################################################
-- Die App folgt der Regel "alle bearbeiten alles". Beim Foto-Löschen galt
-- bisher etwas anderes, dadurch konnte man fremde Fotos nicht entfernen und
-- die Dateien wären im Speicher liegen geblieben.

drop policy if exists "photos_delete" on public.machine_photos;
create policy "photos_delete" on public.machine_photos
  for delete to authenticated
  using (true);

drop policy if exists "agriwert_photos_delete" on storage.objects;
create policy "agriwert_photos_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'machine-photos');

-- ============================================================================
-- Fertig.
-- ============================================================================

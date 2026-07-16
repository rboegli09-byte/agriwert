-- ============================================================================
-- AgriWert – Kategorien und Marken
-- ----------------------------------------------------------------------------
-- Im Supabase SQL-Editor EINMAL ausführen.
--
-- Inhalt:
--   1) Tabelle kategorien – Maschinentypen (Traktoren, Heuernte, ...)
--      Jede Kategorie darf EIGENE Wertverlust-Faktoren haben. Bleiben sie
--      leer, gilt der globale Wert aus den Einstellungen.
--      Grund: Ein Heuwender verliert anders an Wert als ein Traktor.
--   2) Tabelle marken – Herstellerliste (Fendt, John Deere, ...)
--   3) machines.kategorie_id
--   4) Startwerte, Sicherheitsregeln, Realtime
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1) KATEGORIEN
-- ----------------------------------------------------------------------------
create table if not exists public.kategorien (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  sortierung  int  not null default 0,
  -- Optionale eigene Faktoren. NULL = globalen Wert aus settings verwenden.
  wertverlust_jahr_prozent     numeric,
  wertverlust_pro_100h_prozent numeric,
  mindest_restwert_prozent     numeric,
  created_at  timestamptz not null default now()
);

comment on table public.kategorien is
  'Maschinentypen. Optionale eigene Wertverlust-Faktoren übersteuern die globalen.';
comment on column public.kategorien.wertverlust_jahr_prozent is
  'NULL = globalen Wert aus settings verwenden.';


-- ----------------------------------------------------------------------------
-- 2) MARKEN
-- ----------------------------------------------------------------------------
create table if not exists public.marken (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_at timestamptz not null default now()
);

comment on table public.marken is
  'Herstellerliste für die Auswahl im Formular. Neue Marken darf jeder anlegen.';


-- ----------------------------------------------------------------------------
-- 3) VERKNÜPFUNG mit den Maschinen
-- ----------------------------------------------------------------------------
alter table public.machines
  add column if not exists kategorie_id uuid references public.kategorien (id) on delete set null;

create index if not exists machines_kategorie_idx on public.machines (kategorie_id);


-- ----------------------------------------------------------------------------
-- 4) STARTWERTE
--    Vorschläge – der Admin kann sie jederzeit ändern, löschen oder ergänzen.
-- ----------------------------------------------------------------------------
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


-- ----------------------------------------------------------------------------
-- 5) SICHERHEITSREGELN
--    Lesen: alle Angemeldeten.
--    Kategorien pflegen: nur Admin (sie beeinflussen die Preisberechnung).
--    Marken anlegen: alle – sonst blockiert eine fehlende Marke die Arbeit.
--    Marken löschen: nur Admin.
-- ----------------------------------------------------------------------------
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


-- ----------------------------------------------------------------------------
-- 6) REALTIME
-- ----------------------------------------------------------------------------
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

-- ============================================================================
-- Fertig.
-- ============================================================================

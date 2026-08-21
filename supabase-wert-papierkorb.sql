-- ============================================================================
-- AgriWert – Manueller Wert + Papierkorb
-- ----------------------------------------------------------------------------
-- Im AgriWert-Projekt ausführen:
--   https://supabase.com/dashboard/project/wttxabjxbcwjhbqlikit/sql/new
--
-- Inhalt:
--   1) manueller_marktwert – vorgeschlagenen Wert überschreiben
--   2) Papierkorb: gelöschte Maschinen landen im Papierkorb (Soft-Delete),
--      lassen sich wiederherstellen oder endgültig löschen
--   3) Fremdschlüssel-Fix am Änderungsverlauf, damit endgültiges Löschen klappt
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1) Manueller Marktwert (leer = automatisch berechnet)
-- ----------------------------------------------------------------------------
alter table public.machines
  add column if not exists manueller_marktwert numeric;

comment on column public.machines.manueller_marktwert is
  'Wenn gesetzt, überschreibt dieser Wert den automatisch berechneten Marktwert.';


-- ----------------------------------------------------------------------------
-- 2) Papierkorb (Soft-Delete)
--    Statt sofort zu löschen, wird geloescht_am gesetzt. Solche Maschinen
--    verschwinden aus der normalen Liste, bleiben aber im Papierkorb.
-- ----------------------------------------------------------------------------
alter table public.machines
  add column if not exists geloescht_am  timestamptz;
alter table public.machines
  add column if not exists geloescht_von uuid references auth.users (id) on delete set null;

create index if not exists machines_geloescht_idx on public.machines (geloescht_am);

comment on column public.machines.geloescht_am is
  'Zeitpunkt der Verschiebung in den Papierkorb. NULL = aktiv.';


-- ----------------------------------------------------------------------------
-- 3) Fremdschlüssel-Fix am Verlauf
--    Beim endgültigen Löschen aus dem Papierkorb schreibt der Trigger noch
--    einen Verlaufseintrag. Zeigt der per Fremdschlüssel auf die eben
--    gelöschte Maschine, bricht das Löschen ab. Darum: Fremdschlüssel weg,
--    Bezeichnung mitspeichern, damit man später noch weiss, worum es ging.
-- ----------------------------------------------------------------------------
alter table public.machine_verlauf
  drop constraint if exists machine_verlauf_machine_id_fkey;

alter table public.machine_verlauf
  add column if not exists bezeichnung text;

create or replace function public.machines_verlauf_schreiben()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  feld     text;
  alt_json jsonb := to_jsonb(old);
  neu_json jsonb := to_jsonb(new);
  ignoriert text[] := array['updated_at', 'version'];
  name     text;
begin
  name := trim(both ' ' from
            coalesce(coalesce(new.hersteller, old.hersteller), '') || ' ' ||
            coalesce(coalesce(new.modell, old.modell), ''));
  if name = '' then name := 'ohne Namen'; end if;

  if tg_op = 'INSERT' then
    insert into public.machine_verlauf (machine_id, bezeichnung, tabelle, aktion, benutzer)
    values (new.id, name, 'machines', 'INSERT', auth.uid());
    return new;
  end if;

  if tg_op = 'DELETE' then
    insert into public.machine_verlauf (machine_id, bezeichnung, tabelle, aktion, benutzer)
    values (old.id, name, 'machines', 'DELETE', auth.uid());
    return old;
  end if;

  for feld in select jsonb_object_keys(neu_json) loop
    if feld = any(ignoriert) then continue; end if;
    if alt_json -> feld is distinct from neu_json -> feld then
      insert into public.machine_verlauf
        (machine_id, bezeichnung, tabelle, aktion, feld, alt_wert, neu_wert, benutzer)
      values (new.id, name, 'machines', 'UPDATE', feld,
              alt_json ->> feld, neu_json ->> feld, auth.uid());
    end if;
  end loop;
  return new;
end;
$$;

-- ============================================================================
-- Fertig.
-- ============================================================================

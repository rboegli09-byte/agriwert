-- ============================================================================
-- AgriWert – Verwaltungskonten aus der Auswertung ausblenden
-- ----------------------------------------------------------------------------
-- WICHTIG: Im AgriWert-Projekt ausführen!
--   https://supabase.com/dashboard/project/wttxabjxbcwjhbqlikit/sql/new
--
-- Fügt den Profilen einen Schalter hinzu: Wer nur die App verwaltet und keine
-- echten Maschinen erfasst, soll im Dashboard unter "Erfasst von" nicht
-- auftauchen. Standard ist true – bestehende Benutzer zählen also weiterhin
-- mit, bis der Admin sie ausschaltet.
-- ============================================================================

alter table public.profiles
  add column if not exists in_auswertung boolean not null default true;

comment on column public.profiles.in_auswertung is
  'false = Verwaltungskonto, erscheint nicht in der Dashboard-Auswertung "Erfasst von".';

-- ============================================================================
-- AgriWert – Löschrechte für Fotos begradigen
-- ----------------------------------------------------------------------------
-- Im Supabase SQL-Editor EINMAL ausführen.
--
-- PROBLEM
-- Die App folgt der Regel "alle sehen und bearbeiten alles". Beim Löschen von
-- Fotos galt aber etwas anderes: nur wer ein Foto hochgeladen hat, durfte es
-- löschen. Folge:
--
--   Person A legt eine Maschine an, Person B lädt ein Foto dazu hoch.
--   Person A löscht die Maschine -> das Foto von B kann nicht gelöscht werden
--   -> entweder bricht das Löschen ab, oder die Datei bleibt für immer im
--      Speicher liegen und verbraucht Platz, ohne auffindbar zu sein.
--
-- LÖSUNG
-- Löschen von Fotos wird auf dieselbe Regel gestellt wie der Rest:
-- Wer angemeldet ist, darf es. Das ist kein Sicherheitsverlust – wer ein Foto
-- löschen will, könnte die ganze Maschine ohnehin bearbeiten. Und jede
-- Änderung steht weiterhin im Änderungsverlauf.
--
-- Das Löschen einer ganzen MASCHINE bleibt wie bisher eingeschränkt:
-- nur der Ersteller oder ein Administrator.
-- ============================================================================


-- --- Fotos in der Datenbank -------------------------------------------------
drop policy if exists "photos_delete" on public.machine_photos;
create policy "photos_delete" on public.machine_photos
  for delete to authenticated
  using (true);


-- --- Bilddateien im Speicher ------------------------------------------------
drop policy if exists "agriwert_photos_delete" on storage.objects;
create policy "agriwert_photos_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'machine-photos');

-- ============================================================================
-- Fertig.
-- ============================================================================

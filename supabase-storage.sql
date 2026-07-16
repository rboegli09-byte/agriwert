-- ============================================================================
-- AgriWert – Storage-Regeln für den Foto-Bucket
-- ----------------------------------------------------------------------------
-- ERST NACHDEM du im Dashboard den Bucket "machine-photos" erstellt hast,
-- dieses Skript im SQL-Editor ausführen (siehe README.md, Schritt 4).
--
-- Regeln:
--   * Angemeldete Benutzer dürfen Fotos ansehen und hochladen.
--   * Löschen darf nur, wer die Datei hochgeladen hat, oder der Admin.
-- ============================================================================

-- Ansehen (alle angemeldeten Benutzer)
drop policy if exists "agriwert_photos_select" on storage.objects;
create policy "agriwert_photos_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'machine-photos');

-- Hochladen (alle angemeldeten Benutzer)
drop policy if exists "agriwert_photos_insert" on storage.objects;
create policy "agriwert_photos_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'machine-photos' and owner = auth.uid());

-- Löschen (Ersteller oder Admin)
drop policy if exists "agriwert_photos_delete" on storage.objects;
create policy "agriwert_photos_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'machine-photos'
    and (owner = auth.uid() or public.ist_admin())
  );

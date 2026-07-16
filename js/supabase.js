// ============================================================================
// AgriWert – Supabase-Verbindung
// ----------------------------------------------------------------------------
// Erstellt den Supabase-Client (die Verbindung zur Cloud-Datenbank).
// Wird von allen anderen Modulen importiert.
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

/** Prüft, ob die Zugangsdaten in config.js schon eingetragen wurden. */
export function istKonfiguriert() {
  return (
    SUPABASE_URL.startsWith('http') &&
    !SUPABASE_ANON_KEY.startsWith('HIER_')
  );
}

// createClient wirft einen Fehler, wenn die URL ungültig ist. Solange die
// Zugangsdaten noch nicht eingetragen sind, verwenden wir eine gültige
// Platzhalter-URL – die App zeigt dann den Einrichtungs-Hinweis an,
// statt beim Laden abzustürzen.
const url = SUPABASE_URL.startsWith('http') ? SUPABASE_URL : 'https://placeholder.supabase.co';
const key = SUPABASE_ANON_KEY.startsWith('HIER_') ? 'placeholder-key' : SUPABASE_ANON_KEY;

export const supabase = createClient(url, key);

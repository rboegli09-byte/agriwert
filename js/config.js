// ============================================================================
// AgriWert – Konfiguration
// ----------------------------------------------------------------------------
// HIER trägst du deine Supabase-Zugangsdaten ein (siehe README.md, Schritt 3).
// Beide Werte findest du im Supabase-Dashboard unter:
//   Project Settings (Zahnrad) → "API"
//
//   * SUPABASE_URL       = "Project URL"
//   * SUPABASE_ANON_KEY  = "anon public" Schlüssel
//
// Wichtig: Der "anon"-Schlüssel darf öffentlich sein – die Sicherheit kommt
// von den Row-Level-Security-Regeln in der Datenbank. NIE den "service_role"-
// Schlüssel hier eintragen!
// ============================================================================

export const SUPABASE_URL = 'https://wttxabjxbcwjhbqlikit.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_uOXMvh6FfiCavm1PUeoH2g_dJyOrTpZ';

// Anzeigename der App (jederzeit änderbar)
export const APP_NAME = 'AgriWert';

// Name des Storage-Buckets für Fotos (muss mit dem Dashboard übereinstimmen)
export const PHOTO_BUCKET = 'machine-photos';

// Maximale Kantenlänge, auf die Fotos vor dem Hochladen verkleinert werden (px)
export const PHOTO_MAX_KANTE = 1600;

// Kategorien für die Fotodokumentation
export const FOTO_KATEGORIEN = [
  'Vorderseite', 'Rückseite', 'Links', 'Rechts',
  'Motor', 'Kabine', 'Reifen', 'Typenschild', 'Schäden', 'Zubehör', 'Sonstige',
];

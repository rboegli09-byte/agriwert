// ============================================================================
// AgriWert – kleine Helfer, die überall gebraucht werden
// ============================================================================

/**
 * Wandelt gefährliche Zeichen in harmlose HTML-Entitäten um.
 * MUSS um jeden Wert, der aus der Datenbank kommt und in HTML eingesetzt wird –
 * sonst könnte jemand über ein Eingabefeld fremden Code einschleusen (XSS).
 */
export function esc(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

/** Kurzform für document.querySelector. */
export const $ = (sel, wurzel = document) => wurzel.querySelector(sel);
export const $$ = (sel, wurzel = document) => [...wurzel.querySelectorAll(sel)];

/** Datum als 16.07.2026 */
export function datum(wert) {
  if (!wert) return '–';
  return new Date(wert).toLocaleDateString('de-CH');
}

/** Datum + Uhrzeit als 16.07.2026, 14:32 */
export function datumZeit(wert) {
  if (!wert) return '–';
  return new Date(wert).toLocaleString('de-CH', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/** Wartet, bis der Benutzer kurz aufhört zu tippen (spart Datenbank-Zugriffe). */
export function entprellen(fn, ms = 600) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/** Leerer String -> null (damit die Datenbank NULL statt '' bekommt). */
export function leerZuNull(v) {
  const s = typeof v === 'string' ? v.trim() : v;
  return s === '' || s === undefined ? null : s;
}

/** Text -> ganze Zahl oder null */
export function zuGanzzahl(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

/** Text -> Kommazahl oder null */
export function zuZahl(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

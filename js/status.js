// ============================================================================
// AgriWert – Status-Ablauf
// ----------------------------------------------------------------------------
//   Entwurf → BEWERTET → FREIGEGEBEN → EINGEKAUFT → VERKAUFT
//             (angelegt)  (2× Okey)     (Knopf)      (Knopf)
//
// Der Wechsel auf "freigegeben" passiert in der Datenbank (Trigger), sobald
// genug Freigaben da sind – nicht hier im Browser. Dieses Modul kümmert sich
// nur um Anzeige und die manuellen Schritte.
// ============================================================================

import { supabase } from './supabase.js';
import { esc } from './util.js';

/** Reihenfolge und Beschriftung der Status. */
export const STATUS = {
  bewertet:    { label: 'Bewertet',    reihe: 1, farbe: 'grau',
                 hilfe: 'Erfasst und bewertet. Es fehlen noch Freigaben zum Preis.' },
  freigegeben: { label: 'Freigegeben', reihe: 2, farbe: 'blau',
                 hilfe: 'Genug Personen haben den Preis abgesegnet. Die Maschine kann eingekauft werden.' },
  eingekauft:  { label: 'Eingekauft',  reihe: 3, farbe: 'gruen',
                 hilfe: 'Die Maschine wurde angekauft und steht im Bestand.' },
  verkauft:    { label: 'Verkauft',    reihe: 4, farbe: 'dunkel',
                 hilfe: 'Die Maschine ist verkauft und aus dem Bestand.' },
};

export const STATUS_REIHENFOLGE = ['bewertet', 'freigegeben', 'eingekauft', 'verkauft'];

export const statusLabel = (s) => STATUS[s]?.label ?? 'Bewertet';

/** Farbige Status-Marke für Listen und Kopfzeilen. */
export function statusMarke(status) {
  const s = STATUS[status] ?? STATUS.bewertet;
  return `<span class="status-marke status-${s.farbe}" title="${esc(s.hilfe)}">${esc(s.label)}</span>`;
}

// ============================================================================
// Freigaben
// ============================================================================

/** Alle Freigaben einer Maschine laden. */
export async function ladeFreigaben(machineId) {
  const { data } = await supabase.from('freigaben')
    .select('*').eq('machine_id', machineId).order('created_at');
  return data ?? [];
}

/** Eigene Freigabe erteilen. */
export async function freigeben(machineId, userId, bemerkung = null) {
  const { error } = await supabase.from('freigaben')
    .insert({ machine_id: machineId, benutzer: userId, bemerkung });
  // 23505 = gibt es schon; für den Benutzer kein Fehler
  if (error && error.code !== '23505') throw error;
}

/** Eigene Freigabe zurückziehen. */
export async function freigabeZurueckziehen(machineId, userId) {
  const { error } = await supabase.from('freigaben')
    .delete().eq('machine_id', machineId).eq('benutzer', userId);
  if (error) throw error;
}

// ============================================================================
// Manuelle Schritte
// ============================================================================

/**
 * Maschine als eingekauft markieren.
 * Nur möglich, wenn sie freigegeben ist – sonst könnte man die Freigabe
 * einfach überspringen.
 */
export async function alsEingekauft(machine, userId) {
  if (machine.status !== 'freigegeben') {
    throw new Error('Die Maschine muss zuerst freigegeben werden.');
  }
  const { data, error } = await supabase.from('machines')
    .update({ status: 'eingekauft', eingekauft_am: new Date().toISOString(), eingekauft_von: userId })
    .eq('id', machine.id).eq('version', machine.version).select();
  if (error) throw error;
  if (!data?.length) throw new Error('Die Maschine wurde zwischenzeitlich geändert. Bitte neu laden.');
  return data[0];
}

/** Maschine als verkauft markieren, mit den Verkaufsdaten. */
export async function alsVerkauft(machine, userId, { preis, datum, kaeufer }) {
  const { data, error } = await supabase.from('machines')
    .update({
      status: 'verkauft',
      verkauft_am: datum,
      verkauft_von: userId,
      verkaufspreis_tatsaechlich: preis,
      kaeufer,
    })
    .eq('id', machine.id).eq('version', machine.version).select();
  if (error) throw error;
  if (!data?.length) throw new Error('Die Maschine wurde zwischenzeitlich geändert. Bitte neu laden.');
  return data[0];
}

/** Einen Schritt zurück (falls jemand sich vertan hat). */
export async function statusZuruecksetzen(machine, aufStatus) {
  const felder = { status: aufStatus };
  // Beim Zurücknehmen die Angaben der späteren Stufe entfernen, sonst stünden
  // dort Verkaufsdaten an einer Maschine, die gar nicht verkauft ist.
  if (aufStatus !== 'verkauft') {
    Object.assign(felder, {
      verkauft_am: null, verkauft_von: null,
      verkaufspreis_tatsaechlich: null, kaeufer: null,
    });
  }
  if (!['eingekauft', 'verkauft'].includes(aufStatus)) {
    Object.assign(felder, { eingekauft_am: null, eingekauft_von: null });
  }

  const { data, error } = await supabase.from('machines')
    .update(felder).eq('id', machine.id).eq('version', machine.version).select();
  if (error) throw error;
  if (!data?.length) throw new Error('Die Maschine wurde zwischenzeitlich geändert. Bitte neu laden.');
  return data[0];
}

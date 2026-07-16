// ============================================================================
// AgriWert – Bewertungs- und Preis-Engine (v2)
// ----------------------------------------------------------------------------
// Reine (pure) Funktionen ohne Abhängigkeiten -> leicht testbar.
// Alle Faktoren kommen aus den Einstellungen (settings), die der Admin ändert.
//
// Ablauf der Bewertung:
//
//   A) ZUSTAND
//      technischer Zustand = Mittel der technischen Baugruppen (Note 1–10)
//      optischer Zustand   = Mittel der optischen Baugruppen (Lack, Karosserie, Kabine)
//      Zustandsindex       = gewichtetes Mittel × 10  -> 0–100
//
//   B) MARKTWERT
//      1. Start:      Neupreis
//      2. Alter:      pro Jahr  −wertverlust_jahr_prozent %  (zusammengesetzt)
//      3. Stunden:    −(Betriebsstunden / 100) × wertverlust_pro_100h_prozent %
//      4. Zustand:    ±(Zustandsnote − zustand_neutral) × zustand_pro_punkt_prozent %
//      5. Ausstattung: + Summe der Zuschläge (CHF)
//      6. Reifen:     −(Ø Verschleiss %) × reifen_abzug_prozent %
//      7. Reparaturen: − Reparaturkosten × reparatur_abzug_prozent %
//      8. Untergrenze: nie unter mindest_restwert_prozent % des Neupreises
//
//   C) PREISARTEN (alle aus dem Marktwert abgeleitet)
//      Ankaufspreis   = Marktwert × ankauf_prozent %
//      Eintauschpreis = Marktwert × eintausch_prozent %
//      Verkaufspreis  = Marktwert × verkauf_prozent %
//      Preisband      = Marktwert ± preisband_prozent %
// ============================================================================

/** Baugruppen, die den OPTISCHEN Zustand bestimmen. Alle übrigen sind technisch. */
export const OPTISCHE_BAUGRUPPEN = ['Lack', 'Karosserie', 'Kabine'];

/** Aktuelles Jahr – als Funktion, damit Tests es überschreiben können. */
export function aktuellesJahr() {
  return new Date().getFullYear();
}

// ============================================================================
// A) ZUSTAND
// ============================================================================

/**
 * Berechnet technischen/optischen Zustand und den Zustandsindex aus den Baugruppen.
 * @param {Array} baugruppen  [{ name, note }]
 * @param {object} settings
 * @returns {object} { technisch, optisch, index, ampel, gesamtnote }
 */
export function berechneZustand(baugruppen = [], settings = {}) {
  const s = mitStandardwerten(settings);
  const bewertet = baugruppen.filter((b) => Number.isFinite(zahl(b.note, NaN)));

  if (bewertet.length === 0) {
    return { technisch: null, optisch: null, index: null, ampel: 'unbekannt', gesamtnote: null };
  }

  const optische = bewertet.filter((b) => OPTISCHE_BAUGRUPPEN.includes(b.name));
  const technische = bewertet.filter((b) => !OPTISCHE_BAUGRUPPEN.includes(b.name));

  const technisch = mittel(technische.map((b) => zahl(b.note)));
  const optisch = mittel(optische.map((b) => zahl(b.note)));

  // Gewichtetes Mittel – fehlt eine Seite, zählt die andere allein.
  let gesamtnote;
  if (technisch === null) gesamtnote = optisch;
  else if (optisch === null) gesamtnote = technisch;
  else {
    const gt = s.gewicht_technisch, go = s.gewicht_optisch;
    gesamtnote = (technisch * gt + optisch * go) / (gt + go || 1);
  }

  const index = gesamtnote === null ? null : runde(gesamtnote * 10, 0);

  return {
    technisch: technisch === null ? null : runde(technisch, 1),
    optisch: optisch === null ? null : runde(optisch, 1),
    index,
    ampel: ampelFuerNote(gesamtnote),
    gesamtnote: gesamtnote === null ? null : runde(gesamtnote, 1),
  };
}

/** Ampel: grün ab 8, gelb ab 5, sonst rot. */
export function ampelFuerNote(note) {
  if (note === null || note === undefined) return 'unbekannt';
  if (note >= 8) return 'gruen';
  if (note >= 5) return 'gelb';
  return 'rot';
}

// ============================================================================
// B + C) MARKTWERT UND ALLE PREISARTEN
// ============================================================================

/**
 * Vollständige Bewertung einer Maschine.
 *
 * @param {object} maschine   Stammdaten inkl. ausstattung[]
 * @param {object} kontext    { baugruppen[], reifen[], schaeden[], kategorie }
 *                            kategorie: Zeile aus kategorien – ihre Faktoren
 *                            übersteuern die globalen Einstellungen.
 * @param {object} settings   Faktoren aus der Tabelle settings
 * @param {number} [jahr]     Bezugsjahr (Standard: aktuelles Jahr)
 * @returns {object} vollständiges Ergebnis inkl. Rechenschritten
 */
export function bewerteMaschine(maschine, kontext = {}, settings = {}, jahr = aktuellesJahr()) {
  // Kategorie-Faktoren übersteuern die globalen (z. B. Heuernte statt Traktor)
  const s = mitKategorie(settings, kontext.kategorie);
  const baugruppen = kontext.baugruppen ?? [];
  const reifen = kontext.reifen ?? [];
  const schaeden = kontext.schaeden ?? [];

  const zustand = berechneZustand(baugruppen, s);
  const reparaturkosten = summeReparaturkosten(baugruppen, schaeden);

  // Zustandsnote für den Preis: aus den Baugruppen, sonst die manuelle Gesamtnote.
  const note = zustand.gesamtnote ?? zahl(maschine.zustand_gesamt, s.zustand_neutral);

  const markt = berechneMarktwert(maschine, {
    note, reifen, reparaturkosten,
  }, s, jahr);

  if (markt.marktwert === null) {
    return {
      ...zustand, reparaturkosten,
      marktwert: null, ankaufspreis: null, eintauschpreis: null, verkaufspreis: null,
      preisband_von: null, preisband_bis: null,
      waehrung: s.waehrung, schritte: [], warnung: markt.warnung,
    };
  }

  const mw = markt.marktwert;
  return {
    ...zustand,
    reparaturkosten,
    marktwert: Math.round(mw),
    ankaufspreis: Math.round(mw * (s.ankauf_prozent / 100)),
    eintauschpreis: Math.round(mw * (s.eintausch_prozent / 100)),
    verkaufspreis: Math.round(mw * (s.verkauf_prozent / 100)),
    preisband_von: Math.round(mw * (1 - s.preisband_prozent / 100)),
    preisband_bis: Math.round(mw * (1 + s.preisband_prozent / 100)),
    waehrung: s.waehrung,
    schritte: markt.schritte,
    warnung: markt.warnung,
  };
}

/** Nur der Marktwert, mit nachvollziehbaren Rechenschritten. */
function berechneMarktwert(maschine, { note, reifen, reparaturkosten }, s, jahr) {
  const schritte = [];
  const neupreis = zahl(maschine.neupreis);

  if (!neupreis || neupreis <= 0) {
    return {
      marktwert: null, schritte: [],
      warnung: 'Kein Neupreis eingetragen – der Marktwert kann nicht berechnet werden.',
    };
  }

  let wert = neupreis;
  schritte.push({ label: 'Neupreis', wert });

  // --- Alter ---
  const alter = Math.max(0, jahr - (parseInt(maschine.baujahr, 10) || jahr));
  if (alter > 0) {
    const vorher = wert;
    wert *= Math.pow(1 - s.wertverlust_jahr_prozent / 100, alter);
    schritte.push({
      label: `Alter (${alter} Jahre × −${s.wertverlust_jahr_prozent} %/Jahr)`,
      wert, differenz: wert - vorher,
    });
  }

  // --- Betriebsstunden ---
  const stunden = Math.max(0, parseInt(maschine.betriebsstunden, 10) || 0);
  if (stunden > 0) {
    const abzugProzent = Math.min((stunden / 100) * s.wertverlust_pro_100h_prozent, 90);
    const vorher = wert;
    wert *= 1 - abzugProzent / 100;
    schritte.push({
      label: `Betriebsstunden (${stunden} h → −${runde(abzugProzent, 1)} %)`,
      wert, differenz: wert - vorher,
    });
  }

  // --- Zustand ---
  if (note !== null && note !== s.zustand_neutral) {
    const prozent = (note - s.zustand_neutral) * s.zustand_pro_punkt_prozent;
    const vorher = wert;
    wert *= 1 + prozent / 100;
    schritte.push({
      label: `Zustand (Note ${runde(note, 1)} → ${prozent >= 0 ? '+' : ''}${runde(prozent, 1)} %)`,
      wert, differenz: wert - vorher,
    });
  }

  // --- Ausstattung ---
  const gewaehlt = Array.isArray(maschine.ausstattung) ? maschine.ausstattung : [];
  const zuschlagSumme = gewaehlt.reduce((sum, name) => sum + zahl(s.ausstattung_zuschlaege[name]), 0);
  if (zuschlagSumme > 0) {
    wert += zuschlagSumme;
    schritte.push({
      label: `Ausstattung (${gewaehlt.length} Positionen)`,
      wert, differenz: zuschlagSumme,
    });
  }

  // --- Reifenverschleiss ---
  const verschleissWerte = reifen
    .map((r) => zahl(r.verschleiss, NaN))
    .filter((v) => Number.isFinite(v));
  if (verschleissWerte.length > 0) {
    const oVerschleiss = mittel(verschleissWerte);
    const abzugProzent = oVerschleiss * s.reifen_abzug_prozent;
    if (abzugProzent > 0) {
      const vorher = wert;
      wert *= 1 - Math.min(abzugProzent, 30) / 100;
      schritte.push({
        label: `Reifen (Ø ${runde(oVerschleiss, 0)} % abgefahren → −${runde(abzugProzent, 1)} %)`,
        wert, differenz: wert - vorher,
      });
    }
  }

  // --- Reparaturkosten ---
  if (reparaturkosten > 0) {
    const abzug = reparaturkosten * (s.reparatur_abzug_prozent / 100);
    wert -= abzug;
    schritte.push({
      label: `Reparaturbedarf (${formatPreis(reparaturkosten, '')} × ${s.reparatur_abzug_prozent} %)`,
      wert, differenz: -abzug,
    });
  }

  // --- Untergrenze ---
  const untergrenze = neupreis * (s.mindest_restwert_prozent / 100);
  let warnung = null;
  if (wert < untergrenze) {
    wert = untergrenze;
    warnung = `Der berechnete Wert lag unter dem Mindestrestwert (${s.mindest_restwert_prozent} % des Neupreises) und wurde darauf angehoben.`;
    schritte.push({ label: `Mindestrestwert (${s.mindest_restwert_prozent} %)`, wert });
  }

  return { marktwert: wert, schritte, warnung };
}

/** Summe aller Reparaturkosten aus Baugruppen und Schäden. */
export function summeReparaturkosten(baugruppen = [], schaeden = []) {
  const ausBaugruppen = baugruppen
    .filter((b) => b.reparaturbedarf)
    .reduce((s, b) => s + zahl(b.reparaturkosten), 0);
  const ausSchaeden = schaeden.reduce((s, d) => s + zahl(d.kostenschaetzung), 0);
  return Math.round(ausBaugruppen + ausSchaeden);
}

// ============================================================================
// MARKTVERGLEICH – Vergleichbarkeit einer Vergleichsmaschine (0–100 %)
// ============================================================================

/**
 * Bewertet, wie gut eine Vergleichsmaschine zur eigenen passt.
 * Je näher Hersteller/Modell/Typ/Baujahr/Stunden/Zustand, desto höher.
 */
export function vergleichbarkeit(eigene, vergleich) {
  let punkte = 0, moeglich = 0;
  const gleich = (a, b) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();

  // Hersteller (25) und Modell (25) – die stärksten Merkmale
  moeglich += 25; if (gleich(eigene.hersteller, vergleich.hersteller)) punkte += 25;
  moeglich += 25; if (gleich(eigene.modell, vergleich.modell)) punkte += 25;
  moeglich += 10; if (gleich(eigene.typ, vergleich.typ)) punkte += 10;

  // Baujahr (15): voller Wert bei gleichem Jahr, 0 ab 10 Jahren Abstand
  moeglich += 15;
  if (eigene.baujahr && vergleich.baujahr) {
    const diff = Math.abs(eigene.baujahr - vergleich.baujahr);
    punkte += 15 * Math.max(0, 1 - diff / 10);
  }

  // Betriebsstunden (15): 0 ab 5000 h Abstand
  moeglich += 15;
  if (eigene.betriebsstunden != null && vergleich.betriebsstunden != null) {
    const diff = Math.abs(eigene.betriebsstunden - vergleich.betriebsstunden);
    punkte += 15 * Math.max(0, 1 - diff / 5000);
  }

  // Zustand (10): 0 ab 5 Noten Abstand
  moeglich += 10;
  if (eigene.zustand_gesamt && vergleich.zustand) {
    const diff = Math.abs(eigene.zustand_gesamt - vergleich.zustand);
    punkte += 10 * Math.max(0, 1 - diff / 5);
  }

  return Math.round((punkte / moeglich) * 100);
}

// ============================================================================
// Hilfsfunktionen
// ============================================================================

/**
 * Legt die Faktoren einer Kategorie über die globalen Einstellungen.
 *
 * Hintergrund: Ein Heuwender verliert anders an Wert als ein Traktor. Darum
 * darf jede Kategorie eigene Wertverlust-Faktoren haben. Felder, die bei der
 * Kategorie leer (null) sind, behalten den globalen Wert – so muss der Admin
 * nur pflegen, was wirklich abweicht.
 *
 * @param {object} settings   globale Einstellungen
 * @param {object} kategorie  Zeile aus kategorien (oder null)
 */
export function mitKategorie(settings, kategorie) {
  const s = mitStandardwerten(settings);
  if (!kategorie) return s;

  for (const feld of ['wertverlust_jahr_prozent', 'wertverlust_pro_100h_prozent',
                      'mindest_restwert_prozent']) {
    const wert = kategorie[feld];
    if (wert !== null && wert !== undefined && wert !== '') {
      s[feld] = zahl(wert, s[feld]);
    }
  }
  return s;
}

/** Ergänzt fehlende Einstellungen mit sinnvollen Standardwerten. */
export function mitStandardwerten(settings = {}) {
  return {
    waehrung: settings.waehrung ?? 'CHF',
    wertverlust_jahr_prozent: zahl(settings.wertverlust_jahr_prozent, 6),
    wertverlust_pro_100h_prozent: zahl(settings.wertverlust_pro_100h_prozent, 1),
    zustand_neutral: zahl(settings.zustand_neutral, 5),
    zustand_pro_punkt_prozent: zahl(settings.zustand_pro_punkt_prozent, 4),
    mindest_restwert_prozent: zahl(settings.mindest_restwert_prozent, 10),
    ausstattung_zuschlaege: settings.ausstattung_zuschlaege ?? {},
    // v2
    ankauf_prozent: zahl(settings.ankauf_prozent, 75),
    eintausch_prozent: zahl(settings.eintausch_prozent, 85),
    verkauf_prozent: zahl(settings.verkauf_prozent, 115),
    preisband_prozent: zahl(settings.preisband_prozent, 10),
    reparatur_abzug_prozent: zahl(settings.reparatur_abzug_prozent, 100),
    gewicht_technisch: zahl(settings.gewicht_technisch, 70),
    gewicht_optisch: zahl(settings.gewicht_optisch, 30),
    reifen_abzug_prozent: zahl(settings.reifen_abzug_prozent, 0.02),
  };
}

function zahl(v, fallback = 0) {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : fallback;
}

function mittel(werte) {
  if (!werte || werte.length === 0) return null;
  return werte.reduce((a, b) => a + b, 0) / werte.length;
}

function runde(v, stellen = 0) {
  const f = Math.pow(10, stellen);
  return Math.round(v * f) / f;
}

/** Formatiert einen Betrag als Währung, z. B. 45000 -> "CHF 45'000". */
export function formatPreis(betrag, waehrung = 'CHF') {
  if (betrag === null || betrag === undefined || !Number.isFinite(Number(betrag))) return '–';
  const formatiert = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 0 }).format(betrag);
  return waehrung ? `${waehrung} ${formatiert}` : formatiert;
}

// ----------------------------------------------------------------------------
// Rückwärtskompatibilität: Etappe-1-Aufrufe funktionieren weiter.
// ----------------------------------------------------------------------------
export function berechnePreis(maschine, settings, jahr = aktuellesJahr()) {
  const r = bewerteMaschine(maschine, {}, settings, jahr);
  return { preis: r.marktwert, waehrung: r.waehrung, schritte: r.schritte, warnung: r.warnung };
}

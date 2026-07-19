// ============================================================================
// AgriWert – Excel-Export einer einzelnen Maschine
// ----------------------------------------------------------------------------
// Erzeugt eine druckfertige .xlsx-Datei mit allen Daten der Maschine:
// Stammdaten, Bewertung, Preise, Ausstattung, Baugruppen, Reifen, Schäden,
// Marktvergleich, Kommentare, Aufgaben – und den Fotos.
//
// Die Bibliothek (ExcelJS) wird ERST beim Klick geladen (dynamischer Import).
// Sie ist rund 1 MB gross – beim Start der App wäre das reine Verschwendung,
// weil die meisten Aufrufe nie exportieren.
// ============================================================================

import { bewerteMaschine, formatPreis } from './pricing.js';
import { fotoUrl } from './photos.js';

// --- Aussehen ---------------------------------------------------------------
const GRUEN = 'FF2B6A4B';        // Akzentfarbe der App
const GRAU_HELL = 'FFF2F3F4';
const RAHMEN_FARBE = 'FFD8DCDF';

const RAHMEN = {
  top: { style: 'thin', color: { argb: RAHMEN_FARBE } },
  left: { style: 'thin', color: { argb: RAHMEN_FARBE } },
  bottom: { style: 'thin', color: { argb: RAHMEN_FARBE } },
  right: { style: 'thin', color: { argb: RAHMEN_FARBE } },
};

/**
 * Exportiert eine Maschine als Excel-Datei und startet den Download.
 *
 * @param {object} maschine   Zeile aus machines
 * @param {object} daten      { baugruppen, reifen, schaeden, fotos, kommentare, aufgaben, vergleiche }
 * @param {object} kontext    { settings, kategorie, benutzerName(id) }
 * @param {function} melde    Rückmeldung für die Oberfläche (Text)
 */
export async function exportiereMaschine(maschine, daten, kontext, melde = () => {}) {
  melde('Bereite Export vor …');
  const ExcelJS = (await import('https://esm.sh/exceljs@4.4.0')).default;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'AgriWert';
  wb.created = new Date();

  const titel = [maschine.hersteller || maschine.marke, maschine.modell]
    .filter(Boolean).join(' ') || 'Maschine';

  const bewertung = bewerteMaschine(maschine, { ...daten, kategorie: kontext.kategorie }, kontext.settings);

  const ws = wb.addWorksheet('Bewertung', {
    properties: { defaultRowHeight: 16 },
    pageSetup: {
      paperSize: 9,                 // A4
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,                // exakt eine Seite breit
      fitToHeight: 0,               // beliebig viele Seiten in der Höhe
      margins: { left: 0.6, right: 0.6, top: 0.7, bottom: 0.7, header: 0.3, footer: 0.3 },
      horizontalCentered: true,
      // Der Titel-Block (Zeilen 1–2) wird oben auf JEDER gedruckten Seite
      // wiederholt – so weiss man auf Seite 2 noch, um welche Maschine es geht.
      printTitlesRow: '1:2',
    },
    headerFooter: {
      oddFooter: `&L&"Arial"&8${titel}&C&"Arial"&8Seite &P von &N&R&"Arial"&8${new Date().toLocaleDateString('de-CH')}`,
      evenFooter: `&L&"Arial"&8${titel}&C&"Arial"&8Seite &P von &N&R&"Arial"&8${new Date().toLocaleDateString('de-CH')}`,
    },
    // Gitterlinien nicht anzeigen -> wirkt wie ein Dokument, nicht wie Tabelle
    views: [{ showGridLines: false }],
  });

  // Spaltenbreiten so gewählt, dass die Seite auf A4 hochkant OHNE Verkleinerung
  // passt (Summe ~88). Die vier Spalten tragen auch die vier Preis-Kacheln.
  ws.columns = [
    { width: 23 }, { width: 23 }, { width: 21 }, { width: 21 },
  ];

  let z = 1;   // aktuelle Zeile

  // ==========================================================================
  // Kopf – wird oben auf jeder gedruckten Seite wiederholt (printTitlesRow)
  // ==========================================================================
  ws.mergeCells(z, 1, z, 4);
  const kopf = ws.getCell(z, 1);
  kopf.value = {
    richText: [
      { text: 'AgriWert   ', font: { size: 11, bold: true, color: { argb: 'FFCFE0D6' } } },
      { text: titel, font: { size: 18, bold: true, color: { argb: 'FFFFFFFF' } } },
    ],
  };
  kopf.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRUEN } };
  kopf.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(z).height = 32;
  z++;

  ws.mergeCells(z, 1, z, 4);
  const unterkopf = ws.getCell(z, 1);
  unterkopf.value = 'Bewertungsbericht   ·   ' + [
    kontext.kategorie?.name,
    maschine.typ,
    maschine.baujahr ? `Baujahr ${maschine.baujahr}` : null,
    `erstellt ${new Date().toLocaleDateString('de-CH')}`,
  ].filter(Boolean).join('   ·   ');
  unterkopf.font = { size: 9, color: { argb: 'FF616B73' } };
  unterkopf.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAU_HELL } };
  unterkopf.alignment = { vertical: 'middle', indent: 1 };
  unterkopf.border = { bottom: { style: 'thin', color: { argb: RAHMEN_FARBE } } };
  ws.getRow(z).height = 18;
  z += 2;

  // ==========================================================================
  // Preise – das Wichtigste zuerst
  // ==========================================================================
  z = abschnitt(ws, z, 'Preisermittlung');
  const w = bewertung.waehrung ?? 'CHF';
  z = kachelZeile(ws, z, [
    ['Marktwert', bewertung.marktwert, w, true],
    ['Ankaufspreis', bewertung.ankaufspreis, w],
    ['Eintauschpreis', bewertung.eintauschpreis, w],
    ['Verkaufspreis', bewertung.verkaufspreis, w],
  ]);
  z = paar(ws, z, 'Preisband', bewertung.preisband_von != null
    ? `${formatPreis(bewertung.preisband_von, '')} – ${formatPreis(bewertung.preisband_bis, w)}` : '–');
  z = paar(ws, z, 'Offener Reparaturbedarf', formatPreis(bewertung.reparaturkosten ?? 0, w));
  z++;

  // ==========================================================================
  // Zustand
  // ==========================================================================
  z = abschnitt(ws, z, 'Zustand');
  z = paar(ws, z, 'Zustandsindex', bewertung.index != null ? `${bewertung.index} / 100` : '–');
  z = paar(ws, z, 'Technischer Zustand', bewertung.technisch != null ? `${bewertung.technisch} / 10` : '–');
  z = paar(ws, z, 'Optischer Zustand', bewertung.optisch != null ? `${bewertung.optisch} / 10` : '–');
  z = paar(ws, z, 'Beurteilung', { gruen: 'Gut', gelb: 'Mittel', rot: 'Schlecht' }[bewertung.ampel] ?? 'Unbekannt');
  z++;

  // ==========================================================================
  // Stammdaten
  // ==========================================================================
  const felder = [
    ['Kategorie', kontext.kategorie?.name],
    ['Hersteller', maschine.hersteller],
    ['Marke', maschine.marke],
    ['Modell', maschine.modell],
    ['Typ / Bezeichnung', maschine.typ],
    ['Seriennummer', maschine.seriennummer],
    ['Fahrgestellnummer', maschine.fahrgestellnummer],
    ['Baujahr', maschine.baujahr],
    ['Erstzulassung', maschine.erstzulassung ? new Date(maschine.erstzulassung).toLocaleDateString('de-CH') : null],
    ['Betriebsstunden', maschine.betriebsstunden != null ? `${maschine.betriebsstunden.toLocaleString('de-CH')} h` : null],
    ['Motorstunden', maschine.motorstunden != null ? `${maschine.motorstunden.toLocaleString('de-CH')} h` : null],
    ['Motorleistung', maschine.motorleistung ? `${maschine.motorleistung} PS` : null],
    ['Hubraum', maschine.hubraum ? `${maschine.hubraum.toLocaleString('de-CH')} cm³` : null],
    ['Zylinder', maschine.zylinder],
    ['Gewicht', maschine.gewicht ? `${maschine.gewicht.toLocaleString('de-CH')} kg` : null],
    ['Anzahl Steuerventile', maschine.steuerventile],
    ['Standort', maschine.standort],
    ['Besitzer', maschine.besitzer],
    ['Neupreis', maschine.neupreis != null ? formatPreis(maschine.neupreis, w) : null],
    ['Erfasst von', kontext.benutzerName?.(maschine.created_by)],
    ['Zuletzt geändert', maschine.updated_at ? new Date(maschine.updated_at).toLocaleString('de-CH') : null],
  ];

  z = abschnitt(ws, z, 'Stammdaten');
  for (const [label, wert] of felder) z = paar(ws, z, label, wert ?? '–');
  z++;

  // ==========================================================================
  // Freitexte
  // ==========================================================================
  if (maschine.servicehistorie) {
    z = abschnitt(ws, z, 'Servicehistorie');
    z = fliesstext(ws, z, maschine.servicehistorie);
    z++;
  }
  if (maschine.notizen) {
    z = abschnitt(ws, z, 'Notizen');
    z = fliesstext(ws, z, maschine.notizen);
    z++;
  }

  // ==========================================================================
  // Ausstattung
  // ==========================================================================
  const ausstattung = Array.isArray(maschine.ausstattung) ? maschine.ausstattung : [];
  if (ausstattung.length) {
    const zuschlaege = kontext.settings?.ausstattung_zuschlaege ?? {};
    z = abschnitt(ws, z, 'Ausstattung');
    z = tabelle(ws, z, ['Ausstattung', 'Zuschlag'],
      ausstattung.map((a) => [a, zuschlaege[a] != null ? formatPreis(zuschlaege[a], w) : '–']));
    z++;
  }

  // ==========================================================================
  // Baugruppen – beginnt auf einer neuen Seite (klare Dokumentstruktur:
  // Seite 1 = Übersicht/Preise/Stammdaten, ab hier der technische Teil)
  // ==========================================================================
  if (daten.baugruppen?.length) {
    ws.getRow(z).addPageBreak();
    z = abschnitt(ws, z, 'Technische Bewertung der Baugruppen');
    z = tabelle(ws, z, ['Baugruppe', 'Note', 'Bemerkungen / Schäden', 'Reparaturkosten'],
      daten.baugruppen.map((b) => [
        b.name,
        b.note != null ? `${b.note} / 10` : '–',
        [b.bemerkungen, b.schaeden].filter(Boolean).join(' · ') || '–',
        b.reparaturbedarf ? formatPreis(b.reparaturkosten ?? 0, w) : '–',
      ]));
    z++;
  }

  // ==========================================================================
  // Reifen
  // ==========================================================================
  if (daten.reifen?.length) {
    z = abschnitt(ws, z, 'Reifen');
    z = tabelle(ws, z, ['Position', 'Hersteller / Dimension', 'Verschleiss', 'Zustand'],
      daten.reifen.map((r) => [
        r.position,
        [r.hersteller, r.dimension, r.profil].filter(Boolean).join(' · ') || '–',
        r.verschleiss != null ? `${r.verschleiss} % abgefahren` : '–',
        [r.zustand != null ? `${r.zustand} / 10` : null, r.alter_jahre ? `${r.alter_jahre} J.` : null,
         r.schaeden].filter(Boolean).join(' · ') || '–',
      ]));
    z++;
  }

  // ==========================================================================
  // Schäden
  // ==========================================================================
  if (daten.schaeden?.length) {
    z = abschnitt(ws, z, 'Schäden');
    z = tabelle(ws, z, ['Schaden', 'Beschreibung / Ursache', 'Empfehlung', 'Kostenschätzung'],
      daten.schaeden.map((s) => [
        `${s.titel}\n(Priorität ${s.prioritaet})`,
        [s.beschreibung, s.ursache].filter(Boolean).join('\nUrsache: ') || '–',
        s.reparaturempfehlung || '–',
        formatPreis(s.kostenschaetzung ?? 0, w),
      ]));
    z++;
  }

  // ==========================================================================
  // Marktvergleich
  // ==========================================================================
  if (daten.vergleiche?.length) {
    z = abschnitt(ws, z, 'Marktvergleich');
    z = tabelle(ws, z, ['Vergleichsmaschine', 'Baujahr / Stunden', 'Quelle / Region', 'Angebotspreis'],
      daten.vergleiche.map((v) => [
        [v.hersteller, v.modell].filter(Boolean).join(' ') || '–',
        [v.baujahr, v.betriebsstunden ? `${v.betriebsstunden.toLocaleString('de-CH')} h` : null]
          .filter(Boolean).join(' · ') || '–',
        [v.quelle, v.region].filter(Boolean).join(' · ') || '–',
        v.angebotspreis != null ? formatPreis(v.angebotspreis, w) : '–',
      ]));
    z++;
  }

  // ==========================================================================
  // Aufgaben und Kommentare
  // ==========================================================================
  if (daten.aufgaben?.length) {
    z = abschnitt(ws, z, 'Aufgaben');
    z = tabelle(ws, z, ['Aufgabe', 'Zugewiesen', 'Fällig', 'Status'],
      daten.aufgaben.map((a) => [
        a.titel,
        a.zugewiesen_an ? (kontext.benutzerName?.(a.zugewiesen_an) ?? '–') : '–',
        a.faellig_am ? new Date(a.faellig_am).toLocaleDateString('de-CH') : '–',
        a.erledigt ? 'erledigt' : 'offen',
      ]));
    z++;
  }

  if (daten.kommentare?.length) {
    z = abschnitt(ws, z, 'Kommentare');
    z = tabelle(ws, z, ['Wer', 'Wann', 'Kommentar', ''],
      daten.kommentare.map((k) => [
        kontext.benutzerName?.(k.created_by) ?? '–',
        new Date(k.created_at).toLocaleDateString('de-CH'),
        k.text, '',
      ]));
    z++;
  }

  // Druckbereich auf den tatsächlich genutzten Bereich festlegen, damit beim
  // Drucken keine leeren Spalten/Seiten mitkommen.
  ws.pageSetup.printArea = `A1:D${z}`;

  // ==========================================================================
  // Fotos – auf einem eigenen Blatt, damit die Bewertung druckbar bleibt
  // ==========================================================================
  if (daten.fotos?.length) {
    melde(`Lade ${daten.fotos.length} Foto(s) …`);
    await fotoBlatt(wb, ExcelJS, daten.fotos, titel, melde);
  }

  // ==========================================================================
  // Herunterladen
  // ==========================================================================
  melde('Erstelle Datei …');
  const puffer = await wb.xlsx.writeBuffer();
  const dateiname = `${dateinameSicher(titel)}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  herunterladen(puffer, dateiname);
  melde('');
  return dateiname;
}

// ============================================================================
// Bausteine
// ============================================================================

/** Abschnittsüberschrift über die volle Breite. */
function abschnitt(ws, z, titel) {
  ws.mergeCells(z, 1, z, 4);
  const c = ws.getCell(z, 1);
  c.value = titel.toUpperCase();
  c.font = { size: 10, bold: true, color: { argb: GRUEN } };
  c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAU_HELL } };
  c.alignment = { vertical: 'middle', indent: 1 };
  c.border = { bottom: { style: 'medium', color: { argb: GRUEN } } };
  ws.getRow(z).height = 22;
  return z + 1;
}

/** Eine Zeile "Bezeichnung | Wert". */
function paar(ws, z, label, wert) {
  const a = ws.getCell(z, 1);
  a.value = label;
  a.font = { size: 11, color: { argb: 'FF616B73' } };
  a.alignment = { vertical: 'top', indent: 1 };
  a.border = RAHMEN;

  ws.mergeCells(z, 2, z, 4);
  const b = ws.getCell(z, 2);
  b.value = wert === null || wert === undefined || wert === '' ? '–' : wert;
  b.font = { size: 11 };
  b.alignment = { vertical: 'top', wrapText: true };
  b.border = RAHMEN;

  ws.getRow(z).height = zeilenHoehe(String(b.value), 60);
  return z + 1;
}

/** Vier hervorgehobene Preis-Kacheln nebeneinander. */
function kachelZeile(ws, z, kacheln) {
  kacheln.forEach(([label], i) => {
    const c = ws.getCell(z, i + 1);
    c.value = label;
    c.font = { size: 9, color: { argb: 'FF616B73' } };
    c.alignment = { horizontal: 'center' };
    c.border = { ...RAHMEN, bottom: undefined };
  });
  ws.getRow(z).height = 16;

  kacheln.forEach(([, wert, waehrung, gross], i) => {
    const c = ws.getCell(z + 1, i + 1);
    c.value = wert != null ? formatPreis(wert, waehrung) : '–';
    c.font = { size: gross ? 15 : 12, bold: true, color: { argb: gross ? GRUEN : 'FF16191C' } };
    c.alignment = { horizontal: 'center', vertical: 'middle' };
    c.border = { ...RAHMEN, top: undefined };
  });
  ws.getRow(z + 1).height = 26;
  return z + 2;
}

/** Tabelle mit fetter Kopfzeile. */
function tabelle(ws, z, kopf, zeilen) {
  kopf.forEach((k, i) => {
    const c = ws.getCell(z, i + 1);
    c.value = k;
    c.font = { size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRUEN } };
    c.alignment = { vertical: 'middle', indent: 1 };
    c.border = RAHMEN;
  });
  ws.getRow(z).height = 20;
  z++;

  // Spaltenbreiten für die Zeilenhöhen-Schätzung (wie ws.columns oben)
  const breiten = [23, 23, 21, 21];

  for (const zeile of zeilen) {
    let maxZeilen = 1;
    zeile.forEach((v, i) => {
      const c = ws.getCell(z, i + 1);
      c.value = v ?? '–';
      c.font = { size: 11 };
      c.alignment = { vertical: 'top', wrapText: true, indent: 1 };
      c.border = RAHMEN;
      // Höchste benötigte Zeilenzahl über alle Spalten der Zeile bestimmen
      const s = String(v ?? '–');
      const umbr = (s.match(/\n/g) || []).length;
      const proZeile = Math.max(8, (breiten[i] ?? 21) - 3);
      maxZeilen = Math.max(maxZeilen, Math.ceil(s.length / proZeile) + umbr);
    });
    ws.getRow(z).height = Math.max(18, Math.min(maxZeilen * 14 + 4, 240));
    z++;
  }
  return z;
}

/** Längerer Text über die volle Breite. */
function fliesstext(ws, z, text) {
  ws.mergeCells(z, 1, z, 4);
  const c = ws.getCell(z, 1);
  c.value = text;
  c.font = { size: 11 };
  c.alignment = { vertical: 'top', wrapText: true, indent: 1 };
  c.border = RAHMEN;
  ws.getRow(z).height = zeilenHoehe(text, 84);
  return z + 1;
}

/** Schätzt die nötige Zeilenhöhe, damit nichts abgeschnitten wird. */
function zeilenHoehe(text, zeichenProZeile) {
  const umbrueche = (text.match(/\n/g) || []).length;
  const zeilen = Math.ceil(text.length / zeichenProZeile) + umbrueche;
  return Math.max(18, Math.min(zeilen * 14 + 4, 240));
}

// ============================================================================
// Fotos
// ============================================================================
async function fotoBlatt(wb, ExcelJS, fotos, titel, melde) {
  const ws = wb.addWorksheet('Fotos', {
    pageSetup: {
      paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.6, right: 0.6, top: 0.7, bottom: 0.7, header: 0.3, footer: 0.3 },
      horizontalCentered: true,
    },
    headerFooter: {
      oddFooter: `&L&"Arial"&8${titel} – Fotos&R&"Arial"&8Seite &P von &N`,
    },
    views: [{ showGridLines: false }],
  });
  ws.columns = [{ width: 44 }, { width: 44 }];

  ws.mergeCells(1, 1, 1, 2);
  const kopf = ws.getCell(1, 1);
  kopf.value = `${titel} – Fotodokumentation`;
  kopf.font = { size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  kopf.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRUEN } };
  kopf.alignment = { vertical: 'middle', indent: 1 };
  ws.getRow(1).height = 30;

  let zeile = 3;
  let spalte = 1;

  for (const [i, foto] of fotos.entries()) {
    melde(`Lade Foto ${i + 1} von ${fotos.length} …`);
    const bild = await bildAlsBase64(fotoUrl(foto.storage_path));
    if (!bild) continue;    // Foto nicht erreichbar -> überspringen statt abbrechen

    const id = wb.addImage({ base64: bild.base64, extension: 'jpeg' });

    // Beschriftung über dem Bild
    const c = ws.getCell(zeile, spalte);
    c.value = foto.kategorie;
    c.font = { size: 10, bold: true, color: { argb: 'FF616B73' } };
    ws.getRow(zeile).height = 16;

    // Bild einpassen (max. 300 x 225 Punkte)
    const maxB = 300, maxH = 225;
    const faktor = Math.min(maxB / bild.breite, maxH / bild.hoehe, 1);
    ws.addImage(id, {
      tl: { col: spalte - 1, row: zeile },
      ext: { width: bild.breite * faktor, height: bild.hoehe * faktor },
    });
    ws.getRow(zeile + 1).height = bild.hoehe * faktor * 0.78;   // Punkte -> Zeilenhöhe

    if (spalte === 2) { spalte = 1; zeile += 3; } else { spalte = 2; }
  }
}

/** Lädt ein Bild und gibt es als base64 samt Abmessungen zurück. */
async function bildAlsBase64(url) {
  try {
    const antwort = await fetch(url);
    if (!antwort.ok) return null;
    const blob = await antwort.blob();

    const masse = await new Promise((fertig) => {
      const img = new Image();
      const u = URL.createObjectURL(blob);
      img.onload = () => { URL.revokeObjectURL(u); fertig({ breite: img.width, hoehe: img.height }); };
      img.onerror = () => { URL.revokeObjectURL(u); fertig({ breite: 800, hoehe: 600 }); };
      img.src = u;
    });

    const base64 = await new Promise((fertig) => {
      const leser = new FileReader();
      leser.onload = () => fertig(String(leser.result).split(',')[1]);
      leser.readAsDataURL(blob);
    });

    return { base64, ...masse };
  } catch {
    return null;
  }
}

// ============================================================================
// Datei speichern
// ============================================================================
function herunterladen(puffer, dateiname) {
  const blob = new Blob([puffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = dateiname;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function dateinameSicher(text) {
  return text.replace(/[^\wäöüÄÖÜß -]/g, '').replace(/\s+/g, '_').slice(0, 60) || 'Maschine';
}

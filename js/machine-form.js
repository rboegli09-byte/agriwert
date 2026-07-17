// ============================================================================
// AgriWert – Maschinen-Detailansicht
// ----------------------------------------------------------------------------
// Eine Maschine mit allen Bereichen des Anforderungskatalogs:
//   Stammdaten · Ausstattung · Baugruppen · Reifen · Schäden ·
//   Fotos · Kommentare · Aufgaben · Marktvergleich · Verlauf
//
// Aufruf aus app.js:
//   renderMaschine(container, { machine, state, onClose, onGespeichert })
//   machine = null  ->  Neuanlage (nur Stammdaten/Ausstattung/Fotos)
// ============================================================================

import { supabase } from './supabase.js';
import { FOTO_KATEGORIEN } from './config.js';
import {
  bewerteMaschine, mitStandardwerten, formatPreis, vergleichbarkeit,
} from './pricing.js';
import { ladeFotoHoch, fotoUrl, loescheFoto, loescheAlleFotosVonMaschine } from './photos.js';
import {
  esc, $, $$, datum, datumZeit, entprellen, leerZuNull, zuGanzzahl, zuZahl,
} from './util.js';
import {
  STATUS, statusMarke, statusLabel, ladeFreigaben, freigeben,
  freigabeZurueckziehen, alsEingekauft, alsVerkauft, statusZuruecksetzen,
} from './status.js';

const REIFEN_POSITIONEN = [
  'Vorne links', 'Vorne rechts', 'Hinten links', 'Hinten rechts',
  'Zwillingsrad links', 'Zwillingsrad rechts', 'Ersatzrad',
];
const PRIORITAETEN = ['hoch', 'mittel', 'tief'];

// --- Symbole (schlicht, passend zur sachlichen Optik) -----------------------
const svg = (inhalt) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
  aria-hidden="true" class="icon">${inhalt}</svg>`;

const ICON_STIFT = svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>');
const ICON_AUGE = svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>');
const ICON_EXCEL = svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="m9 13 6 6"/><path d="m15 13-6 6"/>');
const ICON_KAMERA = svg('<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"/><circle cx="12" cy="13" r="3.5"/>');
const ICON_BILDER = svg('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>');
const ICON_PAPIERKORB = svg('<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>');

// Modul-eigener Zustand der geöffneten Maschine
let ctx = null;

/**
 * Zeichnet die Detailansicht.
 * @param {HTMLElement} host      Ziel-Element
 * @param {object} optionen       { machine, state, onClose, onGespeichert }
 */
export async function renderMaschine(host, optionen) {
  // Eine Maschine existiert in der Datenbank immer schon – auch eine neue.
  // Sie ist dann als "entwurf" markiert und für Liste/Dashboard unsichtbar.
  // Dadurch sind alle Reiter von Anfang an nutzbar.
  const istEntwurf = optionen.machine?.entwurf === true;

  ctx = {
    host,
    state: optionen.state,
    machine: { ...optionen.machine },
    neu: istEntwurf,
    onClose: optionen.onClose,
    onGespeichert: optionen.onGespeichert,
    tab: 'stammdaten',
    // Ein Entwurf wird logischerweise bearbeitet. Eine bestehende Maschine
    // öffnet sich zum ANSEHEN – erst der Stift oben rechts schaltet um.
    modus: istEntwurf ? 'bearbeiten' : 'ansicht',
    daten: { baugruppen: [], reifen: [], schaeden: [], fotos: [], kommentare: [], aufgaben: [], vergleiche: [], verlauf: [] },
    freigaben: [],
    profile: [],
    pendingFotos: [],
    entwurf: {},          // Stammdaten-Eingaben, solange nicht gespeichert
  };

  await ladeDetails();
  zeichne();
}

/** true, wenn gerade bearbeitet werden darf. */
const bearbeitbar = () => ctx.modus === 'bearbeiten';

/** Schaltet zwischen Ansehen und Bearbeiten um. */
function setzeModus(modus) {
  ctx.modus = modus;
  zeichne();
  ctx.host.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ============================================================================
// Daten laden
// ============================================================================
async function ladeDetails() {
  const id = ctx.machine.id;
  ctx.freigaben = await ladeFreigaben(id);
  const [bg, rf, sch, ft, km, af, vg, vl, pr] = await Promise.all([
    supabase.from('baugruppen').select('*').eq('machine_id', id).order('sortierung'),
    supabase.from('reifen').select('*').eq('machine_id', id).order('created_at'),
    supabase.from('schaeden').select('*').eq('machine_id', id).order('created_at'),
    supabase.from('machine_photos').select('*').eq('machine_id', id).order('created_at'),
    supabase.from('kommentare').select('*').eq('machine_id', id).order('created_at', { ascending: false }),
    supabase.from('aufgaben').select('*').eq('machine_id', id).order('created_at'),
    supabase.from('vergleichsmaschinen').select('*').eq('machine_id', id).order('created_at'),
    supabase.from('machine_verlauf').select('*').eq('machine_id', id).order('created_at', { ascending: false }).limit(200),
    supabase.from('profiles').select('id, full_name, email'),
  ]);
  ctx.daten = {
    baugruppen: bg.data ?? [], reifen: rf.data ?? [], schaeden: sch.data ?? [],
    fotos: ft.data ?? [], kommentare: km.data ?? [], aufgaben: af.data ?? [],
    vergleiche: vg.data ?? [], verlauf: vl.data ?? [],
  };
  ctx.profile = pr.data ?? [];
}

/** Name eines Benutzers anhand seiner ID. */
function benutzerName(id) {
  const p = ctx.profile.find((x) => x.id === id);
  return p ? (p.full_name || p.email) : 'unbekannt';
}

// ============================================================================
// Gerüst
// ============================================================================
function zeichne() {
  const m = aktuelleMaschine();
  const titel = [m.hersteller || m.marke, m.modell].filter(Boolean).join(' ') || 'Neue Maschine';

  // Alle Reiter sind immer da – auch beim Erstellen. Möglich, weil auch eine
  // neue Maschine bereits eine ID in der Datenbank hat (siehe Entwurf).
  const tabs = [
    ['stammdaten', 'Stammdaten'],
    ['ausstattung', 'Ausstattung'],
    ['baugruppen', `Baugruppen (${bewerteteBaugruppen()}/${ctx.daten.baugruppen.length})`],
    ['reifen', `Reifen (${ctx.daten.reifen.length})`],
    ['schaeden', `Schäden (${ctx.daten.schaeden.length})`],
    ['fotos', `Fotos (${ctx.daten.fotos.length + ctx.pendingFotos.length})`],
    ['kommentare', `Kommentare (${ctx.daten.kommentare.length})`],
    ['aufgaben', `Aufgaben (${offeneAufgaben()})`],
    ['vergleich', `Marktvergleich (${ctx.daten.vergleiche.length})`],
    ['verlauf', 'Verlauf'],
  ];

  ctx.host.innerHTML = `
    <div class="detail-kopf">
      <div class="detail-titel">
        <button class="btn-klein" id="zurueck">← Zurück zur Liste</button>
        <h2>${esc(titel)} ${ctx.neu ? '' : statusMarke(ctx.machine.status)}</h2>
        ${ctx.neu ? '' : `<p class="mini-hinweis">Zuletzt geändert ${datumZeit(ctx.machine.updated_at)} · Version ${ctx.machine.version ?? 1}</p>`}
      </div>

      <div class="detail-werkzeuge">
        ${ctx.neu ? `
          <button class="btn-danger" id="verwerfen-btn" title="Erfassung abbrechen">Verwerfen</button>
        ` : `
          <button class="btn-sekundaer" id="excel-btn" title="Diese Maschine als Excel-Datei exportieren">
            ${ICON_EXCEL}<span>Excel</span>
          </button>
          ${bearbeitbar()
            ? `<button class="btn-sekundaer" id="ansehen-btn" title="Bearbeitung beenden">
                 ${ICON_AUGE}<span>Nur ansehen</span>
               </button>`
            : `<button class="btn-primary" id="bearbeiten-btn" title="Maschine bearbeiten">
                 ${ICON_STIFT}<span>Bearbeiten</span>
               </button>`}
          <button class="btn-loeschen-icon" id="loeschen-oben" title="Maschine löschen">
            ${ICON_PAPIERKORB}
          </button>
        `}
      </div>

      <div id="bewertung-panel"></div>
    </div>

    ${ctx.neu
      ? `<div class="modus-band entwurf-band">Neue Maschine – alle Reiter sind nutzbar.
           Sie erscheint erst in der Liste, wenn du unter <b>Stammdaten</b> auf
           <b>Maschine anlegen</b> klickst.</div>`
      : bearbeitbar()
        ? '<div class="modus-band">Bearbeitungsmodus – Änderungen werden gespeichert.</div>' : ''}

    ${ctx.neu ? '' : '<div id="status-leiste"></div>'}

    <nav class="untertabs">
      ${tabs.map(([id, label]) =>
        `<button data-utab="${id}" class="${ctx.tab === id ? 'aktiv' : ''}">${esc(label)}</button>`).join('')}
    </nav>

    <div id="utab-inhalt" class="formular"></div>`;

  $('#zurueck', ctx.host).addEventListener('click', () => ctx.onClose());
  $$('[data-utab]', ctx.host).forEach((b) =>
    b.addEventListener('click', () => { ctx.tab = b.dataset.utab; zeichne(); })
  );

  $('#bearbeiten-btn', ctx.host)?.addEventListener('click', () => setzeModus('bearbeiten'));
  $('#ansehen-btn', ctx.host)?.addEventListener('click', () => {
    ctx.entwurf = {};          // nicht gespeicherte Eingaben verwerfen
    setzeModus('ansicht');
  });
  $('#excel-btn', ctx.host)?.addEventListener('click', excelExportieren);
  $('#verwerfen-btn', ctx.host)?.addEventListener('click', verwerfeEntwurf);
  $('#loeschen-oben', ctx.host)?.addEventListener('click', loescheMaschine);

  zeichneBewertung();
  if (!ctx.neu) zeichneStatusLeiste();
  zeichneInhalt();
}

// ============================================================================
// STATUS-LEISTE – Fortschritt und der jeweils nächste Schritt
// ============================================================================
function zeichneStatusLeiste() {
  const ziel = $('#status-leiste', ctx.host);
  if (!ziel) return;

  const m = ctx.machine;
  const status = m.status ?? 'bewertet';
  const noetig = ctx.state.settings?.freigaben_noetig ?? 2;
  const anzahl = ctx.freigaben.length;
  const eigene = ctx.freigaben.some((f) => f.benutzer === ctx.state.user.id);

  ziel.innerHTML = `
    <div class="status-leiste">
      <ol class="status-schritte">
        ${Object.entries(STATUS).map(([schluessel, s]) => {
          const erreicht = STATUS[status].reihe >= s.reihe;
          const jetzt = schluessel === status;
          return `<li class="${erreicht ? 'erreicht' : ''} ${jetzt ? 'jetzt' : ''}">
            <span class="punkt"></span>${esc(s.label)}</li>`;
        }).join('')}
      </ol>

      <div class="status-aktion">
        ${statusAktionHtml(status, anzahl, noetig, eigene)}
      </div>
    </div>

    ${status === 'bewertet' || status === 'freigegeben' ? `
      <div class="freigabe-kasten">
        <div class="freigabe-kopf">
          <b>Freigaben zum Preis: ${anzahl} von ${noetig}</b>
          <span class="mini-hinweis">Ab ${noetig} Okey wechselt der Status automatisch auf „Freigegeben".</span>
        </div>
        <div class="freigabe-wer">
          ${anzahl === 0 ? '<span class="mini-hinweis">Noch niemand hat freigegeben.</span>'
            : ctx.freigaben.map((f) => `
              <span class="freigabe-chip" title="${esc(datumZeit(f.created_at))}">
                ✓ ${esc(benutzerName(f.benutzer))}</span>`).join('')}
        </div>
        <button type="button" class="${eigene ? 'btn-sekundaer' : 'btn-primary'}" id="freigabe-btn">
          ${eigene ? 'Meine Freigabe zurückziehen' : 'Preis freigeben (mein Okey)'}
        </button>
        <span class="fehler" id="status-fehler"></span>
      </div>` : ''}

    ${status === 'verkauft' ? verkaufsKastenHtml(m) : ''}`;

  $('#freigabe-btn', ziel)?.addEventListener('click', () => umschaltenFreigabe(eigene));
  $('#eingekauft-btn', ziel)?.addEventListener('click', markiereEingekauft);
  $('#verkauft-btn', ziel)?.addEventListener('click', zeigeVerkaufsDialog);
  $('#zurueck-btn', ziel)?.addEventListener('click', () => schrittZurueck(status));
}

/** Der Knopf, der zum jeweils nächsten Schritt führt. */
function statusAktionHtml(status, anzahl, noetig, eigene) {
  if (status === 'bewertet') {
    return `<span class="mini-hinweis">Es fehlen noch ${Math.max(0, noetig - anzahl)} Freigabe(n),
      damit die Maschine eingekauft werden kann.</span>`;
  }
  if (status === 'freigegeben') {
    return `<button type="button" class="btn-primary" id="eingekauft-btn">Als eingekauft markieren</button>`;
  }
  if (status === 'eingekauft') {
    return `<button type="button" class="btn-primary" id="verkauft-btn">Als verkauft markieren</button>
            <button type="button" class="btn-klein" id="zurueck-btn">Einkauf rückgängig</button>`;
  }
  return `<button type="button" class="btn-klein" id="zurueck-btn">Verkauf rückgängig</button>`;
}

function verkaufsKastenHtml(m) {
  return `
    <div class="verkauf-kasten">
      <h3>Verkauf</h3>
      <dl class="datenliste">
        <div><dt>Verkaufspreis</dt><dd><b>${formatPreis(m.verkaufspreis_tatsaechlich, ctx.state.settings?.waehrung)}</b></dd></div>
        <div><dt>Verkauft am</dt><dd>${datum(m.verkauft_am)}</dd></div>
        <div><dt>Käufer</dt><dd>${esc(m.kaeufer || '–')}</dd></div>
        <div><dt>Erfasst von</dt><dd>${esc(benutzerName(m.verkauft_von))}</dd></div>
        ${m.ankaufspreis ? `<div><dt>Marge gegenüber Ankaufspreis</dt><dd><b class="${
          (m.verkaufspreis_tatsaechlich ?? 0) - m.ankaufspreis >= 0 ? 'gut-text' : 'warn-text'
        }">${formatPreis((m.verkaufspreis_tatsaechlich ?? 0) - m.ankaufspreis, ctx.state.settings?.waehrung)}</b></dd></div>` : ''}
      </dl>
    </div>`;
}

async function umschaltenFreigabe(hatEigene) {
  const fehler = $('#status-fehler', ctx.host);
  if (fehler) fehler.textContent = '';
  try {
    if (hatEigene) await freigabeZurueckziehen(ctx.machine.id, ctx.state.user.id);
    else await freigeben(ctx.machine.id, ctx.state.user.id);

    // Der Status wird von der Datenbank gesetzt – darum frisch laden.
    await ladeMaschineNeu();
  } catch (err) {
    if (fehler) fehler.textContent = 'Fehler: ' + (err.message || err);
  }
}

async function markiereEingekauft() {
  try {
    ctx.machine = await alsEingekauft(ctx.machine, ctx.state.user.id);
    ctx.onGespeichert?.();
    zeichne();
  } catch (err) {
    alert(err.message || err);
  }
}

async function schrittZurueck(status) {
  const ziel = status === 'verkauft' ? 'eingekauft' : 'freigegeben';
  if (!confirm(`Wirklich zurück auf „${statusLabel(ziel)}"?`)) return;
  try {
    ctx.machine = await statusZuruecksetzen(ctx.machine, ziel);
    ctx.onGespeichert?.();
    zeichne();
  } catch (err) {
    alert(err.message || err);
  }
}

/** Lädt Maschine und Freigaben frisch – nötig, weil der Trigger den Status setzt. */
async function ladeMaschineNeu() {
  const { data } = await supabase.from('machines').select('*').eq('id', ctx.machine.id).single();
  if (data) ctx.machine = data;
  ctx.freigaben = await ladeFreigaben(ctx.machine.id);
  ctx.onGespeichert?.();
  zeichne();
}

// ============================================================================
// Verkaufs-Dialog
// ============================================================================
function zeigeVerkaufsDialog() {
  const vorschlag = ctx.machine.verkaufspreis ?? ctx.machine.marktwert ?? '';
  const box = document.createElement('div');
  box.className = 'dialog-hinter';
  box.innerHTML = `
    <form class="dialog" id="verkauf-form">
      <h3>Maschine als verkauft markieren</h3>
      <label>Tatsächlicher Verkaufspreis (${esc(ctx.state.settings?.waehrung ?? 'CHF')})
        <input type="number" id="vk-preis" value="${vorschlag}" required>
      </label>
      <label>Verkaufsdatum
        <input type="date" id="vk-datum" value="${new Date().toISOString().slice(0, 10)}" required>
      </label>
      <label>Käufer
        <input type="text" id="vk-kaeufer" placeholder="Name oder Firma">
      </label>
      <p class="mini-hinweis">Vorgeschlagen ist der berechnete Verkaufspreis – trag ein, was
        tatsächlich bezahlt wurde. So siehst du später, wie gut die Bewertung war.</p>
      <div class="dialog-aktionen">
        <button type="submit" class="btn-primary">Als verkauft markieren</button>
        <button type="button" class="btn-klein" id="vk-abbrechen">Abbrechen</button>
      </div>
      <span class="fehler" id="vk-fehler"></span>
    </form>`;
  document.body.appendChild(box);

  const zu = () => box.remove();
  $('#vk-abbrechen', box).addEventListener('click', zu);
  box.addEventListener('click', (e) => { if (e.target === box) zu(); });

  $('#verkauf-form', box).addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      ctx.machine = await alsVerkauft(ctx.machine, ctx.state.user.id, {
        preis: zuZahl($('#vk-preis', box).value),
        datum: $('#vk-datum', box).value,
        kaeufer: leerZuNull($('#vk-kaeufer', box).value),
      });
      zu();
      ctx.onGespeichert?.();
      zeichne();
    } catch (err) {
      $('#vk-fehler', box).textContent = err.message || err;
    }
  });
}

const bewerteteBaugruppen = () => ctx.daten.baugruppen.filter((b) => b.note != null).length;
const offeneAufgaben = () => ctx.daten.aufgaben.filter((a) => !a.erledigt).length;

/** Stammdaten: gespeicherte Werte + noch nicht gespeicherte Eingaben. */
function aktuelleMaschine() {
  return { ...(ctx.machine ?? {}), ...ctx.entwurf };
}

/**
 * Alles, was die Bewertung braucht: Baugruppen, Reifen, Schäden – und die
 * Kategorie, deren Faktoren die globalen Einstellungen übersteuern.
 */
function bewertungsKontext() {
  return { ...ctx.daten, kategorie: aktuelleKategorie() };
}

function aktuelleKategorie() {
  const id = aktuelleMaschine().kategorie_id;
  return (ctx.state.kategorien ?? []).find((k) => k.id === id) ?? null;
}

// ============================================================================
// Bewertungs-Panel (immer sichtbar, rechnet live mit)
// ============================================================================
function zeichneBewertung() {
  const r = bewerteMaschine(aktuelleMaschine(), bewertungsKontext(), ctx.state.settings);
  const p = $('#bewertung-panel', ctx.host);
  if (!p) return;

  if (r.marktwert === null) {
    p.innerHTML = `<div class="bewertung leer-bewertung">
      <span class="mini-hinweis">${esc(r.warnung || 'Noch keine Bewertung möglich.')}</span></div>`;
    return;
  }

  p.innerHTML = `
    <div class="bewertung">
      <div class="bewertung-zeile">
        <span class="ampel ${r.ampel}"></span>
        <span class="index">Zustandsindex <b>${r.index ?? '–'}</b>/100</span>
        <span class="mini">techn. ${r.technisch ?? '–'} · opt. ${r.optisch ?? '–'}</span>
      </div>
      <div class="preisraster">
        ${preisKachel('Marktwert', r.marktwert, r.waehrung, true)}
        ${preisKachel('Ankauf', r.ankaufspreis, r.waehrung)}
        ${preisKachel('Eintausch', r.eintauschpreis, r.waehrung)}
        ${preisKachel('Verkauf', r.verkaufspreis, r.waehrung)}
      </div>
      <div class="preisband">
        Preisband: <b>${formatPreis(r.preisband_von, '')} – ${formatPreis(r.preisband_bis, r.waehrung)}</b>
        ${r.reparaturkosten > 0 ? `· Reparaturbedarf: <b>${formatPreis(r.reparaturkosten, r.waehrung)}</b>` : ''}
      </div>
      <details class="preis-details"><summary>Rechnung anzeigen</summary>
        <ul>${r.schritte.map((s) => `<li><span>${esc(s.label)}</span>
          <span><b>${formatPreis(Math.round(s.wert), '')}</b>
          ${s.differenz != null ? `<em>${s.differenz >= 0 ? '+' : '−'}${formatPreis(Math.abs(Math.round(s.differenz)), '')}</em>` : ''}</span></li>`).join('')}</ul>
        ${r.warnung ? `<p class="warnung">${esc(r.warnung)}</p>` : ''}
      </details>
    </div>`;
}

function preisKachel(label, wert, waehrung, gross = false) {
  return `<div class="preis-kachel ${gross ? 'gross' : ''}">
    <span>${label}</span><b>${formatPreis(wert, waehrung)}</b></div>`;
}

// ============================================================================
// Inhalt je Unterreiter
// ============================================================================
function zeichneInhalt() {
  const c = $('#utab-inhalt', ctx.host);
  ({
    stammdaten: zeichneStammdaten,
    ausstattung: zeichneAusstattung,
    baugruppen: zeichneBaugruppen,
    reifen: zeichneReifen,
    schaeden: zeichneSchaeden,
    fotos: zeichneFotos,
    kommentare: zeichneKommentare,
    aufgaben: zeichneAufgaben,
    vergleich: zeichneVergleich,
    verlauf: zeichneVerlauf,
  }[ctx.tab] || zeichneStammdaten)(c);
}

// ----------------------------------------------------------------------------
// STAMMDATEN
// ----------------------------------------------------------------------------
function zeichneStammdaten(c) {
  if (!bearbeitbar()) { zeichneStammdatenAnsicht(c); return; }

  const m = aktuelleMaschine();
  const f = (name, label, typ = 'text') => `
    <label>${label}
      <input type="${typ}" name="${name}" value="${m[name] != null ? esc(String(m[name])) : ''}">
    </label>`;

  const kategorien = ctx.state.kategorien ?? [];
  const marken = ctx.state.marken ?? [];

  c.innerHTML = `
    <form id="stamm-form">
      <fieldset><legend>Einordnung</legend>
        <div class="grid">
          <label>Kategorie
            <select name="kategorie_id">
              <option value="">– bitte wählen –</option>
              ${kategorien.map((k) => `
                <option value="${k.id}" ${m.kategorie_id === k.id ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}
            </select>
          </label>
          <label>Hersteller
            <input type="text" name="hersteller" list="marken-liste"
                   value="${m.hersteller != null ? esc(String(m.hersteller)) : ''}"
                   placeholder="wählen oder neu eintippen">
          </label>
          ${f('typ', 'Typ / Bezeichnung')}
        </div>
        <datalist id="marken-liste">
          ${marken.map((k) => `<option value="${esc(k.name)}"></option>`).join('')}
        </datalist>
        <p class="mini-hinweis" id="kat-hinweis"></p>
      </fieldset>

      <fieldset><legend>Identifikation</legend>
        <div class="grid">
          ${f('marke', 'Marke (falls abweichend)')}
          ${f('modell', 'Modell')}
          ${f('seriennummer', 'Seriennummer')}
          ${f('fahrgestellnummer', 'Fahrgestellnummer')}
        </div>
      </fieldset>

      <fieldset><legend>Alter und Einsatz</legend>
        <div class="grid">
          ${f('baujahr', 'Baujahr', 'number')}
          ${f('erstzulassung', 'Erstzulassung', 'date')}
          ${f('betriebsstunden', 'Betriebsstunden', 'number')}
          ${f('motorstunden', 'Motorstunden', 'number')}
        </div>
      </fieldset>

      <fieldset><legend>Technik</legend>
        <div class="grid">
          ${f('motorleistung', 'Motorleistung (PS)', 'number')}
          ${f('hubraum', 'Hubraum (cm³)', 'number')}
          ${f('zylinder', 'Zylinder', 'number')}
          ${f('gewicht', 'Gewicht (kg)', 'number')}
          ${f('steuerventile', 'Anzahl Steuerventile', 'number')}
        </div>
      </fieldset>

      <fieldset><legend>Zuordnung</legend>
        <div class="grid">
          ${f('standort', 'Standort')}
          ${f('besitzer', 'Besitzer')}
          ${f('neupreis', 'Neupreis (CHF)', 'number')}
        </div>
      </fieldset>

      <fieldset><legend>Servicehistorie</legend>
        <textarea name="servicehistorie" rows="3"
          placeholder="Durchgeführte Services, Reparaturen, Wartungen …">${esc(m.servicehistorie || '')}</textarea>
      </fieldset>

      <fieldset><legend>Notizen</legend>
        <textarea name="notizen" rows="3"
          placeholder="Bemerkungen, Besonderheiten …">${esc(m.notizen || '')}</textarea>
      </fieldset>

      <div class="formular-aktionen">
        <button type="submit" class="btn-primary btn-gross">${ctx.neu ? 'Maschine anlegen' : 'Speichern'}</button>
        ${ctx.neu
          ? '<button type="button" id="verwerfen2" class="btn-klein">Abbrechen</button>'
          : '<button type="button" id="loeschen" class="btn-danger">Maschine löschen</button>'}
        <span class="fehler" id="stamm-fehler"></span>
        <span class="ok" id="stamm-ok"></span>
      </div>
    </form>`;

  const form = $('#stamm-form', c);

  // Eingaben live in den Entwurf übernehmen -> Bewertungs-Panel rechnet mit
  form.addEventListener('input', () => {
    Object.assign(ctx.entwurf, stammdatenAusFormular(form));
    zeigeKategorieHinweis(c);
    zeichneBewertung();
  });
  form.addEventListener('change', () => {
    Object.assign(ctx.entwurf, stammdatenAusFormular(form));
    zeigeKategorieHinweis(c);
    zeichneBewertung();
  });
  zeigeKategorieHinweis(c);

  form.addEventListener('submit', (e) => { e.preventDefault(); speichereStammdaten(form); });
  $('#loeschen', c)?.addEventListener('click', loescheMaschine);
  $('#verwerfen2', c)?.addEventListener('click', verwerfeEntwurf);
}

// ----------------------------------------------------------------------------
// STAMMDATEN – reine Anzeige (Standard beim Öffnen einer Maschine)
// ----------------------------------------------------------------------------

/** Definition der Anzeige: [Feldname, Beschriftung, Aufbereitung] */
const ANZEIGE_GRUPPEN = [
  ['Einordnung', [
    ['kategorie', 'Kategorie'],
    ['hersteller', 'Hersteller'],
    ['marke', 'Marke'],
    ['modell', 'Modell'],
    ['typ', 'Typ / Bezeichnung'],
  ]],
  ['Identifikation', [
    ['seriennummer', 'Seriennummer'],
    ['fahrgestellnummer', 'Fahrgestellnummer'],
  ]],
  ['Alter und Einsatz', [
    ['baujahr', 'Baujahr'],
    ['erstzulassung', 'Erstzulassung', (v) => datum(v)],
    ['betriebsstunden', 'Betriebsstunden', (v) => zahlMitEinheit(v, 'h')],
    ['motorstunden', 'Motorstunden', (v) => zahlMitEinheit(v, 'h')],
  ]],
  ['Technik', [
    ['motorleistung', 'Motorleistung', (v) => zahlMitEinheit(v, 'PS')],
    ['hubraum', 'Hubraum', (v) => zahlMitEinheit(v, 'cm³')],
    ['zylinder', 'Zylinder'],
    ['gewicht', 'Gewicht', (v) => zahlMitEinheit(v, 'kg')],
    ['steuerventile', 'Steuerventile'],
  ]],
  ['Zuordnung', [
    ['standort', 'Standort'],
    ['besitzer', 'Besitzer'],
    ['neupreis', 'Neupreis', (v) => (v == null ? null : formatPreis(v, 'CHF'))],
  ]],
];

function zahlMitEinheit(v, einheit) {
  if (v == null || v === '') return null;
  return `${Number(v).toLocaleString('de-CH')} ${einheit}`;
}

function zeichneStammdatenAnsicht(c) {
  const m = aktuelleMaschine();
  const kat = aktuelleKategorie();
  const wert = (feld, aufbereiten) => {
    const roh = feld === 'kategorie' ? (kat?.name ?? null) : m[feld];
    if (roh === null || roh === undefined || roh === '') return null;
    return aufbereiten ? aufbereiten(roh) : String(roh);
  };

  c.innerHTML = `
    ${fotoKopfHtml()}

    ${ANZEIGE_GRUPPEN.map(([titel, felder]) => {
      const zeilen = felder
        .map(([feld, label, auf]) => [label, wert(feld, auf)])
        .filter(([, v]) => v !== null);
      if (zeilen.length === 0) return '';
      return `
        <section class="ansicht-block">
          <h3>${esc(titel)}</h3>
          <dl class="datenliste">
            ${zeilen.map(([label, v]) => `
              <div><dt>${esc(label)}</dt><dd>${esc(v)}</dd></div>`).join('')}
          </dl>
        </section>`;
    }).join('')}

    ${textBlock('Servicehistorie', m.servicehistorie)}
    ${textBlock('Notizen', m.notizen)}

    <section class="ansicht-block">
      <h3>Ausstattung</h3>
      ${(Array.isArray(m.ausstattung) && m.ausstattung.length)
        ? `<div class="ausstattung-wolke">
             ${m.ausstattung.map((a) => `<span class="aus-chip">${esc(a)}</span>`).join('')}
           </div>`
        : '<p class="mini-hinweis">Keine Ausstattung erfasst.</p>'}
    </section>

    <p class="mini-hinweis ansicht-fuss">
      Diese Ansicht dient nur zum Lesen. Zum Ändern oben rechts auf <b>Bearbeiten</b> klicken.
    </p>`;

  bindeFotoKopf(c);
  bindeFotoLightbox(c);
}

/**
 * Fotos ganz oben in der Detailansicht: ein grosses Bild, darunter die
 * übrigen als Streifen zum Umschalten. So sieht man sofort, um welche
 * Maschine es geht, statt erst scrollen zu müssen.
 */
function fotoKopfHtml() {
  const fotos = ctx.daten.fotos;
  if (fotos.length === 0) {
    return `<div class="foto-kopf leer">
      <span class="mini-hinweis">Noch keine Fotos. Über <b>Bearbeiten</b> → <b>Fotos</b> hinzufügen.</span>
    </div>`;
  }

  // Bevorzugt die Vorderseite zeigen – sonst das erste Foto
  const start = fotos.find((f) => f.kategorie === 'Vorderseite') ?? fotos[0];

  return `
    <div class="foto-kopf">
      <figure class="foto-gross">
        <img id="foto-haupt" src="${fotoUrl(start.storage_path)}"
             alt="${esc(start.kategorie)}"
             data-gross="${fotoUrl(start.storage_path)}" data-titel="${esc(start.kategorie)}">
        <figcaption id="foto-haupt-titel">${esc(start.kategorie)}</figcaption>
      </figure>

      ${fotos.length > 1 ? `
        <div class="foto-streifen">
          ${fotos.map((f) => `
            <button type="button" class="streifen-bild ${f.id === start.id ? 'aktiv' : ''}"
                    data-pfad="${fotoUrl(f.storage_path)}" data-kat="${esc(f.kategorie)}"
                    title="${esc(f.kategorie)}">
              <img src="${fotoUrl(f.storage_path)}" alt="${esc(f.kategorie)}" loading="lazy">
            </button>`).join('')}
        </div>` : ''}
    </div>`;
}

function bindeFotoKopf(c) {
  const haupt = $('#foto-haupt', c);
  const titel = $('#foto-haupt-titel', c);
  if (!haupt) return;

  $$('.streifen-bild', c).forEach((b) =>
    b.addEventListener('click', () => {
      haupt.src = b.dataset.pfad;
      haupt.dataset.gross = b.dataset.pfad;
      haupt.dataset.titel = b.dataset.kat;
      haupt.alt = b.dataset.kat;
      titel.textContent = b.dataset.kat;
      $$('.streifen-bild', c).forEach((x) => x.classList.remove('aktiv'));
      b.classList.add('aktiv');
    })
  );
}

function textBlock(titel, text) {
  if (!text) return '';
  return `
    <section class="ansicht-block">
      <h3>${esc(titel)}</h3>
      <p class="freitext">${esc(text)}</p>
    </section>`;
}

/**
 * Zeigt an, mit welchen Faktoren die gewählte Kategorie rechnet.
 * Ohne diesen Hinweis wäre unerklärlich, warum dieselbe Maschine unter
 * "Heuernte" plötzlich weniger wert ist als unter "Traktoren".
 */
function zeigeKategorieHinweis(c) {
  const ziel = $('#kat-hinweis', c);
  if (!ziel) return;

  const k = aktuelleKategorie();
  if (!k) {
    ziel.textContent = 'Ohne Kategorie gelten die allgemeinen Wertverlust-Faktoren.';
    return;
  }

  const eigene = [
    k.wertverlust_jahr_prozent != null ? `${k.wertverlust_jahr_prozent} % pro Jahr` : null,
    k.wertverlust_pro_100h_prozent != null ? `${k.wertverlust_pro_100h_prozent} % je 100 h` : null,
    k.mindest_restwert_prozent != null ? `Mindestrestwert ${k.mindest_restwert_prozent} %` : null,
  ].filter(Boolean);

  ziel.textContent = eigene.length
    ? `„${k.name}" rechnet mit eigenen Faktoren: ${eigene.join(' · ')}.`
    : `„${k.name}" verwendet die allgemeinen Wertverlust-Faktoren.`;
}

function stammdatenAusFormular(form) {
  const g = (n) => form.elements[n]?.value ?? '';
  return {
    kategorie_id: leerZuNull(g('kategorie_id')),
    hersteller: leerZuNull(g('hersteller')), marke: leerZuNull(g('marke')),
    modell: leerZuNull(g('modell')), typ: leerZuNull(g('typ')),
    seriennummer: leerZuNull(g('seriennummer')),
    fahrgestellnummer: leerZuNull(g('fahrgestellnummer')),
    baujahr: zuGanzzahl(g('baujahr')), erstzulassung: leerZuNull(g('erstzulassung')),
    betriebsstunden: zuGanzzahl(g('betriebsstunden')),
    motorstunden: zuGanzzahl(g('motorstunden')),
    motorleistung: zuGanzzahl(g('motorleistung')), hubraum: zuGanzzahl(g('hubraum')),
    zylinder: zuGanzzahl(g('zylinder')), gewicht: zuGanzzahl(g('gewicht')),
    steuerventile: zuGanzzahl(g('steuerventile')),
    standort: leerZuNull(g('standort')), besitzer: leerZuNull(g('besitzer')),
    neupreis: zuZahl(g('neupreis')),
    servicehistorie: leerZuNull(g('servicehistorie')),
    notizen: leerZuNull(g('notizen')),
    ...(form.elements['zustand_gesamt']
      ? { zustand_gesamt: zuGanzzahl(form.elements['zustand_gesamt'].value) } : {}),
  };
}

async function speichereStammdaten(form) {
  const fehler = $('#stamm-fehler', ctx.host);
  const ok = $('#stamm-ok', ctx.host);
  fehler.textContent = ''; ok.textContent = '';

  const daten = { ...stammdatenAusFormular(form), ...bewertungsFelder() };

  // Ein Entwurf wird mit dem Speichern zur richtigen Maschine und taucht
  // ab dann in Liste und Dashboard auf.
  const warEntwurf = ctx.neu;
  if (warEntwurf) daten.entwurf = false;

  try {
    await merkeNeueMarke(daten.hersteller);

    // --- Konflikterkennung -------------------------------------------------
    // Nur speichern, wenn die Version noch die ist, die wir geladen haben.
    const { data, error } = await supabase.from('machines')
      .update(daten)
      .eq('id', ctx.machine.id)
      .eq('version', ctx.machine.version)
      .select();

    if (error) throw error;

    if (!data || data.length === 0) {
      await zeigeKonflikt();
      return;
    }

    ctx.machine = data[0];
    ctx.neu = false;
    ctx.entwurf = {};
    ctx.onGespeichert?.();
    // Nach dem Speichern zurück in die Nur-Lese-Ansicht – die Bearbeitung
    // soll nicht dauerhaft aktiv bleiben.
    ctx.modus = 'ansicht';
    zeichne();
  } catch (err) {
    fehler.textContent = 'Speichern fehlgeschlagen: ' + (err.message || err);
  }
}

/**
 * Nimmt eine neu eingetippte Marke in die Liste auf, damit sie beim nächsten
 * Mal vorgeschlagen wird. Fehler hier dürfen das Speichern nicht verhindern –
 * die Marke steht ja ohnehin schon in der Maschine.
 */
async function merkeNeueMarke(hersteller) {
  if (!hersteller) return;
  const vorhanden = (ctx.state.marken ?? [])
    .some((m) => m.name.toLowerCase() === hersteller.toLowerCase());
  if (vorhanden) return;

  const { data, error } = await supabase.from('marken')
    .insert({ name: hersteller }).select().single();
  if (error) return;                    // z. B. gleichzeitig von jemand anderem angelegt
  ctx.state.marken.push(data);
  ctx.state.marken.sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/** Berechnete Bewertungsfelder, die mit in die Datenbank geschrieben werden. */
function bewertungsFelder() {
  const r = bewerteMaschine(aktuelleMaschine(), bewertungsKontext(), ctx.state.settings);
  return {
    zustand_technisch: r.technisch, zustand_optisch: r.optisch,
    zustandsindex: r.index, reparaturkosten: r.reparaturkosten,
    marktwert: r.marktwert, ankaufspreis: r.ankaufspreis,
    eintauschpreis: r.eintauschpreis, verkaufspreis: r.verkaufspreis,
    preisband_von: r.preisband_von, preisband_bis: r.preisband_bis,
    berechneter_preis: r.marktwert,
    ...(r.gesamtnote != null ? { zustand_gesamt: Math.round(r.gesamtnote) } : {}),
  };
}

/**
 * Jemand anders hat zwischenzeitlich gespeichert. Wir überschreiben NICHT
 * stillschweigend, sondern lassen den Benutzer entscheiden.
 */
async function zeigeKonflikt() {
  const { data: aktuell } = await supabase.from('machines')
    .select('*').eq('id', ctx.machine.id).single();

  const wer = aktuell ? benutzerName(aktuell.created_by) : 'jemand';
  const weiter = confirm(
    'Konflikt: Diese Maschine wurde inzwischen von jemand anderem geändert ' +
    `(Version ${aktuell?.version}, deine Version ${ctx.machine.version}).\n\n` +
    'OK  = deine Eingaben verwerfen und die aktuelle Fassung laden\n' +
    'Abbrechen = deine Eingaben behalten, um sie zu kopieren'
  );

  if (weiter) {
    ctx.machine = aktuell;
    ctx.entwurf = {};
    await ladeDetails();
    zeichne();
  } else {
    $('#stamm-fehler', ctx.host).textContent =
      `Nicht gespeichert – ${wer} hat die Maschine inzwischen geändert. Kopiere deine Eingaben und lade neu.`;
  }
}

/**
 * Erfassung abbrechen: Der Entwurf wird samt Fotos und Baugruppen gelöscht.
 * Ohne das bliebe eine leere Maschine für immer unsichtbar in der Datenbank
 * liegen und würde Speicher belegen.
 */
async function verwerfeEntwurf() {
  const hatInhalt = ctx.daten.fotos.length || ctx.daten.reifen.length ||
    ctx.daten.schaeden.length || Object.keys(ctx.entwurf).length;

  if (hatInhalt && !confirm('Erfassung abbrechen? Alle Eingaben und Fotos dieser neuen Maschine gehen verloren.')) return;

  try {
    await loescheAlleFotosVonMaschine(ctx.machine.id);
    await supabase.from('machines').delete().eq('id', ctx.machine.id);
  } catch { /* Entwurf war ohnehin unsichtbar – nicht weiter stören */ }
  ctx.onClose();
}

/**
 * Löscht die Maschine mit allem, was daran hängt.
 *
 * Reihenfolge ist wichtig: ZUERST die Bilddateien aus dem Speicher, DANN die
 * Maschine. Andersherum wäre die machine_photos-Tabelle schon leer (cascade)
 * und wir wüssten nicht mehr, welche Dateien zu löschen sind – sie würden für
 * immer Speicherplatz belegen.
 */
async function loescheMaschine() {
  const titel = [ctx.machine.hersteller || ctx.machine.marke, ctx.machine.modell]
    .filter(Boolean).join(' ') || 'diese Maschine';
  const anzahlFotos = ctx.daten.fotos.length;

  if (!confirm(
    `„${titel}" wirklich löschen?\n\n` +
    'Gelöscht werden: Stammdaten, alle Baugruppen-Bewertungen, Reifen, ' +
    `Schäden, Kommentare, Aufgaben, Vergleichsmaschinen${anzahlFotos ? ` und ${anzahlFotos} Foto(s)` : ''}.\n\n` +
    'Das kann NICHT rückgängig gemacht werden.'
  )) return;

  // Der Knopf kann oben im Kopf ODER unten im Formular sitzen – beide sperren.
  const knoepfe = [$('#loeschen', ctx.host), $('#loeschen-oben', ctx.host)].filter(Boolean);
  knoepfe.forEach((k) => { k.disabled = true; });

  try {
    // 1) Bilddateien aus dem Speicher entfernen. Muss VOR dem Löschen der
    //    Maschine passieren – danach wüssten wir die Pfade nicht mehr.
    await loescheAlleFotosVonMaschine(ctx.machine.id);

    // 2) Maschine löschen – die Datenbank räumt alles Verknüpfte mit weg
    const { error, count } = await supabase.from('machines')
      .delete({ count: 'exact' }).eq('id', ctx.machine.id);
    if (error) throw error;

    // Kein Fehler, aber auch nichts gelöscht = die Sicherheitsregel hat es
    // stillschweigend verhindert. Das darf nicht unbemerkt bleiben.
    if (count === 0) {
      throw new Error('Die Maschine wurde nicht gelöscht. Das darf nur, wer sie angelegt hat, oder ein Administrator.');
    }

    ctx.onGespeichert?.();
    ctx.onClose();
  } catch (err) {
    knoepfe.forEach((k) => { k.disabled = false; });
    const text = err?.message || String(err);
    const meldung = 'Löschen fehlgeschlagen: ' + text;

    // Im Bearbeitungsmodus gibt es ein Fehlerfeld, in der Ansicht nicht.
    const feld = $('#stamm-fehler', ctx.host);
    if (feld) feld.textContent = meldung;
    else alert(meldung);
  }
}

// ----------------------------------------------------------------------------
// AUSSTATTUNG
// ----------------------------------------------------------------------------
function zeichneAusstattung(c) {
  const m = aktuelleMaschine();
  const zuschlaege = mitStandardwerten(ctx.state.settings).ausstattung_zuschlaege;
  const gewaehlt = Array.isArray(m.ausstattung) ? m.ausstattung : [];

  if (!bearbeitbar()) {
    const summe = gewaehlt.reduce((s, n) => s + (Number(zuschlaege[n]) || 0), 0);
    c.innerHTML = gewaehlt.length
      ? `<div class="ausstattung-liste">
           ${gewaehlt.map((n) => `
             <div class="aus-zeile"><span>${esc(n)}</span>
               <b>${zuschlaege[n] != null ? '+ ' + formatPreis(zuschlaege[n], 'CHF') : '–'}</b></div>`).join('')}
         </div>
         <p class="aus-summe">Summe der Zuschläge: <b>${formatPreis(summe, 'CHF')}</b></p>`
      : '<p class="leer">Keine Ausstattung erfasst.</p>';
    return;
  }

  c.innerHTML = `
    <p class="mini-hinweis">Die Liste und die Zuschläge pflegt der Administrator unter „Einstellungen".</p>
    <div class="checkgrid">
      ${Object.keys(zuschlaege).sort().map((name) => `
        <label class="check">
          <input type="checkbox" value="${esc(name)}" ${gewaehlt.includes(name) ? 'checked' : ''}>
          <span>${esc(name)}</span>
          <em>+${formatPreis(zuschlaege[name], '')}</em>
        </label>`).join('')}
    </div>
    <div class="formular-aktionen">
      <button type="button" class="btn-primary" id="aus-speichern">Ausstattung speichern</button>
      <span class="ok" id="aus-ok"></span>
    </div>`;

  const sammle = () => $$('.checkgrid input:checked', c).map((i) => i.value);

  c.addEventListener('change', () => {
    ctx.entwurf.ausstattung = sammle();
    zeichneBewertung();
  });

  $('#aus-speichern', c).addEventListener('click', async () => {
    ctx.entwurf.ausstattung = sammle();
    if (ctx.neu) { $('#aus-ok', c).textContent = 'Wird beim Anlegen mitgespeichert'; return; }
    await speichereFelder({ ausstattung: sammle(), ...bewertungsFelder() });
    $('#aus-ok', c).textContent = 'Gespeichert';
    setTimeout(() => ($('#aus-ok', c).textContent = ''), 2000);
  });
}

/** Einzelne Felder der Maschine speichern (mit Versionsprüfung). */
async function speichereFelder(felder) {
  const { data, error } = await supabase.from('machines')
    .update(felder).eq('id', ctx.machine.id).eq('version', ctx.machine.version).select();
  if (error) { alert('Fehler: ' + error.message); return false; }
  if (!data || data.length === 0) { await zeigeKonflikt(); return false; }
  ctx.machine = data[0];
  ctx.onGespeichert?.();
  return true;
}

// ----------------------------------------------------------------------------
// BAUGRUPPEN – technische Bewertung
// ----------------------------------------------------------------------------
function zeichneBaugruppen(c) {
  if (!bearbeitbar()) {
    c.innerHTML = `
      <table class="tabelle">
        <thead><tr><th></th><th>Baugruppe</th><th>Note</th><th>Bemerkungen</th><th>Schäden</th><th class="zahl">Reparatur</th></tr></thead>
        <tbody>
          ${ctx.daten.baugruppen.map((b) => `
            <tr>
              <td class="nur-breit"><span class="ampel ${b.note >= 8 ? 'gruen' : b.note >= 5 ? 'gelb' : 'rot'}"></span></td>
              <td data-label="Baugruppe" class="haupt-zelle">
                <span class="ampel nur-schmal ${b.note >= 8 ? 'gruen' : b.note >= 5 ? 'gelb' : 'rot'}"></span>
                <b>${esc(b.name)}</b>
              </td>
              <td data-label="Note" class="note-zelle">${b.note ?? '–'}/10</td>
              <td data-label="Bemerkungen">${esc(b.bemerkungen || '–')}</td>
              <td data-label="Schäden">${esc(b.schaeden || '–')}</td>
              <td data-label="Reparatur" class="zahl">${b.reparaturbedarf
                ? `<b class="warn-text">${formatPreis(b.reparaturkosten ?? 0, 'CHF')}</b>` : '–'}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
    return;
  }

  c.innerHTML = `
    <p class="mini-hinweis">Note 1 = unbrauchbar, 10 = neuwertig. Die Noten ergeben
      technischen und optischen Zustand sowie den Zustandsindex.
      <b>Lack, Karosserie und Kabine</b> zählen zum optischen Zustand, alles andere zum technischen.
      Änderungen werden automatisch gespeichert.</p>
    <div class="baugruppen">
      ${ctx.daten.baugruppen.map(baugruppeHtml).join('')}
    </div>`;

  $$('.baugruppe', c).forEach((el) => {
    const id = el.dataset.id;
    const bg = ctx.daten.baugruppen.find((b) => b.id === id);

    const noteEl = $('.bg-note', el);
    noteEl.addEventListener('input', () => {
      bg.note = parseInt(noteEl.value, 10);
      $('.bg-note-wert', el).textContent = bg.note;
      $('.ampel', el).className = 'ampel ' + (bg.note >= 8 ? 'gruen' : bg.note >= 5 ? 'gelb' : 'rot');
      zeichneBewertung();
      speichereBaugruppe(bg);
    });

    $('.bg-reparatur', el).addEventListener('change', (e) => {
      bg.reparaturbedarf = e.target.checked;
      $('.bg-kosten', el).disabled = !bg.reparaturbedarf;
      zeichneBewertung();
      speichereBaugruppe(bg);
    });

    ['bemerkungen', 'schaeden'].forEach((feld) => {
      const eingabe = $(`.bg-${feld}`, el);
      eingabe.addEventListener('input', entprellen(() => {
        bg[feld] = leerZuNull(eingabe.value);
        speichereBaugruppe(bg);
      }));
    });

    const kosten = $('.bg-kosten', el);
    kosten.addEventListener('input', entprellen(() => {
      bg.reparaturkosten = zuZahl(kosten.value) ?? 0;
      zeichneBewertung();
      speichereBaugruppe(bg);
    }, 400));
  });
}

function baugruppeHtml(b) {
  const ampel = b.note >= 8 ? 'gruen' : b.note >= 5 ? 'gelb' : 'rot';
  return `
    <div class="baugruppe" data-id="${b.id}">
      <div class="bg-kopf">
        <span class="ampel ${ampel}"></span>
        <strong>${esc(b.name)}</strong>
        <span class="bg-note-anzeige"><b class="bg-note-wert">${b.note ?? 5}</b>/10</span>
      </div>
      <input type="range" class="bg-note" min="1" max="10" value="${b.note ?? 5}">
      <div class="bg-felder">
        <label>Bemerkungen
          <input type="text" class="bg-bemerkungen" value="${esc(b.bemerkungen || '')}">
        </label>
        <label>Schäden
          <input type="text" class="bg-schaeden" value="${esc(b.schaeden || '')}">
        </label>
        <label class="check bg-rep-check">
          <input type="checkbox" class="bg-reparatur" ${b.reparaturbedarf ? 'checked' : ''}>
          <span>Reparatur nötig</span>
        </label>
        <label>Reparaturkosten (CHF)
          <input type="number" class="bg-kosten" value="${b.reparaturkosten ?? 0}" ${b.reparaturbedarf ? '' : 'disabled'}>
        </label>
      </div>
    </div>`;
}

async function speichereBaugruppe(bg) {
  await supabase.from('baugruppen').update({
    note: bg.note, bemerkungen: bg.bemerkungen, schaeden: bg.schaeden,
    reparaturbedarf: bg.reparaturbedarf, reparaturkosten: bg.reparaturkosten ?? 0,
    updated_at: new Date().toISOString(),
  }).eq('id', bg.id);
  // Bewertung der Maschine nachführen, damit die Liste stimmt
  await speichereFelder(bewertungsFelder());
}

// ----------------------------------------------------------------------------
// REIFEN
// ----------------------------------------------------------------------------
function zeichneReifen(c) {
  if (!bearbeitbar()) {
    c.innerHTML = ctx.daten.reifen.length === 0
      ? '<p class="leer">Keine Reifen erfasst.</p>'
      : `<table class="tabelle">
          <thead><tr><th>Position</th><th>Hersteller</th><th>Dimension</th><th>Profil</th>
            <th>Verschleiss</th><th>Alter</th><th>Zustand</th><th>Schäden</th></tr></thead>
          <tbody>
            ${ctx.daten.reifen.map((r) => `
              <tr>
                <td data-label="Position" class="haupt-zelle"><b>${esc(r.position)}</b></td>
                <td data-label="Hersteller">${esc(r.hersteller || '–')}</td>
                <td data-label="Dimension">${esc(r.dimension || '–')}</td>
                <td data-label="Profil">${esc(r.profil || '–')}</td>
                <td data-label="Verschleiss">${r.verschleiss != null ? r.verschleiss + ' %' : '–'}</td>
                <td data-label="Alter">${r.alter_jahre != null ? r.alter_jahre + ' J.' : '–'}</td>
                <td data-label="Zustand">${r.zustand != null ? r.zustand + '/10' : '–'}</td>
                <td data-label="Schäden">${esc(r.schaeden || '–')}</td>
              </tr>`).join('')}
          </tbody>
        </table>`;
    return;
  }

  c.innerHTML = `
    <div class="listen-aktion">
      <select id="reifen-pos">
        ${REIFEN_POSITIONEN.map((p) => `<option>${p}</option>`).join('')}
      </select>
      <button type="button" class="btn-primary" id="reifen-add">Reifen hinzufügen</button>
    </div>
    ${ctx.daten.reifen.length === 0 ? '<p class="leer">Noch keine Reifen erfasst.</p>' : `
      <div class="karten-liste">${ctx.daten.reifen.map(reifenHtml).join('')}</div>`}`;

  $('#reifen-add', c).addEventListener('click', async () => {
    const { data, error } = await supabase.from('reifen').insert({
      machine_id: ctx.machine.id, position: $('#reifen-pos', c).value,
      verschleiss: 0, zustand: 5,
    }).select().single();
    if (error) { alert('Fehler: ' + error.message); return; }
    ctx.daten.reifen.push(data);
    zeichne();
  });

  $$('.reifen-karte', c).forEach((el) => {
    const r = ctx.daten.reifen.find((x) => x.id === el.dataset.id);
    const speichern = entprellen(async () => {
      await supabase.from('reifen').update({
        hersteller: r.hersteller, dimension: r.dimension, profil: r.profil,
        verschleiss: r.verschleiss, alter_jahre: r.alter_jahre,
        zustand: r.zustand, schaeden: r.schaeden,
      }).eq('id', r.id);
      await speichereFelder(bewertungsFelder());
    }, 500);

    $$('[data-feld]', el).forEach((eingabe) => {
      eingabe.addEventListener('input', () => {
        const feld = eingabe.dataset.feld;
        r[feld] = ['verschleiss', 'alter_jahre', 'zustand'].includes(feld)
          ? zuGanzzahl(eingabe.value) : leerZuNull(eingabe.value);
        if (feld === 'verschleiss') $('.rf-verschleiss-wert', el).textContent = r.verschleiss + ' %';
        if (feld === 'zustand') $('.rf-zustand-wert', el).textContent = r.zustand;
        zeichneBewertung();
        speichern();
      });
    });

    $('.rf-loeschen', el).addEventListener('click', async () => {
      if (!confirm(`Reifen „${r.position}" löschen?`)) return;
      await supabase.from('reifen').delete().eq('id', r.id);
      ctx.daten.reifen = ctx.daten.reifen.filter((x) => x.id !== r.id);
      await speichereFelder(bewertungsFelder());
      zeichne();
    });
  });
}

function reifenHtml(r) {
  return `
    <div class="karte-block reifen-karte" data-id="${r.id}">
      <div class="block-kopf">
        <strong>${esc(r.position)}</strong>
        <button type="button" class="btn-x rf-loeschen" title="Löschen">×</button>
      </div>
      <div class="grid">
        <label>Hersteller <input type="text" data-feld="hersteller" value="${esc(r.hersteller || '')}"></label>
        <label>Dimension <input type="text" data-feld="dimension" placeholder="z. B. 540/65 R28" value="${esc(r.dimension || '')}"></label>
        <label>Profil <input type="text" data-feld="profil" value="${esc(r.profil || '')}"></label>
        <label>Alter (Jahre) <input type="number" data-feld="alter_jahre" value="${r.alter_jahre ?? ''}"></label>
      </div>
      <div class="grid">
        <label>Verschleiss: <b class="rf-verschleiss-wert">${r.verschleiss ?? 0} %</b> abgefahren
          <input type="range" data-feld="verschleiss" min="0" max="100" value="${r.verschleiss ?? 0}">
        </label>
        <label>Zustand: <b class="rf-zustand-wert">${r.zustand ?? 5}</b>/10
          <input type="range" data-feld="zustand" min="1" max="10" value="${r.zustand ?? 5}">
        </label>
      </div>
      <label>Schäden <input type="text" data-feld="schaeden" value="${esc(r.schaeden || '')}"></label>
    </div>`;
}

// ----------------------------------------------------------------------------
// SCHÄDEN
// ----------------------------------------------------------------------------
function zeichneSchaeden(c) {
  if (!bearbeitbar()) {
    const summe = ctx.daten.schaeden.reduce((s, x) => s + (Number(x.kostenschaetzung) || 0), 0);
    c.innerHTML = ctx.daten.schaeden.length === 0
      ? '<p class="leer">Keine Schäden erfasst.</p>'
      : `<div class="karten-liste">
          ${ctx.daten.schaeden.map((s) => `
            <div class="karte-block schaden-karte prio-${esc(s.prioritaet)}">
              <div class="block-kopf">
                <strong>${esc(s.titel)}</strong>
                <span class="prio-tag prio-${esc(s.prioritaet)}">Priorität ${esc(s.prioritaet)}</span>
              </div>
              <dl class="datenliste">
                ${s.beschreibung ? `<div><dt>Beschreibung</dt><dd>${esc(s.beschreibung)}</dd></div>` : ''}
                ${s.ursache ? `<div><dt>Ursache</dt><dd>${esc(s.ursache)}</dd></div>` : ''}
                ${s.reparaturempfehlung ? `<div><dt>Empfehlung</dt><dd>${esc(s.reparaturempfehlung)}</dd></div>` : ''}
                <div><dt>Kostenschätzung</dt><dd><b>${formatPreis(s.kostenschaetzung ?? 0, 'CHF')}</b></dd></div>
              </dl>
            </div>`).join('')}
        </div>
        <p class="aus-summe">Summe der Kostenschätzungen: <b>${formatPreis(summe, 'CHF')}</b></p>`;
    return;
  }

  c.innerHTML = `
    <form id="schaden-form" class="listen-aktion">
      <input type="text" id="schaden-titel" placeholder="Neuer Schaden (kurze Bezeichnung)" required>
      <select id="schaden-prio">${PRIORITAETEN.map((p) => `<option value="${p}" ${p === 'mittel' ? 'selected' : ''}>Priorität ${p}</option>`).join('')}</select>
      <button type="submit" class="btn-primary">Hinzufügen</button>
    </form>
    ${ctx.daten.schaeden.length === 0 ? '<p class="leer">Keine Schäden erfasst.</p>' : `
      <div class="karten-liste">${ctx.daten.schaeden.map(schadenHtml).join('')}</div>`}`;

  $('#schaden-form', c).addEventListener('submit', async (e) => {
    e.preventDefault();
    const { data, error } = await supabase.from('schaeden').insert({
      machine_id: ctx.machine.id,
      titel: $('#schaden-titel', c).value.trim(),
      prioritaet: $('#schaden-prio', c).value,
      created_by: ctx.state.user.id,
    }).select().single();
    if (error) { alert('Fehler: ' + error.message); return; }
    ctx.daten.schaeden.push(data);
    zeichne();
  });

  $$('.schaden-karte', c).forEach((el) => {
    const s = ctx.daten.schaeden.find((x) => x.id === el.dataset.id);
    const speichern = entprellen(async () => {
      await supabase.from('schaeden').update({
        titel: s.titel, beschreibung: s.beschreibung, ursache: s.ursache,
        prioritaet: s.prioritaet, reparaturempfehlung: s.reparaturempfehlung,
        kostenschaetzung: s.kostenschaetzung ?? 0,
      }).eq('id', s.id);
      await speichereFelder(bewertungsFelder());
    }, 500);

    $$('[data-feld]', el).forEach((eingabe) => {
      eingabe.addEventListener('input', () => {
        const feld = eingabe.dataset.feld;
        s[feld] = feld === 'kostenschaetzung' ? (zuZahl(eingabe.value) ?? 0) : leerZuNull(eingabe.value);
        if (feld === 'kostenschaetzung' || feld === 'prioritaet') zeichneBewertung();
        speichern();
      });
      eingabe.addEventListener('change', () => {
        if (eingabe.dataset.feld === 'prioritaet') { s.prioritaet = eingabe.value; zeichne(); speichern(); }
      });
    });

    $('.sch-loeschen', el).addEventListener('click', async () => {
      if (!confirm(`Schaden „${s.titel}" löschen?`)) return;
      await supabase.from('schaeden').delete().eq('id', s.id);
      ctx.daten.schaeden = ctx.daten.schaeden.filter((x) => x.id !== s.id);
      await speichereFelder(bewertungsFelder());
      zeichne();
    });
  });
}

function schadenHtml(s) {
  return `
    <div class="karte-block schaden-karte prio-${esc(s.prioritaet)}" data-id="${s.id}">
      <div class="block-kopf">
        <input type="text" class="titel-feld" data-feld="titel" value="${esc(s.titel)}">
        <select data-feld="prioritaet" class="prio-wahl">
          ${PRIORITAETEN.map((p) => `<option value="${p}" ${s.prioritaet === p ? 'selected' : ''}>${p}</option>`).join('')}
        </select>
        <button type="button" class="btn-x sch-loeschen" title="Löschen">×</button>
      </div>
      <div class="grid">
        <label>Beschreibung <input type="text" data-feld="beschreibung" value="${esc(s.beschreibung || '')}"></label>
        <label>Ursache <input type="text" data-feld="ursache" value="${esc(s.ursache || '')}"></label>
        <label>Reparaturempfehlung <input type="text" data-feld="reparaturempfehlung" value="${esc(s.reparaturempfehlung || '')}"></label>
        <label>Kostenschätzung (CHF) <input type="number" data-feld="kostenschaetzung" value="${s.kostenschaetzung ?? 0}"></label>
      </div>
    </div>`;
}

// ----------------------------------------------------------------------------
// FOTOS
// ----------------------------------------------------------------------------
function zeichneFotos(c) {
  // Zwei getrennte Eingaben:
  //   - mit capture="environment" -> öffnet direkt die Kamera
  //   - ohne capture              -> öffnet die Fotomediathek / Dateien
  // Ein einzelnes Feld MIT capture würde die Mediathek auf dem Handy komplett
  // verstecken – man könnte dann nur noch live fotografieren.
  // Nur ansehen: Galerie ohne Hochlade-Bereich
  if (!bearbeitbar()) {
    c.innerHTML = ctx.daten.fotos.length
      ? `<div class="foto-galerie">${ctx.daten.fotos.map((f) => fotoHtml(f, false)).join('')}</div>`
      : '<p class="leer">Keine Fotos vorhanden.</p>';
    bindeFotoLightbox(c);
    return;
  }

  c.innerHTML = `
    <div class="foto-upload">
      <label>Kategorie
        <select id="foto-kategorie">${FOTO_KATEGORIEN.map((k) => `<option>${k}</option>`).join('')}</select>
      </label>

      <div class="foto-knoepfe">
        <button type="button" class="btn-primary" id="foto-kamera-btn">${ICON_KAMERA}<span>Foto aufnehmen</span></button>
        <button type="button" class="btn-sekundaer" id="foto-galerie-btn">${ICON_BILDER}<span>Aus Fotos wählen</span></button>
      </div>

      <input type="file" id="foto-kamera" accept="image/*" capture="environment" hidden>
      <input type="file" id="foto-datei" accept="image/*" multiple hidden>
    </div>
    <p class="mini-hinweis" id="foto-status">Fotos werden vor dem Hochladen automatisch verkleinert.
      Mehrere Bilder auf einmal auswählen ist möglich.</p>
    <div class="foto-galerie" id="foto-galerie">${galerieInhalt()}</div>`;

  $('#foto-kamera-btn', c).addEventListener('click', () => $('#foto-kamera', c).click());
  $('#foto-galerie-btn', c).addEventListener('click', () => $('#foto-datei', c).click());

  ['#foto-kamera', '#foto-datei'].forEach((sel) =>
    $(sel, c).addEventListener('change', (e) => {
      handleFotos(e.target.files, c);
      e.target.value = '';   // damit dasselbe Bild erneut gewählt werden kann
    })
  );

  bindeGalerieAktionen(c);
}

function galerieInhalt() {
  return ctx.daten.fotos.map((f) => fotoHtml(f, true)).join('')
    || '<p class="mini-hinweis">Noch keine Fotos.</p>';
}

function bindeGalerieAktionen(c) {
  bindeFotoLightbox(c);

  $$('.foto-x[data-foto]', c).forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Foto endgültig löschen?')) return;
      const foto = ctx.daten.fotos.find((f) => f.id === b.dataset.foto);
      try {
        await loescheFoto(foto);
        ctx.daten.fotos = ctx.daten.fotos.filter((f) => f.id !== foto.id);
        ctx.onGespeichert?.();     // Vorschaubild der Liste nachführen
        zeichne();
      } catch (err) {
        $('#foto-status', c).textContent = 'Foto konnte nicht gelöscht werden: ' + (err.message || err);
      }
    })
  );
}

/**
 * Ein Foto in der Galerie.
 * @param {object} f            Zeile aus machine_photos
 * @param {boolean} mitLoeschen Löschknopf anzeigen (nur im Bearbeitungsmodus)
 */
function fotoHtml(f, mitLoeschen = true) {
  const url = fotoUrl(f.storage_path);
  return `
    <figure class="foto">
      <img src="${url}" alt="${esc(f.kategorie)}" loading="lazy"
           data-gross="${url}" data-titel="${esc(f.kategorie)}">
      <figcaption>${esc(f.kategorie)}</figcaption>
      ${mitLoeschen ? `<button type="button" class="foto-x" data-foto="${f.id}">×</button>` : ''}
    </figure>`;
}

/** Klick auf ein Foto zeigt es gross – sonst erkennt man auf 90 px nichts. */
function bindeFotoLightbox(wurzel) {
  $$('.foto img[data-gross]', wurzel).forEach((img) =>
    img.addEventListener('click', () => {
      const box = document.createElement('div');
      box.className = 'lightbox';
      box.innerHTML = `
        <button type="button" class="lightbox-x" aria-label="Schliessen">×</button>
        <img src="${img.dataset.gross}" alt="${esc(img.dataset.titel || '')}">
        <span class="lightbox-titel">${esc(img.dataset.titel || '')}</span>`;
      const zu = () => box.remove();
      box.addEventListener('click', (e) => { if (e.target !== box.querySelector('img')) zu(); });
      document.addEventListener('keydown', function esc2(e) {
        if (e.key === 'Escape') { zu(); document.removeEventListener('keydown', esc2); }
      });
      document.body.appendChild(box);
    })
  );
}

/**
 * Fotos hochladen. Funktioniert auch bei einer brandneuen Maschine, weil der
 * Entwurf bereits eine ID in der Datenbank hat.
 */
async function handleFotos(fileList, c) {
  const dateien = [...fileList];
  if (dateien.length === 0) return;
  const kategorie = $('#foto-kategorie', c).value;
  const status = $('#foto-status', c);

  status.textContent = `Lade ${dateien.length} Foto(s) hoch …`;
  try {
    for (const datei of dateien) {
      const pfad = await ladeFotoHoch(datei, ctx.machine.id, ctx.state.user.id);
      const { data, error } = await supabase.from('machine_photos').insert({
        machine_id: ctx.machine.id, storage_path: pfad, kategorie,
        created_by: ctx.state.user.id,
      }).select().single();
      if (error) throw error;
      if (data) ctx.daten.fotos.push(data);
    }
    // Damit das Vorschaubild auf der Listenkarte sofort erscheint
    ctx.onGespeichert?.();
    zeichne();
  } catch (err) {
    status.textContent = 'Fehler beim Hochladen: ' + (err.message || err);
  }
}

// ----------------------------------------------------------------------------
// KOMMENTARE
// ----------------------------------------------------------------------------
function zeichneKommentare(c) {
  c.innerHTML = `
    <form id="komm-form">
      <textarea id="komm-text" rows="2" placeholder="Kommentar schreiben …" required></textarea>
      <button type="submit" class="btn-primary">Kommentar hinzufügen</button>
    </form>
    <div class="kommentare">
      ${ctx.daten.kommentare.length === 0 ? '<p class="leer">Noch keine Kommentare.</p>'
        : ctx.daten.kommentare.map((k) => `
          <div class="kommentar">
            <div class="komm-kopf">
              <b>${esc(benutzerName(k.created_by))}</b>
              <span class="mini-hinweis">${datumZeit(k.created_at)}</span>
              ${k.created_by === ctx.state.user.id
                ? `<button type="button" class="btn-x komm-x" data-id="${k.id}">×</button>` : ''}
            </div>
            <p>${esc(k.text)}</p>
          </div>`).join('')}
    </div>`;

  $('#komm-form', c).addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = $('#komm-text', c).value.trim();
    if (!text) return;
    const { data, error } = await supabase.from('kommentare').insert({
      machine_id: ctx.machine.id, text, created_by: ctx.state.user.id,
    }).select().single();
    if (error) { alert('Fehler: ' + error.message); return; }
    ctx.daten.kommentare.unshift(data);
    zeichne();
  });

  $$('.komm-x', c).forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Kommentar löschen?')) return;
      await supabase.from('kommentare').delete().eq('id', b.dataset.id);
      ctx.daten.kommentare = ctx.daten.kommentare.filter((k) => k.id !== b.dataset.id);
      zeichne();
    })
  );
}

// ----------------------------------------------------------------------------
// AUFGABEN
// ----------------------------------------------------------------------------
function zeichneAufgaben(c) {
  c.innerHTML = `
    <form id="auf-form" class="listen-aktion">
      <input type="text" id="auf-titel" placeholder="Neue Aufgabe" required>
      <select id="auf-wer">
        <option value="">niemandem zugewiesen</option>
        ${ctx.profile.map((p) => `<option value="${p.id}">${esc(p.full_name || p.email)}</option>`).join('')}
      </select>
      <input type="date" id="auf-datum" title="Fällig am">
      <button type="submit" class="btn-primary">Hinzufügen</button>
    </form>
    ${ctx.daten.aufgaben.length === 0 ? '<p class="leer">Keine Aufgaben.</p>' : `
      <table class="tabelle">
        <thead><tr><th></th><th>Aufgabe</th><th>Zugewiesen</th><th>Fällig</th><th></th></tr></thead>
        <tbody>
          ${ctx.daten.aufgaben.map((a) => `
            <tr class="${a.erledigt ? 'erledigt' : ''}">
              <td class="haupt-zelle">
                <input type="checkbox" class="auf-check" data-id="${a.id}" ${a.erledigt ? 'checked' : ''}>
                <span class="nur-schmal">${esc(a.titel)}</span>
              </td>
              <td class="nur-breit">${esc(a.titel)}</td>
              <td data-label="Zugewiesen">${a.zugewiesen_an ? esc(benutzerName(a.zugewiesen_an)) : '<small>–</small>'}</td>
              <td data-label="Fällig">${a.faellig_am ? `<small class="${!a.erledigt && new Date(a.faellig_am) < new Date() ? 'ueberfaellig' : ''}">${datum(a.faellig_am)}</small>` : '<small>–</small>'}</td>
              <td class="zeile-loeschen"><button type="button" class="btn-x auf-x" data-id="${a.id}">×</button></td>
            </tr>`).join('')}
        </tbody>
      </table>`}`;

  $('#auf-form', c).addEventListener('submit', async (e) => {
    e.preventDefault();
    const { data, error } = await supabase.from('aufgaben').insert({
      machine_id: ctx.machine.id,
      titel: $('#auf-titel', c).value.trim(),
      zugewiesen_an: leerZuNull($('#auf-wer', c).value),
      faellig_am: leerZuNull($('#auf-datum', c).value),
      created_by: ctx.state.user.id,
    }).select().single();
    if (error) { alert('Fehler: ' + error.message); return; }
    ctx.daten.aufgaben.push(data);
    zeichne();
  });

  $$('.auf-check', c).forEach((cb) =>
    cb.addEventListener('change', async () => {
      const a = ctx.daten.aufgaben.find((x) => x.id === cb.dataset.id);
      a.erledigt = cb.checked;
      a.erledigt_am = cb.checked ? new Date().toISOString() : null;
      await supabase.from('aufgaben')
        .update({ erledigt: a.erledigt, erledigt_am: a.erledigt_am }).eq('id', a.id);
      zeichne();
    })
  );

  $$('.auf-x', c).forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Aufgabe löschen?')) return;
      await supabase.from('aufgaben').delete().eq('id', b.dataset.id);
      ctx.daten.aufgaben = ctx.daten.aufgaben.filter((a) => a.id !== b.dataset.id);
      zeichne();
    })
  );
}

// ----------------------------------------------------------------------------
// MARKTVERGLEICH
// ----------------------------------------------------------------------------
function zeichneVergleich(c) {
  const m = aktuelleMaschine();
  const mitV = ctx.daten.vergleiche.map((v) => ({ ...v, _v: vergleichbarkeit(m, v) }))
    .sort((a, b) => b._v - a._v);

  const gewichtet = mitV.filter((v) => v.angebotspreis > 0);
  const schnitt = gewichtet.length
    ? Math.round(gewichtet.reduce((s, v) => s + Number(v.angebotspreis) * v._v, 0) /
                 gewichtet.reduce((s, v) => s + v._v, 0))
    : null;

  c.innerHTML = `
    <div class="hinweis-kasten">
      <b>Wichtig:</b> Vergleichspreise werden <b>nicht automatisch</b> aus Portalen geholt –
      das ist nach deren Nutzungsbedingungen nicht zulässig. Trage Vergleichsmaschinen
      selbst ein (oder später über eine lizenzierte Schnittstelle).
      Die <b>Vergleichbarkeit</b> berechnet die App automatisch aus Hersteller, Modell,
      Typ, Baujahr, Betriebsstunden und Zustand.
    </div>

    ${schnitt ? `<div class="vergleich-schnitt">
      Gewichteter Marktschnitt aus ${gewichtet.length} Angebot(en):
      <b>${formatPreis(schnitt, ctx.state.settings?.waehrung)}</b>
      <span class="mini-hinweis">(je ähnlicher die Maschine, desto stärker zählt ihr Preis)</span>
    </div>` : ''}

    <form id="vgl-form" class="listen-aktion">
      <input type="text" id="vgl-modell" placeholder="Modell der Vergleichsmaschine" required>
      <input type="number" id="vgl-preis" placeholder="Angebotspreis CHF">
      <button type="submit" class="btn-primary">Hinzufügen</button>
    </form>

    ${mitV.length === 0 ? '<p class="leer">Noch keine Vergleichsmaschinen erfasst.</p>' : `
      <div class="karten-liste">${mitV.map(vergleichHtml).join('')}</div>`}`;

  $('#vgl-form', c).addEventListener('submit', async (e) => {
    e.preventDefault();
    const { data, error } = await supabase.from('vergleichsmaschinen').insert({
      machine_id: ctx.machine.id,
      hersteller: m.hersteller, typ: m.typ,
      modell: $('#vgl-modell', c).value.trim(),
      angebotspreis: zuZahl($('#vgl-preis', c).value),
      stand_am: new Date().toISOString().slice(0, 10),
      created_by: ctx.state.user.id,
    }).select().single();
    if (error) { alert('Fehler: ' + error.message); return; }
    ctx.daten.vergleiche.push(data);
    zeichne();
  });

  $$('.vgl-karte', c).forEach((el) => {
    const v = ctx.daten.vergleiche.find((x) => x.id === el.dataset.id);
    const speichern = entprellen(async () => {
      await supabase.from('vergleichsmaschinen').update({
        hersteller: v.hersteller, modell: v.modell, typ: v.typ, baujahr: v.baujahr,
        betriebsstunden: v.betriebsstunden, ausstattung: v.ausstattung, region: v.region,
        zustand: v.zustand, angebotspreis: v.angebotspreis, quelle: v.quelle,
        quelle_url: v.quelle_url, stand_am: v.stand_am,
        vergleichbarkeit: vergleichbarkeit(aktuelleMaschine(), v),
      }).eq('id', v.id);
    }, 500);

    $$('[data-feld]', el).forEach((eingabe) => {
      eingabe.addEventListener('input', () => {
        const feld = eingabe.dataset.feld;
        v[feld] = ['baujahr', 'betriebsstunden', 'zustand'].includes(feld) ? zuGanzzahl(eingabe.value)
          : feld === 'angebotspreis' ? zuZahl(eingabe.value)
          : leerZuNull(eingabe.value);
        speichern();
      });
    });

    $('.vgl-loeschen', el).addEventListener('click', async () => {
      if (!confirm('Vergleichsmaschine löschen?')) return;
      await supabase.from('vergleichsmaschinen').delete().eq('id', v.id);
      ctx.daten.vergleiche = ctx.daten.vergleiche.filter((x) => x.id !== v.id);
      zeichne();
    });
  });
}

function vergleichHtml(v) {
  return `
    <div class="karte-block vgl-karte" data-id="${v.id}">
      <div class="block-kopf">
        <strong>${esc([v.hersteller, v.modell].filter(Boolean).join(' ') || 'Vergleichsmaschine')}</strong>
        <span class="vgl-badge" title="Vergleichbarkeit">${v._v} % ähnlich</span>
        <button type="button" class="btn-x vgl-loeschen" title="Löschen">×</button>
      </div>
      <div class="grid">
        <label>Hersteller <input type="text" data-feld="hersteller" value="${esc(v.hersteller || '')}"></label>
        <label>Modell <input type="text" data-feld="modell" value="${esc(v.modell || '')}"></label>
        <label>Typ <input type="text" data-feld="typ" value="${esc(v.typ || '')}"></label>
        <label>Baujahr <input type="number" data-feld="baujahr" value="${v.baujahr ?? ''}"></label>
        <label>Betriebsstunden <input type="number" data-feld="betriebsstunden" value="${v.betriebsstunden ?? ''}"></label>
        <label>Zustand (1–10) <input type="number" min="1" max="10" data-feld="zustand" value="${v.zustand ?? ''}"></label>
        <label>Angebotspreis (CHF) <input type="number" data-feld="angebotspreis" value="${v.angebotspreis ?? ''}"></label>
        <label>Region <input type="text" data-feld="region" value="${esc(v.region || '')}"></label>
        <label>Quelle <input type="text" data-feld="quelle" placeholder="z. B. Händler, Inserat" value="${esc(v.quelle || '')}"></label>
        <label>Stand am <input type="date" data-feld="stand_am" value="${v.stand_am ?? ''}"></label>
      </div>
      <label>Ausstattung <input type="text" data-feld="ausstattung" value="${esc(v.ausstattung || '')}"></label>
    </div>`;
}

// ----------------------------------------------------------------------------
// EXCEL-EXPORT
// ----------------------------------------------------------------------------
async function excelExportieren() {
  const knopf = $('#excel-btn', ctx.host);
  const urText = knopf.innerHTML;
  const melde = (text) => {
    knopf.innerHTML = text ? `<span>${esc(text)}</span>` : urText;
  };

  knopf.disabled = true;
  try {
    // Bibliothek erst jetzt laden – sie ist gross und wird selten gebraucht.
    const { exportiereMaschine } = await import('./excel.js');
    await exportiereMaschine(
      aktuelleMaschine(),
      ctx.daten,
      {
        settings: ctx.state.settings,
        kategorie: aktuelleKategorie(),
        benutzerName,
      },
      melde
    );
  } catch (err) {
    alert('Excel-Export fehlgeschlagen: ' + (err.message || err));
  } finally {
    knopf.disabled = false;
    knopf.innerHTML = urText;
  }
}

// ----------------------------------------------------------------------------
// VERLAUF (Audit-Log)
// ----------------------------------------------------------------------------
function zeichneVerlauf(c) {
  c.innerHTML = `
    <p class="mini-hinweis">Lückenloser Änderungsverlauf. Einträge werden automatisch
      geschrieben und können von niemandem geändert oder gelöscht werden – auch nicht
      vom Administrator.</p>
    ${ctx.daten.verlauf.length === 0 ? '<p class="leer">Noch keine Einträge.</p>' : `
      <table class="tabelle">
        <thead><tr><th>Wann</th><th>Wer</th><th>Was</th><th>Von</th><th>Auf</th></tr></thead>
        <tbody>
          ${ctx.daten.verlauf.map((v) => `
            <tr>
              <td data-label="Wann" class="haupt-zelle"><small>${datumZeit(v.created_at)}</small></td>
              <td data-label="Wer"><small>${esc(benutzerName(v.benutzer))}</small></td>
              <td data-label="Was">${v.aktion === 'INSERT' ? '<b>angelegt</b>'
                  : v.aktion === 'DELETE' ? '<b>gelöscht</b>'
                  : esc(v.feld || '')}</td>
              <td data-label="Von"><small>${esc(kuerze(v.alt_wert))}</small></td>
              <td data-label="Auf"><small>${esc(kuerze(v.neu_wert))}</small></td>
            </tr>`).join('')}
        </tbody>
      </table>`}`;
}

function kuerze(v, max = 40) {
  if (v == null || v === '') return '–';
  return v.length > max ? v.slice(0, max) + '…' : v;
}

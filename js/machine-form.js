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

const REIFEN_POSITIONEN = [
  'Vorne links', 'Vorne rechts', 'Hinten links', 'Hinten rechts',
  'Zwillingsrad links', 'Zwillingsrad rechts', 'Ersatzrad',
];
const PRIORITAETEN = ['hoch', 'mittel', 'tief'];

// Modul-eigener Zustand der geöffneten Maschine
let ctx = null;

/**
 * Zeichnet die Detailansicht.
 * @param {HTMLElement} host      Ziel-Element
 * @param {object} optionen       { machine, state, onClose, onGespeichert }
 */
export async function renderMaschine(host, optionen) {
  ctx = {
    host,
    state: optionen.state,
    machine: optionen.machine ? { ...optionen.machine } : null,
    neu: !optionen.machine,
    onClose: optionen.onClose,
    onGespeichert: optionen.onGespeichert,
    tab: 'stammdaten',
    daten: { baugruppen: [], reifen: [], schaeden: [], fotos: [], kommentare: [], aufgaben: [], vergleiche: [], verlauf: [] },
    profile: [],
    pendingFotos: [],
    entwurf: {},          // Stammdaten-Eingaben, solange nicht gespeichert
  };

  if (!ctx.neu) await ladeDetails();
  zeichne();
}

// ============================================================================
// Daten laden
// ============================================================================
async function ladeDetails() {
  const id = ctx.machine.id;
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

  // Bei einer neuen Maschine gibt es die Unterbereiche noch nicht – sie hängen
  // an einer Maschinen-ID, die erst beim Speichern entsteht.
  const tabs = ctx.neu
    ? [['stammdaten', 'Stammdaten'], ['ausstattung', 'Ausstattung'], ['fotos', 'Fotos']]
    : [
        ['stammdaten', 'Stammdaten'], ['ausstattung', 'Ausstattung'],
        ['baugruppen', `Baugruppen (${bewerteteBaugruppen()}/${ctx.daten.baugruppen.length})`],
        ['reifen', `Reifen (${ctx.daten.reifen.length})`],
        ['schaeden', `Schäden (${ctx.daten.schaeden.length})`],
        ['fotos', `Fotos (${ctx.daten.fotos.length})`],
        ['kommentare', `Kommentare (${ctx.daten.kommentare.length})`],
        ['aufgaben', `Aufgaben (${offeneAufgaben()})`],
        ['vergleich', `Marktvergleich (${ctx.daten.vergleiche.length})`],
        ['verlauf', 'Verlauf'],
      ];

  ctx.host.innerHTML = `
    <div class="detail-kopf">
      <div>
        <button class="btn-klein" id="zurueck">← Zurück zur Liste</button>
        <h2>${esc(titel)}</h2>
        ${ctx.neu ? '' : `<p class="mini-hinweis">Zuletzt geändert ${datumZeit(ctx.machine.updated_at)} · Version ${ctx.machine.version ?? 1}</p>`}
      </div>
      <div id="bewertung-panel"></div>
    </div>

    <nav class="untertabs">
      ${tabs.map(([id, label]) =>
        `<button data-utab="${id}" class="${ctx.tab === id ? 'aktiv' : ''}">${esc(label)}</button>`).join('')}
    </nav>

    <div id="utab-inhalt" class="formular"></div>`;

  $('#zurueck', ctx.host).addEventListener('click', () => ctx.onClose());
  $$('[data-utab]', ctx.host).forEach((b) =>
    b.addEventListener('click', () => { ctx.tab = b.dataset.utab; zeichne(); })
  );

  zeichneBewertung();
  zeichneInhalt();
}

const bewerteteBaugruppen = () => ctx.daten.baugruppen.filter((b) => b.note != null).length;
const offeneAufgaben = () => ctx.daten.aufgaben.filter((a) => !a.erledigt).length;

/** Stammdaten: gespeicherte Werte + noch nicht gespeicherte Eingaben. */
function aktuelleMaschine() {
  return { ...(ctx.machine ?? {}), ...ctx.entwurf };
}

// ============================================================================
// Bewertungs-Panel (immer sichtbar, rechnet live mit)
// ============================================================================
function zeichneBewertung() {
  const r = bewerteMaschine(aktuelleMaschine(), ctx.daten, ctx.state.settings);
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
  const m = aktuelleMaschine();
  const f = (name, label, typ = 'text') => `
    <label>${label}
      <input type="${typ}" name="${name}" value="${m[name] != null ? esc(String(m[name])) : ''}">
    </label>`;

  c.innerHTML = `
    <form id="stamm-form">
      <fieldset><legend>Identifikation</legend>
        <div class="grid">
          ${f('hersteller', 'Hersteller')}
          ${f('marke', 'Marke')}
          ${f('modell', 'Modell')}
          ${f('typ', 'Typ')}
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

      ${ctx.neu ? `
        <fieldset><legend>Zustand (vorläufig)</legend>
          <label>Gesamtzustand: <b id="z-wert">${m.zustand_gesamt ?? 5}</b> / 10
            <input type="range" name="zustand_gesamt" min="1" max="10" value="${m.zustand_gesamt ?? 5}" id="z-slider">
          </label>
          <p class="mini-hinweis">Nach dem Anlegen wird der Zustand aus den einzelnen
            Baugruppen berechnet und ersetzt diesen Wert.</p>
        </fieldset>` : ''}

      <div class="formular-aktionen">
        <button type="submit" class="btn-primary btn-gross">${ctx.neu ? 'Maschine anlegen' : 'Stammdaten speichern'}</button>
        ${ctx.neu ? '' : '<button type="button" id="loeschen" class="btn-danger">Maschine löschen</button>'}
        <span class="fehler" id="stamm-fehler"></span>
        <span class="ok" id="stamm-ok"></span>
      </div>
    </form>`;

  const form = $('#stamm-form', c);

  // Eingaben live in den Entwurf übernehmen -> Bewertungs-Panel rechnet mit
  form.addEventListener('input', () => {
    Object.assign(ctx.entwurf, stammdatenAusFormular(form));
    if ($('#z-slider', c)) $('#z-wert', c).textContent = $('#z-slider', c).value;
    zeichneBewertung();
  });

  form.addEventListener('submit', (e) => { e.preventDefault(); speichereStammdaten(form); });
  if (!ctx.neu) $('#loeschen', c).addEventListener('click', loescheMaschine);
}

function stammdatenAusFormular(form) {
  const g = (n) => form.elements[n]?.value ?? '';
  return {
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

  try {
    if (ctx.neu) {
      daten.created_by = ctx.state.user.id;
      const { data, error } = await supabase.from('machines').insert(daten).select().single();
      if (error) throw error;
      ctx.machine = data;
      ctx.neu = false;
      ctx.entwurf = {};
      await ladePendingFotos(data.id);
      await ladeDetails();          // Baugruppen wurden per Trigger angelegt
      ctx.onGespeichert?.();
      zeichne();
      return;
    }

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
    ctx.entwurf = {};
    ok.textContent = 'Gespeichert';
    setTimeout(() => (ok.textContent = ''), 2000);
    ctx.onGespeichert?.();
    zeichne();
  } catch (err) {
    fehler.textContent = 'Speichern fehlgeschlagen: ' + (err.message || err);
  }
}

/** Berechnete Bewertungsfelder, die mit in die Datenbank geschrieben werden. */
function bewertungsFelder() {
  const r = bewerteMaschine(aktuelleMaschine(), ctx.daten, ctx.state.settings);
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

  const knopf = $('#loeschen', ctx.host);
  if (knopf) { knopf.disabled = true; knopf.textContent = 'Lösche …'; }

  try {
    // 1) Bilddateien aus dem Speicher entfernen
    await loescheAlleFotosVonMaschine(ctx.machine.id);

    // 2) Maschine löschen – die Datenbank räumt alles Verknüpfte mit weg
    const { error } = await supabase.from('machines').delete().eq('id', ctx.machine.id);
    if (error) throw error;

    ctx.onGespeichert?.();
    ctx.onClose();
  } catch (err) {
    if (knopf) { knopf.disabled = false; knopf.textContent = 'Maschine löschen'; }
    const text = err?.message || String(err);
    $('#stamm-fehler', ctx.host).textContent =
      'Löschen fehlgeschlagen: ' + text +
      (/row-level security|not authorized|violates/i.test(text)
        ? ' – Löschen darf nur, wer die Maschine angelegt hat, oder ein Administrator.'
        : '');
  }
}

// ----------------------------------------------------------------------------
// AUSSTATTUNG
// ----------------------------------------------------------------------------
function zeichneAusstattung(c) {
  const m = aktuelleMaschine();
  const zuschlaege = mitStandardwerten(ctx.state.settings).ausstattung_zuschlaege;
  const gewaehlt = Array.isArray(m.ausstattung) ? m.ausstattung : [];

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
  c.innerHTML = `
    <div class="foto-upload">
      <label>Kategorie
        <select id="foto-kategorie">${FOTO_KATEGORIEN.map((k) => `<option>${k}</option>`).join('')}</select>
      </label>

      <div class="foto-knoepfe">
        <button type="button" class="btn-primary" id="foto-kamera-btn">📷 Foto aufnehmen</button>
        <button type="button" class="btn-sekundaer" id="foto-galerie-btn">🖼️ Aus Fotos wählen</button>
      </div>

      <input type="file" id="foto-kamera" accept="image/*" capture="environment" hidden>
      <input type="file" id="foto-datei" accept="image/*" multiple hidden>
    </div>
    <p class="mini-hinweis" id="foto-status">Fotos werden vor dem Hochladen automatisch verkleinert.
      Mehrere Bilder auf einmal auswählen ist möglich.</p>
    <div class="foto-galerie" id="foto-galerie">
      ${ctx.neu ? '' : ctx.daten.fotos.map(fotoHtml).join('')}
    </div>`;

  $('#foto-kamera-btn', c).addEventListener('click', () => $('#foto-kamera', c).click());
  $('#foto-galerie-btn', c).addEventListener('click', () => $('#foto-datei', c).click());

  ['#foto-kamera', '#foto-datei'].forEach((sel) =>
    $(sel, c).addEventListener('change', (e) => {
      handleFotos(e.target.files, c);
      e.target.value = '';   // damit dasselbe Bild erneut gewählt werden kann
    })
  );

  $$('.foto-x', c).forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Foto endgültig löschen?')) return;
      const foto = ctx.daten.fotos.find((f) => f.id === b.dataset.foto);
      try {
        await loescheFoto(foto);
        ctx.daten.fotos = ctx.daten.fotos.filter((f) => f.id !== foto.id);
        zeichne();
      } catch (err) {
        $('#foto-status', c).textContent = 'Foto konnte nicht gelöscht werden: ' + (err.message || err);
      }
    })
  );
}

function fotoHtml(f) {
  return `
    <figure class="foto">
      <img src="${fotoUrl(f.storage_path)}" alt="${esc(f.kategorie)}" loading="lazy">
      <figcaption>${esc(f.kategorie)}</figcaption>
      <button type="button" class="foto-x" data-foto="${f.id}">×</button>
    </figure>`;
}

async function handleFotos(fileList, c) {
  const dateien = [...fileList];
  if (dateien.length === 0) return;
  const kategorie = $('#foto-kategorie', c).value;
  const status = $('#foto-status', c);

  if (ctx.neu) {
    dateien.forEach((d) => ctx.pendingFotos.push({ datei: d, kategorie }));
    status.textContent = `${ctx.pendingFotos.length} Foto(s) vorgemerkt – werden beim Anlegen hochgeladen.`;
    return;
  }

  status.textContent = 'Lade hoch …';
  try {
    for (const datei of dateien) {
      const pfad = await ladeFotoHoch(datei, ctx.machine.id, ctx.state.user.id);
      const { data } = await supabase.from('machine_photos').insert({
        machine_id: ctx.machine.id, storage_path: pfad, kategorie,
        created_by: ctx.state.user.id,
      }).select().single();
      if (data) ctx.daten.fotos.push(data);
    }
    zeichne();
  } catch (err) {
    status.textContent = 'Fehler beim Hochladen: ' + (err.message || err);
  }
}

async function ladePendingFotos(machineId) {
  for (const { datei, kategorie } of ctx.pendingFotos) {
    const pfad = await ladeFotoHoch(datei, machineId, ctx.state.user.id);
    await supabase.from('machine_photos').insert({
      machine_id: machineId, storage_path: pfad, kategorie, created_by: ctx.state.user.id,
    });
  }
  ctx.pendingFotos = [];
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
              <td><input type="checkbox" class="auf-check" data-id="${a.id}" ${a.erledigt ? 'checked' : ''}></td>
              <td>${esc(a.titel)}</td>
              <td>${a.zugewiesen_an ? esc(benutzerName(a.zugewiesen_an)) : '<small>–</small>'}</td>
              <td>${a.faellig_am ? `<small class="${!a.erledigt && new Date(a.faellig_am) < new Date() ? 'ueberfaellig' : ''}">${datum(a.faellig_am)}</small>` : '<small>–</small>'}</td>
              <td><button type="button" class="btn-x auf-x" data-id="${a.id}">×</button></td>
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
              <td><small>${datumZeit(v.created_at)}</small></td>
              <td><small>${esc(benutzerName(v.benutzer))}</small></td>
              <td>${v.aktion === 'INSERT' ? '<b>angelegt</b>'
                  : v.aktion === 'DELETE' ? '<b>gelöscht</b>'
                  : esc(v.feld || '')}</td>
              <td><small>${esc(kuerze(v.alt_wert))}</small></td>
              <td><small>${esc(kuerze(v.neu_wert))}</small></td>
            </tr>`).join('')}
        </tbody>
      </table>`}`;
}

function kuerze(v, max = 40) {
  if (v == null || v === '') return '–';
  return v.length > max ? v.slice(0, max) + '…' : v;
}

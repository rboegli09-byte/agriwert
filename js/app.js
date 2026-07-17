// ============================================================================
// AgriWert – Hauptanwendung (Gerüst)
// ----------------------------------------------------------------------------
// Zuständig für: Login/Registrierung, Maschinenliste mit Suche (Echtzeit),
// Einstellungen, Benutzerverwaltung und das eigene Konto.
//
// Die Detailansicht einer Maschine liegt in machine-form.js,
// die Bewertungs- und Preislogik in pricing.js.
//
// Bewusst schlichtes, kommentiertes JavaScript ohne Framework –
// nachvollziehbar und ohne Build-Schritt lauffähig.
// ============================================================================

import { supabase, istKonfiguriert } from './supabase.js';
import { APP_NAME } from './config.js';
import { formatPreis, mitStandardwerten } from './pricing.js';
import { fotoUrl } from './photos.js';
import { renderMaschine } from './machine-form.js';
import { renderDashboard } from './dashboard.js';
import { STATUS, STATUS_REIHENFOLGE, statusMarke } from './status.js';
import { esc } from './util.js';

// --- Zentraler Zustand -------------------------------------------------------
const state = {
  user: null,        // auth-Benutzer
  profile: null,     // Zeile aus profiles (mit Rolle)
  settings: null,    // globale Preis-Faktoren
  kategorien: [],    // Maschinentypen (Traktoren, Heuernte …) – eigene Faktoren möglich
  marken: [],        // Herstellerliste für die Auswahl
  machines: [],      // alle Maschinen
  vorschaubilder: new Map(),   // machine_id -> ein Foto für die Listenkarte
  tab: 'dashboard',  // aktueller Reiter
  editMachine: null, // Maschine, die gerade bearbeitet wird
};

/** Kategorie-Zeile zu einer Maschine (für die Preisberechnung). */
export function kategorieVon(maschine) {
  return state.kategorien.find((k) => k.id === maschine?.kategorie_id) ?? null;
}

const $ = (sel) => document.querySelector(sel);
const app = () => $('#app');

// Schlichte Wortmarke statt Emoji – sachlich, wie bei einem Fachwerkzeug.
const LOGO_SVG = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M3 20h18"/><path d="M5 20V9l7-5 7 5v11"/><path d="M9 20v-6h6v6"/>
  </svg>`;

// Platzhalter, wenn eine Maschine noch kein Foto hat
const ICON_BILD = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>
  </svg>`;

// ============================================================================
// Start
// ============================================================================
init();

async function init() {
  if (!istKonfiguriert()) {
    app().innerHTML = `
      <div class="hinweis-box">
        <h2>Einrichtung noch nicht abgeschlossen</h2>
        <p>Trage zuerst deine Supabase-Zugangsdaten in <code>js/config.js</code> ein.
        Die genaue Anleitung steht in der <code>README.md</code>.</p>
      </div>`;
    return;
  }

  // Auf An-/Abmeldung reagieren
  supabase.auth.onAuthStateChange((_event, session) => {
    state.user = session?.user ?? null;
    if (state.user) nachLogin();
    else zeigeLogin();
  });

  const { data } = await supabase.auth.getSession();
  state.user = data.session?.user ?? null;
  if (state.user) nachLogin();
  else zeigeLogin();
}

// ============================================================================
// LOGIN
// ============================================================================
function zeigeLogin() {
  app().innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <div class="logo">${LOGO_SVG}</div>
        <h1>${APP_NAME}</h1>
        <p class="untertitel">Bewertung von Landmaschinen</p>
        <form id="login-form">
          <label>E-Mail
            <input type="email" id="login-email" required autocomplete="email">
          </label>
          <label>Passwort
            <input type="password" id="login-pass" required autocomplete="current-password">
          </label>
          <button type="submit" class="btn-primary btn-gross">Anmelden</button>
          <p class="fehler" id="login-fehler"></p>
        </form>
        <p class="mini-hinweis">
          Zugang nur auf Einladung.<br>
          Wurdest du eingeladen? <button type="button" class="link" id="zu-registrieren">Konto erstellen</button>
        </p>
      </div>
    </div>`;

  $('#zu-registrieren').addEventListener('click', zeigeRegistrierung);

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fehler = $('#login-fehler');
    fehler.textContent = '';
    const { error } = await supabase.auth.signInWithPassword({
      email: $('#login-email').value.trim(),
      password: $('#login-pass').value,
    });
    if (error) fehler.textContent = 'Anmeldung fehlgeschlagen. E-Mail oder Passwort falsch.';
  });
}

// ============================================================================
// REGISTRIERUNG (nur für eingeladene E-Mail-Adressen)
// ----------------------------------------------------------------------------
// Die Prüfung, ob eine Einladung vorliegt, macht die Datenbank (Trigger).
// Der Browser entscheidet das NICHT – darum lässt es sich nicht umgehen.
// ============================================================================
function zeigeRegistrierung() {
  app().innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <div class="logo">${LOGO_SVG}</div>
        <h1>Konto erstellen</h1>
        <p class="untertitel">Nur für eingeladene E-Mail-Adressen</p>
        <form id="reg-form">
          <label>Name
            <input type="text" id="reg-name" required autocomplete="name">
          </label>
          <label>E-Mail
            <input type="email" id="reg-email" required autocomplete="email">
          </label>
          <label>Passwort (mind. 8 Zeichen)
            <input type="password" id="reg-pass" required minlength="8" autocomplete="new-password">
          </label>
          <label>Passwort wiederholen
            <input type="password" id="reg-pass2" required minlength="8" autocomplete="new-password">
          </label>
          <button type="submit" class="btn-primary btn-gross">Konto erstellen</button>
          <p class="fehler" id="reg-fehler"></p>
        </form>
        <p class="mini-hinweis">
          Schon ein Konto? <button type="button" class="link" id="zu-login">Zur Anmeldung</button>
        </p>
      </div>
    </div>`;

  $('#zu-login').addEventListener('click', zeigeLogin);

  $('#reg-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fehler = $('#reg-fehler');
    fehler.textContent = '';

    const pass = $('#reg-pass').value;
    if (pass !== $('#reg-pass2').value) {
      fehler.textContent = 'Die beiden Passwörter stimmen nicht überein.';
      return;
    }

    const { error } = await supabase.auth.signUp({
      email: $('#reg-email').value.trim(),
      password: pass,
      options: { data: { full_name: $('#reg-name').value.trim() } },
    });

    if (error) { fehler.textContent = registrierFehlerText(error); return; }
    // Erfolg: onAuthStateChange meldet den neuen Benutzer automatisch an.
  });
}

/**
 * Übersetzt technische Supabase-Fehler in verständliche Sätze.
 *
 * Wichtig zum Verständnis: Lehnt unser Datenbank-Trigger eine nicht eingeladene
 * Adresse ab, antwortet Supabase mit HTTP 500 – und der Fehlertext ist dabei oft
 * leer ('{}'). Ein 500 an dieser Stelle bedeutet darum fast immer "keine
 * Einladung". Wir sagen das dem Benutzer, weisen aber auf die andere
 * Möglichkeit hin, statt eine Ursache zu behaupten, die wir nicht kennen.
 */
function registrierFehlerText(error) {
  const m = (error.message || '').toLowerCase();

  if (m.includes('already registered') || m.includes('already been registered') ||
      m.includes('user already exists')) {
    return 'Für diese E-Mail-Adresse gibt es bereits ein Konto. Melde dich stattdessen an.';
  }
  if (m.includes('signups not allowed') || m.includes('signup is disabled') ||
      m.includes('signups are disabled')) {
    return 'Die Registrierung ist derzeit ausgeschaltet. Bitte wende dich an den Administrator.';
  }
  if (m.includes('password')) {
    return 'Das Passwort ist zu kurz oder zu schwach (mindestens 8 Zeichen).';
  }
  if (m.includes('invalid') && m.includes('email')) {
    return 'Diese E-Mail-Adresse ist ungültig.';
  }
  if (m.includes('rate limit') || m.includes('too many')) {
    return 'Zu viele Versuche. Bitte warte einen Moment und probiere es nochmal.';
  }

  // Trigger-Ablehnung: 500 mit leerem oder Datenbank-Fehlertext
  if (error.status === 500 || m.includes('keine_einladung') || m.includes('database error')) {
    return 'Für diese E-Mail-Adresse liegt keine Einladung vor. ' +
           'Bitte prüfe die Schreibweise oder wende dich an den Administrator. ' +
           '(Falls die Adresse eingeladen wurde, liegt gerade eine Serverstörung vor.)';
  }

  return 'Konto konnte nicht erstellt werden. Bitte wende dich an den Administrator.' +
         (error.message && error.message !== '{}' ? ` (${error.message})` : '');
}

// ============================================================================
// Nach dem Login: Daten laden + App aufbauen
// ============================================================================
async function nachLogin() {
  await Promise.all([ladeProfil(), ladeSettings(), ladeListen(), ladeMaschinen()]);
  // Dashboard-Zeilen sollen eine Maschine öffnen können
  state.oeffneMaschine = oeffneMaschine;
  state.kategorieVon = kategorieVon;
  abonniereEchtzeit();
  render();
}

async function ladeProfil() {
  const { data } = await supabase.from('profiles').select('*').eq('id', state.user.id).single();
  state.profile = data;
}

async function ladeSettings() {
  const { data } = await supabase.from('settings').select('*').eq('id', 1).single();
  state.settings = data;
}

/** Kategorien und Marken laden (Auswahllisten im Formular). */
async function ladeListen() {
  const [k, m] = await Promise.all([
    supabase.from('kategorien').select('*').order('sortierung').order('name'),
    supabase.from('marken').select('*').order('name'),
  ]);
  state.kategorien = k.data ?? [];
  state.marken = m.data ?? [];
}

async function ladeMaschinen() {
  // Entwürfe (noch nicht angelegte Maschinen) gehören nicht in die Liste.
  const { data } = await supabase
    .from('machines')
    .select('*')
    .eq('entwurf', false)
    .order('updated_at', { ascending: false });
  state.machines = data ?? [];
  await ladeVorschaubilder();
}

/**
 * Holt für jede Maschine EIN Vorschaubild für die Liste.
 *
 * Wir laden alle Foto-Pfade in einer einzigen Abfrage und nehmen je Maschine
 * das älteste (= das zuerst aufgenommene). Eine Abfrage pro Maschine wäre bei
 * 50 Maschinen 50 Abfragen – das würde die Liste spürbar langsam machen.
 *
 * Bevorzugt wird ein Foto der Kategorie "Vorderseite": das zeigt die Maschine
 * am besten. Gibt es keines, nehmen wir einfach das erste.
 */
async function ladeVorschaubilder() {
  const { data } = await supabase
    .from('machine_photos')
    .select('machine_id, storage_path, kategorie')
    .order('created_at');

  const bilder = new Map();
  for (const f of data ?? []) {
    const vorhanden = bilder.get(f.machine_id);
    // Erstes Foto nehmen – ausser es kommt später noch eine "Vorderseite"
    if (!vorhanden || (f.kategorie === 'Vorderseite' && vorhanden.kategorie !== 'Vorderseite')) {
      bilder.set(f.machine_id, f);
    }
  }
  state.vorschaubilder = bilder;
}

/**
 * Legt sofort einen Entwurf an und öffnet ihn.
 *
 * Warum überhaupt ein Entwurf? Baugruppen, Reifen, Schäden, Fotos usw. hängen
 * alle an einer Maschinen-ID. Ohne gespeicherte Maschine gäbe es diese ID
 * nicht – man könnte diese Reiter erst nach dem Speichern benutzen. Mit dem
 * Entwurf sind ALLE Reiter von der ersten Sekunde an nutzbar.
 *
 * Der Entwurf ist unsichtbar für die Liste und das Dashboard, bis er über
 * "Maschine anlegen" richtig angelegt wird.
 */
async function neueMaschine() {
  // Zuerst die Kategorie wählen – erst dann bekommt die Maschine die richtigen
  // Baugruppen. Ohne diesen Schritt würde die Datenbank die Standard-Liste
  // erzeugen, bevor überhaupt klar ist, was für eine Maschine es wird.
  const kategorieId = await waehleKategorie();
  if (kategorieId === undefined) return;   // abgebrochen

  const { data, error } = await supabase.from('machines').insert({
    created_by: state.user.id,
    entwurf: true,
    zustand_gesamt: 5,
    kategorie_id: kategorieId,   // kann null sein (= ohne Kategorie)
  }).select().single();

  if (error) {
    alert('Die Maschine konnte nicht angelegt werden: ' + error.message);
    return;
  }
  state.editMachine = data;
  state.tab = 'bearbeiten';
  render();
}

/**
 * Kleiner Dialog zur Kategoriewahl beim Anlegen.
 * @returns {Promise<string|null|undefined>} Kategorie-ID, null (ohne), oder
 *          undefined wenn abgebrochen.
 */
function waehleKategorie() {
  return new Promise((fertig) => {
    const box = document.createElement('div');
    box.className = 'dialog-hinter';
    box.innerHTML = `
      <form class="dialog" id="kat-wahl">
        <h3>Was für eine Maschine?</h3>
        <p class="mini-hinweis">Die Kategorie bestimmt, welche Baugruppen und Felder
          erfasst werden. Sie lässt sich später ändern.</p>
        <label>Kategorie
          <select id="kw-select" autofocus>
            ${state.kategorien.map((k) => `<option value="${k.id}">${esc(k.name)}</option>`).join('')}
            <option value="">– ohne Kategorie –</option>
          </select>
        </label>
        <div class="dialog-aktionen">
          <button type="submit" class="btn-primary">Weiter</button>
          <button type="button" class="btn-klein" id="kw-abbrechen">Abbrechen</button>
        </div>
      </form>`;
    document.body.appendChild(box);

    const schliessen = (wert) => { box.remove(); fertig(wert); };
    box.querySelector('#kw-abbrechen').addEventListener('click', () => schliessen(undefined));
    box.addEventListener('click', (e) => { if (e.target === box) schliessen(undefined); });
    box.querySelector('#kat-wahl').addEventListener('submit', (e) => {
      e.preventDefault();
      schliessen(box.querySelector('#kw-select').value || null);
    });
  });
}

// Echtzeit: sobald jemand eine Maschine ändert, neu laden
let channel = null;
function abonniereEchtzeit() {
  if (channel) return;
  channel = supabase
    .channel('machines-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'machines' }, async () => {
      await ladeMaschinen();
      if (state.tab === 'liste') render();
    })
    .subscribe();
}

function istAdmin() {
  return state.profile?.role === 'admin';
}

// ============================================================================
// Grundgerüst rendern
// ============================================================================
function render() {
  app().innerHTML = `
    <header class="topbar">
      <div class="marke">${LOGO_SVG}<span>${APP_NAME}</span></div>
      <nav class="tabs">
        <button data-tab="dashboard" class="${tabCls('dashboard')}">Dashboard</button>
        <button data-tab="liste"  class="${tabCls('liste')}">Maschinen</button>
        <button data-tab="neu"    class="${tabCls('neu')}">Neue Maschine</button>
        ${istAdmin() ? `<button data-tab="einstellungen" class="${tabCls('einstellungen')}">Einstellungen</button>` : ''}
        ${istAdmin() ? `<button data-tab="benutzer" class="${tabCls('benutzer')}">Benutzer</button>` : ''}
        <button data-tab="konto" class="${tabCls('konto')}">Konto</button>
      </nav>
      <div class="user">
        <span>${esc(state.profile?.full_name || state.user.email)}</span>
        <span class="rolle">${esc(state.profile?.role || '')}</span>
        <button id="logout" class="btn-klein">Abmelden</button>
      </div>
    </header>
    <main id="content"></main>`;

  app().querySelectorAll('.tabs button').forEach((b) =>
    b.addEventListener('click', () => {
      // "Neue Maschine" legt sofort einen Entwurf an, damit alle Reiter
      // (Baugruppen, Reifen, Schäden …) von Anfang an nutzbar sind.
      if (b.dataset.tab === 'neu') { neueMaschine(); return; }
      state.tab = b.dataset.tab;
      state.editMachine = null;
      render();
    })
  );
  $('#logout').addEventListener('click', () => supabase.auth.signOut());

  if (state.tab === 'dashboard') renderDashboard($('#content'), state);
  else if (state.tab === 'liste') renderListe();
  else if (state.tab === 'neu' || state.tab === 'bearbeiten') renderFormular();
  else if (state.tab === 'einstellungen') renderEinstellungen();
  else if (state.tab === 'benutzer') renderBenutzer();
  else if (state.tab === 'konto') renderKonto();
}

const tabCls = (t) => (state.tab === t || (t === 'neu' && state.tab === 'bearbeiten') ? 'aktiv' : '');

// ============================================================================
// MASCHINENLISTE + SUCHE/FILTER
// ----------------------------------------------------------------------------
// Wichtig: Die Filterleiste wird nur EINMAL gezeichnet, danach wird ausschliesslich
// der Ergebnisbereich (#ergebnisse) neu befüllt. Sonst würde das Suchfeld bei
// jedem Tastendruck neu erzeugt und der Cursor herausspringen.
// ============================================================================

/** Aktive Filter (bleiben erhalten, solange man im Reiter bleibt). */
const filter = {
  text: '', status: '', kategorie: '', hersteller: '', baujahrVon: '', baujahrBis: '',
  stundenMax: '', zustandMin: '', standort: '', preisVon: '', preisBis: '',
  sort: 'updated', erweitert: false,
};

function renderListe() {
  const c = $('#content');

  if (state.machines.length === 0) {
    c.innerHTML = `<div class="leer">Noch keine Maschinen erfasst.
      <button class="btn-primary" id="leer-neu">Erste Maschine anlegen</button></div>`;
    $('#leer-neu').addEventListener('click', neueMaschine);
    return;
  }

  const hersteller = [...new Set(state.machines.map((m) => m.hersteller).filter(Boolean))].sort();

  c.innerHTML = `
    <div class="filterleiste">
      <input type="search" id="f-text" placeholder="Suchen: Hersteller, Modell, Typ, Seriennr., Standort, Besitzer …" value="${esc(filter.text)}">
      <select id="f-sort" title="Sortierung">
        <option value="updated">Zuletzt geändert</option>
        <option value="preis-hoch">Preis: hoch → tief</option>
        <option value="preis-tief">Preis: tief → hoch</option>
        <option value="baujahr-neu">Baujahr: neu → alt</option>
        <option value="stunden-tief">Betriebsstunden: wenig → viel</option>
        <option value="zustand-hoch">Zustand: gut → schlecht</option>
      </select>
      <button type="button" id="f-toggle" class="btn-sekundaer">
        ${filter.erweitert ? 'Filter ausblenden' : 'Filter anzeigen'}${anzahlAktiveFilter() ? ` (${anzahlAktiveFilter()})` : ''}
      </button>
    </div>

    <div class="filter-erweitert" id="filter-erweitert" ${filter.erweitert ? '' : 'hidden'}>
      <label>Status
        <select id="f-status">
          <option value="">alle</option>
          ${STATUS_REIHENFOLGE.map((s) => `
            <option value="${s}" ${filter.status === s ? 'selected' : ''}>${esc(STATUS[s].label)}</option>`).join('')}
        </select>
      </label>
      <label>Kategorie
        <select id="f-kategorie">
          <option value="">alle</option>
          ${state.kategorien.map((k) => `
            <option value="${k.id}" ${filter.kategorie === k.id ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}
          <option value="__ohne" ${filter.kategorie === '__ohne' ? 'selected' : ''}>ohne Kategorie</option>
        </select>
      </label>
      <label>Hersteller
        <select id="f-hersteller">
          <option value="">alle</option>
          ${hersteller.map((h) => `<option value="${esc(h)}" ${filter.hersteller === h ? 'selected' : ''}>${esc(h)}</option>`).join('')}
        </select>
      </label>
      <label>Baujahr von <input type="number" id="f-baujahrVon" value="${esc(filter.baujahrVon)}" placeholder="z. B. 2010"></label>
      <label>Baujahr bis <input type="number" id="f-baujahrBis" value="${esc(filter.baujahrBis)}" placeholder="z. B. 2024"></label>
      <label>Betriebsstunden max. <input type="number" id="f-stundenMax" value="${esc(filter.stundenMax)}" placeholder="z. B. 5000"></label>
      <label>Zustand mind. <input type="number" id="f-zustandMin" min="1" max="10" value="${esc(filter.zustandMin)}" placeholder="1–10"></label>
      <label>Standort <input type="text" id="f-standort" value="${esc(filter.standort)}" placeholder="z. B. Baden"></label>
      <label>Preis von <input type="number" id="f-preisVon" value="${esc(filter.preisVon)}" placeholder="CHF"></label>
      <label>Preis bis <input type="number" id="f-preisBis" value="${esc(filter.preisBis)}" placeholder="CHF"></label>
      <button type="button" id="f-reset" class="btn-sekundaer">Filter zurücksetzen</button>
    </div>

    <div id="ergebnisse"></div>`;

  $('#f-sort').value = filter.sort;

  // Ein Listener pro Feld – ändert nur den Filter und zeichnet die Ergebnisse neu
  const bind = (id, key, ereignis = 'input') =>
    $(id).addEventListener(ereignis, (e) => { filter[key] = e.target.value; zeigeErgebnisse(); });

  bind('#f-text', 'text');
  bind('#f-sort', 'sort', 'change');
  bind('#f-status', 'status', 'change');
  bind('#f-kategorie', 'kategorie', 'change');
  bind('#f-hersteller', 'hersteller', 'change');
  ['baujahrVon', 'baujahrBis', 'stundenMax', 'zustandMin', 'standort', 'preisVon', 'preisBis']
    .forEach((k) => bind(`#f-${k}`, k));

  $('#f-toggle').addEventListener('click', (e) => {
    filter.erweitert = !filter.erweitert;
    $('#filter-erweitert').hidden = !filter.erweitert;
    e.target.textContent = (filter.erweitert ? 'Filter ausblenden' : 'Filter anzeigen')
      + (anzahlAktiveFilter() ? ` (${anzahlAktiveFilter()})` : '');
  });

  $('#f-reset').addEventListener('click', () => {
    Object.assign(filter, {
      text: '', status: '', kategorie: '', hersteller: '', baujahrVon: '', baujahrBis: '',
      stundenMax: '', zustandMin: '', standort: '', preisVon: '', preisBis: '',
    });
    renderListe();
  });

  zeigeErgebnisse();
}

/** Zählt, wie viele der erweiterten Filter gesetzt sind (für die Anzeige am Knopf). */
function anzahlAktiveFilter() {
  return ['status', 'kategorie', 'hersteller', 'baujahrVon', 'baujahrBis', 'stundenMax',
    'zustandMin', 'standort', 'preisVon', 'preisBis']
    .filter((k) => filter[k] !== '').length;
}

/** Wendet Suche + Filter + Sortierung auf state.machines an. */
function filtereMaschinen() {
  const text = filter.text.trim().toLowerCase();
  const zahl = (v) => (v === '' ? null : parseFloat(v));
  const bjVon = zahl(filter.baujahrVon), bjBis = zahl(filter.baujahrBis);
  const stdMax = zahl(filter.stundenMax), zMin = zahl(filter.zustandMin);
  const pVon = zahl(filter.preisVon), pBis = zahl(filter.preisBis);
  const ort = filter.standort.trim().toLowerCase();

  const liste = state.machines.filter((m) => {
    if (text) {
      const heuhaufen = [m.hersteller, m.marke, m.modell, m.typ, m.seriennummer,
        m.fahrgestellnummer, m.standort, m.besitzer, m.notizen]
        .filter(Boolean).join(' ').toLowerCase();
      if (!heuhaufen.includes(text)) return false;
    }
    if (filter.status && (m.status ?? 'bewertet') !== filter.status) return false;
    if (filter.kategorie === '__ohne' && m.kategorie_id) return false;
    if (filter.kategorie && filter.kategorie !== '__ohne' && m.kategorie_id !== filter.kategorie) return false;
    if (filter.hersteller && m.hersteller !== filter.hersteller) return false;
    if (bjVon !== null && (m.baujahr ?? -Infinity) < bjVon) return false;
    if (bjBis !== null && (m.baujahr ?? Infinity) > bjBis) return false;
    if (stdMax !== null && (m.betriebsstunden ?? Infinity) > stdMax) return false;
    if (zMin !== null && (m.zustand_gesamt ?? 0) < zMin) return false;
    if (ort && !(m.standort || '').toLowerCase().includes(ort)) return false;
    const preis = m.marktwert ?? m.berechneter_preis;
    if (pVon !== null && (preis ?? -Infinity) < pVon) return false;
    if (pBis !== null && (preis ?? Infinity) > pBis) return false;
    return true;
  });

  const preisVon = (m) => m.marktwert ?? m.berechneter_preis;
  const sortierer = {
    'updated': (a, b) => new Date(b.updated_at) - new Date(a.updated_at),
    'preis-hoch': (a, b) => (preisVon(b) ?? -1) - (preisVon(a) ?? -1),
    'preis-tief': (a, b) => (preisVon(a) ?? Infinity) - (preisVon(b) ?? Infinity),
    'baujahr-neu': (a, b) => (b.baujahr ?? 0) - (a.baujahr ?? 0),
    'stunden-tief': (a, b) => (a.betriebsstunden ?? Infinity) - (b.betriebsstunden ?? Infinity),
    'zustand-hoch': (a, b) => (b.zustand_gesamt ?? 0) - (a.zustand_gesamt ?? 0),
  };
  return liste.sort(sortierer[filter.sort] || sortierer['updated']);
}

/**
 * Zeichnet nur den Ergebnisbereich neu (Filterleiste bleibt stehen).
 * Die Maschinen sind nach Status in Untergruppen aufgeteilt.
 */
function zeigeErgebnisse() {
  const liste = filtereMaschinen();
  const summe = liste.reduce((s, m) => s + (m.marktwert ?? m.berechneter_preis ?? 0), 0);

  // Nach Status gruppieren, in der Reihenfolge des Ablaufs
  const gruppen = STATUS_REIHENFOLGE
    .map((s) => [s, liste.filter((m) => (m.status ?? 'bewertet') === s)])
    .filter(([, maschinen]) => maschinen.length > 0);

  $('#ergebnisse').innerHTML = `
    <div class="ergebnis-kopf">
      <span>${liste.length} von ${state.machines.length} Maschinen</span>
      ${summe > 0 ? `<span>Gesamtwert: <b>${formatPreis(summe, state.settings?.waehrung)}</b></span>` : ''}
    </div>

    ${gruppen.length === 0
      ? '<p class="leer">Keine Maschine entspricht der Suche.</p>'
      : gruppen.map(([s, maschinen]) => {
          const gruppenSumme = maschinen.reduce((sum, m) =>
            sum + (s === 'verkauft'
              ? (m.verkaufspreis_tatsaechlich ?? 0)
              : (m.marktwert ?? m.berechneter_preis ?? 0)), 0);
          return `
            <section class="status-gruppe">
              <h3 class="gruppen-kopf">
                <span class="gruppen-punkt status-${STATUS[s].farbe}"></span>
                ${esc(STATUS[s].label)}
                <span class="gruppen-anzahl">${maschinen.length}</span>
                ${gruppenSumme > 0 ? `<span class="gruppen-summe">${
                  s === 'verkauft' ? 'Verkaufserlös' : 'Wert'}: ${formatPreis(gruppenSumme, state.settings?.waehrung)}</span>` : ''}
              </h3>
              <p class="gruppen-hilfe">${esc(STATUS[s].hilfe)}</p>
              <div class="karten">${maschinen.map(kartenHtml).join('')}</div>
            </section>`;
        }).join('')}`;

  $('#ergebnisse').querySelectorAll('[data-open]').forEach((el) =>
    el.addEventListener('click', () => oeffneMaschine(el.dataset.open))
  );
}

function kartenHtml(m) {
  const titel = [m.hersteller || m.marke, m.modell].filter(Boolean).join(' ') || 'Ohne Namen';
  const marktwert = m.marktwert ?? m.berechneter_preis;
  const bild = state.vorschaubilder?.get(m.id);

  return `
    <div class="karte ${bild ? 'mit-bild' : ''}" data-open="${m.id}">
      ${bild
        ? `<div class="karte-bild">
             <img src="${fotoUrl(bild.storage_path)}" alt="${esc(titel)}" loading="lazy">
             ${m.status === 'verkauft' ? '<span class="karte-bild-band">Verkauft</span>' : ''}
           </div>`
        : '<div class="karte-bild leer-bild" title="Noch kein Foto">' + ICON_BILD + '</div>'}
      <div class="karte-oben">
        <span class="ampel ${ampelKlasse(m.zustand_gesamt)}"></span>
        <strong>${esc(titel)}</strong>
        ${m.zustandsindex != null ? `<span class="index-badge" title="Zustandsindex">${m.zustandsindex}</span>` : ''}
      </div>
      <div class="karte-daten">
        ${kategorieVon(m) ? `<span class="kat-tag">${esc(kategorieVon(m).name)}</span>` : ''}
        ${m.typ ? `<span>${esc(m.typ)}</span>` : ''}
        ${m.baujahr ? `<span>Bj. ${m.baujahr}</span>` : ''}
        ${m.betriebsstunden != null ? `<span>${m.betriebsstunden} h</span>` : ''}
        ${m.motorleistung ? `<span>${m.motorleistung} PS</span>` : ''}
        ${m.standort ? `<span>${esc(m.standort)}</span>` : ''}
      </div>
      ${m.reparaturkosten > 0
        ? `<div class="karte-reparatur">Reparaturbedarf ${formatPreis(m.reparaturkosten, '')}</div>` : ''}
      ${m.status === 'verkauft'
        ? `<div class="karte-preis">${formatPreis(m.verkaufspreis_tatsaechlich, state.settings?.waehrung)}
             <small class="vk">verkauft${m.kaeufer ? ' an ' + esc(m.kaeufer) : ''}</small></div>`
        : `<div class="karte-preis">${marktwert != null
            ? `${formatPreis(marktwert, state.settings?.waehrung)}
               ${m.verkaufspreis != null ? `<small class="vk">VK ${formatPreis(m.verkaufspreis, '')}</small>` : ''}`
            : '<span class="kein-preis">kein Preis</span>'}</div>`}
    </div>`;
}

function ampelKlasse(note) {
  if (note >= 8) return 'gruen';
  if (note >= 5) return 'gelb';
  return 'rot';
}

// Wird auch vom Dashboard aufgerufen (siehe state.oeffneMaschine)
function oeffneMaschine(id) {
  state.editMachine = state.machines.find((m) => m.id === id) || null;
  state.tab = 'bearbeiten';
  render();
}

// ============================================================================
// MASCHINEN-DETAILANSICHT
// ----------------------------------------------------------------------------
// Die eigentliche Ansicht liegt im Modul machine-form.js (Stammdaten,
// Baugruppen, Reifen, Schaeden, Fotos, Kommentare, Aufgaben, Vergleich, Verlauf).
// ============================================================================
function renderFormular() {
  renderMaschine($('#content'), {
    machine: state.editMachine,
    state,
    onClose: () => { state.tab = 'liste'; state.editMachine = null; render(); },
    onGespeichert: async () => { await ladeMaschinen(); },
  });
}

// ============================================================================
// EINSTELLUNGEN (nur Admin) – Preis-Faktoren
// ============================================================================
function renderEinstellungen() {
  const c = $('#content');
  const s = mitStandardwerten(state.settings);
  const zRows = Object.entries(s.ausstattung_zuschlaege)
    .map(([name, betrag]) => zuschlagZeile(name, betrag)).join('');

  c.innerHTML = `
    <form id="sform" class="formular">
      <h2>Einstellungen – Preis-Faktoren</h2>
      <p class="mini-hinweis">Änderungen gelten für alle künftig berechneten Preise.</p>

      <fieldset><legend>Wertverlust</legend>
        <div class="grid">
          ${sfeld('wertverlust_jahr_prozent', 'Wertverlust pro Jahr (%)', s.wertverlust_jahr_prozent)}
          ${sfeld('wertverlust_pro_100h_prozent', 'Wertverlust je 100 Betriebsstunden (%)', s.wertverlust_pro_100h_prozent)}
          ${sfeld('mindest_restwert_prozent', 'Mindestrestwert (% vom Neupreis)', s.mindest_restwert_prozent)}
        </div>
      </fieldset>

      <fieldset><legend>Zustand</legend>
        <div class="grid">
          ${sfeld('zustand_neutral', 'Neutrale Note (kein Zu-/Abschlag)', s.zustand_neutral)}
          ${sfeld('zustand_pro_punkt_prozent', 'Zu-/Abschlag je Notenpunkt (%)', s.zustand_pro_punkt_prozent)}
          ${sfeld('gewicht_technisch', 'Gewichtung technischer Zustand (%)', s.gewicht_technisch)}
          ${sfeld('gewicht_optisch', 'Gewichtung optischer Zustand (%)', s.gewicht_optisch)}
        </div>
        <p class="mini-hinweis">Lack, Karosserie und Kabine zählen zum optischen Zustand,
          alle übrigen Baugruppen zum technischen.</p>
      </fieldset>

      <fieldset><legend>Abzüge</legend>
        <div class="grid">
          ${sfeld('reparatur_abzug_prozent', 'Reparaturkosten abziehen (% der Kosten)', s.reparatur_abzug_prozent)}
          ${sfeld('reifen_abzug_prozent', 'Abzug je % Reifenverschleiss', s.reifen_abzug_prozent)}
        </div>
        <p class="mini-hinweis">Beispiel: 0.02 bedeutet, dass 50 % Ø Reifenverschleiss
          den Marktwert um 1 % senken.</p>
      </fieldset>

      <fieldset><legend>Preisarten (in % vom Marktwert)</legend>
        <div class="grid">
          ${sfeld('ankauf_prozent', 'Ankaufspreis (%)', s.ankauf_prozent)}
          ${sfeld('eintausch_prozent', 'Eintauschpreis (%)', s.eintausch_prozent)}
          ${sfeld('verkauf_prozent', 'Verkaufspreis (%)', s.verkauf_prozent)}
          ${sfeld('preisband_prozent', 'Preisband ± (%)', s.preisband_prozent)}
        </div>
      </fieldset>

      <fieldset><legend>Ausstattungs-Zuschläge (CHF)</legend>
        <div id="zuschlaege">${zRows}</div>
        <button type="button" class="btn-sekundaer" id="zuschlag-add">Ausstattung hinzufügen</button>
      </fieldset>

      <div class="formular-aktionen">
        <button type="submit" class="btn-primary btn-gross">Speichern</button>
        <span class="fehler" id="s-fehler"></span>
        <span class="ok" id="s-ok"></span>
      </div>
    </form>

    <div class="formular" style="margin-top:1rem">
      <h2>Kategorien</h2>
      <p class="mini-hinweis">Jede Kategorie hat eigene Baugruppen und Preis-Faktoren.
        Die Faktoren übersteuern die allgemeinen oben – <b>leer lassen = allgemeinen Wert
        verwenden</b>. Das Häkchen „hat eigenen Motor" blendet bei Anbaugeräten die
        Motor-Felder aus. Änderungen wirken auf <b>neu erfasste</b> Maschinen.</p>

      <div id="kat-liste"></div>
      <button type="button" class="btn-sekundaer" id="kat-add">Kategorie hinzufügen</button>
      <span class="fehler" id="kat-fehler"></span>
    </div>

    <div class="formular" style="margin-top:1rem">
      <h2>Marken</h2>
      <p class="mini-hinweis">Vorschläge für das Hersteller-Feld. Neue Marken werden
        beim Erfassen automatisch übernommen – hier kannst du aufräumen.</p>
      <div id="marken-liste-verwaltung" class="marken-wolke"></div>
    </div>`;

  zeichneKategorien();
  zeichneMarkenVerwaltung();

  $('#kat-add').addEventListener('click', async () => {
    const name = prompt('Name der neuen Kategorie (z. B. Heuernte):');
    if (!name || !name.trim()) return;
    const { data, error } = await supabase.from('kategorien')
      .insert({ name: name.trim(), sortierung: (state.kategorien.length + 1) * 10 })
      .select().single();
    if (error) {
      $('#kat-fehler').textContent = error.code === '23505'
        ? 'Diese Kategorie gibt es schon.' : 'Fehler: ' + error.message;
      return;
    }
    state.kategorien.push(data);
    zeichneKategorien();
  });

  $('#zuschlag-add').addEventListener('click', () => {
    $('#zuschlaege').insertAdjacentHTML('beforeend', zuschlagZeile('', 0));
    bindeZuschlagEntfernen();
  });
  bindeZuschlagEntfernen();
  $('#sform').addEventListener('submit', speichereEinstellungen);
}

/**
 * Kategorien-Verwaltung. Jede Zeile speichert sofort beim Verlassen des Felds.
 * Leere Faktor-Felder bedeuten bewusst "allgemeinen Wert verwenden" – darum
 * wird '' zu NULL und nicht zu 0 (0 % wäre "gar kein Wertverlust").
 */
function zeichneKategorien() {
  const ziel = $('#kat-liste');
  if (!ziel) return;

  const kf = (k, feld, label) => `
    <label>${label}
      <input type="number" step="any" data-feld="${feld}"
             value="${k[feld] ?? ''}" placeholder="allg.">
    </label>`;

  ziel.innerHTML = state.kategorien.map((k) => {
    const baugruppen = Array.isArray(k.standard_baugruppen) ? k.standard_baugruppen : [];
    return `
    <div class="kat-karte" data-id="${k.id}">
      <div class="kat-karte-kopf">
        <input type="text" data-feld="name" class="kat-name" value="${esc(k.name)}">
        <label class="check kat-motor">
          <input type="checkbox" data-feld="hat_motor" ${k.hat_motor !== false ? 'checked' : ''}>
          <span>hat eigenen Motor</span>
        </label>
        <button type="button" class="btn-x kat-x" title="Kategorie löschen">×</button>
      </div>

      <div class="grid kat-faktoren">
        ${kf(k, 'wertverlust_jahr_prozent', 'Wertverlust % / Jahr')}
        ${kf(k, 'wertverlust_pro_100h_prozent', 'Wertverlust % / 100 h')}
        ${kf(k, 'mindest_restwert_prozent', 'Min. Restwert %')}
      </div>

      <div class="kat-baugruppen">
        <span class="kat-bg-titel">Baugruppen ${baugruppen.length ? `(${baugruppen.length})` : '– allgemeine Vorgabe'}</span>
        <div class="bg-wolke">
          ${baugruppen.map((n, i) => `
            <span class="bg-chip">${esc(n)}<button type="button" data-bg="${i}" title="entfernen">×</button></span>`).join('')}
          <button type="button" class="bg-add btn-klein">+ Baugruppe</button>
        </div>
      </div>
    </div>`;
  }).join('') || '<p class="mini-hinweis">Noch keine Kategorien.</p>';

  ziel.querySelectorAll('.kat-karte').forEach((karte) => {
    const k = state.kategorien.find((x) => x.id === karte.dataset.id);

    // Name + Faktoren
    karte.querySelectorAll('input[data-feld]').forEach((eingabe) =>
      eingabe.addEventListener('change', () => {
        const feld = eingabe.dataset.feld;
        if (feld === 'hat_motor') k.hat_motor = eingabe.checked;
        else if (feld === 'name') k.name = eingabe.value.trim();
        else k[feld] = eingabe.value.trim() === '' ? null : parseFloat(eingabe.value);
        speichereKategorie(k, feld);
      })
    );

    // Baugruppe entfernen
    karte.querySelectorAll('[data-bg]').forEach((b) =>
      b.addEventListener('click', () => {
        k.standard_baugruppen.splice(Number(b.dataset.bg), 1);
        speichereKategorie(k, 'standard_baugruppen');
        zeichneKategorien();
      })
    );

    // Baugruppe hinzufügen
    karte.querySelector('.bg-add').addEventListener('click', () => {
      const name = prompt('Name der Baugruppe (z. B. Getriebe):');
      if (!name || !name.trim()) return;
      if (!Array.isArray(k.standard_baugruppen)) k.standard_baugruppen = [];
      k.standard_baugruppen.push(name.trim());
      speichereKategorie(k, 'standard_baugruppen');
      zeichneKategorien();
    });

    // Kategorie löschen
    karte.querySelector('.kat-x').addEventListener('click', async () => {
      const anzahl = state.machines.filter((m) => m.kategorie_id === k.id).length;
      if (!confirm(anzahl
        ? `„${k.name}" löschen?\n\n${anzahl} Maschine(n) verlieren dadurch ihre Kategorie. Die Maschinen selbst bleiben erhalten.`
        : `„${k.name}" löschen?`)) return;

      const { error } = await supabase.from('kategorien').delete().eq('id', k.id);
      if (error) { $('#kat-fehler').textContent = 'Fehler: ' + error.message; return; }
      state.kategorien = state.kategorien.filter((x) => x.id !== k.id);
      await ladeMaschinen();
      zeichneKategorien();
    });
  });
}

/** Ein Feld einer Kategorie speichern. */
async function speichereKategorie(k, feld) {
  const { error } = await supabase.from('kategorien')
    .update({ [feld]: k[feld] }).eq('id', k.id);
  $('#kat-fehler').textContent = error
    ? (error.code === '23505' ? 'Diesen Namen gibt es schon.' : 'Fehler: ' + error.message)
    : '';
}

/** Marken als Wolke mit Löschmöglichkeit. */
function zeichneMarkenVerwaltung() {
  const ziel = $('#marken-liste-verwaltung');
  if (!ziel) return;

  ziel.innerHTML = state.marken.map((m) => `
    <span class="marke-chip" data-id="${m.id}">
      ${esc(m.name)}<button type="button" title="Marke aus der Liste entfernen">×</button>
    </span>`).join('') || '<p class="mini-hinweis">Noch keine Marken.</p>';

  ziel.querySelectorAll('.marke-chip button').forEach((b) =>
    b.addEventListener('click', async () => {
      const chip = b.closest('.marke-chip');
      const m = state.marken.find((x) => x.id === chip.dataset.id);
      if (!confirm(`„${m.name}" aus der Vorschlagsliste entfernen?\n\nBereits erfasste Maschinen behalten ihren Hersteller-Eintrag.`)) return;
      const { error } = await supabase.from('marken').delete().eq('id', m.id);
      if (error) { alert('Fehler: ' + error.message); return; }
      state.marken = state.marken.filter((x) => x.id !== m.id);
      zeichneMarkenVerwaltung();
    })
  );
}

function sfeld(name, label, wert) {
  return `<label>${label}
    <input type="number" step="any" name="${name}" value="${wert}">
  </label>`;
}

function zuschlagZeile(name, betrag) {
  return `<div class="zuschlag-zeile">
    <input type="text" class="z-name" placeholder="Ausstattung" value="${esc(name)}">
    <input type="number" class="z-betrag" placeholder="CHF" value="${betrag}">
    <button type="button" class="btn-x">×</button>
  </div>`;
}

function bindeZuschlagEntfernen() {
  document.querySelectorAll('.zuschlag-zeile .btn-x').forEach((b) =>
    b.onclick = () => b.closest('.zuschlag-zeile').remove()
  );
}

async function speichereEinstellungen(e) {
  e.preventDefault();
  const f = $('#sform');
  const num = (n) => parseFloat(f.elements[n].value) || 0;
  const zuschlaege = {};
  document.querySelectorAll('.zuschlag-zeile').forEach((z) => {
    const name = z.querySelector('.z-name').value.trim();
    const betrag = parseFloat(z.querySelector('.z-betrag').value) || 0;
    if (name) zuschlaege[name] = betrag;
  });

  const update = {
    wertverlust_jahr_prozent: num('wertverlust_jahr_prozent'),
    wertverlust_pro_100h_prozent: num('wertverlust_pro_100h_prozent'),
    mindest_restwert_prozent: num('mindest_restwert_prozent'),
    zustand_neutral: num('zustand_neutral'),
    zustand_pro_punkt_prozent: num('zustand_pro_punkt_prozent'),
    gewicht_technisch: num('gewicht_technisch'),
    gewicht_optisch: num('gewicht_optisch'),
    reparatur_abzug_prozent: num('reparatur_abzug_prozent'),
    reifen_abzug_prozent: num('reifen_abzug_prozent'),
    ankauf_prozent: num('ankauf_prozent'),
    eintausch_prozent: num('eintausch_prozent'),
    verkauf_prozent: num('verkauf_prozent'),
    preisband_prozent: num('preisband_prozent'),
    ausstattung_zuschlaege: zuschlaege,
  };

  const { error } = await supabase.from('settings').update(update).eq('id', 1);
  if (error) { $('#s-fehler').textContent = 'Fehler: ' + error.message; return; }
  await ladeSettings();
  $('#s-ok').textContent = 'Gespeichert ✓';
  setTimeout(() => ($('#s-ok').textContent = ''), 2000);
}

// ============================================================================
// BENUTZER (nur Admin) – einladen und Rollen vergeben
// ============================================================================
const ROLLEN = ['admin', 'geschaeftsfuehrer', 'verkaufsleiter', 'verkaeufer',
  'werkstatt', 'sachverstaendiger', 'gast'];

async function renderBenutzer() {
  const c = $('#content');
  c.innerHTML = '<h2>Benutzer</h2><p class="mini-hinweis">Lade …</p>';

  const [{ data: profile }, { data: einladungen }] = await Promise.all([
    supabase.from('profiles').select('*').order('created_at'),
    supabase.from('einladungen').select('*').is('verwendet_am', null).order('created_at'),
  ]);

  c.innerHTML = `
    <div class="formular">
      <h2>Person einladen</h2>
      <p class="mini-hinweis">Trage die E-Mail-Adresse ein und schick der Person den Link zur App.
        Sie klickt dort auf „Konto erstellen" und wählt ihr Passwort selbst.
        Nur eingeladene Adressen werden angenommen.</p>
      <form id="einladen-form" class="einladen-zeile">
        <label>E-Mail
          <input type="email" id="ein-email" required placeholder="person@beispiel.ch">
        </label>
        <label>Rolle
          <select id="ein-rolle">
            ${ROLLEN.map((r) => `<option value="${r}" ${r === 'verkaeufer' ? 'selected' : ''}>${r}</option>`).join('')}
          </select>
        </label>
        <button type="submit" class="btn-primary">Einladen</button>
      </form>
      <p class="fehler" id="ein-fehler"></p>
      <p class="ok" id="ein-ok"></p>
    </div>

    <h2 class="abschnitt">Offene Einladungen</h2>
    ${(einladungen ?? []).length === 0
      ? '<p class="mini-hinweis">Keine offenen Einladungen.</p>'
      : `<table class="tabelle">
          <thead><tr><th>E-Mail</th><th>Rolle</th><th>Eingeladen am</th><th></th></tr></thead>
          <tbody>
            ${einladungen.map((e) => `
              <tr>
                <td data-label="E-Mail" class="haupt-zelle">${esc(e.email)}</td>
                <td data-label="Rolle">${esc(e.rolle)}</td>
                <td data-label="Eingeladen am"><small>${new Date(e.created_at).toLocaleDateString('de-CH')}</small></td>
                <td><button class="btn-klein" data-einladung="${e.id}">zurückziehen</button></td>
              </tr>`).join('')}
          </tbody>
        </table>`}

    <h2 class="abschnitt">Angemeldete Benutzer</h2>
    <table class="tabelle">
      <thead><tr><th>Name / E-Mail</th><th>Rolle</th></tr></thead>
      <tbody>
        ${(profile ?? []).map((p) => `
          <tr>
            <td class="haupt-zelle">${esc(p.full_name || p.email)}<br><small>${esc(p.email || '')}</small></td>
            <td data-label="Rolle">
              <select data-user="${p.id}" ${p.id === state.user.id ? 'disabled title="Die eigene Rolle kann nicht geändert werden"' : ''}>
                ${ROLLEN.map((r) => `<option value="${r}" ${p.role === r ? 'selected' : ''}>${r}</option>`).join('')}
              </select>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;

  // Einladen
  $('#einladen-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#ein-fehler').textContent = '';
    $('#ein-ok').textContent = '';
    const email = $('#ein-email').value.trim().toLowerCase();

    const { error } = await supabase.from('einladungen').insert({
      email, rolle: $('#ein-rolle').value, eingeladen_von: state.user.id,
    });

    if (error) {
      $('#ein-fehler').textContent = error.code === '23505'
        ? 'Für diese E-Mail-Adresse gibt es bereits eine offene Einladung.'
        : 'Fehler: ' + error.message;
      return;
    }
    $('#ein-ok').textContent = `${email} eingeladen ✓`;
    setTimeout(renderBenutzer, 900);
  });

  // Einladung zurückziehen
  c.querySelectorAll('[data-einladung]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Diese Einladung zurückziehen?')) return;
      await supabase.from('einladungen').delete().eq('id', b.dataset.einladung);
      renderBenutzer();
    })
  );

  // Rolle ändern
  c.querySelectorAll('select[data-user]').forEach((sel) =>
    sel.addEventListener('change', async () => {
      const { error } = await supabase.from('profiles')
        .update({ role: sel.value }).eq('id', sel.dataset.user);
      if (error) alert('Fehler: ' + error.message);
    })
  );
}

// ============================================================================
// KONTO – eigener Name und eigenes Passwort (für alle Benutzer)
// ============================================================================
function renderKonto() {
  const c = $('#content');
  c.innerHTML = `
    <div class="formular">
      <h2>Mein Konto</h2>
      <p class="mini-hinweis">Angemeldet als <b>${esc(state.user.email)}</b> · Rolle: ${esc(state.profile?.role || '')}</p>

      <fieldset><legend>Name</legend>
        <form id="name-form" class="einladen-zeile">
          <label>Anzeigename
            <input type="text" id="k-name" value="${esc(state.profile?.full_name || '')}" required>
          </label>
          <button type="submit" class="btn-primary">Name speichern</button>
        </form>
        <p class="ok" id="k-name-ok"></p>
      </fieldset>

      <fieldset><legend>Passwort ändern</legend>
        <form id="pass-form">
          <div class="grid">
            <label>Neues Passwort (mind. 8 Zeichen)
              <input type="password" id="k-pass" required minlength="8" autocomplete="new-password">
            </label>
            <label>Neues Passwort wiederholen
              <input type="password" id="k-pass2" required minlength="8" autocomplete="new-password">
            </label>
          </div>
          <button type="submit" class="btn-primary">Passwort ändern</button>
          <p class="fehler" id="k-pass-fehler"></p>
          <p class="ok" id="k-pass-ok"></p>
        </form>
      </fieldset>
    </div>`;

  $('#name-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#k-name').value.trim();
    const { error } = await supabase.from('profiles')
      .update({ full_name: name }).eq('id', state.user.id);
    if (error) { alert('Fehler: ' + error.message); return; }
    await ladeProfil();
    $('#k-name-ok').textContent = 'Name gespeichert ✓';
    setTimeout(() => render(), 800);
  });

  $('#pass-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fehler = $('#k-pass-fehler');
    const ok = $('#k-pass-ok');
    fehler.textContent = ''; ok.textContent = '';

    const pass = $('#k-pass').value;
    if (pass !== $('#k-pass2').value) {
      fehler.textContent = 'Die beiden Passwörter stimmen nicht überein.';
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: pass });
    if (error) {
      fehler.textContent = 'Passwort konnte nicht geändert werden: ' + error.message;
      return;
    }
    $('#pass-form').reset();
    ok.textContent = 'Passwort geändert ✓';
  });
}

// Hinweis: esc() (Schutz vor Code-Einschleusung/XSS) liegt jetzt in util.js
// und wird oben importiert – so nutzen alle Module dieselbe Fassung.

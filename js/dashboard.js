// ============================================================================
// AgriWert – Dashboard
// ----------------------------------------------------------------------------
// Übersicht über den gesamten Maschinenbestand:
//   Bestand · Durchschnittsalter · Ø Betriebsstunden · Gesamtwert ·
//   Bewertungen · Verkäufer · Marken · Preise
//
// Alle Auswertungen rechnen aus den bereits geladenen Maschinen – kein
// zusätzlicher Datenbank-Zugriff nötig.
// ============================================================================

import { supabase } from './supabase.js';
import { formatPreis } from './pricing.js';
import { esc, $, $$ } from './util.js';

/**
 * Zeichnet das Dashboard.
 * @param {HTMLElement} c      Ziel-Element
 * @param {object} state       { machines, settings, user }
 */
export async function renderDashboard(c, state) {
  const m = state.machines;
  const w = state.settings?.waehrung ?? 'CHF';

  if (m.length === 0) {
    c.innerHTML = '<p class="leer">Noch keine Maschinen erfasst – das Dashboard füllt sich automatisch.</p>';
    return;
  }

  const jahr = new Date().getFullYear();
  const preis = (x) => x.marktwert ?? x.berechneter_preis ?? 0;

  // --- Kennzahlen ------------------------------------------------------------
  const gesamtwert = summe(m.map(preis));
  const verkaufswert = summe(m.map((x) => x.verkaufspreis ?? 0));
  const ankaufswert = summe(m.map((x) => x.ankaufspreis ?? 0));
  const reparaturen = summe(m.map((x) => x.reparaturkosten ?? 0));

  const alter = m.filter((x) => x.baujahr).map((x) => jahr - x.baujahr);
  const stunden = m.filter((x) => x.betriebsstunden != null).map((x) => x.betriebsstunden);
  const indizes = m.filter((x) => x.zustandsindex != null).map((x) => x.zustandsindex);

  // --- Verteilungen ----------------------------------------------------------
  const kategorieName = (x) =>
    (state.kategorien ?? []).find((k) => k.id === x.kategorie_id)?.name || 'ohne Kategorie';
  const kategorien = gruppiere(m, kategorieName);
  const marken = gruppiere(m, (x) => x.hersteller || x.marke || 'ohne Angabe');
  const standorte = gruppiere(m, (x) => x.standort || 'ohne Angabe');
  const ampeln = {
    gruen: m.filter((x) => x.zustand_gesamt >= 8).length,
    gelb: m.filter((x) => x.zustand_gesamt >= 5 && x.zustand_gesamt < 8).length,
    rot: m.filter((x) => x.zustand_gesamt < 5).length,
  };

  c.innerHTML = `
    <h2>Dashboard</h2>

    <div class="kennzahlen">
      ${kachel('Maschinen im Bestand', m.length, '')}
      ${kachel('Gesamtwert (Marktwert)', formatPreis(gesamtwert, w), '')}
      ${kachel('Ø Alter', alter.length ? mittel(alter).toFixed(1) + ' Jahre' : '–', '')}
      ${kachel('Ø Betriebsstunden', stunden.length ? Math.round(mittel(stunden)).toLocaleString('de-CH') + ' h' : '–', '')}
      ${kachel('Ø Zustandsindex', indizes.length ? Math.round(mittel(indizes)) + ' / 100' : '–', '')}
      ${kachel('Offener Reparaturbedarf', formatPreis(reparaturen, w), reparaturen > 0 ? 'warn' : '')}
    </div>

    <div class="dash-raster">
      <div class="dash-block">
        <h3>Werte im Überblick</h3>
        <table class="tabelle schmal">
          <tbody>
            <tr><td>Summe Ankaufspreise</td><td class="zahl">${formatPreis(ankaufswert, w)}</td></tr>
            <tr><td>Summe Marktwerte</td><td class="zahl"><b>${formatPreis(gesamtwert, w)}</b></td></tr>
            <tr><td>Summe Verkaufspreise</td><td class="zahl">${formatPreis(verkaufswert, w)}</td></tr>
            <tr><td>Mögliche Spanne (Verkauf − Ankauf)</td><td class="zahl">${formatPreis(verkaufswert - ankaufswert, w)}</td></tr>
          </tbody>
        </table>
      </div>

      <div class="dash-block">
        <h3>Zustand des Bestands</h3>
        ${balkenAmpel(ampeln, m.length)}
      </div>

      <div class="dash-block">
        <h3>Kategorien</h3>
        ${balken(kategorien, m.length, w, preis)}
      </div>

      <div class="dash-block">
        <h3>Marken</h3>
        ${balken(marken, m.length, w, preis)}
      </div>

      <div class="dash-block">
        <h3>Standorte</h3>
        ${balken(standorte, m.length, w, preis)}
      </div>

      <div class="dash-block breit">
        <h3>Erfasst von</h3>
        <div id="dash-verkaeufer"><p class="mini-hinweis">Lade …</p></div>
      </div>

      <div class="dash-block breit">
        <h3>Wertvollste Maschinen</h3>
        <table class="tabelle">
          <thead><tr><th>Maschine</th><th>Baujahr</th><th>Stunden</th><th>Index</th><th class="zahl">Marktwert</th></tr></thead>
          <tbody>
            ${[...m].sort((a, b) => preis(b) - preis(a)).slice(0, 8).map((x) => `
              <tr data-open="${x.id}" class="klickbar">
                <td>${esc([x.hersteller || x.marke, x.modell].filter(Boolean).join(' ') || 'Ohne Namen')}</td>
                <td>${x.baujahr ?? '–'}</td>
                <td>${x.betriebsstunden != null ? x.betriebsstunden.toLocaleString('de-CH') : '–'}</td>
                <td>${x.zustandsindex ?? '–'}</td>
                <td class="zahl">${formatPreis(preis(x), w)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;

  // Verkäufer-Auswertung braucht die Namen aus profiles
  await zeigeVerkaeufer(m, w, preis);

  // Klick auf eine Zeile öffnet die Maschine
  $$('[data-open]', c).forEach((el) =>
    el.addEventListener('click', () => state.oeffneMaschine?.(el.dataset.open))
  );
}

// ============================================================================
// Verkäufer / Ersteller
// ============================================================================
async function zeigeVerkaeufer(machines, w, preis) {
  const ziel = $('#dash-verkaeufer');
  if (!ziel) return;

  const { data: profile } = await supabase.from('profiles').select('id, full_name, email, role');
  const name = (id) => {
    const p = (profile ?? []).find((x) => x.id === id);
    return p ? (p.full_name || p.email) : 'unbekannt';
  };

  const proPerson = new Map();
  for (const m of machines) {
    const schluessel = m.created_by ?? 'unbekannt';
    const eintrag = proPerson.get(schluessel) ?? { anzahl: 0, wert: 0 };
    eintrag.anzahl++;
    eintrag.wert += preis(m);
    proPerson.set(schluessel, eintrag);
  }

  const zeilen = [...proPerson.entries()]
    .map(([id, v]) => ({ name: name(id), ...v }))
    .sort((a, b) => b.wert - a.wert);

  ziel.innerHTML = `
    <table class="tabelle">
      <thead><tr><th>Person</th><th>Maschinen</th><th class="zahl">Erfasster Wert</th></tr></thead>
      <tbody>
        ${zeilen.map((z) => `
          <tr>
            <td>${esc(z.name)}</td>
            <td>${z.anzahl}</td>
            <td class="zahl">${formatPreis(z.wert, w)}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

// ============================================================================
// Bausteine
// ============================================================================
function kachel(titel, wert, art) {
  return `<div class="kennzahl ${art}">
    <span>${esc(titel)}</span>
    <b>${typeof wert === 'number' ? wert.toLocaleString('de-CH') : esc(String(wert))}</b>
  </div>`;
}

/** Waagrechte Balken für eine Gruppierung (Marken, Standorte …). */
function balken(gruppen, gesamt, waehrung, preis) {
  const zeilen = [...gruppen.entries()]
    .map(([schluessel, liste]) => ({
      schluessel,
      anzahl: liste.length,
      wert: summe(liste.map(preis)),
    }))
    .sort((a, b) => b.anzahl - a.anzahl)
    .slice(0, 8);

  const max = Math.max(...zeilen.map((z) => z.anzahl), 1);

  return `<div class="balken">
    ${zeilen.map((z) => `
      <div class="balken-zeile">
        <span class="balken-name" title="${esc(z.schluessel)}">${esc(z.schluessel)}</span>
        <span class="balken-spur"><span class="balken-fuellung" style="width:${(z.anzahl / max) * 100}%"></span></span>
        <span class="balken-wert">${z.anzahl}× · ${formatPreis(z.wert, '')}</span>
      </div>`).join('')}
  </div>`;
}

/** Zustandsverteilung als Ampel-Balken. */
function balkenAmpel(ampeln, gesamt) {
  const teile = [
    ['gruen', 'Gut (8–10)', ampeln.gruen],
    ['gelb', 'Mittel (5–7)', ampeln.gelb],
    ['rot', 'Schlecht (1–4)', ampeln.rot],
  ];
  return `
    <div class="ampel-balken">
      ${teile.map(([k, , n]) => n > 0
        ? `<span class="ampel-teil ${k}" style="width:${(n / gesamt) * 100}%" title="${n}"></span>` : '').join('')}
    </div>
    <div class="ampel-legende">
      ${teile.map(([k, label, n]) => `
        <span><span class="ampel ${k}"></span>${label}: <b>${n}</b></span>`).join('')}
    </div>`;
}

// ============================================================================
// Hilfsfunktionen
// ============================================================================
function gruppiere(liste, schluesselFn) {
  const map = new Map();
  for (const eintrag of liste) {
    const k = schluesselFn(eintrag);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(eintrag);
  }
  return map;
}

const summe = (werte) => werte.reduce((a, b) => a + (Number(b) || 0), 0);
const mittel = (werte) => (werte.length ? summe(werte) / werte.length : 0);

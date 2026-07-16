// ============================================================================
// AgriWert – Icons erzeugen
// ----------------------------------------------------------------------------
// Erzeugt die PNG-Icons für den Startbildschirm (PWA) aus reinem Code –
// ohne Zusatzpakete, nur mit Node-Bordmitteln.
//
// Ausführen (PowerShell, im Ordner AgriWert):
//     node tools/icons-erzeugen.js
//
// Ergebnis: icons/icon-192.png, icon-512.png, icon-maskable-512.png,
//           apple-touch-icon.png
//
// Warum selbst gebaut? So bleibt das Projekt ohne Abhängigkeiten und du kannst
// Farbe oder Form jederzeit hier ändern und neu erzeugen.
// ============================================================================

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// --- Farben ------------------------------------------------------------------
const GRUEN = [43, 106, 75];      // #2b6a4b – gleicher Akzent wie in der App
const WEISS = [255, 255, 255];

// ============================================================================
// Minimaler PNG-Schreiber
// ============================================================================
const CRC_TABELLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABELLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(typ, daten) {
  const laenge = Buffer.alloc(4);
  laenge.writeUInt32BE(daten.length);
  const inhalt = Buffer.concat([Buffer.from(typ, 'ascii'), daten]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(inhalt));
  return Buffer.concat([laenge, inhalt, crc]);
}

/** Schreibt RGBA-Pixel als PNG-Datei. */
function schreibePng(datei, breite, hoehe, pixel) {
  const roh = Buffer.alloc((breite * 4 + 1) * hoehe);
  let p = 0;
  for (let y = 0; y < hoehe; y++) {
    roh[p++] = 0; // Filter "None"
    for (let x = 0; x < breite; x++) {
      const i = (y * breite + x) * 4;
      roh[p++] = pixel[i]; roh[p++] = pixel[i + 1];
      roh[p++] = pixel[i + 2]; roh[p++] = pixel[i + 3];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(breite, 0);
  ihdr.writeUInt32BE(hoehe, 4);
  ihdr[8] = 8;    // 8 Bit pro Kanal
  ihdr[9] = 6;    // Farbtyp 6 = RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  fs.writeFileSync(datei, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(roh, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

// ============================================================================
// Zeichnen
// ============================================================================

/** Leinwand mit Hilfsfunktionen (4x Überabtastung für weiche Kanten). */
function leinwand(groesse) {
  const AA = 4;                       // Kantenglättung
  const n = groesse * AA;
  const px = new Float64Array(n * n * 4);

  const setze = (x, y, farbe, deckung) => {
    if (x < 0 || y < 0 || x >= n || y >= n || deckung <= 0) return;
    const i = (y * n + x) * 4;
    const a = Math.min(1, deckung);
    px[i]     = px[i]     * (1 - a) + farbe[0] * a;
    px[i + 1] = px[i + 1] * (1 - a) + farbe[1] * a;
    px[i + 2] = px[i + 2] * (1 - a) + farbe[2] * a;
    px[i + 3] = Math.max(px[i + 3], a * 255);
  };

  return {
    n, AA, px, setze,

    /** Abgerundetes Rechteck füllen (Radius in Bildpunkten). */
    rundRechteck(x0, y0, x1, y1, r, farbe) {
      for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
        for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
          // Abstand zur abgerundeten Kante bestimmen
          const dx = Math.max(x0 + r - x, 0, x - (x1 - r));
          const dy = Math.max(y0 + r - y, 0, y - (y1 - r));
          const d = Math.hypot(dx, dy);
          if (d <= r) this.setze(x, y, farbe, 1);
        }
      }
    },

    /** Dicke Linie von A nach B mit runden Enden. */
    linie(ax, ay, bx, by, dicke, farbe) {
      const r = dicke / 2;
      const minX = Math.floor(Math.min(ax, bx) - r - 1);
      const maxX = Math.ceil(Math.max(ax, bx) + r + 1);
      const minY = Math.floor(Math.min(ay, by) - r - 1);
      const maxY = Math.ceil(Math.max(ay, by) + r + 1);
      const dx = bx - ax, dy = by - ay;
      const laenge2 = dx * dx + dy * dy;

      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          // kürzester Abstand Punkt -> Strecke
          let t = laenge2 === 0 ? 0 : ((x - ax) * dx + (y - ay) * dy) / laenge2;
          t = Math.max(0, Math.min(1, t));
          const d = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
          if (d <= r) this.setze(x, y, farbe, 1);
        }
      }
    },

    /** Herunterrechnen auf die Zielgrösse (glättet die Kanten). */
    fertig(groesse) {
      const out = Buffer.alloc(groesse * groesse * 4);
      const AA2 = AA * AA;
      for (let y = 0; y < groesse; y++) {
        for (let x = 0; x < groesse; x++) {
          let r = 0, g = 0, b = 0, a = 0;
          for (let sy = 0; sy < AA; sy++) {
            for (let sx = 0; sx < AA; sx++) {
              const i = ((y * AA + sy) * n + (x * AA + sx)) * 4;
              r += px[i]; g += px[i + 1]; b += px[i + 2]; a += px[i + 3];
            }
          }
          const i = (y * groesse + x) * 4;
          out[i] = Math.round(r / AA2); out[i + 1] = Math.round(g / AA2);
          out[i + 2] = Math.round(b / AA2); out[i + 3] = Math.round(a / AA2);
        }
      }
      return out;
    },
  };
}

/**
 * Zeichnet das Scheunen-Symbol – dieselbe Form wie das Logo in der App.
 * Koordinaten stammen aus dem 24x24-Raster des SVG.
 */
function zeichneIcon(groesse, logoAnteil, eckRadiusAnteil) {
  const l = leinwand(groesse);
  const n = l.n;

  // Hintergrund
  l.rundRechteck(0, 0, n, n, n * eckRadiusAnteil, GRUEN);

  // Symbol mittig platzieren
  const s = (n * logoAnteil) / 24;
  const versatz = (n - 24 * s) / 2;
  const P = (x, y) => [versatz + x * s, versatz + y * s];
  const dicke = 1.75 * s;

  // M3 20h18  – Boden
  l.linie(...P(3, 20), ...P(21, 20), dicke, WEISS);
  // M5 20V9l7-5 7 5v11 – Wände + Dach
  l.linie(...P(5, 20), ...P(5, 9), dicke, WEISS);
  l.linie(...P(5, 9), ...P(12, 4), dicke, WEISS);
  l.linie(...P(12, 4), ...P(19, 9), dicke, WEISS);
  l.linie(...P(19, 9), ...P(19, 20), dicke, WEISS);
  // M9 20v-6h6v6 – Tor
  l.linie(...P(9, 20), ...P(9, 14), dicke, WEISS);
  l.linie(...P(9, 14), ...P(15, 14), dicke, WEISS);
  l.linie(...P(15, 14), ...P(15, 20), dicke, WEISS);

  return l.fertig(groesse);
}

// ============================================================================
// Erzeugen
// ============================================================================
const ziel = path.join(__dirname, '..', 'icons');
fs.mkdirSync(ziel, { recursive: true });

const dateien = [
  // [Dateiname, Grösse, Anteil des Logos, Eckenradius]
  ['icon-192.png', 192, 0.62, 0.22],
  ['icon-512.png', 512, 0.62, 0.22],
  // maskable: Symbol kleiner, damit Android beliebig zuschneiden darf
  ['icon-maskable-512.png', 512, 0.46, 0],
  // iOS rundet selbst ab -> volle Fläche
  ['apple-touch-icon.png', 180, 0.62, 0],
];

for (const [name, groesse, anteil, radius] of dateien) {
  schreibePng(path.join(ziel, name), groesse, groesse, zeichneIcon(groesse, anteil, radius));
  console.log('erzeugt:', name, `(${groesse}x${groesse})`);
}
console.log('\nFertig. Die Icons liegen im Ordner "icons".');

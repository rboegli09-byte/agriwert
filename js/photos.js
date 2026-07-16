// ============================================================================
// AgriWert – Foto-Verarbeitung
// ----------------------------------------------------------------------------
// Verkleinert Fotos direkt im Browser (spart Speicher & Ladezeit) und lädt sie
// in den Supabase-Storage hoch.
// ============================================================================

import { supabase } from './supabase.js';
import { PHOTO_BUCKET, PHOTO_MAX_KANTE } from './config.js';

/**
 * Verkleinert eine Bilddatei auf max. PHOTO_MAX_KANTE Kantenlänge und gibt
 * einen komprimierten JPEG-Blob zurück.
 * @param {File} datei
 * @returns {Promise<Blob>}
 */
export function verkleinereBild(datei) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(datei);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      const maxKante = PHOTO_MAX_KANTE;
      if (width > maxKante || height > maxKante) {
        if (width >= height) {
          height = Math.round((height * maxKante) / width);
          width = maxKante;
        } else {
          width = Math.round((width * maxKante) / height);
          height = maxKante;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Bild konnte nicht verarbeitet werden'))),
        'image/jpeg',
        0.8 // Qualität 80 % – guter Kompromiss aus Größe und Schärfe
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Datei ist kein gültiges Bild'));
    };
    img.src = url;
  });
}

/**
 * Verkleinert ein Foto und lädt es in den Storage-Bucket hoch.
 * @returns {Promise<string>} storage_path des hochgeladenen Fotos
 */
export async function ladeFotoHoch(datei, machineId, userId) {
  const blob = await verkleinereBild(datei);
  const pfad = `${machineId}/${userId}-${Date.now()}-${zufall()}.jpg`;
  const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(pfad, blob, {
    contentType: 'image/jpeg',
    upsert: false,
  });
  if (error) throw error;
  return pfad;
}

/** Öffentliche/signierte Anzeige-URL für einen Foto-Pfad. */
export function fotoUrl(storagePath) {
  const { data } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(storagePath);
  return data.publicUrl;
}

/** Foto aus Storage und Datenbank löschen. */
export async function loescheFoto(foto) {
  await supabase.storage.from(PHOTO_BUCKET).remove([foto.storage_path]);
  await supabase.from('machine_photos').delete().eq('id', foto.id);
}

function zufall() {
  return Math.random().toString(36).slice(2, 8);
}

import { api } from '../api.js';

// Färgvärden för color_label 1–5
export const COLOR_VALUES = {
  1: '#ef4444', // röd
  2: '#eab308', // gul
  3: '#22c55e', // grön
  4: '#3b82f6', // blå
  5: '#a855f7', // lila
};

let _cache = null;

/**
 * Hämtar thumbnail-inställningar från servern (cachas i minnet tills sidan laddas om).
 * @returns {Promise<{items: string[], position: string, colorLabels: object}>}
 */
export async function getThumbSettings() {
  if (_cache) return _cache;
  try {
    const { data } = await api.getSettings();
    _cache = {
      items:       data.thumb_overlay_items    ?? ['rating', 'flag', 'color_border'],
      position:    data.thumb_overlay_position ?? 'hover',
      colorLabels: data.color_labels           ?? { '1': 'Röd', '2': 'Gul', '3': 'Grön', '4': 'Blå', '5': 'Lila' },
    };
  } catch {
    _cache = { items: [], position: 'hover', colorLabels: {} };
  }
  return _cache;
}

/** Rensa cachen så nästa anrop hämtar färska inställningar. */
export function invalidateThumbSettings() {
  _cache = null;
}

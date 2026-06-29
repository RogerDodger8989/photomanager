import { api } from './api.js';

const _store = {};   // { photos: {...}, folders: {...}, ... }
let _timer   = null;

/** Returnerar sparad vystate för en route, eller null om ingen finns. */
export function getViewState(route) { return _store[route] ?? null; }

/** Sparar vystate i minne och triggar debounced backend-sync. */
export function saveViewState(route, state) {
  if (!state) return;
  _store[route] = state;
  clearTimeout(_timer);
  _timer = setTimeout(_persist, 1500);
}

/** Laddar all sparad nav-state från backend (anropas vid app-init). */
export async function initNavState() {
  try {
    const { data } = await api.getSettings();
    const ns = data?.navigation_state ?? {};
    Object.assign(_store, ns);
  } catch {}
}

async function _persist() {
  try { await api.patchSettings({ navigationState: { ..._store } }); } catch {}
}

// Global applikationsstate — single source of truth

export const state = {
  user: null,          // { id, username, role, permissions: {} }
  currentView: null,   // aktiv vy
  lightbox: {
    items: [],         // array av asset-objekt
    index: 0,
  },
  selectedAssets: new Set(), // multi-select IDs
};

const listeners = {};

export function on(event, fn) {
  if (!listeners[event]) listeners[event] = [];
  listeners[event].push(fn);
}

export function emit(event, data) {
  (listeners[event] ?? []).forEach((fn) => fn(data));
}

export function setUser(user) {
  state.user = user;
  emit('user:changed', user);
}

// Kontrollera om inloggad användare har en specifik rättighet
// Admins har alltid alla rättigheter
export function can(permissionKey) {
  if (!state.user) return false;
  if (state.user.role === 'admin') return true;
  const perms = state.user.permissions ?? {};
  // Om nyckeln inte finns i permissions-tabellen → standardvärde true (tillåtet)
  return perms[permissionKey] ?? true;
}

// Kontrollera om en navigeringslänk ska visas
export function navVisible(key) {
  if (!state.user) return false;
  if (state.user.role === 'admin') return true;
  return state.user.permissions?.[`nav.${key}`] ?? true;
}

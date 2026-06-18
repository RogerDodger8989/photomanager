// Centraliserad API-klient med JWT auto-refresh och felhantering

let accessToken = null;
let refreshPromise = null;

export function setToken(token) {
  const changed = accessToken !== token;
  accessToken = token;
  window.__pmToken = token;
  // Återanslut SSE med ny token om den ändrades
  if (changed && token && typeof window.__pmReconnectSSE === 'function') {
    window.__pmReconnectSSE();
  }
}
export function clearToken()    { accessToken = null; window.__pmToken = null; }
export function hasToken()      { return !!accessToken; }

async function refreshToken() {
  // Förhindra parallella refresh-anrop
  if (refreshPromise) return refreshPromise;

  refreshPromise = fetch('/api/auth/refresh', {
    method: 'POST',
    credentials: 'include',
  }).then(async (res) => {
    refreshPromise = null;
    if (!res.ok) { clearToken(); throw new Error('Session utgången'); }
    const { data } = await res.json();
    setToken(data.accessToken);
    return data.accessToken;
  }).catch((err) => {
    refreshPromise = null;
    throw err;
  });

  return refreshPromise;
}

async function request(method, path, body = null, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

  const res = await fetch(path, {
    method,
    headers,
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined,
    ...opts,
  });

  // Access token utgången → försök refresh
  if (res.status === 401 && accessToken) {
    try {
      await refreshToken();
      // Upprepa ursprungliga anropet med ny token
      return request(method, path, body, opts);
    } catch {
      // Redirect till login
      window.dispatchEvent(new CustomEvent('auth:logout'));
      throw new Error('Session utgången');
    }
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }

  // 204 No Content
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  get:    (path)         => request('GET',    path),
  post:   (path, body)   => request('POST',   path, body),
  put:    (path, body)   => request('PUT',    path, body),
  patch:  (path, body)   => request('PATCH',  path, body),
  delete: (path)         => request('DELETE', path),

  // Auth
  login:   (username, password) => request('POST', '/api/auth/login',  { username, password }),
  logout:  ()                   => request('POST', '/api/auth/logout'),
  me:      ()                   => request('GET',  '/api/auth/me'),

  // Assets
  assets:  (params = {})        => request('GET', `/api/assets?${qs(params)}`),
  asset:         (id)           => request('GET', `/api/assets/${id}`),
  assetMetadata: (id)           => request('GET', `/api/assets/${id}/metadata`),
  patchMeta: (id, body)         => request('PATCH', `/api/assets/${id}/metadata`, body),
  trash:   (id)                 => request('DELETE', `/api/assets/${id}`),
  restore: (id)                 => request('POST', `/api/trash/${id}/restore`, {}),
  trashList: ()                 => request('GET', '/api/trash'),
  permanentDelete: (id)         => request('DELETE', `/api/trash/${id}/permanent`),

  // Search
  search:  (params = {})        => request('GET', `/api/search?${qs(params)}`),

  // Explore
  onThisDay:   ()               => request('GET', '/api/explore/on-this-day'),
  collections: ()               => request('GET', '/api/explore/collections'),
  collection:  (id)             => request('GET', `/api/explore/collections/${id}`),
  trips:       ()               => request('GET', '/api/explore/trips'),
  tripTrack:   (id)             => request('GET', `/api/explore/trips/${id}/track`),
  places:      ()               => request('GET', '/api/explore/places'),
  favorites:   ()               => request('GET', '/api/explore/favorites'),
  addFav:      (id)             => request('POST', `/api/explore/favorites/${id}`, {}),
  removeFav:   (id)             => request('DELETE', `/api/explore/favorites/${id}`),

  // Map
  clusters: (params)            => request('GET', `/api/map/clusters?${qs(params)}`),

  // Persons
  persons:  ()                  => request('GET', '/api/persons'),
  person:   (id, p = {})        => request('GET', `/api/persons/${id}?${qs(p)}`),
  patchPerson: (id, body)       => request('PATCH', `/api/persons/${id}`, body),
  mergePerson:  (id, tid)        => request('POST', `/api/persons/${id}/merge/${tid}`),
  mergePeople:  (body)           => request('POST', '/api/persons/merge', body),
  faces:      (assetId)         => request('GET', `/api/faces/${assetId}`),
  patchFace:  (id, body)        => request('PATCH', `/api/faces/${id}`, body),
  createFace: (body)            => request('POST', '/api/faces', body),
  deleteFace: (id)              => request('DELETE', `/api/faces/${id}`),

  // Albums
  albums:   ()                  => request('GET', '/api/albums'),
  album:    (id, p = {})        => request('GET', `/api/albums/${id}?${qs(p)}`),
  createAlbum:  (body)          => request('POST', '/api/albums', body),
  updateAlbum:  (id, body)      => request('PUT', `/api/albums/${id}`, body),
  deleteAlbum:  (id)            => request('DELETE', `/api/albums/${id}`),
  addToAlbum:   (id, assetIds)  => request('POST', `/api/albums/${id}/assets`, { assetIds }),
  removeFromAlbum: (id, assetId)=> request('DELETE', `/api/albums/${id}/assets/${assetId}`),

  // Shares
  shares:         ()            => request('GET', '/api/shares'),
  received:       ()            => request('GET', '/api/shares/received'),
  createShare:    (body)        => request('POST', '/api/shares', body),
  deleteShare:    (id)          => request('DELETE', `/api/shares/${id}`),
  getPublicShare: (token)       => fetch(`/api/share/${token}`).then(r => r.json()),

  // Folders
  folders: (path = '')          => request('GET', `/api/folders?path=${encodeURIComponent(path)}`),

  // AI
  aiStatus:       ()            => request('GET', '/api/ai/status'),
  aiSuggestions:  (p = {})      => request('GET', `/api/ai/suggestions?${qs(p)}`),
  acceptAi:       (faceId)      => request('POST', `/api/ai/suggestions/${faceId}/accept`),
  rejectAi:       (faceId, b)   => request('POST', `/api/ai/suggestions/${faceId}/reject`, b),

  // Export
  exportZip:    (assetIds)      => request('POST', '/api/export/zip', { assetIds }),
  auditLogCsv:  ()              => '/api/admin/audit-log/csv', // returnerar URL, fetch direkt

  // Push
  vapidKey:        ()           => request('GET', '/api/push/vapid-public-key'),
  pushSubscribe:   (sub)        => request('POST', '/api/push/subscribe', sub),
  pushUnsubscribe: (endpoint)   => request('DELETE', '/api/push/subscribe', { endpoint }),

  // Admin
  adminStats:   ()              => request('GET', '/api/admin/stats'),
  adminJobs:    ()              => request('GET', '/api/admin/jobs'),
  retryJob:     (id)            => request('POST', `/api/admin/jobs/${id}/retry`),
  adminUsers:   ()              => request('GET', '/api/admin/users'),
  createUser:   (body)          => request('POST', '/api/admin/users', body),
  updateUser:   (id, body)      => request('PATCH', `/api/admin/users/${id}`, body),
  setPermissions: (id, perms)   => request('PUT', `/api/admin/users/${id}/permissions`, perms),
  auditLog:     (p = {})        => request('GET', `/api/admin/audit-log?${qs(p)}`),
  duplicates:   ()              => request('GET', '/api/admin/duplicates'),

  // Bevakade mappar
  browseDir:          (path)       => request('GET', `/api/admin/browse?path=${encodeURIComponent(path || '/')}`),
  watchedFolders:     ()           => request('GET', '/api/admin/watched-folders'),
  addWatchedFolder:   (body)       => request('POST', '/api/admin/watched-folders', body),
  patchWatchedFolder: (id, body)   => request('PATCH', `/api/admin/watched-folders/${id}`, body),
  deleteWatchedFolder:(id)         => request('DELETE', `/api/admin/watched-folders/${id}`),
  adminStats2:  ()              => request('GET', '/api/admin/stats'),
};

function qs(params) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

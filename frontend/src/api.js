// Centraliserad API-klient med JWT auto-refresh och felhantering

let accessToken = null;
let refreshPromise = null;

export function setToken(token) {
  const changed = accessToken !== token;
  accessToken = token;
  const w = /** @type {any} */ (window);
  w.__pmToken = token;
  // Återanslut SSE med ny token om den ändrades
  if (changed && token && typeof w.__pmReconnectSSE === 'function') {
    w.__pmReconnectSSE();
  }
}
export function clearToken()    { accessToken = null; /** @type {any} */ (window).__pmToken = null; }
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

/**
 * @param {string} method
 * @param {string} path
 * @param {any} [body]
 * @param {RequestInit} [opts]
 */
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
  editAsset: (id, body)         => request('POST', `/api/assets/${id}/edit`, body),
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
  clusters:      (params)       => request('GET', `/api/map/clusters?${qs(params)}`),
  mapExtent:     ()             => request('GET', '/api/map/extent'),
  clusterPhotos: (params)       => request('GET', `/api/map/cluster-photos?${qs(params)}`),

  // Settings
  getSettings:   ()             => request('GET', '/api/settings'),
  patchSettings: (body)         => request('PATCH', '/api/settings', body),
  personsExport: (id)           => `/api/persons/${id}/export`,
  personsDuplicates: ()         => request('GET', '/api/persons/duplicates'),
  personRelations:   (id)       => request('GET', `/api/persons/${id}/relations`),
  addRelation:       (id, body) => request('POST', `/api/persons/${id}/relations`, body),
  deleteRelation:    (relId)    => request('DELETE', `/api/persons/relations/${relId}`),
  personStats:   (id)           => request('GET', `/api/persons/${id}/stats`),
  faceSearchByImage: (formData) => fetch('/api/faces/search-by-image', { method: 'POST', headers: { 'Authorization': `Bearer ${/** @type {any} */ (window).__pmToken}` }, body: formData }).then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(new Error(e.error)))),

  // Persons
  persons:  (p = {})            => request('GET', `/api/persons?${qs(p)}`),
  person:   (id, p = {})        => request('GET', `/api/persons/${id}?${qs(p)}`),
  patchPerson: (id, body)       => request('PATCH', `/api/persons/${id}`, body),
  mergePerson:  (id, tid)        => request('POST', `/api/persons/${id}/merge/${tid}`),
  mergePeople:  (body)           => request('POST', '/api/persons/merge', body),
  faces:      (assetId)         => request('GET', `/api/faces/${assetId}`),
  patchFace:  (id, body)        => request('PATCH', `/api/faces/${id}`, body),
  createFace: (body)            => request('POST', '/api/faces', body),
  deleteFace: (id)              => request('DELETE', `/api/faces/${id}`),
  unassignedFaces: ()           => request('GET', '/api/faces/unassigned'),
  assignFaces: (body)           => request('POST', '/api/faces/assign', body),
  dismissFaces:   (faceIds) => request('PATCH', '/api/faces/dismiss',   { faceIds }),
  undismissFaces: (faceIds) => request('PATCH', '/api/faces/undismiss', { faceIds }),
  mergeClusters: (fromFaceIds, intoFaceIds) => request('POST', '/api/faces/merge-clusters', { fromFaceIds, intoFaceIds }),
  ungroupFace:        (faceId)               => request('POST', '/api/faces/ungroup', { faceId }),
  computeSuggestions: ()                     => request('POST', '/api/faces/compute-suggestions', {}),

  // Albums
  albums:   (p = {})            => request('GET', p.assetId ? `/api/albums?assetId=${p.assetId}` : '/api/albums'),
  album:    (id, p = {})        => request('GET', `/api/albums/${id}?${qs(p)}`),
  createAlbum:  (body)          => request('POST', '/api/albums', body),
  updateAlbum:  (id, body)      => request('PUT', `/api/albums/${id}`, body),
  deleteAlbum:  (id)            => request('DELETE', `/api/albums/${id}`),
  addToAlbum:   (id, assetIds)  => request('POST', `/api/albums/${id}/assets`, { assetIds }),
  removeFromAlbum: (id, assetId)=> request('DELETE', `/api/albums/${id}/assets/${assetId}`),
  albumRules:      (id)          => request('GET', `/api/albums/${id}/rules`),
  saveAlbumRules:  (id, body)    => request('PUT', `/api/albums/${id}/rules`, body),
  rebuildAlbum:    (id)          => request('POST', `/api/albums/${id}/rebuild`, {}),

  // Shares
  shares:         ()            => request('GET', '/api/shares'),
  received:       ()            => request('GET', '/api/shares/received'),
  createShare:    (body)        => request('POST', '/api/shares', body),
  deleteShare:    (id)          => request('DELETE', `/api/shares/${id}`),
  getPublicShare: (token)       => fetch(`/api/share/${token}`).then(r => r.json()),

  // Folders
  folders:    (path = '')       => request('GET', `/api/folders?path=${encodeURIComponent(path)}`),
  folderTree:    ()             => request('GET', '/api/folders/tree'),
  createFolder:  (body)        => request('POST', '/api/files/create-folder', body),
  moveFiles:     (body)        => request('POST', '/api/files/move', body),
  renameFolder:  (body)        => request('PATCH', '/api/files/rename-folder', body),
  moveFolderTo:  (body)        => request('POST', '/api/files/move-folder', body),
  trashFolder:   (body)        => request('POST', '/api/files/trash-folder', body),

  // AI
  aiStatus:       ()            => request('GET', '/api/ai/status'),
  aiSuggestions:  (p = {})      => request('GET', `/api/ai/suggestions?${qs(p)}`),
  acceptAi:       (faceId)      => request('POST', `/api/ai/suggestions/${faceId}/accept`, {}),
  rejectAi:       (faceId, b)   => request('POST', `/api/ai/suggestions/${faceId}/reject`, b),
  batchAcceptAi:  (faceIds)     => request('POST', '/api/ai/suggestions/batch-accept', { faceIds }),
  aiReindex:      (assetId)     => request('POST', `/api/ai/reindex/${assetId}`, {}),

  // Export — returnerar Blob direkt (inte JSON)
  exportZip: async (assetIds) => {
    const headers = { 'Content-Type': 'application/json' };
    const w = /** @type {any} */ (window);
    if (w.__pmToken) headers['Authorization'] = `Bearer ${w.__pmToken}`;
    const res = await fetch('/api/export/zip', {
      method: 'POST', headers, credentials: 'include',
      body: JSON.stringify({ assetIds }),
    });
    if (!res.ok) { const e = await res.json().catch(() => ({ error: res.statusText })); throw new Error(e.error ?? `HTTP ${res.status}`); }
    return res.blob();
  },
  exportAlbumZip: async (albumId) => {
    const headers = { 'Content-Type': 'application/json' };
    const w = /** @type {any} */ (window);
    if (w.__pmToken) headers['Authorization'] = `Bearer ${w.__pmToken}`;
    const res = await fetch(`/api/export/album/${albumId}`, {
      method: 'POST', headers, credentials: 'include', body: '{}',
    });
    if (!res.ok) { const e = await res.json().catch(() => ({ error: res.statusText })); throw new Error(e.error ?? `HTTP ${res.status}`); }
    return res.blob();
  },
  auditLogCsv:  ()              => '/api/admin/audit-log/csv', // returnerar URL, fetch direkt

  // Push
  vapidKey:        ()           => request('GET', '/api/push/vapid-public-key'),
  pushSubscribe:   (sub)        => request('POST', '/api/push/subscribe', sub),
  pushUnsubscribe: (endpoint)   => request('DELETE', '/api/push/subscribe', { endpoint }),

  // Admin
  adminStats:         ()        => request('GET', '/api/admin/stats'),
  adminJobs:          ()        => request('GET', '/api/admin/jobs'),
  retryJob:           (id)      => request('POST', `/api/admin/jobs/${id}/retry`),
  requeueThumbnails:  ()        => request('POST', '/api/admin/requeue-thumbnails', {}),
  reclusterFaces:     ()        => request('POST', '/api/admin/faces/recluster', {}),
  backfillMotionPhotos: ()      => request('POST', '/api/admin/backfill-motion-photos', {}),
  adminUsers:   ()              => request('GET', '/api/admin/users'),
  createUser:   (body)          => request('POST', '/api/admin/users', body),
  updateUser:   (id, body)      => request('PATCH', `/api/admin/users/${id}`, body),
  setPermissions: (id, perms)   => request('PUT', `/api/admin/users/${id}/permissions`, perms),
  auditLog:     (p = {})        => request('GET', `/api/admin/audit-log?${qs(p)}`),
  rescanAsset:  (id)            => request('POST', `/api/assets/${id}/rescan`, {}),
  geocode:      (q)             => request('GET', `/api/assets/geocode?q=${encodeURIComponent(q)}`),
  setDatetime:  (id, takenAt)   => request('PATCH', `/api/assets/${id}/datetime`, { takenAt }),
  setLocation:  (id, lat, lon, label) => request('PATCH', `/api/assets/${id}/location`, { lat, lon, label }),
  duplicates:   ()              => request('GET', '/api/assets/duplicates'),
  adminDuplicates: ()           => request('GET', '/api/admin/duplicates'),

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

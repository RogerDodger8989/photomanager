import { navVisible, state } from '../state.js';

// Nav-items: [key, label, emoji, route]
const NAV_ITEMS = [
  ['photos',   'Bilder',    '🖼️',  '#/photos'],
  ['explore',  'Utforska',  '✨',  '#/explore'],
  ['map',      'Karta',     '🗺️',  '#/map'],
  ['sharing',  'Delning',   '🔗',  '#/sharing'],
  ['favorites','Favoriter', '❤️',  '#/favorites'],
  ['albums',   'Album',     '🗂️',  '#/albums'],
  ['faces',    'Ansikten',  '👤',  '#/faces'],
  ['folders',  'Mappar',    '📁',  '#/folders'],
  ['upload',   'Ladda upp', '⬆️',  '#/upload'],
];

const ADMIN_ITEMS = [
  ['admin', 'Admin', '⚙️', '#/admin'],
];

export function renderNav() {
  const sidebar   = document.getElementById('nav-links');
  const bottomNav = document.getElementById('bottom-nav-links');
  if (!sidebar || !bottomNav) return;

  const items = [
    ...NAV_ITEMS.filter(([key]) => navVisible(key)),
    ...(state.user?.role === 'admin' ? ADMIN_ITEMS : []),
  ];

  const currentHash = location.hash || '#/photos';

  const sidebarHTML = items.map(([, label, icon, href]) => {
    const active = currentHash.startsWith(href)
      ? 'bg-slate-700 text-white'
      : 'text-slate-400 hover:bg-slate-700 hover:text-white';
    return `
      <a href="${href}" class="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${active}">
        <span class="text-base leading-none">${icon}</span>
        <span>${label}</span>
      </a>`;
  }).join('');

  // Bottom nav: visa max 5 viktigaste
  const bottomItems = items.slice(0, 5);
  const bottomHTML = bottomItems.map(([, label, icon, href]) => {
    const active = currentHash.startsWith(href) ? 'text-blue-400' : 'text-slate-400';
    return `
      <a href="${href}" class="flex flex-col items-center gap-0.5 py-1 px-2 ${active} hover:text-white transition-colors flex-1">
        <span class="text-xl leading-none">${icon}</span>
        <span class="text-[10px]">${label}</span>
      </a>`;
  }).join('');

  sidebar.innerHTML   = sidebarHTML;
  bottomNav.innerHTML = bottomHTML;
}

// Uppdatera aktiv länk när routen byter
export function updateActiveNav() {
  const hash = location.hash || '#/photos';
  document.querySelectorAll('#nav-links a, #bottom-nav-links a').forEach((a) => {
    const isActive = hash.startsWith(a.getAttribute('href'));
    if (a.closest('#nav-links')) {
      a.className = `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
        isActive ? 'bg-slate-700 text-white' : 'text-slate-400 hover:bg-slate-700 hover:text-white'
      }`;
    } else {
      a.className = `flex flex-col items-center gap-0.5 py-1 px-2 ${
        isActive ? 'text-blue-400' : 'text-slate-400'
      } hover:text-white transition-colors flex-1`;
    }
  });
}

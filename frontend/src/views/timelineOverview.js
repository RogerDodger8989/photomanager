import { api } from '../api.js';

const MONTH_SV = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec'];

export async function renderTimelineOverview(container) {
  let mode         = 'decade'; // 'decade' | 'year' | 'month'
  let filterDecade = null;     // t.ex. 1980
  let filterYear   = null;     // t.ex. 2019
  let backLabel    = null;     // label på "tillbaka"-knappen

  function periodLabel(label) {
    if (mode === 'decade') return `${label}-talet`;
    if (mode === 'year')   return String(label);
    // YYYY-MM
    const [y, m] = String(label).split('-');
    return `${MONTH_SV[parseInt(m, 10) - 1]} ${y}`;
  }

  function shell() {
    const modes = [['decade', 'Decennier'], ['year', 'År'], ['month', 'Månader']];
    return `
      <div class="p-4">
        <div class="flex items-center gap-3 mb-6 flex-wrap">
          ${backLabel ? `
            <button id="tlo-back" class="flex items-center gap-1 text-sm text-slate-400 hover:text-white transition-colors shrink-0">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/>
              </svg>${backLabel}
            </button>
            <span class="text-slate-700">|</span>` : ''}
          <h1 class="text-xl font-semibold text-white flex-1">🗓️ Tidslinje</h1>
          <div class="flex gap-1 bg-slate-800 rounded-lg p-1 shrink-0">
            ${modes.map(([m, lbl]) => `
              <button data-mode="${m}" class="tlo-mode px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                m === mode ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'
              }">${lbl}</button>`).join('')}
          </div>
        </div>
        <div id="tlo-content"></div>
      </div>`;
  }

  function bindShell() {
    container.querySelector('#tlo-back')?.addEventListener('click', () => {
      if (mode === 'year') {
        mode = 'decade'; filterDecade = null; backLabel = null;
      } else if (mode === 'month') {
        mode = 'year'; filterYear = null;
        backLabel = filterDecade != null ? `${filterDecade}-talet` : null;
      }
      render();
    });

    container.querySelectorAll('.tlo-mode').forEach((btn) => {
      btn.addEventListener('click', () => {
        mode = btn.dataset.mode;
        filterDecade = null; filterYear = null; backLabel = null;
        render();
      });
    });
  }

  function cardGrid(groups) {
    if (!groups.length) return '<p class="text-slate-400 text-sm">Inga bilder hittades.</p>';

    return `<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
      ${groups.map((g) => {
        const thumbs = g.thumbs ?? [];
        const lbl    = periodLabel(g.label);

        const thumbContent = thumbs.length >= 2
          ? `<div class="grid grid-cols-2 gap-0.5 w-full h-full">
               ${thumbs.slice(0, 4).map((p) =>
                 `<div class="overflow-hidden"><img src="/thumbs/${p}" class="w-full h-full object-cover" loading="lazy" alt=""></div>`
               ).join('')}
             </div>`
          : thumbs[0]
            ? `<img src="/thumbs/${thumbs[0]}" class="w-full h-full object-cover" loading="lazy" alt="">`
            : '<div class="w-full h-full bg-slate-700 flex items-center justify-center text-3xl">📷</div>';

        return `
          <div class="tlo-card bg-slate-800 rounded-xl overflow-hidden cursor-pointer hover:scale-[1.02] transition-transform group"
               data-label="${g.label}">
            <div class="relative overflow-hidden" style="aspect-ratio:4/3">
              ${thumbContent}
              <div class="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent pointer-events-none"></div>
              <div class="absolute bottom-0 left-0 right-0 p-3">
                <div class="text-white font-semibold text-sm leading-tight">${lbl}</div>
                <div class="text-slate-300 text-xs mt-0.5">${Number(g.count).toLocaleString('sv-SE')} bilder</div>
              </div>
            </div>
          </div>`;
      }).join('')}
    </div>`;
  }

  function bindCards() {
    container.querySelectorAll('.tlo-card').forEach((card) => {
      card.addEventListener('click', () => {
        const label = card.dataset.label;

        if (mode === 'decade') {
          // Borra ner till år-vy för detta decennium
          mode = 'year';
          filterDecade = parseInt(label, 10);
          backLabel = `${filterDecade}-talet`;
          render();
        } else if (mode === 'year') {
          // Navigera till bilder-vy filtrerad på år
          window.dispatchEvent(new CustomEvent('pm:timeline-filter', {
            detail: { dateFrom: `${label}-01-01`, dateTo: `${label}-12-31` },
          }));
        } else if (mode === 'month') {
          // Navigera till bilder-vy filtrerad på månad
          const [y, m] = label.split('-');
          const lastDay = new Date(parseInt(y, 10), parseInt(m, 10), 0).getDate();
          window.dispatchEvent(new CustomEvent('pm:timeline-filter', {
            detail: {
              dateFrom: `${y}-${m}-01`,
              dateTo:   `${y}-${m}-${String(lastDay).padStart(2, '0')}`,
            },
          }));
        }
      });
    });
  }

  async function render() {
    container.innerHTML = shell();
    bindShell();

    const content = container.querySelector('#tlo-content');
    content.innerHTML = '<div class="text-slate-400 text-sm animate-pulse">Laddar…</div>';

    try {
      const params = { groupBy: mode };
      if (mode === 'year'  && filterDecade != null) params.decade = filterDecade;
      if (mode === 'month' && filterYear   != null) params.year   = filterYear;

      const { data } = await api.timelineSummary(params);
      content.innerHTML = cardGrid(data);
      bindCards();
    } catch (err) {
      content.innerHTML = `<div class="text-red-400 text-sm">${err.message}</div>`;
    }
  }

  await render();
}

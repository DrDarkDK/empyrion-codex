import { getCategoryIcon } from './categoryIcons.js';
import { escapeHtml } from './renderUtils.js';

const CATEGORY_BORDER = {
  weapon:      '#a855f7',
  building:    '#f97316',
  deco:        '#06b6d4',
  device:      '#6366f1',
  food:        '#84cc16',
  ingredient:  '#eab308',
  medical:     '#22c55e',
  component:   '#3b82f6',
  tool:        '#38bdf8',
  armor:       '#ec4899',
  seed:        '#10b981',
  resource:    '#f59e0b',
};

function getCategoryColor(category) {
  const cat = (category ?? '').toLowerCase();
  for (const [key, color] of Object.entries(CATEGORY_BORDER)) {
    if (cat.startsWith(key) || cat.includes(key)) return color;
  }
  return '#6366f1';
}

/** Tracks the delegated click listener per container so it's replaced on re-render. */
const handlers = new WeakMap();

/** Blob URLs created for the current render — revoked on the next render. */
let activeIconUrls = [];

/**
 * Renders Item objects as a responsive grid of cards.
 * Uses a single innerHTML assignment for performance with large datasets.
 */
export class ItemListRenderer {
  /**
   * @param {import('../parsers/models/Item.js').Item[]} items
   * @param {HTMLElement} containerEl
   * @param {function(import('../parsers/models/Item.js').Item): void} onItemClick
   * @param {function(string): string} [getDisplayName] - Optional name resolver; falls back to item.name
   * @param {function(string): string|null} [getIconUrl] - Optional blob URL resolver; falls back to SVG icon
   */
  render(items, containerEl, onItemClick, getDisplayName = null, getIconUrl = null) {
    if (handlers.has(containerEl)) {
      containerEl.removeEventListener('click', handlers.get(containerEl));
    }

    // Revoke blob URLs from the previous render to release file handles
    for (const url of activeIconUrls) URL.revokeObjectURL(url);
    activeIconUrls = [];

    if (!items.length) {
      containerEl.innerHTML = `<div class="flex flex-col items-center justify-center py-32 text-slate-600">
  <svg xmlns="http://www.w3.org/2000/svg" class="w-12 h-12 mb-4 opacity-20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
  <p class="text-lg font-medium text-slate-500">No items match your search</p>
</div>`;
      return;

    }

    const cards = items.map((item, i) => {
      const rawName  = item.name ?? 'Unknown';
      const name     = getDisplayName ? (getDisplayName(rawName) ?? escapeHtml(rawName)) : escapeHtml(rawName);
      const category = escapeHtml(item.category ?? '—');
      const idBadge  = item.id != null
        ? `<span class="absolute top-4 right-4 text-[10px] font-mono text-slate-600 group-hover:text-slate-400 transition-colors">#${item.id}</span>`
        : '';

      let iconHtml;
      const iconUrl = getIconUrl ? getIconUrl(rawName) : null;
      if (iconUrl) {
        activeIconUrls.push(iconUrl);
        iconHtml = `<img src="${iconUrl}" alt="" class="w-14 h-14 object-contain group-hover:scale-110 transition-transform duration-500" loading="lazy" draggable="false" />`;
      } else if (!getIconUrl) {
        iconHtml = `<span class="[&>svg]:w-8 [&>svg]:h-8 flex items-center justify-center text-slate-400">${getCategoryIcon(item.category)}</span>`;
      } else {
        iconHtml = '';
      }

      const borderColor = getCategoryColor(item.category);
      return `<div class="item-card group relative bg-[#161920] border border-slate-800/40 rounded-2xl p-4 hover:border-slate-700 hover:bg-[#1c2029] cursor-pointer transition-all duration-300 overflow-hidden" data-index="${i}">
  ${idBadge}
  <div class="flex flex-col items-center pt-2 pb-3">
    <div class="w-20 h-20 rounded-xl bg-[#1e2638] flex items-center justify-center border-b-2 group-hover:scale-105 transition-transform duration-500" style="border-bottom-color:${borderColor}">${iconHtml}</div>
    <div class="mt-3 text-center w-full min-w-0">
      <p class="text-[13px] font-bold text-slate-100 group-hover:text-white truncate transition-colors">${name}</p>
    </div>
  </div>
  <div class="border-t border-slate-800/30 mt-1 pt-2.5 flex justify-between items-center">
    <span class="text-[10px] text-slate-500">${category}</span>
    <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 text-slate-700 group-hover:text-blue-500 group-hover:translate-x-1 transition-all" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
  </div>
</div>`;
    }).join('');

    containerEl.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px">${cards}</div>`;

    const handler = (e) => {
      const card = e.target.closest('.item-card');
      if (!card) return;
      onItemClick(items[Number(card.dataset.index)]);
    };
    handlers.set(containerEl, handler);
    containerEl.addEventListener('click', handler);
  }
}

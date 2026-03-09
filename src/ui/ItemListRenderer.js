import { getCategoryIcon } from './categoryIcons.js';
import { escapeHtml } from './renderUtils.js';

/** ECF AllowPlacingAt code → { label, color } */
const VESSEL_DOTS = {
  Base: { label: 'Base', color: '#ff4444' },
  MS:   { label: 'Capital Vessel', color: '#ffea00' },
  GV:   { label: 'Hover Vessel', color: '#1760ff' },
  SS:   { label: 'Small Vessel', color: '#44ff44' },
};

/**
 * Returns HTML for the stacked vessel-type dot badges, or '' if none.
 * @param {import('../parsers/models/Item.js').Item} item
 * @returns {string}
 */
function vesselDotsHtml(item) {
  const raw = item.properties?.find(p => p.key === 'AllowPlacingAt')?.value;
  if (!raw) return '';
  const dots = String(raw).split(',').map(s => s.trim()).filter(Boolean)
    .map(code => VESSEL_DOTS[code])
    .filter(Boolean);
  if (!dots.length) return '';
  return dots.map(({ label, color }) =>
    `<span style="background:${color}" title="${label}" class="block w-2 h-2 rounded-sm opacity-90"></span>`,
  ).join('');
}

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

/** Tracks delegated click handlers per container to prevent stacking on re-render. */
const _itemHandlers = new WeakMap();

/**
 * Renders Item objects as a responsive grid of cards.
 * Cards are lazily filled using IntersectionObserver so only visible (+ nearby) cards
 * create full DOM subtrees and blob URLs, keeping memory usage low.
 */
export class ItemListRenderer {
  constructor() {
    /** Blob URLs created during lazy fills — revoked on the next render. */
    this._iconUrls = [];
    /** Active IntersectionObserver — disconnected on re-render. */
    this._observer = null;
    /** Items array from the most recent render — used by updatePinStates. */
    this._items = [];
    /** compareOptions from the most recent render — updated by updatePinStates. */
    this._compareOptions = null;
  }

  /**
   * @param {import('../parsers/models/Item.js').Item[]} items
   * @param {HTMLElement} containerEl
   * @param {function(import('../parsers/models/Item.js').Item): void} onItemClick
   * @param {function(string): string} [getDisplayName] - Optional name resolver; falls back to item.name
   * @param {function(string): string|null} [getIconUrl] - Optional blob URL resolver; falls back to SVG icon
   * @param {{ pinnedNames?: Set<string>, onCompareToggle?: function(import('../parsers/models/Item.js').Item): void }|null} [compareOptions]
   */
  render(items, containerEl, onItemClick, getDisplayName = null, getIconUrl = null, compareOptions = null) {
    // Clean up previous render
    for (const url of this._iconUrls) URL.revokeObjectURL(url);
    this._iconUrls = [];
    this._observer?.disconnect();
    this._observer = null;

    if (_itemHandlers.has(containerEl)) {
      containerEl.removeEventListener('click', _itemHandlers.get(containerEl));
      _itemHandlers.delete(containerEl);
    }

    if (!items.length) {
      containerEl.innerHTML = `<div class="flex flex-col items-center justify-center py-32 text-slate-600">
  <svg xmlns="http://www.w3.org/2000/svg" class="w-12 h-12 mb-4 opacity-20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
  <p class="text-lg font-medium text-slate-500">No items match your search</p>
</div>`;
      return;
    }

    // Build the grid with lightweight placeholder skeletons.
    // Full card content is injected lazily as each placeholder enters the viewport.
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px';

    for (let i = 0; i < items.length; i++) {
      const rawName     = items[i].name ?? 'Unknown';
      const displayName = getDisplayName ? (getDisplayName(rawName) ?? escapeHtml(rawName)) : escapeHtml(rawName);
      const isPinned    = compareOptions?.pinnedNames?.has(rawName) ?? false;
      const pinnedRing  = isPinned ? ' ring-2 ring-blue-500/60 bg-[#161f38]' : '';

      const ph = document.createElement('div');
      ph.className = `item-card group relative bg-[#161920] border border-slate-800/40 rounded-2xl p-4 hover:border-slate-700 hover:bg-[#1c2029] cursor-pointer transition-all duration-300 overflow-hidden${pinnedRing}`;
      ph.dataset.index = String(i);
      ph.innerHTML =
        `<div class="flex flex-col items-center pt-2 pb-3">` +
        `<div class="w-20 h-20 rounded-xl bg-zinc-800/80 animate-pulse"></div>` +
        `<div class="mt-3 text-center w-full min-w-0">` +
        `<p class="text-[13px] font-bold text-slate-100 truncate">${displayName}</p>` +
        `</div></div>` +
        `<div class="border-t border-slate-800/30 mt-1 pt-2.5">` +
        `<div class="h-2 w-2/5 bg-zinc-800/80 rounded-full animate-pulse"></div>` +
        `</div>`;
      grid.appendChild(ph);
    }

    this._items = items;
    this._compareOptions = compareOptions;

    containerEl.innerHTML = '';
    containerEl.appendChild(grid);

    // Delegated click handler (card click + compare-pin button)
    const handler = (e) => {
      const pinBtn = e.target.closest('[data-compare-pin]');
      if (pinBtn) {
        e.stopPropagation();
        compareOptions?.onCompareToggle?.(items[Number(pinBtn.dataset.comparePin)]);
        return;
      }
      const card = e.target.closest('.item-card');
      if (!card) return;
      onItemClick(items[Number(card.dataset.index)]);
    };
    _itemHandlers.set(containerEl, handler);
    containerEl.addEventListener('click', handler);

    // Lazily fill cards as they scroll near the viewport.
    // root: null observes relative to the browser viewport, which is correct here
    // since the items grid is nested inside the overflow-scroll parent, not equal to it.
    this._observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = /** @type {HTMLElement} */ (entry.target);
        const idx = Number(el.dataset.index);
        el.innerHTML = this._cardInner(items[idx], idx, getDisplayName, getIconUrl, this._compareOptions);
        this._observer.unobserve(el);
      }
    }, { root: null, rootMargin: '600px 0px' });

    for (const el of grid.children) this._observer.observe(el);
  }

  /**
   * Surgically updates the pin-button state and ring highlight for each rendered card
   * without triggering a full re-render. Call this when only the pinned set changes.
   * @param {HTMLElement} containerEl
   * @param {Set<string>} pinnedNames
   */
  updatePinStates(containerEl, pinnedNames) {
    // Keep stored compareOptions in sync so future lazy fills use the fresh pin state.
    if (this._compareOptions) {
      this._compareOptions = { ...this._compareOptions, pinnedNames };
    }

    const grid = containerEl.firstElementChild;
    if (!grid) return;

    const PINNED_CLS   = 'absolute top-2 left-2 w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold bg-blue-600 text-white z-10 before:content-[""] before:absolute before:-inset-3 md:before:content-none';
    const UNPINNED_CLS = 'absolute top-2 left-2 w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold text-slate-400 hover:text-blue-400 bg-zinc-800 md:bg-zinc-900/80 border border-slate-500 md:border-slate-700 hover:border-blue-400/60 md:opacity-0 md:group-hover:opacity-100 transition-all z-10 before:content-[""] before:absolute before:-inset-3 md:before:content-none';

    for (const node of grid.children) {
      const el       = /** @type {HTMLElement} */ (node);
      const item     = this._items[Number(el.dataset.index)];
      if (!item) continue;
      const isPinned = pinnedNames.has(item.name ?? 'Unknown');

      // Update outer-ring highlight (set on the placeholder wrapper during render)
      el.classList.toggle('ring-2',           isPinned);
      el.classList.toggle('ring-blue-500/60', isPinned);
      el.classList.toggle('bg-[#161f38]',     isPinned);

      // Update pin button — only present after the card has been lazily filled
      const pinBtn = /** @type {HTMLElement|null} */ (el.querySelector('[data-compare-pin]'));
      if (!pinBtn) continue;
      pinBtn.className  = isPinned ? PINNED_CLS : UNPINNED_CLS;
      pinBtn.textContent = isPinned ? '✓' : '';
      pinBtn.title      = isPinned ? 'Remove from comparison' : 'Add to comparison';
      pinBtn.setAttribute('aria-label', isPinned ? 'Remove from comparison' : 'Add to comparison');
    }
  }

  /** Returns the inner HTML for an item card (the outer wrapper is the placeholder div). */
  _cardInner(item, i, getDisplayName, getIconUrl, compareOptions) {
    const rawName  = item.name ?? 'Unknown';
    const name     = getDisplayName ? (getDisplayName(rawName) ?? escapeHtml(rawName)) : escapeHtml(rawName);
    const category = escapeHtml(item.category ?? '—');
    const idBadge  = item.id != null
      ? `<span class="absolute top-4 right-4 text-[10px] font-mono text-slate-600 group-hover:text-slate-400 transition-colors">#${item.id}</span>`
      : '';

    let iconHtml;
    const iconUrl = getIconUrl ? getIconUrl(rawName) : null;
    if (iconUrl) {
      // Only blob URLs need to be tracked for revocation; data URLs do not.
      if (iconUrl.startsWith('blob:')) this._iconUrls.push(iconUrl);
      iconHtml = `<img src="${escapeHtml(iconUrl)}" alt="" class="w-14 h-14 object-contain group-hover:scale-110 transition-transform duration-500" loading="lazy" draggable="false" />`;
    } else if (!getIconUrl) {
      iconHtml = `<span class="[&>svg]:w-8 [&>svg]:h-8 flex items-center justify-center text-slate-400">${getCategoryIcon(item.category)}</span>`;
    } else {
      iconHtml = '';
    }

    const borderColor = getCategoryColor(item.category);
    const vesselDots  = vesselDotsHtml(item);

    const isPinned    = compareOptions?.pinnedNames?.has(rawName) ?? false;
    const pinBtnClass = isPinned
      ? 'absolute top-2 left-2 w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold bg-blue-600 text-white z-10 before:content-[""] before:absolute before:-inset-3 md:before:content-none'
      : 'absolute top-2 left-2 w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold text-slate-400 hover:text-blue-400 bg-zinc-800 md:bg-zinc-900/80 border border-slate-500 md:border-slate-700 hover:border-blue-400/60 md:opacity-0 md:group-hover:opacity-100 transition-all z-10 before:content-[""] before:absolute before:-inset-3 md:before:content-none';
    const pinBtn = compareOptions
      ? `<button data-compare-pin="${i}" class="${pinBtnClass}" title="${isPinned ? 'Remove from comparison' : 'Add to comparison'}" aria-label="${isPinned ? 'Remove from comparison' : 'Add to comparison'}">${isPinned ? '✓' : ''}</button>`
      : '';

    return (
      `${idBadge}` +
      `${pinBtn}` +
      `<div class="flex flex-col items-center pt-2 pb-3">` +
      `<div class="relative w-20 h-20 rounded-xl bg-[#1e2638] flex items-center justify-center border-b-2 group-hover:scale-105 transition-transform duration-500" style="border-bottom-color:${borderColor}">${iconHtml}${vesselDots ? `<div class="absolute top-1 right-1 flex flex-col gap-0.5 items-center">${vesselDots}</div>` : ''}</div>` +
      `<div class="mt-3 text-center w-full min-w-0">` +
      `<p class="text-[13px] font-bold text-slate-100 group-hover:text-white truncate transition-colors">${name}</p>` +
      `</div></div>` +
      `<div class="border-t border-slate-800/30 mt-1 pt-2.5 flex justify-between items-center">` +
      `<span class="text-[10px] text-slate-500">${category}</span>` +
      `<svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 text-slate-700 group-hover:text-blue-500 group-hover:translate-x-1 transition-all" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>` +
      `</div>`
    );
  }
}

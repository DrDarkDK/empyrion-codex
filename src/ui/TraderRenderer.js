import { escapeHtml, estimatePriceRange, parseQtyRange } from './renderUtils.js';

/** Tracks delegated click handlers per container to prevent stacking on re-render. */
const _traderHandlers = new WeakMap();

/**
 * Renders a grid of trader cards into a container element.
 * Cards are lazily filled using IntersectionObserver so only visible (+ nearby) cards
 * create full DOM subtrees and blob URLs, keeping memory usage low.
 */
export class TraderRenderer {
  constructor() {
    /** Blob URLs created during lazy fills — revoked on the next render. */
    this._iconUrls = [];
    /** Active IntersectionObserver — disconnected on re-render. */
    this._observer = null;
  }

  /**
   * @param {import('../parsers/models/TraderNPC.js').TraderNPC[]} traders
   * @param {HTMLElement} containerEl
   * @param {object}   [options]
   * @param {function(string): string}      [options.resolveLocalized] - Localization resolver
   * @param {function(string): void}        [options.onItemClick]      - Called with devName when an item chip is clicked
   * @param {function(string): string|null} [options.resolveIconUrl]   - Icon blob URL resolver
   * @param {number}                        [options.npcSellMax]       - Hide sell chips priced above this (0 = off)
   * @param {number}                        [options.npcBuyMin]        - Hide buy chips priced below this (0 = off)
   * @param {function(string): number|null} [options.getMarketPrice]   - Market price resolver
   * @param {'all'|'sells'|'buys'}          [options.tradingShow]      - Direction filter
   * @param {function(string): void}        [options.onTraderClick]    - Called with trader devName on click
   * @param {string}                        [options.itemSearchQuery]  - Filter chips by search text
   * @param {function(string): number}      [options.getLocationCount] - Returns annotation count for a trader devName
   */
  render(traders, containerEl, options = {}) {
    const {
      resolveLocalized = null,
      onItemClick = null,
      resolveIconUrl = null,
      npcSellMax = 0,
      npcBuyMin = 0,
      getMarketPrice = null,
      tradingShow = 'all',
      onTraderClick = null,
      itemSearchQuery = '',
      getLocationCount = null,
    } = options;
    // Clean up previous render
    for (const url of this._iconUrls) URL.revokeObjectURL(url);
    this._iconUrls = [];
    this._observer?.disconnect();
    this._observer = null;

    if (_traderHandlers.has(containerEl)) {
      containerEl.removeEventListener('click', _traderHandlers.get(containerEl));
      _traderHandlers.delete(containerEl);
    }

    if (!traders.length) {
      containerEl.innerHTML = '<p class="text-xs text-slate-700 text-center py-20 italic select-none">No traders loaded.</p>';
      return;
    }

    // Build the grid with lightweight placeholder skeletons.
    // Full card content is injected lazily as each placeholder enters the viewport.
    const grid = document.createElement('div');
    grid.className = 'columns-1 min-[700px]:columns-2 gap-4';

    for (let i = 0; i < traders.length; i++) {
      const displayName = resolveLocalized
        ? (resolveLocalized(traders[i].name ?? '') || escapeHtml(traders[i].name || 'Unknown Trader'))
        : escapeHtml(traders[i].name ?? 'Unknown Trader');
      const ph = document.createElement('div');
      ph.className = 'bg-[#161920] rounded-xl border border-zinc-800/60 p-4 flex flex-col gap-3 mb-4 break-inside-avoid';
      ph.dataset.traderIdx = String(i);
      ph.innerHTML =
        `<button data-trader-ref="${escapeHtml(traders[i].name ?? '')}" class="text-sm font-bold text-white truncate text-left hover:text-amber-400 transition-colors">${displayName}</button>` +
        `<div class="flex flex-col gap-1.5 mt-1">` +
        `<div class="h-2 bg-zinc-800/80 rounded-full w-2/3 animate-pulse"></div>` +
        `<div class="h-2 bg-zinc-800/80 rounded-full w-1/2 animate-pulse"></div>` +
        `</div>`;
      grid.appendChild(ph);
    }

    containerEl.innerHTML = '';
    containerEl.appendChild(grid);

    // Delegated click handler (item chips + trader name)
    if (onItemClick || onTraderClick) {
      const handler = (e) => {
        const itemBtn = e.target.closest('[data-trader-item]');
        if (itemBtn && onItemClick) { onItemClick(itemBtn.dataset.traderItem); return; }
        const traderBtn = e.target.closest('[data-trader-ref]');
        if (traderBtn && onTraderClick) { onTraderClick(traderBtn.dataset.traderRef); }
      };
      _traderHandlers.set(containerEl, handler);
      containerEl.addEventListener('click', handler);
    }

    // Lazily fill cards as they scroll near the viewport.
    // root = containerEl (the overflow scroll parent) so rootMargin is relative to it.
    this._observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = /** @type {HTMLElement} */ (entry.target);
        const idx = Number(el.dataset.traderIdx);
        const inner = this._cardInner(
          traders[idx], resolveLocalized, resolveIconUrl, npcSellMax, npcBuyMin, getMarketPrice, tradingShow, itemSearchQuery, getLocationCount
        );
        if (inner === null) {
          el.style.display = 'none';
        } else {
          el.innerHTML = inner;
        }
        this._observer.unobserve(el);
      }
    }, { root: containerEl, rootMargin: '600px 0px' });

    for (const el of grid.children) this._observer.observe(el);
  }

  /** Returns the inner HTML for a trader card (the outer wrapper is the placeholder div). */
  _cardInner(trader, resolveLocalized, resolveIconUrl, npcSellMax, npcBuyMin, getMarketPrice, tradingShow, itemSearchQuery = '', getLocationCount = null) {
    const name = resolveLocalized
      ? (resolveLocalized(trader.name ?? '') || escapeHtml(trader.name || 'Unknown Trader'))
      : escapeHtml(trader.name ?? 'Unknown Trader');

    const discountBadge = trader.discount != null
      ? `<span class="shrink-0 text-[10px] px-2 py-0.5 rounded-full bg-emerald-950 border border-emerald-800/60 text-emerald-400 font-medium">${Math.round(Number(trader.discount) * 100)}% discount</span>`
      : '';

    const locationCount = getLocationCount ? (getLocationCount(trader.name) ?? 0) : 0;
    const pinBadge = locationCount > 0
      ? `<span class="shrink-0 flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-teal-950/50 border border-teal-800/50 text-teal-400">` +
          `<svg xmlns="http://www.w3.org/2000/svg" class="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
            `<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>` +
          `</svg>` +
          `${locationCount}</span>`
      : '';

    let quoteHtml = '';
    if (trader.sellingText) {
      const text = escapeHtml(String(trader.sellingText)).replace(/\\n/g, ' ');
      quoteHtml = `<p class="text-[11px] text-slate-500 italic leading-relaxed line-clamp-2">"${text}"</p>`;
    }

    const sellingHtml = this._itemSection(trader.sellingItems, resolveLocalized, true,  resolveIconUrl, npcSellMax, npcBuyMin, getMarketPrice, tradingShow, itemSearchQuery);
    const buyingHtml  = this._itemSection(trader.buyingItems,  resolveLocalized, false, resolveIconUrl, npcSellMax, npcBuyMin, getMarketPrice, tradingShow, itemSearchQuery);

    if (!sellingHtml && !buyingHtml) return null;

    const sectionsHtml = (sellingHtml && buyingHtml)
      ? `<div class="grid grid-cols-1 min-[420px]:grid-cols-2 gap-x-4 gap-y-3 min-w-0">${sellingHtml}${buyingHtml}</div>`
      : (sellingHtml || buyingHtml);

    const badgesHtml = [pinBadge, discountBadge].filter(Boolean).join('');
    return (
      `<div class="flex items-start justify-between gap-3 min-w-0">` +
      `<button data-trader-ref="${escapeHtml(trader.name ?? '')}" class="text-sm font-bold text-white truncate text-left hover:text-amber-400 transition-colors flex-1 min-w-0">${name}</button>` +
      (badgesHtml ? `<div class="flex items-center gap-1.5 shrink-0">${badgesHtml}</div>` : '') +
      `</div>` +
      `${quoteHtml}${sectionsHtml}`
    );
  }

  _itemSection(items, resolveLocalized, isSell, resolveIconUrl, npcSellMax, npcBuyMin, getMarketPrice, tradingShow = 'all', itemSearchQuery = '') {
    // Hide section when the show-direction filter excludes it
    if (isSell  && tradingShow === 'buys')  return '';
    if (!isSell && tradingShow === 'sells') return '';

    // Apply price filters
    let visibleItems = items;
    if (isSell && npcSellMax > 0) {
      visibleItems = items.filter(item => {
        const range = estimatePriceRange(item.sellMfRange, getMarketPrice?.(item.devName) ?? null);
        return range === null || range.lo <= npcSellMax;
      });
    } else if (!isSell && npcBuyMin > 0) {
      visibleItems = items.filter(item => {
        const range = estimatePriceRange(item.buyMfRange, getMarketPrice?.(item.devName) ?? null);
        return range === null || range.hi >= npcBuyMin;
      });
    }

    // Item search filter: only show chips that match the query
    if (itemSearchQuery) {
      visibleItems = visibleItems.filter(item => {
        const html = resolveLocalized ? (resolveLocalized(item.devName) ?? '') : '';
        const plain = html ? html.replace(/<[^>]*>/g, '') : (item.devName ?? '');
        return plain.toLowerCase().includes(itemSearchQuery);
      });
    }

    // Sort: sell items cheapest first (best player deals); buy items highest total credit first
    if (isSell) {
      visibleItems = [...visibleItems].sort((a, b) => {
        const rA = estimatePriceRange(a.sellMfRange, getMarketPrice?.(a.devName) ?? null);
        const rB = estimatePriceRange(b.sellMfRange, getMarketPrice?.(b.devName) ?? null);
        return (rA ? rA.lo : Infinity) - (rB ? rB.lo : Infinity);
      });
    } else {
      visibleItems = [...visibleItems].sort((a, b) => {
        const rA = estimatePriceRange(a.buyMfRange, getMarketPrice?.(a.devName) ?? null);
        const rB = estimatePriceRange(b.buyMfRange, getMarketPrice?.(b.devName) ?? null);
        const qA = parseQtyRange(a.buyQtyRange);
        const qB = parseQtyRange(b.buyQtyRange);
        return ((rB && qB) ? qB.hi * rB.hi : -1) - ((rA && qA) ? qA.hi * rA.hi : -1);
      });
    }

    if (!visibleItems.length) return '';

    const label    = isSell ? 'Sells to you' : 'Buys from you';
    const labelCls = isSell ? 'text-emerald-600' : 'text-amber-600';

    // Pre-compute total credit values for heat-scale colouring on buy chips
    const creditValues = !isSell ? visibleItems.map(item => {
      const r = estimatePriceRange(item.buyMfRange, getMarketPrice?.(item.devName) ?? null);
      const q = parseQtyRange(item.buyQtyRange);
      return (r && q) ? q.hi * r.hi : 0;
    }) : null;
    const maxCredit = creditValues ? Math.max(1, ...creditValues) : 1;

    const chips = visibleItems.map((item, idx) => {
      const display = resolveLocalized ? (resolveLocalized(item.devName) ?? escapeHtml(item.devName)) : escapeHtml(item.devName);
      const qty     = isSell ? item.sellQtyRange : item.buyQtyRange;
      const qtyStr  = qty ? ` · ${String(qty).replace(/-/g, '\u2013')}` : '';

      // Credit range for buy chips: qty × per-unit price
      let creditStr = '';
      if (!isSell) {
        const mp         = getMarketPrice?.(item.devName) ?? null;
        const priceRange = estimatePriceRange(item.buyMfRange, mp);
        const qtyRange   = parseQtyRange(item.buyQtyRange);
        if (priceRange && qtyRange) {
          const lo = Math.round(qtyRange.lo * priceRange.lo);
          const hi = Math.round(qtyRange.hi * priceRange.hi);
          creditStr = lo === hi
            ? ` · ${lo.toLocaleString()} cr`
            : ` · ${lo.toLocaleString()}\u2013${hi.toLocaleString()} cr`;
        }
      }

      // Per-chip colour: sell chips are uniform; buy chips use a heat scale
      let chipCls;
      if (isSell) {
        chipCls = 'bg-emerald-950/30 border-emerald-800/50 text-emerald-300 hover:border-emerald-600/70 hover:bg-emerald-950/60';
      } else {
        const ratio = creditValues[idx] / maxCredit;
        chipCls = ratio >= 0.5
          ? 'bg-amber-900/50 border-amber-600/60 text-amber-100 hover:border-amber-500/80 hover:bg-amber-900/70'
          : ratio >= 0.15
          ? 'bg-amber-950/30 border-amber-800/50 text-amber-300 hover:border-amber-600/70 hover:bg-amber-950/60'
          : 'bg-amber-950/20 border-amber-900/40 text-amber-500/70 hover:border-amber-800/50 hover:bg-amber-950/40';
      }

      let iconHtml = '';
      if (resolveIconUrl) {
        const url = resolveIconUrl(item.devName);
        if (url) {
          if (url.startsWith('blob:')) this._iconUrls.push(url);
          iconHtml = `<img src="${escapeHtml(url)}" alt="" class="w-4 h-4 object-contain shrink-0" loading="lazy" draggable="false" />`;
        }
      }

      const text = `${display}${qtyStr}${creditStr}`;
      return `<button data-trader-item="${escapeHtml(item.devName)}" class="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border ${chipCls} transition-colors">${iconHtml}<span>${text}</span></button>`;
    }).join('');

    return (
      `<div class="flex flex-col min-w-0">` +
      `<p class="text-[10px] ${labelCls} uppercase tracking-widest mb-1.5">${label}</p>` +
      `<div class="flex flex-col gap-0.5">${chips}</div>` +
      `</div>`
    );
  }
}


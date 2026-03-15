import { escapeHtml, formatPrice, parseQtyRange, estimatePriceRange, setContainerClickHandler } from './renderUtils.js';


/**
 * Renders the detail view of a single trader into a container element.
 */
export class TraderDetailRenderer {
  constructor() {
    /** Blob URLs created this render — revoked on the next render. */
    this._iconUrls = [];
  }

  /**
   * @param {import('../parsers/models/TraderNPC.js').TraderNPC} trader
   * @param {HTMLElement} containerEl
   * @param {object}   [options]
   * @param {function(string): string}      [options.resolveLocalized] - Localization resolver
   * @param {function(string): void}        [options.onItemClick]      - Called with devName when an item chip is clicked
   * @param {function(string): string|null} [options.resolveIconUrl]   - Icon blob URL resolver
   * @param {function(string): number|null} [options.getMarketPrice]   - Market price resolver
   */
  render(trader, containerEl, options = {}) {
    const {
      resolveLocalized = null,
      onItemClick = null,
      resolveIconUrl = null,
      getMarketPrice = null,
    } = options;
    for (const url of this._iconUrls) URL.revokeObjectURL(url);
    this._iconUrls = [];

    const html = [
      this._metaSection(trader, resolveLocalized),
      this._itemsSection('Sells to You', trader.sellingItems, true,  resolveLocalized, resolveIconUrl, getMarketPrice),
      this._itemsSection('Buys from You', trader.buyingItems, false, resolveLocalized, resolveIconUrl, getMarketPrice),
    ].filter(Boolean).join('');

    containerEl.innerHTML = html || '<p class="text-xs text-zinc-600 italic">No details available.</p>';

    const handler = onItemClick
      ? (e) => { const btn = e.target.closest('[data-slot-item]'); if (btn) onItemClick(btn.dataset.slotItem); }
      : null;
    setContainerClickHandler(containerEl, handler);
  }

  _metaSection(trader, resolveLocalized) {
    const rows = [];
    if (trader.discount != null && Number(trader.discount) !== 0) {
      rows.push(['Discount', `${Math.round(Number(trader.discount) * 100)}%`]);
    }
    if (trader.sellingGoods?.length) {
      rows.push(['Selling Categories', escapeHtml(trader.sellingGoods.join(', '))]);
    }
    if (trader.sellingText) {
      const raw = String(trader.sellingText);
      const text = resolveLocalized ? (resolveLocalized(raw) ?? escapeHtml(raw)) : escapeHtml(raw);
      rows.push(['Selling Text', text]);
    }
    if (!rows.length) return '';
    const tableHtml = `<div class="divide-y divide-zinc-800/40">${
      rows.map(([k, v]) =>
        `<div class="flex flex-col sm:flex-row sm:items-start gap-0.5 sm:gap-3 py-2 px-1 text-sm">` +
        `<span class="text-[10px] sm:text-sm text-zinc-500 sm:w-36 sm:shrink-0">${escapeHtml(k)}</span>` +
        `<span class="text-zinc-200">${v}</span></div>`
      ).join('')
    }</div>`;
    return this._section('General', tableHtml, 'sky');
  }

  _itemsSection(label, items, isSell, resolveLocalized, resolveIconUrl, getMarketPrice) {
    if (!items.length) return '';

    const colorCls = isSell ? 'text-amber-800' : 'text-emerald-800';
    const headerItemCls = isSell ? 'text-amber-800' : 'text-emerald-800';
    const sectionColor  = isSell ? 'amber' : 'emerald';

    const header = `<div class="hidden sm:flex gap-3 px-3 py-2 border-b border-zinc-800/60 text-[11px] uppercase tracking-widest text-zinc-600">` +
      `<span class="flex-1 ${headerItemCls}">Item</span>` +
      `<span class="w-16 text-right shrink-0">Stock</span>` +
      `<span class="w-20 text-right shrink-0">Price</span>` +
      (!isSell ? `<span class="w-24 text-right shrink-0">Total</span>` : '') +
      `</div>`;

    // Pre-compute per-item credit ranges so we can sort, render, and total in one pass.
    const enriched = items.map(item => {
      const qty  = isSell ? item.sellQtyRange : item.buyQtyRange;
      const mf   = isSell ? item.sellMfRange  : item.buyMfRange;
      const pRange = estimatePriceRange(mf, getMarketPrice ? getMarketPrice(item.devName) : null);
      const qRange = parseQtyRange(qty);
      const creditLo = (pRange && qRange) ? Math.round(qRange.lo * pRange.lo) : null;
      const creditHi = (pRange && qRange) ? Math.round(qRange.hi * pRange.hi) : null;
      return { item, qty, mf, creditLo, creditHi };
    });

    enriched.sort((a, b) => (b.creditHi ?? -1) - (a.creditHi ?? -1));

    const rows = enriched.map(({ item, qty, mf, creditLo, creditHi }) => {
      const display  = resolveLocalized ? (resolveLocalized(item.devName) ?? escapeHtml(item.devName)) : escapeHtml(item.devName);
      const qParts   = qty ? String(qty).split('-') : null;
      const qtyStr   = qParts
        ? (qParts.length === 2 && qParts[0].trim() === qParts[1].trim() ? qParts[0].trim() : String(qty).replace(/-/g, '\u2013'))
        : '\u2014';
      const priceStr = formatPrice(mf) ?? '\u2014';
      const creditStr = (!isSell && creditLo != null && creditHi != null)
        ? (creditLo === creditHi ? `${creditLo.toLocaleString()} cr` : `${creditLo.toLocaleString()}\u2013${creditHi.toLocaleString()} cr`)
        : '';

      let iconHtml = '';
      if (resolveIconUrl) {
        const url = resolveIconUrl(item.devName);
        if (url) {
          if (url.startsWith('blob:')) this._iconUrls.push(url);
          iconHtml = `<img src="${escapeHtml(url)}" alt="" class="w-4 h-4 object-contain shrink-0" loading="lazy" draggable="false" />`;
        }
      }

      const inner = `${iconHtml}<span>${display}</span>`;
      const hoverCls = isSell
        ? 'hover:border-amber-500/50 hover:text-amber-300 hover:bg-amber-500/10'
        : 'hover:border-emerald-500/50 hover:text-emerald-300 hover:bg-emerald-500/10';
      const chip  = `<button data-slot-item="${escapeHtml(item.devName)}" ` +
        `class="flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700 text-slate-300 ` +
        `${hoverCls} transition-all cursor-pointer">${inner}</button>`;

      return `<div class="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 px-3 py-2 odd:bg-zinc-800/20 text-sm">` +
        `<div class="flex-1 min-w-0">${chip}</div>` +
        `<div class="sm:hidden flex items-center gap-1.5 text-xs">` +
          `<span class="text-zinc-600 text-[10px] uppercase tracking-wide">Stock</span>` +
          `<span class="${colorCls} tabular-nums">${escapeHtml(qtyStr)}</span>` +
          `<span class="text-zinc-700 mx-0.5">·</span>` +
          `<span class="text-zinc-600 text-[10px] uppercase tracking-wide">Price</span>` +
          `<span class="text-zinc-500 tabular-nums">${escapeHtml(priceStr)}</span>` +
          (!isSell && creditStr ? `<span class="text-zinc-700 mx-0.5">·</span><span class="text-zinc-600 tabular-nums">${escapeHtml(creditStr)}</span>` : '') +
        `</div>` +
        `<span class="hidden sm:inline-block ${colorCls} w-16 text-right shrink-0 tabular-nums">${escapeHtml(qtyStr)}</span>` +
        `<span class="hidden sm:inline-block text-zinc-500 w-20 text-right shrink-0 tabular-nums">${escapeHtml(priceStr)}</span>` +
        (!isSell ? `<span class="hidden sm:inline-block text-zinc-600 w-24 text-right shrink-0 tabular-nums">${escapeHtml(creditStr || '\u2014')}</span>` : '') +
        `</div>`;
    }).join('');

    // Total earnings footer (buy side only, when market price data is available)
    let footerHtml = '';
    if (!isSell) {
      const knownItems = enriched.filter(e => e.creditLo != null && e.creditHi != null);
      if (knownItems.length > 0) {
        const totalLo = knownItems.reduce((s, e) => s + e.creditLo, 0);
        const totalHi = knownItems.reduce((s, e) => s + e.creditHi, 0);
        const partial = knownItems.length < enriched.length;
        const totalStr = totalLo === totalHi
          ? `${totalLo.toLocaleString()} cr`
          : `${totalLo.toLocaleString()}\u2013${totalHi.toLocaleString()} cr`;
        footerHtml =
          `<div class="flex items-center justify-between gap-3 px-3 py-2 border-t border-zinc-700/60 bg-emerald-950/20 text-xs">` +
          `<span class="text-emerald-500 text-[10px] uppercase tracking-wide">${partial ? 'Total (partial\u2009\u2014\u2009missing market data)' : 'Total earnings'}</span>` +
          `<span class="tabular-nums font-medium text-emerald-400">${escapeHtml(totalStr)}</span>` +
          `</div>`;
      }
    }

    return this._section(
      label,
      `<div class="rounded-lg overflow-hidden border border-zinc-800/60">${header}<div>${rows}</div>${footerHtml}</div>`,
      sectionColor
    );
  }

  _section(title, body, color = 'zinc') {
    const cls = {
      sky:     'text-sky-800 border-sky-900/60',
      emerald: 'text-emerald-800 border-emerald-900/60',
      amber:   'text-amber-800 border-amber-900/60',
      zinc:    'text-zinc-600 border-zinc-800/60',
    }[color] ?? 'text-zinc-600 border-zinc-800/60';
    return `<div class="mb-5"><h4 class="text-xs uppercase tracking-widest ${cls} border-b pb-1 mb-3">${escapeHtml(title)}</h4>${body}</div>`;
  }
}

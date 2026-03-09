import { escapeHtml, formatNumber } from './renderUtils.js';
import { buildLocationForm } from './buildLocationForm.js';

/**
 * Renders the Locations overview page.
 *
 * Locations are grouped by playfield and sorted within each group by restock
 * urgency (ready → countdown ascending → never visited → no restock tracking).
 * Playfield groups are also ordered by their most-urgent location.
 */
export class LocationsPageRenderer {
  /**
   * @param {Element} containerEl  The scrollable page container to render into.
   * @param {{
   *   locations:      Array,
   *   scenarioName:   string,
   *   onMarkVisited:  (id: string) => Promise<void>,
   *   onDelete:       (id: string) => Promise<void>,
   *   onOpenTrader:   (traderName: string) => void,
   * }} options
   */
  render(containerEl, { locations, scenarioName, onMarkVisited, onDelete, onOpenTrader, resolveIconUrl = null, onItemClick = null, onEdit = null, resolveTraderItems = null, getTraderValue = null }) {
    if (!locations.length) {
      containerEl.innerHTML =
        `<div class="flex flex-col items-center gap-4 py-24 text-center">` +
          `<svg xmlns="http://www.w3.org/2000/svg" class="w-10 h-10 text-slate-800" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
            `<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>` +
          `</svg>` +
          `<p class="text-sm font-medium text-slate-500">No locations saved yet.</p>` +
          `<p class="text-xs text-slate-600 max-w-xs leading-relaxed">Open any trader and use the <span class="text-teal-500 font-medium">Locations</span> section at the bottom of the detail panel to record your first location.</p>` +
        `</div>`;
      return;
    }

    // Group by playfield
    /** @type {Map<string, Array>} */
    const byPlayfield = new Map();
    for (const loc of locations) {
      if (!byPlayfield.has(loc.playfield)) byPlayfield.set(loc.playfield, []);
      byPlayfield.get(loc.playfield).push(loc);
    }

    // Sort each group by urgency
    for (const locs of byPlayfield.values()) {
      locs.sort((a, b) => this._urgencyScore(a) - this._urgencyScore(b));
    }

    // Sort groups by the urgency of their most-urgent entry
    const sortedGroups = [...byPlayfield.entries()].sort(
      ([, a], [, b]) => this._urgencyScore(a[0]) - this._urgencyScore(b[0]),
    );

    containerEl.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'flex flex-col gap-8 max-w-6xl';

    for (const [playfield, locs] of sortedGroups) {
      wrapper.appendChild(this._buildGroup(playfield, locs, onMarkVisited, onDelete, onOpenTrader, resolveIconUrl, onItemClick, onEdit, resolveTraderItems, getTraderValue));
    }

    containerEl.appendChild(wrapper);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  /**
   * Returns a numeric urgency score for sorting — lower = more urgent.
   * Ready-to-restock entries have the lowest score.
   * @param {object} loc
   * @returns {number}
   */
  _urgencyScore(loc) {
    if (!loc.restockMinutes) return 3e12;      // No restock tracking
    if (!loc.lastVisitedAt)  return 2e12;      // Never visited (unknown)
    const minAgo = (Date.now() - new Date(loc.lastVisitedAt).getTime()) / 60000;
    if (minAgo >= loc.restockMinutes) return 0; // Ready!
    return (loc.restockMinutes - minAgo) * 60000; // Sort by remaining time (ms)
  }

  /** Builds the DOM element for a single playfield group. */
  _buildGroup(playfield, locations, onMarkVisited, onDelete, onOpenTrader, resolveIconUrl, onItemClick, onEdit, resolveTraderItems, getTraderValue) {
    const group = document.createElement('div');

    const header = document.createElement('div');
    header.className = 'flex items-center gap-3 mb-3';
    header.innerHTML =
      `<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 shrink-0 text-teal-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
        `<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>` +
      `</svg>` +
      `<h3 class="text-sm font-bold text-slate-200">${escapeHtml(playfield)}</h3>` +
      `<span class="text-xs text-slate-600">${locations.length} ${locations.length === 1 ? 'location' : 'locations'}</span>` +
      `<div class="flex-1 h-px bg-slate-800/60" role="separator"></div>`;
    group.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3';
    for (const loc of locations) {
      grid.appendChild(this._buildCard(loc, onMarkVisited, onDelete, onOpenTrader, resolveIconUrl, onItemClick, onEdit, resolveTraderItems, getTraderValue));
    }
    group.appendChild(grid);

    return group;
  }

  /** Builds the DOM element for a single location card. */
  _buildCard(loc, onMarkVisited, onDelete, onOpenTrader, resolveIconUrl, onItemClick, onEdit = null, resolveTraderItems = null, getTraderValue = null) {
    const status = this._cardStatus(loc);
    const cardCls = {
      ready:     'p-4 rounded-xl bg-emerald-950/10 border border-emerald-900/35 border-t-[3px] border-t-emerald-500/55 flex flex-col gap-3',
      warning:   'p-4 rounded-xl bg-amber-950/10   border border-amber-900/30  border-t-[3px] border-t-amber-500/55  flex flex-col gap-3',
      countdown: 'p-4 rounded-xl bg-[#0d1018]      border border-slate-800/55  flex flex-col gap-3',
      unvisited: 'p-4 rounded-xl bg-[#0d1018]      border border-slate-800/55  flex flex-col gap-3',
      none:      'p-4 rounded-xl bg-[#0d1018]      border border-slate-800/55  flex flex-col gap-3',
    };
    const card = document.createElement('div');
    card.className = cardCls[status] ?? cardCls.none;

    // ── Header: POI + trader name (clickable) + status badge ──────────────
    const topRow = document.createElement('div');
    topRow.className = 'flex items-start justify-between gap-2 min-w-0';

    const nameBlock = document.createElement('div');
    nameBlock.className = 'min-w-0 flex-1';

    const poiEl = document.createElement('p');
    poiEl.className = 'text-xs text-teal-500/80 font-medium truncate mb-0.5';
    poiEl.textContent = loc.poi;
    nameBlock.appendChild(poiEl);

    if (onOpenTrader) {
      const traderBtn = document.createElement('button');
      traderBtn.type = 'button';
      traderBtn.className =
        'text-sm font-bold text-white truncate max-w-full text-left ' +
        'hover:text-blue-300 hover:underline underline-offset-2 transition-colors cursor-pointer';
      traderBtn.textContent = loc.traderName;
      traderBtn.title = `Open ${loc.traderName}`;
      traderBtn.addEventListener('click', () => onOpenTrader(loc.traderName));
      nameBlock.appendChild(traderBtn);
    } else {
      const traderEl = document.createElement('p');
      traderEl.className = 'text-sm font-bold text-white truncate';
      traderEl.textContent = loc.traderName;
      nameBlock.appendChild(traderEl);
    }

    topRow.appendChild(nameBlock);

    const statusBadge = this._buildStatusBadge(loc);
    if (statusBadge) topRow.appendChild(statusBadge);

    card.appendChild(topRow);

    // ── Visit info row ────────────────────────────────────────────────────
    const visitRow = document.createElement('div');
    visitRow.className = 'flex flex-col gap-0.5';

    if (loc.lastVisitedAt) {
      const visitedEl = document.createElement('p');
      visitedEl.className = 'text-[11px] text-slate-500';
      visitedEl.textContent = `Last visited ${this._formatAgo(loc.lastVisitedAt)}`;
      visitRow.appendChild(visitedEl);
    } else {
      const neverEl = document.createElement('p');
      neverEl.className = 'text-[11px] text-slate-700 italic';
      neverEl.textContent = 'Not visited yet';
      visitRow.appendChild(neverEl);
    }

    if (loc.restockMinutes != null) {
      const intervalEl = document.createElement('p');
      intervalEl.className = 'text-[11px] text-slate-500';
      intervalEl.textContent = `Restocks every ${this._formatMinutes(loc.restockMinutes)}`;
      visitRow.appendChild(intervalEl);
    }

    card.appendChild(visitRow);

    // ── Potential value ───────────────────────────────────────────────────
    const value = getTraderValue?.(loc) ?? null;
    if (value) {
      const valueRow = document.createElement('div');
      valueRow.className = 'flex flex-col gap-0.5';

      const fmtRange = (r) => {
        const lo = formatNumber(r.lo), hi = formatNumber(r.hi);
        return r.lo === r.hi ? `${lo} cr` : `${lo} \u2013 ${hi} cr`;
      };
      const fmtQty = (r) => {
        const lo = formatNumber(r.qtyLo), hi = formatNumber(r.qtyHi);
        return r.qtyLo === r.qtyHi ? `${lo}` : `${lo}\u2013${hi}`;
      };

      if (value.sell) {
        const el = document.createElement('p');
        el.className = 'text-[11px] text-emerald-600/80 font-medium';
        el.innerHTML =
          `<span class="text-emerald-400/80 font-normal mr-1">Sell\u00a0income</span>${fmtRange(value.sell)}` +
          `<span class="block text-[11px] text-emerald-600/80 font-normal mt-0.5">${fmtQty(value.sell)}\u00a0units</span>`;
        el.title = 'Credits earned by selling your stock to this trader (qty \xd7 price \xd7 market price, low\u2013high)';
        valueRow.appendChild(el);
      }

      if (value.buy) {
        const el = document.createElement('p');
        el.className = 'text-[11px] text-sky-600/70 font-medium';
        el.innerHTML =
          `<span class="text-sky-400/75 font-normal mr-1">Buy\u00a0cost</span>${fmtRange(value.buy)}` +
          `<span class="block text-[11px] text-sky-500/70 font-normal mt-0.5">${fmtQty(value.buy)}\u00a0units</span>`;
        el.title = 'Credits spent buying all available stock from this trader (qty \xd7 price \xd7 market price, low\u2013high)';
        valueRow.appendChild(el);
      }

      card.appendChild(valueRow);
    }

    // ── Notes ─────────────────────────────────────────────────────────────
    if (loc.notes) {
      const notesEl = document.createElement('p');
      notesEl.className =
        'text-[11px] text-slate-500 italic leading-relaxed border-t border-slate-800/40 pt-2';
      notesEl.textContent = loc.notes;
      card.appendChild(notesEl);
    }

    // ── Key Items ─────────────────────────────────────────────────────────
    if (loc.keyItems?.length) {
      const itemsWrap = document.createElement('div');
      itemsWrap.className = 'flex flex-wrap gap-1 border-t border-slate-800/40 pt-2';
      for (const item of loc.keyItems) {
        const iconUrl = resolveIconUrl?.(item.devName);
        const intentBadge = item.intent === 'sell'
          ? `<span class="text-[8px] font-bold text-emerald-500 uppercase leading-none">S</span>`
          : item.intent === 'buy'
          ? `<span class="text-[8px] font-bold text-sky-400 uppercase leading-none">B</span>`
          : '';
        const inner = `${iconUrl ? `<img src="${iconUrl}" alt="" class="w-4 h-4 object-contain shrink-0" draggable="false" />` : ''}${escapeHtml(item.displayName)}${intentBadge}`;
        const baseCls = item.intent === 'sell'
          ? 'inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-950/40 border border-emerald-900/50 text-emerald-300'
          : item.intent === 'buy'
          ? 'inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-sky-950/40 border border-sky-900/50 text-sky-300'
          : 'inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-zinc-800/50 border border-zinc-700/40 text-zinc-400';
        if (onItemClick) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = `${baseCls} hover:brightness-125 transition-all cursor-pointer`;
          btn.innerHTML = inner;
          btn.title = item.displayName;
          btn.addEventListener('click', () => onItemClick(item.devName));
          itemsWrap.appendChild(btn);
        } else {
          const badge = document.createElement('span');
          badge.className = baseCls;
          badge.innerHTML = inner;
          itemsWrap.appendChild(badge);
        }
      }
      card.appendChild(itemsWrap);
    }

    // ── Footer: Mark Visited + Edit + Remove ─────────────────────────────
    const footer = document.createElement('div');
    footer.className = 'flex flex-wrap items-center gap-x-2 gap-y-2 pt-2 border-t border-slate-800/40 mt-auto';

    const leftBtns = document.createElement('div');
    leftBtns.className = 'flex items-center gap-2';

    const markBtn = document.createElement('button');
    markBtn.type = 'button';
    markBtn.className =
      'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg ' +
      'bg-teal-700/50 border border-teal-600/40 text-teal-200 ' +
      'hover:bg-teal-600/60 hover:border-teal-500/50 hover:text-white ' +
      'disabled:opacity-40 disabled:pointer-events-none transition-colors';
    markBtn.innerHTML =
      `<svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
        `<polyline points="20 6 9 17 4 12"/>` +
      `</svg>` +
      `Mark Visited`;
    markBtn.addEventListener('click', async () => {
      markBtn.disabled = true;
      try {
        await onMarkVisited(loc.id);
      } catch {
        markBtn.disabled = false;
      }
    });

    if (onEdit) {
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className =
        'flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg ' +
        'bg-zinc-800/60 border border-zinc-700/40 text-zinc-400 ' +
        'hover:bg-zinc-700/60 hover:text-zinc-200 transition-colors';
      editBtn.innerHTML =
        `<svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
          `<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>` +
          `<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>` +
        `</svg>` +
        `Edit`;
      editBtn.addEventListener('click', () => {
        const traderItems = resolveTraderItems?.(loc.traderName) ?? [];
        const savedClassName = card.className;
        card.innerHTML = '';
        card.className = 'rounded-xl';
        buildLocationForm(
          card,
          async (entry) => {
            if (onEdit) await onEdit(entry);
            // app.js will re-render the whole page after save
          },
          () => {
            // Cancel: restore the card with fresh event-connected content
            const fresh = this._buildCard(loc, onMarkVisited, onDelete, onOpenTrader, resolveIconUrl, onItemClick, onEdit, resolveTraderItems, getTraderValue);
            card.parentElement?.replaceChild(fresh, card);
          },
          traderItems,
          resolveIconUrl,
          loc,
        );
      });
      leftBtns.appendChild(markBtn);
      leftBtns.appendChild(editBtn);
    } else {
      leftBtns.appendChild(markBtn);
    }
    footer.appendChild(leftBtns);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className =
      'text-xs text-slate-600 hover:text-red-400 hover:bg-red-950/20 ' +
      'transition-colors px-2 py-1.5 rounded-lg';
    removeBtn.textContent = 'Remove';

    const removeWrapper = document.createElement('div');
    removeWrapper.className = 'ml-auto flex items-center gap-1.5';
    removeWrapper.appendChild(removeBtn);
    footer.appendChild(removeWrapper);

    removeBtn.addEventListener('click', () => {
      removeWrapper.innerHTML = '';

      const label = document.createElement('span');
      label.className = 'text-xs text-slate-500';
      label.textContent = 'Remove?';

      const noBtn = document.createElement('button');
      noBtn.type = 'button';
      noBtn.className =
        'text-xs px-2.5 py-1.5 rounded-lg bg-zinc-800/60 border border-zinc-700/40 ' +
        'text-zinc-400 hover:bg-zinc-700/60 hover:text-zinc-200 transition-colors';
      noBtn.textContent = 'No';
      noBtn.addEventListener('click', () => {
        removeWrapper.innerHTML = '';
        removeWrapper.appendChild(removeBtn);
      });

      const yesBtn = document.createElement('button');
      yesBtn.type = 'button';
      yesBtn.className =
        'text-xs px-2.5 py-1.5 rounded-lg bg-red-900/40 border border-red-800/50 ' +
        'text-red-300 hover:bg-red-800/50 hover:text-red-200 ' +
        'disabled:opacity-40 disabled:pointer-events-none transition-colors';
      yesBtn.textContent = 'Yes';
      yesBtn.addEventListener('click', async () => {
        yesBtn.disabled = true;
        noBtn.disabled  = true;
        try {
          await onDelete(loc.id);
        } catch {
          removeWrapper.innerHTML = '';
          removeWrapper.appendChild(removeBtn);
        }
      });

      removeWrapper.appendChild(label);
      removeWrapper.appendChild(noBtn);
      removeWrapper.appendChild(yesBtn);
    });

    card.appendChild(footer);

    return card;
  }

  /**
   * Builds a colour-coded status badge. Returns null when no restock interval
   * is configured (nothing useful to show).
   * @param {object} loc
   * @returns {HTMLElement|null}
   */
  _buildStatusBadge(loc) {
    if (!loc.restockMinutes) return null;

    const status = this._cardStatus(loc);
    const badge  = document.createElement('span');
    badge.className =
      'shrink-0 self-start inline-flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-full border';

    const clockSvg =
      `<svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
        `<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>` +
      `</svg>`;

    if (status === 'ready') {
      badge.className += ' bg-emerald-500/20 border-emerald-500/40 text-emerald-300';
      badge.innerHTML =
        `<svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>` +
        `Ready`;
    } else if (status === 'warning') {
      const minAgo = (Date.now() - new Date(loc.lastVisitedAt).getTime()) / 60000;
      badge.className += ' bg-amber-500/20 border-amber-500/40 text-amber-300';
      badge.innerHTML = clockSvg + `${this._formatMinutes(Math.ceil(loc.restockMinutes - minAgo))} left`;
    } else if (status === 'countdown') {
      const minAgo = (Date.now() - new Date(loc.lastVisitedAt).getTime()) / 60000;
      badge.className += ' bg-slate-800/60 border-slate-700/40 text-slate-400';
      badge.innerHTML = clockSvg + `${this._formatMinutes(Math.ceil(loc.restockMinutes - minAgo))} left`;
    } else {
      // unvisited
      badge.className += ' bg-slate-900/50 border-slate-800/40 text-slate-600';
      badge.textContent = 'Not visited';
    }

    return badge;
  }

  /** Returns a status key for colour-coding: 'ready'|'warning'|'countdown'|'unvisited'|'none'. */
  _cardStatus(loc) {
    if (!loc.restockMinutes) return 'none';
    if (!loc.lastVisitedAt)  return 'unvisited';
    const minAgo = (Date.now() - new Date(loc.lastVisitedAt).getTime()) / 60000;
    if (minAgo >= loc.restockMinutes)     return 'ready';
    if (loc.restockMinutes - minAgo < 10) return 'warning';
    return 'countdown';
  }

  // ── Formatting helpers ────────────────────────────────────────────────────

  /** Formats a minute count as a human-readable duration string. */
  _formatMinutes(minutes) {
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    if (h === 0) return `${m}min`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}min`;
  }

  /** Formats an ISO 8601 timestamp as a relative "ago" string. */
  _formatAgo(isoString) {
    const diffMs  = Date.now() - new Date(isoString).getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1)  return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24)   return `${diffH}h ago`;
    return `${Math.floor(diffH / 24)}d ago`;
  }
}

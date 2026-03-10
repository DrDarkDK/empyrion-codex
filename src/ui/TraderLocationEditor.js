import { escapeHtml } from './renderUtils.js';
import { buildLocationForm } from './buildLocationForm.js';

/**
 * @typedef {object} TraderLocation
 * @property {string}      id             - Unique identifier (crypto.randomUUID)
 * @property {string}      scenarioName   - Scenario this annotation belongs to
 * @property {string}      traderName     - Trader devName
 * @property {string}      playfield      - Playfield name entered by the user
 * @property {string}      poi            - POI or station name entered by the user
 * @property {number|null} restockMinutes - Real-world minutes between restocks, or null
 * @property {string|null} notes          - Optional free-form notes
 * @property {string|null} lastVisitedAt  - ISO 8601 timestamp of last visit, or null
 * @property {Array<{devName:string,displayName:string}>|null} keyItems - Key items from the trader's inventory
 */

/**
 * @typedef {object} TraderItem
 * @property {string} devName     - Developer name
 * @property {string} displayName - Resolved human-readable name
 */

/**
 * Renders an interactive "Locations" section into a container, letting users
 * annotate a trader with playfield / POI / restock information.
 *
 * The component manages its own DOM subtree and is fully async-aware:
 * data is fetched via the `getLocations` callback on first render and after
 * every mutation, so the view always reflects the persisted state.
 */
export class TraderLocationEditor {
  /**
   * Appends the Locations section to `containerEl` and begins the initial
   * data fetch.  All callbacks are optional; when omitted the section renders
   * in a read-only / empty state (useful for previews or before the data
   * layer is wired up).
   *
   * @param {HTMLElement} containerEl
   * @param {object}   [options]
   * @param {function(): Promise<TraderLocation[]>} [options.getLocations]   - Async loader
   * @param {function(TraderLocation): Promise<void>} [options.onAdd]        - Persist a new entry
   * @param {function(string): Promise<void>}         [options.onDelete]     - Delete by id
   * @param {function(string): Promise<void>}         [options.onMarkVisited] - Stamp lastVisitedAt
   * @param {TraderItem[]}                            [options.traderItems]  - Selectable items from this trader
   */
  render(containerEl, options = {}) {
    const {
      getLocations   = null,
      onAdd          = null,
      onDelete       = null,
      onMarkVisited  = null,
      onEdit         = null,
      traderItems    = [],
      resolveIconUrl = null,
      onItemClick    = null,
    } = options;

    const section = document.createElement('div');
    section.className = 'mb-5';
    containerEl.appendChild(section);

    let isFirstLoad = true;

    /**
     * Re-fetches locations and redraws the section in place.
     * On the very first call a skeleton placeholder is shown while waiting;
     * subsequent calls (triggered by mutations) redraw silently to avoid
     * distracting flashes.
     */
    const refresh = async () => {
      if (!section.isConnected) return;
      if (isFirstLoad) this._setLoading(section);
      isFirstLoad = false;
      try {
        const locations = getLocations ? await getLocations() : [];
        if (!section.isConnected) return;
        this._draw(section, locations, refresh, onAdd, onDelete, onMarkVisited, onEdit, traderItems, resolveIconUrl, onItemClick);
      } catch (err) {
        if (!section.isConnected) return;
        this._setError(section, err);
      }
    };

    refresh();
  }

  // ── Private ───────────────────────────────────────────────────────────────

  /** Shows a skeleton placeholder while the initial data fetch is in flight. */
  _setLoading(section) {
    section.innerHTML =
      `<h4 class="text-xs uppercase tracking-widest text-amber-800 border-b border-amber-900/60 pb-1 mb-3">Locations</h4>` +
      `<div class="flex flex-col gap-2 mt-2">` +
        `<div class="h-2 bg-zinc-800/80 rounded-full w-3/4 animate-pulse"></div>` +
        `<div class="h-2 bg-zinc-800/80 rounded-full w-1/2 animate-pulse"></div>` +
      `</div>`;
  }

  /** Replaces the section with a minimal error notice. */
  _setError(section, err) {
    console.error('[TraderLocationEditor]', err);
    section.innerHTML =
      `<h4 class="text-xs uppercase tracking-widest text-amber-800 border-b border-amber-900/60 pb-1 mb-3">Locations</h4>` +
      `<p class="text-[11px] text-red-500/80 mt-2">Failed to load locations. Check the browser console for details.</p>`;
  }

  /**
   * Rebuilds the full section content from a fresh array of locations.
   * Called both on initial load and after every mutation.
   */
  _draw(section, locations, refresh, onAdd, onDelete, onMarkVisited, onEdit, traderItems = [], resolveIconUrl = null, onItemClick = null) {
    section.innerHTML =
      `<h4 class="text-xs uppercase tracking-widest text-amber-800 border-b border-amber-900/60 pb-1 mb-3">Locations</h4>` +
      `<div class="loc-cards"></div>` +
      `<button type="button" class="loc-add-btn mt-3 flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-lg border border-teal-900/50 text-teal-500 hover:text-teal-300 hover:border-teal-700/60 hover:bg-teal-950/30 transition-colors">` +
        `<svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
          `<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>` +
        `</svg>` +
        `Add Location` +
      `</button>` +
      `<div class="loc-form-wrap hidden mt-3"></div>`;

    const cardsEl  = section.querySelector('.loc-cards');
    const addBtn   = section.querySelector('.loc-add-btn');
    const formWrap = section.querySelector('.loc-form-wrap');

    if (!locations.length) {
      cardsEl.innerHTML =
        `<div class="flex items-center gap-2 py-3 px-1 text-[11px] text-zinc-600">` +
          `<svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 shrink-0 text-zinc-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
            `<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>` +
          `</svg>` +
          `No locations recorded yet.` +
        `</div>`;
    } else {
      for (const loc of locations) {
        cardsEl.appendChild(this._buildCard(loc, refresh, onDelete, onMarkVisited, onEdit, traderItems, resolveIconUrl, onItemClick));
      }
    }

    addBtn.addEventListener('click', () => {
      addBtn.classList.add('hidden');
      formWrap.classList.remove('hidden');
      this._buildForm(
        formWrap,
        async (entry) => {
          if (onAdd) await onAdd(entry);
          await refresh();
        },
        async () => {
          // Cancel: restore the section without touching the DB
          await refresh();
        },
        traderItems,
        resolveIconUrl,
      );
    });

    // ── Auto-refresh timer ────────────────────────────────────────────────────
    // Fires every 60 s; skipped if a form is open to avoid discarding input.
    // Cancel any previously-registered ticker before installing a new one so
    // that multiple _draw() calls do not accumulate parallel intervals.
    if (section._ticker != null) clearInterval(section._ticker);
    section._ticker = setInterval(() => {
      if (!section.isConnected) { clearInterval(section._ticker); section._ticker = null; return; }
      if (section.querySelector('.loc-form-save')) return; // form open, skip
      refresh();
    }, 60_000);
  }

  /** Builds a single location card element. */
  _buildCard(loc, refresh, onDelete, onMarkVisited, onEdit, traderItems, resolveIconUrl, onItemClick) {
    const status = this._cardStatus(loc);
    const borderColor = {
      ready:     'border-l-emerald-500/70',
      warning:   'border-l-amber-500/70',
      countdown: 'border-l-sky-700/50',
      unvisited: 'border-l-slate-700/40',
      none:      'border-l-zinc-800/40',
    }[status];
    const bgColor = {
      ready:     'bg-emerald-950/15',
      warning:   'bg-amber-950/15',
      countdown: 'bg-zinc-900/50',
      unvisited: 'bg-zinc-900/50',
      none:      'bg-zinc-900/50',
    }[status];

    const card = document.createElement('div');
    card.className = `mb-2 rounded-lg p-3 border border-zinc-800/40 border-l-[3px] ${borderColor} ${bgColor} flex flex-col gap-2`;

    // ── Header: playfield → POI ───────────────────────────────────────────────
    const header = document.createElement('div');
    header.className = 'flex items-center gap-1.5 min-w-0';
    header.innerHTML =
      `<svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3 shrink-0 text-teal-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
        `<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>` +
      `</svg>` +
      `<span class="text-xs font-semibold text-slate-200 truncate">${escapeHtml(loc.playfield)}</span>` +
      `<span class="text-zinc-600 text-[10px] shrink-0" aria-hidden="true">→</span>` +
      `<span class="text-xs text-zinc-400 truncate">${escapeHtml(loc.poi)}</span>`;
    card.appendChild(header);

    // ── Visit info + inline restock status ────────────────────────────────────
    const infoEl = document.createElement('div');
    infoEl.className = 'flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px]';

    const visitSpan = document.createElement('span');
    if (loc.lastVisitedAt) {
      visitSpan.className = 'text-zinc-500';
      visitSpan.textContent = `Visited ${this._formatAgo(loc.lastVisitedAt)}`;
    } else {
      visitSpan.className = 'text-zinc-700 italic';
      visitSpan.textContent = 'Not visited yet';
    }
    infoEl.appendChild(visitSpan);

    if (loc.restockMinutes != null) {
      const minAgo = loc.lastVisitedAt
        ? (Date.now() - new Date(loc.lastVisitedAt).getTime()) / 60000
        : null;
      const statusSpan = document.createElement('span');
      if (status === 'ready') {
        statusSpan.className = 'font-semibold text-emerald-400';
        statusSpan.textContent = '· Ready ✓';
      } else if (status === 'warning') {
        statusSpan.className = 'font-medium text-amber-400';
        statusSpan.textContent = `· ${this._formatMinutes(Math.ceil(loc.restockMinutes - minAgo))} left`;
      } else if (status === 'countdown') {
        statusSpan.className = 'text-sky-500/80';
        statusSpan.textContent = `· ${this._formatMinutes(Math.ceil(loc.restockMinutes - minAgo))} left`;
      } else {
        statusSpan.className = 'text-zinc-600';
        statusSpan.textContent = `· Restocks every ${this._formatMinutes(loc.restockMinutes)}`;
      }
      infoEl.appendChild(statusSpan);
    }
    card.appendChild(infoEl);

    // ── Notes ────────────────────────────────────────────────────────────────
    if (loc.notes) {
      const notesEl = document.createElement('p');
      notesEl.className = 'text-[11px] text-zinc-500 italic leading-relaxed';
      notesEl.textContent = loc.notes;
      card.appendChild(notesEl);
    }

    // ── Key Items ─────────────────────────────────────────────────────────────
    if (loc.keyItems?.length) {
      const itemsRow = document.createElement('div');
      itemsRow.className = 'flex flex-wrap gap-1 pt-0.5';
      for (const item of loc.keyItems) {
        const iconUrl = resolveIconUrl?.(item.devName);
        const intentBadge = item.intent === 'sell'
          ? `<span class="text-[8px] font-bold text-emerald-500 uppercase leading-none">S</span>`
          : item.intent === 'buy'
          ? `<span class="text-[8px] font-bold text-sky-400 uppercase leading-none">B</span>`
          : '';
        const inner = `${iconUrl ? `<img src="${iconUrl}" alt="" class="w-3.5 h-3.5 object-contain shrink-0" draggable="false" />` : ''}${escapeHtml(item.displayName)}${intentBadge}`;
        const baseCls = item.intent === 'sell'
          ? 'inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-950/40 border border-emerald-900/50 text-emerald-400'
          : item.intent === 'buy'
          ? 'inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-sky-950/40 border border-sky-900/50 text-sky-400'
          : 'inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-800/50 border border-zinc-700/40 text-zinc-500';
        if (onItemClick) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = `${baseCls} hover:brightness-125 transition-all cursor-pointer`;
          btn.innerHTML = inner;
          btn.title = item.displayName;
          btn.addEventListener('click', () => onItemClick(item.devName));
          itemsRow.appendChild(btn);
        } else {
          const badge = document.createElement('span');
          badge.className = baseCls;
          badge.innerHTML = inner;
          itemsRow.appendChild(badge);
        }
      }
      card.appendChild(itemsRow);
    }

    // ── Footer: Mark Visited + Edit + Remove ─────────────────────────────────
    const footer = document.createElement('div');
    footer.className = 'flex items-center gap-1.5 pt-2 border-t border-zinc-800/40';

    const markBtn = document.createElement('button');
    markBtn.type = 'button';
    markBtn.className =
      'flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg ' +
      'bg-teal-700/50 border border-teal-600/40 text-teal-200 ' +
      'hover:bg-teal-600/60 hover:border-teal-500/50 hover:text-white ' +
      'disabled:opacity-40 disabled:pointer-events-none transition-colors';
    markBtn.innerHTML =
      `<svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
        `<polyline points="20 6 9 17 4 12"/>` +
      `</svg>` +
      `Mark Visited`;
    markBtn.addEventListener('click', async () => {
      markBtn.disabled = true;
      try {
        if (onMarkVisited) await onMarkVisited(loc.id);
      } finally {
        await refresh();
      }
    });
    footer.appendChild(markBtn);

    if (onEdit) {
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className =
        'flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg ' +
        'bg-zinc-800/60 border border-zinc-700/40 text-zinc-400 ' +
        'hover:bg-zinc-700/60 hover:text-zinc-200 transition-colors';
      editBtn.innerHTML =
        `<svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
          `<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>` +
          `<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>` +
        `</svg>` +
        `Edit`;
      editBtn.addEventListener('click', () => {
        const savedClassName = card.className;
        card.innerHTML = '';
        card.className = 'mb-2';
        this._buildForm(
          card,
          async (entry) => {
            if (onEdit) await onEdit(entry);
            await refresh();
          },
          async () => {
            card.className = savedClassName;
            await refresh();
          },
          traderItems,
          resolveIconUrl,
          loc,
        );
      });
      footer.appendChild(editBtn);
    }

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className =
      'ml-auto text-[11px] text-zinc-600 hover:text-red-400 hover:bg-red-950/20 ' +
      'disabled:opacity-40 disabled:pointer-events-none transition-colors px-2 py-1.5 rounded-lg';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', async () => {
      removeBtn.disabled = true;
      try {
        if (onDelete) await onDelete(loc.id);
      } finally {
        await refresh();
      }
    });
    footer.appendChild(removeBtn);
    card.appendChild(footer);

    return card;
  }

  /** Returns a status key: 'ready'|'warning'|'countdown'|'unvisited'|'none'. */
  _cardStatus(loc) {
    if (!loc.restockMinutes) return 'none';
    if (!loc.lastVisitedAt)  return 'unvisited';
    const minAgo = (Date.now() - new Date(loc.lastVisitedAt).getTime()) / 60000;
    if (minAgo >= loc.restockMinutes)     return 'ready';
    if (loc.restockMinutes - minAgo < 10) return 'warning';
    return 'countdown';
  }

  /**
   * Builds and injects the "Add Location" inline form into `container`.
   * Calls `onSave(entry)` with the validated form data on submission,
   * or `onCancel()` when the user dismisses the form.
   * @param {HTMLElement}          container
   * @param {function}             onSave
   * @param {function}             onCancel
   * @param {TraderItem[]}         [traderItems=[]]
   * @param {function|null}        [resolveIconUrl=null]
   * @param {TraderLocation|null}  [existingLoc=null]  - When set, form pre-fills for editing
   */
  _buildForm(container, onSave, onCancel, traderItems = [], resolveIconUrl = null, existingLoc = null) {
    buildLocationForm(container, onSave, onCancel, traderItems, resolveIconUrl, existingLoc);
  }

  // ── Formatting helpers ────────────────────────────────────────────────────

  /** Formats a minute count as a human-readable duration string. */
  _formatMinutes(minutes) {
    if (minutes < 60) return `${minutes} min`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}min` : `${h}h`;
  }

  /** Returns a relative time string for an ISO timestamp (e.g. "3h ago"). */
  _formatAgo(isoString) {
    const ms  = Date.now() - new Date(isoString).getTime();
    const min = Math.floor(ms / 60000);
    if (min < 1)  return 'just now';
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24)  return `${hr}h ago`;
    return `${Math.floor(hr / 24)}d ago`;
  }
}



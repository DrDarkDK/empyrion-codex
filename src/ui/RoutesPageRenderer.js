import { escapeHtml, formatNumber } from './renderUtils.js';

/**
 * Renders the Routes page, which lets players plan ordered sequences of trader
 * visits and see estimated profit totals for the full route.
 *
 * Public API:
 *   renderer.render(containerEl, options)  — renders the list mode
 *   renderer.showBuilder(containerEl, options, routeToEdit?)  — shows create/edit form
 */
export class RoutesPageRenderer {
  /**
   * Render the routes list.
   *
   * @param {Element} containerEl
   * @param {{
   *   routes:             Array,           — saved route entries
   *   locations:          Array,           — all saved locations for the scenario
   *   scenarioName:       string,
   *   getTraderValue:     (loc) => object|null,
   *   resolveIconUrl:     (devName) => string|null,
   *   onEdit:             (route) => void,
   *   onDelete:           (id: string) => Promise<void>,
   *   onNew:              () => void,
   * }} options
   */
  render(containerEl, options) {
    const { routes, locations, getTraderValue, resolveIconUrl, onEdit, onDelete, onTraderClick, onItemClick } = options;

    containerEl.innerHTML = '';

    if (!routes.length) {
      containerEl.innerHTML =
        `<div class="flex flex-col items-center gap-4 py-24 text-center">` +
          `<svg xmlns="http://www.w3.org/2000/svg" class="w-10 h-10 text-slate-800" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
            `<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>` +
          `</svg>` +
          `<p class="text-sm font-medium text-slate-500">No routes saved yet.</p>` +
          `<p class="text-xs text-slate-600 max-w-xs leading-relaxed">Click <span class="text-indigo-400 font-medium">New Route</span> to plan an ordered sequence of trader visits and calculate total profit.</p>` +
        `</div>`;
      return;
    }

    // Build location lookup map
    const locById = new Map(locations.map(l => [l.id, l]));

    const grid = document.createElement('div');
    grid.className = 'flex flex-col gap-5 max-w-3xl';

    for (const route of routes) {
      grid.appendChild(this._buildRouteCard(route, locById, getTraderValue, resolveIconUrl, onEdit, onDelete, onTraderClick, onItemClick));
    }

    containerEl.appendChild(grid);
  }

  /**
   * Renders the create/edit form inline into containerEl, replacing its content.
   *
   * @param {Element} containerEl
   * @param {{
   *   locations:     Array,
   *   scenarioName:  string,
   *   getTraderValue:(loc) => object|null,
   *   resolveIconUrl:(devName) => string|null,
   *   onSave:        (route) => Promise<void>,
   *   onCancel:      () => void,
   * }} options
   * @param {object|null} routeToEdit   Existing route to edit, or null for create.
   */
  showBuilder(containerEl, options, routeToEdit = null) {
    const { locations, scenarioName, getTraderValue, resolveIconUrl, onSave, onCancel, onTraderClick, onItemClick } = options;

    const isEdit = routeToEdit != null;
    // Current ordered stops: array of locationId strings
    let stops = isEdit
      ? [...(routeToEdit.stops ?? [])].sort((a, b) => a.order - b.order).map(s => s.locationId)
      : [];

    const locById   = new Map(locations.map(l => [l.id, l]));
    const locByName = locations; // for the picker drop-down

    const render = () => {
      containerEl.innerHTML = '';

      const form = document.createElement('div');
      form.className = 'flex flex-col gap-6 max-w-2xl';

      // ── Heading ──────────────────────────────────────────────────────────
      const heading = document.createElement('p');
      heading.className = 'text-base font-bold text-white';
      heading.textContent = isEdit ? 'Edit Route' : 'New Route';
      form.appendChild(heading);

      // ── Name input ───────────────────────────────────────────────────────
      const nameWrap = document.createElement('div');
      nameWrap.className = 'flex flex-col gap-1';
      const nameLabel = document.createElement('label');
      nameLabel.className = 'text-[11px] font-semibold text-slate-400 uppercase tracking-widest';
      nameLabel.textContent = 'Route name';
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.placeholder = 'e.g. Iron Run, Morning Loop…';
      nameInput.value = routeToEdit?.name ?? '';
      nameInput.className =
        'bg-slate-900/50 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-slate-200 ' +
        'placeholder-slate-600 outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/50 transition-all';
      nameWrap.appendChild(nameLabel);
      nameWrap.appendChild(nameInput);
      form.appendChild(nameWrap);

      // ── Stops list ───────────────────────────────────────────────────────
      const stopsSection = document.createElement('div');
      stopsSection.className = 'flex flex-col gap-2';

      const stopsLabel = document.createElement('p');
      stopsLabel.className = 'text-[11px] font-semibold text-slate-400 uppercase tracking-widest';
      stopsLabel.textContent = `Stops (${stops.length})`;
      stopsSection.appendChild(stopsLabel);

      if (stops.length === 0) {
        const emptyMsg = document.createElement('p');
        emptyMsg.className = 'text-xs text-slate-600 italic py-2';
        emptyMsg.textContent = 'No stops added yet. Use the picker below to add locations.';
        stopsSection.appendChild(emptyMsg);
      } else {
        for (let idx = 0; idx < stops.length; idx++) {
          const loc = locById.get(stops[idx]);
          if (!loc) continue;
          stopsSection.appendChild(this._buildStopRow(loc, idx, stops.length, getTraderValue, resolveIconUrl, {
            onMoveUp:      idx > 0              ? () => { [stops[idx-1], stops[idx]] = [stops[idx], stops[idx-1]]; render(); } : null,
            onMoveDown:    idx < stops.length-1 ? () => { [stops[idx], stops[idx+1]] = [stops[idx+1], stops[idx]]; render(); } : null,
            onRemove:      () => { stops.splice(idx, 1); render(); },
            onTraderClick,
            onItemClick,
          }));
        }
      }

      form.appendChild(stopsSection);

      // ── Location picker ──────────────────────────────────────────────────
      const pickerWrap = document.createElement('div');
      pickerWrap.className = 'flex gap-2 items-end';

      const selectWrap = document.createElement('div');
      selectWrap.className = 'flex-1 flex flex-col gap-1';
      const selectLabel = document.createElement('label');
      selectLabel.className = 'text-[11px] font-semibold text-slate-400 uppercase tracking-widest';
      selectLabel.textContent = 'Add stop';
      const select = document.createElement('select');
      select.className =
        'bg-slate-900/80 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-slate-300 ' +
        'outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/50 transition-all';

      const defaultOpt = document.createElement('option');
      defaultOpt.value = '';
      defaultOpt.textContent = '— choose a saved location —';
      defaultOpt.disabled = true;
      defaultOpt.selected = true;
      select.appendChild(defaultOpt);

      // Group options by playfield
      const byPlayfield = new Map();
      for (const loc of locByName) {
        if (!byPlayfield.has(loc.playfield)) byPlayfield.set(loc.playfield, []);
        byPlayfield.get(loc.playfield).push(loc);
      }
      for (const [pf, locs] of [...byPlayfield.entries()].sort(([a],[b]) => a.localeCompare(b))) {
        const group = document.createElement('optgroup');
        group.label = pf;
        for (const loc of locs) {
          const opt = document.createElement('option');
          opt.value = loc.id;
          opt.textContent = `${loc.traderName}${loc.poi ? ' · ' + loc.poi : ''}`;
          group.appendChild(opt);
        }
        select.appendChild(group);
      }
      selectWrap.appendChild(selectLabel);
      selectWrap.appendChild(select);

      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.textContent = 'Add';
      addBtn.className =
        'shrink-0 text-xs px-4 py-2 rounded-lg bg-indigo-700/50 border border-indigo-600/40 text-indigo-200 ' +
        'hover:bg-indigo-600/60 hover:text-white transition-colors';
      addBtn.addEventListener('click', () => {
        if (!select.value) return;
        stops.push(select.value);
        render();
      });

      pickerWrap.appendChild(selectWrap);
      pickerWrap.appendChild(addBtn);
      form.appendChild(pickerWrap);

      // ── Route profit summary ─────────────────────────────────────────────
      if (stops.length > 0) {
        form.appendChild(this._buildProfitSummary(stops, locById, getTraderValue));
      }

      // ── Form actions ─────────────────────────────────────────────────────
      const actions = document.createElement('div');
      actions.className = 'flex items-center gap-2 pt-2';

      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.textContent = isEdit ? 'Save Changes' : 'Save Route';
      saveBtn.className =
        'text-xs px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white font-semibold transition-colors';
      saveBtn.addEventListener('click', async () => {
        const name = nameInput.value.trim();
        if (!name) { nameInput.focus(); return; }
        const routeEntry = {
          id:           isEdit ? routeToEdit.id : crypto.randomUUID(),
          scenarioName,
          name,
          stops:        stops.map((locationId, order) => ({ locationId, order })),
          createdAt:    isEdit ? routeToEdit.createdAt : new Date().toISOString(),
        };
        saveBtn.disabled = true;
        try {
          await onSave(routeEntry);
        } catch {
          saveBtn.disabled = false;
        }
      });

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.className =
        'text-xs px-4 py-2 text-slate-500 hover:text-slate-200 transition-colors';
      cancelBtn.addEventListener('click', onCancel);

      actions.appendChild(saveBtn);
      actions.appendChild(cancelBtn);
      form.appendChild(actions);

      containerEl.appendChild(form);
    };

    render();
  }

  // ── Private ───────────────────────────────────────────────────────────────

  /** Builds a card for a single saved route in the list view. */
  _buildRouteCard(route, locById, getTraderValue, resolveIconUrl, onEdit, onDelete, onTraderClick = null, onItemClick = null) {
    const orderedStops = [...(route.stops ?? [])].sort((a, b) => a.order - b.order);
    const routeStatus  = this._routeStatus(orderedStops, locById);

    const cardClass = {
      ready:   'rounded-xl overflow-hidden border border-emerald-900/35 border-t-[3px] border-t-emerald-500/55 bg-emerald-950/10 shadow-md shadow-black/30',
      warning: 'rounded-xl overflow-hidden border border-amber-900/30  border-t-[3px] border-t-amber-500/55  bg-amber-950/10  shadow-md shadow-black/30',
    }[routeStatus] ?? 'rounded-xl overflow-hidden border border-slate-800/60 bg-[#161920] shadow-md shadow-black/30';

    const card = document.createElement('div');
    card.className = cardClass;

    // ── Header ────────────────────────────────────────────────────────────
    const header = document.createElement('div');
    header.className =
      'flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-800/50';

    const headerLeft = document.createElement('div');
    headerLeft.className = 'flex items-center gap-2.5 min-w-0';

    // Route icon
    headerLeft.innerHTML =
      `<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 shrink-0 text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
        `<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>` +
      `</svg>`;

    const nameEl = document.createElement('p');
    nameEl.className = 'text-sm font-bold text-white truncate';
    nameEl.textContent = route.name;
    headerLeft.appendChild(nameEl);
    header.appendChild(headerLeft);

    const btnGroup = document.createElement('div');
    btnGroup.className = 'flex items-center gap-1.5 shrink-0';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className =
      'text-xs px-2.5 py-1 rounded-md bg-slate-800/80 border border-slate-700/50 text-slate-400 ' +
      'hover:bg-slate-700 hover:text-white transition-colors';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => onEdit(route));

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className =
      'text-xs px-2.5 py-1 rounded-md bg-red-900/30 border border-red-800/40 text-red-400 ' +
      'hover:bg-red-800/50 hover:text-red-200 transition-colors';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', async () => {
      delBtn.disabled = true;
      try { await onDelete(route.id); } catch { delBtn.disabled = false; }
    });

    btnGroup.appendChild(editBtn);
    btnGroup.appendChild(delBtn);
    header.appendChild(btnGroup);
    card.appendChild(header);

    // ── Stops list ────────────────────────────────────────────────────────
    if (orderedStops.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'text-xs text-slate-600 italic px-4 py-4';
      empty.textContent = 'No stops.';
      card.appendChild(empty);
    } else {
      const stopsList = document.createElement('ol');
      stopsList.className = 'flex flex-col divide-y divide-slate-800/50';

      for (const stop of orderedStops) {
        const loc = locById.get(stop.locationId);
        if (!loc) continue;
        const value     = getTraderValue?.(loc) ?? null;
        const status    = this._cardStatus(loc);

        const li = document.createElement('li');
        li.className = 'flex items-start gap-3 px-4 py-2.5';

        // Step number badge
        const numBadge = document.createElement('span');
        numBadge.className =
          'shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-[10px] font-bold ' +
          'bg-slate-800/60 border border-slate-700/40 text-slate-400 tabular-nums';
        numBadge.textContent = String(stop.order + 1);
        li.appendChild(numBadge);

        // Trader + location info
        const info = document.createElement('div');
        info.className = 'flex-1 min-w-0';

        const traderRow = document.createElement('div');
        traderRow.className = 'flex items-center gap-2 flex-wrap';

        if (onTraderClick) {
          const traderBtn = document.createElement('button');
          traderBtn.type = 'button';
          traderBtn.className = 'text-xs font-semibold text-white hover:text-indigo-300 transition-colors';
          traderBtn.textContent = loc.traderName;
          traderBtn.addEventListener('click', () => onTraderClick(loc.traderName));
          traderRow.appendChild(traderBtn);
        } else {
          const traderEl = document.createElement('span');
          traderEl.className = 'text-xs font-semibold text-white';
          traderEl.textContent = loc.traderName;
          traderRow.appendChild(traderEl);
        }

        const pfEl = document.createElement('span');
        pfEl.className = 'text-[11px] text-slate-400';
        pfEl.textContent = loc.playfield + (loc.poi ? ` \u00b7 ${loc.poi}` : '');
        traderRow.appendChild(pfEl);

        // Restock status chip
        const chip = this._buildRestockChip(loc, status);
        if (chip) traderRow.appendChild(chip);

        info.appendChild(traderRow);

        // Key items
        if (loc.keyItems?.length) {
          const itemsWrap = document.createElement('div');
          itemsWrap.className = 'flex flex-wrap gap-1 mt-1.5';
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
          info.appendChild(itemsWrap);
        }

        // Value amounts — placed inside info so they appear below key items on all screen sizes
        if (value?.sell || value?.buy) {
          const amounts = document.createElement('div');
          amounts.className = 'flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1.5';
          if (value.sell) {
            const s = document.createElement('span');
            s.className = 'text-[11px] text-emerald-500/80 font-medium tabular-nums';
            s.textContent = `+${this._fmtRange(value.sell)}`;
            amounts.appendChild(s);
          }
          if (value.buy) {
            const b = document.createElement('span');
            b.className = 'text-[11px] text-sky-500/70 font-medium tabular-nums';
            b.textContent = `\u2212${this._fmtRange(value.buy)}`;
            amounts.appendChild(b);
          }
          info.appendChild(amounts);
        }

        li.appendChild(info);

        stopsList.appendChild(li);
      }
      card.appendChild(stopsList);

      // Profit summary
      const summary = this._buildProfitSummary(
        orderedStops.map(s => s.locationId), locById, getTraderValue
      );
      if (summary) card.appendChild(summary);
    }

    return card;
  }

  /** Builds a single stop row for the builder. */
  _buildStopRow(loc, idx, total, getTraderValue, resolveIconUrl, { onMoveUp, onMoveDown, onRemove, onTraderClick = null, onItemClick = null }) {
    const value  = getTraderValue?.(loc) ?? null;
    const status = this._cardStatus(loc);

    const row = document.createElement('div');
    row.className =
      'flex items-start gap-2.5 p-3 rounded-lg bg-slate-900/50 border border-slate-800/50';

    // Order badge
    const badge = document.createElement('span');
    badge.className =
      'shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-[10px] font-bold mt-0.5 ' +
      'bg-slate-800/60 border border-slate-700/40 text-slate-400';
    badge.textContent = String(idx + 1);
    row.appendChild(badge);

    // Main content
    const content = document.createElement('div');
    content.className = 'flex-1 min-w-0 flex flex-col gap-1';

    const topLine = document.createElement('div');
    topLine.className = 'flex items-center gap-2 flex-wrap';

    if (onTraderClick) {
      const traderBtn = document.createElement('button');
      traderBtn.type = 'button';
      traderBtn.className = 'text-sm font-semibold text-white hover:text-indigo-300 transition-colors';
      traderBtn.textContent = loc.traderName;
      traderBtn.addEventListener('click', () => onTraderClick(loc.traderName));
      topLine.appendChild(traderBtn);
    } else {
      const traderEl = document.createElement('span');
      traderEl.className = 'text-sm font-semibold text-white';
      traderEl.textContent = loc.traderName;
      topLine.appendChild(traderEl);
    }

    const chip = this._buildRestockChip(loc, status);
    if (chip) topLine.appendChild(chip);

    content.appendChild(topLine);

    const pfEl = document.createElement('p');
    pfEl.className = 'text-[11px] text-slate-400';
    pfEl.textContent = loc.playfield + (loc.poi ? ` \u00b7 ${loc.poi}` : '');
    content.appendChild(pfEl);

    if (loc.keyItems?.length) {
      const itemsWrap = document.createElement('div');
      itemsWrap.className = 'flex flex-wrap gap-1 mt-0.5';
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
      content.appendChild(itemsWrap);
    }

    if (value?.sell || value?.buy) {
      const vrow = document.createElement('div');
      vrow.className = 'flex gap-3 mt-0.5';
      if (value.sell) {
        const s = document.createElement('span');
        s.className = 'text-[10px] text-emerald-500/80';
        s.textContent = `+${this._fmtRange(value.sell)}`;
        vrow.appendChild(s);
      }
      if (value.buy) {
        const b = document.createElement('span');
        b.className = 'text-[10px] text-sky-500/70';
        b.textContent = `\u2212${this._fmtRange(value.buy)}`;
        vrow.appendChild(b);
      }
      content.appendChild(vrow);
    }

    row.appendChild(content);

    // Reorder / remove controls
    const controls = document.createElement('div');
    controls.className = 'shrink-0 flex flex-col gap-0.5';

    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="18 15 12 9 6 15"/></svg>`;
    upBtn.className =
      'w-6 h-6 flex items-center justify-center rounded text-slate-600 hover:text-slate-200 hover:bg-slate-800 transition-colors disabled:opacity-30 disabled:pointer-events-none';
    upBtn.disabled = !onMoveUp;
    if (onMoveUp) upBtn.addEventListener('click', onMoveUp);

    const downBtn = document.createElement('button');
    downBtn.type = 'button';
    downBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>`;
    downBtn.className =
      'w-6 h-6 flex items-center justify-center rounded text-slate-600 hover:text-slate-200 hover:bg-slate-800 transition-colors disabled:opacity-30 disabled:pointer-events-none';
    downBtn.disabled = !onMoveDown;
    if (onMoveDown) downBtn.addEventListener('click', onMoveDown);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    removeBtn.className =
      'w-6 h-6 flex items-center justify-center rounded text-slate-700 hover:text-red-400 hover:bg-red-950/30 transition-colors mt-1';
    removeBtn.addEventListener('click', onRemove);

    controls.appendChild(upBtn);
    controls.appendChild(downBtn);
    controls.appendChild(removeBtn);
    row.appendChild(controls);

    return row;
  }

  /**
   * Builds the route total / profit summary panel appended at the card bottom.
   * Returns null when no intent-tagged items exist across any stop.
   */
  _buildProfitSummary(stopIds, locById, getTraderValue) {
    let totalSellLo = 0, totalSellHi = 0, hasSell = false;
    let totalBuyLo  = 0, totalBuyHi  = 0, hasBuy  = false;

    for (const id of stopIds) {
      const loc = locById.get(id);
      if (!loc) continue;
      const v = getTraderValue?.(loc) ?? null;
      if (!v) continue;
      if (v.sell) { totalSellLo += v.sell.lo; totalSellHi += v.sell.hi; hasSell = true; }
      if (v.buy)  { totalBuyLo  += v.buy.lo;  totalBuyHi  += v.buy.hi;  hasBuy  = true; }
    }

    if (!hasSell && !hasBuy) return null;

    const panel = document.createElement('div');
    panel.className =
      'border-t border-slate-700/40 bg-slate-900/20 px-4 py-3 flex flex-col gap-2';

    // "ROUTE TOTAL" label
    const label = document.createElement('p');
    label.className = 'text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500';
    label.textContent = 'Route Total';
    panel.appendChild(label);

    // Sell + buy rows (normal size)
    const subRows = document.createElement('div');
    subRows.className = 'flex flex-wrap gap-x-6 gap-y-1';

    if (hasSell) {
      const s = document.createElement('span');
      s.className = 'text-xs text-emerald-500/80 font-medium tabular-nums';
      s.innerHTML =
        `<span class="text-emerald-400/80 font-normal mr-1.5">Sell\u00a0income</span>` +
        `+${this._fmtRange({ lo: totalSellLo, hi: totalSellHi })}`;
      subRows.appendChild(s);
    }
    if (hasBuy) {
      const b = document.createElement('span');
      b.className = 'text-xs text-sky-500/70 font-medium tabular-nums';
      b.innerHTML =
        `<span class="text-sky-400/75 font-normal mr-1.5">Buy\u00a0cost</span>` +
        `\u2212${this._fmtRange({ lo: totalBuyLo, hi: totalBuyHi })}`;
      subRows.appendChild(b);
    }
    panel.appendChild(subRows);

    // Net estimate row — large, prominent
    if (hasSell && hasBuy) {
      const netLo   = totalSellLo - totalBuyHi; // conservative (worst case)
      const netHi   = totalSellHi - totalBuyLo; // optimistic   (best case)
      const positive = netLo >= 0;

      const netRow = document.createElement('div');
      netRow.className =
        'flex items-baseline gap-2.5 pt-1.5 mt-0.5 border-t border-slate-800/40';

      const netLabel = document.createElement('span');
      netLabel.className = 'text-[11px] font-semibold uppercase tracking-wider text-slate-500';
      netLabel.textContent = 'Net est.';
      netRow.appendChild(netLabel);

      const netValue = document.createElement('span');
      netValue.className = 'text-lg font-extrabold tabular-nums tracking-tight';
      netValue.innerHTML = this._fmtNetRange(netLo, netHi);
      netRow.appendChild(netValue);

      panel.appendChild(netRow);
    } else {
      // Only one side — show a single large total
      const onlyLo  = hasSell ? totalSellLo : -totalBuyHi;
      const onlyHi  = hasSell ? totalSellHi : -totalBuyLo;
      const isPositive = hasSell;

      const singleRow = document.createElement('div');
      singleRow.className = 'flex items-baseline gap-2.5 pt-1.5 mt-0.5 border-t border-slate-800/40';

      const singleLabel = document.createElement('span');
      singleLabel.className = 'text-[11px] font-semibold uppercase tracking-wider ' +
        (isPositive ? 'text-emerald-400/80' : 'text-sky-400/75');
      singleLabel.textContent = isPositive ? 'Total income' : 'Total cost';
      singleRow.appendChild(singleLabel);

      const singleValue = document.createElement('span');
      singleValue.className = 'text-lg font-extrabold tabular-nums tracking-tight ' +
        (isPositive ? 'text-emerald-400' : 'text-sky-400');
      singleValue.textContent = (isPositive ? '+' : '\u2212') + this._fmtRange({ lo: Math.abs(onlyLo), hi: Math.abs(onlyHi) });
      singleRow.appendChild(singleValue);

      panel.appendChild(singleRow);
    }

    return panel;
  }

  // ── Restock status helpers ────────────────────────────────────────────────

  /**
   * Builds a small inline chip showing the restock readiness of a location.
   * Returns null when no restock tracking is set.
   * @param {object} loc
   * @param {string} status  From _cardStatus()
   * @returns {Element|null}
   */
  _buildRestockChip(loc, status) {
    if (status === 'none') return null;

    const chip = document.createElement('span');
    chip.className =
      'inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border';

    const clockSvg =
      `<svg xmlns="http://www.w3.org/2000/svg" class="w-2.5 h-2.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
        `<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>` +
      `</svg>`;

    if (status === 'ready') {
      chip.className += ' bg-emerald-500/15 border-emerald-600/30 text-emerald-400';
      chip.innerHTML =
        `<svg xmlns="http://www.w3.org/2000/svg" class="w-2.5 h-2.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>` +
        `Ready`;
    } else if (status === 'warning') {
      const minAgo = (Date.now() - new Date(loc.lastVisitedAt).getTime()) / 60000;
      chip.className += ' bg-amber-500/15 border-amber-600/30 text-amber-400';
      chip.innerHTML = clockSvg + `${this._formatMinutes(Math.ceil(loc.restockMinutes - minAgo))} left`;
    } else if (status === 'countdown') {
      const minAgo = (Date.now() - new Date(loc.lastVisitedAt).getTime()) / 60000;
      chip.className += ' bg-slate-800/60 border-slate-700/40 text-slate-500';
      chip.innerHTML = clockSvg + `${this._formatMinutes(Math.ceil(loc.restockMinutes - minAgo))} left`;
    } else {
      // unvisited
      chip.className += ' bg-slate-900/50 border-slate-800/40 text-slate-600';
      chip.textContent = 'Not visited';
    }

    return chip;
  }

  /**
   * Computes an aggregate readiness status for a route.
   * - 'ready'   — every tracked stop is ready (untracked stops are ignored)
   * - 'warning' — the first stop is ready but not all tracked stops are
   * - null      — neither condition met
   */
  _routeStatus(orderedStops, locById) {
    if (!orderedStops.length) return null;
    const statuses = orderedStops
      .map(s => locById.get(s.locationId))
      .filter(Boolean)
      .map(loc => this._cardStatus(loc));

    const tracked = statuses.filter(s => s !== 'none');
    if (tracked.length > 0 && tracked.every(s => s === 'ready')) return 'ready';
    if (statuses[0] === 'ready') return 'warning';
    return null;
  }

  /** Returns a status key for the stop: 'ready'|'warning'|'countdown'|'unvisited'|'none'. */
  _cardStatus(loc) {
    if (!loc.restockMinutes) return 'none';
    if (!loc.lastVisitedAt)  return 'unvisited';
    const minAgo = (Date.now() - new Date(loc.lastVisitedAt).getTime()) / 60000;
    if (minAgo >= loc.restockMinutes)     return 'ready';
    if (loc.restockMinutes - minAgo < 10) return 'warning';
    return 'countdown';
  }

  /** Formats a minute count as a human-readable duration string. */
  _formatMinutes(minutes) {
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    if (h === 0) return `${m}min`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}min`;
  }

  /** Formats a `{lo, hi}` credit range as a compact string. */
  _fmtRange(r) {
    const lo = formatNumber(r.lo), hi = formatNumber(r.hi);
    return r.lo === r.hi ? `${lo} cr` : `${lo} \u2013 ${hi} cr`;
  }

  /**
   * Formats a net credit range as an HTML string with per-side sign coloring.
   * Positive values are emerald, negative values are red.
   * When the range straddles zero the two sides are colored independently.
   */
  _fmtNetRange(lo, hi) {
    const flo = formatNumber(lo), fhi = formatNumber(hi);
    const loColor  = lo  >= 0 ? 'text-emerald-400' : 'text-red-400';
    const hiColor  = hi  >= 0 ? 'text-emerald-400' : 'text-red-400';
    if (lo === hi) {
      return `<span class="${loColor}">${flo} cr</span>`;
    }
    if (loColor === hiColor) {
      // Both sides same sign — single colored span
      return `<span class="${loColor}">${flo} \u2013 ${fhi} cr</span>`;
    }
    // Mixed: lo negative (red), hi positive (green)
    return (
      `<span class="${loColor}">${flo}</span>` +
      `<span class="text-slate-600"> \u2013 </span>` +
      `<span class="${hiColor}">${fhi} cr</span>`
    );
  }
}

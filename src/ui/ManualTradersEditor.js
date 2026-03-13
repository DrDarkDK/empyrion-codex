import { escapeHtml } from './renderUtils.js';


const PENCIL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
const TRASH_SVG  = `<svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
const PLUS_SVG   = `<svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
const X_SVG        = `<svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
const DOWNLOAD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
const UPLOAD_SVG   = `<svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`;

/**
 * Renders and manages the manual trader editor panel.
 *
 * Cards are visually identical to TraderRenderer cards — same masonry grid,
 * same chip colours and layout, same section headers — with per-trader
 * rename/delete icon buttons and per-chip edit/delete hover overlays layered
 * on top.
 *
 * All persistence is delegated back to the caller via async callbacks so this
 * component has no direct dependency on db.js.
 */
export class ManualTradersEditor {
  constructor() {
    /** The container element currently rendered into, or null. */
    this._containerEl = null;
  }

  /**
   * @param {HTMLElement} containerEl
   * @param {object}   options
   * @param {Array}    options.traders          - Current manualTradersCfg (TraderNPC-shaped)
   * @param {Array}    options.rawDbEntries      - Raw IndexedDB entries (for price/qty data)
   * @param {Array}    options.itemSuggestions   - lastItemResults — for autocomplete
   * @param {function(string): string} options.resolveDisplayName
   * @param {function(string): string|null} options.resolveIconUrl
   * @param {function(string): Promise<void>}   options.onAddTrader    - called with trader name
   * @param {function(string, string): Promise<void>} options.onRenameTrader - (id, newName)
   * @param {function(string): Promise<void>}   options.onDeleteTrader - called with id
   * @param {function(string, 'sell'|'buy', object): Promise<void>} options.onAddItem
   * @param {function(string, 'sell'|'buy', number, object): Promise<void>} options.onUpdateItem
   * @param {function(string, 'sell'|'buy', number): Promise<void>} options.onDeleteItem
   */
  render(containerEl, options = {}) {
    this._containerEl = containerEl;
    const {
      traders            = [],
      rawDbEntries       = [],
      itemSuggestions    = [],
      resolveDisplayName = s => s,
      resolveIconUrl     = () => null,
      onTraderClick      = null,
      onImport           = async () => {},
      onAddTrader        = async () => {},
      onRenameTrader     = async () => {},
      onDeleteTrader     = async () => {},
      onAddItem          = async () => {},
      onUpdateItem       = async () => {},
      onDeleteItem       = async () => {},
    } = options;

    containerEl.innerHTML = '';

    // ── Top toolbar ───────────────────────────────────────────────────────────
    const toolbar = document.createElement('div');
    toolbar.className = 'flex items-center justify-between mb-5';
    toolbar.innerHTML =
      `<p class="text-xs text-slate-500 italic">Trader data is managed manually for this scenario.</p>
       <div class="flex items-center gap-2">
         <button id="mt-export-btn" class="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-slate-700/50 border border-slate-600/40 text-slate-300 hover:bg-slate-600/60 hover:text-white transition-colors">
           ${DOWNLOAD_SVG} Export
         </button>
         <label id="mt-import-label" class="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-slate-700/50 border border-slate-600/40 text-slate-300 hover:bg-slate-600/60 hover:text-white transition-colors cursor-pointer">
           ${UPLOAD_SVG} Import
           <input id="mt-import-input" type="file" accept=".json" class="sr-only" />
         </label>
         <button id="mt-add-trader-btn" class="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-teal-700/50 border border-teal-600/40 text-teal-200 hover:bg-teal-600/60 hover:text-white transition-colors">
           ${PLUS_SVG} Add Trader
         </button>
       </div>`;
    containerEl.appendChild(toolbar);

    // ── Export handler ────────────────────────────────────────────────────────
    toolbar.querySelector('#mt-export-btn')?.addEventListener('click', () => {
      const exportData = {
        version: 1,
        traders: rawDbEntries.map(({ name, sellingItems, buyingItems }) => ({
          name,
          sellingItems: sellingItems ?? [],
          buyingItems:  buyingItems  ?? [],
        })),
      };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = 'traders-export.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });

    // ── Import handler ────────────────────────────────────────────────────────
    toolbar.querySelector('#mt-import-input')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const json    = JSON.parse(await file.text());
        const traders = Array.isArray(json) ? json
          : Array.isArray(json.traders)     ? json.traders
          : null;
        if (!traders) throw new Error('Unrecognised format — expected a JSON object with a "traders" array.');
        await onImport(traders);
      } catch (err) {
        alert(`Import failed: ${err.message}`);
      }
      e.target.value = '';
    });

    // ── Add-trader inline form ────────────────────────────────────────────────
    const newTraderForm = document.createElement('div');
    newTraderForm.className = 'hidden mb-5 bg-[#161920] rounded-xl border border-zinc-800/60 p-4';
    newTraderForm.innerHTML =
      `<p class="text-xs font-semibold text-slate-300 mb-3">New Trader</p>
       <div class="flex gap-2">
         <input id="mt-new-trader-name" type="text" placeholder="Trader name (e.g. Zaxan the Dealer)"
                class="flex-1 bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500/50"
                autocomplete="off" spellcheck="false" />
         <button id="mt-new-trader-confirm" class="px-4 py-2 rounded-lg bg-teal-700/60 border border-teal-600/40 text-teal-200 text-xs font-medium hover:bg-teal-600/70 hover:text-white transition-colors">Add</button>
         <button id="mt-new-trader-cancel" class="px-3 py-2 rounded-lg text-slate-500 text-xs hover:text-slate-300 transition-colors">Cancel</button>
       </div>`;
    containerEl.appendChild(newTraderForm);

    const newTraderNameInp    = newTraderForm.querySelector('#mt-new-trader-name');
    const newTraderCancelBtn  = newTraderForm.querySelector('#mt-new-trader-cancel');
    const newTraderConfirmBtn = newTraderForm.querySelector('#mt-new-trader-confirm');

    toolbar.querySelector('#mt-add-trader-btn')?.addEventListener('click', () => {
      newTraderForm.classList.remove('hidden');
      newTraderNameInp?.focus();
    });
    newTraderCancelBtn?.addEventListener('click', () => {
      newTraderForm.classList.add('hidden');
      if (newTraderNameInp) newTraderNameInp.value = '';
    });

    const confirmAdd = async () => {
      const name = newTraderNameInp?.value?.trim();
      if (!name) { newTraderNameInp?.focus(); return; }
      newTraderForm.classList.add('hidden');
      newTraderNameInp.value = '';
      await onAddTrader(name);
    };
    newTraderConfirmBtn?.addEventListener('click', confirmAdd);
    newTraderNameInp?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') confirmAdd();
      if (e.key === 'Escape') newTraderCancelBtn?.click();
    });

    // ── Trader cards ──────────────────────────────────────────────────────────
    if (traders.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'text-xs text-slate-700 text-center py-20 italic select-none';
      empty.textContent = 'No traders yet. Add one above.';
      containerEl.appendChild(empty);
      return;
    }

    // Same masonry grid as TraderRenderer
    const grid = document.createElement('div');
    grid.className = 'columns-1 min-[700px]:columns-2 gap-4';
    containerEl.appendChild(grid);

    for (const trader of traders) {
      const dbEntry = rawDbEntries.find(e => e.name === trader.name) ?? {
        id: null, name: trader.name, sellingItems: [], buyingItems: [],
      };
      grid.appendChild(this._buildCard(
        trader, dbEntry, itemSuggestions, resolveDisplayName, resolveIconUrl,
        onTraderClick, onRenameTrader, onDeleteTrader, onAddItem, onUpdateItem, onDeleteItem,
      ));
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  _buildCard(trader, dbEntry, itemSuggestions, resolveDisplayName, resolveIconUrl,
    onTraderClick, onRenameTrader, onDeleteTrader, onAddItem, onUpdateItem, onDeleteItem) {

    // Outer card — identical classes to TraderRenderer placeholder
    const card = document.createElement('div');
    card.className = 'bg-[#161920] rounded-xl border border-zinc-800/60 p-4 flex flex-col gap-3 mb-4 break-inside-avoid';

    // ── Header — mirrors TraderRenderer._cardInner header exactly ─────────────
    const displayName = resolveDisplayName(trader.name ?? '') || trader.name || 'Unnamed Trader';
    const headerEl = document.createElement('div');
    headerEl.className = 'flex items-start justify-between gap-3 min-w-0';

    // Trader name — clickable button that opens the detail drawer (like TraderRenderer)
    const nameBtn = document.createElement('button');
    nameBtn.className = 'text-sm font-bold text-white flex-1 min-w-0 break-words text-left hover:text-amber-400 transition-colors';
    nameBtn.setAttribute('data-trader-ref', trader.name ?? '');
    nameBtn.textContent = displayName;
    if (onTraderClick) nameBtn.addEventListener('click', () => onTraderClick(trader.name));
    headerEl.appendChild(nameBtn);

    // Inline rename form — hidden until pencil is clicked
    const renameForm = document.createElement('div');
    renameForm.className = 'hidden flex-1 flex items-center gap-1 min-w-0';
    renameForm.innerHTML =
      `<input type="text" class="mt-rename-inp flex-1 min-w-0 bg-slate-900/50 border border-slate-700 rounded px-2 py-1 text-sm text-slate-200 outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500/50" autocomplete="off" spellcheck="false" />` +
      `<button class="mt-rename-save text-[11px] px-2 py-1 rounded bg-teal-700/60 text-teal-200 hover:bg-teal-600/70 transition-colors">Save</button>` +
      `<button class="mt-rename-cancel text-[11px] px-2 py-1 rounded text-slate-500 hover:text-slate-300 transition-colors">Cancel</button>`;
    headerEl.appendChild(renameForm);

    // Icon buttons (pencil + trash)
    const iconsEl = document.createElement('div');
    iconsEl.className = 'flex items-center gap-0.5 shrink-0';
    iconsEl.innerHTML =
      `<button class="mt-rename text-slate-600 hover:text-amber-400 transition-colors p-1 rounded" title="Rename trader" aria-label="Rename trader">${PENCIL_SVG}</button>` +
      `<button class="mt-delete text-slate-600 hover:text-red-400 transition-colors p-1 rounded" title="Delete trader" aria-label="Delete trader">${TRASH_SVG}</button>`;
    headerEl.appendChild(iconsEl);

    const openRenameForm = () => {
      nameBtn.classList.add('hidden');
      iconsEl.classList.add('hidden');
      renameForm.classList.remove('hidden');
      const inp = renameForm.querySelector('.mt-rename-inp');
      inp.value = trader.name ?? '';
      inp.focus();
      inp.select();
    };
    const closeRenameForm = () => {
      renameForm.classList.add('hidden');
      nameBtn.classList.remove('hidden');
      iconsEl.classList.remove('hidden');
    };
    const saveRename = async () => {
      const inp = renameForm.querySelector('.mt-rename-inp');
      const newName = inp?.value?.trim();
      if (!newName || newName === (trader.name ?? '')) { closeRenameForm(); return; }
      await onRenameTrader(dbEntry.id, newName);
    };

    iconsEl.querySelector('.mt-rename').addEventListener('click', openRenameForm);
    iconsEl.querySelector('.mt-delete').addEventListener('click', () => {
      if (window.confirm(`Delete trader "${trader.name}"?`)) onDeleteTrader(dbEntry.id);
    });
    renameForm.querySelector('.mt-rename-save').addEventListener('click', saveRename);
    renameForm.querySelector('.mt-rename-cancel').addEventListener('click', closeRenameForm);
    renameForm.querySelector('.mt-rename-inp').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveRename();
      if (e.key === 'Escape') closeRenameForm();
    });

    card.appendChild(headerEl);

    // ── Item sections — same 2-col grid as TraderRenderer._cardInner ──────────
    const sellingItems = dbEntry.sellingItems ?? [];
    const buyingItems  = dbEntry.buyingItems  ?? [];

    // Heat-scale credit values for buy chips (qty × price, same logic as TraderRenderer)
    const creditVals = buyingItems.map(i =>
      (i.qtyHi ?? i.qtyLo ?? 0) * (i.priceHi ?? i.priceLo ?? 0));
    const maxCredit = Math.max(1, ...creditVals, 0);

    const sectionsEl = document.createElement('div');
    sectionsEl.className = 'grid grid-cols-1 min-[420px]:grid-cols-2 gap-x-4 gap-y-3 min-w-0';
    sectionsEl.appendChild(this._buildItemsSection(
      'sell', dbEntry, sellingItems, [], 1,
      itemSuggestions, resolveDisplayName, resolveIconUrl, onAddItem, onUpdateItem, onDeleteItem,
    ));
    sectionsEl.appendChild(this._buildItemsSection(
      'buy', dbEntry, buyingItems, creditVals, maxCredit,
      itemSuggestions, resolveDisplayName, resolveIconUrl, onAddItem, onUpdateItem, onDeleteItem,
    ));
    card.appendChild(sectionsEl);

    return card;
  }

  _buildItemsSection(direction, dbEntry, items, creditVals, maxCredit,
    itemSuggestions, resolveDisplayName, resolveIconUrl, onAddItem, onUpdateItem, onDeleteItem) {

    const isSell = direction === 'sell';
    const section = document.createElement('div');
    section.className = 'flex flex-col min-w-0';

    // Section label — exact same classes as TraderRenderer._itemSection
    const labelEl = document.createElement('p');
    labelEl.className = `text-[10px] ${isSell ? 'text-emerald-600' : 'text-amber-600'} uppercase tracking-widest mb-1.5`;
    labelEl.textContent = isSell ? 'Sells to you' : 'Buys from you';
    section.appendChild(labelEl);

    // Chips list — same wrapper as TraderRenderer
    const chipsEl = document.createElement('div');
    chipsEl.className = 'flex flex-col gap-0.5';
    items.forEach((item, idx) => {
      chipsEl.appendChild(this._buildChip(
        item, idx, direction, dbEntry,
        creditVals[idx] ?? 0, maxCredit,
        itemSuggestions, resolveDisplayName, resolveIconUrl, onUpdateItem, onDeleteItem,
      ));
    });
    section.appendChild(chipsEl);

    // "+ Add item" link beneath the chips
    const addBtn = document.createElement('button');
    addBtn.className = `mt-add-item mt-1.5 flex items-center gap-1 text-[10px] ${isSell ? 'text-emerald-800 hover:text-emerald-500' : 'text-amber-800 hover:text-amber-500'} transition-colors`;
    addBtn.innerHTML = `${PLUS_SVG} Add item`;
    section.appendChild(addBtn);

    // Inline add-item form (hidden by default)
    const addForm = this._buildItemForm(
      null, null, direction, dbEntry, itemSuggestions, resolveDisplayName,
      async (data) => onAddItem(dbEntry.id, direction, data),
      () => { addForm.classList.add('hidden'); addBtn.classList.remove('hidden'); },
      'Add Item',
    );
    addForm.classList.add('hidden');
    section.appendChild(addForm);

    addBtn.addEventListener('click', () => {
      addBtn.classList.add('hidden');
      addForm.classList.remove('hidden');
      addForm.querySelector('.mt-item-search')?.focus();
    });

    return section;
  }

  /**
   * Builds a single item chip styled exactly like TraderRenderer chips,
   * with hover-visible edit / delete icon overlays.
   */
  _buildChip(item, idx, direction, dbEntry, creditVal, maxCredit,
    itemSuggestions, resolveDisplayName, resolveIconUrl, onUpdateItem, onDeleteItem) {

    const isSell = direction === 'sell';
    const display = escapeHtml(resolveDisplayName(item.devName) || item.devName || '?');

    // Qty string — e.g. " · 5–10"
    const qtyStr = (item.qtyLo != null || item.qtyHi != null)
      ? ` · ${this._fmtRange(item.qtyLo, item.qtyHi)}`
      : '';
    // Price string — e.g. " · 500–1 000 cr"
    const priceStr = (item.priceLo != null || item.priceHi != null)
      ? ` · ${this._fmtRange(item.priceLo, item.priceHi)} cr`
      : '';

    // Chip colour — IDENTICAL to TraderRenderer._itemSection
    let chipCls;
    if (isSell) {
      chipCls = 'bg-emerald-950/30 border-emerald-800/50 text-emerald-300 hover:border-emerald-600/70 hover:bg-emerald-950/60';
    } else {
      const ratio = maxCredit > 0 ? creditVal / maxCredit : 0;
      chipCls = ratio >= 0.5
        ? 'bg-amber-900/50 border-amber-600/60 text-amber-100 hover:border-amber-500/80 hover:bg-amber-900/70'
        : ratio >= 0.15
        ? 'bg-amber-950/30 border-amber-800/50 text-amber-300 hover:border-amber-600/70 hover:bg-amber-950/60'
        : 'bg-amber-950/20 border-amber-900/40 text-amber-500/70 hover:border-amber-800/50 hover:bg-amber-950/40';
    }

    // Optional item icon — same img element as TraderRenderer
    let iconHtml = '';
    if (resolveIconUrl) {
      const url = resolveIconUrl(item.devName);
      if (url) iconHtml = `<img src="${escapeHtml(url)}" alt="" class="w-4 h-4 object-contain shrink-0" loading="lazy" draggable="false" />`;
    }

    // Wrapper provides the `group` context for the hover-reveal edit overlay
    const wrapper = document.createElement('div');
    wrapper.className = 'relative group';
    wrapper.innerHTML =
      `<div class="flex items-start gap-1 text-[10px] px-2 py-0.5 rounded border ${chipCls} transition-colors">` +
      `${iconHtml}` +
      `<span class="flex-1 min-w-0 break-words">${display}${escapeHtml(qtyStr)}${escapeHtml(priceStr)}</span>` +
      // Edit/delete appear on hover, at the right edge of the chip
      `<div class="flex items-center gap-0.5 ml-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">` +
      `<button class="mt-chip-edit flex items-center justify-center w-4 h-4 hover:opacity-80 transition-opacity" title="Edit item" aria-label="Edit item">${PENCIL_SVG}</button>` +
      `<button class="mt-chip-delete flex items-center justify-center w-4 h-4 hover:text-red-400 transition-colors" title="Remove item" aria-label="Remove item">${X_SVG}</button>` +
      `</div></div>`;

    wrapper.querySelector('.mt-chip-edit').addEventListener('click', (e) => {
      e.preventDefault();
      const editForm = this._buildItemForm(
        item, idx, direction, dbEntry, itemSuggestions, resolveDisplayName,
        async (data) => onUpdateItem(dbEntry.id, direction, idx, data),
        () => { editForm.remove(); wrapper.classList.remove('hidden'); },
        'Save',
      );
      wrapper.insertAdjacentElement('afterend', editForm);
      wrapper.classList.add('hidden');
    });
    wrapper.querySelector('.mt-chip-delete').addEventListener('click', (e) => {
      e.preventDefault();
      onDeleteItem(dbEntry.id, direction, idx);
    });

    return wrapper;
  }

  /**
   * Unified item form used for both Add and Edit.
   * When `prefillItem` is null it acts as an add form; otherwise it pre-fills
   * the search field and number inputs from the existing item.
   */
  _buildItemForm(prefillItem, _prefillIdx, direction, dbEntry,
    itemSuggestions, resolveDisplayName, onConfirm, onCancel, confirmLabel) {

    const isSell = direction === 'sell';
    const form = document.createElement('div');
    form.className =
      `mt-1 rounded-lg border ${isSell ? 'border-emerald-900/50 bg-emerald-950/20' : 'border-amber-900/50 bg-amber-950/20'} p-3 flex flex-col gap-2`;

    // Item search field
    const searchWrap = this._buildItemSearchField(itemSuggestions, resolveDisplayName);
    if (prefillItem) {
      const searchEl = searchWrap.querySelector('.mt-item-search');
      const hiddenEl = searchWrap.querySelector('.mt-item-devname');
      if (searchEl) searchEl.value = resolveDisplayName(prefillItem.devName) || prefillItem.devName;
      if (hiddenEl) hiddenEl.value = prefillItem.devName;
    }
    form.appendChild(searchWrap);

    // Price / qty fields
    form.appendChild(this._buildPriceQtyFields(isSell, prefillItem ?? {}));

    // Footer buttons
    const footer = document.createElement('div');
    footer.className = 'flex gap-2 justify-end';
    footer.innerHTML =
      `<button class="mt-item-cancel text-[11px] text-slate-500 hover:text-slate-300 transition-colors px-2 py-1 rounded">Cancel</button>` +
      `<button class="mt-item-confirm text-[11px] px-3 py-1 rounded `+
      `${isSell ? 'bg-emerald-800/60 text-emerald-200 hover:bg-emerald-700/60' : 'bg-amber-800/60 text-amber-200 hover:bg-amber-700/60'} transition-colors">${escapeHtml(confirmLabel)}</button>`;
    form.appendChild(footer);

    footer.querySelector('.mt-item-cancel').addEventListener('click', () => {
      form.remove();
      onCancel();
    });
    footer.querySelector('.mt-item-confirm').addEventListener('click', async () => {
      const data = this._readFormData(form, itemSuggestions, resolveDisplayName);
      if (!data) return;
      form.remove();
      await onConfirm(data);
    });

    return form;
  }

  /** Builds the item search input with a suggestion dropdown. */
  _buildItemSearchField(itemSuggestions, resolveDisplayName) {
    const wrap = document.createElement('div');
    wrap.className = 'relative';
    wrap.innerHTML =
      `<input class="mt-item-search w-full bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder-slate-600 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50"
              type="text" placeholder="Search items…" autocomplete="off" spellcheck="false" />
       <input class="mt-item-devname" type="hidden" value="" />
       <div class="mt-item-suggestions absolute z-20 left-0 right-0 top-full mt-1 bg-[#1a1e26] border border-slate-700 rounded-lg shadow-xl max-h-48 overflow-y-auto hidden"></div>`;

    const searchEl   = wrap.querySelector('.mt-item-search');
    const hiddenEl   = wrap.querySelector('.mt-item-devname');
    const suggestEl  = wrap.querySelector('.mt-item-suggestions');
    let _cache = null;

    searchEl.addEventListener('input', () => {
      const q = searchEl.value.trim().toLowerCase();
      if (!q) { suggestEl.classList.add('hidden'); _cache = null; return; }

      _cache = itemSuggestions.filter(i => {
        const localized = (resolveDisplayName(i.name) || '').toLowerCase();
        return localized.includes(q) || (i.name || '').toLowerCase().includes(q);
      }).slice(0, 30);

      if (!_cache.length) { suggestEl.classList.add('hidden'); return; }

      suggestEl.innerHTML = _cache.map((i, n) => {
        const localName = resolveDisplayName(i.name) || i.name;
        // Show devName as a secondary hint when it differs from the localized name
        const devHint = localName !== i.name
          ? `<span class="text-slate-600 ml-1.5 text-[10px]">${escapeHtml(i.name)}</span>`
          : '';
        return `<button type="button" data-n="${n}" class="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700/60 flex items-baseline gap-1 min-w-0">` +
          `<span class="truncate flex-1">${escapeHtml(localName)}</span>${devHint}</button>`;
      }).join('');
      suggestEl.classList.remove('hidden');
    });

    suggestEl.addEventListener('mousedown', (e) => {
      const btn = e.target.closest('[data-n]');
      if (!btn || !_cache) return;
      e.preventDefault();
      const item = _cache[Number(btn.dataset.n)];
      if (!item) return;
      searchEl.value = resolveDisplayName(item.name) || item.name;
      hiddenEl.value = item.name;   // always store the devName
      suggestEl.classList.add('hidden');
    });

    searchEl.addEventListener('blur', () => setTimeout(() => suggestEl.classList.add('hidden'), 150));

    return wrap;
  }

  /** Builds the stock qty / price range inputs, optionally pre-filled. */
  _buildPriceQtyFields(isSell, prefill = {}) {
    const { qtyLo = '', qtyHi = '', priceLo = '', priceHi = '' } = prefill;
    const v = x => (x == null ? '' : String(x));
    const priceHint = isSell ? 'Price you pay' : 'Price trader pays';
    const wrap = document.createElement('div');
    wrap.className = 'grid grid-cols-2 gap-2';
    wrap.innerHTML =
      `<div class="flex flex-col gap-1">
         <label class="text-[10px] text-slate-500 uppercase tracking-widest">Min stock</label>
         <input class="mt-qty-lo bg-slate-900/60 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 outline-none focus:ring-1 focus:ring-blue-500/30" type="number" min="0" placeholder="0" value="${escapeHtml(v(qtyLo))}" />
       </div>
       <div class="flex flex-col gap-1">
         <label class="text-[10px] text-slate-500 uppercase tracking-widest">Max stock</label>
         <input class="mt-qty-hi bg-slate-900/60 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 outline-none focus:ring-1 focus:ring-blue-500/30" type="number" min="0" placeholder="0" value="${escapeHtml(v(qtyHi))}" />
       </div>
       <div class="flex flex-col gap-1">
         <label class="text-[10px] text-slate-500 uppercase tracking-widest">Cheapest seen (cr)</label>
         <input class="mt-price-lo bg-slate-900/60 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 outline-none focus:ring-1 focus:ring-blue-500/30" type="number" min="0" placeholder="500" value="${escapeHtml(v(priceLo))}" />
       </div>
       <div class="flex flex-col gap-1">
         <label class="text-[10px] text-slate-500 uppercase tracking-widest">Most expensive (cr)</label>
         <input class="mt-price-hi bg-slate-900/60 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 outline-none focus:ring-1 focus:ring-blue-500/30" type="number" min="0" placeholder="1 000" value="${escapeHtml(v(priceHi))}" />
       </div>`;
    const hint = document.createElement('p');
    hint.className = 'col-span-2 text-[10px] text-slate-600 italic';
    hint.textContent = `${priceHint}: lower when stock is full, higher when stock is low.`;
    wrap.appendChild(hint);
    return wrap;
  }

  /**
   * Reads and validates form data.
   * If the user typed a localized name without selecting a suggestion, tries to
   * reverse-look up the devName from `itemSuggestions`.
   * Returns null if no item name was entered.
   */
  _readFormData(form, itemSuggestions = [], resolveDisplayName = s => s) {
    const searchEl  = form.querySelector('.mt-item-search');
    const hiddenEl  = form.querySelector('.mt-item-devname');

    let devName = hiddenEl?.value?.trim();

    // If no devName was captured (user typed without selecting suggestion),
    // try to match the typed text against devNames and localized names.
    if (!devName) {
      const typed = searchEl?.value?.trim();
      if (!typed) { searchEl?.focus(); return null; }
      const typedLc = typed.toLowerCase();
      const byDev = itemSuggestions.find(i => (i.name ?? '').toLowerCase() === typedLc);
      if (byDev) {
        devName = byDev.name;
      } else {
        const byLocalized = itemSuggestions.find(
          i => (resolveDisplayName(i.name) ?? '').toLowerCase() === typedLc,
        );
        devName = byLocalized ? byLocalized.name : typed;
      }
    }

    if (!devName) { searchEl?.focus(); return null; }

    const toNum = el => { const n = parseFloat(el?.value); return isNaN(n) ? null : n; };
    return {
      devName,
      qtyLo:   toNum(form.querySelector('.mt-qty-lo')),
      qtyHi:   toNum(form.querySelector('.mt-qty-hi')),
      priceLo: toNum(form.querySelector('.mt-price-lo')),
      priceHi: toNum(form.querySelector('.mt-price-hi')),
    };
  }

  _fmtRange(lo, hi, fallback = '—') {
    if (lo == null && hi == null) return fallback;
    if (lo == null || hi == null) return String(lo ?? hi);
    return lo === hi ? String(lo) : `${lo}–${hi}`;
  }

  teardown(containerEl) {
    containerEl.innerHTML = '';
  }
}

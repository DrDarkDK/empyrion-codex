import { escapeHtml } from './renderUtils.js';

/**
 * @typedef {import('./TraderLocationEditor.js').TraderLocation} TraderLocation
 * @typedef {import('./TraderLocationEditor.js').TraderItem}     TraderItem
 */

/**
 * Builds and injects a "Add / Edit Location" form into `container`.
 *
 * Calls `onSave(entry)` with the validated form data on submission,
 * or `onCancel()` when the user dismisses the form.
 *
 * @param {HTMLElement}         container
 * @param {function}            onSave
 * @param {function}            onCancel
 * @param {TraderItem[]}        [traderItems=[]]
 * @param {function|null}       [resolveIconUrl=null]
 * @param {TraderLocation|null} [existingLoc=null]  - When set, form pre-fills for editing
 */
export function buildLocationForm(container, onSave, onCancel, traderItems = [], resolveIconUrl = null, existingLoc = null) {
  const fieldCls =
    'block w-full bg-[#070a10] border border-zinc-700/60 rounded-lg px-3 py-2 ' +
    'text-xs text-slate-200 placeholder-zinc-600 outline-none ' +
    'focus:border-teal-600/60 focus:ring-1 focus:ring-teal-600/20 transition-all';
  const labelCls = 'block text-[10px] text-zinc-400 uppercase tracking-wider font-medium mb-1.5';

  const isEditing = existingLoc != null;

  // Track selected key items — must be in outer scope so the save handler can read it.
  // Each entry: { devName, displayName, intent: 'sell'|'buy'|null }
  let selectedItems = isEditing ? [...(existingLoc.keyItems ?? [])].map(i => ({ intent: null, ...i })) : [];

  container.innerHTML =
    `<div class="rounded-xl overflow-hidden border border-zinc-700/40 shadow-2xl shadow-black/50">` +

      // ── Header ──────────────────────────────────────────────────────────
      `<div class="flex items-center gap-2.5 px-4 py-3 bg-gradient-to-r from-teal-950/80 to-[#0a0c11] border-b border-teal-900/40">` +
        `<svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 shrink-0 text-teal-400/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
          (isEditing
            ? `<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>`
            : `<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>`) +
        `</svg>` +
        `<span class="text-sm font-semibold text-slate-200">${isEditing ? 'Edit Location' : 'Add Location'}</span>` +
      `</div>` +

      // ── Body ────────────────────────────────────────────────────────────
      `<div class="flex flex-col gap-4 px-4 pt-4 pb-3 bg-[#0a0c11]">` +

        `<div class="grid grid-cols-2 gap-3">` +
          `<div>` +
            `<label class="${labelCls}">Playfield <span class="text-red-400/80 normal-case not-italic font-normal" aria-hidden="true">*</span></label>` +
            `<input type="text" name="loc-playfield" placeholder="e.g. Akua" class="${fieldCls}" autocomplete="off" spellcheck="false" />` +
          `</div>` +
          `<div>` +
            `<label class="${labelCls}">POI / Station <span class="text-red-400/80 normal-case not-italic font-normal" aria-hidden="true">*</span></label>` +
            `<input type="text" name="loc-poi" placeholder="e.g. Trading Post Alpha" class="${fieldCls}" autocomplete="off" spellcheck="false" />` +
          `</div>` +
        `</div>` +

        `<div>` +
          `<label class="${labelCls}">Restock interval <span class="text-zinc-500 normal-case not-italic font-normal">— optional</span></label>` +
          `<div class="flex items-center gap-2">` +
            `<input type="number" name="loc-restock" min="1" step="1" placeholder="e.g. 1440" class="${fieldCls} w-32" />` +
            `<span class="text-[11px] text-zinc-400 shrink-0">minutes (real-world time)</span>` +
          `</div>` +
        `</div>` +

        `<div>` +
          `<label class="${labelCls}">Notes <span class="text-zinc-500 normal-case not-italic font-normal">— optional</span></label>` +
          `<textarea name="loc-notes" rows="2" ` +
            `placeholder="e.g. Behind the locked door, requires Blue Keycard" ` +
            `class="${fieldCls} resize-none"></textarea>` +
        `</div>` +

        `<div class="loc-key-items-wrap"></div>` +

      `</div>` +

      // ── Footer ──────────────────────────────────────────────────────────
      `<div class="flex items-center justify-between gap-2 px-4 py-3 border-t border-zinc-800/60 bg-zinc-950/50">` +
        `<button type="button" class="loc-form-cancel text-xs px-4 py-2 rounded-lg border border-zinc-700/60 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600/70 hover:bg-zinc-800/40 transition-all">Cancel</button>` +
        `<button type="button" class="loc-form-save text-xs px-5 py-2 rounded-lg font-semibold text-white transition-all bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-500 hover:to-cyan-500 shadow-lg shadow-teal-900/40 hover:shadow-teal-800/50 active:scale-[0.98] disabled:opacity-35 disabled:pointer-events-none disabled:shadow-none" ${isEditing ? '' : 'disabled'}>${isEditing ? 'Save Changes' : 'Save Location'}</button>` +
      `</div>` +

    `</div>`;

  const playfieldInput = container.querySelector('[name="loc-playfield"]');
  const poiInput       = container.querySelector('[name="loc-poi"]');
  const restockInput   = container.querySelector('[name="loc-restock"]');
  const notesInput     = container.querySelector('[name="loc-notes"]');
  const saveBtn        = container.querySelector('.loc-form-save');
  const cancelBtn      = container.querySelector('.loc-form-cancel');
  const keyItemsWrap   = container.querySelector('.loc-key-items-wrap');

  // Pre-fill for edit mode
  if (isEditing) {
    playfieldInput.value = existingLoc.playfield ?? '';
    poiInput.value       = existingLoc.poi ?? '';
    restockInput.value   = existingLoc.restockMinutes != null ? String(existingLoc.restockMinutes) : '';
    notesInput.value     = existingLoc.notes ?? '';
  }

  // ── Key Items picker ──────────────────────────────────────────────────────
  if (traderItems.length) {
    const labelEl = document.createElement('label');
    labelEl.className = labelCls;
    labelEl.innerHTML =
      `Key Items <span class="text-zinc-500 normal-case not-italic font-normal">— optional</span>` +
      `<span class="ml-2 text-[9px] normal-case not-italic font-normal text-zinc-400 tracking-normal">` +
        `<span class="text-emerald-400">S</span> = sell &nbsp;` +
        `<span class="text-sky-400">B</span> = buy &nbsp;` +
        `<span class="text-zinc-400">·</span> = note only` +
      `</span>`;

    const selectedPillsEl = document.createElement('div');
    selectedPillsEl.className = 'flex flex-wrap gap-1.5 mb-2';

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = "Search this trader's items\u2026";
    searchInput.className = fieldCls;
    searchInput.autocomplete = 'off';
    searchInput.spellcheck = false;

    const suggestionsEl = document.createElement('div');
    suggestionsEl.className = 'flex flex-wrap gap-1.5 mt-1.5 max-h-20 overflow-y-auto';

    keyItemsWrap.appendChild(labelEl);
    keyItemsWrap.appendChild(selectedPillsEl);
    keyItemsWrap.appendChild(searchInput);
    keyItemsWrap.appendChild(suggestionsEl);

    const renderPills = () => {
      selectedPillsEl.innerHTML = '';
      for (const item of selectedItems) {
        const pill = document.createElement('span');
        // Base pill style — intent colours applied below
        const intentCls = {
          sell: 'bg-emerald-950/50 border-emerald-800/60 text-emerald-300',
          buy:  'bg-sky-950/50     border-sky-800/60     text-sky-300',
          null: 'bg-zinc-800/50    border-zinc-700/50    text-zinc-400',
        }[item.intent ?? 'null'];
        pill.className = `inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full border ${intentCls}`;

        const iconUrl = resolveIconUrl?.(item.devName);
        if (iconUrl) {
          const img = document.createElement('img');
          img.src = iconUrl; img.alt = ''; img.draggable = false;
          img.className = 'w-3.5 h-3.5 object-contain shrink-0';
          pill.appendChild(img);
        }
        const nameSpan = document.createElement('span');
        nameSpan.textContent = item.displayName;
        pill.appendChild(nameSpan);

        // ── Intent toggle: cycles null → sell → buy → null ──────────────
        const intentBtn = document.createElement('button');
        intentBtn.type = 'button';
        const intentLabel = { sell: 'S', buy: 'B', null: '·' };
        const intentTitle = { sell: 'Selling here — click to switch to Buy', buy: 'Buying here — click to clear', null: 'No intent — click to mark as Sell' };
        const nextIntent  = { null: 'sell', sell: 'buy', buy: null };
        const updateIntentBtn = () => {
          const k = item.intent ?? 'null';
          intentBtn.textContent = intentLabel[k];
          intentBtn.title = intentTitle[k];
          intentBtn.className = {
            sell: 'ml-0.5 w-3.5 h-3.5 rounded-full text-[9px] font-bold leading-none flex items-center justify-center bg-emerald-700/60 text-emerald-200 hover:bg-emerald-600/70',
            buy:  'ml-0.5 w-3.5 h-3.5 rounded-full text-[9px] font-bold leading-none flex items-center justify-center bg-sky-700/60     text-sky-200     hover:bg-sky-600/70',
            null: 'ml-0.5 w-3.5 h-3.5 rounded-full text-[9px] font-bold leading-none flex items-center justify-center bg-zinc-700/60    text-zinc-400    hover:bg-zinc-600/70',
          }[k];
        };
        updateIntentBtn();
        intentBtn.addEventListener('click', () => {
          item.intent = nextIntent[item.intent ?? 'null'];
          renderPills();
        });
        pill.appendChild(intentBtn);

        // ── Remove button ────────────────────────────────────────────────
        const xBtn = document.createElement('button');
        xBtn.type = 'button';
        xBtn.className = 'text-zinc-600 hover:text-zinc-300 leading-none';
        xBtn.setAttribute('aria-label', `Remove ${item.displayName}`);
        xBtn.textContent = '\u00d7';
        xBtn.addEventListener('click', () => {
          selectedItems = selectedItems.filter(i => i.devName !== item.devName);
          renderPills();
          renderSuggestions(searchInput.value);
        });
        pill.appendChild(xBtn);
        selectedPillsEl.appendChild(pill);
      }
    };

    const renderSuggestions = (query) => {
      const q = query.trim().toLowerCase();
      const unselected = traderItems.filter(
        i => !selectedItems.some(s => s.devName === i.devName),
      );
      const filtered = q
        ? unselected.filter(
            i => i.displayName.toLowerCase().includes(q) || i.devName.toLowerCase().includes(q),
          )
        : unselected.slice(0, 8);

      suggestionsEl.innerHTML = '';
      if (!filtered.length) {
        if (q) {
          const none = document.createElement('span');
          none.className = 'text-[11px] text-zinc-700 italic';
          none.textContent = 'No matching items';
          suggestionsEl.appendChild(none);
        }
        return;
      }
      for (const item of filtered.slice(0, 10)) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className =
          'inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border transition-colors ' +
          'bg-zinc-800/60 border-zinc-700/50 text-zinc-400 ' +
          'hover:bg-blue-950/40 hover:border-blue-900/50 hover:text-blue-400';
        const iconUrl = resolveIconUrl?.(item.devName);
        if (iconUrl) {
          const img = document.createElement('img');
          img.src = iconUrl; img.alt = ''; img.draggable = false;
          img.className = 'w-3.5 h-3.5 object-contain shrink-0';
          btn.appendChild(img);
        }
        const span = document.createElement('span');
        span.textContent = item.displayName;
        btn.appendChild(span);
        btn.addEventListener('click', () => {
          selectedItems = [...selectedItems, { devName: item.devName, displayName: item.displayName, intent: null }];
          searchInput.value = '';
          renderPills();
          renderSuggestions('');
        });
        suggestionsEl.appendChild(btn);
      }
    };

    searchInput.addEventListener('input', () => renderSuggestions(searchInput.value));
    renderSuggestions(''); // Populate initial suggestions
    if (isEditing) renderPills(); // Show pre-populated items
  }

  const validate = () => {
    saveBtn.disabled = !playfieldInput.value.trim() || !poiInput.value.trim();
  };
  playfieldInput.addEventListener('input', validate);
  poiInput.addEventListener('input', validate);

  cancelBtn.addEventListener('click', () => onCancel());

  // Escape also cancels. stopPropagation prevents a parent drawer Escape
  // handler from closing the whole drawer while the form is open inside it.
  container.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); onCancel(); }
  });

  saveBtn.addEventListener('click', async () => {
    if (saveBtn.disabled) return;
    saveBtn.disabled    = true;
    saveBtn.textContent = 'Saving\u2026';
    const restockRaw = restockInput.value.trim();
    // When editing: preserve the original id and lastVisitedAt.
    // Preserve existing keyItems when the picker was not shown (no traderItems).
    const hasKeyPicker = traderItems.length > 0;
    try {
      await onSave(/** @type {TraderLocation} */ ({
        ...(isEditing ? existingLoc : {}),
        id:             isEditing ? existingLoc.id : crypto.randomUUID(),
        playfield:      playfieldInput.value.trim(),
        poi:            poiInput.value.trim(),
        restockMinutes: restockRaw ? Math.max(1, Math.round(Number(restockRaw))) : null,
        notes:          notesInput.value.trim() || null,
        keyItems:       hasKeyPicker
                          ? (selectedItems.length ? selectedItems : null)
                          : (isEditing ? existingLoc.keyItems ?? null : null),
        lastVisitedAt:  isEditing ? existingLoc.lastVisitedAt : null,
      }));
    } catch {
      // Restore the button so the user can retry
      saveBtn.textContent = isEditing ? 'Save Changes' : 'Save Location';
      saveBtn.disabled    = false;
    }
  });

  playfieldInput.focus();
}

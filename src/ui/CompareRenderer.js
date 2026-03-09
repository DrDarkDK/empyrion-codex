/**
 * CompareRenderer.js
 *
 * Renders a ComparisonResult (from CompareBuilder.buildComparison) as HTML
 * into a container element. No DOM state — safe to call render() repeatedly.
 */

import { escapeHtml, formatNumber, formatPrice, setContainerClickHandler } from './renderUtils.js';
import { filterDiffs } from './CompareBuilder.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const LABEL_W   = '140px';
const COL_MIN_W = '200px';

/** Viewport width (px) below which the mobile stacked layout kicks in. */
const MOBILE_BREAKPOINT = 1000;

const SECTION_ACCENTS = {
  sky:     { text: 'text-sky-400',     border: 'border-sky-400/40',     bg: 'bg-sky-950/30'     },
  violet:  { text: 'text-violet-400',  border: 'border-violet-400/40',  bg: 'bg-violet-950/30'  },
  zinc:    { text: 'text-zinc-400',    border: 'border-zinc-700/60',    bg: 'bg-zinc-800/25'    },
  orange:  { text: 'text-orange-400',  border: 'border-orange-400/40',  bg: 'bg-orange-950/30'  },
  emerald: { text: 'text-emerald-400', border: 'border-emerald-400/40', bg: 'bg-emerald-950/30' },
};

/** Keys rendered in the per-item chip sections and their labels. */
const CHIP_SECTION_LABELS = {
  SlotItems:   'Equipable Boosters',
  AmmoType:    'Ammo Type',
  UpgradeTo:   'Upgrades To',
  DowngradeTo: 'Downgrades To',
  Accept:      'Accepts',
  ChildBlocks: 'Variants',
};

// ── Local helpers ─────────────────────────────────────────────────────────────

/**
 * Formats a duration in seconds to a compact human-readable string.
 * @param {number} sec
 * @returns {string}
 */
function formatDuration(sec) {
  if (sec < 60)    return `${sec}s`;
  if (sec < 3600)  { const m = Math.floor(sec / 60),   s = sec % 60;                           return s ? `${m}m ${s}s` : `${m}m`; }
  if (sec < 86400) { const h = Math.floor(sec / 3600),  m = Math.floor((sec % 3600) / 60);     return m ? `${h}h ${m}m` : `${h}h`; }
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600);
  return h ? `${d}d ${h}h` : `${d}d`;
}

// ── Renderer class ────────────────────────────────────────────────────────────

export class CompareRenderer {
  constructor() {
    /** Blob URLs created for icon images — revoked on next render. */
    this._iconUrls = [];
  }

  /**
   * Renders the comparison into containerEl.
   *
   * @param {import('./CompareBuilder.js').ComparisonResult} result
   * @param {HTMLElement} containerEl
   * @param {object}  [options]
   * @param {boolean} [options.showDiffsOnly]    When true, aligned rows/sections with identical values are hidden.
   * @param {function(string): string}      [options.resolveLocalized]  Localization resolver.
   * @param {function(string): string|null} [options.resolveIconUrl]    Icon blob URL resolver.
   * @param {function(string): void}        [options.onItemClick]       Called with devName when a chip is clicked.
   * @param {function(string): void}        [options.onRemoveItem]      Called with devName when a column × is clicked.
   */
  render(result, containerEl, options = {}) {
    const {
      showDiffsOnly    = false,
      resolveLocalized = null,
      resolveIconUrl   = null,
      onItemClick      = null,
      onRemoveItem     = null,
      onMoveItem       = null,
    } = options;

    for (const url of this._iconUrls) URL.revokeObjectURL(url);
    this._iconUrls = [];

    const n = result.items.length;
    if (!n) { containerEl.innerHTML = ''; return; }

    // Choose layout mode based on viewport width.
    // The overlay is fixed inset-0 so window.innerWidth equals the available width.
    const mobile = window.innerWidth < MOBILE_BREAKPOINT;

    // Aligned rows use the (possibly filtered) version; complex per-item sections always use the full result.
    const aligned = showDiffsOnly ? filterDiffs(result) : result;

    // Cap column width to avoid massive empty cells with few items.
    // The sticky header inner div and scrollable content share maxWidth so grids stay aligned.
    const maxWidth = n <= 2 ? '860px' : n === 3 ? '1080px' : '1400px';

    const gridCols      = `${LABEL_W} repeat(${n}, minmax(${COL_MIN_W}, 1fr))`;
    const gridColsFull  = `repeat(${n}, minmax(${COL_MIN_W}, 1fr))`;

    // Mobile uses auto card columns capped at 2 per row so cards breathe.
    const mobileCardCols = n === 1 ? '1fr' : 'repeat(auto-fill,minmax(200px,1fr))';

    const parts = [];

    // ── Sticky column headers ───────────────────────────────────────────────
    parts.push(this._columnHeaders(result.items, n, gridColsFull, maxWidth, resolveLocalized, resolveIconUrl, onRemoveItem, onMoveItem, mobile));

    // ── Scrollable content ──────────────────────────────────────────────────
    parts.push(`<div style="max-width:${mobile ? '100%' : maxWidth};margin:0 auto" class="px-3 md:px-6 pb-12">`);

    // Mobile: inject diff-only toggle above the first section
    if (mobile) {
      parts.push(this._mobileDiffToggle(showDiffsOnly));
    }

    // Stats row
    if (aligned.statsRow.length) {
      parts.push(this._sectionHeading('Stats', 'orange'));
      if (mobile) {
        parts.push(this._stackedBlock(aligned.statsRow, result.items, n, resolveLocalized, resolveIconUrl));
      } else {
        parts.push(this._alignedBlock(aligned.statsRow, n, gridCols));
      }
    }

    // Property sections
    for (const section of aligned.sections) {
      parts.push(this._sectionHeading(section.title, section.accent));
      if (mobile) {
        parts.push(this._stackedBlock(section.rows, result.items, n, resolveLocalized, resolveIconUrl));
      } else {
        parts.push(this._alignedBlock(section.rows, n, gridCols));
      }
    }

    // Per-item detail cards (always full, never diff-filtered)
    const hasRecipes = result.recipes.some(r => r != null);
    const hasChips   = this._hasAnyChips(result.chipData, n);
    const hasTraders = result.traderData.some(td => td.length > 0);
    const hasIngredients = result.ingredientRows?.length > 0;

    // ── Crafting Recipe meta row (equal-height cards) ───────────────────────
    if (hasRecipes) {
      parts.push(this._sectionHeading('Crafting Recipe', 'emerald'));
      const recipeCols = mobile ? mobileCardCols : gridColsFull;
      parts.push(`<div style="display:grid;grid-template-columns:${recipeCols};gap:12px;align-items:stretch;margin-bottom:8px">`);
      for (let i = 0; i < n; i++) {
        if (result.recipes[i]) {
          const itemName = resolveLocalized
            ? (resolveLocalized(result.items[i]?.name ?? '') || escapeHtml(result.items[i]?.name ?? ''))
            : escapeHtml(result.items[i]?.name ?? '');
          parts.push(this._recipeCard(result.recipes[i], resolveLocalized, resolveIconUrl, mobile ? itemName : null));
        } else if (!mobile) {
          parts.push('<div></div>');
        }
      }
      parts.push('</div>');
    }

    // ── Ingredient comparison rows ──────────────────────────────────────────
    if (hasIngredients) {
      const ingredientRows = result.ingredientRows;
      // Resolve display labels: strip HTML from localized names for plain-text label column
      const resolvedRows = ingredientRows.map(row => ({
        ...row,
        label: resolveLocalized
          ? resolveLocalized(row.key).replace(/<[^>]*>/g, '')
          : row.label,
      }));
      const filteredRows = showDiffsOnly ? resolvedRows.filter(r => r.isDiff) : resolvedRows;
      if (filteredRows.length) {
        parts.push(this._sectionHeading('Ingredients', 'emerald'));
        if (mobile) {
          parts.push(this._stackedBlock(filteredRows, result.items, n, resolveLocalized, resolveIconUrl));
        } else {
          parts.push(this._alignedBlock(filteredRows, n, gridCols, resolveIconUrl));
        }
      }
    }

    // ── Chip sections row ───────────────────────────────────────────────────
    if (hasChips) {
      parts.push(this._sectionHeading('Item Variants & Links', 'zinc'));
      const chipCols = mobile ? mobileCardCols : gridColsFull;
      parts.push(`<div style="display:grid;grid-template-columns:${chipCols};gap:12px;align-items:stretch;margin-bottom:8px">`);
      for (let i = 0; i < n; i++) {
        const chips = this._chipsForItem(result.chipData, i, resolveLocalized, resolveIconUrl);
        if (chips) {
          // On mobile wrap each card with an item label header
          if (mobile) {
            const iName = resolveLocalized
              ? (resolveLocalized(result.items[i]?.name ?? '') || escapeHtml(result.items[i]?.name ?? ''))
              : escapeHtml(result.items[i]?.name ?? '');
            parts.push(`<div><p class="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mb-1.5 truncate">${iName}</p>${chips}</div>`);
          } else {
            parts.push(chips);
          }
        } else if (!mobile) {
          parts.push('<div></div>');
        }
      }
      parts.push('</div>');
    }

    // ── Trading row ─────────────────────────────────────────────────────────
    if (hasTraders) {
      parts.push(this._sectionHeading('Trading', 'sky'));
      const tradingCols = mobile ? mobileCardCols : gridColsFull;
      parts.push(`<div style="display:grid;grid-template-columns:${tradingCols};gap:12px;align-items:stretch;margin-bottom:8px">`);
      for (let i = 0; i < n; i++) {
        if (result.traderData[i]?.length) {
          const iName = resolveLocalized
            ? (resolveLocalized(result.items[i]?.name ?? '') || escapeHtml(result.items[i]?.name ?? ''))
            : escapeHtml(result.items[i]?.name ?? '');
          parts.push(this._tradingCard(result.traderData[i], resolveLocalized, mobile ? iName : null));
        } else if (!mobile) {
          parts.push('<div></div>');
        }
      }
      parts.push('</div>');
    }

    parts.push(`</div>`); // end scrollable content

    containerEl.innerHTML = parts.join('');

    // Delegated click handler
    setContainerClickHandler(containerEl, (e) => {
      const removeBtn = e.target.closest('[data-compare-remove]');
      if (removeBtn && onRemoveItem) { onRemoveItem(removeBtn.dataset.compareRemove); return; }
      const moveBtn = e.target.closest('[data-compare-move]');
      if (moveBtn && onMoveItem) { onMoveItem(moveBtn.dataset.compareName, Number(moveBtn.dataset.compareMove)); return; }
      const chipBtn = e.target.closest('[data-compare-chip]');
      if (chipBtn && onItemClick) { onItemClick(chipBtn.dataset.compareChip); return; }
    });
  }

  // ── Column headers ─────────────────────────────────────────────────────────

  _columnHeaders(items, n, gridColsFull, maxWidth, resolveLocalized, resolveIconUrl, onRemoveItem, onMoveItem, mobile = false) {
    // On mobile render a horizontal scrollable strip of compact item pills
    if (mobile) {
      return this._mobileColumnHeaders(items, n, resolveLocalized, resolveIconUrl, onRemoveItem, onMoveItem);
    }
    const cells = items.map((item, i) => {
      const name     = resolveLocalized ? (resolveLocalized(item.name ?? '') || escapeHtml(item.name ?? '')) : escapeHtml(item.name ?? '');
      const category = escapeHtml(item.category ?? '');

      let iconHtml = '';
      if (resolveIconUrl) {
        const url = resolveIconUrl(item.name ?? '');
        if (url) {
          this._iconUrls.push(url);
          iconHtml = `<img src="${url}" alt="" class="w-8 h-8 object-contain shrink-0" draggable="false" />`;
        }
      }

      const baselineBadge = (i === 0 && n > 1)
        ? `<span class="text-[9px] text-zinc-600 uppercase tracking-widest block">Baseline</span>`
        : '';

      const removeBtn = (onRemoveItem && n > 1)
        ? `<button data-compare-remove="${escapeHtml(item.name ?? '')}"
             class="shrink-0 text-zinc-700 hover:text-red-400 transition-colors w-6 h-6 flex items-center justify-center rounded hover:bg-red-950/30"
             title="Remove from comparison" aria-label="Remove ${escapeHtml(item.name ?? '')} from comparison">
             <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
           </button>`
        : '';

      const moveLeft = (onMoveItem && n > 1 && i > 0)
        ? `<button data-compare-move="-1" data-compare-name="${escapeHtml(item.name ?? '')}"
             class="shrink-0 text-zinc-700 hover:text-zinc-200 transition-colors w-6 h-6 flex items-center justify-center rounded hover:bg-zinc-800"
             title="Move left" aria-label="Move ${escapeHtml(item.name ?? '')} left">
             <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
           </button>`
        : (onMoveItem && n > 1 ? '<span class="w-6 h-6 shrink-0"></span>' : '');

      const moveRight = (onMoveItem && n > 1 && i < n - 1)
        ? `<button data-compare-move="1" data-compare-name="${escapeHtml(item.name ?? '')}"
             class="shrink-0 text-zinc-700 hover:text-zinc-200 transition-colors w-6 h-6 flex items-center justify-center rounded hover:bg-zinc-800"
             title="Move right" aria-label="Move ${escapeHtml(item.name ?? '')} right">
             <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
           </button>`
        : (onMoveItem && n > 1 ? '<span class="w-6 h-6 shrink-0"></span>' : '');

      return `<div class="flex items-start gap-1 px-3 py-3 min-w-0 border-r border-zinc-800/60 last:border-r-0">
        ${moveLeft}
        ${iconHtml}
        <div class="flex-1 min-w-0">
          ${baselineBadge}
          <p class="text-sm font-bold text-white truncate leading-snug">${name}</p>
          <p class="text-xs text-zinc-500 truncate">${category}</p>
        </div>
        ${moveRight}
        ${removeBtn}
      </div>`;
    });

    return `<div class="sticky top-0 z-10 border-b border-zinc-800 bg-[#0a0c10]">
  <div style="max-width:${maxWidth};margin:0 auto">
    <div style="display:grid;grid-template-columns:${gridColsFull}">${cells.join('')}</div>
  </div>
</div>`;
  }

  _mobileColumnHeaders(items, n, resolveLocalized, resolveIconUrl, onRemoveItem, onMoveItem) {
    const pills = items.map((item, i) => {
      const name = resolveLocalized
        ? (resolveLocalized(item.name ?? '') || escapeHtml(item.name ?? ''))
        : escapeHtml(item.name ?? '');

      let iconHtml = '';
      if (resolveIconUrl) {
        const url = resolveIconUrl(item.name ?? '');
        if (url) {
          this._iconUrls.push(url);
          iconHtml = `<img src="${url}" alt="" class="w-5 h-5 object-contain shrink-0" draggable="false" />`;
        }
      }

      const baselineDot = (i === 0 && n > 1)
        ? `<span class="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" title="Baseline"></span>`
        : '';

      const removeBtn = (onRemoveItem && n > 1)
        ? `<button data-compare-remove="${escapeHtml(item.name ?? '')}"
             class="shrink-0 text-zinc-600 hover:text-red-400 transition-colors w-5 h-5 flex items-center justify-center rounded"
             title="Remove" aria-label="Remove ${escapeHtml(item.name ?? '')} from comparison">
             <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
           </button>`
        : '';

      const moveLeft = (onMoveItem && n > 1 && i > 0)
        ? `<button data-compare-move="-1" data-compare-name="${escapeHtml(item.name ?? '')}"
             class="shrink-0 text-zinc-600 hover:text-zinc-200 transition-colors w-5 h-5 flex items-center justify-center rounded"
             title="Move left" aria-label="Move left">
             <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
           </button>`
        : '';

      const moveRight = (onMoveItem && n > 1 && i < n - 1)
        ? `<button data-compare-move="1" data-compare-name="${escapeHtml(item.name ?? '')}"
             class="shrink-0 text-zinc-600 hover:text-zinc-200 transition-colors w-5 h-5 flex items-center justify-center rounded"
             title="Move right" aria-label="Move right">
             <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
           </button>`
        : '';

      return `<div class="flex items-center gap-1 px-2 py-1.5 rounded-md bg-zinc-900 border border-zinc-700/60 min-w-0 shrink-0">
        ${moveLeft}${baselineDot}${iconHtml}
        <span class="text-xs font-semibold text-white truncate max-w-[120px]">${name}</span>
        ${moveRight}${removeBtn}
      </div>`;
    }).join('');

    return `<div class="sticky top-0 z-10 border-b border-zinc-800 bg-[#0a0c10] px-3 py-2">
  <div class="flex items-center gap-2 overflow-x-auto">${pills}</div>
</div>`;
  }

  // ── Mobile stacked block (replaces aligned grid on small screens) ──────────

  /**
   * On mobile, instead of a side-by-side grid, renders each row as a compact
   * card: label header, then one sub-row per item with name + value.
   * Rows where all values are identical collapse to a single shared value.
   */
  _stackedBlock(rows, items, n, resolveLocalized, resolveIconUrl) {
    if (!rows.length) return '';

    // Each property group is its own card — clear gap between them.
    const HEADER_BG = 'rgba(255,255,255,0.04)';

    const cardsHtml = rows.map((row) => {
      const allSame = row.rawValues.every((v, i, a) => String(v ?? '') === String(a[0] ?? ''));

      let iconHtml = '';
      if (resolveIconUrl) {
        const url = resolveIconUrl(row.key);
        if (url) {
          this._iconUrls.push(url);
          iconHtml = `<img src="${url}" alt="" class="w-4 h-4 object-contain shrink-0 mr-1.5" draggable="false" />`;
        }
      }

      if (allSame && n > 1) {
        const dispVal = row.displayValues[0] ?? String(row.rawValues[0] ?? '');
        const valHtml = row.rawValues[0] == null
          ? `<span class="text-zinc-700">—</span>`
          : `<span class="text-sm text-zinc-300">${escapeHtml(dispVal)}</span>`;
        return `<div class="rounded-lg border border-zinc-800/60 overflow-hidden">
  <div class="px-3 py-2.5 flex items-center justify-between gap-3" style="background:${HEADER_BG}">
    <div class="flex items-center text-[10px] text-zinc-400 uppercase tracking-wide shrink-0">${iconHtml}${escapeHtml(row.label)}</div>
    <div class="flex items-center gap-2">${valHtml}<span class="text-[10px] text-zinc-400 bg-zinc-800/80 rounded px-1.5 py-0.5 shrink-0 font-mono leading-none">=</span></div>
  </div>
</div>`;
      }

      // Values differ — label header + sub-rows
      const subRows = Array.from({ length: n }, (_, i) => {
        const rawVal  = row.rawValues[i];
        const dispVal = row.displayValues[i];
        const delta   = row.deltas?.[i];
        const itemName = resolveLocalized
          ? (resolveLocalized(items[i]?.name ?? '') || escapeHtml(items[i]?.name ?? ''))
          : escapeHtml(items[i]?.name ?? '');

        const diffFromBase = row.isDiff && i > 0 && String(rawVal ?? '') !== String(row.rawValues[0] ?? '');
        const subBg = diffFromBase ? 'background-color:rgba(120,53,15,0.18)' : '';

        let valueHtml;
        if (rawVal == null) {
          valueHtml = `<span class="text-zinc-700">—</span>`;
        } else {
          const partialMark = row.partialValues?.[i] ? '<span class="text-zinc-600">~\u2009</span>' : '';
          valueHtml = `<span class="text-sm text-zinc-100">${partialMark}${escapeHtml(dispVal ?? String(rawVal))}</span>`;
        }

        let deltaHtml = '';
        if (delta != null && delta !== 0) {
          const sign     = delta > 0 ? '+' : '';
          const deltaCls = delta > 0 ? 'text-emerald-500' : 'text-red-500';
          deltaHtml = `<span class="text-[10px] ${deltaCls}">${escapeHtml(sign + formatNumber(delta))}</span>`;
        }

        const baselinePip = (i === 0 && n > 1)
          ? `<span class="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" title="Baseline"></span>`
          : `<span class="w-1.5 h-1.5 shrink-0"></span>`;

        return `<div class="flex items-center justify-between gap-2 px-4 py-2.5 border-t border-zinc-800/60" style="${subBg}">
  <div class="flex items-center gap-2 min-w-0">${baselinePip}<span class="text-[11px] text-zinc-400 truncate">${itemName}</span></div>
  <div class="flex items-center gap-1.5 shrink-0">${valueHtml}${deltaHtml}</div>
</div>`;
      }).join('');

      return `<div class="rounded-lg border border-zinc-800/60 overflow-hidden">
  <div class="px-3 py-2.5 flex items-center text-[10px] text-zinc-400 uppercase tracking-wide" style="background:${HEADER_BG}">${iconHtml}${escapeHtml(row.label)}</div>${subRows}
</div>`;
    }).join('');

    return `<div class="flex flex-col gap-2 mb-2">${cardsHtml}</div>`;
  }

  // ── Mobile diff-only toggle (injected above Stats on small screens) ────────

  /**
   * Renders a tappable "Differences only" toggle for mobile.
   * Clicking it acts as a label for #compare-diff-only (the real hidden checkbox
   * in the toolbar), so the existing change listener in app.js fires normally.
   * Visual state is baked in based on the current showDiffsOnly value since
   * the content is fully re-rendered whenever the checkbox changes.
   *
   * @param {boolean} checked
   */
  _mobileDiffToggle(checked) {
    const trackBg   = checked ? '#2563eb' : '#52525b';
    const knobLeft  = checked ? '16px' : '2px';
    const textColor = checked ? '#60a5fa' : '#a1a1aa';
    const knobStyle = `position:absolute;top:2px;left:${knobLeft};width:14px;height:14px;border-radius:9999px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.4)`;
    const trackStyle = `position:relative;display:inline-flex;width:32px;height:18px;border-radius:9999px;background:${trackBg};flex-shrink:0`;
    return `<label for="compare-diff-only" class="flex items-center gap-3 cursor-pointer select-none mt-3 mb-1 px-3 py-2.5 rounded-xl border border-zinc-800/60 hover:border-zinc-700/60 transition-colors" style="background:rgba(24,24,27,0.6)" title="Show only rows where values differ">
  <span style="${trackStyle}"><span style="${knobStyle}"></span></span>
  <span class="text-xs font-semibold" style="color:${textColor}">Differences only</span>
  <span class="ml-auto text-[10px] text-zinc-600 leading-snug">Show rows<br>where values differ</span>
</label>`;
  }

  // ── Section heading ────────────────────────────────────────────────────────

  _sectionHeading(title, accent = 'zinc') {
    const { text, border, bg } = SECTION_ACCENTS[accent] ?? SECTION_ACCENTS.zinc;
    return `<div class="mt-6 mb-2 px-3 py-1.5 rounded-md ${bg} border-l-2 ${border}">
      <span class="text-xs font-bold tracking-widest uppercase ${text}">${escapeHtml(title)}</span>
    </div>`;
  }

  // ── Aligned rows block ─────────────────────────────────────────────────────

  _alignedBlock(rows, n, gridCols, getLabelIconUrl = null) {
    if (!rows.length) return '';
    const rowsHtml = rows.map((row, idx) => this._alignedRow(row, n, gridCols, idx, getLabelIconUrl)).join('');
    return `<div class="rounded-lg overflow-hidden border border-zinc-800/60 mb-2 divide-y divide-zinc-800/60">${rowsHtml}</div>`;
  }

  _alignedRow(row, n, gridCols, rowIdx = 0, getLabelIconUrl = null) {
    const zebraBg = rowIdx % 2 === 1 ? 'background-color:rgba(255,255,255,0.025)' : '';
    // Label cell — sticky left so it stays visible on horizontal scroll
    const labelBg = rowIdx % 2 === 1 ? '#101520' : '#0d1018';
    let iconHtml = '';
    if (getLabelIconUrl) {
      const url = getLabelIconUrl(row.key);
      if (url) {
        this._iconUrls.push(url);
        iconHtml = `<img src="${url}" alt="" class="w-4 h-4 object-contain shrink-0 mr-1.5" draggable="false" />`;
      }
    }
    const labelCell = `<div class="px-3 py-2.5 text-[10px] text-zinc-400 uppercase tracking-wide flex items-center"
       style="position:sticky;left:0;z-index:1;background-color:${labelBg}">${iconHtml}${escapeHtml(row.label)}</div>`;

    const valueCells = Array.from({ length: n }, (_, i) => {
      const rawVal  = row.rawValues[i];
      const dispVal = row.displayValues[i];
      const delta   = row.deltas?.[i];

      // Highlight cells in a differing row that are NOT equal to the baseline (items[0])
      const diffFromBase = row.isDiff && i > 0 && String(rawVal ?? '') !== String(row.rawValues[0] ?? '');
      const bgClass = diffFromBase ? 'bg-amber-950/20' : '';

      let valueHtml;
      if (rawVal == null) {
        valueHtml = `<span class="text-zinc-700">—</span>`;
      } else {
        const partialMark = row.partialValues?.[i] ? '<span class="text-zinc-600">~\u2009</span>' : '';
        valueHtml = `<span class="text-sm text-zinc-100">${partialMark}${escapeHtml(dispVal ?? String(rawVal))}</span>`;
      }

      let deltaHtml = '';
      if (delta != null && delta !== 0) {
        const sign    = delta > 0 ? '+' : '';
        const deltaCls = delta > 0 ? 'text-emerald-500' : 'text-red-500';
        deltaHtml = `<span class="text-[10px] ${deltaCls} leading-none">${escapeHtml(sign + formatNumber(delta))}</span>`;
      }

      return `<div class="px-3 py-2.5 ${bgClass} border-l border-zinc-800/40 first:border-l-0">
  <div class="flex flex-col gap-0.5">${valueHtml}${deltaHtml}</div>
</div>`;
    }).join('');

    return `<div style="display:grid;grid-template-columns:${gridCols};${zebraBg}">${labelCell}${valueCells}</div>`;
  }

  // ── Per-item recipe card ───────────────────────────────────────────────────

  _recipeCard(recipe, resolveLocalized, resolveIconUrl, itemLabel = null) {
    const { template, stationNames, materialsCost, partialCost } = recipe;

    const metaRows = [];
    if (template.craftTime != null) metaRows.push(['Craft Time',  formatDuration(template.craftTime)]);
    metaRows.push(['Output',    String(template.outputCount ?? 1)]);
    if (stationNames.length)    metaRows.push(['Stations',   stationNames.join(', ')]);
    if (materialsCost != null)  metaRows.push(['Mat. Cost',  (partialCost ? '~\u2009' : '') + formatNumber(materialsCost)]);

    const metaHtml = metaRows.map(([k, v]) =>
      `<div class="flex justify-between gap-2">
        <span class="text-[11px] text-zinc-600 shrink-0">${escapeHtml(k)}</span>
        <span class="text-[11px] text-zinc-300 text-right">${escapeHtml(v)}</span>
      </div>`,
    ).join('');

    const labelHeader = itemLabel
      ? `<p class="text-[11px] font-semibold text-white truncate mb-1.5">${escapeHtml(itemLabel)}</p>`
      : '';
    return `<div class="rounded-lg border border-emerald-900/40 p-3 bg-emerald-950/10">
  <p class="text-[10px] font-bold text-emerald-500 uppercase tracking-widest ${itemLabel ? 'mb-1' : 'mb-2'}">Crafting Recipe</p>
  ${labelHeader}<div class="flex flex-col gap-1">${metaHtml}</div>
</div>`;
  }

  // ── Per-item chip sections ─────────────────────────────────────────────────

  /**
   * Returns true if any chip data exists for any item index.
   */
  _hasAnyChips(chipData, n) {
    for (const perItem of Object.values(chipData)) {
      for (let i = 0; i < n; i++) {
        const v = perItem[i];
        if (Array.isArray(v) ? v.length > 0 : v != null) return true;
      }
    }
    return false;
  }

  /**
   * Renders all chip sections for a single item column.
   * Returns null if there are no chips for this item.
   */
  _chipsForItem(chipData, itemIdx, resolveLocalized, resolveIconUrl) {
    const parts = [];

    for (const [key, label] of Object.entries(CHIP_SECTION_LABELS)) {
      const val   = chipData[key]?.[itemIdx];
      const names = Array.isArray(val) ? val : (val ? [val] : []);
      if (!names.length) continue;

      const chips = names.map(name =>
        this._chip(name, null, resolveLocalized, resolveIconUrl),
      ).join('');

      parts.push(`<div>
  <p class="text-[10px] text-zinc-600 uppercase tracking-widest mb-1">${escapeHtml(label)}</p>
  <div class="flex flex-wrap gap-1">${chips}</div>
</div>`);
    }

    if (!parts.length) return null;
    return `<div class="rounded-lg border border-zinc-800/60 p-3 flex flex-col gap-2.5">${parts.join('')}</div>`;
  }

  // ── Per-item trading card ──────────────────────────────────────────────────

  _tradingCard(entries, resolveLocalized, itemLabel = null) {
    const rows = entries.map(({ trader, sell, buy }) => {
      const traderName = resolveLocalized
        ? (resolveLocalized(trader.name ?? '') || escapeHtml(trader.name ?? ''))
        : escapeHtml(trader.name ?? '');

      const renderSide = (side, isSell) => {
        if (!side) return `<span class="text-zinc-700 text-[11px]">—</span>`;
        const qty      = isSell ? side.sellQtyRange : side.buyQtyRange;
        const price    = isSell ? side.sellMfRange  : side.buyMfRange;
        const colorCls = isSell ? 'text-emerald-400' : 'text-amber-400';

        const qtyStr = (() => {
          if (!qty) return null;
          const p = String(qty).split('-');
          if (p.length === 2 && p[0].trim() === p[1].trim()) return p[0].trim();
          return String(qty).replace(/-/g, '\u2013');
        })();
        const priceStr = formatPrice(price);

        let out = qtyStr ? `<span class="${colorCls} text-[11px]">${escapeHtml(qtyStr)}</span>` : '';
        if (priceStr) out += `<span class="text-zinc-500 text-[11px] ml-1">${escapeHtml(priceStr)}</span>`;
        return out || `<span class="${colorCls} text-[11px]">\u2713</span>`;
      };

      return `<div class="py-1.5 border-b border-zinc-800/40 last:border-b-0">
  <p class="text-[11px] font-medium text-zinc-300 truncate mb-0.5">${traderName}</p>
  <div class="flex items-center gap-3 flex-wrap">
    <span class="flex items-center gap-1"><span class="text-[10px] text-zinc-600">Sells</span>${renderSide(sell, true)}</span>
    <span class="flex items-center gap-1"><span class="text-[10px] text-zinc-600">Buys</span>${renderSide(buy, false)}</span>
  </div>
</div>`;
    }).join('');

    const labelHeader = itemLabel
      ? `<p class="text-[11px] font-semibold text-white truncate mb-1.5">${escapeHtml(itemLabel)}</p>`
      : '';
    return `<div class="rounded-lg border border-sky-900/40 p-3 bg-sky-950/10">
  <p class="text-[10px] font-bold text-sky-500 uppercase tracking-widest ${itemLabel ? 'mb-1' : 'mb-2'}">Trading</p>
  ${labelHeader}${rows}
</div>`;
  }

  // ── Chip element ───────────────────────────────────────────────────────────

  _chip(devName, labelPrefix, resolveLocalized, resolveIconUrl) {
    const displayName = resolveLocalized
      ? (resolveLocalized(devName) || escapeHtml(devName))
      : escapeHtml(devName);
    const label = labelPrefix ? `${labelPrefix} ${displayName}` : displayName;

    let iconHtml = '';
    if (resolveIconUrl) {
      const url = resolveIconUrl(devName);
      if (url) {
        this._iconUrls.push(url);
        iconHtml = `<img src="${url}" alt="" class="w-4 h-4 object-contain shrink-0" draggable="false" />`;
      }
    }

    return `<button data-compare-chip="${escapeHtml(devName)}"
  class="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 hover:border-blue-500/50 hover:text-blue-300 transition-colors cursor-pointer"
  title="${escapeHtml(devName)}">${iconHtml}${label}</button>`;
  }
}

import { escapeHtml } from './renderUtils.js';

/**
 * Resolves the effective damage multiplier group for a weapon item.
 * Prefers the named DamageMultiplierGroup from DamageMultiplierConfig.ecf;
 * falls back to inline DamageMultiplier_x entries parsed directly from the
 * item's child blocks in ItemsConfig.ecf.
 *
 * @param {import('../parsers/models/Item.js').Item} item
 * @param {Map<string, import('../parsers/models/DamageMultiplier.js').DamageMultiplier>} dmgByName
 * @returns {import('../parsers/models/DamageMultiplier.js').DamageMultiplier | { directMultipliers: object[], blastMultipliers: object[] } | null}
 */
function resolveItemDmgGroup(item, dmgByName) {
  if (item.damageMultiplierGroup) {
    const group = dmgByName.get(item.damageMultiplierGroup);
    if (group) return group;
  }
  return item.inlineDamageMultipliers ?? null;
}

/**
 * Linear-interpolation percentile over a sorted numeric array.
 * @param {number[]} sorted  Pre-sorted ascending array
 * @param {number}   p       Percentile in [0, 100]
 * @returns {number}
 */
function percentile(sorted, p) {
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Compute tier thresholds for one matrix column from the empirical distribution
 * of multiplier values across ALL weapon rows for that column.
 *
 * Only EXPLICIT non-zero values participate:
 *  - null  = no entry in the ECF file for this category; the game engine silently
 *            applies 1× but the weapon author never designed for this target type.
 *            Excluded so accidental "looks extreme vs Pl. Shield" can't occur.
 *  - 0     = explicit immunity; shown as 'none', not part of the damage scale.
 *
 * Returns null when no weapon has an explicit non-zero value for this column.
 * Percentile boundaries come from the active scenario's manifest.json entry (set via setConfig).
 *
 * @param {Array<number|null>} allMults      One value per weapon row (null, 0, or positive)
 * @param {{ ineffective: number, normal: number, effective: number }} tierPercentiles
 * @returns {{ ineffective: number, normal: number, effective: number } | null}
 */
function computeColumnThresholds(allMults, tierPercentiles) {
  const explicit = allMults.filter(v => v !== null && v > 0).sort((a, b) => a - b);
  if (explicit.length === 0) return null;
  return {
    ineffective: percentile(explicit, tierPercentiles.ineffective),
    normal:      percentile(explicit, tierPercentiles.normal),
    effective:   percentile(explicit, tierPercentiles.effective),
  };
}

/**
 * Returns the maximum explicit multiplier in a dmgGroup for the given column,
 * or null if no explicit entry covers any of the column's categories.
 *
 * @param {object} dmgGroup
 * @param {{ categories: string[] }} col
 * @returns {number|null}
 */
function getColMult(dmgGroup, col) {
  let maxMult = null;
  for (const entry of dmgGroup.directMultipliers) {
    for (const cat of entry.categories) {
      if (col.categories.includes(cat)) {
        if (maxMult === null || entry.multiplier > maxMult) maxMult = entry.multiplier;
      }
    }
  }
  return maxMult;
}

/**
 * Returns the highest explicit direct multiplier for a specific damage category string,
 * or null if the weapon has no explicit entry for that category.
 *
 * @param {object} dmgGroup
 * @param {string} cat  Lowercase damage category key (e.g. "combatlarge")
 * @returns {number|null}
 */
function getCatMult(dmgGroup, cat) {
  let maxMult = null;
  for (const entry of dmgGroup.directMultipliers) {
    if (entry.categories.includes(cat)) {
      if (maxMult === null || entry.multiplier > maxMult) maxMult = entry.multiplier;
    }
  }
  return maxMult;
}

/**
 * Maps a damage multiplier to a display tier using per-column empirical thresholds.
 *
 * Tier bands (all relative to the distribution for THIS column only):
 *
 *   null                     → 'default'      no explicit ECF entry; game uses 1× baseline
 *   0                        → 'none'         explicit immunity
 *   < thresholds.ineffective → 'ineffective'  bottom of weapons that can deal damage here
 *   ≤ thresholds.normal      → 'normal'       middle band
 *   ≤ thresholds.effective   → 'effective'    upper-middle band
 *   > thresholds.effective   → 'very effective'      top band
 *
 * Percentile boundaries are configured via `weaponTiers` in parserConfig.json.
 *
 * @param {number|null} mult
 * @param {{ ineffective: number, normal: number, effective: number } | null} thresholds
 * @returns {'default'|'none'|'ineffective'|'normal'|'effective'|'very_effective'}
 */
function getTier(mult, thresholds) {
  if (mult === null) return 'default';
  if (mult === 0 || !thresholds) return 'none';
  if (mult <  thresholds.ineffective) return 'ineffective';
  if (mult <= thresholds.normal)      return 'normal';
  if (mult <= thresholds.effective)   return 'effective';
  return 'very_effective';
}

const TIER_HTML = {
  default:     `<span class="text-slate-600 leading-none select-none" title="No explicit entry (1× default)">·</span>`,
  none:        `<span class="text-slate-600 font-mono leading-none select-none" title="No damage">—</span>`,
  ineffective: `<span class="inline-flex items-center justify-center px-2.5 py-1 rounded bg-red-500/15 text-red-400 text-xs font-medium leading-none select-none" title="Ineffective">▼</span>`,
  normal:      `<span class="inline-flex items-center justify-center px-2.5 py-1 rounded bg-blue-500/15 text-blue-400 text-xs font-medium leading-none select-none" title="Normal">=</span>`,
  effective:   `<span class="inline-flex items-center justify-center px-2.5 py-1 rounded bg-emerald-500/15 text-emerald-400 text-xs font-medium leading-none select-none" title="Effective">▲</span>`,
  very_effective:     `<span class="inline-flex items-center justify-center px-2.5 py-1 rounded bg-emerald-500/25 text-emerald-300 text-xs font-semibold leading-none select-none" title="Very Effective">▲▲</span>`,
};

/**
 * Renders a sort-direction chevron for a column header button.
 * @param {boolean} active  Whether this column is currently sorted
 * @param {'asc'|'desc'} dir
 */
function sortArrow(active, dir) {
  if (!active) return `<span class="ml-1 opacity-20 text-[8px] leading-none">↕</span>`;
  return `<span class="ml-1 text-blue-400 text-[8px] leading-none">${dir === 'asc' ? '▲' : '▼'}</span>`;
}

export class WeaponsPageRenderer {
  constructor() {
    this._sortColIdx    = -1;   // -1 = alphabetical by display name
    this._sortDir       = 'asc';
    this._filterQuery   = '';
    // Stored for re-renders triggered by sort-column clicks
    this._data          = null;
    this._container     = null;
    this._resolveName   = null;
    this._onBlockClick  = null;
    this._resolveIconUrl = null;
    this._clickHandler  = null;
    // Lookup view state
    this._selectedLookupBlock  = null;
    this._lookupClickHandler   = null;
    this._lookupOrderedGroups  = null;
    this._lookupWeaponRows     = null;
    this._lookupCatThresholds  = null;
    // Per-scenario weapons config; always set via setConfig() from manifest.json before rendering
    this._columnGroups    = null;
    this._tierPercentiles = null;
  }

  /**
   * Sets the weapons configuration for the currently loaded scenario.
   * Always sourced from manifest.json; pass null to clear (no scenario active).
   * Also resets sort and lookup-selection state because column groups may have changed.
   *
   * @param {{ columnGroups: object[], tierPercentiles: object } | null} config
   */
  setConfig(config) {
    this._columnGroups    = config?.columnGroups    ?? DEFAULT_COLUMN_GROUPS;
    this._tierPercentiles = config?.tierPercentiles ?? DEFAULT_TIER_PERCENTILES;
    // Reset sort/selection — the old column index may not exist in the new column set
    this._sortColIdx          = -1;
    this._sortDir             = 'asc';
    this._selectedLookupBlock = null;
  }

  /**
   * Renders the damage-effectiveness matrix into `container`.
   * One row per weapon Block, sorted and filtered by current state.
   *
   * @param {object} data
   * @param {import('../parsers/models/Block.js').Block[]}                        data.blocks
   * @param {import('../parsers/models/Item.js').Item[]}                          data.items
   * @param {import('../parsers/models/DamageMultiplier.js').DamageMultiplier[]}  data.damageMultipliers
   * @param {HTMLElement} container
   * @param {(name: string) => string}        [resolveDisplayName]
   * @param {(name: string) => void}          [onBlockClick]
   * @param {(name: string) => string | null} [resolveIconUrl]
   */
  renderMatrix(data, container, resolveDisplayName, onBlockClick, resolveIconUrl) {
    this._data           = data;
    this._container      = container;
    this._resolveName    = resolveDisplayName;
    this._onBlockClick   = onBlockClick;
    this._resolveIconUrl = resolveIconUrl;
    this._render();
  }

  /**
   * Renders the block-lookup view into `container`.
   * Left panel: browse blocks grouped by damage category.
   * Right panel: weapons ranked by effectiveness against the selected block.
   *
   * @param {object} data
   * @param {import('../parsers/models/Block.js').Block[]}                        data.blocks
   * @param {import('../parsers/models/Item.js').Item[]}                          data.items
   * @param {import('../parsers/models/DamageMultiplier.js').DamageMultiplier[]}  data.damageMultipliers
   * @param {import('../parsers/models/Material.js').Material[]}                  data.materials
   * @param {HTMLElement} container
   * @param {(name: string) => string}        [resolveDisplayName]
   * @param {(name: string) => void}          [onBlockClick]
   * @param {(name: string) => string | null} [resolveIconUrl]
   */
  renderLookup(data, container, resolveDisplayName, onBlockClick, resolveIconUrl) {
    this._data           = data;
    this._container      = container;
    this._resolveName    = resolveDisplayName;
    this._onBlockClick   = onBlockClick;
    this._resolveIconUrl = resolveIconUrl;
    this._renderLookup();
  }

  /**
   * Filter visible rows by weapon display name (case-insensitive).
   * Operates directly on the DOM — no full re-render needed.
   * @param {string} query
   */
  applyFilter(query) {
    this._filterQuery = (query ?? '').trim().toLowerCase();
    this._applyFilterDOM();
  }

  /**
   * Filter the block list in the lookup left panel by display name.
   * Hides group sections with no matching entries.
   * @param {string} query
   */
  applyLookupFilter(query) {
    if (!this._container) return;
    const q = (query ?? '').trim().toLowerCase();
    const leftPanel = this._container.querySelector('#lookup-left');
    if (!leftPanel) return;
    for (const section of leftPanel.querySelectorAll('[data-group-section]')) {
      let anyVisible = false;
      for (const btn of section.querySelectorAll('[data-block-display]')) {
        const match = q.length === 0 || btn.dataset.blockDisplay.includes(q);
        btn.hidden = !match;
        if (match) anyVisible = true;
      }
      section.hidden = !anyVisible;
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _applyFilterDOM() {
    if (!this._container) return;
    const q = this._filterQuery;
    for (const el of this._container.querySelectorAll('[data-weapon-name]')) {
      el.hidden = q.length > 0 && !el.dataset.weaponName.includes(q);
    }
  }

  _render() {
    const { blocks, items, damageMultipliers } = this._data;
    const container      = this._container;
    const resolveName    = this._resolveName ?? (n => n);
    const onBlockClick   = this._onBlockClick;
    const resolveIconUrl = this._resolveIconUrl;
    const COLS           = this._columnGroups;

    // ── Build lookup maps ──────────────────────────────────────────────────
    const itemByName = new Map(items.map(i => [i.name, i]));
    const dmgByName  = new Map(damageMultipliers.map(d => [d.name, d]));

    // ── Collect one entry per unique weapon Block ──────────────────────────
    const seen = new Set();
    const weaponRows = [];
    for (const block of blocks) {
      if (!block.weaponItem || seen.has(block.name)) continue;
      const item = itemByName.get(block.weaponItem);
      if (!item) continue;
      const dmgGroup = resolveItemDmgGroup(item, dmgByName);
      if (!dmgGroup) continue;
      // Only include weapons that deal positive damage to at least one active column.
      // Weapons where every column is either null (default 1×, no explicit entry) or 0
      // (explicit immunity) are excluded — they would render as all-dots or all-dashes.
      const hasPositiveDamage = COLS.some(col => {
        const m = getColMult(dmgGroup, col);
        return m !== null && m > 0;
      });
      if (!hasPositiveDamage) continue;
      seen.add(block.name);
      weaponRows.push({ block, dmgGroup });
    }

    if (weaponRows.length === 0) {
      container.innerHTML = `
        <div class="flex flex-col items-center justify-center py-24 gap-3 select-none">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-8 h-8 text-slate-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
          <p class="text-xs text-slate-600 italic text-center max-w-xs">
            No weapon data found.<br>
            Load <span class="text-slate-500 font-mono">BlocksConfig.ecf</span>,
            <span class="text-slate-500 font-mono">ItemsConfig.ecf</span>, and
            <span class="text-slate-500 font-mono">DamageMultiplierConfig.ecf</span>.
          </p>
        </div>`;
      return;
    }

    // ── Sort ───────────────────────────────────────────────────────────────
    const sortColIdx = this._sortColIdx;
    const sortDir    = this._sortDir;
    if (sortColIdx === -1) {
      weaponRows.sort((a, b) =>
        resolveName(a.block.name ?? '').localeCompare(resolveName(b.block.name ?? ''))
      );
    } else {
      const col = COLS[sortColIdx];
      weaponRows.sort((a, b) => {
        // Treat null (no explicit entry) as 1.0 for sort purposes
        const ma = getColMult(a.dmgGroup, col) ?? 1;
        const mb = getColMult(b.dmgGroup, col) ?? 1;
        return ma - mb;
      });
    }
    if (sortDir === 'desc') weaponRows.reverse();

    // ── Per-column empirical thresholds ────────────────────────────────────
    // Computed from full dataset (not filtered) so thresholds stay stable
    // regardless of what the user has typed in the search box.
    const colThresholds = COLS.map(col => {
      const allMults = weaponRows.map(({ dmgGroup }) => getColMult(dmgGroup, col));
      return computeColumnThresholds(allMults, this._tierPercentiles);
    });

    // ── Column headers ─────────────────────────────────────────────────────
    const nameActive  = sortColIdx === -1;
    const headerCells = COLS.map((col, colIdx) => {
      const active = sortColIdx === colIdx;
      return `<th class="w-24 min-w-[88px] px-1 py-0 text-center select-none whitespace-nowrap">
        <button data-sort-col="${colIdx}" class="inline-flex items-center justify-center w-full px-2 py-3 text-[10px] font-bold uppercase tracking-widest transition-colors cursor-pointer ${active ? 'text-blue-400' : 'text-slate-500 hover:text-slate-300'}">
          ${escapeHtml(col.label)}${sortArrow(active, sortDir)}
        </button>
      </th>`;
    }).join('');

    // ── Rows – one per weapon block ────────────────────────────────────────
    const rows = weaponRows.map(({ block, dmgGroup }) => {
      const cells = COLS.map((col, colIdx) => {
        const mult     = getColMult(dmgGroup, col);
        const tier     = getTier(mult, colThresholds[colIdx]);
        const titleVal = mult === null ? '1.00× (default)' : `${mult.toFixed(2)}×`;
        return `<td class="w-24 min-w-[88px] px-2 py-3.5 text-center text-sm" title="${escapeHtml(titleVal)}">${TIER_HTML[tier]}</td>`;
      }).join('');

      const displayName = escapeHtml(resolveName(block.name ?? ''));
      const lowerName   = resolveName(block.name ?? '').toLowerCase();
      const iconUrl     = resolveIconUrl ? resolveIconUrl(block.name ?? '') : null;
      const iconHtml    = iconUrl
        ? `<img src="${escapeHtml(iconUrl)}" alt="" class="w-6 h-6 object-contain shrink-0" draggable="false" />`
        : `<svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 shrink-0 text-slate-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;

      const nameCell = onBlockClick
        ? `<button data-weapon-block="${escapeHtml(block.name ?? '')}" class="group/btn flex items-center gap-2.5 text-left w-full rounded-md px-2 py-1 -mx-2 hover:bg-blue-500/10 transition-colors">
            ${iconHtml}
            <span class="text-sm font-medium text-slate-200 group-hover/btn:text-blue-300 transition-colors leading-snug">${displayName}</span>
           </button>`
        : `<div class="flex items-center gap-2.5">${iconHtml}<span class="text-sm font-medium text-slate-300 leading-snug">${displayName}</span></div>`;

      return `<tr data-weapon-name="${escapeHtml(lowerName)}" class="border-b border-slate-800/40 hover:bg-slate-800/20 transition-colors">
        <td class="px-4 md:px-6 py-2.5 align-middle min-w-[220px] max-w-xs">${nameCell}</td>
        ${cells}
      </tr>`;
    });

    // ── Card stack (narrow: one card per weapon, stacked vertically) ──────────
    const sortChips = [
      { label: 'Name', colIdx: -1 },
      ...COLS.map((col, idx) => ({ label: col.label, colIdx: idx })),
    ].map(({ label, colIdx }) => {
      const active = sortColIdx === colIdx;
      const dirIcon = active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
      return `<button data-sort-col="${colIdx}" class="px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border transition-colors cursor-pointer select-none whitespace-nowrap ${active ? 'border-blue-500/50 text-blue-400 bg-blue-500/10' : 'border-slate-800 text-slate-500 hover:text-slate-300 hover:border-slate-600'}">\n        ${escapeHtml(label)}${dirIcon}\n      </button>`;
    }).join('');

    const cards = weaponRows.map(({ block, dmgGroup }) => {
      const displayName = escapeHtml(resolveName(block.name ?? ''));
      const lowerName   = resolveName(block.name ?? '').toLowerCase();
      const iconUrl     = resolveIconUrl ? resolveIconUrl(block.name ?? '') : null;
      const iconHtml    = iconUrl
        ? `<img src="${escapeHtml(iconUrl)}" alt="" class="w-7 h-7 object-contain shrink-0" draggable="false" />`
        : `<svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 shrink-0 text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;

      const header = onBlockClick
        ? `<button data-weapon-block="${escapeHtml(block.name ?? '')}" class="group/btn flex items-center gap-2.5 w-full px-4 py-3 border-b border-slate-800/40 hover:bg-blue-500/5 transition-colors">
            ${iconHtml}
            <span class="text-sm font-semibold text-slate-200 group-hover/btn:text-blue-300 transition-colors leading-snug text-left">${displayName}</span>
          </button>`
        : `<div class="flex items-center gap-2.5 px-4 py-3 border-b border-slate-800/40">${iconHtml}<span class="text-sm font-semibold text-slate-200 leading-snug">${displayName}</span></div>`;

      const categoryCells = COLS.map((col, colIdx) => {
        const mult = getColMult(dmgGroup, col);
        if (mult === null) return ''; // omit default entries from cards to keep them compact
        const tier     = getTier(mult, colThresholds[colIdx]);
        const titleVal = `${mult.toFixed(2)}\u00d7`;
        return `<div class="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-slate-900/40">
          <span class="text-[11px] font-medium text-slate-400 leading-none">${escapeHtml(col.label)}</span>
          <span title="${escapeHtml(titleVal)}">${TIER_HTML[tier]}</span>
        </div>`;
      }).filter(Boolean).join('');

      const grid = categoryCells
        ? `<div class="grid grid-cols-2 gap-1.5 p-3">${categoryCells}</div>`
        : `<p class="px-4 py-3 text-xs text-slate-600 italic">No explicit damage data.</p>`;

      return `<div data-weapon-name="${escapeHtml(lowerName)}" class="border-b border-slate-800/40 last:border-0">
        ${header}
        ${grid}
      </div>`;
    }).join('');

    // NOTE: No overflow-x-auto wrapper here – #weapons-content is overflow-auto
    // and serves as the single scroll container for both axes.
    container.innerHTML = `
      <div class="hidden min-[1300px]:block">
        <table class="w-full border-collapse">
          <thead class="sticky top-0 z-10 bg-[#0f1115] border-b border-slate-800/60">
            <tr>
              <th class="px-4 md:px-6 py-0 text-left min-w-[220px] select-none">
                <button data-sort-col="-1" class="inline-flex items-center py-3 text-[10px] font-bold uppercase tracking-widest transition-colors cursor-pointer ${nameActive ? 'text-blue-400' : 'text-slate-500 hover:text-slate-300'}">
                  Weapon${sortArrow(nameActive, nameActive ? sortDir : 'asc')}
                </button>
              </th>
              ${headerCells}
            </tr>
          </thead>
          <tbody>
            ${rows.join('')}
          </tbody>
        </table>
      </div>
      <div class="min-[1300px]:hidden flex flex-col">
        <div class="flex flex-wrap gap-1.5 px-4 py-3 border-b border-slate-800/50">
          ${sortChips}
        </div>
        ${cards}
      </div>`;
    // Re-apply current search filter after DOM rebuild
    this._applyFilterDOM();

    // Delegated click handler – handles both sort-column clicks and weapon-block clicks
    if (this._clickHandler) container.removeEventListener('click', this._clickHandler);
    this._clickHandler = (e) => {
      const sortBtn = e.target.closest('[data-sort-col]');
      if (sortBtn) {
        const idx = parseInt(sortBtn.dataset.sortCol, 10);
        if (this._sortColIdx === idx) {
          this._sortDir = this._sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          this._sortColIdx = idx;
          // Category sort defaults desc (most effective first); name sort defaults asc (A→Z)
          this._sortDir = idx === -1 ? 'asc' : 'desc';
        }
        this._render();
        return;
      }
      const weaponBtn = e.target.closest('[data-weapon-block]');
      if (weaponBtn && onBlockClick) onBlockClick(weaponBtn.dataset.weaponBlock);
    };
    container.addEventListener('click', this._clickHandler);
  }

  // ── Lookup view ────────────────────────────────────────────────────────────

  /** Toggles panel visibility for mobile (< 640 px) vs. desktop (side-by-side). */
  _syncLookupPanels() {
    const container = this._container;
    if (!container) return;
    const left  = container.querySelector('#lookup-left');
    const right = container.querySelector('#lookup-right');
    if (!left || !right) return;
    const narrow = window.innerWidth < 640;
    if (!narrow) {
      left.classList.remove('hidden');
      right.classList.remove('hidden');
    } else if (this._selectedLookupBlock) {
      left.classList.add('hidden');
      right.classList.remove('hidden');
    } else {
      left.classList.remove('hidden');
      right.classList.add('hidden');
    }
  }

  _renderLookup() {
    const { blocks, items, damageMultipliers, materials } = this._data;
    const container      = this._container;
    const resolveName    = this._resolveName ?? (n => n);
    const onBlockClick   = this._onBlockClick;
    const resolveIconUrl = this._resolveIconUrl;

    // ── Build weapon rows ──────────────────────────────────────────────────
    const itemByName = new Map(items.map(i => [i.name, i]));
    const dmgByName  = new Map(damageMultipliers.map(d => [d.name, d]));
    const COLS = this._columnGroups;
    const weaponRows = [];
    const seenWeapons = new Set();
    for (const block of blocks) {
      if (!block.weaponItem || seenWeapons.has(block.name)) continue;
      const item = itemByName.get(block.weaponItem);
      if (!item) continue;
      const dmgGroup = resolveItemDmgGroup(item, dmgByName);
      if (!dmgGroup) continue;
      // Only include weapons that deal positive damage to at least one active column.
      const hasPositiveDamage = COLS.some(col => {
        const m = getColMult(dmgGroup, col);
        return m !== null && m > 0;
      });
      if (!hasPositiveDamage) continue;
      seenWeapons.add(block.name);
      weaponRows.push({ block, dmgGroup });
    }
    weaponRows.sort((a, b) => resolveName(a.block.name ?? '').localeCompare(resolveName(b.block.name ?? '')));

    // ── Map material name → damageCategory ────────────────────────────────
    // MaterialConfig.ecf may use mixed-case values; always normalise to lowercase
    // so they match what DamageMultiplierConfig (which lowercases param1) uses.
    const materialCatMap = new Map(
      materials.map(m => [m.name, m.damageCategory?.toLowerCase() ?? null])
    );

    // ── Build a (lowercase) category → column-group label/index map ────────
    // Used to assign column-group labels to block categories where possible,
    // and to determine the ordering of those groups in the left panel.
    // Keys are lowercased so case differences between config and ECF data can't
    // cause misses (MaterialConfig values are now normalised above; column-group
    // categories in manifest.json are already lowercase by convention).
    const catToColGroup = new Map(); // lowercased cat → { label, order }
    COLS.forEach((col, idx) => {
      col.categories.forEach(cat => {
        catToColGroup.set(cat.toLowerCase(), { label: col.label, order: idx });
      });
    });

    // ── Collect non-weapon blocks, keyed by resolved damage category ───────
    // Primary resolution: Material.damageCategory from MaterialConfig.ecf.
    // Fallback: treat block.material itself (lowercased) as the damage category —
    // this works because DamageMultiplierConfig stores param1 values as the
    // lowercased material name, which equals the damage category for vanilla and
    // for scenarios where MaterialConfig.ecf may be absent or partial.
    const entriesByCat = new Map(); // lowercase cat → entry[]
    for (const block of blocks) {
      if (block.weaponItem || !block.showUser || !block.material) continue;
      const cat = materialCatMap.get(block.material) ?? block.material.toLowerCase();
      if (!cat) continue;
      if (!entriesByCat.has(cat)) entriesByCat.set(cat, []);
      entriesByCat.get(cat).push({
        blockName:   block.name,
        displayName: resolveName(block.name ?? ''),
        cat,
        iconUrl:     resolveIconUrl ? resolveIconUrl(block.name ?? '') : null,
      });
    }

    if (entriesByCat.size === 0 || weaponRows.length === 0) {
      container.innerHTML = `
        <div class="flex flex-col items-center justify-center py-24 gap-3 select-none">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-8 h-8 text-slate-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>
          </svg>
          <p class="text-xs text-slate-600 italic text-center max-w-xs">
            No block data found.<br>
            Load <span class="text-slate-500 font-mono">BlocksConfig.ecf</span>,
            <span class="text-slate-500 font-mono">ItemsConfig.ecf</span>,
            <span class="text-slate-500 font-mono">MaterialConfig.ecf</span>, and
            <span class="text-slate-500 font-mono">DamageMultiplierConfig.ecf</span>.
          </p>
        </div>`;
      return;
    }

    // ── Build ordered groups for the left panel ────────────────────────────
    // Pass 1 — column-group buckets (preserving COLS order):
    //   Each column group may cover multiple damage categories (e.g. "Lt. Armor"
    //   covers steelsmall, steellarge, …). All entries for those categories are
    //   merged under one labelled group.
    // Pass 2 — leftover categories not covered by any column group:
    //   Grouped individually with an auto-generated label (capitalised cat name).
    //   Sorted alphabetically and appended after the column-group buckets.
    const orderedGroups = [];
    const usedCats = new Set();
    for (const col of COLS) {
      const merged = [];
      for (const cat of col.categories) {
        const lowCat = cat.toLowerCase();
        const entries = entriesByCat.get(lowCat);
        if (entries) { merged.push(...entries); usedCats.add(lowCat); }
      }
      if (merged.length > 0) {
        merged.sort((a, b) => a.displayName.localeCompare(b.displayName));
        orderedGroups.push({ label: col.label, entries: merged });
      }
    }
    const extraCats = [...entriesByCat.keys()].filter(c => !usedCats.has(c)).sort();
    for (const cat of extraCats) {
      const entries = [...entriesByCat.get(cat)];
      entries.sort((a, b) => a.displayName.localeCompare(b.displayName));
      const label = cat.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      orderedGroups.push({ label, entries });
    }

    // ── Per-category empirical thresholds (precise, not per-group) ────────
    const catThresholds = new Map();
    for (const cat of entriesByCat.keys()) {
      const allMults = weaponRows.map(({ dmgGroup }) => getCatMult(dmgGroup, cat));
      catThresholds.set(cat, computeColumnThresholds(allMults, this._tierPercentiles));
    }

    // ── Store for click handler ────────────────────────────────────────────
    this._lookupOrderedGroups = orderedGroups;
    this._lookupWeaponRows    = weaponRows;
    this._lookupCatThresholds = catThresholds;

    // ── Validate previously selected block still exists ───────────────────
    const knownBlocks = new Set(orderedGroups.flatMap(g => g.entries.map(e => e.blockName)));
    if (this._selectedLookupBlock && !knownBlocks.has(this._selectedLookupBlock)) {
      this._selectedLookupBlock = null;
    }

    // ── Left panel ─────────────────────────────────────────────────────────
    const leftHtml = orderedGroups.map(({ label, entries }) => {
      const rowsHtml = entries.map(entry => {
        const isSelected = entry.blockName === this._selectedLookupBlock;
        const iconHtml = entry.iconUrl
          ? `<img src="${escapeHtml(entry.iconUrl)}" alt="" class="w-5 h-5 object-contain shrink-0" draggable="false" />`
          : `<span class="w-5 h-5 shrink-0 flex items-center justify-center text-slate-700 text-[10px]">▪</span>`;
        return `<button data-lookup-select="${escapeHtml(entry.blockName)}" data-block-display="${escapeHtml(entry.displayName.toLowerCase())}"
          class="w-full flex items-center gap-2.5 px-4 py-2 text-left text-sm transition-colors ${isSelected ? 'bg-blue-500/15 text-blue-300' : 'text-slate-400 hover:bg-slate-800/40 hover:text-slate-200'}">
          ${iconHtml}
          <span class="truncate leading-snug">${escapeHtml(entry.displayName)}</span>
        </button>`;
      }).join('');
      return `<div data-group-section class="border-b border-slate-800/40 last:border-0">
        <div class="px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 bg-slate-900/30 sticky top-0">
          ${escapeHtml(label)}<span class="ml-1.5 font-normal normal-case tracking-normal text-slate-600">${entries.length}</span>
        </div>
        ${rowsHtml}
      </div>`;
    }).join('');

    // ── Render shell ───────────────────────────────────────────────────────
    container.innerHTML = `
      <div class="sm:flex sm:h-full sm:min-h-0 sm:overflow-hidden">
        <div id="lookup-left" class="sm:w-64 sm:shrink-0 sm:border-r border-slate-800/50 sm:overflow-y-auto sm:custom-scrollbar">
          ${leftHtml}
        </div>
        <div id="lookup-right" class="sm:flex-1 sm:min-w-0 sm:overflow-y-auto sm:custom-scrollbar">
          ${this._buildLookupRightHtml(resolveName, resolveIconUrl, onBlockClick)}
        </div>
      </div>`;
    this._syncLookupPanels();

    // ── Delegated click handler ────────────────────────────────────────────
    if (this._lookupClickHandler) container.removeEventListener('click', this._lookupClickHandler);
    this._lookupClickHandler = (e) => {
      // Back button (mobile only) — return to block list
      const backBtn = e.target.closest('[data-lookup-back]');
      if (backBtn) {
        this._selectedLookupBlock = null;
        const rightPanel = container.querySelector('#lookup-right');
        if (rightPanel) rightPanel.innerHTML = this._buildLookupRightHtml(resolveName, resolveIconUrl, onBlockClick);
        this._syncLookupPanels();
        return;
      }

      // Block selection (left panel)
      const selectBtn = e.target.closest('[data-lookup-select]');
      if (selectBtn) {
        const blockName = selectBtn.dataset.lookupSelect;
        if (this._selectedLookupBlock === blockName) return;
        this._selectedLookupBlock = blockName;

        // Update active class without rebuilding the whole left panel
        for (const b of container.querySelectorAll('[data-lookup-select]')) {
          const sel = b.dataset.lookupSelect === blockName;
          b.className = `w-full flex items-center gap-2.5 px-4 py-2 text-left text-sm transition-colors ${sel ? 'bg-blue-500/15 text-blue-300' : 'text-slate-400 hover:bg-slate-800/40 hover:text-slate-200'}`;
        }

        const rightPanel = container.querySelector('#lookup-right');
        if (rightPanel) rightPanel.innerHTML = this._buildLookupRightHtml(resolveName, resolveIconUrl, onBlockClick);
        this._syncLookupPanels();
        return;
      }

      // Weapon row click (right panel) — open weapon detail drawer
      const weaponBtn = e.target.closest('[data-weapon-block]');
      if (weaponBtn && onBlockClick) onBlockClick(weaponBtn.dataset.weaponBlock);
    };
    container.addEventListener('click', this._lookupClickHandler);
  }

  _buildLookupRightHtml(resolveName, resolveIconUrl, onBlockClick) {
    const selectedName = this._selectedLookupBlock;

    if (!selectedName) {
      return `<div class="flex flex-col items-center justify-center h-full gap-3 text-center select-none px-8">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-8 h-8 text-slate-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <p class="text-sm text-slate-600">Select a block on the left to see which weapons are effective against it.</p>
      </div>`;
    }

    // Find the entry for the selected block
    let selectedEntry = null;
    for (const group of this._lookupOrderedGroups) {
      selectedEntry = group.entries.find(e => e.blockName === selectedName);
      if (selectedEntry) break;
    }
    if (!selectedEntry) return '';

    const { cat, displayName, iconUrl } = selectedEntry;
    const thresholds = this._lookupCatThresholds.get(cat) ?? null;

    // Only show weapons with an explicit non-zero multiplier, sorted most effective first
    const explicit = this._lookupWeaponRows
      .map(({ block, dmgGroup }) => ({ block, mult: getCatMult(dmgGroup, cat) }))
      .filter(r => r.mult !== null && r.mult !== 0)
      .sort((a, b) => b.mult - a.mult);

    const weaponRowHtml = ({ block, mult }) => {
      const tier = getTier(mult, thresholds);
      const wName = escapeHtml(resolveName(block.name ?? ''));
      const wIcon = resolveIconUrl ? resolveIconUrl(block.name ?? '') : null;
      const iconHtml = wIcon
        ? `<img src="${escapeHtml(wIcon)}" alt="" class="w-6 h-6 object-contain shrink-0" draggable="false" />`
        : `<svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 shrink-0 text-slate-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
      const inner = `${iconHtml}<span class="flex-1 text-sm text-slate-200 leading-snug">${wName}</span>${TIER_HTML[tier]}`;
      return onBlockClick
        ? `<button data-weapon-block="${escapeHtml(block.name ?? '')}" class="w-full flex items-center gap-3 px-6 py-3 border-b border-slate-800/30 hover:bg-slate-800/20 transition-colors text-left">${inner}</button>`
        : `<div class="flex items-center gap-3 px-6 py-3 border-b border-slate-800/30">${inner}</div>`;
    };

    const blockIconHtml = iconUrl
      ? `<img src="${escapeHtml(iconUrl)}" alt="" class="w-8 h-8 object-contain shrink-0" draggable="false" />`
      : `<svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>`;

    return `
      <div class="px-4 sm:px-6 py-4 sm:py-5 border-b border-slate-800/50 flex items-center gap-3">
        <button data-lookup-back class="sm:hidden -ml-1 mr-0.5 p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800/50 transition-colors shrink-0" aria-label="Back to block list">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        ${blockIconHtml}
        <h3 class="text-base font-semibold text-slate-100">${escapeHtml(displayName)}</h3>
      </div>
      ${explicit.length > 0 ? explicit.map(weaponRowHtml).join('') : '<p class="px-4 sm:px-6 py-8 text-xs text-slate-600 italic text-center">No weapon has an explicit multiplier for this block type.</p>'}`;
  }
}

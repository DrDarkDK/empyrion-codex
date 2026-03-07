import { escapeHtml, formatNumber, formatPrice, setContainerClickHandler } from './renderUtils.js';

// Properties to surface in the quick-stats row (order matters)
const STAT_KEYS = [
  { key: 'Mass',       label: 'Mass',        unit: 'kg' },
  { key: 'Volume',     label: 'Volume',      unit: 'L'  },
  { key: 'StackSize',  label: 'Stack Size',       unit: ''   },
  { key: 'Durability', label: 'Durability',  unit: ''   },
  { key: 'MarketPrice',label: 'Market Price',unit: ''   },
];

// Properties assigned to dedicated sections (excluded from the catch-all "Properties" section)
const SECTION_KEYS = new Set([
  'Mass', 'Volume', 'StackSize', 'Durability', 'MarketPrice',
  'UnlockCost', 'UnlockLevel', 'TechTreeNames', 'TechTreeParent',
  'Category', 'Material', 'HoldType', 'SlotItems', 'ChildBlocks', 'UpgradeTo', 'DowngradeTo',
  'AmmoType', 'Accept',
]);


/** Display label overrides for ECF property keys. */
const PROP_LABELS = {
  FallDamageFac:    'Fall Damage Modifier',
  PowerFac:         'Power Modifier',
  SpeedFac:         'Speed Modifier',
  JumpFac:          'Jump Modifier',
  Jetpack:          'Jetpack Modifier',
  FoodFac:          'Food Modifier',
  StaminaFac:       'Stamina Modifier',
  DegradationFac:   'Degradation Modifier',
  JetpackFac:       'Jetpack Modifier',
  IsOxygenTight:    'Airtight',
  AllowPlacingAt:   'Placable On',
  HitPoints:        'Hit Points',
  Info:             'Description',
  ShieldCapacityBonus: 'Shield Capacity Bonus',
  CPUIn:            'CPU Usage',
  VolumeCapacity:   'Volume Capacity',
  SizeInBlocks:     'Size',
  EnergyIn:         'Energy Consumption',
  EnergyInIdle:     'Idle Energy Consumption',
  RepairToTemplate: 'Repair To Template',
  UpgradeTo:        'Upgrades To',
  DowngradeTo:      'Downgrades To',
  AllowedInBlueprint: 'Allowed In Blueprints',
  CPUOut:           'CPU Bonus',
  EnergyOut:        'Energy Bonus',
  ConsumeFuelO2:    'Fuel And O2 Consumption',
  MaxCount:         'Max Count',
  ThrusterForce:    'Thruster Force',
  RangeAU:          'Range (AU)',
  RangeLY:          'Range (LY)',
  ShieldRechargeBonus: 'Shield Recharge Bonus',
  ShieldCapacity:   'Shield Capacity',
  ShieldRecharge:   'Shield Charge',
  ShieldCooldown:   'Shield Cooldown',
  ShieldHitCooldown:  'Shield Hit Cooldown',
  IsRepairToBlueprint:  'Repair To Blueprint',
  ItemsPerHour:     'Items Per Hour',
  ShieldDamagePenFac: 'Shield Penetration Modifier',
  GrowthRate:       'Growth Rate',
  FertileLevel:     'Fertility Level',
  CropYield:        'Crop Yield',
  GrowthTimeInfo:   'Growth Time',
  RepairDisabled:   'Repair Disabled',
  RangeSpace:       'Range (Space)',
  FoodDecayTime:    'Decay Time',
  BlastRadius:      'Blast Radius',
  BlastDamage:      'Blast Damage',
  IsRetractable:    'Is Retractable',
  AmmoCapacity:     'Ammo Capacity',
  O2Value:          'O2 Value',
  FuelValue:        'Fuel Value',
  FuelCapacity:     'Fuel Capacity',
};

/** Per-key display value transforms applied in the properties table. */
const PROP_VALUE_TRANSFORMS = {
  AllowPlacingAt: v => {
    const MAP = { MS: 'Capital Vessel', SS: 'Small Vessel', GV: 'Hover Vessel' };
    return String(v).split(',').map(s => MAP[s.trim()] ?? s.trim()).join(', ');
  },
  SizeInBlocks: v => String(v).replace(/,\s*/g, 'x'),
};

/** Human-readable labels for crafting station codes. */
const STATION_NAMES = {
  BaseC: 'Base Constructor', LargeC: 'Large Constructor',
  SmallC: 'Small Constructor', HoverC: 'HV Constructor',
  AdvC: 'Advanced Constructor', SurvC: 'Survival Constructor',
  FoodP: 'Food Processor',
};

/**
 * Returns a Tailwind color class for a property value based on its type/content.
 * @param {string|number|boolean|null} value
 * @returns {string}
 */
function valueColorClass(value) {
  if (value === true  || value === 'true')  return 'text-emerald-400';
  if (value === false || value === 'false') return 'text-zinc-500';
  if (value != null && value !== '' && !isNaN(Number(value))) return 'text-amber-300';
  return 'text-zinc-200';
}

/**
 * Converts a duration in seconds to a compact human-readable string (e.g. "2h 30m").
 * @param {number} sec
 * @returns {string}
 */
function formatDuration(sec) {
  if (sec < 60)   return `${sec}s`;
  if (sec < 3600) { const m = Math.floor(sec / 60), s = sec % 60; return s ? `${m}m ${s}s` : `${m}m`; }
  if (sec < 86400){ const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60); return m ? `${h}h ${m}m` : `${h}h`; }
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600);
  return h ? `${d}d ${h}h` : `${d}d`;
}

/**
 * Renders structured item details into a container element.
 */
export class ItemDetailRenderer {
  constructor() {
    /** Blob URLs created for slot item chip icons — revoked on next render. */
    this._slotIconUrls = [];
  }

  /**
   * @param {import('../parsers/models/Item.js').Item} item
   * @param {HTMLElement} containerEl
   * @param {object}   [options]
   * @param {function(string): string}      [options.resolveLocalized]  - Localization resolver
   * @param {function(string): void}        [options.onSlotItemClick]   - Called with devName when an item chip is clicked
   * @param {function(string): string|null} [options.resolveIconUrl]    - Icon blob URL resolver
   * @param {import('../parsers/models/Template.js').Template}              [options.template]     - Crafting recipe template
   * @param {Map<string,import('../parsers/models/Template.js').Template>}  [options.templatesCfg] - All templates (for ingredient flattening)
   * @param {import('../parsers/models/TraderNPC.js').TraderNPC[]}          [options.tradersCfg]   - Trader data
   * @param {function(string): void}        [options.onTraderClick]     - Called with trader name on click
   * @param {function(string): number|null} [options.getMarketPrice]    - Market price resolver
   */
  render(item, containerEl, options = {}) {
    const {
      resolveLocalized = null,
      onSlotItemClick = null,
      resolveIconUrl = null,
      template = null,
      templatesCfg = null,
      tradersCfg = null,
      onTraderClick = null,
      getMarketPrice = null,
    } = options;
    // Revoke chip icon blob URLs from the previous render
    for (const url of this._slotIconUrls) URL.revokeObjectURL(url);
    this._slotIconUrls = [];

    const propMap = new Map(item.properties.map(p => [p.key, p]));
    const html = [
      this._statsRow(propMap, template, templatesCfg, getMarketPrice),
      this._identSection(item, propMap),
      this._economySection(propMap),
      this._recipeSection(template, resolveLocalized, onSlotItemClick, resolveIconUrl, templatesCfg, getMarketPrice),
      this._tradingSection(item, tradersCfg, resolveLocalized, onTraderClick),
      this._slotItemsSection(propMap, resolveLocalized, onSlotItemClick, resolveIconUrl),
      this._variantsSection(item, resolveLocalized, onSlotItemClick, resolveIconUrl),
      this._ammoTypeSection(propMap, resolveLocalized, onSlotItemClick, resolveIconUrl),
      this._upgradeToSection(propMap, resolveLocalized, onSlotItemClick, resolveIconUrl),
      this._upgradeToSection(propMap, resolveLocalized, onSlotItemClick, resolveIconUrl, 'DowngradeTo', 'Downgrades To'),
      this._acceptSection(propMap, resolveLocalized, onSlotItemClick, resolveIconUrl),
      this._propertiesSection(item.properties, resolveLocalized),
      ...item.children.map(c => this._childSection(c)),
    ].filter(Boolean).join('');

    containerEl.innerHTML = html || '<p class="text-xs text-zinc-600 italic">No details available.</p>';

    // Delegated click handler for interactive chips, trader links, and toggle buttons
    const handler = (e) => {
      const slotBtn = e.target.closest('[data-slot-item]');
      if (slotBtn && onSlotItemClick) { onSlotItemClick(slotBtn.dataset.slotItem); return; }
      const traderBtn = e.target.closest('[data-trader-ref]');
      if (traderBtn && onTraderClick) { onTraderClick(traderBtn.dataset.traderRef); return; }
      const simplifyBtn = e.target.closest('[data-simplify-toggle]');
      if (simplifyBtn) {
        const root = simplifyBtn.closest('.simplify-root');
        root.querySelector('.ingr-orig').classList.toggle('hidden');
        root.querySelector('.ingr-simp').classList.toggle('hidden');
        simplifyBtn.textContent = root.querySelector('.ingr-simp').classList.contains('hidden') ? 'Simplify' : 'Original';
      }
    };
    setContainerClickHandler(containerEl, handler);
  }

  /**
   * Renders a single interactive chip for an item/block reference.
   * Centralises icon resolution, escaping, and the button-vs-span decision.
   * @param {string}  devName     - Internal name (used as data attribute)
   * @param {object}  opts
   * @param {function(string): string|null} [opts.resolveLocalized]
   * @param {function(string): string|null} [opts.resolveIconUrl]
   * @param {boolean} [opts.interactive] - Render as a clickable button (default false)
   * @param {string}  [opts.labelPrefix] - Text prepended to the display name (e.g. "5×")
   * @returns {string} HTML string
   */
  _renderChip(devName, { resolveLocalized, resolveIconUrl, interactive = false, labelPrefix } = {}) {
    const display = resolveLocalized ? (resolveLocalized(devName) ?? escapeHtml(devName)) : escapeHtml(devName);
    const label   = labelPrefix ? `${labelPrefix} ${display}` : display;
    const attr    = escapeHtml(devName);

    let iconHtml = '';
    if (resolveIconUrl) {
      const url = resolveIconUrl(devName);
      if (url) {
        this._slotIconUrls.push(url);
        iconHtml = `<img src="${url}" alt="" class="w-5 h-5 object-contain shrink-0" draggable="false" />`;
      }
    }

    const inner = `${iconHtml}<span>${label}</span>`;
    return interactive
      ? `<button data-slot-item="${attr}" class="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-slate-800 border border-slate-700 text-slate-300 hover:border-blue-500/50 hover:text-blue-300 hover:bg-blue-500/10 transition-all cursor-pointer" title="${attr}">${inner}</button>`
      : `<span class="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-slate-800 border border-slate-700 text-slate-300">${inner}</span>`;
  }

  /** Highlight row of key numeric stats */
  _statsRow(propMap, template = null, templatesCfg = null, getMarketPrice = null) {
    const cells = STAT_KEYS
      .map(({ key, label, unit }) => {
        const prop = propMap.get(key);
        if (!prop || prop.value == null || prop.value === '') return null;
        const raw = prop.value;
        const formatted = formatNumber(raw);
        const val = unit ? `${formatted} ${unit}` : formatted;
        return `<div class="bg-zinc-800/60 rounded-lg p-3 text-center min-w-0">
  <p class="text-xs text-zinc-500 uppercase tracking-wide truncate">${label}</p>
  <p class="text-sm font-semibold text-amber-400 mt-1 truncate">${escapeHtml(val)}</p>
</div>`;
      })
      .filter(Boolean);

    // Materials Market Price: top-level ingredients only (not flattened)
    if (template && getMarketPrice) {
      const ingredients = (template.inputs ?? []).filter(({ qty }) => qty > 0);
      let total = 0;
      let partial = false;
      for (const { name, qty } of ingredients) {
        const mp = getMarketPrice(name);
        if (mp == null) { partial = true; }
        else total += mp * qty;
      }
      if (total > 0) {
        const prefix = partial ? '~\u2009' : '';
        const valStr = prefix + formatNumber(total);
        cells.push(`<div class="bg-zinc-800/60 rounded-lg p-3 text-center min-w-0">
  <p class="text-[10px] text-zinc-500 uppercase tracking-wide truncate">Materials Cost</p>
  <p class="text-sm font-semibold text-amber-400 mt-1 truncate">${escapeHtml(valStr)}</p>
</div>`);
      }
    }

    if (!cells.length) return '';
    return `<div class="grid grid-cols-3 gap-2 mb-5">${cells.join('')}</div>`;
  }

  /** Identity: material, hold type (category already shown in drawer header) */
  _identSection(item, propMap) {
    const rows = [
      ['Material', propMap.get('Material')?.value],
      ['Hold Type', propMap.get('HoldType')?.value],
    ].filter(([, v]) => v != null && v !== '');
    if (!rows.length) return '';
    return this._section('General', this._table(rows), 'sky');
  }

  /** Renders the SlotItems list as clickable localized chips. */
  _slotItemsSection(propMap, resolveLocalized, onSlotItemClick, resolveIconUrl) {
    const prop = propMap.get('SlotItems');
    if (!prop || !prop.value) return '';

    const raw = String(prop.value).replace(/^"|"$/g, '').trim();
    const devNames = raw.split(',').map(s => s.trim()).filter(Boolean);
    if (!devNames.length) return '';

    const chips = devNames.map(name =>
      this._renderChip(name, { resolveLocalized, resolveIconUrl, interactive: !!onSlotItemClick }),
    ).join('');

    return this._section('Equipable Boosters', `<div class="flex flex-wrap gap-1.5">${chips}</div>`, 'sky');
  }

  /** Renders block variants (ChildBlocks) as clickable chips. */
  _variantsSection(item, resolveLocalized, onSlotItemClick, resolveIconUrl) {
    const devNames = item.childBlocks;
    if (!devNames || !devNames.length) return '';

    const chips = devNames.map(name =>
      this._renderChip(name, { resolveLocalized, resolveIconUrl, interactive: !!onSlotItemClick }),
    ).join('');

    return this._section('Variants', `<div class="flex flex-wrap gap-1.5">${chips}</div>`, 'zinc');
  }

  /** Crafting recipe section rendered from a Templates.ecf Template object. */
  _recipeSection(template, resolveLocalized, onSlotItemClick, resolveIconUrl, templatesCfg, getMarketPrice = null) {
    if (!template) return '';

    // Craft time / output count / stations rows
    const metaRows = [];
    if (template.craftTime != null) metaRows.push(['Craft Time', formatDuration(template.craftTime), template.craftTime]);
    metaRows.push(['Output Count', String(template.outputCount ?? 1), template.outputCount ?? 1]);
    if (template.target.length) {
      const names = template.target.map(code => STATION_NAMES[code] ?? code).join(', ');
      metaRows.push(['Crafting Stations', names, names]);
    }
    const metaHtml = metaRows.length ? this._table(metaRows) : '';

    // If there are no valid ingredients, don't show the crafting section at all
    if (!template.inputs.some(({ qty }) => qty > 0)) return '';

    // Build ingredient chips HTML from a {name, qty}[] list, skipping qty <= 0
    const interactive = !!onSlotItemClick;
    const buildChips = (inputs) => inputs
      .filter(({ qty }) => qty > 0)
      .map(({ name, qty }) =>
        this._renderChip(name, { resolveLocalized, resolveIconUrl, interactive, labelPrefix: `${formatNumber(qty)}\u00d7` }),
      ).join('');

    const origChips = buildChips(template.inputs);
    const origHtml  = `<div class="flex flex-wrap gap-1.5">${origChips}</div>`;

    // Pre-compute simplified (flattened) ingredients
    const simplified = this._flattenIngredients(template.inputs, templatesCfg);

    let ingredientsHtml;
    if (simplified) {
      const simpInputs = [...simplified.ingredients.entries()]
        .map(([name, qty]) => ({ name, qty }))
        .filter(({ qty }) => qty > 0)
        .sort((a, b) => b.qty - a.qty);
      const simpChips = buildChips(simpInputs);

      // Craft time badge
      const timeBadge = simplified.craftTime > 0
        ? `<span class="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-zinc-800/80 border border-zinc-700/60 text-zinc-300">` +
          `<svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3 shrink-0 text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>` +
          `${escapeHtml(formatDuration(simplified.craftTime))}</span>`
        : '';

      // Market price badge
      let priceBadge = '';
      if (getMarketPrice) {
        let total = 0;
        let partial = false;
        for (const { name, qty } of simpInputs) {
          const mp = getMarketPrice(name);
          if (mp == null) partial = true;
          else total += mp * qty;
        }
        if (total > 0) {
          const prefix = partial ? '~\u2009' : '';
          priceBadge = `<span class="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-amber-950/40 border border-amber-800/40 text-amber-300">` +
            `<svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v2m0 8v2M9.5 9.5A3 3 0 0 1 15 12a3 3 0 0 1-5.5 1"/></svg>` +
            `${escapeHtml(prefix + formatNumber(total))}</span>`;
        }
      }

      const badgesHtml = (timeBadge || priceBadge)
        ? `<div class="flex gap-1.5 flex-wrap mb-2">${timeBadge}${priceBadge}</div>`
        : '';

      ingredientsHtml = `<div class="simplify-root mt-4">
  <div class="flex items-center justify-between mb-2">
    <p class="text-[10px] text-zinc-500 uppercase tracking-widest">Ingredients</p>
    <button data-simplify-toggle class="text-[10px] px-2 py-0.5 rounded border border-emerald-800 text-emerald-500 hover:bg-emerald-900/30 transition-colors cursor-pointer">Simplify</button>
  </div>
  <div class="ingr-orig">${origHtml}</div>
  <div class="ingr-simp hidden">
    <p class="text-[10px] text-zinc-600 mb-2">Base materials</p>
    ${badgesHtml}<div class="flex flex-wrap gap-1.5">${simpChips}</div>
  </div>
</div>`;
    } else {
      ingredientsHtml = origChips
        ? `<div class="mt-4"><p class="text-[10px] text-zinc-500 uppercase tracking-widest mb-2">Ingredients</p>${origHtml}</div>`
        : '';
    }

    return this._section('Crafting Recipe', metaHtml + ingredientsHtml, 'emerald');
  }

  /**
   * Recursively flattens ingredients to base materials using templatesCfg.
   * Returns null if nothing can be simplified.
   * @param {Array<{name:string,qty:number}>} inputs
   * @param {Map<string,import('../parsers/models/Template.js').Template>|null} templatesCfg
   * @returns {{ingredients: Map<string,number>, craftTime: number}|null}
   */
  _flattenIngredients(inputs, templatesCfg) {
    if (!templatesCfg) return null;
    let anySimplifiable = false;
    let totalCraftTime  = 0;
    const totals = new Map();

    // Ores that should never be expanded into their ore-processor outputs (CrushedStone).
    // CrushedStone itself is a real crafting ingredient and must not be blocked.
    const NO_EXPAND = new Set(['IronOre', 'CopperOre', 'Graphite', 'SiliconOre']);

    const recurse = (items, multiplier, visited) => {
      for (const { name, qty } of items) {
        const tmpl = templatesCfg.get(name);
        if (!tmpl || visited.has(name) || NO_EXPAND.has(name)) {
          totals.set(name, (totals.get(name) ?? 0) + qty * multiplier);
        } else {
          anySimplifiable = true;
          totalCraftTime += (tmpl.craftTime ?? 0) * qty * multiplier;
          const next = new Set(visited); next.add(name);
          recurse(tmpl.inputs, qty * multiplier, next);
        }
      }
    };
    recurse(inputs, 1, new Set());
    return anySimplifiable ? { ingredients: totals, craftTime: totalCraftTime } : null;
  }

  /** Shows which traders sell/buy this item. */
  _tradingSection(item, tradersCfg, resolveLocalized, onTraderClick = null) {
    if (!tradersCfg || !tradersCfg.length) return '';
    const devName = item.name;

    const entries = tradersCfg
      .map(trader => {
        const sell = trader.sellingItems.find(i => i.devName === devName);
        const buy  = trader.buyingItems.find(i => i.devName === devName);
        if (!sell && !buy) return null;
        return { trader, sell, buy };
      })
      .filter(Boolean);

    if (!entries.length) return '';

    const rows = entries.map(({ trader, sell, buy }) => {
      const traderName = resolveLocalized
        ? (resolveLocalized(trader.name ?? '') || trader.name || trader.name)
        : (trader.name ?? '?');

      const renderSide = (side, isSell) => {
        if (!side) return `<span class="text-zinc-700">\u2014</span>`;
        const qty   = isSell ? side.sellQtyRange : side.buyQtyRange;
        const price = isSell ? side.sellMfRange  : side.buyMfRange;
      const qtyStr   = (() => {
        if (!qty) return null;
        const p = String(qty).split('-');
        if (p.length === 2 && p[0].trim() === p[1].trim()) return p[0].trim();
        return String(qty).replace(/-/g, '\u2013');
      })();
        const priceStr = formatPrice(price);
        const colorCls = isSell ? 'text-emerald-400' : 'text-amber-400';
        const priceCls = 'text-zinc-500';
        let out = qtyStr ? `<span class="${colorCls}">${escapeHtml(qtyStr)}</span>` : '';
        if (priceStr) out += `<span class="${priceCls} ml-1">${escapeHtml(priceStr)}</span>`;
        return out || `<span class="${colorCls}">\u2713</span>`;
      };

      const nameEl = onTraderClick
        ? `<button data-trader-ref="${escapeHtml(trader.name)}" class="sm:shrink-0 sm:w-32 text-left text-zinc-300 truncate hover:text-blue-300 hover:underline transition-colors cursor-pointer text-sm font-medium">${escapeHtml(traderName)}</button>`
        : `<span class="sm:shrink-0 sm:w-32 text-zinc-300 truncate text-sm font-medium">${escapeHtml(traderName)}</span>`;
      const sellHtml = renderSide(sell, true);
      const buyHtml  = renderSide(buy,  false);
      return `<div class="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 px-3 py-2 odd:bg-zinc-800/20 even:bg-transparent text-sm">
    ${nameEl}
    <div class="flex items-center gap-1.5 sm:flex-1">
      <span class="text-[10px] uppercase tracking-widest text-emerald-900 sm:hidden">Sells</span>
      <span class="flex items-center gap-1">${sellHtml}</span>
    </div>
    <div class="flex items-center gap-1.5 sm:flex-1">
      <span class="text-[10px] uppercase tracking-widest text-amber-900 sm:hidden">Buys</span>
      <span class="flex items-center gap-1">${buyHtml}</span>
    </div>
  </div>`;
    }).join('');

    const header = `<div class="hidden sm:flex items-center gap-3 px-3 py-2 border-b border-zinc-800/60 text-xs uppercase tracking-widest text-zinc-600">
  <span class="shrink-0 w-32">Trader</span>
  <span class="flex-1 text-emerald-800">Sells · Stock</span>
  <span class="flex-1 text-amber-800">Buys · Stock</span>
</div>`;

    const table = `<div class="divide-y divide-zinc-800/60 rounded-lg overflow-hidden border border-zinc-800/60">${header}${rows}</div>`;
    return this._section('Trading', table, 'sky');
  }

  /** Renders the AmmoType property as a localized, clickable chip. */
  _ammoTypeSection(propMap, resolveLocalized, onSlotItemClick, resolveIconUrl) {
    const prop = propMap.get('AmmoType');
    if (!prop || !prop.value) return '';
    const devName = String(prop.value).trim();
    if (!devName || devName === 'null') return '';

    const chip = this._renderChip(devName, {
      resolveLocalized, resolveIconUrl, interactive: !!onSlotItemClick,
    });

    return this._section('Ammo Type', `<div class="flex flex-wrap gap-1.5">${chip}</div>`, 'orange');
  }

  /** Renders a single linked-item property (UpgradeTo / DowngradeTo) as a clickable chip. */
  _acceptSection(propMap, resolveLocalized, onSlotItemClick, resolveIconUrl) {
    const prop = propMap.get('Accept');
    if (!prop || !prop.value) return '';

    const raw = String(prop.value).replace(/^"|"$/g, '').trim();
    const devNames = raw.split(',').map(s => s.trim()).filter(Boolean);
    if (!devNames.length) return '';

    const chips = devNames.map(name =>
      this._renderChip(name, { resolveLocalized, resolveIconUrl, interactive: !!onSlotItemClick }),
    ).join('');

    return this._section('Accepts', `<div class="flex flex-wrap gap-1.5">${chips}</div>`, 'orange');
  }

  _upgradeToSection(propMap, resolveLocalized, onSlotItemClick, resolveIconUrl, propKey = 'UpgradeTo', sectionTitle = 'Upgrades To') {
    const prop = propMap.get(propKey);
    if (!prop || !prop.value) return '';
    const devName = String(prop.value).trim();
    if (!devName || devName === 'null') return '';

    const chip = this._renderChip(devName, {
      resolveLocalized, resolveIconUrl, interactive: !!onSlotItemClick,
    });

    return this._section(sectionTitle, `<div class="flex flex-wrap gap-1.5">${chip}</div>`, 'orange');
  }

  /** Economy: market price, unlock level/cost, tech tree */
  _economySection(propMap) {
    const rows = [
      ['Unlock Level', propMap.get('UnlockLevel')?.value],
      ['Unlock Cost',  propMap.get('UnlockCost')?.value],
      ['Tech Tree',    propMap.get('TechTreeNames')?.value ?? propMap.get('TechTreeParent')?.value],
    ].filter(([, v]) => v != null && v !== '');
    if (!rows.length) return '';
    return this._section('Tech Tree', this._table(rows), 'violet');
  }

  /** All remaining properties not already in stats/economy sections */
  _propertiesSection(properties, resolveLocalized = null) {
    const rows = properties
      .filter(p => !SECTION_KEYS.has(p.key))
      .map(p => {
        let rawDisplay = String(p.value ?? '');
        // Resolve localization keys for the Info property, converting \n to <br>
        if (p.key === 'Info' && resolveLocalized) {
          const localized = resolveLocalized(String(p.value ?? ''));
          if (localized && localized !== String(p.value ?? '')) {
            const htmlDisplay = localized.replace(/\\n/g, '<br>');
            return [p.key, htmlDisplay, p.value, true];
          }
        }
        // Format comma-separated lists as one entry per line
        if (p.key === 'DebuffNamesActivate' || p.key === 'Accept') {
          const htmlDisplay = escapeHtml(String(p.value ?? '')).split(',').join('<br>');
          return [p.key, htmlDisplay, p.value, true];
        }
        const transform = PROP_VALUE_TRANSFORMS[p.key];
        if (transform) rawDisplay = transform(p.value);
        return [p.key, rawDisplay, p.value];
      });
    if (!rows.length) return '';
    return this._section('Properties', this._table(rows), 'zinc');
  }

  /** One section per child block (e.g. Class: Ranged, Driller, etc.) */
  _childSection(child) {
    const label    = child.attributes['_label'] ?? '';
    const classVal = child.properties.find(p => p.key === 'Class')?.value;
    const title    = classVal ? `${label} — ${classVal}` : (label || child.type);

    const rows = child.properties.map(p => {
      const display = String(p.value ?? '');
      return [p.key, display, p.value];
    });

    if (!rows.length) return '';
    return this._section(String(title), this._table(rows), 'orange');
  }

  /**
   * @param {string} title
   * @param {string} content
   * @param {'sky'|'violet'|'zinc'|'orange'} accent
   */
  _section(title, content, accent = 'zinc') {
    const colorMap = {
      sky:     'text-sky-400     border-sky-400/30',
      violet:  'text-violet-400  border-violet-400/30',
      zinc:    'text-zinc-400    border-zinc-700/50',
      orange:  'text-orange-400  border-orange-400/30',
      emerald: 'text-emerald-400 border-emerald-400/30',
    };
    const cls = colorMap[accent] ?? colorMap.zinc;
    return `<div class="mb-5">
  <h4 class="text-xs font-bold tracking-widest uppercase mb-2 pl-2 border-l-2 ${cls}">${escapeHtml(title)}</h4>
  ${content}
</div>`;
  }

  /**
   * @param {Array<[string, string|null, *, boolean?]>} rows
   *   Tuple: [key, displayValue, rawValue, isHtml?]
   *   When isHtml is true, displayValue is already escaped HTML (e.g. contains <br>).
   */
  _table(rows) {
    return `<div class="divide-y divide-zinc-800/60 rounded-lg overflow-hidden border border-zinc-800/60">
  ${rows.map(([k, display, raw, isHtml]) => {
    const valClass = valueColorClass(raw ?? display);
    let rendered;
    if (isHtml) {
      rendered = String(display ?? '—');
    } else {
      const formatted = formatNumber(raw ?? display);
      rendered = escapeHtml(formatted !== String(raw ?? display) ? formatted : String(display ?? '—'));
    }
    return `<div class="flex flex-col sm:flex-row sm:items-start gap-0.5 sm:gap-3 px-3 py-2 odd:bg-zinc-800/20 even:bg-transparent">
    <span class="text-[10px] sm:text-xs text-zinc-500 sm:shrink-0 sm:w-32 sm:truncate uppercase tracking-wide sm:mt-0.5">${escapeHtml(PROP_LABELS[String(k)] ?? String(k))}</span>
    <span class="text-sm ${valClass} break-words leading-relaxed">${rendered}</span>
  </div>`;
  }).join('')}
</div>`;
  }
}

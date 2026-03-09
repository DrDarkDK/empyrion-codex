/**
 * CompareBuilder.js
 *
 * Pure data logic for building a structured side-by-side item comparison.
 *
 * Public API:
 *   buildComparison(items, options) → ComparisonResult
 *   filterDiffs(result)             → ComparisonResult  (only differing rows)
 */

import { formatNumber } from './renderUtils.js';

// ── Static data (mirrors ItemDetailRenderer constants) ────────────────────────

/** Stat keys rendered in the quick-stats strip (order matters). */
const STAT_KEY_DEFS = [
  { key: 'Mass',        label: 'Mass',         unit: 'kg' },
  { key: 'Volume',      label: 'Volume',       unit: 'L'  },
  { key: 'StackSize',   label: 'Stack Size',   unit: ''   },
  { key: 'Durability',  label: 'Durability',   unit: ''   },
  { key: 'MarketPrice', label: 'Market Price', unit: ''   },
];

/**
 * All keys that belong to named dedicated sections (not the generic Properties
 * catch-all). Mirrors SECTION_KEYS in ItemDetailRenderer.
 */
const SECTION_KEYS = new Set([
  'Mass', 'Volume', 'StackSize', 'Durability', 'MarketPrice',
  'UnlockCost', 'UnlockLevel', 'TechTreeNames', 'TechTreeParent',
  'Category', 'Material', 'HoldType', 'SlotItems', 'ChildBlocks', 'UpgradeTo', 'DowngradeTo',
  'AmmoType', 'Accept',
]);

/**
 * Keys whose values are item/block reference lists, surfaced as per-item chip
 * arrays rather than aligned diff rows.
 */
const CHIP_KEYS = ['SlotItems', 'UpgradeTo', 'DowngradeTo', 'AmmoType', 'Accept'];

/** Human-readable label overrides for ECF property keys. */
const PROP_LABELS = {
  FallDamageFac:        'Fall Damage Modifier',
  PowerFac:             'Power Modifier',
  SpeedFac:             'Speed Modifier',
  JumpFac:              'Jump Modifier',
  Jetpack:              'Jetpack Modifier',
  FoodFac:              'Food Modifier',
  StaminaFac:           'Stamina Modifier',
  DegradationFac:       'Degradation Modifier',
  JetpackFac:           'Jetpack Modifier',
  IsOxygenTight:        'Airtight',
  AllowPlacingAt:       'Placable On',
  HitPoints:            'Hit Points',
  Info:                 'Description',
  ShieldCapacityBonus:  'Shield Capacity Bonus',
  CPUIn:                'CPU Usage',
  VolumeCapacity:       'Volume Capacity',
  SizeInBlocks:         'Size',
  EnergyIn:             'Energy Consumption',
  EnergyInIdle:         'Idle Energy Consumption',
  RepairToTemplate:     'Repair To Template',
  UpgradeTo:            'Upgrades To',
  DowngradeTo:          'Downgrades To',
  AllowedInBlueprint:   'Allowed In Blueprints',
  CPUOut:               'CPU Bonus',
  EnergyOut:            'Energy Bonus',
  ConsumeFuelO2:        'Fuel And O2 Consumption',
  MaxCount:             'Max Count',
  ThrusterForce:        'Thruster Force',
  RangeAU:              'Range (AU)',
  RangeLY:              'Range (LY)',
  ShieldRechargeBonus:  'Shield Recharge Bonus',
  ShieldCapacity:       'Shield Capacity',
  ShieldRecharge:       'Shield Charge',
  ShieldCooldown:       'Shield Cooldown',
  ShieldHitCooldown:    'Shield Hit Cooldown',
  IsRepairToBlueprint:  'Repair To Blueprint',
  ItemsPerHour:         'Items Per Hour',
  ShieldDamagePenFac:   'Shield Penetration Modifier',
  GrowthRate:           'Growth Rate',
  FertileLevel:         'Fertility Level',
  CropYield:            'Crop Yield',
  GrowthTimeInfo:       'Growth Time',
  RepairDisabled:       'Repair Disabled',
  RangeSpace:           'Range (Space)',
  FoodDecayTime:        'Decay Time',
  BlastRadius:          'Blast Radius',
  BlastDamage:          'Blast Damage',
  IsRetractable:        'Is Retractable',
  AmmoCapacity:         'Ammo Capacity',
  O2Value:              'O2 Value',
  FuelValue:            'Fuel Value',
  FuelCapacity:         'Fuel Capacity',
  Material:             'Material',
  HoldType:             'Hold Type',
  Category:             'Category',
  UnlockLevel:          'Unlock Level',
  UnlockCost:           'Unlock Cost',
  TechTreeNames:        'Tech Tree',
  TechTreeParent:       'Tech Tree',
};

/**
 * Per-key display value normalisation transforms (mirrors PROP_VALUE_TRANSFORMS
 * in ItemDetailRenderer). Applied only to `displayValues`, not `rawValues`.
 */
const DISPLAY_TRANSFORMS = {
  AllowPlacingAt: v => {
    const MAP = { MS: 'Capital Vessel', SS: 'Small Vessel', GV: 'Hover Vessel' };
    return String(v).split(',').map(s => MAP[s.trim()] ?? s.trim()).join(', ');
  },
  SizeInBlocks: v => String(v).replace(/,\s*/g, 'x'),
};

/** Crafting station code → human-readable name. */
const STATION_NAMES = {
  BaseC: 'Base Constructor', LargeC: 'Large Constructor',
  SmallC: 'Small Constructor', HoverC: 'HV Constructor',
  AdvC: 'Advanced Constructor', SurvC: 'Survival Constructor',
  FoodP: 'Food Processor',
};

/** Ingredient devNames that are never expanded during recipe flattening. */
const NO_EXPAND = new Set(['IronOre', 'CopperOre', 'Graphite', 'SiliconOre']);

// ── Type definitions (JSDoc) ──────────────────────────────────────────────────

/**
 * @typedef {Object} CompareRow
 * One row in a comparison table, representing a single ECF property across all
 * compared items.
 *
 * @property {string}           key            - ECF property key (or synthetic key like '_materials_cost')
 * @property {string}           label          - Human-readable label
 * @property {string}           unit           - Unit suffix (e.g. 'kg', 'L') or ''
 * @property {(string|null)[]}  rawValues      - Raw string value per item (null = property absent)
 * @property {(string|null)[]}  displayValues  - Formatted display string per item (null = absent)
 * @property {boolean}          isDiff         - true if any two present values differ
 * @property {boolean}          isNumeric      - true when all present values parse as numbers
 * @property {(number|null)[]}  numericValues  - Parsed numeric value per item (null = absent or non-numeric)
 * @property {(number|null)[]}  deltas         - Signed delta vs items[0] (null when non-numeric or item absent)
 * @property {number|null}      maxIdx         - Index of the item with the highest numeric value
 * @property {number|null}      minIdx         - Index of the item with the lowest numeric value
 * @property {boolean[]}        [partialValues] - Optional: true per item when the value is an estimate (e.g. partial market price)
 */

/**
 * @typedef {Object} CompareSection
 * A named group of aligned CompareRows.
 *
 * @property {string}       id      - Stable identifier for the section
 * @property {string}       title   - Display title
 * @property {string}       accent  - Color accent token ('sky'|'violet'|'zinc'|'orange'|'emerald')
 * @property {CompareRow[]} rows
 * @property {boolean}      hasDiff - true if at least one row in this section isDiff
 */

/**
 * @typedef {Object} CompareRecipe
 * Per-item crafting recipe data.
 *
 * @property {import('../parsers/models/Template.js').Template|null} template        - Raw template (null if no recipe)
 * @property {string[]}                                              stationNames    - Human-readable crafting station names
 * @property {Map<string,number>|null}  flatIngredients  - Flattened base-material totals (null if not simplifiable)
 * @property {number}                   flatCraftTime    - Total craft time (seconds) of the flattened recipe
 * @property {number|null}              materialsCost    - Summed market price of flat ingredients (null if unavailable)
 * @property {boolean}                  partialCost      - true when materialsCost omits items without a market price
 */

/**
 * @typedef {Object} TraderEntry
 * @property {import('../parsers/models/TraderNPC.js').TraderNPC} trader
 * @property {object|null} sell  - Matching selling-item entry from the trader
 * @property {object|null} buy   - Matching buying-item entry from the trader
 */

/**
 * @typedef {Object} ComparisonResult
 * The full structured output of buildComparison().
 *
 * @property {import('../parsers/models/Item.js').Item[]}   items
 * @property {CompareRow[]}    statsRow    - Stat-strip rows (Mass, Volume, …, Materials Cost)
 * @property {CompareSection[]}sections    - Aligned property sections (general, techTree, properties, children…)
 * @property {(CompareRecipe|null)[]} recipes    - Per-item recipe data
 * @property {TraderEntry[][]}  traderData  - Per-item list of trader entries
 * @property {CompareRow[]}    ingredientRows - Aligned rows for recipe ingredient quantities
 * @property {Object.<string,(string[]|string|null)[]>} chipData
 *   Per-item devName arrays for reference-type properties.
 *   Keys: 'SlotItems', 'UpgradeTo', 'DowngradeTo', 'AmmoType', 'Accept', 'ChildBlocks'.
 *   Each value is an array (one element per item) of either a string[] (multi-value
 *   keys) or string|null (single-value keys like AmmoType/UpgradeTo/DowngradeTo).
 */

// ── Low-level helpers ─────────────────────────────────────────────────────────

/**
 * Returns true when a value should be treated as a number for comparison.
 * Explicitly excludes booleans and null/empty.
 * @param {*} v
 * @returns {boolean}
 */
function isNumericValue(v) {
  if (v == null || v === '' || v === true || v === false || v === 'true' || v === 'false') return false;
  return !isNaN(Number(v));
}

/**
 * Builds a property lookup Map from an item's properties array.
 * @param {import('../parsers/models/Item.js').Item} item
 * @returns {Map<string, import('../parsers/ecf/EcfProperty.js').EcfProperty>}
 */
function buildPropMap(item) {
  return new Map(item.properties.map(p => [p.key, p]));
}

/**
 * Reads the raw string value for a key from a property map.
 * Returns null when absent or empty.
 * @param {Map} propMap
 * @param {string} key
 * @returns {string|null}
 */
function getPropValue(propMap, key) {
  const p = propMap.get(key);
  if (!p || p.value == null || p.value === '') return null;
  return String(p.value);
}

/**
 * Derives a display string from a raw value.
 * Applies per-key transforms and formatNumber for numeric values.
 * @param {string} key
 * @param {string} rawValue
 * @param {string} unit
 * @returns {string}
 */
function toDisplay(key, rawValue, unit) {
  const transform = DISPLAY_TRANSFORMS[key];
  const base = transform ? transform(rawValue) : formatNumber(rawValue);
  return unit ? `${base} ${unit}` : base;
}

// ── Core row builder ──────────────────────────────────────────────────────────

/**
 * Builds a CompareRow by analysing raw values across all items.
 *
 * @param {string}          key
 * @param {string}          label
 * @param {string}          unit
 * @param {(string|null)[]} rawValues  - one per item, null when the property is absent
 * @param {boolean[]}       [partialValues] - optional partial-estimate flags per item
 * @returns {CompareRow}
 */
function buildRow(key, label, unit, rawValues, partialValues) {
  const presentValues = rawValues.filter(v => v != null);

  const isNumeric =
    presentValues.length > 0 &&
    presentValues.every(isNumericValue);

  const numericValues = isNumeric
    ? rawValues.map(v => (v != null ? Number(v) : null))
    : rawValues.map(() => null);

  const displayValues = rawValues.map(v =>
    v == null ? null : toDisplay(key, v, unit),
  );

  // Diff: any two present values differ
  const isDiff =
    presentValues.length > 1 &&
    !presentValues.every(v => String(v) === String(presentValues[0]));

  // Numeric deltas relative to items[0]
  const base = numericValues[0];
  const deltas = isNumeric
    ? numericValues.map((n, i) => (i === 0 || n == null || base == null ? null : n - base))
    : rawValues.map(() => null);

  // Max / min indices (among items that have a value)
  let maxIdx = null;
  let minIdx = null;
  if (isNumeric) {
    const present = numericValues
      .map((v, i) => ({ v, i }))
      .filter(({ v }) => v != null);
    if (present.length > 0) {
      maxIdx = present.reduce((a, b) => (b.v > a.v ? b : a)).i;
      minIdx = present.reduce((a, b) => (b.v < a.v ? b : a)).i;
    }
  }

  /** @type {CompareRow} */
  const row = { key, label, unit, rawValues, displayValues, isDiff, isNumeric, numericValues, deltas, maxIdx, minIdx };
  if (partialValues) row.partialValues = partialValues;
  return row;
}

// ── Ingredient flattening ─────────────────────────────────────────────────────

/**
 * Recursively flattens a recipe's ingredients to base materials.
 * Returns null when nothing in the recipe is further simplifiable.
 *
 * @param {Array<{name:string,qty:number}>} inputs
 * @param {Map<string, import('../parsers/models/Template.js').Template>|null} templatesCfg
 * @returns {{ingredients: Map<string,number>, craftTime: number}|null}
 */
function flattenIngredients(inputs, templatesCfg) {
  if (!templatesCfg) return null;
  let anySimplifiable = false;
  let totalCraftTime  = 0;
  const totals = new Map();

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

// ── Section builders ──────────────────────────────────────────────────────────

/**
 * Builds the stats strip rows: STAT_KEY_DEFS + an optional Materials Cost row.
 *
 * The Materials Cost row uses the synthetic key '_materials_cost' and carries a
 * `partialValues` boolean array indicating per-item estimates.
 *
 * @param {Map[]} propMaps
 * @param {(import('../parsers/models/Template.js').Template|null)[]} templates
 * @param {function(string): number|null} getMarketPrice
 * @returns {CompareRow[]}
 */
function buildStatsRow(propMaps, templates, getMarketPrice) {
  const rows = STAT_KEY_DEFS
    .map(({ key, label, unit }) => {
      const rawValues = propMaps.map(pm => getPropValue(pm, key));
      if (rawValues.every(v => v == null)) return null;
      return buildRow(key, label, unit, rawValues);
    })
    .filter(Boolean);

  // Materials Cost: top-level ingredients only (mirrors _statsRow in ItemDetailRenderer)
  if (getMarketPrice && templates.some(Boolean)) {
    const rawValues   = [];
    const partials    = [];

    for (const template of templates) {
      if (!template) { rawValues.push(null); partials.push(false); continue; }
      const inputs = (template.inputs ?? []).filter(({ qty }) => qty > 0);
      let total = 0;
      let partial = false;
      for (const { name, qty } of inputs) {
        const mp = getMarketPrice(name);
        if (mp == null) partial = true;
        else total += mp * qty;
      }
      rawValues.push(total > 0 ? String(total) : null);
      partials.push(partial);
    }

    if (rawValues.some(v => v != null)) {
      rows.push(buildRow('_materials_cost', 'Materials Cost', '', rawValues, partials));
    }
  }

  return rows;
}

/**
 * Builds the General section: Category, Material, HoldType.
 * @param {Map[]} propMaps
 * @returns {CompareSection|null}
 */
function buildGeneralSection(propMaps) {
  const defs = [
    { key: 'Category', label: 'Category',  unit: '' },
    { key: 'Material', label: 'Material',  unit: '' },
    { key: 'HoldType', label: 'Hold Type', unit: '' },
  ];
  const rows = defs
    .map(({ key, label, unit }) => {
      const rawValues = propMaps.map(pm => getPropValue(pm, key));
      if (rawValues.every(v => v == null)) return null;
      return buildRow(key, label, unit, rawValues);
    })
    .filter(Boolean);

  if (!rows.length) return null;
  return { id: 'general', title: 'General', accent: 'sky', rows, hasDiff: rows.some(r => r.isDiff) };
}

/**
 * Builds the Tech Tree section: UnlockLevel, UnlockCost, and the tech tree name.
 * TechTreeNames is preferred over TechTreeParent; both map to the 'Tech Tree' row.
 * @param {Map[]} propMaps
 * @returns {CompareSection|null}
 */
function buildTechTreeSection(propMaps) {
  const rows = [];

  const unlockLevelValues = propMaps.map(pm => getPropValue(pm, 'UnlockLevel'));
  if (unlockLevelValues.some(v => v != null))
    rows.push(buildRow('UnlockLevel', 'Unlock Level', '', unlockLevelValues));

  const unlockCostValues = propMaps.map(pm => getPropValue(pm, 'UnlockCost'));
  if (unlockCostValues.some(v => v != null))
    rows.push(buildRow('UnlockCost', 'Unlock Cost', '', unlockCostValues));

  // TechTreeNames preferred, fall back to TechTreeParent
  const techTreeValues = propMaps.map(pm =>
    getPropValue(pm, 'TechTreeNames') ?? getPropValue(pm, 'TechTreeParent'),
  );
  if (techTreeValues.some(v => v != null))
    rows.push(buildRow('TechTreeNames', 'Tech Tree', '', techTreeValues));

  if (!rows.length) return null;
  return { id: 'techTree', title: 'Tech Tree', accent: 'violet', rows, hasDiff: rows.some(r => r.isDiff) };
}

/**
 * Builds the Properties section: the union of all property keys not already
 * assigned to a dedicated section, in order of first appearance across items.
 * @param {import('../parsers/models/Item.js').Item[]} items
 * @param {Map[]} propMaps
 * @returns {CompareSection|null}
 */
function buildPropertiesSection(items, propMaps) {
  const allKeys = [];
  const seenKeys = new Set();
  for (const item of items) {
    for (const prop of item.properties) {
      if (!SECTION_KEYS.has(prop.key) && !seenKeys.has(prop.key)) {
        allKeys.push(prop.key);
        seenKeys.add(prop.key);
      }
    }
  }

  const rows = allKeys
    .map(key => {
      const rawValues = propMaps.map(pm => getPropValue(pm, key));
      if (rawValues.every(v => v == null)) return null;
      return buildRow(key, PROP_LABELS[key] ?? key, '', rawValues);
    })
    .filter(Boolean);

  if (!rows.length) return null;
  return { id: 'properties', title: 'Properties', accent: 'zinc', rows, hasDiff: rows.some(r => r.isDiff) };
}

/**
 * Derives a stable canonical key for an item child block.
 * Used to align matching child sections across items (e.g. "Ranged — Ranged").
 * @param {import('../parsers/ecf/EcfBlock.js').EcfBlock} child
 * @returns {string}
 */
function childCanonicalKey(child) {
  const label    = child.attributes?.['_label'] ?? '';
  const classVal = child.properties?.find(p => p.key === 'Class')?.value;
  return classVal ? `${label}-${classVal}` : label || child.type;
}

/**
 * Derives the display title for a child section from its canonical key.
 * @param {string} canonicalKey
 * @returns {string}
 */
function childTitle(canonicalKey) {
  const dashIdx = canonicalKey.indexOf('-');
  if (dashIdx === -1) return canonicalKey;
  const part1 = canonicalKey.slice(0, dashIdx);
  const part2 = canonicalKey.slice(dashIdx + 1);
  return part2 ? `${part1} \u2014 ${part2}` : part1;
}

/**
 * Builds aligned comparison sections for item.children (weapon/tool class data).
 * Children are matched across items by their canonical key.  Items that lack a
 * particular child type have null in the corresponding row values.
 * @param {import('../parsers/models/Item.js').Item[]} items
 * @returns {CompareSection[]}
 */
function buildChildSections(items) {
  // Collect all canonical child keys, preserving order of first appearance
  const childKeyOrder = [];
  const seenChildKeys = new Set();
  for (const item of items) {
    for (const child of (item.children ?? [])) {
      const ck = childCanonicalKey(child);
      if (!seenChildKeys.has(ck)) { childKeyOrder.push(ck); seenChildKeys.add(ck); }
    }
  }

  return childKeyOrder
    .map(canonicalKey => {
      // Locate the matching child in each item (null if absent)
      const children = items.map(item =>
        (item.children ?? []).find(c => childCanonicalKey(c) === canonicalKey) ?? null,
      );

      // Property maps per child
      const childPropMaps = children.map(c =>
        c ? new Map(c.properties.map(p => [p.key, p])) : new Map(),
      );

      // Union of property keys in first-appearance order
      const allKeys = [];
      const seenKeys = new Set();
      for (const c of children) {
        if (!c) continue;
        for (const prop of c.properties) {
          if (!seenKeys.has(prop.key)) { allKeys.push(prop.key); seenKeys.add(prop.key); }
        }
      }

      const rows = allKeys
        .map(key => {
          const rawValues = childPropMaps.map(pm => {
            const p = pm.get(key);
            return (p && p.value != null && p.value !== '') ? String(p.value) : null;
          });
          if (rawValues.every(v => v == null)) return null;
          return buildRow(key, PROP_LABELS[key] ?? key, '', rawValues);
        })
        .filter(Boolean);

      if (!rows.length) return null;

      return {
        id:      `child-${canonicalKey}`,
        title:   childTitle(canonicalKey),
        accent:  'orange',
        rows,
        hasDiff: rows.some(r => r.isDiff),
      };
    })
    .filter(Boolean);
}

// ── Per-item complex data builders ────────────────────────────────────────────

/**
 * Builds per-item CompareRecipe objects from templates.
 * @param {(import('../parsers/models/Template.js').Template|null)[]} templates
 * @param {Map<string, import('../parsers/models/Template.js').Template>|null} templatesCfg
 * @param {function(string): number|null} getMarketPrice
 * @returns {(CompareRecipe|null)[]}
 */
function buildRecipes(templates, templatesCfg, getMarketPrice) {
  return templates.map(template => {
    if (!template) return null;

    const stationNames = (template.target ?? []).map(code => STATION_NAMES[code] ?? code);
    const flat         = flattenIngredients(template.inputs, templatesCfg);

    let materialsCost = null;
    let partialCost   = false;
    if (getMarketPrice && flat) {
      let total = 0;
      for (const [name, qty] of flat.ingredients) {
        const mp = getMarketPrice(name);
        if (mp == null) partialCost = true;
        else total += mp * qty;
      }
      if (total > 0) materialsCost = total;
    }

    return {
      template,
      stationNames,
      flatIngredients: flat?.ingredients ?? null,
      flatCraftTime:   flat?.craftTime   ?? 0,
      materialsCost,
      partialCost,
    };
  });
}

/**
 * Builds per-item trader entry arrays.
 * @param {import('../parsers/models/Item.js').Item[]} items
 * @param {import('../parsers/models/TraderNPC.js').TraderNPC[]|null} tradersCfg
 * @returns {TraderEntry[][]}
 */
function buildTraderData(items, tradersCfg) {
  if (!tradersCfg?.length) return items.map(() => []);
  return items.map(item =>
    tradersCfg
      .map(trader => {
        const sell = trader.sellingItems?.find(i => i.devName === item.name) ?? null;
        const buy  = trader.buyingItems?.find(i => i.devName === item.name) ?? null;
        return (sell || buy) ? { trader, sell, buy } : null;
      })
      .filter(Boolean),
  );
}

/**
 * Builds per-item chip data for all reference-type properties.
 * Multi-value fields (SlotItems, Accept) return string[].
 * Single-value fields (AmmoType, UpgradeTo, DowngradeTo) return string|null.
 * ChildBlocks comes from item.childBlocks (Block model only; Items return []).
 *
 * @param {import('../parsers/models/Item.js').Item[]} items
 * @param {Map[]} propMaps
 * @returns {Object.<string, Array>}
 */
function buildChipData(items, propMaps) {
  const multiValueKeys = ['SlotItems', 'Accept'];
  const singleValueKeys = ['AmmoType', 'UpgradeTo', 'DowngradeTo'];

  const data = {};

  for (const key of multiValueKeys) {
    data[key] = propMaps.map(pm => {
      const raw = getPropValue(pm, key);
      if (!raw) return [];
      return raw.replace(/^"|"$/g, '').split(',').map(s => s.trim()).filter(Boolean);
    });
  }

  for (const key of singleValueKeys) {
    data[key] = propMaps.map(pm => {
      const v = getPropValue(pm, key);
      if (!v || v === 'null') return null;
      return v.trim();
    });
  }

  // ChildBlocks is a first-class field on Block; falls back to [] for plain Items
  data['ChildBlocks'] = items.map(item => item.childBlocks ?? []);

  return data;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Builds aligned comparison rows for recipe ingredients across all items.
 * Each row represents one ingredient: label = devName, values = qty per item.
 * Items without a recipe or without that ingredient get null in that column.
 *
 * @param {(import('../parsers/models/Template.js').Template|null)[]} templates
 * @returns {CompareRow[]}
 */
function buildIngredientRows(templates) {
  const allNames = [];
  const seenNames = new Set();
  for (const template of templates) {
    if (!template) continue;
    for (const { name, qty } of (template.inputs ?? [])) {
      if (qty > 0 && !seenNames.has(name)) {
        allNames.push(name);
        seenNames.add(name);
      }
    }
  }
  if (!allNames.length) return [];
  return allNames
    .map(name => {
      const rawValues = templates.map(t => {
        if (!t) return null;
        const ing = (t.inputs ?? []).find(i => i.name === name && i.qty > 0);
        return ing ? String(ing.qty) : null;
      });
      if (rawValues.every(v => v == null)) return null;
      return buildRow(name, name, '', rawValues);
    })
    .filter(Boolean);
}

/**
 * Builds a structured side-by-side comparison of the given items.
 *
 * @param {import('../parsers/models/Item.js').Item[]} items
 *   The items to compare. Order is preserved; items[0] is the baseline for deltas.
 * @param {object}  [options]
 * @param {Map<string, import('../parsers/models/Template.js').Template>|null} [options.templatesCfg]
 *   All templates — used to resolve recipes and flatten ingredients.
 * @param {import('../parsers/models/TraderNPC.js').TraderNPC[]|null} [options.tradersCfg]
 *   All trader NPCs — used to find which traders deal in each item.
 * @param {function(string): number|null} [options.getMarketPrice]
 *   Resolves the market price for a given devName. Used for cost calculations.
 * @returns {ComparisonResult}
 */
export function buildComparison(items, {
  templatesCfg  = null,
  tradersCfg    = null,
  getMarketPrice = null,
} = {}) {
  if (!items.length) {
    return { items: [], statsRow: [], sections: [], recipes: [], traderData: [], chipData: {} };
  }

  const propMaps  = items.map(buildPropMap);
  const templates = items.map(item =>
    templatesCfg?.get(item.recipeName ?? item.name) ?? null,
  );

  return {
    items,
    statsRow:   buildStatsRow(propMaps, templates, getMarketPrice),
    sections:   [
      buildGeneralSection(propMaps),
      buildTechTreeSection(propMaps),
      buildPropertiesSection(items, propMaps),
      ...buildChildSections(items),
    ].filter(Boolean),
    recipes:    buildRecipes(templates, templatesCfg, getMarketPrice),
    traderData: buildTraderData(items, tradersCfg),
    chipData:   buildChipData(items, propMaps),
    ingredientRows: buildIngredientRows(templates),
  };
}

/**
 * Returns a filtered copy of a ComparisonResult that includes only the rows and
 * sections where values differ across items. Sections with no differing rows are
 * omitted entirely.
 *
 * Useful for a "Show differences only" mode in the comparison UI.
 *
 * @param {ComparisonResult} result
 * @returns {ComparisonResult}
 */
export function filterDiffs(result) {
  const statsRow = result.statsRow.filter(r => r.isDiff);

  const sections = result.sections
    .map(section => {
      const rows = section.rows.filter(r => r.isDiff);
      return rows.length ? { ...section, rows, hasDiff: true } : null;
    })
    .filter(Boolean);

  return { ...result, statsRow, sections };
}
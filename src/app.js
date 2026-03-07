import { ParserFactory } from './parsers/ParserFactory.js';
import { LocalizationParser, stripFormatting, formatRichText } from './parsers/LocalizationParser.js';
import { TemplatesConfigParser } from './parsers/TemplatesConfigParser.js';
import { ItemListRenderer } from './ui/ItemListRenderer.js';
import { ItemDetailRenderer } from './ui/ItemDetailRenderer.js';
import { TraderRenderer } from './ui/TraderRenderer.js';
import { TraderDetailRenderer } from './ui/TraderDetailRenderer.js';
import { getCategoryIcon } from './ui/categoryIcons.js';
import { escapeHtml, parseQtyRange, estimatePriceRange } from './ui/renderUtils.js';
import * as db from './db.js';

// ── Navigation ───────────────────────────────────────────────────────────────
const navButtons    = document.querySelectorAll('.sidebar-btn');
const sectionPanels = document.querySelectorAll('.section-panel');

function navigateTo(sectionId) {
  const key = sectionId.replace('section-', '');
  // Don't navigate to a section whose nav button is disabled
  const targetBtn = [...navButtons].find(b => b.dataset.section === key);
  if (targetBtn?.disabled) return;
  navButtons.forEach(b => {
    const on = b.dataset.section === key;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  sectionPanels.forEach(s => s.classList.add('hidden'));
  document.getElementById(sectionId).classList.remove('hidden');
  if (sectionId === 'section-scenarios') renderSavedScenarios();
}

/** Enables/disables nav buttons that require loaded data. */
function updateNavState() {
  const hasData = !!(lastItemResults?.length || rawTradersCfg?.length);
  navButtons.forEach(btn => {
    if (btn.dataset.section === 'items' || btn.dataset.section === 'trading') {
      btn.disabled = !hasData;
      btn.title = hasData ? '' : 'Load a scenario first';
    }
  });
}

document.getElementById('logo-home-btn')?.addEventListener('click', () => { navigateTo('section-scenarios'); closeSidebar(); });
document.getElementById('logo-home-btn')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigateTo('section-scenarios'); closeSidebar(); }
});

navButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    navigateTo(`section-${btn.dataset.section}`);
    closeSidebar();
  });
});

// ── Mobile sidebar toggle ─────────────────────────────────────────────────────
const sidebarEl        = document.getElementById('sidebar');
const sidebarBackdrop  = document.getElementById('sidebar-backdrop');
const sidebarToggleBtn = document.getElementById('sidebar-toggle');
const sidebarCloseBtn  = document.getElementById('sidebar-close');

function openSidebar() {
  sidebarEl.classList.remove('-translate-x-full');
  sidebarBackdrop.classList.remove('hidden');
  sidebarToggleBtn?.setAttribute('aria-expanded', 'true');
  document.body.style.overflow = 'hidden';
}

function closeSidebar() {
  sidebarEl.classList.add('-translate-x-full');
  sidebarBackdrop.classList.add('hidden');
  sidebarToggleBtn?.setAttribute('aria-expanded', 'false');
  document.body.style.overflow = '';
}

sidebarToggleBtn?.addEventListener('click', openSidebar);
sidebarCloseBtn?.addEventListener('click', closeSidebar);
sidebarBackdrop?.addEventListener('click', closeSidebar);

// ── Item detail drawer ───────────────────────────────────────────────────────
const drawer          = document.getElementById('item-drawer');
const drawerBackdrop  = document.getElementById('drawer-backdrop');
const drawerClose     = document.getElementById('drawer-close');
const drawerShare     = document.getElementById('drawer-share');
const drawerBack      = document.getElementById('drawer-back');
const drawerIcon      = document.getElementById('drawer-icon');
const drawerTitle     = document.getElementById('drawer-title');
const drawerSubtitle  = document.getElementById('drawer-subtitle');
const drawerId        = document.getElementById('drawer-id');
const drawerBody      = document.getElementById('drawer-body');

const itemDetailRenderer = new ItemDetailRenderer();
const traderDetailRenderer = new TraderDetailRenderer();
const mainEl = document.querySelector('main');

// ── Localization ──────────────────────────────────────────────────────────────
let localizationMap = null;

/** Returns the plain-text localized display name for a devName, falling back to the devName itself. */
function resolveDisplayName(devName) {
  if (!devName) return devName;
  const raw = localizationMap?.get(devName);
  return (raw != null ? stripFormatting(raw) : null) ?? devName;
}

/** Returns the HTML-formatted localized display name for a devName (safe, no XSS). */
function resolveDisplayNameHtml(devName) {
  if (!devName) return '';
  const raw = localizationMap?.get(devName);
  return raw != null ? formatRichText(raw) : formatRichText(devName);
}

// ── Icons ─────────────────────────────────────────────────────────────────────
/** Map of devName (lowercase, no extension) → File */
let iconFileMap = new Map();
/** Map of devName (lowercase) → base64 data URL, populated from .empcdx imports. */
let iconDataMap = new Map();

/**
 * Scans the files from a folder selection and builds iconFileMap from
 * files under …/SharedData/Content/Bundles/ItemIcons/.
 * Only File references are stored; no data is read.
 * @param {File[]} files
 */
function buildIconMap(files) {
  iconFileMap = new Map();
  const marker = '/shareddata/content/bundles/itemicons/';
  for (const file of files) {
    const rel = file.webkitRelativePath.replace(/\\/g, '/').toLowerCase();
    if (!rel.includes(marker)) continue;
    const basename = file.name.replace(/\.[^.]+$/, ''); // strip extension
    iconFileMap.set(basename.toLowerCase(), file);
  }
}

/**
 * Reads a File as a base64 data URL.
 * @param {File} file
 * @returns {Promise<string>}
 */
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(/** @type {string} */ (reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Returns an icon URL for the given devName, or null if unavailable.
 * Prefers data URLs from imported .empcdx files; falls back to blob URLs from
 * locally selected icon folders.
 * @param {string} devName
 * @returns {string|null}
 */
function resolveIconUrl(devName) {
  if (!devName) return null;
  const key = devName.toLowerCase();
  if (iconDataMap.has(key)) return iconDataMap.get(key);
  const file = iconFileMap.get(key);
  return file ? URL.createObjectURL(file) : null;
}

// ── Drawer ────────────────────────────────────────────────────────────────────
/** Blob URL currently shown in the drawer icon — revoked on close/reopen. */
let drawerIconUrl = null;
/** Navigation history stack — items pushed when navigating via slot item chips. */
let drawerHistory = [];
/** Element that triggered the drawer, used to restore focus on close. */
let _drawerOpener = null;

function _populateDrawer(item) {
  if (drawerIconUrl) { URL.revokeObjectURL(drawerIconUrl); drawerIconUrl = null; }

  const iconUrl = resolveIconUrl(item.name);
  if (iconUrl) {
    drawerIconUrl = iconUrl;
    drawerIcon.innerHTML = `<img src="${iconUrl}" alt="" class="w-8 h-8 object-contain" draggable="false" />`;
  } else {
    drawerIcon.innerHTML = (iconFileMap.size > 0 || iconDataMap.size > 0) ? '' : getCategoryIcon(item.category);
  }

  drawerTitle.innerHTML      = resolveDisplayNameHtml(item.name) || 'Unknown';
  drawerSubtitle.textContent = item.category ?? '';
  drawerId.textContent       = item.id != null ? `#${item.id}` : '';

  // Update URL hash so this view can be bookmarked and shared
  history.replaceState(null, '', `#item=${item.id ?? encodeURIComponent(item.name ?? '')}`);

  const template = rawTemplatesCfg?.get(item.recipeName ?? item.name) ?? null;
  itemDetailRenderer.render(item, drawerBody, {
    resolveLocalized: resolveDisplayNameHtml,
    onSlotItemClick: (devName) => {
      // Search the grid list first, then fall back to variant blocks not shown on the grid
      const target = lastItemResults?.find(i => i.name === devName)
        ?? rawBlocksCfg?.find(b => b.name === devName);
      if (target) {
        drawerHistory.push(() => _populateDrawer(item));
        _populateDrawer(target);
        drawerBack.classList.remove('hidden');
      }
    },
    resolveIconUrl,
    template,
    templatesCfg: rawTemplatesCfg,
    tradersCfg: rawTradersCfg,
    onTraderClick: (traderName) => {
      const trader = rawTradersCfg?.find(t => t.name === traderName);
      if (trader) {
        drawerHistory.push(() => _populateDrawer(item));
        _populateTraderDrawer(trader);
        drawerBack.classList.remove('hidden');
      }
    },
    getMarketPrice: getMarketPriceFor,
  });
}

function openDrawer(item) {
  _drawerOpener = document.activeElement;
  drawerHistory = [];
  drawerBack.classList.add('hidden');
  _populateDrawer(item);
  drawer.classList.add('open');
  drawer.removeAttribute('aria-hidden');
  drawerBackdrop.classList.remove('hidden');
  mainEl.classList.add('drawer-open');
  drawerClose.focus();
}

function closeDrawer() {
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  drawerBackdrop.classList.add('hidden');
  mainEl.classList.remove('drawer-open');
  if (_drawerOpener && document.contains(_drawerOpener)) _drawerOpener.focus();
  _drawerOpener = null;
  history.replaceState(null, '', location.pathname + location.search);
}

function _populateTraderDrawer(trader) {
  if (drawerIconUrl) { URL.revokeObjectURL(drawerIconUrl); drawerIconUrl = null; }

  // Merchant icon — a simple store SVG
  drawerIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="w-8 h-8 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
  <path stroke-linecap="round" stroke-linejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2 9m5-9v9m4-9v9m5-9l2 9" />
</svg>`;

  drawerTitle.innerHTML      = resolveDisplayNameHtml(trader.name) || trader.name || 'Unknown Trader';
  drawerSubtitle.textContent = 'Trader';
  drawerId.textContent       = '';

  // Update URL hash so this view can be bookmarked and shared
  history.replaceState(null, '', `#trader=${encodeURIComponent(trader.name ?? '')}`);

  traderDetailRenderer.render(normalizeTraderTokens(trader), drawerBody, {
    resolveLocalized: resolveDisplayNameHtml,
    onItemClick: (devName) => {
      const target = makeTokenSyntheticItem(devName)
        ?? lastItemResults?.find(i => i.name === devName)
        ?? rawBlocksCfg?.find(b => b.name === devName);
      if (target) {
        drawerHistory.push(() => _populateTraderDrawer(trader));
        _populateDrawer(target);
        drawerBack.classList.remove('hidden');
      }
    },
    resolveIconUrl,
    getMarketPrice: getMarketPriceFor,
  });
}

function openTraderDrawer(trader) {
  _drawerOpener = document.activeElement;
  drawerHistory = [];
  drawerBack.classList.add('hidden');
  _populateTraderDrawer(trader);
  drawer.classList.add('open');
  drawer.removeAttribute('aria-hidden');
  drawerBackdrop.classList.remove('hidden');
  mainEl.classList.add('drawer-open');
  drawerClose.focus();
}

drawerClose.addEventListener('click', closeDrawer);
drawerBackdrop.addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

drawerShare?.addEventListener('click', () => {
  const url = location.href;

  const confirm = () => {
    const icon  = document.getElementById('drawer-share-icon');
    const label = document.getElementById('drawer-share-label');
    drawerShare.classList.add('text-emerald-400');
    icon?.classList.add('hidden');
    label?.classList.remove('hidden');
    setTimeout(() => {
      drawerShare.classList.remove('text-emerald-400');
      icon?.classList.remove('hidden');
      label?.classList.add('hidden');
    }, 1500);
  };

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(url).then(confirm).catch(() => {
      // Clipboard API failed (e.g. non-secure context) — fall back to execCommand
      _clipboardFallback(url);
      confirm();
    });
  } else {
    _clipboardFallback(url);
    confirm();
  }
});

function _clipboardFallback(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
}

drawerBack.addEventListener('click', () => {
  const fn = drawerHistory.pop();
  if (!fn) return;
  fn();
  drawerBack.classList.toggle('hidden', drawerHistory.length === 0);
});

/**
 * Reads a URL hash produced by _populateDrawer or _populateTraderDrawer and opens
 * the matching drawer. Call after data is fully loaded.
 * @param {string} [hashStr] - Hash string to parse; defaults to the current location.hash.
 */
function _tryRestoreFromHash(hashStr = location.hash) {
  const hash = hashStr.startsWith('#') ? hashStr.slice(1) : hashStr;
  if (!hash) return;
  const eqIdx = hash.indexOf('=');
  if (eqIdx === -1) return;
  const type  = hash.slice(0, eqIdx);
  const value = decodeURIComponent(hash.slice(eqIdx + 1));
  if (!value) return;

  if (type === 'item') {
    const id   = Number(value);
    const item = (!isNaN(id) && id > 0)
      ? (lastItemResults?.find(i => i.id === id) ?? rawBlocksCfg?.find(b => b.id === id))
      : (lastItemResults?.find(i => i.name === value) ?? rawBlocksCfg?.find(b => b.name === value));
    if (item) { navigateTo('section-items'); openDrawer(item); }
  } else if (type === 'trader') {
    const trader = rawTradersCfg?.find(t => t.name === value);
    if (trader) { navigateTo('section-trading'); openTraderDrawer(trader); }
  }
}

// ── Items renderer ────────────────────────────────────────────────────────────
const itemsListContainer = document.getElementById('items-grid');
const itemListRenderer   = new ItemListRenderer();
// ── Trading renderer ──────────────────────────────────────────────
const tradersListContainer = document.getElementById('traders-list-container');
const traderRenderer = new TraderRenderer();
/** Last parsed items — kept so the grid can be re-rendered when localization loads. */
let lastItemResults = null;
/** Raw results from ItemsConfig.ecf and BlocksConfig.ecf — merged into lastItemResults. */
let rawItemsCfg     = null;
let rawBlocksCfg    = null;
/** Map<name, Template> from Templates.ecf — keyed by template devName. */
let rawTemplatesCfg = null;
/** TraderNPC[] from TraderNPCConfig.ecf. */
let rawTradersCfg   = null;
/** Token[] from TokenConfig.ecf. */
let rawTokensCfg    = null;

/**
 * Merges rawItemsCfg and rawBlocksCfg into a single visible-items list.
 * Variant blocks (listed as ChildBlocks of another block) are excluded.
 */
function mergeItemResults() {
  const items  = rawItemsCfg  ?? [];
  const blocks = rawBlocksCfg ?? [];
  const variantNames   = new Set(blocks.flatMap(b => b.childBlocks ?? []));
  const filteredBlocks = blocks.filter(b => !variantNames.has(b.name));
  return [...items, ...filteredBlocks].filter(i => i.showUser !== false);
}

// ── Filter state ─────────────────────────────────────────────────────────────
let searchQuery    = '';
let activeCategory = null;
let activeVessel   = null;
let sortBy         = 'id';
let sortDir        = 'asc';
let minPrice       = 0;
let _searchDebounce   = null;
let _minPriceDebounce = null;
let tradingSearch         = '';
let _tradingSearchDebounce = null;
let npcSellMax            = 0;
let _npcSellMaxDebounce   = null;
let npcBuyMin             = 0;
let _npcBuyMinDebounce    = null;
let tradingView           = 'traders'; // 'traders' | 'opportunities'
let tradingShow           = 'all';    // 'all' | 'sells' | 'buys'
let tradingSort           = 'default'; // 'default' | 'max-credit' | 'max-sell-price' | 'max-qty'

function updateSortDirBtn() {
  const btn = document.getElementById('sort-dir-btn');
  if (btn) btn.textContent = sortDir === 'asc' ? '↑' : '↓';
}

/** Re-renders the items grid applying the current search, category, sort, and price filters. */
function rerenderItems() {
  if (!lastItemResults) return;
  const q = searchQuery.trim().toLowerCase();
  const VESSEL_TO_ECF = { BA: 'Base', CV: 'MS', SV: 'SS', HV: 'GV' };
  let filtered = lastItemResults.filter(item => {
    if (activeCategory && item.category !== activeCategory) return false;
    if (minPrice > 0 && (item.marketPrice == null || item.marketPrice < minPrice)) return false;
    if (activeVessel) {
      const ecfVal = VESSEL_TO_ECF[activeVessel];
      const allowProp = item.properties?.find(p => p.key === 'AllowPlacingAt')?.value;
      if (!allowProp) return false;
      const vals = String(allowProp).split(',').map(s => s.trim());
      if (!vals.includes(ecfVal)) return false;
    }
    if (q) {
      const name = resolveDisplayName(item.name ?? '').toLowerCase();
      if (name.includes(q)) return true;
      const infoKey = item.properties.find(p => p.key === 'Info')?.value;
      const info    = infoKey ? resolveDisplayName(String(infoKey)).toLowerCase() : '';
      if (!info.includes(q)) return false;
    }
    return true;
  });

  // Sort
  if (sortBy === 'name') {
    filtered.sort((a, b) =>
      resolveDisplayName(a.name ?? '').localeCompare(resolveDisplayName(b.name ?? '')));
  } else if (sortBy === 'price') {
    filtered.sort((a, b) => (a.marketPrice ?? -1) - (b.marketPrice ?? -1));
  } else {
    filtered.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
  }
  if (sortDir === 'desc') filtered.reverse();

  // When searching, stable-partition after sort: name matches first, info-only matches after
  if (q) {
    const nameMatches = filtered.filter(item =>
      resolveDisplayName(item.name ?? '').toLowerCase().includes(q));
    const infoOnly = filtered.filter(item =>
      !resolveDisplayName(item.name ?? '').toLowerCase().includes(q));
    filtered = [...nameMatches, ...infoOnly];
  }

  // Update the filter result indicator (only visible when filters narrow the results)
  const countEl = document.getElementById('items-result-count');
  if (countEl) {
    const isFiltered = filtered.length !== lastItemResults.length;
    countEl.textContent = isFiltered ? `${filtered.length} / ${lastItemResults.length}` : '';
    countEl.classList.toggle('hidden', !isFiltered);
  }
  itemListRenderer.render(filtered, itemsListContainer, openDrawer, resolveDisplayNameHtml, resolveIconUrl);
}

/**
 * Returns the market price for an item/block by devName, or null if unknown.
 * Also checks rawTokensCfg when the devName is a resolved token name.
 * @param {string} devName
 */
function getMarketPriceFor(devName) {
  const price = lastItemResults?.find(i => i.name === devName)?.marketPrice ?? null;
  if (price != null) return price;
  return rawTokensCfg?.find(t => t.name === devName)?.marketPrice ?? null;
}

// ── Token item resolution ─────────────────────────────────────────────

/**
 * Returns the numeric token ID from a "Token:N" devName, or null for regular items.
 * @param {string} devName
 * @returns {number|null}
 */
function parseTokenRef(devName) {
  const m = String(devName || '').match(/^Token:(\d+)$/i);
  return m ? Number(m[1]) : null;
}

/**
 * Resolves a "Token:N" devName to the matching token's name.
 * - Known token  → returns token.name (e.g. "CredTokenUCH")
 * - Unknown token → returns null (should be hidden from UI)
 * - Regular item  → returns devName unchanged
 * @param {string} devName
 * @returns {string|null}
 */
function resolveTraderItemDevName(devName) {
  const tokenId = parseTokenRef(devName);
  if (tokenId === null) return devName;
  const token = rawTokensCfg?.find(t => t.id === tokenId);
  return token ? token.name : null;
}

/**
 * Synthesizes an Item-like object for the given token name so it can be passed
 * to openDrawer / ItemDetailRenderer. Uses the base "Token" item as a template,
 * overriding id, name, and marketPrice with the specific token's values.
 * Returns null if the token or the base "Token" item cannot be found.
 * @param {string} tokenName - e.g. "CredTokenUCH"
 * @returns {object|null}
 */
function makeTokenSyntheticItem(tokenName) {
  const token = rawTokensCfg?.find(t => t.name === tokenName);
  if (!token) return null;
  const baseItem = lastItemResults?.find(i => i.name === 'Token');
  if (!baseItem) return null;
  return { ...baseItem, id: token.id, name: token.name, marketPrice: token.marketPrice ?? baseItem.marketPrice };
}

/**
 * Normalizes token devNames within a trader item list:
 * - "Token:N" with a known token → devName replaced with token.name
 * - "Token:N" with an unknown token → filtered out
 * - Regular items → unchanged
 * @param {Array} items
 * @returns {Array}
 */
function normalizeTokenItems(items) {
  return items
    .map(item => {
      const resolved = resolveTraderItemDevName(item.devName);
      if (resolved === null) return null;
      if (resolved === item.devName) return item;
      return { ...item, devName: resolved };
    })
    .filter(Boolean);
}

/**
 * Returns a version of the trader with "Token:N" devNames resolved.
 * Known tokens are replaced with their token.name; unknown ones are filtered out.
 * The original trader object is never mutated.
 * @param {import('./parsers/models/TraderNPC.js').TraderNPC} trader
 * @returns {import('./parsers/models/TraderNPC.js').TraderNPC}
 */
function normalizeTraderTokens(trader) {
  const hasTokenRefs = items => items.some(i => parseTokenRef(i.devName) !== null);
  if (!hasTokenRefs(trader.sellingItems) && !hasTokenRefs(trader.buyingItems)) return trader;
  return {
    ...trader,
    sellingItems: normalizeTokenItems(trader.sellingItems),
    buyingItems:  normalizeTokenItems(trader.buyingItems),
  };
}

/** Re-renders the traders grid applying the current trading search filter. */
function rerenderTraders() {
  if (!rawTradersCfg) return;
  const tradersEl = document.getElementById('traders-list-container');
  const oppsEl    = document.getElementById('opportunities-container');
  const heading   = document.getElementById('trading-heading');
  const isOpps    = tradingView === 'opportunities';
  tradersEl?.classList.toggle('hidden', isOpps);
  oppsEl?.classList.toggle('hidden', !isOpps);
  if (heading) heading.textContent = isOpps ? 'Trade Opportunities' : 'Trading';

  if (isOpps) {
    renderOpportunities();
    return;
  }

  // Traders view
  // Always exclude traders that have no items at all
  const baseTraders = rawTradersCfg.filter(t => t.sellingItems.length > 0 || t.buyingItems.length > 0);

  // Apply show-direction filter
  let filtered = tradingShow === 'sells' ? baseTraders.filter(t => t.sellingItems.length > 0)
               : tradingShow === 'buys'  ? baseTraders.filter(t => t.buyingItems.length > 0)
               : baseTraders;

  // Apply search
  const q = tradingSearch.trim().toLowerCase();
  if (q) {
    filtered = filtered.filter(trader => {
      const name = (resolveDisplayName(trader.name ?? '') ?? '').toLowerCase();
      if (name.includes(q)) return true;
      return [...trader.sellingItems, ...trader.buyingItems].some(item =>
        (resolveDisplayName(item.devName ?? '') ?? '').toLowerCase().includes(q)
      );
    });
  }

  // Apply trader-level sort
  if (tradingSort !== 'default') {
    const traderScore = (trader) => {
      if (tradingSort === 'max-credit') {
        return Math.max(0, ...trader.buyingItems.map(item => {
          const r = estimatePriceRange(item.buyMfRange, getMarketPriceFor(item.devName));
          const q = parseQtyRange(item.buyQtyRange);
          return (r && q) ? q.hi * r.hi : 0;
        }));
      }
      if (tradingSort === 'max-sell-price') {
        return Math.max(0, ...trader.sellingItems.map(item => {
          const r = estimatePriceRange(item.sellMfRange, getMarketPriceFor(item.devName));
          return r ? r.hi : 0;
        }));
      }
      if (tradingSort === 'max-qty') {
        const items = tradingShow === 'sells' ? trader.sellingItems
                    : tradingShow === 'buys'  ? trader.buyingItems
                    : [...trader.sellingItems, ...trader.buyingItems];
        return Math.max(0, ...items.map(item => {
          const qty = tradingShow === 'sells' ? item.sellQtyRange : item.buyQtyRange;
          const q = parseQtyRange(qty);
          return q ? q.hi : 0;
        }));
      }
      return 0;
    };
    filtered = [...filtered].sort((a, b) => traderScore(b) - traderScore(a));
  }
  const countEl = document.getElementById('trading-result-count');
  if (countEl) {
    const isFiltered = filtered.length !== baseTraders.length;
    countEl.textContent = isFiltered ? `${filtered.length} / ${baseTraders.length}` : '';
    countEl.classList.toggle('hidden', !isFiltered);
  }
  const filteredNormalized = filtered.map(normalizeTraderTokens);
  traderRenderer.render(filteredNormalized, tradersListContainer, {
    resolveLocalized: resolveDisplayNameHtml,
    onItemClick: (devName) => {
      const target = makeTokenSyntheticItem(devName)
        ?? lastItemResults?.find(i => i.name === devName)
        ?? rawBlocksCfg?.find(b => b.name === devName);
      if (target) openDrawer(target);
    },
    resolveIconUrl,
    npcSellMax,
    npcBuyMin,
    getMarketPrice: getMarketPriceFor,
    tradingShow,
    onTraderClick: (traderName) => {
      const trader = rawTradersCfg?.find(t => t.name === traderName);
      if (trader) openTraderDrawer(trader);
    },
    itemSearchQuery: tradingSearch.trim().toLowerCase(),
  });
}

/**
 * Builds the list of tradeable opportunities: items that at least one trader sells to the player
 * AND at least one trader buys from the player, with an estimated profit.
 * Returns items sorted by estimated profit descending (unknown profits sorted last).
 * @returns {Array}
 */
function buildOpportunities() {
  if (!rawTradersCfg) return [];

  // sellMap: devName -> [{traderName, priceRange, qtyRange}]  (trader sells to you)
  // buyMap:  devName -> [{traderName, priceRange, qtyRange}]  (trader buys from you)
  const sellMap = new Map();
  const buyMap  = new Map();

  for (const rawTrader of rawTradersCfg) {
    const tName  = resolveDisplayName(rawTrader.name ?? '') || rawTrader.name || 'Unknown';
    const trader = normalizeTraderTokens(rawTrader);
    for (const item of trader.sellingItems) {
      const mp    = getMarketPriceFor(item.devName);
      const range = estimatePriceRange(item.sellMfRange, mp);
      const qty   = parseQtyRange(item.sellQtyRange);
      if (!sellMap.has(item.devName)) sellMap.set(item.devName, []);
      sellMap.get(item.devName).push({ traderName: tName, priceRange: range, qtyRange: qty });
    }
    for (const item of trader.buyingItems) {
      const mp    = getMarketPriceFor(item.devName);
      const range = estimatePriceRange(item.buyMfRange, mp);
      const qty   = parseQtyRange(item.buyQtyRange);
      if (!buyMap.has(item.devName)) buyMap.set(item.devName, []);
      buyMap.get(item.devName).push({ traderName: tName, priceRange: range, qtyRange: qty });
    }
  }

  // Keep only items that exist in both sellMap AND buyMap
  const results = [];
  for (const [devName, sellers] of sellMap) {
    if (!buyMap.has(devName)) continue;
    const buyers = buyMap.get(devName);

    // Best per-unit buy price (for display)
    const buyPrices = sellers.map(s => s.priceRange?.lo).filter(v => v != null);
    const bestBuyLo = buyPrices.length ? Math.min(...buyPrices) : null;

    // Best per-unit sell price (for display)
    const sellPrices = buyers.map(b => b.priceRange?.hi).filter(v => v != null);
    const bestSellHi = sellPrices.length ? Math.max(...sellPrices) : null;

    // Find the (seller, buyer) pair that maximises total profit:
    //   tradable qty  = min(seller.qtyHi, buyer.qtyHi)
    //   per-unit gain = buyer.priceHi - seller.priceLo
    //   total profit  = tradable qty × per-unit gain
    let bestTotalProfit = null;
    let bestQty = null;
    for (const seller of sellers) {
      for (const buyer of buyers) {
        if (!seller.priceRange || !buyer.priceRange) continue;
        const sellerQtyHi = seller.qtyRange?.hi ?? 1;
        const buyerQtyHi  = buyer.qtyRange?.hi ?? 1;
        const tradableQty = Math.min(sellerQtyHi, buyerQtyHi);
        const perUnit     = buyer.priceRange.hi - seller.priceRange.lo;
        const total       = tradableQty * perUnit;
        if (bestTotalProfit == null || total > bestTotalProfit) {
          bestTotalProfit = total;
          bestQty = tradableQty;
        }
      }
    }

    // Fall back to one-sided reference price when we can't compute a full pair
    const estProfit = bestTotalProfit ?? (bestSellHi ?? bestBuyLo);

    // Skip rows where we have no price data at all
    if (bestBuyLo == null && bestSellHi == null) continue;

    results.push({ devName, sellers, buyers, bestBuyLo, bestSellHi, bestQty, estProfit });
  }

  // Sort by estimated profit descending; unknown profits at the bottom
  results.sort((a, b) => {
    if (a.estProfit == null && b.estProfit == null) return 0;
    if (a.estProfit == null) return 1;
    if (b.estProfit == null) return -1;
    return b.estProfit - a.estProfit;
  });

  return results;
}

/**
 * Renders the trade opportunities list into #opportunities-container.
 */
function renderOpportunities() {
  const el = document.getElementById('opportunities-container');
  if (!el) return;

  const opps = buildOpportunities();

  if (!opps.length) {
    el.innerHTML = '<p class="text-xs text-slate-700 text-center py-20 italic select-none">No tradeable items found. Make sure at least one trader buys and sells the same item.</p>';
    return;
  }

  const fmtPrice  = (v) => v != null ? v.toLocaleString() + ' cr' : '\u2014';
  const fmtProfit = (v, hasQty) => {
    if (v == null) return '\u2014';
    const sign = v >= 0 ? '+' : '';
    const cr = sign + v.toLocaleString() + ' cr';
    return hasQty ? cr : cr + '\u2009*';
  };

  const rows = opps.map(opp => {
    const displayName = resolveDisplayNameHtml(opp.devName) || escapeHtml(opp.devName);
    const hasFullPair = opp.bestQty != null;
    const profitCls   = opp.estProfit == null ? 'text-slate-500'
      : opp.estProfit > 0 ? 'text-emerald-400 font-semibold' : 'text-red-400';

    const sellerTips = opp.sellers.map(s => {
      const qty = s.qtyRange ? `\u00d7${s.qtyRange.lo === s.qtyRange.hi ? s.qtyRange.lo : s.qtyRange.lo + '\u2013' + s.qtyRange.hi}` : '';
      const price = s.priceRange ? s.priceRange.lo.toLocaleString() + '\u2013' + s.priceRange.hi.toLocaleString() + ' cr' : '';
      return escapeHtml(`${s.traderName}${qty ? ' ' + qty : ''}${price ? ': ' + price : ''}`);
    }).join(', ');
    const buyerTips = opp.buyers.map(b => {
      const qty = b.qtyRange ? `\u00d7${b.qtyRange.lo === b.qtyRange.hi ? b.qtyRange.lo : b.qtyRange.lo + '\u2013' + b.qtyRange.hi}` : '';
      const price = b.priceRange ? b.priceRange.lo.toLocaleString() + '\u2013' + b.priceRange.hi.toLocaleString() + ' cr' : '';
      return escapeHtml(`${b.traderName}${qty ? ' ' + qty : ''}${price ? ': ' + price : ''}`);
    }).join(', ');
    const qtyStr = hasFullPair ? opp.bestQty.toLocaleString() : '\u2014';

    return `<tr class="border-b border-zinc-800/50 hover:bg-zinc-800/20 transition-colors">
  <td class="py-2 px-4 text-xs">
    <button data-opp-item="${escapeHtml(opp.devName)}" class="text-blue-400 hover:text-blue-300 hover:underline text-left transition-colors">${displayName}</button>
  </td>
  <td class="py-2 px-4 text-xs text-slate-300 text-right" title="${sellerTips}">${fmtPrice(opp.bestBuyLo)}</td>
  <td class="py-2 px-4 text-xs text-slate-300 text-right" title="${buyerTips}">${fmtPrice(opp.bestSellHi)}</td>
  <td class="py-2 px-4 text-xs text-amber-600 text-right tabular-nums">${escapeHtml(qtyStr)}</td>
  <td class="py-2 px-4 text-xs text-right tabular-nums ${profitCls}">${fmtProfit(opp.estProfit, hasFullPair)}</td>
</tr>`;
  }).join('');

  el.innerHTML = `<div class="max-w-3xl">
<p class="text-[11px] text-slate-600 mb-3 px-1">Items tradeable between different traders. Profit = tradable quantity &times; (best sell price &minus; best buy price), using the (seller, buyer) pair that maximises total earnings. Hover a price to see which traders and their stock. Prices use market value where available. * = per-unit estimate only (qty unavailable).</p>
<table class="w-full border-collapse">
  <thead>
    <tr class="border-b border-zinc-700">
      <th class="py-2 px-4 text-[10px] text-slate-500 uppercase tracking-wide text-left font-semibold">Item</th>
      <th class="py-2 px-4 text-[10px] text-slate-500 uppercase tracking-wide text-right font-semibold">Best buy from</th>
      <th class="py-2 px-4 text-[10px] text-slate-500 uppercase tracking-wide text-right font-semibold">Best sell to</th>
      <th class="py-2 px-4 text-[10px] text-amber-800 uppercase tracking-wide text-right font-semibold">Vol.</th>
      <th class="py-2 px-4 text-[10px] text-slate-500 uppercase tracking-wide text-right font-semibold">Est. total profit</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>
</div>`;
}

/** Builds category pill buttons from the loaded items and wires their click handlers. */
function buildCategoryPills(items) {
  const categories = [...new Set(items.map(i => i.category).filter(Boolean))].sort();
  const container  = document.getElementById('category-pills');
  container.innerHTML = '';
  for (const cat of categories) {
    const btn = document.createElement('button');
    btn.className        = 'category-pill';
    btn.textContent      = cat;
    btn.dataset.category = cat;
    btn.addEventListener('click', () => {
      activeCategory = (activeCategory === cat) ? null : cat;
      container.querySelectorAll('.category-pill').forEach(b =>
        b.classList.toggle('active', b.dataset.category === activeCategory));
      closeDrawer();
      rerenderItems();
    });
    container.appendChild(btn);
  }
}

// ── Load helpers ──────────────────────────────────────────────────────────────

/**
 * Parses a Localization.csv File and stores the result in localizationMap.
 * Updates the loc-status element and re-renders the items grid if already loaded.
 * @param {File} file
 */
async function applyLocalization(file) {
  const text = await file.text();
  localizationMap = new LocalizationParser().parse(text);

  if (lastItemResults) {
    closeDrawer();
    rerenderItems();
  }
  if (rawTradersCfg) rerenderTraders();
  updateExportStatus();
}

/**
 * Parses an ECF file and populates the correct section.
 * @param {File} file
 * @param {HTMLElement} sectionEl
 * @returns {Promise<boolean>} true on success
 */
async function loadEcfIntoSection(file, sectionEl) {
  const errorEl   = sectionEl.querySelector('.error-msg');
  const statsRow  = sectionEl.querySelector('.stats-row');
  const statFile  = sectionEl.querySelector('.stat-file');
  const statCount = sectionEl.querySelector('.stat-count');

  errorEl.classList.add('hidden');

  let parser;
  try {
    parser = ParserFactory.getParser(file.name);
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
    statsRow.classList.add('hidden');
    return false;
  }

  const text    = await file.text();
  const results = parser.parse(text);

  statFile.textContent  = file.name;
  statCount.textContent = results.length;
  statsRow.classList.remove('hidden');

  if (sectionEl.id === 'section-items') {
    closeDrawer();

    // Store into the correct raw source, then merge both into lastItemResults
    if (file.name === 'BlocksConfig.ecf') {
      rawBlocksCfg = results;
    } else {
      rawItemsCfg = results;
    }
    lastItemResults = mergeItemResults();

    // Update stats to reflect merged total
    statCount.textContent = lastItemResults.length;
    if (rawItemsCfg && rawBlocksCfg) {
      statFile.textContent = 'ItemsConfig.ecf + BlocksConfig.ecf';
    }

    // Reset filter/sort state whenever a new file is loaded
    searchQuery    = '';
    activeCategory = null;
    sortBy         = 'id';
    sortDir        = 'asc';
    minPrice       = 0;
    const searchEl = document.getElementById('items-search');
    if (searchEl) searchEl.value = '';
    const minPriceEl = document.getElementById('min-price');
    if (minPriceEl) minPriceEl.value = '';
    updateSortDirBtn();
    document.querySelectorAll('.sort-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.sort === sortBy));
    // Build category pills and reveal toolbar
    buildCategoryPills(lastItemResults);
    document.getElementById('items-toolbar').classList.remove('hidden');
    const countEl = document.getElementById('items-result-count');
    if (countEl) countEl.classList.add('hidden');
    itemListRenderer.render(lastItemResults, itemsListContainer, openDrawer, resolveDisplayNameHtml, resolveIconUrl);
    updateExportStatus();
  } else if (sectionEl.id === 'section-trading') {
    rawTradersCfg = results;
    rerenderTraders();
    updateExportStatus();
  } else {
    const outputEl = sectionEl.querySelector('.output');
    if (outputEl) outputEl.textContent = JSON.stringify(results, null, 2);
  }
  return true;
}

// ── Scenario import ───────────────────────────────────────────────────────────

/**
 * Parses a Templates.ecf file and stores the results as a lookup map by name.
 * @param {File} file
 */
async function loadTemplatesFile(file) {
  const text    = await file.text();
  const parser  = new TemplatesConfigParser();
  const results = parser.parse(text);
  rawTemplatesCfg = new Map(results.map(t => [t.name, t]));
  updateExportStatus();
}

/**
 * Parses a TokenConfig.ecf file and stores the results in rawTokensCfg.
 * @param {File} file
 */
async function loadTokensFile(file) {
  const text    = await file.text();
  const results = ParserFactory.getParser('TokenConfig.ecf').parse(text);
  rawTokensCfg  = results;
}

/**
 * Finds a file in the selected FileList by matching a path suffix.
 * e.g. findInScenario(files, 'Extras', 'Localization.csv')
 * @param {File[]} files
 * @param {...string} segments
 * @returns {File|undefined}
 */
function findInScenario(files, ...segments) {
  const suffix = '/' + segments.join('/').toLowerCase();
  return files.find(f =>
    f.webkitRelativePath.replace(/\\/g, '/').toLowerCase().endsWith(suffix)
  );
}

document.getElementById('scenario-input').addEventListener('change', async (e) => {
  const files = Array.from(e.target.files);
  if (!files.length) return;

  // Save hash now — file loads trigger closeDrawer which would clear it
  const pendingHash = location.hash;

  const scenarioName = files[0].webkitRelativePath.split('/')[0];
  const nameEl = document.getElementById('scenario-name');
  nameEl.textContent = scenarioName;
  nameEl.classList.remove('hidden');

  const locFile       = findInScenario(files, 'Extras', 'Localization.csv');
  const itemsFile     = findInScenario(files, 'Content', 'Configuration', 'ItemsConfig.ecf');
  const blocksFile    = findInScenario(files, 'Content', 'Configuration', 'BlocksConfig.ecf');
  const traderFile    = findInScenario(files, 'Content', 'Configuration', 'TraderNPCConfig.ecf');
  const templatesFile = findInScenario(files, 'Content', 'Configuration', 'Templates.ecf');
  const tokenFile     = findInScenario(files, 'Content', 'Configuration', 'TokenConfig.ecf');

  buildIconMap(files);

  // Reset raw item sources for a clean scenario load
  rawItemsCfg     = null;
  rawBlocksCfg    = null;
  rawTemplatesCfg = null;
  rawTokensCfg    = null;

  // Localization must load first so item names resolve correctly on render
  if (locFile) await applyLocalization(locFile);

  // Load items-section files sequentially to avoid state conflicts
  const itemsSectionEl = document.getElementById('section-items');
  if (itemsFile)     await loadEcfIntoSection(itemsFile,  itemsSectionEl);
  if (blocksFile)    await loadEcfIntoSection(blocksFile, itemsSectionEl);
  if (traderFile)    await loadEcfIntoSection(traderFile, document.getElementById('section-trading'));
  if (templatesFile) await loadTemplatesFile(templatesFile);
  if (tokenFile)     await loadTokensFile(tokenFile);

  // Auto-save to browser cache
  await persistScenario(await buildExportPayload());
  renderSavedScenarios();

  // Auto-navigate: prefer items, fall back to trading
  if (itemsFile || blocksFile) navigateTo('section-items');
  else if (traderFile)         navigateTo('section-trading');

  _tryRestoreFromHash(pendingHash);
});

// ── Individual file loading ───────────────────────────────────────────────────
document.getElementById('localization-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  await applyLocalization(file);
});

document.querySelectorAll('.file-input').forEach(input => {
  input.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const navTarget = e.target.dataset.nav;
    const sectionEl = navTarget
      ? document.getElementById(navTarget)
      : e.target.closest('.section-panel');
    const ok = await loadEcfIntoSection(file, sectionEl);
    if (ok && navTarget) navigateTo(navTarget);
  });
});

document.getElementById('templates-input')?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  await loadTemplatesFile(file);
});

// ── Search & filter wiring ────────────────────────────────────────────────────
document.getElementById('items-search').addEventListener('input', (e) => {
  clearTimeout(_searchDebounce);
  _searchDebounce = setTimeout(() => {
    searchQuery = e.target.value;
    rerenderItems();
  }, 150);
});

document.querySelectorAll('.vessel-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const v = btn.dataset.vessel;
    activeVessel = (activeVessel === v) ? null : v;
    document.querySelectorAll('.vessel-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.vessel === activeVessel));
    rerenderItems();
  });
});

// ── Sort & price filter wiring ────────────────────────────────────────────────
document.querySelectorAll('.sort-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const s = btn.dataset.sort;
    if (sortBy === s) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortBy = s;
      sortDir = 'asc';
    }
    document.querySelectorAll('.sort-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.sort === sortBy));
    updateSortDirBtn();
    rerenderItems();
  });
});

document.getElementById('sort-dir-btn')?.addEventListener('click', () => {
  sortDir = sortDir === 'asc' ? 'desc' : 'asc';
  updateSortDirBtn();
  rerenderItems();
});

document.getElementById('min-price')?.addEventListener('input', (e) => {
  clearTimeout(_minPriceDebounce);
  _minPriceDebounce = setTimeout(() => {
    minPrice = Number(e.target.value) || 0;
    rerenderItems();
  }, 300);
});

document.getElementById('trading-search')?.addEventListener('input', (e) => {
  clearTimeout(_tradingSearchDebounce);
  _tradingSearchDebounce = setTimeout(() => {
    tradingSearch = e.target.value;
    rerenderTraders();
  }, 150);
});

document.getElementById('trading-npc-sell-max')?.addEventListener('input', (e) => {
  clearTimeout(_npcSellMaxDebounce);
  _npcSellMaxDebounce = setTimeout(() => {
    npcSellMax = Number(e.target.value) || 0;
    rerenderTraders();
  }, 300);
});

document.getElementById('trading-npc-buy-min')?.addEventListener('input', (e) => {
  clearTimeout(_npcBuyMinDebounce);
  _npcBuyMinDebounce = setTimeout(() => {
    npcBuyMin = Number(e.target.value) || 0;
    rerenderTraders();
  }, 300);
});

document.querySelectorAll('[data-trading-view]').forEach(btn => {
  btn.addEventListener('click', () => {
    tradingView = btn.dataset.tradingView;
    document.querySelectorAll('[data-trading-view]').forEach(b =>
      b.classList.toggle('active', b.dataset.tradingView === tradingView));
    rerenderTraders();
  });
});

document.querySelectorAll('[data-trading-show]').forEach(btn => {
  btn.addEventListener('click', () => {
    tradingShow = btn.dataset.tradingShow;
    document.querySelectorAll('[data-trading-show]').forEach(b =>
      b.classList.toggle('active', b.dataset.tradingShow === tradingShow));
    rerenderTraders();
  });
});

document.getElementById('trading-sort')?.addEventListener('change', e => {
  tradingSort = /** @type {HTMLSelectElement} */ (e.target).value;
  rerenderTraders();
});

// Wire delegated click for opportunities table (once, container lives forever)
document.getElementById('opportunities-container')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-opp-item]');
  if (!btn) return;
  const target = makeTokenSyntheticItem(btn.dataset.oppItem)
    ?? lastItemResults?.find(i => i.name === btn.dataset.oppItem)
    ?? rawBlocksCfg?.find(b => b.name === btn.dataset.oppItem);
  if (target) openDrawer(target);
});

// ── Scenarios: export & import ────────────────────────────────────────────────

/**
 * Updates the export button enabled state and status text based on currently loaded data.
 */
function updateExportStatus() {
  const btn    = document.getElementById('export-btn');
  const status = document.getElementById('export-status');
  if (!btn || !status) return;
  const hasData = !!(rawItemsCfg || rawBlocksCfg || rawTradersCfg || rawTemplatesCfg || localizationMap);
  btn.disabled = !hasData;
  const heroLabel = document.getElementById('hero-load-status');
  if (hasData) {
    const parts = [];
    const itemCount = lastItemResults?.length ?? 0;
    if (itemCount)           parts.push(`${itemCount} items`);
    if (rawTradersCfg?.length) parts.push(`${rawTradersCfg.length} traders`);
    if (rawTemplatesCfg?.size) parts.push(`${rawTemplatesCfg.size} templates`);
    if (localizationMap?.size)  parts.push(`${localizationMap.size} locale entries`);
    status.textContent = parts.length ? parts.join(', ') : 'Ready to export';
    if (heroLabel) {
      const name = document.getElementById('scenario-name')?.textContent?.trim();
      heroLabel.textContent = name || 'Data loaded';
      heroLabel.className = 'text-sm tracking-widest uppercase text-amber-400';
    }
  } else {
    status.textContent = 'No data loaded';
    if (heroLabel) {
      heroLabel.textContent = 'No data loaded';
      heroLabel.className = 'text-sm tracking-widest uppercase';
    }
  }
  updateNavState();
}

document.getElementById('export-btn')?.addEventListener('click', async () => {
  const data = await buildExportPayload();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `${data.scenarioName || 'empyrion'}.empcdx`;
  a.click();
  URL.revokeObjectURL(url);
});

/**
 * Builds the full .empcdx-format payload from current application state.
 * Encodes File icons to base64 data URLs.
 * @returns {Promise<object>}
 */
async function buildExportPayload() {
  const scenarioName = document.getElementById('scenario-name')?.textContent?.trim() || null;
  const icons = {};
  if (iconFileMap.size > 0) {
    await Promise.all([...iconFileMap.entries()].map(async ([name, file]) => {
      icons[name] = await fileToDataUrl(file);
    }));
  } else {
    for (const [k, v] of iconDataMap) icons[k] = v;
  }
  return {
    version:      1,
    scenarioName: scenarioName || null,
    items:        rawItemsCfg   ?? [],
    blocks:       rawBlocksCfg  ?? [],
    traders:      rawTradersCfg ?? [],
    tokens:       rawTokensCfg  ?? [],
    templates:    rawTemplatesCfg ? [...rawTemplatesCfg.values()] : [],
    localization: localizationMap  ? Object.fromEntries(localizationMap)  : {},
    icons,
  };
}

/**
 * Silently persists a .empcdx payload to IndexedDB (never throws to the caller).
 * @param {object} payload
 */
async function persistScenario(payload) {
  try {
    const name = payload.scenarioName ?? 'Unnamed Scenario';
    // Delete any existing scenario with the same name (keep only the latest)
    const existing = await db.listScenarios();
    for (const s of existing) {
      if (s.name === name) await db.deleteScenario(s.id);
    }
    await db.saveScenario({
      name,
      savedAt:      new Date().toISOString(),
      itemCount:    (payload.items?.length ?? 0) + (payload.blocks?.length ?? 0),
      traderCount:  payload.traders?.length ?? 0,
      data:         payload,
    });
  } catch (err) {
    console.warn('Failed to cache scenario in browser storage:', err);
  }
}

/**
 * Applies a parsed .empcdx data payload to the application state.
 * @param {object} data
 */
async function applyEmpdbData(data) {
  if (!data || data.version !== 1) throw new Error('Unrecognised file format (expected version 1).');

  // Save hash before closeDrawer (called below) clears it
  const pendingHash = location.hash;

  rawItemsCfg     = data.items?.length    ? data.items    : null;
  rawBlocksCfg    = data.blocks?.length   ? data.blocks   : null;
  rawTradersCfg   = data.traders?.length  ? data.traders  : null;
  rawTokensCfg    = data.tokens?.length    ? data.tokens   : null;
  rawTemplatesCfg = data.templates?.length
    ? new Map(data.templates.map(t => [t.name, t]))
    : null;
  localizationMap = data.localization && Object.keys(data.localization).length
    ? new Map(Object.entries(data.localization))
    : null;

  iconDataMap = data.icons && Object.keys(data.icons).length
    ? new Map(Object.entries(data.icons))
    : new Map();
  // Clear stale file handles so buildExportPayload uses iconDataMap
  iconFileMap = new Map();

  if (data.scenarioName) {
    const nameEl = document.getElementById('scenario-name');
    nameEl.textContent = data.scenarioName;
    nameEl.classList.remove('hidden');
  }

  // Rebuild lastItemResults from restored raw sources
  if (rawItemsCfg || rawBlocksCfg) {
    lastItemResults = mergeItemResults();
    buildCategoryPills(lastItemResults);
    document.getElementById('items-toolbar').classList.remove('hidden');
  }

  updateExportStatus();
  closeDrawer();
  if (lastItemResults?.length)  { rerenderItems();   navigateTo('section-items');   }
  if (rawTradersCfg?.length)    { rerenderTraders(); if (!lastItemResults?.length) navigateTo('section-trading'); }
  _tryRestoreFromHash(pendingHash);
}

document.getElementById('empdb-input')?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    await applyEmpdbData(data);
    await persistScenario(data);
    renderSavedScenarios();
  } catch (err) {
    alert(`Failed to import: ${err.message}`);
  }
  // reset so the same file can be re-imported
  e.target.value = '';
});

// ── Scroll-to-top buttons ─────────────────────────────────────────────────────
[
  { btn: 'items-scroll-top',   containers: ['items-list-container'] },
  { btn: 'trading-scroll-top', containers: ['traders-list-container', 'opportunities-container'] },
].forEach(({ btn, containers }) => {
  const btnEl = document.getElementById(btn);
  if (!btnEl) return;
  const containerEls = containers.map(id => document.getElementById(id)).filter(Boolean);
  const update = () => {
    const scrolled = containerEls.some(el => el.scrollTop > 300);
    btnEl.classList.toggle('visible', scrolled);
  };
  containerEls.forEach(el => el.addEventListener('scroll', update, { passive: true }));
  btnEl.addEventListener('click', () => {
    const active = containerEls.find(el => !el.classList.contains('hidden')) ?? containerEls[0];
    active.scrollTo({ top: 0, behavior: 'smooth' });
  });
});

// ── Saved scenarios list ──────────────────────────────────────────────────────

/** Renders the saved scenarios list into #saved-scenarios-list. */
async function renderSavedScenarios() {
  const el = document.getElementById('saved-scenarios-list');
  if (!el) return;
  let scenarios;
  try {
    scenarios = await db.listScenarios();
  } catch {
    el.innerHTML = '<p class="text-xs text-red-500 italic">Failed to access browser storage.</p>';
    return;
  }
  scenarios.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
  if (!scenarios.length) {
    el.innerHTML = '<p class="text-xs text-zinc-600 italic">No saved scenarios yet. Load a scenario folder or import a .empcdx file — it will be cached automatically.</p>';
    return;
  }
  el.innerHTML = scenarios.map(s => {
    const date = new Date(s.savedAt).toLocaleString();
    const meta = [s.itemCount ? `${s.itemCount} items` : null, s.traderCount ? `${s.traderCount} traders` : null].filter(Boolean).join(' · ');
    return `<div class="flex flex-wrap items-center gap-x-4 gap-y-2 py-3.5 border-b border-zinc-800/60 last:border-0">
  <div class="flex-1 min-w-0" style="min-width:8rem">
    <p class="text-sm font-semibold text-white truncate">${escapeHtml(s.name ?? '')}</p>
    <p class="text-[11px] text-zinc-500 mt-0.5">${meta ? meta + ' · ' : ''}Saved ${escapeHtml(date)}</p>
  </div>
  <button data-load-scenario="${s.id}" class="shrink-0 text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors">Load</button>
  <button data-delete-scenario="${s.id}" class="shrink-0 text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-red-900/60 border border-zinc-700 hover:border-red-800/60 text-zinc-400 hover:text-red-300 transition-colors">Delete</button>
</div>`;
  }).join('');
}

document.getElementById('saved-scenarios-list')?.addEventListener('click', async (e) => {
  const loadBtn = e.target.closest('[data-load-scenario]');
  if (loadBtn) {
    try { await applyEmpdbData((await db.getScenario(Number(loadBtn.dataset.loadScenario)))?.data); }
    catch (err) { alert(`Failed to load: ${err.message}`); }
    return;
  }
  const delBtn = e.target.closest('[data-delete-scenario]');
  if (delBtn) {
    try { await db.deleteScenario(Number(delBtn.dataset.deleteScenario)); renderSavedScenarios(); }
    catch (err) { alert(`Failed to delete: ${err.message}`); }
  }
});

// ── Settings ──────────────────────────────────────────────────────────────────
const SETTINGS_STORAGE_KEY = 'empcodex-settings';

function _readSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{}'); }
  catch { return {}; }
}

function _writeSettings(s) {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(s));
}

function applySettings(s) {
  const scale = s.uiScale ?? 'normal';
  document.documentElement.dataset.uiScale = scale;
  document.querySelectorAll('#ui-scale-btns .settings-scale-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.scale === scale)
  );
}

applySettings(_readSettings());

document.getElementById('ui-scale-btns')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.settings-scale-btn[data-scale]');
  if (!btn) return;
  const s = _readSettings();
  s.uiScale = btn.dataset.scale;
  _writeSettings(s);
  applySettings(s);
});

// On startup: auto-load the most recently saved scenario if one exists,
// navigating to All Items; otherwise start on the Scenarios page.
(async () => {
  updateNavState();
  navigateTo('section-scenarios');
  try {
    const scenarios = await db.listScenarios();
    if (!scenarios.length) return;
    scenarios.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
    await applyEmpdbData(scenarios[0].data);
  } catch (err) {
    console.warn('Could not auto-load last scenario:', err);
  }
})();


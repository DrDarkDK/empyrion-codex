import { ParserFactory } from './parsers/ParserFactory.js';
import { LocalizationParser, stripFormatting, formatRichText } from './parsers/LocalizationParser.js';
import { initAnalytics, trackPageView, trackEvent, setAnalyticsEnabled } from './analytics.js';
import { TemplatesConfigParser } from './parsers/TemplatesConfigParser.js';
import { ItemListRenderer } from './ui/ItemListRenderer.js';
import { ItemDetailRenderer } from './ui/ItemDetailRenderer.js';
import { TraderRenderer } from './ui/TraderRenderer.js';
import { TraderDetailRenderer } from './ui/TraderDetailRenderer.js';
import { TraderLocationEditor } from './ui/TraderLocationEditor.js';
import { LocationsPageRenderer } from './ui/LocationsPageRenderer.js';
import { RoutesPageRenderer } from './ui/RoutesPageRenderer.js';
import { WeaponsPageRenderer } from './ui/WeaponsPageRenderer.js';
import { ManualTradersEditor } from './ui/ManualTradersEditor.js';
import { CompareState } from './ui/CompareState.js';
import { CompareRenderer } from './ui/CompareRenderer.js';
import { buildComparison } from './ui/CompareBuilder.js';
import { getCategoryIcon } from './ui/categoryIcons.js';
import { escapeHtml, parseQtyRange, estimatePriceRange } from './ui/renderUtils.js';
import { buildLocationsRoutesJson, buildLocationsRoutesCsv } from './ui/exportCodex.js';
import { buildLocationForm } from './ui/buildLocationForm.js';
import * as db from './db.js';
import {
  getTraderLocations,
  getAllTraderLocationCounts,
  getAllTraderLocations,
  addTraderLocation,
  updateTraderLocation,
  deleteTraderLocation,
  markTraderLocationVisited,
  getRoutes,
  addRoute,
  updateRoute,
  deleteRoute,
} from './db.js';

const APP_VERSION_URL = 'version.json';
const APP_VERSION_STORAGE_KEY = 'empcodex.appVersion';
const APP_VERSION_RELOAD_GUARD_KEY = 'empcodex.appVersionReloaded';

async function enforceFreshAssetsOnVersionChange() {
  try {
    const versionUrl = new URL(APP_VERSION_URL, window.location.href);
    versionUrl.searchParams.set('_', Date.now().toString());

    const res = await fetch(versionUrl.toString(), { cache: 'no-store' });
    if (!res.ok) return;

    const data = await res.json();
    const latestVersion = typeof data?.version === 'string' ? data.version.trim() : '';
    if (!latestVersion) return;

    const currentVersion = localStorage.getItem(APP_VERSION_STORAGE_KEY);
    if (!currentVersion) {
      localStorage.setItem(APP_VERSION_STORAGE_KEY, latestVersion);
      return;
    }
    if (currentVersion === latestVersion) return;

    const alreadyReloadedFor = sessionStorage.getItem(APP_VERSION_RELOAD_GUARD_KEY);
    localStorage.setItem(APP_VERSION_STORAGE_KEY, latestVersion);
    if (alreadyReloadedFor === latestVersion) return;
    sessionStorage.setItem(APP_VERSION_RELOAD_GUARD_KEY, latestVersion);

    if ('caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map(name => caches.delete(name)));
    }

    window.location.reload();
  } catch {
    // Best-effort only — app should continue normally if version check fails.
  }
}

void enforceFreshAssetsOnVersionChange();

const weaponsPageRenderer = new WeaponsPageRenderer();

/**
 * Builds a weapons config object from a featured scenario manifest entry.
 * Returns null when the entry carries no per-scenario config, which causes
 * WeaponsPageRenderer to fall back to the global parserConfig.json defaults.
 * @param {object} entry  A manifest.json scenario entry
 * @returns {{ columnGroups: object[], tierPercentiles: object } | null}
 */
function _buildWeaponsConfig(entry) {
  if (!entry?.weapons && !entry?.weaponTiers) return null;
  return {
    columnGroups:    entry.weapons?.columnGroups ?? undefined,
    tierPercentiles: entry.weaponTiers           ?? undefined,
  };
}

// ── Navigation ───────────────────────────────────────────────────────────────
const navButtons    = document.querySelectorAll('.sidebar-btn');
const sectionPanels = document.querySelectorAll('.section-panel');

function navigateTo(sectionId) {
  const key = sectionId.replace('section-', '');

  // 'locations' and 'routes' are sub-sections of 'trading' — the trading nav button stays active.
  // 'changelog' is a sub-section of 'about' — the about nav button stays active.
  const activeNavKey = (key === 'locations' || key === 'routes') ? 'trading'
                     : (key === 'changelog') ? 'about'
                     : key;

  // Don't navigate to a section whose nav button is disabled.
  const targetBtn = [...navButtons].find(b => b.dataset.section === activeNavKey);
  if (targetBtn?.disabled) return;

  // Clear the locations auto-refresh timer when navigating away from that section.
  if (currentSectionId !== sectionId && locationsRefreshTimer != null) {
    clearInterval(locationsRefreshTimer);
    locationsRefreshTimer = null;
  }

  // When leaving the Items or Trading sections, tear down their (potentially very large)
  // DOM trees so the browser can reclaim the memory. They are rebuilt when re-entered.
  if (currentSectionId !== sectionId) {
    if (currentSectionId === 'section-items') {
      itemListRenderer.teardown(itemsListContainer);
    } else if (currentSectionId === 'section-trading') {
      traderRenderer.teardown(tradersListContainer);
      manualTradersEditor.teardown(tradersListContainer);
      const oppsEl = document.getElementById('opportunities-container');
      if (oppsEl) oppsEl.innerHTML = '';
    }
  }

  currentSectionId = sectionId;

  navButtons.forEach(b => {
    const on = b.dataset.section === activeNavKey;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });

  sectionPanels.forEach(s => s.classList.add('hidden'));
  document.getElementById(sectionId).classList.remove('hidden');

  // Show trading sub-nav only while Trading or its sub-pages are active.
  const tradingSubnav = document.getElementById('trading-subnav');
  if (tradingSubnav) tradingSubnav.classList.toggle('hidden', activeNavKey !== 'trading');

  // Show about sub-nav only while About or its sub-pages are active.
  const aboutSubnav = document.getElementById('about-subnav');
  if (aboutSubnav) aboutSubnav.classList.toggle('hidden', activeNavKey !== 'about');

  // Show weapons sub-nav only while Weapons is the active section.
  const weaponsSubnav = document.getElementById('weapons-subnav');
  if (weaponsSubnav) weaponsSubnav.classList.toggle('hidden', activeNavKey !== 'weapons');

  syncTradingSubnav();
  syncAboutSubnav();
  syncWeaponsSubnav();

  if (sectionId === 'section-scenarios') renderSavedScenarios();
  if (sectionId === 'section-items')     rerenderItems();
  if (sectionId === 'section-trading')   rerenderTraders();
  if (sectionId === 'section-locations') renderLocationsPage();
  if (sectionId === 'section-routes')    renderRoutesPage();
  if (sectionId === 'section-weapons')   rerenderWeapons();

  // Track virtual page view (SPA — only one HTML file).
  const _vpMap = {
    'section-items':     'items',
    'section-weapons':   weaponsView === 'lookup' ? 'weapons/lookup' : 'weapons/matrix',
    'section-trading':   tradingView === 'opportunities' ? 'trading/opportunities' : 'trading/traders',
    'section-locations': 'trading/locations',
    'section-routes':    'trading/routes',
    'section-scenarios': 'scenarios',
    'section-about':     'about',
    'section-changelog': 'changelog',
    'section-settings':  'settings',
  };
  trackPageView(_vpMap[sectionId] ?? sectionId.replace('section-', ''));
  if (_hashReady) history.replaceState(null, '', `#${_buildPageHash()}`);
}

/**
 * Syncs the active highlight on all four Trading sub-nav buttons based on the
 * current section and trading view.  Must be called after any change to either.
 */
function syncTradingSubnav() {
  const onTrading   = currentSectionId === 'section-trading';
  const onLocations = currentSectionId === 'section-locations';
  const onRoutes    = currentSectionId === 'section-routes';
  _setSubnavBtnActive('traders-nav-btn',       onTrading && tradingView === 'traders');
  _setSubnavBtnActive('opportunities-nav-btn', onTrading && tradingView === 'opportunities');
  _setSubnavBtnActive('locations-nav-btn',     onLocations);
  _setSubnavBtnActive('routes-nav-btn',        onRoutes);
}

/** Toggles the active visual state on a Trading sub-nav button element. */
function _setSubnavBtnActive(id, active) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.classList.toggle('text-teal-400', active);
  btn.classList.toggle('bg-teal-950/30', active);
  btn.classList.toggle('text-slate-500', !active);
  btn.setAttribute('aria-current', active ? 'page' : 'false');
}

/** Syncs the active highlight on the About sub-nav buttons. */
function syncAboutSubnav() {
  _setSubnavBtnActive('about-nav-btn',     currentSectionId === 'section-about');
  _setSubnavBtnActive('changelog-nav-btn', currentSectionId === 'section-changelog');
}

/** Syncs the active highlight on the Weapons sub-nav buttons. */
function syncWeaponsSubnav() {
  const onWeapons = currentSectionId === 'section-weapons';
  _setSubnavBtnActive('weapons-matrix-nav-btn', onWeapons && weaponsView === 'matrix');
  _setSubnavBtnActive('weapons-lookup-nav-btn', onWeapons && weaponsView === 'lookup');
}

/** Enables/disables nav buttons that require loaded data. */
function updateNavState() {
  const hasData = !!(lastItemResults?.length || rawTradersCfg?.length || activeManifestEntry?.tradersManual);
  navButtons.forEach(btn => {
    if (btn.dataset.section === 'items' || btn.dataset.section === 'trading' || btn.dataset.section === 'weapons') {
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

document.getElementById('locations-nav-btn')?.addEventListener('click', () => {
  navigateTo('section-locations');
  closeSidebar();
});

document.getElementById('routes-nav-btn')?.addEventListener('click', () => {
  navigateTo('section-routes');
  closeSidebar();
});

document.getElementById('traders-nav-btn')?.addEventListener('click', () => {
  tradingView = 'traders';
  navigateTo('section-trading');
  rerenderTraders();
  closeSidebar();
});

document.getElementById('opportunities-nav-btn')?.addEventListener('click', () => {
  tradingView = 'opportunities';
  navigateTo('section-trading');
  rerenderTraders();
  closeSidebar();
});

document.getElementById('changelog-nav-btn')?.addEventListener('click', () => {
  navigateTo('section-changelog');
  closeSidebar();
});

document.getElementById('about-nav-btn')?.addEventListener('click', () => {
  navigateTo('section-about');
  closeSidebar();
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

const itemDetailRenderer    = new ItemDetailRenderer();
const traderDetailRenderer  = new TraderDetailRenderer();
const traderLocationEditor  = new TraderLocationEditor();
const locationsPageRenderer = new LocationsPageRenderer();
const routesPageRenderer    = new RoutesPageRenderer();
const compareState    = new CompareState();
const compareRenderer = new CompareRenderer();
const mainEl = document.querySelector('main');

// ── Trader location annotations ───────────────────────────────────────────────

/** Cached count of location annotations per traderName for the active scenario. */
let locationCountMap = new Map();

/** setInterval handle for the Locations page auto-refresh; cleared when navigating away. */
let locationsRefreshTimer = null;

/**
 * Returns the active scenario name from the sidebar label, or an empty string
 * when no scenario is loaded.  All trader-location data is scoped to this key.
 * @returns {string}
 */
function getActiveScenarioName() {
  return document.getElementById('scenario-name')?.textContent?.trim() ?? '';
}

/**
 * Re-fetches the per-trader annotation counts from IndexedDB for the active
 * scenario and updates `locationCountMap`.  A no-op when no scenario is loaded
 * or no traders have been parsed yet.
 * @returns {Promise<void>}
 */
async function refreshLocationCounts() {
  const scenarioName = getActiveScenarioName();
  if (!scenarioName) {
    locationCountMap = new Map();
    return;
  }
  try {
    locationCountMap = await getAllTraderLocationCounts(scenarioName);
  } catch (err) {
    console.warn('[locations] Failed to fetch location counts:', err);
  }
}

/**
 * Maps a manual-traders db item entry into a TraderItem-shaped object compatible
 * with all existing renderer and opportunities logic.
 * @param {{ devName: string, priceLo: number|null, priceHi: number|null, qtyLo: number|null, qtyHi: number|null }} item
 * @param {boolean} isSelling
 */
function _mapManualItemToTraderItem(item, isSelling) {
  const fmt = (lo, hi) => {
    if (lo == null && hi == null) return null;
    const a = lo ?? hi, b = hi ?? lo;
    return a === b ? String(a) : `${a}-${b}`;
  };
  const priceStr = fmt(item.priceLo, item.priceHi);
  const qtyStr   = fmt(item.qtyLo,   item.qtyHi);
  return {
    devName:      item.devName,
    isSelling:    isSelling,
    isBuying:    !isSelling,
    sellQtyRange: isSelling ? qtyStr   : null,
    sellMfRange:  isSelling ? priceStr : null,
    buyQtyRange: !isSelling ? qtyStr   : null,
    buyMfRange:  !isSelling ? priceStr : null,
  };
}

/**
 * Maps a manual-traders IndexedDB entry into a TraderNPC-shaped plain object
 * so it is consumed by all existing rendering and opportunities logic unchanged.
 * @param {object} entry
 */
function _mapManualEntryToTraderNpc(entry) {
  return {
    name:         entry.name,
    sellingText:  null,
    sellingGoods: [],
    discount:     null,
    sellingItems: (entry.sellingItems ?? []).map(i => _mapManualItemToTraderItem(i, true)),
    buyingItems:  (entry.buyingItems  ?? []).map(i => _mapManualItemToTraderItem(i, false)),
    properties:   [],
    children:     [],
  };
}

/**
 * Loads manual traders from IndexedDB for the active scenario and stores them
 * in `manualTradersCfg` as TraderNPC-shaped objects.
 * A no-op when the active scenario is not in manual mode.
 * @returns {Promise<void>}
 */
async function refreshManualTraders() {
  if (!activeManifestEntry?.tradersManual) return;
  const scenarioName = getActiveScenarioName();
  if (!scenarioName) { manualTradersCfg = []; return; }
  try {
    const entries = await db.getManualTraders(scenarioName);
    rawManualTraderDbEntries = entries;
    manualTradersCfg = entries.map(_mapManualEntryToTraderNpc);
  } catch (err) {
    console.warn('[manual-traders] Failed to load:', err);
    rawManualTraderDbEntries = [];
    manualTradersCfg = [];
  }
}

/**
 * Returns the active trader data for the current scenario:
 * - Manual mode: `manualTradersCfg` (user-authored, from IndexedDB)
 * - Normal mode: `rawTradersCfg`    (parsed from TraderNPCConfig.ecf)
 * @returns {Array|null}
 */
function getActiveTradersCfg() {
  return activeManifestEntry?.tradersManual ? (manualTradersCfg ?? []) : rawTradersCfg;
}

/**
 * Computes the potential credit value and stock ranges for a saved location.
 *
 * Returns `null` when no items have an explicit sell/buy intent, otherwise:
 *   sell — credits earned by selling intent='sell' items to the trader
 *   buy  — credits spent buying  intent='buy'  items from the trader
 *
 * Each bucket is `{ lo, hi, qtyLo, qtyHi }` or `null` when not applicable.
 *
 * @param {object} loc  Trader-location entry from IndexedDB.
 * @returns {{ sell: {lo,hi,qtyLo,qtyHi}|null, buy: {lo,hi,qtyLo,qtyHi}|null }|null}
 */
function computeTraderValue(loc) {
  const trader = getActiveTradersCfg()?.find(t => t.name === loc.traderName);
  if (!trader) return null;

  const sellItems = (loc.keyItems ?? []).filter(i => i.intent === 'sell');
  const buyItems  = (loc.keyItems ?? []).filter(i => i.intent === 'buy');

  if (!sellItems.length && !buyItems.length) return null;

  // sell: credits earned by selling tagged items TO the trader (trader's buyingItems pricing)
  let sellLo = 0, sellHi = 0, sellQtyLo = 0, sellQtyHi = 0, hasSell = false;
  for (const ki of sellItems) {
    const traderItem = trader.buyingItems?.find(i => i.devName === ki.devName);
    if (!traderItem) continue;
    const pRange = estimatePriceRange(traderItem.buyMfRange, getMarketPriceFor(ki.devName));
    const qRange = parseQtyRange(traderItem.buyQtyRange);
    if (pRange && qRange) {
      sellLo    += Math.round(qRange.lo * pRange.lo);
      sellHi    += Math.round(qRange.hi * pRange.hi);
      sellQtyLo += qRange.lo;
      sellQtyHi += qRange.hi;
      hasSell = true;
    }
  }

  // buy: credits spent buying tagged items FROM the trader (trader's sellingItems pricing)
  let buyLo = 0, buyHi = 0, buyQtyLo = 0, buyQtyHi = 0, hasBuy = false;
  for (const ki of buyItems) {
    const traderItem = trader.sellingItems?.find(i => i.devName === ki.devName);
    if (!traderItem) continue;
    const pRange = estimatePriceRange(traderItem.sellMfRange, getMarketPriceFor(ki.devName));
    const qRange = parseQtyRange(traderItem.sellQtyRange);
    if (pRange && qRange) {
      buyLo    += Math.round(qRange.lo * pRange.lo);
      buyHi    += Math.round(qRange.hi * pRange.hi);
      buyQtyLo += qRange.lo;
      buyQtyHi += qRange.hi;
      hasBuy = true;
    }
  }

  if (!hasSell && !hasBuy) return null;
  return {
    sell: hasSell ? { lo: sellLo, hi: sellHi, qtyLo: sellQtyLo, qtyHi: sellQtyHi } : null,
    buy:  hasBuy  ? { lo: buyLo,  hi: buyHi,  qtyLo: buyQtyLo,  qtyHi: buyQtyHi  } : null,
  };
}

/**
 * Fetches all trader locations for the active scenario and renders the
 * Locations overview page.  Also refreshes the sidebar scenario badge.
 * @returns {Promise<void>}
 */
async function renderLocationsPage() {
  const container = document.getElementById('locations-page-container');
  if (!container) return;

  const scenarioName = getActiveScenarioName();

  // Update the scenario badge in the locations header.
  const badge = document.getElementById('locations-scenario-badge');
  if (badge) {
    if (scenarioName) {
      badge.textContent = scenarioName;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }

  container.innerHTML =
    `<p class="text-xs text-slate-600 text-center py-20 select-none animate-pulse">Loading…</p>`;

  try {
    const locations = await getAllTraderLocations(scenarioName);
    locationsPageRenderer.render(container, {
      locations,
      scenarioName,
      resolveIconUrl,
      onItemClick: (devName) => {
        const target = makeTokenSyntheticItem(devName)
          ?? lastItemResults?.find(i => i.name === devName)
          ?? rawBlocksCfg?.find(b => b.name === devName);
        if (target) openDrawer(target);
      },
      onOpenTrader: (traderName) => {
        const trader = getActiveTradersCfg()?.find(t => t.name === traderName);
        if (!trader) return;
        openTraderDrawer(trader);
      },
      resolveTraderItems: (traderName) => {
        const trader = getActiveTradersCfg()?.find(t => t.name === traderName);
        if (!trader) return [];
        return [
          ...(trader.sellingItems ?? []).map(i => ({ devName: i.devName, displayName: resolveDisplayName(i.devName) ?? i.devName, source: 'sells' })),
          ...(trader.buyingItems  ?? []).map(i => ({ devName: i.devName, displayName: resolveDisplayName(i.devName) ?? i.devName, source: 'buys'  })),
        ].filter((item, idx, arr) => arr.findIndex(x => x.devName === item.devName) === idx);
      },
      getTraderValue: computeTraderValue,
      onAddLocation: () => showAddLocationForm(),
      onEdit: async (entry) => {
        await updateTraderLocation(entry);
        await refreshLocationCounts();
        rerenderTraders();
        await renderLocationsPage();
      },
      onMarkVisited: async (id) => {
        await markTraderLocationVisited(id);
        await refreshLocationCounts();
        rerenderTraders();
        await renderLocationsPage();
      },
      onDelete: async (id) => {
        await deleteTraderLocation(id);
        await refreshLocationCounts();
        rerenderTraders();
        await renderLocationsPage();
      },
    });
  } catch (err) {
    console.error('[LocationsPage]', err);
    container.innerHTML =
      `<p class="text-xs text-red-400 text-center py-20">Failed to load locations. Check the browser console for details.</p>`;
    return;
  }

  // ── Auto-refresh timer ─────────────────────────────────────────────────────
  // Re-renders every 60 s while the section is active so countdown labels stay live.
  // Guard: skip if the user navigated away while the async render was in flight.
  if (currentSectionId !== 'section-locations') return;
  if (locationsRefreshTimer) clearInterval(locationsRefreshTimer);
  locationsRefreshTimer = setInterval(() => {
    if (currentSectionId !== 'section-locations') {
      clearInterval(locationsRefreshTimer);
      locationsRefreshTimer = null;
      return;
    }
    // Skip if an edit form is currently open — avoid discarding unsaved input.
    const locContainer = document.getElementById('locations-page-container');
    if (locContainer?.querySelector('.loc-form-save')) return;
    renderLocationsPage();
  }, 60_000);
}

/**
 * Shows the "Add Location" form inline in the locations page container.
 * Stops the auto-refresh timer while the form is open (to avoid stomping unsaved input).
 */
function showAddLocationForm() {
  const container = document.getElementById('locations-page-container');
  if (!container) return;

  if (locationsRefreshTimer) { clearInterval(locationsRefreshTimer); locationsRefreshTimer = null; }

  const scenarioName = getActiveScenarioName();

  // Build the traders list for autocomplete
  const allTraders = (getActiveTradersCfg() ?? []).map(t => ({
    name:        t.name,
    displayName: resolveDisplayName(t.name) || t.name,
  }));

  container.innerHTML = '';
  const formWrap = document.createElement('div');
  formWrap.className = 'max-w-2xl';
  container.appendChild(formWrap);

  buildLocationForm(
    formWrap,
    async (entry) => {
      await addTraderLocation({ ...entry, scenarioName });
      await refreshLocationCounts();
      rerenderTraders();
      await renderLocationsPage();
    },
    () => renderLocationsPage(),
    [],          // traderItems — populated dynamically when a trader is chosen
    resolveIconUrl,
    null,        // existingLoc — this is always a new entry
    {
      showTraderField:    true,
      traders:            allTraders,
      resolveTraderItems: (traderName) => {
        const trader = getActiveTradersCfg()?.find(t => t.name === traderName);
        if (!trader) return [];
        return [
          ...(trader.sellingItems ?? []).map(i => ({ devName: i.devName, displayName: resolveDisplayName(i.devName) ?? i.devName })),
          ...(trader.buyingItems  ?? []).map(i => ({ devName: i.devName, displayName: resolveDisplayName(i.devName) ?? i.devName })),
        ].filter((item, idx, arr) => arr.findIndex(x => x.devName === item.devName) === idx);
      },
    },
  );
}

document.getElementById('locations-add-btn')?.addEventListener('click', () => showAddLocationForm());

/**
 * Fetches all saved routes for the active scenario and renders the Routes page.
 * @returns {Promise<void>}
 */
async function renderRoutesPage() {
  const container = document.getElementById('routes-page-container');
  if (!container) return;

  const scenarioName = getActiveScenarioName();

  // Update the scenario badge in the routes header.
  const badge = document.getElementById('routes-scenario-badge');
  if (badge) {
    if (scenarioName) {
      badge.textContent = scenarioName;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }

  // Wire the "New Route" button — only once per render to avoid stacking listeners.
  const newBtn = document.getElementById('routes-new-btn');
  if (newBtn) {
    const fresh = newBtn.cloneNode(true);
    newBtn.replaceWith(fresh);
    fresh.addEventListener('click', () => showRouteBuilder(container, scenarioName, null));
  }

  container.innerHTML =
    `<p class="text-xs text-slate-600 text-center py-20 select-none animate-pulse">Loading\u2026</p>`;

  try {
    const [routes, locations] = await Promise.all([
      getRoutes(scenarioName),
      getAllTraderLocations(scenarioName),
    ]);

    routesPageRenderer.render(container, {
      routes,
      locations,
      scenarioName,
      getTraderValue: computeTraderValue,
      resolveIconUrl,
      onNew: () => showRouteBuilder(container, scenarioName, null),
      onEdit: (route) => showRouteBuilder(container, scenarioName, route),
      onDelete: async (id) => {
        await deleteRoute(id);
        await renderRoutesPage();
      },
      onTraderClick: (traderName) => {
        const trader = getActiveTradersCfg()?.find(t => t.name === traderName);
        if (trader) openTraderDrawer(trader);
      },
      onItemClick: (devName) => {
        const target = makeTokenSyntheticItem(devName)
          ?? lastItemResults?.find(i => i.name === devName)
          ?? rawBlocksCfg?.find(b => b.name === devName);
        if (target) openDrawer(target);
      },
    });
  } catch (err) {
    console.error('[RoutesPage]', err);
    container.innerHTML =
      `<p class="text-xs text-red-400 text-center py-20">Failed to load routes. Check the browser console for details.</p>`;
  }
}

/**
 * Shows the route builder (create or edit) inside the routes page container.
 * @param {Element} container
 * @param {string} scenarioName
 * @param {object|null} routeToEdit
 */
async function showRouteBuilder(container, scenarioName, routeToEdit) {
  container.innerHTML =
    `<p class="text-xs text-slate-600 text-center py-20 select-none animate-pulse">Loading\u2026</p>`;

  const locations = await getAllTraderLocations(scenarioName);

  routesPageRenderer.showBuilder(container, {
    locations,
    scenarioName,
    getTraderValue: computeTraderValue,
    resolveIconUrl,
    onSave: async (route) => {
      if (routeToEdit) {
        await updateRoute(route);
      } else {
        await addRoute(route);
      }
      await renderRoutesPage();
    },
    onCancel: () => renderRoutesPage(),
    onTraderClick: (traderName) => {
      const trader = getActiveTradersCfg()?.find(t => t.name === traderName);
      if (trader) openTraderDrawer(trader);
    },
    onItemClick: (devName) => {
      const target = makeTokenSyntheticItem(devName)
        ?? lastItemResults?.find(i => i.name === devName)
        ?? rawBlocksCfg?.find(b => b.name === devName);
      if (target) openDrawer(target);
    },
  }, routeToEdit);
}

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
  const _itemHashPrefix = activeFeaturedIdx !== null ? `scenario=${activeFeaturedIdx}&` : '';
  history.replaceState(null, '', `#${_itemHashPrefix}item=${item.id ?? encodeURIComponent(item.name ?? '')}`);

  // Share button is only meaningful for featured scenarios
  drawerShare?.classList.toggle('hidden', activeFeaturedIdx === null);

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
    tradersCfg: getActiveTradersCfg(),
    onTraderClick: (traderName) => {
      const trader = getActiveTradersCfg()?.find(t => t.name === traderName);
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
  if (_hashReady) history.replaceState(null, '', `#${_buildPageHash()}`);
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
  const _traderHashPrefix = activeFeaturedIdx !== null ? `scenario=${activeFeaturedIdx}&` : '';
  history.replaceState(null, '', `#${_traderHashPrefix}trader=${encodeURIComponent(trader.name ?? '')}`);

  // Share button is only meaningful for featured scenarios
  drawerShare?.classList.toggle('hidden', activeFeaturedIdx === null);

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

  const _scenarioName = getActiveScenarioName();
  const _traderName   = trader.name ?? '';
  const _traderItems  = [
    ...(trader.sellingItems ?? []).map(i => ({ devName: i.devName, displayName: resolveDisplayName(i.devName) ?? i.devName, source: 'sells' })),
    ...(trader.buyingItems  ?? []).map(i => ({ devName: i.devName, displayName: resolveDisplayName(i.devName) ?? i.devName, source: 'buys'  })),
  ].filter((item, idx, arr) => arr.findIndex(x => x.devName === item.devName) === idx);
  traderLocationEditor.render(drawerBody, {
    traderItems: _traderItems,
    resolveIconUrl,
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
    getLocations:  () => getTraderLocations(_scenarioName, _traderName),
    onAdd:         async (entry) => {
      await addTraderLocation({ ...entry, scenarioName: _scenarioName, traderName: _traderName });
      await refreshLocationCounts();
      rerenderTraders();
      if (currentSectionId === 'section-locations') renderLocationsPage();
    },
    onEdit:        async (entry) => {
      await updateTraderLocation(entry);
      await refreshLocationCounts();
      rerenderTraders();
      if (currentSectionId === 'section-locations') renderLocationsPage();
    },
    onDelete:      async (id) => {
      await deleteTraderLocation(id);
      await refreshLocationCounts();
      rerenderTraders();
      if (currentSectionId === 'section-locations') renderLocationsPage();
    },
    onMarkVisited: (id) => markTraderLocationVisited(id),
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
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!compareOverlayEl?.classList.contains('hidden')) { closeCompareOverlay(); return; }
    closeDrawer();
  }
});

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

// ── Page share buttons ────────────────────────────────────────────────────────
// Delegated handler for all [data-page-share] buttons across every section header.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-page-share]');
  if (!btn) return;
  const url = location.href;
  const icon  = btn.querySelector('[data-share-icon]');
  const label = btn.querySelector('[data-share-label]');
  const confirm = () => {
    btn.classList.add('text-emerald-400');
    icon?.classList.add('hidden');
    label?.classList.remove('hidden');
    setTimeout(() => {
      btn.classList.remove('text-emerald-400');
      icon?.classList.remove('hidden');
      label?.classList.add('hidden');
    }, 1500);
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(url).then(confirm).catch(() => { _clipboardFallback(url); confirm(); });
  } else {
    _clipboardFallback(url);
    confirm();
  }
});

drawerBack.addEventListener('click', () => {
  const fn = drawerHistory.pop();
  if (!fn) return;
  fn();
  drawerBack.classList.toggle('hidden', drawerHistory.length === 0);
});

// ── Compare state & overlay ───────────────────────────────────────────────────

const compareBarEl      = document.getElementById('compare-bar');
const compareBarItemsEl = document.getElementById('compare-bar-items');
const compareBarOpenBtn = document.getElementById('compare-bar-open');
const compareBarClearBtn = document.getElementById('compare-bar-clear');
const compareOverlayEl  = document.getElementById('compare-overlay');
const compareOverlayBody = document.getElementById('compare-overlay-body');
const compareOverlayClose = document.getElementById('compare-overlay-close');
const compareOverlayCount = document.getElementById('compare-overlay-count');
const compareDiffOnly   = document.getElementById('compare-diff-only');

/** Currently rendered ComparisonResult — null when overlay is closed. */
let _compareResult = null;

/** Updates the compare bar chips and button state based on the pinned items. */
function _updateCompareBar(pinnedItems) {
  if (!pinnedItems.length) {
    compareBarEl.classList.add('hidden');
    return;
  }
  compareBarEl.classList.remove('hidden');

  compareBarItemsEl.innerHTML = pinnedItems.map(item => {
    const name = resolveDisplayName(item.name ?? '') || escapeHtml(item.name ?? '');
    let iconHtml = '';
    const iconUrl = resolveIconUrl(item.name ?? '');
    if (iconUrl) {
      iconHtml = `<img src="${iconUrl}" alt="" class="w-4 h-4 object-contain shrink-0" draggable="false" />`;
    }
    return `<div class="flex items-center gap-1 px-2 py-1 rounded bg-slate-800 border border-slate-700 text-xs text-slate-300 max-w-[160px] shrink-0">
      ${iconHtml}<span class="truncate">${escapeHtml(name)}</span>
      <button data-bar-remove="${escapeHtml(item.name ?? '')}" class="shrink-0 text-slate-600 hover:text-red-400 transition-colors ml-0.5 leading-none" title="Remove" aria-label="Remove ${escapeHtml(name)} from comparison">&times;</button>
    </div>`;
  }).join('');

  compareBarOpenBtn.disabled = pinnedItems.length < 2;
}

/** Opens the compare overlay and renders the current comparison. */
function openCompareOverlay() {
  const pinnedItems = compareState.items;
  if (pinnedItems.length < 2) return;

  _compareResult = buildComparison(pinnedItems, {
    templatesCfg:   rawTemplatesCfg,
    tradersCfg:     getActiveTradersCfg(),
    getMarketPrice: getMarketPriceFor,
  });

  compareOverlayCount.textContent = `${pinnedItems.length} items`;
  compareDiffOnly.checked = false;

  compareRenderer.render(_compareResult, compareOverlayBody, {
    showDiffsOnly:    false,
    resolveLocalized: resolveDisplayNameHtml,
    resolveIconUrl,
    onRemoveItem: (name) => {
      compareState.remove(name);
      if (compareState.count < 2) { closeCompareOverlay(); return; }
      // Re-build and re-render with the remaining items
      openCompareOverlay();
    },
    onMoveItem: (name, dir) => {
      compareState.move(name, dir);
      openCompareOverlay();
    },
    onItemClick: (devName) => {
      const target = lastItemResults?.find(i => i.name === devName)
        ?? rawBlocksCfg?.find(b => b.name === devName);
      if (target) { closeCompareOverlay(); openDrawer(target); }
    },
  });

  // Update URL hash and show share button only for featured scenarios
  const compareShareBtn = document.getElementById('compare-share-btn');
  if (activeFeaturedIdx !== null) {
    const names = pinnedItems.map(i => encodeURIComponent(i.name ?? '')).join('|');
    history.replaceState(null, '', `#scenario=${activeFeaturedIdx}&compare=${names}`);
    compareShareBtn?.classList.remove('hidden');
  } else {
    compareShareBtn?.classList.add('hidden');
  }

  compareOverlayEl.classList.remove('hidden');
  compareOverlayClose.focus();
}

/** Closes the compare overlay without clearing the pinned set. */
function closeCompareOverlay() {
  compareOverlayEl.classList.add('hidden');
  _compareResult = null;
  if (_hashReady) history.replaceState(null, '', `#${_buildPageHash()}`);
}

// Wire compare bar buttons
compareBarOpenBtn?.addEventListener('click', openCompareOverlay);
compareBarClearBtn?.addEventListener('click', () => compareState.clear());

// Wire compare overlay close button
compareOverlayClose?.addEventListener('click', closeCompareOverlay);

// Wire compare share button
document.getElementById('compare-share-btn')?.addEventListener('click', () => {
  const url = location.href;
  const confirm = () => {
    const icon  = document.getElementById('compare-share-icon');
    const label = document.getElementById('compare-share-label');
    const btn   = document.getElementById('compare-share-btn');
    btn?.classList.add('text-emerald-400');
    icon?.classList.add('hidden');
    label?.classList.remove('hidden');
    setTimeout(() => {
      btn?.classList.remove('text-emerald-400');
      icon?.classList.remove('hidden');
      label?.classList.add('hidden');
    }, 1500);
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(url).then(confirm).catch(() => { _clipboardFallback(url); confirm(); });
  } else {
    _clipboardFallback(url);
    confirm();
  }
});

// Wire diff-only toggle
compareDiffOnly?.addEventListener('change', () => {
  if (!_compareResult) return;
  compareRenderer.render(_compareResult, compareOverlayBody, {
    showDiffsOnly:    compareDiffOnly.checked,
    resolveLocalized: resolveDisplayNameHtml,
    resolveIconUrl,
    onRemoveItem: (name) => {
      compareState.remove(name);
      if (compareState.count < 2) { closeCompareOverlay(); return; }
      openCompareOverlay();
    },
    onMoveItem: (name, dir) => {
      compareState.move(name, dir);
      openCompareOverlay();
    },
    onItemClick: (devName) => {
      const target = lastItemResults?.find(i => i.name === devName)
        ?? rawBlocksCfg?.find(b => b.name === devName);
      if (target) { closeCompareOverlay(); openDrawer(target); }
    },
  });
});

// Wire compare bar remove-chip buttons via delegation
compareBarItemsEl?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-bar-remove]');
  if (btn) compareState.remove(btn.dataset.barRemove);
});

// React to pin state changes
compareState.onChange((pinnedItems) => {
  _updateCompareBar(pinnedItems);
  // Update only the pin-button / ring styles in-place — avoids a full re-render
  // that would flash skeleton placeholders for every card.
  itemListRenderer.updatePinStates(itemsListContainer, new Set(pinnedItems.map(i => i.name)));
});

// ── URL hash helpers ──────────────────────────────────────────────────────────

/**
 * Parses a URL hash string into a plain key→value object.
 * Supports both single-param (#item=123) and multi-param (#scenario=0&item=123) formats.
 * @param {string} [hashStr]
 * @returns {Record<string,string>}
 */
function _parseHashParams(hashStr = location.hash) {
  const hash = (hashStr ?? '').startsWith('#') ? hashStr.slice(1) : (hashStr ?? '');
  const params = {};
  for (const part of hash.split('&')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    params[part.slice(0, eq)] = decodeURIComponent(part.slice(eq + 1));
  }
  return params;
}

/**
 * Builds the canonical URL hash string for the current page/scenario state.
 * Used so every navigation keeps the URL shareable.
 * @returns {string}  e.g. "scenario=2&page=weapons-matrix"
 */
function _buildPageHash() {
  const scenarioPart = activeFeaturedIdx !== null ? `scenario=${activeFeaturedIdx}&` : '';
  const _pageMap = {
    'section-items':     'items',
    'section-weapons':   weaponsView === 'lookup' ? 'weapons-lookup' : 'weapons-matrix',
    'section-trading':   tradingView === 'opportunities' ? 'trading-opportunities' : 'trading',
    'section-locations': 'locations',
    'section-routes':    'routes',
    'section-scenarios': 'scenarios',
    'section-about':     'about',
    'section-changelog': 'changelog',
    'section-settings':  'settings',
  };
  const page = _pageMap[currentSectionId] ?? currentSectionId.replace('section-', '');
  return `${scenarioPart}page=${page}`;
}

/**
 * Reads a URL hash produced by _populateDrawer or _populateTraderDrawer and opens
 * the matching drawer. Call after data is fully loaded.
 * The 'scenario' key is intentionally ignored here — featured scenario loading is
 * handled upstream (fetchAndRenderFeaturedScenarios / featured load click handler).
 * @param {string} [hashStr] - Hash string to parse; defaults to the current location.hash.
 */
function _tryRestoreFromHash(hashStr = location.hash) {
  const params = _parseHashParams(hashStr);

  if (params.item) {
    const value = params.item;
    const id    = Number(value);
    const item  = (!isNaN(id) && id > 0)
      ? (lastItemResults?.find(i => i.id === id) ?? rawBlocksCfg?.find(b => b.id === id))
      : (lastItemResults?.find(i => i.name === value) ?? rawBlocksCfg?.find(b => b.name === value));
    if (item) { navigateTo('section-items'); openDrawer(item); }
  } else if (params.trader) {
    const trader = getActiveTradersCfg()?.find(t => t.name === params.trader);
    if (trader) { navigateTo('section-trading'); openTraderDrawer(trader); }
  } else if (params.compare) {
    const names = params.compare.split('|').filter(Boolean);
    const items = names
      .map(n => lastItemResults?.find(i => i.name === n) ?? rawBlocksCfg?.find(b => b.name === n))
      .filter(Boolean);
    if (items.length >= 2) {
      compareState.clear();
      items.forEach(item => compareState.add(item));
      navigateTo('section-items');
      openCompareOverlay();
    }
  } else if (params.page) {
    const _pageRestoreMap = {
      'items':                 { section: 'section-items' },
      'weapons':               { section: 'section-weapons' },
      'weapons-matrix':        { section: 'section-weapons', action: () => { weaponsView = 'matrix'; } },
      'weapons-lookup':        { section: 'section-weapons', action: () => { weaponsView = 'lookup'; } },
      'trading':               { section: 'section-trading' },
      'trading-opportunities': { section: 'section-trading', action: () => { tradingView = 'opportunities'; } },
      'locations':             { section: 'section-locations' },
      'routes':                { section: 'section-routes' },
      'scenarios':             { section: 'section-scenarios' },
      'about':                 { section: 'section-about' },
      'changelog':             { section: 'section-changelog' },
      'settings':              { section: 'section-settings' },
    };
    const entry = _pageRestoreMap[params.page];
    if (entry) { entry.action?.(); navigateTo(entry.section); }
  }
}

// ── Items renderer ────────────────────────────────────────────────────────────
const itemsListContainer = document.getElementById('items-grid');
const itemListRenderer   = new ItemListRenderer();
// ── Trading renderer ──────────────────────────────────────────────
const tradersListContainer = document.getElementById('traders-list-container');
const traderRenderer = new TraderRenderer();
const manualTradersEditor = new ManualTradersEditor();
/** Last parsed items — kept so the grid can be re-rendered when localization loads. */
let lastItemResults = null;
/** Raw results from ItemsConfig.ecf and BlocksConfig.ecf — merged into lastItemResults. */
let rawItemsCfg     = null;
let rawBlocksCfg    = null;
/** Map<name, Template> from Templates.ecf — keyed by template devName. */
let rawTemplatesCfg = null;
/** TraderNPC[] from TraderNPCConfig.ecf. */
let rawTradersCfg   = null;
/** ManualTrader[] mapped from IndexedDB — populated in manual-mode scenarios. */
let manualTradersCfg = null;
/** Raw DB rows for manual traders — used by ManualTradersEditor to read price/qty ranges. */
let rawManualTraderDbEntries = [];
/** Token[] from TokenConfig.ecf. */
let rawTokensCfg    = null;
/** Material[] from MaterialConfig.ecf. */
let rawMaterialsCfg = null;
/** DamageMultiplier[] from DamageMultiplierConfig.ecf. */
let rawDamageMultiplierCfg = null;

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
let currentSectionId      = 'section-scenarios';

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
  itemListRenderer.render(filtered, itemsListContainer, openDrawer, resolveDisplayNameHtml, resolveIconUrl, {
    pinnedNames:      new Set(compareState.items.map(i => i.name)),
    onCompareToggle:  (item) => { compareState.toggle(item); },
  });
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

// ── Weapons view ──────────────────────────────────────────────────────────────

/** Currently active tab on the Weapons page. */
let weaponsView = 'matrix'; // 'matrix' | 'lookup'

/** Re-renders the Weapons page for the current weaponsView. */
function rerenderWeapons() {
  const contentEl = document.getElementById('weapons-content');
  if (!contentEl) return;

  // Sync search placeholder with current view
  const searchEl = document.getElementById('weapons-search');
  if (searchEl) searchEl.placeholder = weaponsView === 'matrix' ? 'Search weapons\u2026' : 'Search blocks\u2026';

  const hasData = !!(rawBlocksCfg?.length || rawMaterialsCfg?.length || rawDamageMultiplierCfg?.length);
  if (!hasData) {
    contentEl.innerHTML = '<p class="text-xs text-slate-700 text-center py-20 italic select-none">No data loaded.</p>';
    return;
  }

  if (activeFeaturedIdx === null && activeManifestEntry === null) {
    contentEl.innerHTML = `
      <div class="flex flex-col items-center justify-center py-24 gap-4 select-none px-6">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-8 h-8 text-slate-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <p class="text-sm text-slate-400 text-center max-w-sm leading-relaxed">
          The Weapons tab is only available for built-in featured scenarios.
        </p>
        <p class="text-xs text-slate-600 text-center max-w-sm leading-relaxed">
          Go to the Scenarios page and load one of the featured scenarios to use this feature.
        </p>
      </div>`;
    return;
  }

  if (!activeWeaponsSupported) {
    contentEl.innerHTML = `
      <div class="flex flex-col items-center justify-center py-24 gap-4 select-none px-6">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-8 h-8 text-slate-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
        </svg>
        <p class="text-sm text-slate-400 text-center max-w-sm leading-relaxed">
          The Weapons page is unfortunately not compatible with this scenario.
        </p>
      </div>`;
    return;
  }

  const allItems = [...(rawBlocksCfg ?? []), ...(rawItemsCfg ?? [])];
  const itemLookup = new Map(allItems.map(i => [i.name, i]));
  const onBlockClick = (blockName) => { const it = itemLookup.get(blockName); if (it) openDrawer(it); };

  if (weaponsView === 'matrix') {
    weaponsPageRenderer.renderMatrix(
      {
        blocks:            rawBlocksCfg           ?? [],
        items:             rawItemsCfg            ?? [],
        damageMultipliers: rawDamageMultiplierCfg ?? [],
      },
      contentEl,
      resolveDisplayName,
      onBlockClick,
      resolveIconUrl,
    );
  } else {
    weaponsPageRenderer.renderLookup(
      {
        blocks:            rawBlocksCfg           ?? [],
        items:             rawItemsCfg            ?? [],
        damageMultipliers: rawDamageMultiplierCfg ?? [],
        materials:         rawMaterialsCfg        ?? [],
      },
      contentEl,
      resolveDisplayName,
      onBlockClick,
      resolveIconUrl,
    );
  }
}

document.getElementById('weapons-matrix-nav-btn')?.addEventListener('click', () => {
  const searchEl = document.getElementById('weapons-search');
  if (searchEl) { searchEl.value = ''; searchEl.placeholder = 'Search weapons…'; }
  weaponsView = 'matrix';
  navigateTo('section-weapons');
  closeSidebar();
});

document.getElementById('weapons-lookup-nav-btn')?.addEventListener('click', () => {
  const searchEl = document.getElementById('weapons-search');
  if (searchEl) { searchEl.value = ''; searchEl.placeholder = 'Search blocks…'; }
  weaponsView = 'lookup';
  navigateTo('section-weapons');
  closeSidebar();
});

// Live search filter for the weapons page (matrix: filters weapons; lookup: filters blocks)
document.getElementById('weapons-search')?.addEventListener('input', (e) => {
  if (weaponsView === 'matrix') {
    weaponsPageRenderer.applyFilter(e.target.value);
  } else {
    weaponsPageRenderer.applyLookupFilter(e.target.value);
  }
});

/** Re-renders the traders grid applying the current trading search filter. */
function rerenderTraders() {
  if (!rawTradersCfg && !activeManifestEntry?.tradersManual) return;
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

  // Manual mode — delegate entirely to ManualTradersEditor
  if (activeManifestEntry?.tradersManual) {
    manualTradersEditor.render(tradersListContainer, {
      traders:           getActiveTradersCfg() ?? [],
      rawDbEntries:      rawManualTraderDbEntries,
      itemSuggestions:   lastItemResults ?? [],
      resolveDisplayName,
      resolveIconUrl,
      onTraderClick: (traderName) => {
        const trader = getActiveTradersCfg()?.find(t => t.name === traderName);
        if (trader) openTraderDrawer(trader);
      },
      onImport: async (traderEntries) => {
        const scenarioName = getActiveScenarioName();
        if (!scenarioName) return;
        for (const entry of rawManualTraderDbEntries) {
          await db.deleteManualTrader(entry.id);
        }
        for (const t of traderEntries) {
          if (!t.name) continue;
          await db.addManualTrader({
            id: crypto.randomUUID(),
            scenarioName,
            name: t.name,
            sellingItems: t.sellingItems ?? [],
            buyingItems:  t.buyingItems  ?? [],
          });
        }
        await refreshManualTraders();
        rerenderTraders();
      },
      onAddTrader: async (name) => {
        await db.addManualTrader({ id: crypto.randomUUID(), scenarioName: getActiveScenarioName(), name, sellingItems: [], buyingItems: [] });
        await refreshManualTraders();
        rerenderTraders();
      },
      onRenameTrader: async (id, newName) => {
        const entry = rawManualTraderDbEntries.find(e => e.id === id);
        if (!entry) return;
        await db.updateManualTrader({ ...entry, name: newName });
        await refreshManualTraders();
        rerenderTraders();
      },
      onDeleteTrader: async (id) => {
        await db.deleteManualTrader(id);
        await refreshManualTraders();
        rerenderTraders();
      },
      onAddItem: async (id, direction, data) => {
        const entry = rawManualTraderDbEntries.find(e => e.id === id);
        if (!entry) return;
        const key = direction === 'sell' ? 'sellingItems' : 'buyingItems';
        await db.updateManualTrader({ ...entry, [key]: [...(entry[key] ?? []), data] });
        await refreshManualTraders();
        rerenderTraders();
      },
      onUpdateItem: async (id, direction, idx, data) => {
        const entry = rawManualTraderDbEntries.find(e => e.id === id);
        if (!entry) return;
        const key = direction === 'sell' ? 'sellingItems' : 'buyingItems';
        const arr = [...(entry[key] ?? [])];
        arr[idx] = data;
        await db.updateManualTrader({ ...entry, [key]: arr });
        await refreshManualTraders();
        rerenderTraders();
      },
      onDeleteItem: async (id, direction, idx) => {
        const entry = rawManualTraderDbEntries.find(e => e.id === id);
        if (!entry) return;
        const key = direction === 'sell' ? 'sellingItems' : 'buyingItems';
        const arr = (entry[key] ?? []).filter((_, i) => i !== idx);
        await db.updateManualTrader({ ...entry, [key]: arr });
        await refreshManualTraders();
        rerenderTraders();
      },
    });
    return;
  }

  // Traders view
  // Always exclude traders that have no items at all
  const baseTraders = getActiveTradersCfg().filter(t => t.sellingItems.length > 0 || t.buyingItems.length > 0);

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
  if (filtered.length === 0) {
    const msg = q ? 'No traders match your search.' : 'No traders found.';
    tradersListContainer.innerHTML = `<p class="text-xs text-slate-700 text-center py-20 italic select-none">${msg}</p>`;
    return;
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
    getMarketPrice:   getMarketPriceFor,
    tradingShow,
    onTraderClick: (traderName) => {
      const trader = getActiveTradersCfg()?.find(t => t.name === traderName);
      if (trader) openTraderDrawer(trader);
    },
    itemSearchQuery:  tradingSearch.trim().toLowerCase(),
    getLocationCount: (traderName) => locationCountMap.get(traderName) ?? 0,
  });
}

/**
 * Builds the list of tradeable opportunities: items that at least one trader sells to the player
 * AND at least one trader buys from the player, with an estimated profit.
 * Returns items sorted by estimated profit descending (unknown profits sorted last).
 * @returns {Array}
 */
function buildOpportunities() {
  if (!getActiveTradersCfg()?.length) return [];

  // sellMap: devName -> [{traderName, priceRange, qtyRange}]  (trader sells to you)
  // buyMap:  devName -> [{traderName, priceRange, qtyRange}]  (trader buys from you)
  const sellMap = new Map();
  const buyMap  = new Map();

  for (const rawTrader of getActiveTradersCfg()) {
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

  const allOpps = buildOpportunities();
  const q = tradingSearch.trim().toLowerCase();
  const opps = q
    ? allOpps.filter(opp => (resolveDisplayName(opp.devName) ?? opp.devName ?? '').toLowerCase().includes(q))
    : allOpps;

  if (!opps.length) {
    const msg = q
      ? 'No items match your search.'
      : 'No tradeable items found. Make sure at least one trader buys and sells the same item.';
    el.innerHTML = `<p class="text-xs text-slate-700 text-center py-20 italic select-none">${msg}</p>`;
    return;
  }

  const fmtPrice  = (v) => v != null ? v.toLocaleString() + ' cr' : '\u2014';
  const fmtProfit = (v, hasQty) => {
    if (v == null) return '\u2014';
    const sign = v >= 0 ? '+' : '';
    const cr = sign + v.toLocaleString() + ' cr';
    return hasQty ? cr : cr + '\u2009*';
  };

  const rendered = opps.map(opp => {
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

    return {
      mobile: `<div class="sm:hidden border-b border-zinc-800/50 py-3 hover:bg-zinc-800/20 transition-colors">
  <button data-opp-item="${escapeHtml(opp.devName)}" class="text-blue-400 hover:text-blue-300 hover:underline text-left transition-colors text-xs">${displayName}</button>
  <div class="mt-1.5 ml-3 grid grid-cols-2 gap-y-1">
    <span class="text-[10px] text-slate-500 uppercase tracking-wide">Buy from</span>
    <span class="text-xs text-slate-300 text-right" title="${sellerTips}">${fmtPrice(opp.bestBuyLo)}</span>
    <span class="text-[10px] text-slate-500 uppercase tracking-wide">Sell to</span>
    <span class="text-xs text-slate-300 text-right" title="${buyerTips}">${fmtPrice(opp.bestSellHi)}</span>
    <span class="text-[10px] text-amber-800 uppercase tracking-wide">Vol.</span>
    <span class="text-xs text-amber-600 text-right tabular-nums">${escapeHtml(qtyStr)}</span>
    <span class="text-[10px] text-slate-500 uppercase tracking-wide">Est. profit</span>
    <span class="text-xs text-right tabular-nums ${profitCls}">${fmtProfit(opp.estProfit, hasFullPair)}</span>
  </div>
</div>`,
      table: `<tr class="border-b border-zinc-800/50 hover:bg-zinc-800/20 transition-colors">
  <td class="py-2 px-2 sm:px-4 text-xs">
    <button data-opp-item="${escapeHtml(opp.devName)}" class="text-blue-400 hover:text-blue-300 hover:underline text-left transition-colors">${displayName}</button>
  </td>
  <td class="py-2 px-2 sm:px-4 text-xs text-slate-300 text-right" title="${sellerTips}">${fmtPrice(opp.bestBuyLo)}</td>
  <td class="py-2 px-2 sm:px-4 text-xs text-slate-300 text-right" title="${buyerTips}">${fmtPrice(opp.bestSellHi)}</td>
  <td class="py-2 px-2 sm:px-4 text-xs text-amber-600 text-right tabular-nums">${escapeHtml(qtyStr)}</td>
  <td class="py-2 px-2 sm:px-4 text-xs text-right tabular-nums ${profitCls}">${fmtProfit(opp.estProfit, hasFullPair)}</td>
</tr>`
    };
  });
  const mobileRows = rendered.map(r => r.mobile).join('');
  const tableRows  = rendered.map(r => r.table).join('');

  el.innerHTML = `<div class="max-w-3xl">
<p class="text-[11px] text-slate-500 mb-3 px-1">Items tradeable between different traders. Profit = tradable quantity &times; (best sell price &minus; best buy price), using the (seller, buyer) pair that maximises total earnings. Hover a price to see which traders and their stock. Prices use market value where available. * = per-unit estimate only (qty unavailable).</p>
<div class="sm:hidden">${mobileRows}</div>
<div class="hidden sm:block">
<table class="w-full border-collapse">
  <thead>
    <tr class="border-b border-zinc-700">
      <th class="py-2 px-2 sm:px-4 text-[10px] text-slate-500 uppercase tracking-wide text-left font-semibold">Item</th>
      <th class="py-2 px-2 sm:px-4 text-[10px] text-slate-500 uppercase tracking-wide text-right font-semibold">Best buy from</th>
      <th class="py-2 px-2 sm:px-4 text-[10px] text-slate-500 uppercase tracking-wide text-right font-semibold">Best sell to</th>
      <th class="py-2 px-2 sm:px-4 text-[10px] text-amber-800 uppercase tracking-wide text-right font-semibold">Vol.</th>
      <th class="py-2 px-2 sm:px-4 text-[10px] text-slate-500 uppercase tracking-wide text-right font-semibold">Est. total profit</th>
    </tr>
  </thead>
  <tbody>${tableRows}</tbody>
</table>
</div>
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
  activeFeaturedIdx = null;
  const text = await file.text();
  localizationMap = new LocalizationParser().parse(text);

  if (lastItemResults) {
    closeDrawer();
    rerenderItems();
  }
  if (rawTradersCfg || activeManifestEntry?.tradersManual) rerenderTraders();
  updateExportStatus();
}

/**
 * Parses an ECF file and populates the correct section.
 * @param {File} file
 * @param {HTMLElement} sectionEl
 * @returns {Promise<boolean>} true on success
 */
async function loadEcfIntoSection(file, sectionEl) {
  activeFeaturedIdx = null;
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
    await refreshLocationCounts();
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
  activeFeaturedIdx = null;
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
 * Parses a MaterialConfig.ecf file and stores the results in rawMaterialsCfg.
 * @param {File} file
 */
async function loadMaterialsFile(file) {
  const text    = await file.text();
  const results = ParserFactory.getParser('MaterialConfig.ecf').parse(text);
  rawMaterialsCfg = results;
  updateExportStatus();
}

/**
 * Parses a DamageMultiplierConfig.ecf file and stores the results in rawDamageMultiplierCfg.
 * @param {File} file
 */
async function loadDamageMultiplierFile(file) {
  const text    = await file.text();
  const results = ParserFactory.getParser('DamageMultiplierConfig.ecf').parse(text);
  rawDamageMultiplierCfg = results;
  updateExportStatus();
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
  activeFeaturedIdx = null;
  _updateFeaturedButtons();

  // Save hash now — file loads trigger closeDrawer which would clear it
  const pendingHash = location.hash;

  const scenarioName = files[0].webkitRelativePath.split('/')[0];

  // Check if this custom scenario matches a manifest entry by name or alias,
  // and if so apply its weapons config.
  const manifestEntry = featuredManifest.find(entry => {
    const names = [entry.name, ...(entry.aliases ?? [])].map(n => n.toLowerCase());
    return names.includes(scenarioName.toLowerCase());
  });
  activeManifestEntry    = manifestEntry ?? null;
  activeWeaponsSupported = manifestEntry ? manifestEntry.weaponsSupported !== false : true;
  weaponsPageRenderer.setConfig(manifestEntry ? _buildWeaponsConfig(manifestEntry) : null);
  const nameEl = document.getElementById('scenario-name');
  nameEl.textContent = scenarioName;
  nameEl.classList.remove('hidden');

  const locFile              = findInScenario(files, 'Extras', 'Localization.csv');
  const itemsFile            = findInScenario(files, 'Content', 'Configuration', 'ItemsConfig.ecf');
  const blocksFile           = findInScenario(files, 'Content', 'Configuration', 'BlocksConfig.ecf');
  const traderFile           = findInScenario(files, 'Content', 'Configuration', 'TraderNPCConfig.ecf');
  const templatesFile        = findInScenario(files, 'Content', 'Configuration', 'Templates.ecf');
  const tokenFile            = findInScenario(files, 'Content', 'Configuration', 'TokenConfig.ecf');
  const materialsFile        = findInScenario(files, 'Content', 'Configuration', 'MaterialConfig.ecf');
  const damageMultiplierFile = findInScenario(files, 'Content', 'Configuration', 'DamageMultiplierConfig.ecf');

  buildIconMap(files);

  // Reset raw item sources for a clean scenario load
  rawItemsCfg            = null;
  rawBlocksCfg           = null;
  rawTemplatesCfg        = null;
  rawTokensCfg           = null;
  rawMaterialsCfg        = null;
  rawDamageMultiplierCfg = null;

  // Localization must load first so item names resolve correctly on render
  if (locFile) await applyLocalization(locFile);

  // Load items-section files sequentially to avoid state conflicts
  const itemsSectionEl = document.getElementById('section-items');
  if (itemsFile)            await loadEcfIntoSection(itemsFile,  itemsSectionEl);
  if (blocksFile)           await loadEcfIntoSection(blocksFile, itemsSectionEl);
  if (traderFile && !activeManifestEntry?.tradersManual)
    await loadEcfIntoSection(traderFile, document.getElementById('section-trading'));
  if (templatesFile)        await loadTemplatesFile(templatesFile);
  if (tokenFile)            await loadTokensFile(tokenFile);
  if (materialsFile)        await loadMaterialsFile(materialsFile);
  if (damageMultiplierFile) await loadDamageMultiplierFile(damageMultiplierFile);

  // Auto-save to browser cache
  await persistScenario(await buildExportPayload());
  renderSavedScenarios();

  if (activeManifestEntry?.tradersManual) {
    await refreshManualTraders();
    rerenderTraders();
  }

  if (currentSectionId === 'section-weapons') rerenderWeapons();

  _tryRestoreFromHash(pendingHash);
});

// ── Individual file loading ───────────────────────────────────────────────────
document.getElementById('localization-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  activeManifestEntry = null;
  await applyLocalization(file);
});

document.querySelectorAll('.file-input').forEach(input => {
  input.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    activeManifestEntry = null;
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
  const isFeatured = activeFeaturedIdx !== null;
  btn.disabled = !hasData || isFeatured;
  const heroLabel = document.getElementById('hero-load-status');
  if (hasData && isFeatured) {
    status.textContent = 'Export not available for built-in scenarios';
    if (heroLabel) {
      const name = document.getElementById('scenario-name')?.textContent?.trim();
      heroLabel.textContent = name || 'Data loaded';
      heroLabel.className = 'text-sm tracking-widest uppercase text-amber-400';
    }
  } else if (hasData) {
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
  if (activeFeaturedIdx !== null) return;
  const hasData = !!(rawItemsCfg || rawBlocksCfg || rawTradersCfg || rawTemplatesCfg || localizationMap);
  if (!hasData) return;
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
    version:            1,
    scenarioName:       scenarioName || null,
    items:              rawItemsCfg            ?? [],
    blocks:             rawBlocksCfg           ?? [],
    traders:            (activeManifestEntry?.tradersManual ? [] : rawTradersCfg) ?? [],
    tokens:             rawTokensCfg           ?? [],
    templates:          rawTemplatesCfg ? [...rawTemplatesCfg.values()] : [],
    localization:       localizationMap ? Object.fromEntries(localizationMap) : {},
    materials:          rawMaterialsCfg        ?? [],
    damageMultipliers:  rawDamageMultiplierCfg ?? [],
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

  rawItemsCfg            = data.items?.length               ? data.items               : null;
  rawBlocksCfg           = data.blocks?.length              ? data.blocks              : null;
  rawTradersCfg          = data.traders?.length             ? data.traders             : null;
  rawTokensCfg           = data.tokens?.length              ? data.tokens              : null;
  rawTemplatesCfg        = data.templates?.length
    ? new Map(data.templates.map(t => [t.name, t]))
    : null;
  rawMaterialsCfg        = data.materials?.length           ? data.materials           : null;
  rawDamageMultiplierCfg = data.damageMultipliers?.length   ? data.damageMultipliers   : null;
  localizationMap = data.localization && Object.keys(data.localization).length
    ? new Map(Object.entries(data.localization))
    : null;

  iconDataMap = data.icons && Object.keys(data.icons).length
    ? new Map(Object.entries(data.icons))
    : new Map();
  // Clear stale file handles so buildExportPayload uses iconDataMap
  iconFileMap = new Map();

  if (data.scenarioName) {
    activeScenarioName = data.scenarioName;
    const nameEl = document.getElementById('scenario-name');
    nameEl.textContent = data.scenarioName;
    nameEl.classList.remove('hidden');
  }

  // If no featured scenario is active, try to match this scenario's name
  // against the manifest so hidden entries get their weapons config.
  _applyManifestMatch(activeScenarioName);

  // Rebuild lastItemResults from restored raw sources
  if (rawItemsCfg || rawBlocksCfg) {
    lastItemResults = mergeItemResults();
    buildCategoryPills(lastItemResults);
    document.getElementById('items-toolbar').classList.remove('hidden');
  }

  updateExportStatus();
  closeDrawer();
  if (lastItemResults?.length)  rerenderItems();
  if (rawTradersCfg?.length || activeManifestEntry?.tradersManual) {
    await refreshLocationCounts();
    if (activeManifestEntry?.tradersManual) await refreshManualTraders();
    rerenderTraders();
  }
  _tryRestoreFromHash(pendingHash);
}

document.getElementById('empdb-input')?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  activeFeaturedIdx   = null;
  activeManifestEntry = null;
  weaponsPageRenderer.setConfig(null); // reset to global defaults for non-featured scenarios
  _updateFeaturedButtons();
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

// ── Location & Route export / import ────────────────────────

/**
 * Triggers a file download with the given text content.
 */
function _downloadText(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function _getUserDataExportParts() {
  const scenarioName = getActiveScenarioName();
  const [locations, routes] = await Promise.all([
    getAllTraderLocations(scenarioName),
    getRoutes(scenarioName),
  ]);
  return { scenarioName, locations, routes };
}

document.getElementById('export-user-data-json-btn')?.addEventListener('click', async () => {
  const { scenarioName, locations, routes } = await _getUserDataExportParts();
  const date = new Date().toISOString().slice(0, 10);
  const slug = (scenarioName || 'empyrion').replace(/[^a-zA-Z0-9_-]/g, '-');
  _downloadText(
    `${slug}-locations-routes-${date}.json`,
    buildLocationsRoutesJson(locations, routes, scenarioName),
    'application/json'
  );
});

document.getElementById('export-user-data-csv-btn')?.addEventListener('click', async () => {
  const { scenarioName, locations, routes } = await _getUserDataExportParts();
  const date = new Date().toISOString().slice(0, 10);
  const slug = (scenarioName || 'empyrion').replace(/[^a-zA-Z0-9_-]/g, '-');
  _downloadText(
    `${slug}-locations-routes-${date}.csv`,
    buildLocationsRoutesCsv(locations, routes, scenarioName),
    'text/csv'
  );
});

/**
 * Imports a locations+routes JSON export into IndexedDB.
 * Existing records with the same id are overwritten; new records are added.
 * @param {string} jsonString
 */
async function importLocationsRoutesJson(jsonString) {
  const data = JSON.parse(jsonString);
  if (
    !data ||
    data.version !== 1 ||
    !Array.isArray(data.locations) ||
    !Array.isArray(data.routes)
  ) {
    throw new Error('Unrecognised format — expected a version 1 locations/routes export.');
  }

  // Collect unique scenario names present in the file so we can build ID sets.
  const scenarioNames = [
    ...new Set([
      ...data.locations.map(l => l.scenarioName).filter(Boolean),
      ...data.routes.map(r => r.scenarioName).filter(Boolean),
    ]),
  ];

  const existingLocIds   = new Set();
  const existingRouteIds = new Set();

  await Promise.all(
    scenarioNames.map(async sn => {
      const [locs, rts] = await Promise.all([getAllTraderLocations(sn), getRoutes(sn)]);
      locs.forEach(l => existingLocIds.add(l.id));
      rts.forEach(r => existingRouteIds.add(r.id));
    })
  );

  await Promise.all([
    ...data.locations.map(loc =>
      existingLocIds.has(loc.id) ? updateTraderLocation(loc) : addTraderLocation(loc)
    ),
    ...data.routes.map(route =>
      existingRouteIds.has(route.id) ? updateRoute(route) : addRoute(route)
    ),
  ]);

  await refreshLocationCounts();
  rerenderTraders();
  renderLocationsPage();
  renderRoutesPage();
}

document.getElementById('import-user-data-input')?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';

  let jsonString;
  try {
    jsonString = await file.text();
    // Quick parse + validate before checking for existing data
    const data = JSON.parse(jsonString);
    if (
      !data || data.version !== 1 ||
      !Array.isArray(data.locations) || !Array.isArray(data.routes)
    ) throw new Error('Unrecognised format — expected a version 1 locations/routes export.');

    // Check if any existing data would be overwritten
    const scenarioNames = [
      ...new Set([
        ...data.locations.map(l => l.scenarioName).filter(Boolean),
        ...data.routes.map(r => r.scenarioName).filter(Boolean),
      ]),
    ];

    const existingLocIds   = new Set();
    const existingRouteIds = new Set();
    await Promise.all(
      scenarioNames.map(async sn => {
        const [locs, rts] = await Promise.all([getAllTraderLocations(sn), getRoutes(sn)]);
        locs.forEach(l => existingLocIds.add(l.id));
        rts.forEach(r => existingRouteIds.add(r.id));
      })
    );

    const updatedLocs   = data.locations.filter(l => existingLocIds.has(l.id)).length;
    const newLocs       = data.locations.length - updatedLocs;
    const updatedRoutes = data.routes.filter(r => existingRouteIds.has(r.id)).length;
    const newRoutes     = data.routes.length - updatedRoutes;

    const hasConflicts = updatedLocs > 0 || updatedRoutes > 0;

    if (!hasConflicts) {
      await importLocationsRoutesJson(jsonString);
      return;
    }

    // Show confirmation modal
    const modal  = document.getElementById('import-confirm-modal');
    const body   = document.getElementById('import-confirm-body');
    const okBtn  = document.getElementById('import-confirm-ok');
    const cancel = document.getElementById('import-confirm-cancel');
    const backdrop = document.getElementById('import-confirm-backdrop');

    const row = (label, val) =>
      `<div class="flex items-baseline justify-between gap-4"><span class="text-slate-500">${label}</span><span class="font-semibold text-slate-200 tabular-nums">${val}</span></div>`;

    body.innerHTML =
      `<p class="mb-2">Your current data has records that match items in this file. Importing will <strong class="text-amber-300">overwrite</strong> those records.</p>` +
      `<div class="bg-zinc-900/60 border border-zinc-800 rounded-lg px-4 py-3 flex flex-col gap-1 text-[12px]">` +
        row('Locations to add',    newLocs) +
        row('Locations to update', updatedLocs) +
        row('Routes to add',    newRoutes) +
        row('Routes to update', updatedRoutes) +
      `</div>`;

    modal.classList.remove('hidden');

    const cleanup = () => modal.classList.add('hidden');

    const onOk = async () => {
      cleanup();
      try {
        await importLocationsRoutesJson(jsonString);
      } catch (err) {
        alert(`Failed to import: ${err.message}`);
      }
    };

    okBtn.onclick     = onOk;
    cancel.onclick    = cleanup;
    backdrop.onclick  = cleanup;
  } catch (err) {
    alert(`Failed to import: ${err.message}`);
  }
});

// ── Featured scenarios ───────────────────────────────────────
//
// Drop .empcdx files into src/scenarios/ and register them in
// src/scenarios/manifest.json using this shape:
// [{ "name": "...", "description": "...", "version": "...",
//    "image": "scenarios/images/my-cover.jpg", "file": "scenarios/my.empcdx" }]
//
// The manifest is fetched once on startup. Full .empcdx data is only fetched
// when the user explicitly clicks Load.

let featuredManifest       = [];
let activeFeaturedIdx      = null;
let activeManifestEntry    = null;  // set when a custom import matches a manifest entry
let activeScenarioName     = null;  // last scenario name from applyEmpdbData, for re-matching after manifest loads
let activeWeaponsSupported = true;
// Suppresses history.replaceState in navigateTo until startup is fully done,
// so the initial URL hash is never clobbered before it has been read.
let _hashReady             = false;

const FEATURED_PLACEHOLDER_SVG = `<svg xmlns='http://www.w3.org/2000/svg' class='w-10 h-10' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.25' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'><circle cx='12' cy='12' r='10'/><line x1='2' y1='12' x2='22' y2='12'/><path d='M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z'/></svg>`;

/**
 * Looks up a scenario name in the manifest and applies the matching weapons
 * config to the page renderer. Only takes effect when no featured scenario
 * is currently active (i.e. activeFeaturedIdx === null).
 * @param {string|null} scenarioName
 */
function _applyManifestMatch(scenarioName) {
  if (activeFeaturedIdx !== null) return;
  const entry = scenarioName
    ? featuredManifest.find(e => {
        const names = [e.name, ...(e.aliases ?? [])].map(n => n.toLowerCase());
        return names.includes(scenarioName.toLowerCase());
      })
    : undefined;
  activeManifestEntry    = entry ?? null;
  activeWeaponsSupported = entry ? entry.weaponsSupported !== false : true;
  weaponsPageRenderer.setConfig(entry ? _buildWeaponsConfig(entry) : null);
}

function _hideFeaturedSection() {
  const card    = document.getElementById('featured-scenarios-card');
  const divider = document.getElementById('featured-scenarios-divider');
  if (card)    card.hidden    = true;
  if (divider) divider.hidden = true;
}

function _updateFeaturedButtons() {
  document.querySelectorAll('[data-featured-load]').forEach(btn => {
    const isLoaded = Number(btn.dataset.featuredLoad) === activeFeaturedIdx;
    btn.disabled    = isLoaded;
    btn.textContent = isLoaded ? '✓ Loaded' : 'Load Scenario';
    btn.className   = isLoaded
      ? 'text-xs px-4 py-1.5 rounded-lg bg-zinc-700 text-zinc-400 font-semibold cursor-default'
      : 'text-xs px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 active:bg-amber-600 disabled:opacity-40 disabled:pointer-events-none text-zinc-950 font-semibold transition-colors';
  });
}

function _renderFeaturedScenarios() {
  const el = document.getElementById('featured-scenarios-list');
  if (!el) return;
  el.innerHTML = featuredManifest.map((s, i) => {
    if (s.hidden) return '';
    const isLoaded = i === activeFeaturedIdx;
    const imgHtml = s.image
      ? `<img src="${escapeHtml(s.image)}" alt="" class="w-full h-full object-cover"
             width="240" height="135" loading="lazy" decoding="async"
             onerror="this.style.display='none';this.nextElementSibling.removeAttribute('hidden')" />
         <div hidden class="w-full h-full flex items-center justify-center text-zinc-700">${FEATURED_PLACEHOLDER_SVG}</div>`
      : `<div class="w-full h-full flex items-center justify-center text-zinc-700">${FEATURED_PLACEHOLDER_SVG}</div>`;
    return `<div class="w-full max-w-[380px] shrink-0 flex flex-col min-[400px]:flex-row rounded-xl border border-zinc-700/50 hover:border-zinc-500/70 overflow-hidden bg-[#0d1018] shadow-lg shadow-black/50 transition-colors">
  <div class="w-full aspect-video min-[400px]:w-44 min-[400px]:aspect-auto shrink-0 bg-[#08090e] overflow-hidden">${imgHtml}</div>
  <div class="flex-1 p-4 flex flex-col gap-1 min-w-0">
    <p class="text-sm font-bold text-white leading-snug">${escapeHtml(s.name ?? '')}</p>
    ${s.version ? `<p class="text-[10px] text-zinc-400 uppercase tracking-widest">${escapeHtml(String(s.version))}</p>` : ''}
    ${s.description ? `<p class="text-xs text-zinc-400 leading-relaxed mt-1.5">${escapeHtml(s.description)}</p>` : ''}
    <div class="mt-auto pt-3">
      <button data-featured-load="${i}" ${isLoaded ? 'disabled' : ''} class="text-xs px-4 py-1.5 rounded-lg ${isLoaded ? 'bg-zinc-700 text-zinc-400 font-semibold cursor-default' : 'bg-amber-500 hover:bg-amber-400 active:bg-amber-600 disabled:opacity-40 disabled:pointer-events-none text-zinc-950 font-semibold transition-colors'}">${isLoaded ? '✓ Loaded' : 'Load Scenario'}</button>
    </div>
  </div>
</div>`;
  }).join('');
}

/**
 * Fetches a scenario file and returns the parsed JSON payload.
 * Handles gzip-compressed files (.gz) transparently using the browser's
 * built-in DecompressionStream API so that smaller files are transferred
 * over the network and decompressed on the client.
 * @param {string} url
 * @returns {Promise<object>}
 */
async function _fetchScenarioData(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (url.endsWith('.gz')) {
    const stream = res.body.pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(stream).text());
  }
  return res.json();
}

async function fetchAndRenderFeaturedScenarios() {
  try {
    const res = await fetch('scenarios/manifest.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    featuredManifest = await res.json();
  } catch {
    // Manifest unavailable (local dev, server not configured) — hide silently
    _hideFeaturedSection();
    return;
  }

  if (!Array.isArray(featuredManifest) || !featuredManifest.length) {
    _hideFeaturedSection();
    return;
  }

  _renderFeaturedScenarios();

  // Auto-load a featured scenario if one is specified in the startup URL hash
  const startupParams = _parseHashParams(location.hash);
  if (startupParams.scenario !== undefined) {
    const idx   = Number(startupParams.scenario);
    const entry = featuredManifest[idx];
    if (entry?.file) {
      try {
        const data = await _fetchScenarioData(entry.file);
        activeFeaturedIdx      = idx;
        activeWeaponsSupported = entry.weaponsSupported !== false;
        weaponsPageRenderer.setConfig(_buildWeaponsConfig(entry));
        await applyEmpdbData(data);
        _updateFeaturedButtons();
      } catch { /* ignore — user can load manually */ }
    }
  }
}

document.getElementById('featured-scenarios-list')?.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-featured-load]');
  if (!btn) return;
  const entry = featuredManifest[Number(btn.dataset.featuredLoad)];
  if (!entry?.file) return;
  btn.disabled    = true;
  btn.textContent = 'Loading…';
  try {
    const data = await _fetchScenarioData(entry.file);
    activeFeaturedIdx      = Number(btn.dataset.featuredLoad);
    activeManifestEntry    = entry;
    activeWeaponsSupported = entry.weaponsSupported !== false;
    weaponsPageRenderer.setConfig(_buildWeaponsConfig(entry));
    await applyEmpdbData(data);
    trackEvent('Scenario Download', { name: entry.name ?? '' });
    _updateFeaturedButtons();
  } catch (err) {
    alert(`Failed to load "${escapeHtml(entry.name ?? '')}": ${err.message}`);
    activeFeaturedIdx      = null;
    activeWeaponsSupported = true;
    btn.disabled    = false;
    btn.textContent = 'Load Scenario';
  }
});

// Capture the URL hash at page-load time before any navigation call can
// clobber it via history.replaceState. Both the featured-scenario auto-loader
// and the startup IIFE must read THIS value, not location.hash.
const _featuredLoadPromise = fetchAndRenderFeaturedScenarios();

// ── Scroll-to-top buttons ─────────────────────────────────────────────────────
[
  { btn: 'items-scroll-top',   containers: ['items-list-container'] },
  { btn: 'trading-scroll-top', containers: ['traders-list-container', 'opportunities-container', 'section-trading'] },
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
    const active = containerEls.find(el => el.scrollTop > 0)
      ?? containerEls.find(el => !el.classList.contains('hidden'))
      ?? containerEls[0];
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
    activeFeaturedIdx = null;
    weaponsPageRenderer.setConfig(null); // reset to global defaults for non-featured scenarios
    _updateFeaturedButtons();
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
  const analyticsEnabled = s.analyticsEnabled !== false;
  setAnalyticsEnabled(analyticsEnabled);
  const analyticsToggle = document.getElementById('analytics-toggle');
  if (analyticsToggle) analyticsToggle.checked = analyticsEnabled;

  const scale        = s.uiScale        ?? 'normal';
  const scaleItems   = s.uiScaleItems   ?? 'normal';
  const scaleTrading = s.uiScaleTrading ?? 'normal';

  document.documentElement.dataset.uiScale        = scale;
  document.documentElement.dataset.uiScaleItems   = scaleItems;
  document.documentElement.dataset.uiScaleTrading = scaleTrading;

  document.querySelectorAll('#ui-scale-btns .settings-scale-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.scale === scale)
  );
  document.querySelectorAll('#ui-scale-items-btns .settings-scale-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.scale === scaleItems)
  );
  document.querySelectorAll('#ui-scale-trading-btns .settings-scale-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.scale === scaleTrading)
  );

  const defaultPage = s.defaultPage ?? 'scenarios';
  document.querySelectorAll('#default-page-options [role="option"]').forEach(opt => {
    opt.setAttribute('aria-selected', opt.dataset.value === defaultPage);
  });
  const selectedOpt = document.querySelector(`#default-page-options [data-value="${defaultPage}"]`);
  if (selectedOpt) {
    const triggerIcon  = document.getElementById('default-page-trigger-icon');
    const triggerLabel = document.getElementById('default-page-trigger-label');
    if (triggerIcon)  triggerIcon.innerHTML  = selectedOpt.querySelector('svg')?.innerHTML ?? '';
    if (triggerLabel) triggerLabel.textContent = selectedOpt.textContent.trim();
  }
}

initAnalytics();
applySettings(_readSettings());

document.getElementById('analytics-toggle')?.addEventListener('change', (e) => {
  const s = _readSettings();
  s.analyticsEnabled = e.target.checked;
  _writeSettings(s);
  applySettings(s);
});

document.getElementById('ui-scale-btns')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.settings-scale-btn[data-scale]');
  if (!btn) return;
  const s = _readSettings();
  s.uiScale = btn.dataset.scale;
  _writeSettings(s);
  applySettings(s);
});

document.getElementById('ui-scale-items-btns')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.settings-scale-btn[data-scale]');
  if (!btn) return;
  const s = _readSettings();
  s.uiScaleItems = btn.dataset.scale;
  _writeSettings(s);
  applySettings(s);
});

document.getElementById('ui-scale-trading-btns')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.settings-scale-btn[data-scale]');
  if (!btn) return;
  const s = _readSettings();
  s.uiScaleTrading = btn.dataset.scale;
  _writeSettings(s);
  applySettings(s);
});

(function () {
  const trigger = document.getElementById('default-page-trigger');
  const optionsList = document.getElementById('default-page-options');
  if (!trigger || !optionsList) return;

  function openDropdown() {
    optionsList.classList.remove('hidden');
    trigger.setAttribute('aria-expanded', 'true');
  }
  function closeDropdown() {
    optionsList.classList.add('hidden');
    trigger.setAttribute('aria-expanded', 'false');
  }

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    optionsList.classList.contains('hidden') ? openDropdown() : closeDropdown();
  });

  optionsList.addEventListener('click', (e) => {
    const opt = e.target.closest('[role="option"][data-value]');
    if (!opt) return;
    const s = _readSettings();
    s.defaultPage = opt.dataset.value;
    _writeSettings(s);
    applySettings(s);
    closeDropdown();
  });

  document.addEventListener('click', (e) => {
    if (!document.getElementById('default-page-dropdown')?.contains(e.target)) {
      closeDropdown();
    }
  });
})();

/**
 * Navigates to the page the user has chosen as their default, as stored in
 * settings. Data-gated pages (items, trading) silently do nothing if no
 * scenario is currently loaded — the caller is responsible for ensuring a
 * baseline page is already visible before calling this.
 */
function navigateToDefaultPage() {
  const page = _readSettings().defaultPage ?? 'scenarios';
  if (page === 'traders') {
    tradingView = 'traders';
    navigateTo('section-trading');
  } else if (page === 'opportunities') {
    tradingView = 'opportunities';
    navigateTo('section-trading');
  } else {
    navigateTo(`section-${page}`);
  }
}

// On startup: auto-load the most recently saved scenario if one exists, wait
// for any featured scenario to finish loading too, then navigate to the
// user's chosen default page.
(async () => {
  updateNavState();
  navigateTo('section-scenarios');
  try {
    const scenarios = await db.listScenarios();
    if (scenarios.length) {
      scenarios.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
      await applyEmpdbData(scenarios[0].data);
    }
  } catch (err) {
    console.warn('Could not auto-load last scenario:', err);
  }
  // Wait for any featured scenario to finish loading (network fetch) before
  // navigating, so data-gated nav buttons are enabled by the time we arrive.
  await _featuredLoadPromise;
  // Re-apply manifest match now that featuredManifest is fully populated.
  // The auto-load above may have run before the manifest fetch completed.
  if (activeFeaturedIdx === null) _applyManifestMatch(activeScenarioName);
  // If the URL already encodes a page/item destination, honour it; otherwise
  // fall back to the user's configured default page.
  const _startupHash = _parseHashParams(location.hash);
  if (_startupHash.page || _startupHash.item || _startupHash.trader || _startupHash.compare) {
    _tryRestoreFromHash();
  } else {
    navigateToDefaultPage();
  }
  // Startup done — enable hash writes and write the final canonical URL once.
  _hashReady = true;
  history.replaceState(null, '', `#${_buildPageHash()}`);
})();


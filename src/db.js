/**
 * Lightweight IndexedDB wrapper for persisting scenario and trader-location data.
 *
 * Database : empyrion-codex
 * Stores   : scenarios        — cached scenario payloads
 *            trader-locations — user-annotated trader locations (added in v2)
 *            routes           — planned multi-stop trading routes   (added in v3)
 *            manual-traders   — user-authored trader data for manual-mode scenarios (added in v4)
 */

const DB_NAME    = 'empyrion-codex';
const DB_VERSION = 4;
const STORE              = 'scenarios';
const LOC_STORE          = 'trader-locations';
const ROUTE_STORE        = 'routes';
const MANUAL_TRADER_STORE = 'manual-traders';

/**
 * Cached connection promise — reused across all callers so only one
 * IDBDatabase object is ever open at a time.  Reset to null whenever the
 * connection is closed (version upgrade from another tab, or an error).
 * @type {Promise<IDBDatabase>|null}
 */
let _dbPromise = null;

/** @returns {Promise<IDBDatabase>} */
function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = /** @type {IDBDatabase} */ (e.target.result);

      // v1 store — create on fresh installs (upgrades from v1 already have it)
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }

      // v2 store — trader location annotations
      if (!db.objectStoreNames.contains(LOC_STORE)) {
        const locStore = db.createObjectStore(LOC_STORE, { keyPath: 'id' });
        // Compound index for per-trader lookups
        locStore.createIndex('by_scenario_trader', ['scenarioName', 'traderName'], { unique: false });
        // Single-field index for scenario-wide aggregations (e.g. badge counts)
        locStore.createIndex('by_scenario', 'scenarioName', { unique: false });
      }

      // v3 store — planned trading routes
      if (!db.objectStoreNames.contains(ROUTE_STORE)) {
        const routeStore = db.createObjectStore(ROUTE_STORE, { keyPath: 'id' });
        routeStore.createIndex('by_scenario', 'scenarioName', { unique: false });
      }

      // v4 store — user-authored traders for manual-mode scenarios
      if (!db.objectStoreNames.contains(MANUAL_TRADER_STORE)) {
        const mtStore = db.createObjectStore(MANUAL_TRADER_STORE, { keyPath: 'id' });
        mtStore.createIndex('by_scenario', 'scenarioName', { unique: false });
      }
    };
    req.onsuccess = (e) => {
      const db = /** @type {IDBDatabase} */ (e.target.result);
      // If another tab opens a newer version, close gracefully so the upgrade
      // can proceed and reset the cached promise so the next call reconnects.
      db.onversionchange = () => { db.close(); _dbPromise = null; };
      resolve(db);
    };
    req.onerror = (e) => { _dbPromise = null; reject(e.target.error); };
  });
  return _dbPromise;
}

/**
 * Returns all saved scenario entries, unsorted.
 * Each entry: { id, name, savedAt, itemCount, traderCount, data }
 * @returns {Promise<Array>}
 */
export async function listScenarios() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = (e) => resolve(e.target.result ?? []);
    req.onerror   = (e) => reject(e.target.error);
  });
}

/**
 * Persists a scenario entry and returns the auto-assigned numeric id.
 * @param {{ name: string, savedAt: string, itemCount: number, traderCount: number, data: object }} entry
 * @returns {Promise<number>}
 */
export async function saveScenario(entry) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readwrite').objectStore(STORE).add(entry);
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

/**
 * Retrieves a single scenario by id.
 * @param {number} id
 * @returns {Promise<object|undefined>}
 */
export async function getScenario(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

/**
 * Deletes a scenario by id.
 * @param {number} id
 * @returns {Promise<void>}
 */
export async function deleteScenario(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(e.target.error);
  });
}

// ── Trader location annotations ───────────────────────────────────────────────
//
// Each entry shape:
//   {
//     id:             string,       — crypto.randomUUID()
//     scenarioName:   string,       — scopes annotations to a specific scenario
//     traderName:     string,       — trader devName
//     playfield:      string,
//     poi:            string,
//     restockMinutes: number|null,  — real-world minutes between restocks
//     notes:          string|null,
//     lastVisitedAt:  string|null,  — ISO 8601 timestamp
//   }

/**
 * Returns all location entries for a specific trader in a given scenario.
 * @param {string} scenarioName
 * @param {string} traderName
 * @returns {Promise<Array>}
 */
export async function getTraderLocations(scenarioName, traderName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const store  = db.transaction(LOC_STORE, 'readonly').objectStore(LOC_STORE);
    const index  = store.index('by_scenario_trader');
    const range  = IDBKeyRange.only([scenarioName, traderName]);
    const req    = index.getAll(range);
    req.onsuccess = (e) => resolve(e.target.result ?? []);
    req.onerror   = (e) => reject(e.target.error);
  });
}

/**
 * Returns a Map of traderName → location count for every annotated trader
 * in the given scenario. Traders with no annotations are absent from the map.
 * @param {string} scenarioName
 * @returns {Promise<Map<string, number>>}
 */
export async function getAllTraderLocationCounts(scenarioName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const store = db.transaction(LOC_STORE, 'readonly').objectStore(LOC_STORE);
    const index = store.index('by_scenario');
    const range = IDBKeyRange.only(scenarioName);
    const req   = index.getAll(range);
    req.onsuccess = (e) => {
      const counts = new Map();
      for (const entry of (e.target.result ?? [])) {
        counts.set(entry.traderName, (counts.get(entry.traderName) ?? 0) + 1);
      }
      resolve(counts);
    };
    req.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Persists a new location entry.
 * The caller is responsible for generating a unique `id` (use crypto.randomUUID()).
 * @param {object} entry
 * @returns {Promise<void>}
 */
export async function addTraderLocation(entry) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(LOC_STORE, 'readwrite').objectStore(LOC_STORE).add(entry);
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(e.target.error);
  });
}

/**
 * Deletes a location entry by its id.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteTraderLocation(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(LOC_STORE, 'readwrite').objectStore(LOC_STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(e.target.error);
  });
}

/**
 * Stamps a location entry's `lastVisitedAt` field with the current time.
 * Silently succeeds if the entry no longer exists.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function markTraderLocationVisited(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx     = db.transaction(LOC_STORE, 'readwrite');
    const store  = tx.objectStore(LOC_STORE);
    const getReq = store.get(id);
    getReq.onsuccess = (e) => {
      const entry = e.target.result;
      if (!entry) { resolve(); return; }
      entry.lastVisitedAt = new Date().toISOString();
      const putReq = store.put(entry);
      putReq.onsuccess = () => resolve();
      putReq.onerror   = (ev) => reject(ev.target.error);
    };
    getReq.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Overwrites an existing location entry with updated data.
 * The entry must have the same `id` as the original.
 * @param {object} entry
 * @returns {Promise<void>}
 */
export async function updateTraderLocation(entry) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(LOC_STORE, 'readwrite').objectStore(LOC_STORE).put(entry);
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(e.target.error);
  });
}

/**
 * Returns all location entries for a given scenario, across every trader.
 * Used by the Locations overview page.
 * @param {string} scenarioName
 * @returns {Promise<Array>}
 */
export async function getAllTraderLocations(scenarioName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const store = db.transaction(LOC_STORE, 'readonly').objectStore(LOC_STORE);
    const index = store.index('by_scenario');
    const range = IDBKeyRange.only(scenarioName);
    const req   = index.getAll(range);
    req.onsuccess = (e) => resolve(e.target.result ?? []);
    req.onerror   = (e) => reject(e.target.error);
  });
}

// ── Routes ───────────────────────────────────────────────────────────────────
//
// Each route entry shape:
//   {
//     id:           string,   — crypto.randomUUID()
//     scenarioName: string,   — scopes routes to a given scenario
//     name:         string,   — player-defined route name
//     stops: [                — ordered list of location references
//       { locationId: string, order: number }
//     ],
//     createdAt:    string,   — ISO 8601 timestamp
//   }

/**
 * Returns all routes for a given scenario.
 * @param {string} scenarioName
 * @returns {Promise<Array>}
 */
export async function getRoutes(scenarioName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const store = db.transaction(ROUTE_STORE, 'readonly').objectStore(ROUTE_STORE);
    const index = store.index('by_scenario');
    const req   = index.getAll(IDBKeyRange.only(scenarioName));
    req.onsuccess = (e) => resolve(e.target.result ?? []);
    req.onerror   = (e) => reject(e.target.error);
  });
}

/**
 * Persists a new route entry and returns its id.
 * @param {object} route  Must include `id`, `scenarioName`, `name`, `stops`, `createdAt`.
 * @returns {Promise<string>}
 */
export async function addRoute(route) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(ROUTE_STORE, 'readwrite').objectStore(ROUTE_STORE).add(route);
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

/**
 * Updates an existing route (full replace by id).
 * @param {object} route
 * @returns {Promise<void>}
 */
export async function updateRoute(route) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(ROUTE_STORE, 'readwrite').objectStore(ROUTE_STORE).put(route);
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(e.target.error);
  });
}

/**
 * Deletes a route by id.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteRoute(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(ROUTE_STORE, 'readwrite').objectStore(ROUTE_STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(e.target.error);
  });
}

// ── Manual traders ────────────────────────────────────────────────────────────
//
// User-authored trader records for scenarios where tradersManual=true.
// Prices are stored as observed ranges to account for restock variation
// (high stock → lower price, low stock → higher price).
//
// Each entry shape:
//   {
//     id:           string,       — crypto.randomUUID()
//     scenarioName: string,       — scopes to a specific scenario
//     name:         string,       — user-entered trader display name
//     sellingItems: [{            — items the trader sells to the player
//       devName:  string,
//       priceLo:  number|null,    — lowest observed sell price (full stock)
//       priceHi:  number|null,    — highest observed sell price (low stock)
//       qtyLo:    number|null,    — minimum stock observed
//       qtyHi:    number|null,    — maximum stock observed
//     }],
//     buyingItems: [{             — items the trader buys from the player
//       devName:  string,
//       priceLo:  number|null,    — lowest they've paid (high supply)
//       priceHi:  number|null,    — most they've paid (scarce supply)
//       qtyLo:    number|null,
//       qtyHi:    number|null,
//     }],
//   }

/**
 * Returns all manual trader entries for the given scenario.
 * @param {string} scenarioName
 * @returns {Promise<Array>}
 */
export async function getManualTraders(scenarioName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const store = db.transaction(MANUAL_TRADER_STORE, 'readonly').objectStore(MANUAL_TRADER_STORE);
    const req   = store.index('by_scenario').getAll(IDBKeyRange.only(scenarioName));
    req.onsuccess = (e) => resolve(e.target.result ?? []);
    req.onerror   = (e) => reject(e.target.error);
  });
}

/**
 * Persists a new manual trader entry.
 * Caller must supply a unique `id` (use crypto.randomUUID()).
 * @param {object} entry
 * @returns {Promise<void>}
 */
export async function addManualTrader(entry) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(MANUAL_TRADER_STORE, 'readwrite').objectStore(MANUAL_TRADER_STORE).add(entry);
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(e.target.error);
  });
}

/**
 * Overwrites an existing manual trader entry (full replace by id).
 * Used whenever items or the trader name are edited.
 * @param {object} entry
 * @returns {Promise<void>}
 */
export async function updateManualTrader(entry) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(MANUAL_TRADER_STORE, 'readwrite').objectStore(MANUAL_TRADER_STORE).put(entry);
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(e.target.error);
  });
}

/**
 * Deletes a manual trader entry by id.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteManualTrader(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(MANUAL_TRADER_STORE, 'readwrite').objectStore(MANUAL_TRADER_STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(e.target.error);
  });
}

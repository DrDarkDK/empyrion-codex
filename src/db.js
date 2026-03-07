/**
 * Lightweight IndexedDB wrapper for persisting scenario data across browser sessions.
 * Database: empyrion-codex  |  Store: scenarios
 */

const DB_NAME    = 'empyrion-codex';
const DB_VERSION = 1;
const STORE      = 'scenarios';

/** @returns {Promise<IDBDatabase>} */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = /** @type {IDBDatabase} */ (e.target.result);
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = (e) => resolve(/** @type {IDBDatabase} */ (e.target.result));
    req.onerror   = (e) => reject(e.target.error);
  });
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

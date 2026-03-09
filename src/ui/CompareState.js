/**
 * CompareState.js
 *
 * Observable state container for the items currently pinned for side-by-side
 * comparison.
 */

/** Maximum number of items that can be pinned simultaneously. */
export const MAX_COMPARE_ITEMS = 4;

export class CompareState {
  constructor() {
    /** @type {import('../parsers/models/Item.js').Item[]} */
    this._items = [];
    /** @type {Set<Function>} */
    this._listeners = new Set();
  }

  // ── Accessors ──────────────────────────────────────────────────────────────

  /** @returns {import('../parsers/models/Item.js').Item[]} Shallow copy of pinned items. */
  get items() { return [...this._items]; }

  /** @returns {number} Number of currently pinned items. */
  get count() { return this._items.length; }

  /** @returns {boolean} True when the maximum number of items is already pinned. */
  get isFull() { return this._items.length >= MAX_COMPARE_ITEMS; }

  // ── Mutations ─────────────────────────────────────────────────────────────

  /**
   * Pins an item for comparison.
   * Returns `false` (without notifying) if the item is already pinned or the
   * set is full.
   * @param {import('../parsers/models/Item.js').Item} item
   * @returns {boolean} Whether the item was added.
   */
  add(item) {
    if (this.has(item.name) || this._items.length >= MAX_COMPARE_ITEMS) return false;
    this._items.push(item);
    this._notify();
    return true;
  }

  /**
   * Removes a pinned item by its devName.
   * Returns `false` (without notifying) if not found.
   * @param {string} name
   * @returns {boolean} Whether the item was removed.
   */
  remove(name) {
    const idx = this._items.findIndex(i => i.name === name);
    if (idx === -1) return false;
    this._items.splice(idx, 1);
    this._notify();
    return true;
  }

  /**
   * Toggles an item's pinned state.
   * If already pinned it is removed; otherwise it is added (if not full).
   * Returns the new pinned state (`true` = now pinned, `false` = now removed,
   * `null` = not added because the set is full).
   * @param {import('../parsers/models/Item.js').Item} item
   * @returns {boolean|null}
   */
  toggle(item) {
    if (this.has(item.name)) { this.remove(item.name); return false; }
    if (this.isFull) return null;
    this.add(item); return true;
  }

  /**
   * Returns `true` if an item with the given devName is pinned.
   * @param {string} name
   * @returns {boolean}
   */
  has(name) {
    return this._items.some(i => i.name === name);
  }

  /**
   * Clears all pinned items. No-op (no notification) if already empty.
   */
  clear() {
    if (!this._items.length) return;
    this._items = [];
    this._notify();
  }

  // ── Observers ─────────────────────────────────────────────────────────────

  /**
   * Registers a callback invoked whenever the comparison set changes.
   * The callback receives a shallow copy of the current pinned items array.
   * @param {function(import('../parsers/models/Item.js').Item[]): void} fn
   */
  onChange(fn) { this._listeners.add(fn); }

  /**
   * Removes a previously registered change callback.
   * @param {function} fn
   */
  offChange(fn) { this._listeners.delete(fn); }

  /**
   * Moves a pinned item one position left (-1) or right (+1).
   * No-op if already at the boundary.
   * @param {string} name  devName of the item to move
   * @param {-1|1}   dir
   * @returns {boolean} Whether a reorder happened.
   */
  move(name, dir) {
    const idx = this._items.findIndex(i => i.name === name);
    if (idx === -1) return false;
    const target = idx + dir;
    if (target < 0 || target >= this._items.length) return false;
    [this._items[idx], this._items[target]] = [this._items[target], this._items[idx]];
    this._notify();
    return true;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  _notify() {
    const snapshot = this.items;
    for (const fn of this._listeners) fn(snapshot);
  }
}

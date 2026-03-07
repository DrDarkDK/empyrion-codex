/**
 * Shared rendering utilities used across UI renderers.
 * Centralises escaping, number formatting, and trader-price helpers
 * to avoid duplication.
 */

/** @param {string} str */
export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Formats a numeric value with '.' as thousands separator and ',' as decimal separator.
 * Non-numeric values are returned unchanged.
 * @param {string|number|null} value
 * @returns {string}
 */
export function formatNumber(value) {
  if (value == null || value === '') return String(value ?? '');
  if (typeof value === 'boolean') return String(value);
  if (value === 'true' || value === 'false') return value;
  const n = Number(value);
  if (isNaN(n)) return String(value);
  const [intPart, decPart] = String(n).split('.');
  const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return decPart ? `${intFormatted},${decPart}` : intFormatted;
}

/**
 * Formats a trader price field for display.
 * Multiplier ranges ("mf=1.0-1.25") → "×1.0–1.25", absolute ranges → "500–600".
 * @param {string|number|null} raw
 * @returns {string|null}
 */
export function formatPrice(raw) {
  if (!raw || raw === '0') return null;
  if (String(raw).startsWith('mf=')) {
    return '\u00d7' + String(raw).slice(3).replace(/-/g, '\u2013');
  }
  const [lo, hi] = String(raw).split('-');
  if (hi === undefined) return formatNumber(lo);
  const same = lo.trim() === hi.trim();
  return same ? formatNumber(lo.trim()) : `${formatNumber(lo.trim())}\u2013${formatNumber(hi.trim())}`;
}

/**
 * Parses a quantity field (e.g. "5-10" or "50") into a {lo, hi} range.
 * @param {string|null} qtyStr
 * @returns {{ lo: number, hi: number } | null}
 */
export function parseQtyRange(qtyStr) {
  if (!qtyStr) return null;
  const parts = String(qtyStr).split('-');
  const lo = Number(parts[0].trim());
  const hi = parts[1] != null ? Number(parts[1].trim()) : lo;
  return { lo, hi };
}

/**
 * Estimates a price range from a trader price field (e.g. "mf=1.0-1.25" or "500-1000").
 * Returns null when the price cannot be determined (mf= without a market price).
 * @param {string|null} mfOrAbsolute
 * @param {number|null} marketPrice
 * @returns {{ lo: number, hi: number } | null}
 */
export function estimatePriceRange(mfOrAbsolute, marketPrice) {
  if (!mfOrAbsolute || mfOrAbsolute === '0') return null;
  const s = String(mfOrAbsolute).trim();
  if (s.startsWith('mf=')) {
    if (marketPrice == null) return null;
    const parts = s.slice(3).split('-');
    const lo = parseFloat(parts[0]);
    const hi = parts[1] != null ? parseFloat(parts[1]) : lo;
    return { lo: Math.round(lo * marketPrice), hi: Math.round(hi * marketPrice) };
  }
  const parts = s.split('-');
  const lo = Number(parts[0].trim());
  const hi = parts[1] != null ? Number(parts[1].trim()) : lo;
  if (lo === 0 && hi === 0) return null;
  return { lo, hi };
}

/**
 * Shared WeakMap tracking the single active click handler per container element
 * across all renderers. Using one map ensures that registering a handler from
 * any renderer always evicts a stale handler left by a different renderer on
 * the same element.
 */
const _containerHandlers = new WeakMap();

/**
 * Registers a delegated click handler on a container element, replacing
 * any previously registered handler regardless of which renderer added it.
 * Pass `null` as the handler to only clear an existing handler.
 * @param {HTMLElement} el
 * @param {((e: MouseEvent) => void) | null} handler
 */
export function setContainerClickHandler(el, handler) {
  if (_containerHandlers.has(el)) {
    el.removeEventListener('click', _containerHandlers.get(el));
    _containerHandlers.delete(el);
  }
  if (handler) {
    _containerHandlers.set(el, handler);
    el.addEventListener('click', handler);
  }
}

/**
 * Adapter that loads parserConfig.json and re-exports the values the parsers
 * need. All editable data lives in parserConfig.json — this file is plumbing only.
 */
import config from '../parserConfig.json' with { type: 'json' };

// ── Discard filters (arrays, for use with .some()) ───────────────────────────
export const NAME_FILTER_SUBSTRINGS        = config.discard.nameSubstrings;
export const DESCRIPTION_FILTER_SUBSTRINGS = config.discard.descriptionSubstrings;

/**
 * Returns true if a raw EcfBlock should be silently discarded at parse time.
 *
 * Name check: matches the Name header attribute against nameSubstrings.
 * Description check: matches the Info header attribute AND every body
 *   property value against descriptionSubstrings.
 *
 * In Empyrion ECF, Info is a header-line attribute (stored in block.attributes),
 * not a body property — so we must check attributes explicitly.
 *
 * @param {import('./ecf/EcfBlock.js').EcfBlock} block
 * @returns {boolean}
 */
export function shouldDiscard(block) {
  const name = block.attributes['Name'];
  if (name != null) {
    const n = String(name);
    if (NAME_FILTER_SUBSTRINGS.some(sub => n.includes(sub))) return true;
  }

  // Check all header attributes (covers Info, which lives on the header line)
  for (const attrVal of Object.values(block.attributes)) {
    const s = String(attrVal ?? '');
    if (DESCRIPTION_FILTER_SUBSTRINGS.some(sub => s.includes(sub))) return true;
  }

  // Also check body properties (belt-and-suspenders for any ECF variant)
  for (const prop of block.properties) {
    const val = String(prop.value ?? '');
    if (DESCRIPTION_FILTER_SUBSTRINGS.some(sub => val.includes(sub))) return true;
  }

  return false;
}

// ── Item parser config ───────────────────────────────────────────────────────
export const BLOCKED_TOP_PROPS    = new Set(config.items.blockedTopProps);
export const BLOCKED_CHILD_PROPS  = new Set(config.items.blockedChildProps);
export const ALLOWED_CHILD_CLASSES = new Set(config.items.allowedChildClasses);

// ── Block parser config ──────────────────────────────────────────────────────
export const BLOCKED_PROPS = new Set(config.blocks.blockedProps);

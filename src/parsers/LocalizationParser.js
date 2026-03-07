/**
 * Strips Empyrion rich-text formatting tags such as:
 *   [c], [/c], [fc674d], [-], [u], [/u], etc.
 * @param {string} str
 * @returns {string}
 */
export function stripFormatting(str) {
  return str.replace(/\[[^\]]*\]/g, '').trim();
}

/**
 * Converts Empyrion rich-text tags to safe HTML spans.
 * Supports: [RRGGBB] → color span, [-] → close span,
 *           [u]/[/u] → underline span, [c]/[/c] → no-op,
 *           unknown tags → silently stripped.
 * @param {string} str
 * @returns {string} HTML string (safe, no XSS)
 */
export function formatRichText(str) {
  if (!str) return '';
  const esc = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  let result = '';
  let i = 0;
  let openSpans = 0;
  while (i < str.length) {
    if (str[i] !== '[') {
      const next = str.indexOf('[', i);
      const text = next === -1 ? str.slice(i) : str.slice(i, next);
      result += esc(text);
      i = next === -1 ? str.length : next;
      continue;
    }
    const end = str.indexOf(']', i);
    if (end === -1) { result += esc(str.slice(i)); break; }
    const tag = str.slice(i + 1, end);
    i = end + 1;
    if (tag === 'c' || tag === '/c') { /* structural hint, no-op */ }
    else if (tag === '-') { if (openSpans > 0) { result += '</span>'; openSpans--; } }
    else if (tag === 'u') { result += '<span style="text-decoration:underline">'; openSpans++; }
    else if (tag === '/u') { if (openSpans > 0) { result += '</span>'; openSpans--; } }
    else if (/^[0-9A-Fa-f]{6}$/.test(tag)) { result += `<span style="color:#${tag}">`; openSpans++; }
    // unknown tags → stripped silently
  }
  while (openSpans-- > 0) result += '</span>';
  return result;
}

/**
 * Reads exactly the first two comma-separated columns from a single CSV line,
 * respecting double-quoted fields (RFC-4180 quoting, "" = escaped quote).
 * Stops parsing as soon as both columns are collected for efficiency.
 *
 * @param {string} line
 * @returns {[string, string] | null} [col0, col1], or null if the line is blank
 */
function parseTwoColumns(line) {
  const cols = [];
  let i = 0;

  while (i < line.length && cols.length < 2) {
    if (line[i] === '"') {
      let val = '';
      i++; // skip opening quote
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') {
          val += '"';
          i += 2;
        } else if (line[i] === '"') {
          i++; // skip closing quote
          break;
        } else {
          val += line[i++];
        }
      }
      cols.push(val);
      if (line[i] === ',') i++;
    } else {
      const end = line.indexOf(',', i);
      if (end === -1) {
        cols.push(line.slice(i));
        break;
      }
      cols.push(line.slice(i, end));
      i = end + 1;
    }
  }

  if (cols.length === 0) return null;
  return [cols[0].trim(), (cols[1] ?? '').trim()];
}

/**
 * Parses a Localization.csv file into a Map of devName → display name.
 *
 * Only columns 0 (devName) and 1 (English) are ever read per line;
 * all remaining columns are ignored without being allocated.
 * Rows where the English column is empty are omitted — callers fall back
 * to the devName themselves.
 */
export class LocalizationParser {
  /**
   * @param {string} text - Raw CSV file content
   * @returns {Map<string, string>} devName → localized display name
   */
  parse(text) {
    const map = new Map();
    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;

      const cols = parseTwoColumns(line);
      if (!cols) continue;

      const [devName, rawEnglish] = cols;
      if (!devName) continue;

      if (rawEnglish) map.set(devName, rawEnglish);
    }
    return map;
  }
}

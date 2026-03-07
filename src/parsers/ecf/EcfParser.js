import { EcfBlock } from './EcfBlock.js';
import { EcfProperty } from './EcfProperty.js';

/**
 * Parses raw ECF config text into a tree of EcfBlock objects.
 *
 * ECF is a hierarchical key-value config format used by Empyrion - Galactic Survival.
 * It is similar in spirit to YAML but uses a custom brace-based block syntax.
 *
 * Supported syntax:
 *   - Block open:     { +TypeName Key: val, Key: val ... }
 *   - Child block:    { Child N }
 *   - Block close:    }
 *   - Property:       Key: value[, attr: val, attr: val]*
 *   - Full comment:   # entire line is a comment
 *   - Inline comment: Key: value  # trailing comment
 *   - Quoted values:  AllowAt: "UnderWater, Planet, Space"
 */
export class EcfParser {
  /**
   * @param {string} text - Raw ECF file content
   * @returns {EcfBlock[]} Top-level blocks
   */
  parse(text) {
    const lines = text.split('\n');
    /** @type {EcfBlock[]} */
    const rootBlocks = [];
    /** @type {EcfBlock[]} */
    const stack = [];

    for (const rawLine of lines) {
      const line = this._stripComment(rawLine).trim();
      if (!line) continue;

      if (line.startsWith('{')) {
        const block = this._parseBlockHeader(line);
        if (stack.length === 0) {
          rootBlocks.push(block);
        } else {
          stack[stack.length - 1].children.push(block);
        }
        stack.push(block);
      } else if (line === '}') {
        if (stack.length > 0) stack.pop();
      } else {
        if (stack.length > 0) {
          const property = this._parseProperty(line);
          if (property) stack[stack.length - 1].properties.push(property);
        }
      }
    }

    return rootBlocks;
  }

  /**
   * Removes full-line and inline comments, respecting quoted strings.
   * @param {string} line
   * @returns {string}
   */
  _stripComment(line) {
    if (line.trimStart().startsWith('#')) return '';

    let inQuote = false;
    let quoteChar = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (!inQuote && (ch === '"' || ch === "'")) {
        inQuote = true;
        quoteChar = ch;
      } else if (inQuote && ch === quoteChar) {
        inQuote = false;
      } else if (!inQuote && ch === '#') {
        return line.slice(0, i);
      }
    }
    return line;
  }

  /**
   * Parses a block header line such as:
   *   `{ +Item Id: 7, Name: Sniper`  → type="Item", modifier="+", attributes={Id:7, Name:"Sniper"}
   *   `{ Child 0`                    → type="Child", modifier="",  attributes={_index:0}
   * @param {string} line
   * @returns {EcfBlock}
   */
  _parseBlockHeader(line) {
    const content = line.slice(1).trim(); // strip leading '{'

    const spaceIdx = content.indexOf(' ');
    const typeToken = spaceIdx === -1 ? content : content.slice(0, spaceIdx);
    const rest = spaceIdx === -1 ? '' : content.slice(spaceIdx + 1).trim();

    const modifier = '+-@'.includes(typeToken[0]) ? typeToken[0] : '';
    const type = modifier ? typeToken.slice(1) : typeToken;

    const attributes = {};
    if (rest) {
      for (const part of this._splitByComma(rest)) {
        const trimmedPart = part.trim();
        if (!trimmedPart) continue;
        const colonIdx = trimmedPart.indexOf(':');
        if (colonIdx === -1) {
          // Positional value — either a numeric index ("Child 0") or a named
          // label ("Child DropOnDestroy"). Stored as "_label" for uniform access.
          attributes['_label'] = this._coerceValue(trimmedPart);
        } else {
          const key = trimmedPart.slice(0, colonIdx).trim();
          const val = this._coerceValue(trimmedPart.slice(colonIdx + 1).trim());
          attributes[key] = val;
        }
      }
    }

    return new EcfBlock(type, modifier, attributes);
  }

  /**
   * Parses a property line such as:
   *   `Mass: 9.1, type: float, display: true, formatter: Kilogram`
   * @param {string} line
   * @returns {EcfProperty|null}
   */
  _parseProperty(line) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) return null;

    const key = line.slice(0, colonIdx).trim();
    const rest = line.slice(colonIdx + 1).trim();
    const parts = this._splitByComma(rest);

    const value = this._coerceValue(parts[0]?.trim() ?? '');
    const attributes = {};

    for (let i = 1; i < parts.length; i++) {
      const part = parts[i].trim();
      const attrColon = part.indexOf(':');
      if (attrColon !== -1) {
        const attrKey = part.slice(0, attrColon).trim();
        const attrVal = this._coerceValue(part.slice(attrColon + 1).trim());
        attributes[attrKey] = attrVal;
      }
    }

    return new EcfProperty(key, value, attributes);
  }

  /**
   * Splits a string by commas while respecting quoted substrings.
   * @param {string} str
   * @returns {string[]}
   */
  _splitByComma(str) {
    const parts = [];
    let current = '';
    let inQuote = false;
    let quoteChar = '';

    for (const ch of str) {
      if (!inQuote && (ch === '"' || ch === "'")) {
        inQuote = true;
        quoteChar = ch;
        current += ch;
      } else if (inQuote && ch === quoteChar) {
        inQuote = false;
        current += ch;
      } else if (!inQuote && ch === ',') {
        parts.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim()) parts.push(current);
    return parts;
  }

  /**
   * Coerces a raw string to the most appropriate JS primitive type.
   * @param {string} raw
   * @returns {string|number|boolean}
   */
  _coerceValue(raw) {
    if (!raw) return '';
    if ((raw.startsWith('"') && raw.endsWith('"')) ||
        (raw.startsWith("'") && raw.endsWith("'"))) {
      return raw.slice(1, -1);
    }
    const lower = raw.toLowerCase();
    if (lower === 'true') return true;
    if (lower === 'false') return false;
    const num = Number(raw);
    if (raw !== '' && !isNaN(num)) return num;
    return raw;
  }
}

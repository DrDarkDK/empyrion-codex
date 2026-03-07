/**
 * Represents a top-level or nested block in an ECF config file.
 *
 * ECF example:
 *   { +Item Id: 7, Name: Sniper
 *     Meshfile: ...
 *     { Child 0
 *       Class: Ranged
 *     }
 *   }
 */
export class EcfBlock {
  /**
   * @param {string} type       - Block type, e.g. "Item", "Child", "Block", "Trader"
   * @param {string} modifier   - Modifier prefix: "+" (add/override), "-" (remove), or ""
   * @param {Record<string, string|number|boolean>} attributes - Header key-value pairs (Id, Name, etc.).
   *   Positional child labels (e.g. "Child 0", "Child DropOnDestroy") are stored under the "_label" key.
   */
  constructor(type, modifier = '', attributes = {}) {
    this.type = type;
    this.modifier = modifier;
    this.attributes = attributes;

    /** @type {import('./EcfProperty.js').EcfProperty[]} */
    this.properties = [];

    /** @type {EcfBlock[]} */
    this.children = [];
  }

  /**
   * Returns the first property matching the given key, or undefined.
   * @param {string} key
   * @returns {import('./EcfProperty.js').EcfProperty|undefined}
   */
  getProperty(key) {
    return this.properties.find(p => p.key === key);
  }

  /**
   * Returns the value of the first property matching the key, or a default.
   * @param {string} key
   * @param {*} defaultValue
   * @returns {string|number|boolean|null}
   */
  getPropertyValue(key, defaultValue = null) {
    return this.getProperty(key)?.value ?? defaultValue;
  }
}

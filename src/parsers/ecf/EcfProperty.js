/**
 * Represents a single property within an ECF block.
 *
 * ECF example:  `Mass: 9.1, type: float, display: true, formatter: Kilogram`
 * Result:       { key: "Mass", value: 9.1, attributes: { type: "float", display: true, formatter: "Kilogram" } }
 */
export class EcfProperty {
  /**
   * @param {string} key
   * @param {string|number|boolean} value
   * @param {Record<string, string|number|boolean>} attributes - Inline metadata (type, display, formatter, etc.)
   */
  constructor(key, value, attributes = {}) {
    this.key = key;
    this.value = value;
    this.attributes = attributes;
  }
}

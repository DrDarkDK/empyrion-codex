/**
 * Domain model for a parsed crafting recipe from Templates.ecf.
 */
export class Template {
  /**
   * @param {object} data
   * @param {string|null}                        data.name        - DevName, matches the item/block that crafts this
   * @param {number|null}                        data.craftTime   - Craft time in seconds
   * @param {number}                             data.outputCount - How many items are produced (default 1)
   * @param {string[]}                           data.target      - Station codes e.g. ["BaseC", "SmallC"]
   * @param {Array<{name: string, qty: number}>} data.inputs      - Ingredient list
   */
  constructor(data) {
    this.name        = data.name        ?? null;
    this.craftTime   = data.craftTime   ?? null;
    this.outputCount = data.outputCount ?? 1;
    this.target      = data.target      ?? [];
    this.inputs      = data.inputs      ?? [];
  }
}

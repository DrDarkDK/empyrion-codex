/**
 * Domain model for a parsed item from ItemsConfig.ecf.
 */
export class Item {
  /**
   * @param {object} data
   * @param {number|null}   data.id
   * @param {string|null}   data.name
   * @param {string|null}   data.recipeName   - Recipe lookup key (falls back to name)
   * @param {string|null}   data.material
   * @param {string|null}   data.category
   * @param {number|null}   data.mass
   * @param {number|null}   data.volume
   * @param {number|null}   data.stackSize
   * @param {number|null}   data.durability
   * @param {number|null}   data.unlockLevel
   * @param {number|null}   data.unlockCost
   * @param {number|null}   data.marketPrice
   * @param {boolean}        data.showUser     - Whether the item is visible to players
   * @param {import('../ecf/EcfProperty.js').EcfProperty[]} data.properties - All raw properties for extended access
   * @param {import('../ecf/EcfBlock.js').EcfBlock[]}       data.children   - Child blocks (weapon class, etc.)
   */
  constructor(data) {
    this.id         = data.id         ?? null;
    this.name       = data.name       ?? null;
    this.recipeName = data.recipeName ?? null;
    this.material   = data.material   ?? null;
    this.damageMultiplierGroup = data.damageMultiplierGroup ?? null;
    /** @type {{ directMultipliers: import('../DamageMultiplierConfigParser.js').DamageMultiplierEntry[], blastMultipliers: import('../DamageMultiplierConfigParser.js').DamageMultiplierEntry[] } | null} */
    this.inlineDamageMultipliers = data.inlineDamageMultipliers ?? null;
    this.category   = data.category   ?? null;
    this.mass       = data.mass       ?? null;
    this.volume     = data.volume     ?? null;
    this.stackSize  = data.stackSize  ?? null;
    this.durability = data.durability ?? null;
    this.unlockLevel = data.unlockLevel ?? null;
    this.unlockCost  = data.unlockCost  ?? null;
    this.marketPrice = data.marketPrice ?? null;
    this.showUser   = data.showUser   ?? true;
    this.properties = data.properties ?? [];
    this.children   = data.children   ?? [];
  }
}

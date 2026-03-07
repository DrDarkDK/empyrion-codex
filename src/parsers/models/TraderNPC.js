/**
 * @typedef {{ devName: string, isSelling: boolean, isBuying: boolean, sellQtyRange: string|null, sellMfRange: string|null, buyQtyRange: string|null, buyMfRange: string|null }} TraderItem
 */

/**
 * Domain model for a parsed trader from TraderNPCConfig.ecf.
 */
export class TraderNPC {
  /**
   * @param {object} data
   * @param {string|null}   data.name          - Trader identifier (Name in block header)
   * @param {string|null}   data.sellingText   - Display text shown to the player
   * @param {string[]}      data.sellingGoods  - Category tags (e.g. ["trwAmmo", "trwWeaponsBasic"])
   * @param {number|null}   data.discount      - Discount fraction (e.g. 0.08 = 8%)
   * @param {TraderItem[]}  data.sellingItems  - Items the trader sells to the player
   * @param {TraderItem[]}  data.buyingItems   - Items the trader buys from the player
   * @param {import('../ecf/EcfProperty.js').EcfProperty[]} data.properties - All raw properties
   * @param {import('../ecf/EcfBlock.js').EcfBlock[]}       data.children   - Child blocks, if any
   */
  constructor(data) {
    this.name         = data.name         ?? null;
    this.sellingText  = data.sellingText  ?? null;
    this.sellingGoods = data.sellingGoods ?? [];
    this.discount     = data.discount     ?? null;
    /** @type {TraderItem[]} */
    this.sellingItems = data.sellingItems ?? [];
    /** @type {TraderItem[]} */
    this.buyingItems  = data.buyingItems  ?? [];
    this.properties   = data.properties   ?? [];
    this.children     = data.children     ?? [];
  }
}

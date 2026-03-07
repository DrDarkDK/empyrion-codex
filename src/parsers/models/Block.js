/**
 * Domain model for a parsed block from BlocksConfig.ecf.
 */
export class Block {
  /**
   * @param {object} data
   * @param {number|null}        data.id
   * @param {string|null}        data.name
   * @param {string|null}        data.material
   * @param {string|null}        data.group       - Display/logical group
   * @param {number|null}        data.hp          - Hit points (not always present)
   * @param {number|null}        data.mass
   * @param {number|null}        data.volume
   * @param {string|null}        data.category
   * @param {number|null}        data.marketPrice
   * @param {string[]}           data.childBlocks - DevNames of variant blocks
   * @param {import('../ecf/EcfProperty.js').EcfProperty[]} data.properties
   * @param {import('../ecf/EcfBlock.js').EcfBlock[]}       data.children
   */
  constructor(data) {
    this.id          = data.id          ?? null;
    this.name        = data.name        ?? null;
    this.material    = data.material    ?? null;
    this.group       = data.group       ?? null;
    this.hp          = data.hp          ?? null;
    this.mass        = data.mass        ?? null;
    this.volume      = data.volume      ?? null;
    this.category    = data.category    ?? null;
    this.marketPrice = data.marketPrice ?? null;
    this.showUser    = data.showUser    ?? true;
    this.childBlocks = data.childBlocks ?? [];
    this.properties  = data.properties  ?? [];
    this.children    = data.children    ?? [];
  }
}

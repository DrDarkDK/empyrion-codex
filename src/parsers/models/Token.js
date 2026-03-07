/**
 * Domain model for a parsed token from TokenConfig.ecf.
 */
export class Token {
  /**
   * @param {object} data
   * @param {number|null}  data.id
   * @param {string|null}  data.name
   * @param {string|null}  data.description
   * @param {string|null}  data.customIcon
   * @param {number|null}  data.marketPrice
   * @param {boolean}      data.removeOnUse
   */
  constructor(data) {
    this.id          = data.id          ?? null;
    this.name        = data.name        ?? null;
    this.description = data.description ?? null;
    this.customIcon  = data.customIcon  ?? null;
    this.marketPrice = data.marketPrice ?? null;
    this.removeOnUse = data.removeOnUse ?? false;
  }
}

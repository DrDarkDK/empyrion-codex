/**
 * Domain model for a parsed material from MaterialConfig.ecf.
 */
export class Material {
  /**
   * @param {object} data
   * @param {string|null} data.name           - Material devName (e.g. "WeaponLarge")
   * @param {string|null} data.damageCategory - Damage category key (e.g. "weaponlarge")
   */
  constructor(data) {
    this.name           = data.name           ?? null;
    this.damageCategory = data.damageCategory ?? null;
  }
}

/**
 * Domain model for a parsed damage multiplier group from DamageMultiplierConfig.ecf.
 */
export class DamageMultiplier {
  /**
   * @param {object} data
   * @param {string|null} data.name                 - Group devName (e.g. "CVLaserCannonT1")
   * @param {DamageMultiplierEntry[]} data.directMultipliers - Direct-hit damage multipliers
   * @param {DamageMultiplierEntry[]} data.blastMultipliers  - Blast/AoE damage multipliers
   */
  constructor(data) {
    this.name               = data.name               ?? null;
    this.directMultipliers  = data.directMultipliers  ?? [];
    this.blastMultipliers   = data.blastMultipliers   ?? [];
  }
}

/**
 * @typedef {object} DamageMultiplierEntry
 * @property {number}   multiplier  - Damage multiplier value (e.g. 1.5)
 * @property {string[]} categories  - Lower-cased damage category keys this entry applies to
 */

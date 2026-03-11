import { BaseConfigParser } from './BaseConfigParser.js';
import { Material } from './models/Material.js';

/**
 * Parses MaterialConfig.ecf into an array of {@link Material} objects.
 */
export class MaterialsConfigParser extends BaseConfigParser {
  /**
   * @param {import('./ecf/EcfBlock.js').EcfBlock[]} blocks
   * @returns {Material[]}
   */
  transform(blocks) {
    return blocks
      .filter(block => block.type === 'Material')
      .map(block => new Material({
        name:           block.attributes['Name'] ?? null,
        damageCategory: block.getPropertyValue('damage_category') ?? null,
      }));
  }
}

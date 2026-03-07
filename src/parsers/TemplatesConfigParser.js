import { BaseConfigParser } from './BaseConfigParser.js';
import { Template } from './models/Template.js';

/**
 * Parses Templates.ecf into an array of {@link Template} objects.
 *
 * ECF format:
 *   { +Template Name: Eden_Telepad
 *     CraftTime: 10
 *     Target: "BaseC,SmallC,LargeC,AdvC"
 *     { Child Inputs
 *       Oscillator: 8
 *       FluxCoil: 4
 *     }
 *   }
 */
export class TemplatesConfigParser extends BaseConfigParser {
  /**
   * @param {import('./ecf/EcfBlock.js').EcfBlock[]} blocks
   * @returns {Template[]}
   */
  transform(blocks) {
    return blocks
      .filter(b => b.type === 'Template')
      .map(b => this._transformTemplate(b));
  }

  /**
   * @param {import('./ecf/EcfBlock.js').EcfBlock} block
   * @returns {Template}
   */
  _transformTemplate(block) {
    // The "Child Inputs" block holds ingredient name → quantity as properties
    const inputsChild = block.children.find(c => c.attributes['_label'] === 'Inputs');
    const inputs = inputsChild
      ? inputsChild.properties.map(p => ({ name: String(p.key), qty: Number(p.value) }))
      : [];

    const targetRaw = block.getPropertyValue('Target');
    const target = targetRaw
      ? String(targetRaw).replace(/^"|"$/g, '').split(',').map(s => s.trim()).filter(Boolean)
      : [];

    return new Template({
      name:        block.attributes['Name'] ?? null,
      craftTime:   block.getPropertyValue('CraftTime') != null
        ? Number(block.getPropertyValue('CraftTime'))
        : null,
      outputCount: block.getPropertyValue('OutputCount') != null
        ? Number(block.getPropertyValue('OutputCount'))
        : 1,
      target,
      inputs,
    });
  }
}

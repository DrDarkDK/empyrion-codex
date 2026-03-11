import { BaseConfigParser } from './BaseConfigParser.js';
import { DamageMultiplier } from './models/DamageMultiplier.js';

const DIRECT_MULTIPLIER_KEY = /^DamageMultiplier_\d+$/i;
const BLAST_MULTIPLIER_KEY  = /^BlastDamageMultiplier_\d+$/i;

/**
 * Parses DamageMultiplierConfig.ecf into an array of {@link DamageMultiplier} objects.
 */
export class DamageMultiplierConfigParser extends BaseConfigParser {
  /**
   * @param {import('./ecf/EcfBlock.js').EcfBlock[]} blocks
   * @returns {DamageMultiplier[]}
   */
  transform(blocks) {
    const groupBlocks = blocks.filter(block => block.type === 'DamageMultiplierGroup');

    // ── First pass: parse each group as-is ──────────────────────────────────
    const parsed = groupBlocks.map(block => this._transformGroup(block));
    const byName = new Map(parsed.map(g => [g.name, g]));

    // ── Second pass: resolve Collection groups ───────────────────────────────
    // A collection group has no DamageMultiplier_x entries of its own; instead
    // it carries a Collection property listing sub-group names to merge.
    for (const block of groupBlocks) {
      const collectionVal = block.getPropertyValue('Collection');
      if (!collectionVal) continue;
      const group = byName.get(block.attributes['Name'] ?? null);
      if (!group) continue;
      const subNames = String(collectionVal)
        .replace(/^"|"$/g, '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      for (const subName of subNames) {
        const sub = byName.get(subName);
        if (!sub) continue;
        group.directMultipliers.push(...sub.directMultipliers);
        group.blastMultipliers.push(...sub.blastMultipliers);
      }
    }

    return parsed;
  }

  /**
   * @param {import('./ecf/EcfBlock.js').EcfBlock} block
   * @returns {DamageMultiplier}
   */
  _transformGroup(block) {
    const directMultipliers = [];
    const blastMultipliers  = [];

    for (const prop of block.properties) {
      const isDirect = DIRECT_MULTIPLIER_KEY.test(prop.key);
      const isBlast  = BLAST_MULTIPLIER_KEY.test(prop.key);
      if (!isDirect && !isBlast) continue;

      const param1      = prop.attributes['param1'];
      const categories  = param1
        ? String(param1).split('|').map(s => s.trim().toLowerCase()).filter(Boolean)
        : [];

      const entry = { multiplier: Number(prop.value), categories };
      if (isDirect) directMultipliers.push(entry);
      else          blastMultipliers.push(entry);
    }

    return new DamageMultiplier({
      name: block.attributes['Name'] ?? null,
      directMultipliers,
      blastMultipliers,
    });
  }
}

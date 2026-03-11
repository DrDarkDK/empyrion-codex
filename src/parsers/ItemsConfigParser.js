import { BaseConfigParser } from './BaseConfigParser.js';
import { Item } from './models/Item.js';
import {
  BLOCKED_TOP_PROPS,
  BLOCKED_CHILD_PROPS,
  ALLOWED_CHILD_CLASSES,
  shouldDiscard,
} from './parserConfig.js';

const DIRECT_MULTIPLIER_KEY = /^DamageMultiplier_\d+$/i;
const BLAST_MULTIPLIER_KEY  = /^BlastDamageMultiplier_\d+$/i;

/**
 * Parses ItemsConfig.ecf into an array of {@link Item} objects.
 */
export class ItemsConfigParser extends BaseConfigParser {
  /**
   * @param {import('./ecf/EcfBlock.js').EcfBlock[]} blocks
   * @returns {Item[]}
   */
  transform(blocks) {
    const rawItemBlocks = blocks.filter(b => b.type === 'Item' && !shouldDiscard(b));
    // Build name→raw-block map so _resolveDamageMultiplierGroup can follow Ref chains.
    const blockByName = new Map(rawItemBlocks.map(b => [b.attributes['Name'], b]));
    return rawItemBlocks.map(block => this._transformItem(block, blockByName));
  }

  /**
   * Resolves DamageMultiplierGroup by checking the block's own children/properties,
   * then recursively following the Ref inheritance chain.
   * Weapon items in Empyrion ECF are often sparse overrides (only StackSize/Mass)
   * that inherit their Ranged child — and its DamageMultiplierGroup — from a parent.
   * @param {import('./ecf/EcfBlock.js').EcfBlock} block
   * @param {Map<string, import('./ecf/EcfBlock.js').EcfBlock>} blockByName
   * @param {Set<string>} visited - guards against circular Ref chains
   * @returns {string|null}
   */
  _resolveDamageMultiplierGroup(block, blockByName, visited) {
    const name = block.attributes['Name'];
    if (name != null) {
      const key = String(name);
      if (visited.has(key)) return null;
      visited.add(key);
    }
    // Header attribute form: { Ranged DamageMultiplier_Group: X ... }
    const attrVal = block.attributes['DamageMultiplier_Group'];
    if (attrVal != null) return String(attrVal);
    // Body property form (top-level or inside a child block)
    const topVal = block.getPropertyValue('DamageMultiplier_Group');
    if (topVal != null) return String(topVal);
    for (const child of block.children) {
      const val = child.attributes['DamageMultiplier_Group'] ?? child.getPropertyValue('DamageMultiplier_Group');
      if (val != null) return String(val);
    }
    // Follow Ref chain
    const ref = block.attributes['Ref'];
    if (ref != null) {
      const parent = blockByName.get(String(ref));
      if (parent) return this._resolveDamageMultiplierGroup(parent, blockByName, visited);
    }
    return null;
  }

  /**
   * Extracts inline DamageMultiplier_x / BlastDamageMultiplier_x entries from
   * a block's children (not from DamageMultiplierConfig.ecf). Returns a
   * directMultipliers/blastMultipliers object compatible with DamageMultiplier,
   * or null if no inline entries are found. Follows Ref chains.
   *
   * @param {import('./ecf/EcfBlock.js').EcfBlock} block
   * @param {Map<string, import('./ecf/EcfBlock.js').EcfBlock>} blockByName
   * @param {Set<string>} visited
   * @returns {{ directMultipliers: object[], blastMultipliers: object[] } | null}
   */
  _extractInlineDamageMultipliers(block, blockByName, visited) {
    const name = block.attributes['Name'];
    if (name != null) {
      const key = String(name);
      if (visited.has(key)) return null;
      visited.add(key);
    }

    const directMultipliers = [];
    const blastMultipliers  = [];

    for (const child of block.children) {
      for (const prop of child.properties) {
        const isDirect = DIRECT_MULTIPLIER_KEY.test(prop.key);
        const isBlast  = BLAST_MULTIPLIER_KEY.test(prop.key);
        if (!isDirect && !isBlast) continue;

        const param1 = prop.attributes['param1'];
        const categories = param1
          ? String(param1).split('|').map(s => s.trim().toLowerCase()).filter(Boolean)
          : [];

        const entry = { multiplier: Number(prop.value), categories };
        if (isDirect) directMultipliers.push(entry);
        else          blastMultipliers.push(entry);
      }
    }

    if (directMultipliers.length > 0 || blastMultipliers.length > 0) {
      return { directMultipliers, blastMultipliers };
    }

    // Follow Ref chain if no inline entries found directly
    const ref = block.attributes['Ref'];
    if (ref != null) {
      const parent = blockByName.get(String(ref));
      if (parent) return this._extractInlineDamageMultipliers(parent, blockByName, visited);
    }
    return null;
  }

  /**
   * @param {import('./ecf/EcfBlock.js').EcfBlock} block
   * @param {Map<string, import('./ecf/EcfBlock.js').EcfBlock>} blockByName
   * @returns {Item}
   */
  _transformItem(block, blockByName) {
    const filteredProps = block.properties.filter(p => !BLOCKED_TOP_PROPS.has(p.key));

    const damageMultiplierGroup = this._resolveDamageMultiplierGroup(block, blockByName, new Set());
    const inlineDamageMultipliers = damageMultiplierGroup
      ? null
      : this._extractInlineDamageMultipliers(block, blockByName, new Set());

    const filteredChildren = block.children
      .filter(child => {
        const classVal = child.properties.find(p => p.key === 'Class')?.value;
        return classVal != null && ALLOWED_CHILD_CLASSES.has(String(classVal));
      })
      .map(child => ({
        ...child,
        properties: child.properties.filter(p => !BLOCKED_CHILD_PROPS.has(p.key)),
      }));

    const showUserVal = block.getPropertyValue('ShowUser');

    return new Item({
      id: block.attributes['Id'] != null ? Number(block.attributes['Id']) : null,
      name: block.attributes['Name'] ?? null,
      recipeName: block.getPropertyValue('RecipeName') ?? null,
      material: block.getPropertyValue('Material'),
      damageMultiplierGroup,
      inlineDamageMultipliers,
      category: block.getPropertyValue('Category'),
      mass: block.getPropertyValue('Mass'),
      volume: block.getPropertyValue('Volume'),
      stackSize: block.getPropertyValue('StackSize'),
      durability: block.getPropertyValue('Durability'),
      unlockLevel: block.getPropertyValue('UnlockLevel'),
      unlockCost: block.getPropertyValue('UnlockCost'),
      marketPrice: block.getPropertyValue('MarketPrice') != null ? Number(block.getPropertyValue('MarketPrice')) : null,
      showUser: showUserVal == null || (String(showUserVal).toLowerCase() !== 'no' && showUserVal !== false),
      properties: filteredProps,
      children: filteredChildren,
    });
  }
}

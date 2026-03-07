import { BaseConfigParser } from './BaseConfigParser.js';
import { Item } from './models/Item.js';

const BLOCKED_TOP_PROPS = new Set([
  'Meshfile', 'OverrideTradingConstraints', 'SfxJammed',
  'RecipeName', 'DropMeshfile', 'Material', 'HoldType', 'Canhold',
  'RepairCount', 'NrSlots', 'Category', 'ShowUser', 'Crosshair', 'DegradationProb',
  'GlobalRef', 'XpFactor', 'NoRepairInputItem', 'AboveTerrainCheck', 'SymType',
  'PropHead', 'CustomIcon', 'PickupToToolbar', 'DurabilityBreaksAfter', 'LifetimeOnDrop',
  'RadialMenu', 'MapIcon', 'Block Type', 'FoodDecayedItem',
]);

const BLOCKED_CHILD_PROPS = new Set([
  'SfxBegin', 'SfxLoop', 'SfxStop',
  'DamageMultiplier_1', 'DamageMultiplier_2', 'DamageMultiplier_3',
]);

/**
 * Only children whose Class property exactly matches one of these values will
 * be kept. Add values here to expose a child block in the UI.
 * Example: new Set(['Ranged', 'Driller', 'Movements'])
 */
const ALLOWED_CHILD_CLASSES = new Set([
  // 'Ranged',
  // 'Driller',
  // 'Movements',
]);

/**
 * Parses ItemsConfig.ecf into an array of {@link Item} objects.
 */
export class ItemsConfigParser extends BaseConfigParser {
  /**
   * @param {import('./ecf/EcfBlock.js').EcfBlock[]} blocks
   * @returns {Item[]}
   */
  transform(blocks) {
    return blocks
      .filter(block => block.type === 'Item')
      .map(block => this._transformItem(block));
  }

  /**
   * @param {import('./ecf/EcfBlock.js').EcfBlock} block
   * @returns {Item}
   */
  _transformItem(block) {
    const filteredProps = block.properties.filter(p => !BLOCKED_TOP_PROPS.has(p.key));

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

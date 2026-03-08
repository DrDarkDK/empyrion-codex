import { BaseConfigParser } from './BaseConfigParser.js';
import { Block } from './models/Block.js';

const BLOCKED_PROPS = new Set([
  'ChildShapes', 'BlockColor', 'Texture', 'Shape', 'DropMeshfile',
  'IsDuplicateable', 'IsAccessible', 'Material', 'Category',
  'TemplateRoot', 'TextureTable', 'Place', 'Model', 'Mesh',
  'Class', 'IndexName', 'Group', 'LootList', 'ShowBlockName',
  'DropInventoryEntity', 'SizeInBlocksLocked', 'OccupySizeInBlocks',
  'IsActivateableInCP', 'IsLockable', 'BlastParticleIndex', 'BlastRadius',
  'WeaponItem', 'IsActivateable', 'ForceMaxCount', 'BlastParticleName',
  'BlastDamage', 'EnergyDynamicGroup', 'TurretTargetIgnore', 'RotSpeed',
  'Zoom', 'RadialMenu', 'Faction', 'IsIgnoreLC', 'AllowWander', 'ShowUser',
  'Collide', 'DialogueSingleUserAccess', 'PickupTarget', 'NPCModelRotation',
  'CustomIcon', 'Mesh-Damage-1', 'Mesh-Damage-2', 'Mesh-Damage-3', 'Mesh-Damage-4',
  'EssentialCategory', 'IsUsingCPUSystem', 'ParticleOffset', 'IsTextureable',
  'IsGPUInstance', 'ItemPerAU', 'Mod.RangeLY', 'RepFac', 'Voxelize', 'IsColorable',
  'ParticleName', 'ShieldMultiplier', 'ShieldPerCrystal', 'IsActivatedOnPlace',
  'IsKeepContainers', 'Mod.RangeAU', 'CostPerAU', 'CostPerLY', 'SoundRotate',
  'SoundOnEnter', 'PickupToToolbar', 'RepairPerSecond', 'FuelAccept', 'MapIcon',
  'MapName', 'ForceNoPvEDamage', 'XpFactor', 'CanPickup', 'IsTerrainDecoration',
  'WarpAccept', 'WeaponItemRotation', 'ModelScaleLocked', 'DialogueState',
  'StabilitySupport', 'OnHarvest', 'OnDeath', 'Next', 'ItemStorageLimit',
  'SymType', 'ThrusterBoosterFactor', 'SoundOpen', 'SoundClose', 'ROF',
  'ReloadDelay', 'GlobalRef', 'IsAntiInfantryWeapon', 'AboveTerrainCheck',
  'ADBDroneAmmoType', 'ADBDockingSpeedFac', 'ADBActionRadius', 'ADBMaxReserve',
  'ADBMaxActiveDrone', 'ADBMaxSpawner', 'ADBDroneType', 'ExplosionHardness',
  'RemoveOnSI',
]);

/**
 * Parses BlocksConfig.ecf into an array of {@link Block} objects.
 * Blocks listed as ChildBlocks of another block are excluded from the
 * top-level results — they appear only inside their parent’s detail view.
 */
export class BlocksConfigParser extends BaseConfigParser {
  /**
   * @param {import('./ecf/EcfBlock.js').EcfBlock[]} blocks
   * @returns {Block[]}
   */
  transform(blocks) {
    return blocks
      .filter(block => block.type === 'Block')
      .map(block => this._transformBlock(block));
  }

  /**
   * @param {import('./ecf/EcfBlock.js').EcfBlock} block
   * @returns {Block}
   */
  _transformBlock(block) {
    // Parse ChildBlocks devName list
    const childBlocksRaw = block.getPropertyValue('ChildBlocks');
    const childBlocks = childBlocksRaw
      ? String(childBlocksRaw).replace(/^"|"$/g, '').split(',').map(s => s.trim()).filter(Boolean)
      : [];

    const showUserVal    = block.getPropertyValue('ShowUser');
    const filteredProps  = block.properties.filter(p => !BLOCKED_PROPS.has(p.key));

    // RepairToTemplate defaults to true when the property is absent entirely
    if (!filteredProps.some(p => p.key === 'RepairToTemplate')) {
      filteredProps.push({ key: 'RepairToTemplate', value: true });
    }

    const PLANT_GROWING_SKIP = new Set(['OnDeath', 'Next']);
    const filteredChildren = block.children
      .filter(child => child.attributes['_label'] !== 'CropsGrown'
                    && !child.attributes['_label']?.startsWith('DropOnDestroy_'))
      .map(child => {
        if (child.attributes['_label'] !== 'PlantGrowing') return child;
        // Return a shallow clone with OnDeath/Next filtered out
        const clone = Object.assign(Object.create(Object.getPrototypeOf(child)), child);
        clone.properties = child.properties.filter(p => !PLANT_GROWING_SKIP.has(p.key));
        return clone;
      });

    return new Block({
      id:          block.attributes['Id'] != null ? Number(block.attributes['Id']) : null,
      name:        block.attributes['Name'] ?? null,
      material:    block.getPropertyValue('Material'),
      group:       block.getPropertyValue('Group'),
      hp:          block.getPropertyValue('HitPoints') ?? block.getPropertyValue('HP'),
      mass:        block.getPropertyValue('Mass'),
      volume:      block.getPropertyValue('Volume'),
      category:    block.getPropertyValue('Category'),
      marketPrice: block.getPropertyValue('MarketPrice') != null ? Number(block.getPropertyValue('MarketPrice')) : null,
      showUser:    showUserVal == null || (String(showUserVal).toLowerCase() !== 'no' && showUserVal !== false),
      childBlocks,
      properties:  filteredProps,
      children:    filteredChildren,
    });
  }
}

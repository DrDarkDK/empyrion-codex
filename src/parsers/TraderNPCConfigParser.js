import { BaseConfigParser } from './BaseConfigParser.js';
import { TraderNPC } from './models/TraderNPC.js';

/**
 * Parses TraderNPCConfig.ecf into an array of {@link TraderNPC} objects.
 */
export class TraderNPCConfigParser extends BaseConfigParser {
  /**
   * @param {import('./ecf/EcfBlock.js').EcfBlock[]} blocks
   * @returns {TraderNPC[]}
   */
  transform(blocks) {
    return blocks
      .filter(block => block.type === 'Trader')
      .map(block => this._transformTrader(block));
  }

  /**
   * @param {import('./ecf/EcfBlock.js').EcfBlock} block
   * @returns {TraderNPC}
   */
  _transformTrader(block) {
    const sellingGoodsRaw = block.getPropertyValue('SellingGoods') ?? '';
    const sellingGoods = sellingGoodsRaw
      ? String(sellingGoodsRaw).split(',').map(s => s.trim()).filter(Boolean)
      : [];

    const allItems = block.properties
      .filter(p => /^Item\d+$/.test(p.key))
      .sort((a, b) => Number(a.key.slice(4)) - Number(b.key.slice(4)))
      .map(p => this._parseItem(String(p.value)));

    return new TraderNPC({
      name:         block.attributes['Name'] ?? null,
      sellingText:  block.getPropertyValue('SellingText'),
      sellingGoods,
      discount:     block.getPropertyValue('Discount'),
      sellingItems: allItems.filter(i => i.isSelling),
      buyingItems:  allItems.filter(i => i.isBuying),
      properties:   block.properties,
      children:     block.children,
    });
  }

  /**
   * Parses a raw item string.
   * Format: "DevName, sell_mf_or_0, sell_qty_or_0, buy_mf_or_0, buy_qty_or_0"
   * Selling example: "TechnicalArtifact, mf=1.0-1.25, 50-100, 0, 0"
   * Buying  example: "TurretGVToolBlocks, 0, 0, mf=0.5-0.75, 5-10"
   * @param {string} rawStr
   * @returns {import('./models/TraderNPC.js').TraderItem}
   */
  _parseItem(rawStr) {
    const parts   = rawStr.replace(/^"|"$/g, '').split(',').map(s => s.trim());
    const devName = parts[0] ?? '';
    const sellMf  = String(parts[1] ?? '0');
    const sellQty = String(parts[2] ?? '0');
    const buyMf   = String(parts[3] ?? '0');
    const buyQty  = String(parts[4] ?? '0');

    // "0-0" is a range that equals zero — treated the same as "0" (no trade in that direction)
    const isZero = v => !v || String(v).split('-').every(p => Number(p.trim()) === 0);
    const isSelling = !isZero(sellQty);
    const isBuying  = !isZero(buyQty);

    return {
      devName,
      isSelling,
      isBuying,
      sellQtyRange: isSelling ? sellQty : null,
      sellMfRange:  isSelling ? sellMf  : null,   // kept as-is: "mf=1.0-1.25" or absolute e.g. "500-1000"
      buyQtyRange:  isBuying  ? buyQty  : null,
      buyMfRange:   isBuying  ? buyMf   : null,
    };
  }
}

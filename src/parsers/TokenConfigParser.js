import { BaseConfigParser } from './BaseConfigParser.js';
import { Token } from './models/Token.js';

/**
 * Parses TokenConfig.ecf into an array of {@link Token} objects.
 */
export class TokenConfigParser extends BaseConfigParser {
  /**
   * @param {import('./ecf/EcfBlock.js').EcfBlock[]} blocks
   * @returns {Token[]}
   */
  transform(blocks) {
    return blocks
      .filter(block => block.type === 'Token')
      .map(block => this._transformToken(block));
  }

  /**
   * @param {import('./ecf/EcfBlock.js').EcfBlock} block
   * @returns {Token}
   */
  _transformToken(block) {
    const marketPriceRaw = block.getPropertyValue('MarketPrice');
    const removeOnUseRaw = block.getPropertyValue('RemoveOnUse');

    return new Token({
      id:          block.attributes['Id']   != null ? Number(block.attributes['Id'])   : null,
      name:        block.attributes['Name'] ?? null,
      description: block.getPropertyValue('Description') ?? null,
      customIcon:  block.getPropertyValue('CustomIcon')  ?? null,
      marketPrice: marketPriceRaw != null ? Number(marketPriceRaw) : null,
      removeOnUse: removeOnUseRaw != null ? Boolean(removeOnUseRaw) : false,
    });
  }
}

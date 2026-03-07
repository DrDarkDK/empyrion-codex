import { EcfParser } from './ecf/EcfParser.js';

/**
 * Abstract base class for all ECF config parsers.
 *
 * Subclasses implement `transform(blocks)` to map the generic EcfBlock tree
 * into domain-specific objects (Items, Traders, Blocks, etc.).
 */
export class BaseConfigParser {
  constructor() {
    this._ecfParser = new EcfParser();
  }

  /**
   * Parse raw ECF text and return an array of domain objects.
   * @param {string} text
   * @returns {object[]}
   */
  parse(text) {
    const blocks = this._ecfParser.parse(text);
    return this.transform(blocks);
  }

  /**
   * Transform an array of EcfBlocks into domain objects.
   * Must be implemented by subclasses.
   * @param {import('./ecf/EcfBlock.js').EcfBlock[]} blocks
   * @returns {object[]}
   */
  transform(blocks) {
    throw new Error(`${this.constructor.name} must implement transform()`);
  }
}

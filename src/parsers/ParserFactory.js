import { ItemsConfigParser } from './ItemsConfigParser.js';
import { TraderNPCConfigParser } from './TraderNPCConfigParser.js';
import { BlocksConfigParser } from './BlocksConfigParser.js';
import { TemplatesConfigParser } from './TemplatesConfigParser.js';
import { TokenConfigParser } from './TokenConfigParser.js';

/**
 * Maps known ECF filenames to their corresponding parser classes.
 * @type {Record<string, new() => import('./BaseConfigParser.js').BaseConfigParser>}
 */
const PARSER_REGISTRY = {
  'ItemsConfig.ecf':   ItemsConfigParser,
  'TraderNPCConfig.ecf': TraderNPCConfigParser,
  'BlocksConfig.ecf':  BlocksConfigParser,
  'Templates.ecf':     TemplatesConfigParser,
  'TokenConfig.ecf':   TokenConfigParser,
};

/**
 * Factory for creating the correct parser based on an ECF filename.
 */
export class ParserFactory {
  /**
   * Returns a new parser instance for the given filename.
   * @param {string} filename - e.g. "ItemsConfig.ecf"
   * @returns {import('./BaseConfigParser.js').BaseConfigParser}
   * @throws {Error} if no parser is registered for the filename
   */
  static getParser(filename) {
    const ParserClass = PARSER_REGISTRY[filename];
    if (!ParserClass) {
      throw new Error(
        `No parser registered for "${filename}". Supported files: ${ParserFactory.getSupportedFiles().join(', ')}`
      );
    }
    return new ParserClass();
  }

  /**
   * @returns {string[]} List of supported filenames
   */
  static getSupportedFiles() {
    return Object.keys(PARSER_REGISTRY);
  }
}

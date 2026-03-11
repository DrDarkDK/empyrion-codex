#!/usr/bin/env node
/**
 * compress-scenarios.js
 *
 * Gzip-compresses every .empcdx file in src/scenarios/ and writes the result
 * alongside the original as <name>.empcdx.gz.
 *
 * Run with:  node scripts/compress-scenarios.js
 *        or: npm run compress-scenarios
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

const scenariosDir = path.join(__dirname, '..', 'src', 'scenarios');

const files = fs.readdirSync(scenariosDir).filter(f => f.endsWith('.empcdx'));

if (files.length === 0) {
  console.log('No .empcdx files found in', scenariosDir);
  process.exit(0);
}

for (const file of files) {
  const srcPath  = path.join(scenariosDir, file);
  const dstPath  = srcPath + '.gz';

  const input      = fs.readFileSync(srcPath);
  const compressed = zlib.gzipSync(input, { level: 9 });

  fs.writeFileSync(dstPath, compressed);

  const srcMB = (input.length      / 1024 / 1024).toFixed(1);
  const dstMB = (compressed.length / 1024 / 1024).toFixed(1);
  const pct   = ((1 - compressed.length / input.length) * 100).toFixed(0);

  console.log(`${file}: ${srcMB} MB → ${dstMB} MB (${pct}% smaller)`);
}

console.log('\nDone. Update manifest.json "file" entries to use .empcdx.gz paths.');

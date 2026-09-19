#!/usr/bin/env node
/**
 * Route hardcoded GOLD hexes in PDF/HTML templates through the brand palette,
 * so exported documents pick up the White-Label brand colour. Only the gold
 * ramp is remapped; navy / neutral / semantic hexes stay fixed by design.
 *
 * The target file must already have `palette` in scope, e.g.:
 *   const palette = getBrandPdfPalette(brand.brandColor);
 *
 * Handles both:
 *   - standalone quoted hex:  color: '#c9a55a'      → color: palette.gold
 *   - hex inside a string:    '3px solid #c9a55a'   → `3px solid ${palette.gold}`
 *   - hex inside a template:  `... #c9a55a ...`     → `... ${palette.gold} ...`
 *
 * Usage: node scripts/migrate-pdf-gold.cjs <file> [<file> …]
 */
'use strict';
const fs = require('fs');
const path = require('path');

// Load the legacy gold→token map from the source of truth.
const src = fs.readFileSync(
  path.resolve(__dirname, '../src/branding/brandPalette.ts'),
  'utf8'
);
const MAP = {};
const mapBlock = src.match(/LEGACY_GOLD_HEX_TO_TOKEN[^{]*\{([\s\S]*?)\}/);
for (const m of mapBlock[1].matchAll(/'(#[0-9a-fA-F]{6})':\s*'([a-zA-Z]+)'/g)) {
  MAP[m[1].toLowerCase()] = m[2];
}
const HEX_RE = new RegExp('(' + Object.keys(MAP).join('|') + ')', 'gi');
// Default gold as an rgb triplet, used in rgba() washes.
const RGB_RE = /\b201,\s*165,\s*90\b/g;
const token = (hex) => `palette.${MAP[hex.toLowerCase()]}`;
const hasGold = (t) => { HEX_RE.lastIndex = 0; RGB_RE.lastIndex = 0; return HEX_RE.test(t) || RGB_RE.test(t); };
const swap = (t) => t.replace(HEX_RE, (h) => '${' + token(h) + '}').replace(RGB_RE, '${palette.goldRgb}');

function migrate(input) {
  let s = input;

  // 1) single/double-quoted strings that contain gold (hex or rgb) → template literal
  s = s.replace(/(['"])((?:(?!\1)[^\\\n])*)\1/g, (m, q, body) => {
    if (!hasGold(body)) return m;
    return '`' + swap(body) + '`';
  });

  // 2) gold inside existing template literals
  s = s.replace(/`(?:[^`\\]|\\.)*`/g, (lit) => swap(lit));

  // 3) tidy standalone `${palette.X}` → palette.X
  s = s.replace(/`\$\{(palette\.[a-zA-Z]+)\}`/g, '$1');

  return s;
}

for (const file of process.argv.slice(2)) {
  const before = fs.readFileSync(file, 'utf8');
  const after = migrate(before);
  if (before !== after) {
    fs.writeFileSync(file, after);
    console.log(`✔ ${file}`);
  } else {
    console.log(`· no change ${file}`);
  }
}

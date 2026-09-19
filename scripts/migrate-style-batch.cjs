#!/usr/bin/env node
/**
 * Phase 5 semantic codemod (reviewed, per-file).
 *
 * Maps hardcoded Tailwind palette classes to design tokens using the
 * brand-vs-semantic model (docs/STYLE_CONSISTENCY_AND_THEMING_PLAN.md):
 *
 *   amber / yellow  → brand ramp (brand-50…950)  — decorative "gold" that
 *                     should CASCADE from the White-Label brand colour, with
 *                     its shade structure preserved (contrast intact).
 *   green/emerald/lime/teal → success            (semantic, fixed)
 *   red / rose             → destructive          (semantic, fixed)
 *   orange                 → warning              (semantic, fixed)
 *   blue / sky / cyan      → info                 (semantic, fixed)
 *   indigo/violet/purple/fuchsia/pink → accent    (brand-adjacent)
 *   slate/gray/zinc/neutral/stone → muted / foreground / border (neutral)
 *
 * The single-hue semantic tokens (success/destructive/…) have no shade ramp,
 * so shades are mapped by ROLE to preserve contrast:
 *   - bg-*    light shades → token at low opacity; solid shades → solid token
 *   - text-*  light (50/100) → token-foreground (on-solid); else → token
 *   - border-* → token at moderate opacity
 * Brand keeps its ramp, so brand shades map 1:1 (contrast preserved).
 *
 * Run per-file on a CURATED list (decorative/status files — NOT art-directed
 * gradients or PDF templates). Always review the diff + run the build; a
 * visual pass follows in Phase 8.
 *
 * Usage: node scripts/migrate-style-batch.cjs <file> [<file> …]
 */
'use strict';
const fs = require('fs');

const SEMANTIC = {
  'green|emerald|lime|teal': 'success',
  'red|rose': 'destructive',
  orange: 'warning',
  'blue|sky|cyan': 'info',
  'indigo|violet|purple|fuchsia|pink': 'accent',
};
const NEUTRAL = 'slate|gray|zinc|neutral|stone';
const OPACITY = '(\\/(?:\\d{1,3}|\\[[^\\]\\s]+\\]))?';
// bg opacity by shade for collapsed (single-hue) tokens
const BG_OPACITY = { 50: '/10', 100: '/15', 200: '/20', 300: '/30', 400: '/60' };

function migrate(src) {
  let s = src;

  // ── Brand gold: preserve shade + opacity, swap family only ──────────────
  s = s.replace(new RegExp(`\\b(bg|text|border|ring-offset|ring|from|to|via|divide|fill|stroke|outline|decoration|placeholder|caret|shadow)-(?:amber|yellow)-(\\d{2,3})(?!\\d)${OPACITY}`, 'g'),
    (_m, u, shade, op) => `${u}-brand-${shade}${op || ''}`);

  // ── Semantic families: collapse by role to preserve contrast ────────────
  for (const [families, token] of Object.entries(SEMANTIC)) {
    // text: light on-solid text → foreground; else → token colour
    s = s.replace(new RegExp(`\\btext-(?:${families})-(?:50|100)(?!\\d)${OPACITY}`, 'g'),
      (_m, op) => `text-${token}-foreground${op || ''}`);
    s = s.replace(new RegExp(`\\btext-(?:${families})-\\d{2,3}(?!\\d)${OPACITY}`, 'g'),
      (_m, op) => `text-${token}${op || ''}`);
    // bg: keep explicit opacity if present; otherwise derive from shade
    s = s.replace(new RegExp(`\\bbg-(?:${families})-(\\d{2,3})(?!\\d)${OPACITY}`, 'g'),
      (_m, shade, op) => `bg-${token}${op || BG_OPACITY[shade] || ''}`);
    // gradients / rings / borders / fills: token, keep opacity
    s = s.replace(new RegExp(`\\b(border|ring|ring-offset|divide|from|to|via|fill|stroke|outline|shadow|decoration|caret)-(?:${families})-\\d{2,3}(?!\\d)${OPACITY}`, 'g'),
      (_m, u, op) => `${u}-${token}${op || (u === 'border' ? '/30' : '')}`);
  }

  // ── Neutrals: only the unambiguous cases ────────────────────────────────
  s = s.replace(new RegExp(`\\btext-(?:${NEUTRAL})-(?:400|500|600)(?!\\d)${OPACITY}`, 'g'),
    (_m, op) => `text-muted-foreground${op || ''}`);
  s = s.replace(new RegExp(`\\btext-(?:${NEUTRAL})-(?:700|800|900|950)(?!\\d)${OPACITY}`, 'g'),
    (_m, op) => `text-foreground${op || ''}`);
  s = s.replace(new RegExp(`\\b(border|ring|divide)-(?:${NEUTRAL})-\\d{2,3}(?!\\d)${OPACITY}`, 'g'),
    (_m, u, op) => `${u}-border${op || ''}`);
  // ring-offset colour follows the surface it sits on
  s = s.replace(new RegExp(`\\bring-offset-(?:${NEUTRAL})-\\d{2,3}(?!\\d)${OPACITY}`, 'g'),
    (_m, op) => `ring-offset-background${op || ''}`);
  s = s.replace(new RegExp(`\\bbg-(?:${NEUTRAL})-(?:50|100|200|300)(?!\\d)${OPACITY}`, 'g'),
    (_m, op) => `bg-muted${op || ''}`);
  s = s.replace(new RegExp(`\\bbg-(?:${NEUTRAL})-(?:800|900|950)(?!\\d)${OPACITY}`, 'g'),
    (_m, op) => `bg-background${op || ''}`);
  // neutral gradient stops → flatten to a surface token (keeps opacity)
  s = s.replace(new RegExp(`\\b(from|to|via)-(?:${NEUTRAL})-(?:700|800|900|950)(?!\\d)${OPACITY}`, 'g'),
    (_m, u, op) => `${u}-background${op || ''}`);
  s = s.replace(new RegExp(`\\b(from|to|via)-(?:${NEUTRAL})-(?:50|100|200|300|400|500|600)(?!\\d)${OPACITY}`, 'g'),
    (_m, u, op) => `${u}-muted${op || ''}`);
  // dark-mode-only light neutral text → foreground (safe: only the dark: variant)
  s = s.replace(new RegExp(`\\bdark:text-(?:${NEUTRAL})-(?:50|100|200|300)(?!\\d)${OPACITY}`, 'g'),
    (_m, op) => `dark:text-foreground${op || ''}`);

  return s;
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Usage: node scripts/migrate-style-batch.cjs <file> …');
  process.exit(1);
}
for (const file of files) {
  const before = fs.readFileSync(file, 'utf8');
  const after = migrate(before);
  if (before !== after) {
    fs.writeFileSync(file, after);
    console.log(`✔ migrated ${file}`);
  } else {
    console.log(`· no change ${file}`);
  }
}

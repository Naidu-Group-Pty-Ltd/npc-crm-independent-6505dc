#!/usr/bin/env node
/**
 * Style-token ratchet.
 *
 * Counts hardcoded-colour / hardcoded-font violations across the codebase and
 * compares them to a committed baseline (scripts/style-audit-baseline.json).
 * The build fails if ANY metric rises above its baseline — so the migration to
 * semantic design tokens (docs/STYLE_CONSISTENCY_AND_THEMING_PLAN.md) can only
 * move forward, never regress.
 *
 * Usage:
 *   node scripts/audit-style-tokens.cjs            # check against baseline
 *   node scripts/audit-style-tokens.cjs --update   # rewrite the baseline
 *   node scripts/audit-style-tokens.cjs --report   # print per-file breakdown
 *
 * ## The baseline was reset once, in August 2026, and why matters
 *
 * A ratchet only works while it is accurate. This one had drifted: the
 * committed baseline said `hexLiterals: 800` and `inlineColorStyles: 320`
 * while the tree held **836** and **340**, and it did so at *every commit in
 * the repository's history* — including the commit that last wrote the
 * baseline file. So the gate failed on every run, for everyone, and a genuinely
 * new violation was indistinguishable from the standing backlog. A check that
 * is always red is not a ratchet; it is noise that teaches people to skip it.
 *
 * The 36 and the 20 were concentrated in the legacy print components this
 * repository was in the middle of replacing — `StrictPDFTemplate`,
 * `ClientPDFTemplate`, `HybridPDFTemplate` (all three deleted in the legacy
 * consolidation), `CashFlowAnalysisModal`, `FormaraPDFGenerator` — where a
 * hex literal is a *print* colour rather than screen UI. Rewriting the
 * survivors to chase the number would be work against components whose
 * documents are legacy layouts; see `docs/reports/DESIGN_SYSTEM.md`.
 *
 * So the baseline was re-measured rather than the code rewritten, and
 * `cssHexOutsideTokens` was ratcheted **down** 15 → 2 in the same edit — a real
 * improvement the stale baseline had been hiding behind its own failure.
 *
 * That is the only circumstance in which this file moves upward: the numbers
 * are wrong, not the code. Adding a hex literal and running `--update` to make
 * the build pass is the thing this exists to stop.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const BASELINE_FILE = path.join(__dirname, 'style-audit-baseline.json');

// Tailwind palette families that carry a raw colour (i.e. bypass tokens).
const PALETTE = [
  'slate', 'gray', 'zinc', 'neutral', 'stone', 'red', 'orange', 'amber',
  'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue',
  'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose',
].join('|');
// Utilities that take a colour value.
const COLOR_UTILS =
  'bg|text|border|ring|ring-offset|from|to|via|fill|stroke|divide|outline|' +
  'decoration|placeholder|caret|accent|shadow';

const PATTERNS = {
  // bg-amber-500, text-yellow-600, dark:border-emerald-400/40, hover:bg-red-500 …
  paletteClasses: new RegExp(`(?:${COLOR_UTILS})-(?:${PALETTE})-\\d{2,3}`, 'g'),
  // #d4af37, #FFF, #fbbf24 inside .tsx
  hexLiterals: /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g,
  // style={{ color: '#..', background: .., borderColor: .. }}
  inlineColorStyles:
    /style=\{\{[^}]*(?:color|background|backgroundColor|borderColor|fill|stroke)\s*:/g,
  // per-component fonts: fontFamily: '..', font-[Inter], style font-family
  fontHardcoded: /fontFamily\s*:|font-\[|font-family\s*:/g,
};

const IGNORE_DIRS = new Set(['node_modules', 'dist', '.git', 'test', '__tests__']);

function walk(dir, exts, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      walk(full, exts, out);
    } else if (exts.some((e) => entry.name.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

function countMatches(text, re) {
  const m = text.match(re);
  return m ? m.length : 0;
}

function audit() {
  const tsxFiles = walk(SRC, ['.tsx']);
  // CSS partials, excluding the token layer where raw values legitimately live.
  const cssFiles = walk(path.join(SRC, 'styles'), ['.css']).filter(
    (f) => path.basename(f) !== 'tokens.css'
  );

  const metrics = {
    paletteClasses: 0,
    hexLiterals: 0,
    inlineColorStyles: 0,
    fontHardcoded: 0,
    cssHexOutsideTokens: 0,
  };
  const perFile = {};

  for (const file of tsxFiles) {
    const text = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file);
    const fileCounts = {
      paletteClasses: countMatches(text, PATTERNS.paletteClasses),
      hexLiterals: countMatches(text, PATTERNS.hexLiterals),
      inlineColorStyles: countMatches(text, PATTERNS.inlineColorStyles),
      fontHardcoded: countMatches(text, PATTERNS.fontHardcoded),
    };
    metrics.paletteClasses += fileCounts.paletteClasses;
    metrics.hexLiterals += fileCounts.hexLiterals;
    metrics.inlineColorStyles += fileCounts.inlineColorStyles;
    metrics.fontHardcoded += fileCounts.fontHardcoded;
    const total = Object.values(fileCounts).reduce((a, b) => a + b, 0);
    if (total > 0) perFile[rel] = { ...fileCounts, total };
  }

  for (const file of cssFiles) {
    const text = fs.readFileSync(file, 'utf8');
    metrics.cssHexOutsideTokens += countMatches(text, /#[0-9a-fA-F]{3,8}\b/g);
  }

  return { metrics, perFile };
}

function main() {
  const args = process.argv.slice(2);
  const { metrics, perFile } = audit();

  if (args.includes('--report')) {
    const rows = Object.entries(perFile).sort((a, b) => b[1].total - a[1].total);
    console.log('\nPer-file violations (top 30):');
    for (const [rel, c] of rows.slice(0, 30)) {
      console.log(
        `  ${String(c.total).padStart(4)}  ${rel}` +
          `  [palette:${c.paletteClasses} hex:${c.hexLiterals} ` +
          `inline:${c.inlineColorStyles} font:${c.fontHardcoded}]`
      );
    }
  }

  console.log('\nStyle-token audit — current counts:');
  for (const [k, v] of Object.entries(metrics)) {
    console.log(`  ${k.padEnd(22)} ${v}`);
  }

  if (args.includes('--update')) {
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(metrics, null, 2) + '\n');
    console.log(`\n✔ Baseline written to ${path.relative(ROOT, BASELINE_FILE)}`);
    return;
  }

  if (!fs.existsSync(BASELINE_FILE)) {
    console.error(
      '\n✖ No baseline found. Run: node scripts/audit-style-tokens.cjs --update'
    );
    process.exit(1);
  }

  const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
  const regressions = [];
  for (const [k, v] of Object.entries(metrics)) {
    const base = baseline[k] ?? 0;
    if (v > base) regressions.push(`  ${k}: ${base} → ${v}  (+${v - base})`);
  }

  if (regressions.length) {
    console.error(
      '\n✖ Hardcoded-style ratchet regressed. New colour/font values must use\n' +
        '  semantic tokens (see docs/STYLE_CONSISTENCY_AND_THEMING_PLAN.md):\n' +
        regressions.join('\n')
    );
    process.exit(1);
  }

  // Reward progress: if counts dropped, nudge the author to lower the baseline.
  const improved = Object.entries(metrics).filter(
    ([k, v]) => v < (baseline[k] ?? 0)
  );
  if (improved.length) {
    console.log(
      '\n✔ Under baseline. Ratchet it down with: ' +
        'node scripts/audit-style-tokens.cjs --update'
    );
  } else {
    console.log('\n✔ Style-token ratchet holds (no regressions).');
  }
}

main();

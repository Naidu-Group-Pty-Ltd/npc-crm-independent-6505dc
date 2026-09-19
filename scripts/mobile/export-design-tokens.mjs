#!/usr/bin/env node
/**
 * Exports the design tokens in a platform-neutral form for the Flutter app.
 *
 * `src/styles/tokens.css` is the single source of truth for the design system
 * (see CLAUDE.md). A Flutter client cannot read CSS custom properties, so this
 * script parses the token declarations and writes `mobile/design-tokens.json` —
 * the same pattern as `scripts/reportDesign/buildTokens.ts`, which derives the
 * print tokens from the same file for the same reason.
 *
 * What is exported:
 *   - `:root` and `.dark`               → themes.light / themes.dark
 *   - `:root.finance-theme-midnight`    → themes.financeMidnight
 *   - `:root.finance-theme-graphite`    → themes.financeGraphite
 *
 * What is deliberately NOT exported: the degradation branches
 * (`@supports not (backdrop-filter…)`, `prefers-reduced-transparency`,
 * `prefers-contrast`, `forced-colors`, `@media print`). Those encode *web*
 * fallback strategy. Flutter reads the platform accessibility flags directly
 * (`MediaQuery.highContrast`, `disableAnimations`, iOS Reduce Transparency)
 * and applies the equivalent policy in Dart — mirroring the web's media-query
 * branches would couple it to the wrong platform's mechanism.
 *
 * Values are kept verbatim (HSL triplets like `42 54% 96%`, and derived
 * values that still reference `var(--…)`). The Flutter design_system package
 * owns resolution; resolving here would bake light-mode values into
 * expressions the dark theme needs to re-point.
 *
 * Run:   npm run mobile:tokens
 * Check: npm run mobile:tokens:check   (fails if the committed file drifts)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '../..');
const SOURCES = ['src/styles/tokens.css', 'src/styles/finance-portal.css'];
const OUT = join(REPO, 'mobile', 'design-tokens.json');

/** selector → theme key. Order matters only for documentation. */
const THEME_SELECTORS = new Map([
  [':root', 'light'],
  ['.dark', 'dark'],
  [':root.finance-theme-midnight', 'financeMidnight'],
  [':root.finance-theme-graphite', 'financeGraphite'],
]);

/** Conditional at-rules whose contents are web-only fallback policy. */
const CONDITIONAL = /^@(media|supports|container)\b/;

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Walk the CSS by braces, tracking the header stack, and collect custom
 * properties declared under a target selector with no conditional at-rule
 * anywhere above it. Later declarations win, like the cascade.
 */
function collect(css, themes) {
  const stack = []; // { header, conditional, themeKey }
  let buf = '';
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') {
      const header = buf.trim();
      const conditional = CONDITIONAL.test(header) || (stack.length > 0 && stack[stack.length - 1].conditional);
      // A selector list ( `:root, .dark {` never occurs for tokens here, but
      // split defensively) — take the first matching selector.
      let themeKey = null;
      for (const sel of header.split(',').map((s) => s.trim())) {
        if (THEME_SELECTORS.has(sel)) { themeKey = THEME_SELECTORS.get(sel); break; }
      }
      stack.push({ header, conditional, themeKey });
      buf = '';
    } else if (ch === '}') {
      flush(stack, buf, themes);
      buf = '';
      stack.pop();
    } else if (ch === ';') {
      flush(stack, buf + ';', themes);
      buf = '';
    } else {
      buf += ch;
    }
  }
}

function flush(stack, text, themes) {
  if (!stack.length) return;
  const top = stack[stack.length - 1];
  if (!top.themeKey || top.conditional) return;
  const m = /^\s*(--[a-z0-9-]+)\s*:\s*([\s\S]+?);?\s*$/i.exec(text);
  if (!m) return;
  const value = m[2].replace(/\s+/g, ' ').trim();
  themes[top.themeKey][m[1]] = value;
}

function build() {
  const themes = { light: {}, dark: {}, financeMidnight: {}, financeGraphite: {} };
  for (const rel of SOURCES) {
    collect(stripComments(readFileSync(join(REPO, rel), 'utf8')), themes);
  }
  // Deterministic ordering so the artefact diffs cleanly.
  const sorted = {};
  for (const [name, vars] of Object.entries(themes)) {
    sorted[name] = Object.fromEntries(Object.entries(vars).sort(([a], [b]) => a.localeCompare(b)));
  }
  return {
    $comment:
      'GENERATED — do not edit. npm run mobile:tokens regenerates from ' +
      SOURCES.join(', ') +
      '. Values are verbatim CSS custom-property values (HSL triplets and var() ' +
      'expressions); the Flutter design_system package owns resolution. ' +
      'Web-only degradation branches are intentionally excluded — see the ' +
      'script header.',
    sources: SOURCES,
    themes: sorted,
  };
}

function main() {
  const artefact = JSON.stringify(build(), null, 2) + '\n';
  if (process.argv.includes('--check')) {
    let committed = '';
    try { committed = readFileSync(OUT, 'utf8'); } catch { /* missing counts as drift */ }
    if (committed !== artefact) {
      console.error('\n✖ mobile/design-tokens.json is out of date with the token sources.');
      console.error('  Run `npm run mobile:tokens` and commit the result.\n');
      process.exit(1);
    }
    console.log('✓ mobile design tokens match the token sources');
    return;
  }
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, artefact);
  const t = build().themes;
  console.log(
    `→ mobile/design-tokens.json  (light=${Object.keys(t.light).length} dark=${Object.keys(t.dark).length} ` +
    `financeMidnight=${Object.keys(t.financeMidnight).length} financeGraphite=${Object.keys(t.financeGraphite).length} tokens)`
  );
}

main();

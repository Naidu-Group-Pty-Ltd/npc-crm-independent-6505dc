#!/usr/bin/env node
/**
 * Cross-browser CSS guard.
 *
 * The app's entire surface language is frosted glass, which means the whole
 * product leans on `backdrop-filter`. WebKit shipped that property behind a
 * vendor prefix and only dropped the requirement in Safari 18, so a rule that
 * declares it unprefixed renders as flat translucency on every older iOS and
 * macOS Safari — no error, no warning, just a surface that quietly stops
 * looking like the design.
 *
 * That failure mode is invisible in CI and invisible in Chrome, which is why
 * it is worth a check rather than a code-review convention. This asserts that
 * every rule declaring one of the properties below also declares its
 * `-webkit-` twin, in the same rule, in either order.
 *
 * Usage:
 *   node scripts/audit-css-compat.cjs           # exit 1 on any gap
 *   node scripts/audit-css-compat.cjs --report  # list every rule it checked
 */
'use strict';

const fs = require('fs');
const path = require('path');

const STYLES = path.join(__dirname, '..', 'src', 'styles');

/**
 * [property, webkit twin, why it matters]
 * Only properties whose prefixed form is still load-bearing on a browser we
 * support. Prefixes that are pure legacy noise are deliberately absent.
 */
const REQUIRED_PREFIXES = [
  ['backdrop-filter', '-webkit-backdrop-filter', 'Safari < 18 renders the surface unblurred'],
  ['mask-image', '-webkit-mask-image', 'Safari drops the fade entirely'],
  ['background-clip', '-webkit-background-clip', 'gradient text renders as a solid block', (v) => /(^|\s)text(\s|$|;)/.test(v)],
  ['user-select', '-webkit-user-select', 'text stays selectable on iOS'],
  ['text-size-adjust', '-webkit-text-size-adjust', 'iOS inflates text in landscape'],
];

/** Yield only innermost rules, so @layer / @media wrappers are not mistaken for rules. */
function* leafRules(css) {
  const stack = [];
  let line = 1;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '\n') line++;
    else if (ch === '{') stack.push({ line, start: i + 1, hasChild: false });
    else if (ch === '}') {
      const frame = stack.pop();
      if (!frame) continue;
      if (!frame.hasChild) yield { line: frame.line, body: css.slice(frame.start, i) };
      if (stack.length) stack[stack.length - 1].hasChild = true;
    }
  }
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.css')) out.push(full);
  }
  return out;
}

function main() {
  const report = process.argv.includes('--report');
  const gaps = [];
  let checked = 0;

  for (const file of walk(STYLES)) {
    const css = fs.readFileSync(file, 'utf8');
    const rel = path.relative(path.join(__dirname, '..'), file);

    for (const { line, body } of leafRules(css)) {
      for (const [prop, webkit, why, valueFilter] of REQUIRED_PREFIXES) {
        // the unprefixed property, not part of a longer identifier
        const decl = new RegExp(`(?<![-\\w])${prop}\\s*:\\s*([^;}]+)`, 'g');
        let m;
        while ((m = decl.exec(body))) {
          if (valueFilter && !valueFilter(m[1])) continue;
          checked++;
          if (!body.includes(webkit)) {
            gaps.push({ rel, line, prop, webkit, why });
          }
          break;
        }
      }
    }
  }

  if (report) console.log(`Checked ${checked} declaration(s) needing a -webkit- twin.`);

  if (gaps.length) {
    console.error('\n✖ Missing vendor prefixes — these degrade silently in Safari:\n');
    for (const g of gaps) {
      console.error(`  ${g.rel}:${g.line}`);
      console.error(`      ${g.prop} declared without ${g.webkit}`);
      console.error(`      → ${g.why}\n`);
    }
    console.error(`  Add the ${'-webkit-'} declaration alongside each one, in the same rule.\n`);
    process.exit(1);
  }

  console.log(`✔ CSS compatibility guard holds (${checked} prefixed declaration(s) verified).`);
}

main();

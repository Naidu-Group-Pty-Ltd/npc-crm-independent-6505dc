#!/usr/bin/env node
/**
 * A search field must offer a way out.
 *
 * ## The defect this closes
 *
 * A search box with text in it and no clear control is a dead end: the only
 * exit is selecting the text and deleting it. On a phone that is a fiddle,
 * and beside a filter chip it reads as "the page is stuck" — which is how it
 * was reported, twice, against two different pages.
 *
 * The clear control was added to the client tracker by hand. That fixed one
 * field out of 104: 90 stateful search inputs across 95 files still had no
 * way out, and every future one would have been a coin toss. So the field is
 * a component now — `@/components/ui/search-input` — and this gate stops a
 * raw `<Input>` search box from being added beside it.
 *
 * ## What counts as a violation
 *
 * A controlled `<Input>` (it has both `value` and `onChange`) whose
 * placeholder says "search" or "filter" — the two words the codebase uses
 * for this field — and which has no clear affordance anywhere near it.
 * "Near" is deliberately generous: a hand-rolled ✕ button a few lines below
 * the input satisfies this gate. The rule is that the WAY OUT exists, not
 * that a particular component was used, because a command palette and a
 * combobox legitimately solve it differently.
 *
 * Anything the gate cannot judge, it passes. A false failure here would make
 * contributors delete the check; a false pass costs one review comment.
 *
 * ## Why a baseline file and not zero
 *
 * There is none, and that is the point: the sweep that introduced this gate
 * converted every violation it found, so the floor is zero and stays zero.
 * A baseline would have made the next 90 invisible all over again.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname;
const SRC = join(ROOT, 'src');

/** The JSX element and its attributes, brace-aware so `=>` inside a handler is not a tag end. */
const INPUT_RE = /<(Input|input)\b((?:[^<>"']|"[^"]*"|'[^']*'|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\})*?)\/?>/gs;
const PLACEHOLDER_RE = /placeholder=("(?:[^"]*)"|\{(?:[^{}]|\{[^{}]*\})*\})/;
const SEARCHY_RE = /search|filter/i;
/** Any of these within the window is a way out: the shared field, a ✕, or an explicit clear. */
const CLEAR_RE = /SearchInput|<X\b|XCircle|Clear search|clearSearch|onClear/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const violations = [];
for (const file of walk(SRC)) {
  const src = readFileSync(file, 'utf8');
  if (!SEARCHY_RE.test(src)) continue;
  const lines = src.split('\n');
  for (const match of src.matchAll(INPUT_RE)) {
    const attrs = match[2];
    const placeholder = attrs.match(PLACEHOLDER_RE);
    if (!placeholder || !SEARCHY_RE.test(placeholder[1])) continue;
    if (!/value=\{/.test(attrs) || !/onChange=\{/.test(attrs)) continue;
    const line = src.slice(0, match.index).split('\n').length;
    const window = lines.slice(Math.max(0, line - 15), line + 18).join('\n');
    if (CLEAR_RE.test(window)) continue;
    violations.push({ file: file.slice(ROOT.length), line, placeholder: placeholder[1].slice(0, 60) });
  }
}

if (violations.length > 0) {
  console.error(`\nSearch fields with no way to clear them: ${violations.length}\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  placeholder=${v.placeholder}`);
  }
  console.error(`
Use the shared field instead of a raw <Input>:

  import { SearchInput } from '@/components/ui/search-input';

  <SearchInput
    value={query}
    onValueChange={setQuery}
    placeholder="Search clients..."
    containerClassName="flex-1"   // wrapper
    className="h-10"              // the input, as before
  />

It draws the magnifier, shows a ✕ exactly when there is something to clear,
clears on Escape, and returns focus to the field. Where a call site must keep
its own markup, render your own clear control — this gate accepts that too.
`);
  process.exit(1);
}

console.log('Search-clear check passed (every controlled search field offers a way to clear it).');

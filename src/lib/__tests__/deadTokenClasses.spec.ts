/**
 * Utility classes with a stray trailing zero, which render nothing.
 *
 * `text-success-foreground0` is not a Tailwind class. The trailing zero means
 * no rule is emitted, so the element draws in whatever colour it inherits —
 * and because that is usually *a* colour rather than none, the mistake looks
 * like a design choice rather than a bug. Nothing in the build warns.
 *
 * `notificationsContract.test.ts` caught this in one file, where the typo had
 * been copied twenty-four times. The same shape was in another seventy-seven:
 *
 *   text-success-foreground0      126
 *   text-destructive-foreground0   55
 *   text-info-foreground0          46
 *   text-warning-foreground0       22
 *   text-accent-foreground0        19
 *   bg/via-muted0                  17
 *
 * — 289 in all, every variant compiling to zero CSS rules.
 *
 * The repair was NOT the obvious one. `--success-foreground` is `0 0% 100%`
 * and `--warning-foreground` / `--info-foreground` are `0 0% 5%` under
 * `.dark`: they are the colours for text ON a filled `bg-success`, so
 * stripping the zero would have painted 126 elements pure white and turned
 * the info and warning ones near-black on a dark ground. Measured across all
 * 272 sites, NONE sat on a solid fill of its own colour — 72 were on a tint
 * and 200 on the page or card ground — so the semantic colour (`text-success`)
 * is what every one of them wanted.
 *
 * This guard is repo-wide so the next copy-paste is caught in CI rather than
 * in an audit.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..', '..');

/**
 * Semantic names that exist as design tokens. A class built from one of these
 * with a trailing zero is always a typo — there is no `success0`.
 */
const SEMANTIC_TOKENS = [
  'background', 'foreground', 'card', 'popover', 'primary', 'secondary',
  'muted', 'accent', 'destructive', 'success', 'warning', 'info', 'border',
  'input', 'ring', 'brand',
] as const;

/** `bg-muted0`, `text-success-foreground0`, `via-muted0/80`, … */
const DEAD_CLASS = new RegExp(
  String.raw`\b[a-z-]+-(?:${SEMANTIC_TOKENS.join('|')})(?:-foreground)?0(?:\/\d+)?\b`,
  'g',
);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      sourceFiles(full, out);
      continue;
    }
    // A spec that names the shape in order to forbid it is not an offender.
    if (!/\.tsx?$/.test(entry.name) || /\.(spec|test)\.tsx?$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

describe('no utility class ends in a stray zero', () => {
  it('across the whole of src', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(root, 'src'))) {
      const matches = readFileSync(file, 'utf8').match(DEAD_CLASS);
      if (matches) {
        offenders.push(`${file.replace(root + '/', '')}: ${[...new Set(matches)].join(', ')}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('recognises the shapes this was written for', () => {
    // Guarding the guard: if the pattern stops matching, the test above
    // passes for the wrong reason.
    for (const dead of [
      'text-success-foreground0',
      'text-destructive-foreground0/60',
      'bg-muted0/10',
      'via-muted0/80',
      'text-info-foreground0',
    ]) {
      expect(dead.match(new RegExp(DEAD_CLASS.source))).not.toBeNull();
    }
  });

  it('does not flag the real classes they were corrected to', () => {
    for (const live of [
      'text-success', 'text-destructive/60', 'bg-muted/10', 'via-muted/80',
      'text-success-foreground', 'text-info', 'bg-primary/10', 'border-warning/30',
      // A number that is part of a scale, not a stray zero.
      'gap-10', 'w-10', 'z-50', 'text-brand-100', 'bg-brand-300/10',
    ]) {
      expect(live.match(new RegExp(DEAD_CLASS.source))).toBeNull();
    }
  });
});

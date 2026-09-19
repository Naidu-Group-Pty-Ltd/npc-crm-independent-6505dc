/**
 * The stylesheet is one template literal, so a backtick in a CSS comment ends
 * it.
 *
 * Nothing subtle about the failure — the module stops parsing and every spec
 * that imports it dies at transform time. What makes it worth a guard is how
 * easy it is to reintroduce: the house comment style quotes identifiers in
 * backticks everywhere else in the repo, and inside this one function that is a
 * syntax error rather than a style choice. It has now been made four times.
 *
 * ## Why this is its own file
 *
 * The guard lived in `reportCss.spec.ts`, which imports `buildReportCss`. So on
 * the fourth occurrence the transform failed, the whole spec file died before a
 * test ran, and the guard written to name this exact mistake reported nothing —
 * leaving nineteen unrelated suites failing with a parse error and no clue
 * which line caused it.
 *
 * This file reads the module as **text** and imports nothing from it. It is the
 * one check that has to survive the module being unparseable.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(
  resolve(__dirname, '../../../../supabase/functions/_shared/reportDesign/css.pure.ts'),
  'utf8',
);

/**
 * How the offenders are found.
 *
 * A CSS comment inside one of this module's template literals opens with `/*`.
 * A JSDoc comment, which is where the house style *does* quote identifiers in
 * backticks and should keep doing so, opens with three characters. That is the
 * whole distinction, and it holds across all 66 of the module's block comments.
 *
 * The version this replaced sliced the source from `'\nfunction sheet('` —
 * a function that does not exist in the module and never has. `indexOf`
 * returned -1, `slice(-1)` took the final character of the file, and the guard
 * scanned one character on every run since it was written. It reported a pass
 * on the two occasions the mistake it names was actually made.
 */
function backtickedCssComments(source: string): string[] {
  const offenders: string[] = [];
  let inCssComment = false;
  for (const line of source.split('\n')) {
    // An escaped backtick is the module's own convention for quoting inside a
    // CSS comment and is perfectly legal — it does not close anything. Removed
    // before the test rather than exempted after it, so a line carrying one
    // escaped and one bare backtick is still caught.
    const bare = line.replace(/\\`/g, '');
    // `/*` inside a string is not a comment. `namedPageRule` returns a template
    // that contains the characters `/*` as CSS output, which is exactly this.
    const opens = /\/\*(?!\*)/.test(bare) && !/`[^`]*\/\*/.test(bare);
    if (opens) inCssComment = true;
    if (inCssComment && bare.includes('`')) offenders.push(line.trim());
    if (bare.includes('*/')) inCssComment = false;
  }
  return offenders;
}

describe('the stylesheet is one template literal', () => {
  it('quotes nothing in backticks inside a CSS comment', () => {
    expect(
      backtickedCssComments(SOURCE),
      'a backtick in a CSS comment closes the stylesheet’s template literal',
    ).toEqual([]);
  });

  it('finds one when there is one — the guard itself has been wrong twice', () => {
    expect(backtickedCssComments('  /* the `case` feature */')).toHaveLength(1);
    expect(backtickedCssComments('/** the `case` feature */')).toHaveLength(0);
    expect(backtickedCssComments('  /* a comment */\n  const x = `ok`;')).toHaveLength(0);
  });
});

/**
 * A citation is a sentence, not a marker.
 *
 * ## What the suite carries
 *
 * Nine of the ten delivered documents carry at least one bracketed marker,
 * and one Compass carries nine. Two forms, one fault:
 *
 *  - **A pointer into the prompt.** `[Zoning & Planning notes]` ×5,
 *    `[Infrastructure section]` ×2, `[Zoning & Planning table]`,
 *    `[Infrastructure table]` — set mid-sentence in the client's prose:
 *    *"…must factor into rental and resale expectations.[Infrastructure
 *    section] The recorded 680 new dwellings…"*. Those are the headings of
 *    the pinned evidence block. They are instructions. The reader has never
 *    seen them and cannot open them.
 *  - **A source as a token.** `[Property.com.au]` ×4, `[View.com.au]` ×2 on
 *    the second subject — a real source, written as a bracket instead of as
 *    part of the sentence.
 *
 * ## Why the fix is not to delete them
 *
 * The claims behind them are supported. The planning and infrastructure
 * tables are appended VERBATIM to the finished document under
 * `## Planning controls and development registers`, so there is a real
 * section to point at and a real publisher, with its own currency date, to
 * name. Stripping the brackets would leave those sentences unsourced — worse
 * than an ugly sentence that is sourced, and it would prove nothing about
 * whether the surrounding claim holds.
 *
 * So the rule says what a reference must look like INSTEAD, and it is carried
 * inside the pinned context: a rule about how to cite this evidence is
 * worthless in the part of the prompt that is trimmed away from it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(
  resolve(__dirname, '../../../../supabase/functions/generate-investment-report/index.ts'),
  'utf8',
);
/**
 * The rule as the MODEL receives it.
 *
 * It is authored as an array of lines joined with newlines, so the source
 * carries `',` and `'` at every line break and a phrase that spans two lines
 * is unmatchable in the raw text. Stitch the string literals back together
 * and assert over what is actually sent — which is the thing the rule is
 * about.
 */
const ruleSource = src.slice(src.indexOf('const planningCitationRule'), src.indexOf('const pinnedPlanningContext'));
const rule = [...ruleSource.matchAll(/'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)]
  .map((m) => (m[1] ?? m[2]).replace(/\\'/g, "'"))
  .join('\n');

describe('the report cites its evidence in the sentence', () => {
  it('forbids each bracketed pointer the suite actually produced', () => {
    for (const marker of [
      '[Zoning & Planning table]', '[Infrastructure section]',
      '[Zoning & Planning notes]', '[Infrastructure table]',
    ]) {
      expect(rule, marker).toContain(marker);
    }
    expect(rule).toContain('never write a bracketed pointer');
  });

  it('forbids a source written as a token, which is the other form', () => {
    expect(rule).toContain('[Property.com.au]');
    expect(rule).toContain('named in the');
    expect(rule).toContain('never as a bracketed');
    expect(rule).toContain('token like `[Property.com.au]`');
  });

  it('gives the two references a reader can actually follow', () => {
    // Naming the publisher, which the table beside it already carries…
    expect(rule).toContain('Name the publisher and its currency');
    // …or the heading the table is set out under, inside its own chapter.
    expect(rule).toContain('Name the heading it is set out under');
    expect(rule).toContain('*${PLANNING_REGISTER_HEADING}*');
    expect(rule).toContain('*${INFRASTRUCTURE_REGISTER_HEADING}*');
  });

  it('names headings the document really has', () => {
    // The rule points at a heading; these are the lines that write them, from
    // the same constants. It used to name "Planning controls and development
    // registers" — the section the tables were appended under before they
    // moved inside their chapters (25 Sep 2026), which the page then carried
    // only when a chapter was absent: a dangling pointer, the fault this
    // test exists for.
    expect(src).toContain('`### ${PLANNING_REGISTER_HEADING}');
    expect(src).toContain('`### ${INFRASTRUCTURE_REGISTER_HEADING}');
    expect(rule).not.toContain('at the end of this report');
  });

  it('rides INSIDE the pinned context, where the trim cannot separate them', () => {
    const pinned = src.slice(src.indexOf('const pinnedPlanningContext'), src.indexOf('].join(\'\\n\\n\');', src.indexOf('const pinnedPlanningContext')));
    expect(pinned).toContain('planningCitationRule');
  });

  it('does not tell the model to drop an unsourced claim’s content silently', () => {
    // The instruction of last resort has to be honest: no nameable source
    // means the claim does not belong, rather than "remove the bracket".
    expect(rule).toContain('it has no source, and it does not belong in the report');
  });
});

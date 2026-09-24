/**
 * A client document never describes its own production.
 *
 * Found by reading the rendered pages of all five tiers on 18 September 2026,
 * through the journey harness and `report-pdf/measure.mjs`. Two instances,
 * each a `TOKEN` finding on a real page of a real document, and each the same
 * underlying mistake — the report talking about OUR record-keeping instead of
 * the reader's property.
 *
 * ## 1. An absence drawn as a finding
 *
 * Due Diligence p7 and, across the retained set, **4 of 194 at-a-glance cells**
 * read like `⚠ Exact bed/bath/car details not provided`. Three of the four are
 * on `8ef4bfc3`, the sparse Compass with no financials — the shape where the
 * record holds least is exactly where the model reaches for this.
 *
 * `⚠` is the strip's *watch* symbol: it means something a buyer should watch.
 * A gap in our file drawn in that cell reads as a defect in the house.
 *
 * The contract already said the right thing about PROSE — "Where a figure was
 * not supplied, omit the sentence that would have carried it … do not say it
 * is unavailable". The model obeyed it and put the absence in a chip, which is
 * the same routing-around this repository has recorded twice before (the
 * planning rule that closed the STATEMENT and was answered with a RATING one
 * row later). So the prohibition is extended to every primitive, and the
 * permitted form is demonstrated: fewer cells.
 *
 * ## 2. The document naming its own source
 *
 * Briefing p4: *"Specific market activity metrics … were not provided
 * numerically in the original report."* Row `89b451f6` carries four of these,
 * each shaped `N/A (… not provided in the original report.)`.
 *
 * The cause is exact and is in the prompt: the parent was handed to the model
 * under the literal label `ORIGINAL COMPREHENSIVE REPORT:`, and the model gave
 * that phrase to the client. The reader was handed one document and cannot
 * open the other one.
 *
 * It is also the second half of the routing-around: `IMPORTANT` banned the
 * TOKEN ("NEVER write N/A") without naming the permitted form, so the model
 * wrote a sentence narrating the gap and parenthesised the token inside it.
 * A prose bullet is where the read-path placeholder scrub correctly cannot
 * reach — **prose is never regex-scrubbed** — so this has to be fixed at the
 * producer or not at all.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { COMPASS_DOCUMENT_CONTRACT } from '../../../../supabase/functions/_shared/reports/investment/compassDocumentContract.pure';

const CONDENSE = 'supabase/functions/condense-investment-report/index.ts';
const condense = () => readFileSync(CONDENSE, 'utf8');

describe('an absence is never drawn as a finding', () => {
  it('the contract extends the omit rule past prose, into the strip', () => {
    expect(COMPASS_DOCUMENT_CONTRACT).toMatch(/No absence drawn as a finding/);
    // The rule has to say WHICH surfaces, or it reads as a restatement of the
    // prose rule directly above it.
    expect(COMPASS_DOCUMENT_CONTRACT).toMatch(/a cell, a register row and a chart say things too/);
  });

  it('it names what an item to watch means, because that is the confusion', () => {
    const at = COMPASS_DOCUMENT_CONTRACT.indexOf('No absence drawn as a finding');
    const rule = COMPASS_DOCUMENT_CONTRACT.slice(at, at + 900);
    // The at-a-glance strip that carried the \u26a0 symbol is withdrawn from
    // the document (glanceWithdrawal.pure.ts); the rule outlives it, because a
    // table row or a register entry can report our own gap just as a cell did.
    expect(rule).toMatch(/an item a\s+buyer should watch/);
    expect(rule, 'the reading it produces is the point').toMatch(/defect in the house/);
  });

  it('it demonstrates the permitted form rather than only prohibiting', () => {
    const at = COMPASS_DOCUMENT_CONTRACT.indexOf('No absence drawn as a finding');
    const rule = COMPASS_DOCUMENT_CONTRACT.slice(at, at + 900);
    // A prohibition with no demonstration of the permitted form is one a model
    // routes around — which is how this defect exists at all.
    expect(rule).toMatch(/say less/);
    expect(rule).toMatch(/two rows that each carry a finding are a\s+complete table/);
  });

  it('the prose rule it builds on is still there and still says omit', () => {
    expect(COMPASS_DOCUMENT_CONTRACT).toMatch(/omit the sentence that would have/);
    expect(COMPASS_DOCUMENT_CONTRACT).toMatch(/do not say\s+it is unavailable/);
  });
});

describe('the condensed document never names the document it was condensed from', () => {
  it('the source block is labelled as pipeline input, not as a report', () => {
    const s = condense();
    expect(s, 'the label the leaked phrase came from').not.toContain('ORIGINAL COMPREHENSIVE REPORT:');
    expect(s).toContain('SOURCE MATERIAL (pipeline input — the reader has never seen this document):');
  });

  it('no prompt text hands the model the phrase to reuse', () => {
    const s = condense();
    // Everything from the opening of TIER_CONFIG to the end of the user
    // prompt: the structure guides and the IMPORTANT list. The only permitted
    // occurrences are inside the rule that forbids the phrase, and the comment
    // recording why — both of which quote it deliberately.
    const start = s.indexOf('const TIER_CONFIG');
    const end = s.indexOf('Maintain professional formatting throughout');
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const lines = s.slice(start, end).split('\n');
    const offenders = lines.filter((l) =>
      /the original report|the parent report|the full report/i.test(l)
      && !/Never mention the source material/.test(l)
      && !/^\s*\/\//.test(l));
    expect(offenders, `prompt text still names the source document:\n${offenders.join('\n')}`)
      .toEqual([]);
  });

  it('the reader is told they hold one document, and the phrases are named', () => {
    const s = condense();
    expect(s).toMatch(/The reader is handed exactly ONE document: this one\./);
    for (const phrase of ['the original report', 'the parent report', 'the full report']) {
      expect(s, `${phrase} must be named to be forbidden`).toContain(`"${phrase}"`);
    }
  });

  it('the permitted form is stated beside the prohibition, not left implied', () => {
    const s = condense();
    // The token ban alone is what the model routed around: denied "N/A", it
    // wrote a sentence reporting the gap instead.
    expect(s).toMatch(/NEVER write "N\/A", "TBD" or any placeholder/);
    expect(s).toMatch(/OMIT the line, the bullet or the row/);
    expect(s).toMatch(/Do not write a sentence reporting the gap/);
    expect(s).toMatch(/a reader who is not told a number has lost nothing/);
  });

  it('a heading with nothing under it is refused too, which is the other escape', () => {
    // Omitting the line while keeping its heading produces the empty section
    // the placeholder scrub used to leave behind.
    expect(condense()).toMatch(/do not put the gap in a heading with nothing under it/);
  });
});

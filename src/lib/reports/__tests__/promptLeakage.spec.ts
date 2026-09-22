/**
 * An instruction addressed to the model must never reach the reader.
 *
 * The leaked text in these fixtures is not invented: it is the real output of
 * `approvalsFactBlocks`, `marketFactBlocks` and the subject-price rules,
 * taken by calling them. A fixture shorter or tidier than the product is how
 * a real measurement becomes a statement about the fixture — this
 * repository's §5 lesson, and the reason the sample here is the product's own
 * bytes.
 */
import { describe, it, expect } from 'vitest';
import {
  PROMPT_RULES_HEADER,
  stripPromptRulesBlocks,
} from '../../../../supabase/functions/_shared/reports/investment/promptLeakage.pure.ts';
import {
  approvalsFactBlocks,
} from '../../../../supabase/functions/_shared/reports/market/approvalsFactBlocks.pure.ts';

/** The product's own words, not a paraphrase of them. */
const REAL_BLOCK = approvalsFactBlocks(null, 'not_loaded');

describe('the header is a closed shape', () => {
  it('matches every rules header the product actually emits', () => {
    const headers = REAL_BLOCK.split('\n').filter((l) => PROMPT_RULES_HEADER.test(l));
    expect(headers).toHaveLength(1);
    expect(headers[0]).toContain('RULES FOR THIS REPORT');
  });

  it('matches the other two pinned blocks’ shapes', () => {
    expect(PROMPT_RULES_HEADER.test('MARKET FIGURE RULES FOR THE WHOLE REPORT — they apply everywhere:')).toBe(true);
    expect(PROMPT_RULES_HEADER.test('SUBJECT PRICE RULES FOR THE WHOLE REPORT — every section:')).toBe(true);
    expect(PROMPT_RULES_HEADER.test('**RULES FOR THIS SECTION:**')).toBe(true);
  });

  it('does not match a sentence that merely mentions rules', () => {
    for (const line of [
      'The council rules for this report are set out in the LEP.',
      'Planning rules for the whole report were retrieved from the register.',
      'Zoning rules apply to this property.',
      '| Rule | Effect |',
    ]) {
      expect(PROMPT_RULES_HEADER.test(line), line).toBe(false);
    }
  });
});

describe('it removes the block and nothing around it', () => {
  it('strips the real block out of a document that reproduced it', () => {
    const doc = [
      '## Supply',
      '',
      'Approved dwelling supply was not searched for this report.',
      '',
      REAL_BLOCK.split('\n').slice(-6).join('\n'),
      '',
      '## Next section',
      '',
      'This paragraph must survive.',
    ].join('\n');
    const out = stripPromptRulesBlocks(doc);
    expect(out.removed).toBe(1);
    expect(out.markdown).not.toMatch(/RULES FOR THIS REPORT/);
    expect(out.markdown).not.toMatch(/Do NOT rate supply/);
    // Everything else is untouched.
    expect(out.markdown).toContain('Approved dwelling supply was not searched');
    expect(out.markdown).toContain('## Next section');
    expect(out.markdown).toContain('This paragraph must survive.');
  });

  it('stops at the first line that is not a list item', () => {
    const doc = [
      'RULES FOR THIS REPORT — approved supply:',
      '1. One.',
      '2. Two.',
      '',
      'A paragraph immediately after, which is not part of the block.',
    ].join('\n');
    const out = stripPromptRulesBlocks(doc);
    expect(out.markdown.trim()).toBe('A paragraph immediately after, which is not part of the block.');
  });

  it('removes more than one block where a model repeated itself', () => {
    const block = 'RULES FOR THIS REPORT — approved supply:\n1. One.\n2. Two.';
    const out = stripPromptRulesBlocks(`${block}\n\nMiddle.\n\n${block}\n\nEnd.`);
    expect(out.removed).toBe(2);
    expect(out.headers).toHaveLength(2);
    expect(out.markdown).toContain('Middle.');
    expect(out.markdown).toContain('End.');
  });

  it('leaves no hole where a block was', () => {
    const out = stripPromptRulesBlocks(
      'Before.\n\nRULES FOR THIS REPORT — approved supply:\n1. One.\n\n\n\nAfter.',
    );
    expect(out.markdown).not.toMatch(/\n{3,}/);
  });
});

describe('it is a no-op on a clean document, asserted rather than intended', () => {
  it('returns a document with no rules header byte-identical', () => {
    const clean = [
      '## Approved dwelling supply',
      '',
      'The register was searched for Greater Bendigo and publishes 764 dwelling',
      'units approved in the twelve months to July 2026.',
      '',
      '| Dwelling type | Units |',
      '| --- | --- |',
      '| houses | 573 |',
      '',
      '1. A numbered list that belongs to the document.',
      '2. And its second item.',
    ].join('\n');
    const out = stripPromptRulesBlocks(clean);
    expect(out.markdown).toBe(clean);
    expect(out.removed).toBe(0);
  });

  it('short-circuits without touching a body that never says RULES FOR', () => {
    const doc = 'Nothing here at all.\n\nJust prose.';
    expect(stripPromptRulesBlocks(doc).markdown).toBe(doc);
    expect(stripPromptRulesBlocks('').markdown).toBe('');
  });
});

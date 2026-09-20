/**
 * Emphasis is a signal, and a signal that fires on one word in five is noise.
 *
 * Measured on the Investment Compass issued for 97 Poole Road, Kellyville on
 * 20 Sep 2026, read back out of the delivered PDF by font: 41,773 characters
 * of regular body copy against 9,570 bold — **18.6%**, at 7.2 emphasised spans
 * per page, with the five longest spans running 160-246 characters each.
 *
 * The rule that carries this file, and the one the whole module turns on:
 * **nothing here changes a word.** `**` and `__` are markup. Strip the markers
 * from the input and from the output and the two are byte-identical, which is
 * what separates this from the prose regex-scrub `RUNTIME_CONSOLIDATION.md` §8
 * forbids — and it is asserted, not promised.
 */
import { describe, expect, it } from 'vitest';
import {
  EMPHASIS_PHRASE_WORDS,
  findEmphasis,
  isClauseSpan,
  isFigureSpan,
  isRunInLabel,
  limitEmphasis,
} from '@/lib/reports/investment/emphasisDensity.pure';

/** What a reader sees once the emphasis markers are taken off. */
const words = (s: string) => s.replace(/\*\*/g, '').replace(/__/g, '');
const spansOf = (s: string) => (s.match(/\*\*[^*\n]+\*\*/g) ?? []);

describe('a span that is a clause is not emphasis', () => {
  it('unwraps the shouted paragraph measured on p11 of the audited report', () => {
    const src = "From an investor's perspective, **this part of Kellyville is best thought"
      + ' of as a mature, low-density family suburb where housing demand is supported by'
      + ' household stability and nearby job centres, rather than rapid local population'
      + ' expansion.**';
    const out = limitEmphasis(src);
    expect(spansOf(out.markdown)).toHaveLength(0);
    expect(out.unwrapped.clause).toBe(1);
    expect(words(out.markdown)).toBe(words(src));
  });

  it('counts a long clause with no punctuation in it as a clause', () => {
    // Nine words, no comma. The punctuation test cannot see this one, which is
    // why EMPHASIS_PHRASE_WORDS exists.
    const long = '**The Hills Shire shows a meaningful pipeline of new dwellings**';
    expect(isClauseSpan('The Hills Shire shows a meaningful pipeline of new dwellings')).toBe(true);
    expect(spansOf(limitEmphasis(long).markdown)).toHaveLength(0);
  });

  it('keeps a phrase at the ceiling and drops one past it', () => {
    const at = Array.from({ length: EMPHASIS_PHRASE_WORDS }, (_, i) => `w${i}`).join(' ');
    const past = `${at} w${EMPHASIS_PHRASE_WORDS}`;
    expect(isClauseSpan(at)).toBe(false);
    expect(isClauseSpan(past)).toBe(true);
  });
});

describe('a figure is not emphasised', () => {
  it.each([
    '6.3%',
    '$1,808,000',
    '241 new dwellings',
    '450 m² minimum lot size',
    '10 m height limit',
  ])('unwraps %s — the digits already carry the contrast', (figure) => {
    expect(isFigureSpan(figure)).toBe(true);
    const out = limitEmphasis(`The register records **${figure}** for this point.`);
    expect(spansOf(out.markdown)).toHaveLength(0);
    expect(out.unwrapped.figure).toBe(1);
  });

  it('does not call a phrase a figure merely for carrying a year', () => {
    expect(isFigureSpan('permitted with consent under the 2019 instrument')).toBe(false);
  });

  it('leaves a phrase with no digit in it alone', () => {
    expect(isFigureSpan('dwelling house')).toBe(false);
  });
});

describe('a paragraph carries at most one emphasis', () => {
  it('keeps the first and unwraps the rest', () => {
    const src = 'Local growth compares with **the state-wide pace**, which sits'
      + ' **above this corridor** and **below the national figure**.';
    const out = limitEmphasis(src);
    expect(spansOf(out.markdown)).toEqual(['**the state-wide pace**']);
    expect(out.unwrapped.repeat).toBe(2);
    expect(words(out.markdown)).toBe(words(src));
  });

  it('gives every list item its own budget', () => {
    const src = '- **Higher-density centres** at Castle Hill\n- **Data-centre projects** at Norwest';
    expect(spansOf(limitEmphasis(src).markdown)).toHaveLength(2);
  });

  it('starts a fresh budget after a blank line', () => {
    const src = 'One **alpha** here.\n\nTwo **beta** there.';
    expect(spansOf(limitEmphasis(src).markdown)).toEqual(['**alpha**', '**beta**']);
  });
});

describe('a table cell carries no emphasis', () => {
  it('unwraps inside a row and leaves the row standing', () => {
    const src = '| Control | Reading |\n| --- | --- |\n| Zone | **R2 Low Density Residential** |';
    const out = limitEmphasis(src);
    expect(out.markdown).toContain('| Zone | R2 Low Density Residential |');
    expect(out.markdown.split('\n')).toHaveLength(3);
  });
});

describe('a run-in label is a heading, not emphasis', () => {
  it.each([
    '- **Local government area:** The Hills Shire Council',
    '- **Jurisdiction:** New South Wales',
    '**Minimum lot size.** The smallest lot the instrument will permit.',
  ])('keeps %s', (src) => {
    expect(spansOf(limitEmphasis(src).markdown)).toHaveLength(1);
  });

  it('does not spend the paragraph budget, so a labelled fact keeps its phrase', () => {
    const src = '- **Jurisdiction:** the **dwelling house** standing on this land';
    expect(spansOf(limitEmphasis(src).markdown)).toHaveLength(2);
  });

  it('refuses a sentence that merely ends in a full stop', () => {
    expect(isRunInLabel('The register was queried at this coordinate and answered.')).toBe(false);
  });
});

describe('structure is never entered', () => {
  it('leaves a heading exactly as written', () => {
    const src = '## **Market Positioning**';
    expect(limitEmphasis(src).markdown).toBe(src);
  });

  it('leaves a fenced block exactly as written', () => {
    const src = '```\n**not markup here, but a literal**\n```';
    expect(limitEmphasis(src).markdown).toBe(src);
  });

  it('leaves a directive payload exactly as written', () => {
    const src = '{{glance: ✓ **Strong** fundamentals | ⚠ Vacancy uptick}}';
    expect(limitEmphasis(src).markdown).toBe(src);
  });

  it('reads the body of a ::: fence but not the fence line', () => {
    const src = ':::stat\nA **mature suburb** with a settled base, and a second **phrase** here.\n:::';
    const out = limitEmphasis(src);
    expect(out.markdown.split('\n')[0]).toBe(':::stat');
    expect(spansOf(out.markdown)).toEqual(['**mature suburb**']);
  });

  it('leaves inline code alone', () => {
    const src = 'Write `**literal**` in the payload.';
    expect(limitEmphasis(src).markdown).toBe(src);
  });
});

describe('the guarantee', () => {
  /*
   * The whole argument for this module being admissible on the read path. If
   * this ever fails, the module has started rewriting prose and must come out.
   */
  it('changes not one character of what a reader reads', () => {
    const src = [
      "From an investor's perspective, **this part of Kellyville is a mature, low-density suburb.**",
      '',
      '- **Local government area:** The Hills Shire Council',
      '- The median is **$1,808,000** across **162 house sales**',
      '',
      '| Control | Reading |',
      '| --- | --- |',
      '| Zone | **R2** |',
      '',
      '## **A heading**',
      '',
      'One **phrase**, then **another**, then **a third**.',
    ].join('\n');
    const out = limitEmphasis(src);
    expect(words(out.markdown)).toBe(words(src));
    expect(out.markdown.split('\n')).toHaveLength(src.split('\n').length);
  });

  it('is a no-op on a document that emphasises nothing', () => {
    const src = 'A paragraph with no markup in it at all.\n\nAnd a second one.';
    expect(limitEmphasis(src).markdown).toBe(src);
  });

  it('leaves an unbalanced marker alone rather than mangling it', () => {
    const src = 'An opening **marker with no close.';
    expect(limitEmphasis(src).markdown).toBe(src);
    expect(findEmphasis(src)).toHaveLength(0);
  });

  it('does not reach inside bold-italic', () => {
    expect(findEmphasis('***bold italic***')).toHaveLength(0);
  });

  it('handles an empty document', () => {
    expect(limitEmphasis('').markdown).toBe('');
  });
});

/**
 * Stage 4 — a labelled BLOCK is a promise that a figure follows it.
 *
 * Two defects, both measured on the current corpus (33 Compass reports since
 * June 2026) and both verbatim in the fixtures below:
 *
 *  1. **The stat card with no value.** 23 of 71 cards (32%) across 15 of 24
 *     reports carry a label, a unit and a sub-caption and nothing else. The
 *     renderer draws `stat-value` unconditionally, so the client receives an
 *     oversized **"m"** or **"/100"** — the unit set in display type as though
 *     it were the statistic.
 *  2. **The chart drawn twice.** 5 of 26 chart-bearing reports repeat a
 *     directive, 7 redundant draws. The repeats are NEAR-identical, which is
 *     why the generator's own "render once" instruction and any exact-match
 *     comparison both miss them.
 *
 * The cases that matter most here are the ones that must NOT change: a card
 * with a value, a chart that differs by a real figure, a `:::` inside a code
 * fence, and the other fence kinds the renderer draws.
 */
import { describe, expect, it } from 'vitest';

import {
  dedupeChartDirectives,
  directiveKey,
  scrubBlocks,
  statCardHasValue,
  stripEmptyStatCards,
} from '../investment/blockHygiene.pure';

describe('a stat card with no value is not drawn', () => {
  // Verbatim from 6 Acer Court (2026-09-02).
  const ACER = [
    '### Property Snapshot', '',
    '::: stat label="Land size" unit="m²" sub="Established house on a substantial garden block"',
    '1922',
    ':::', '',
    '::: stat label="Building size" unit="m²" sub="Single dwelling, family-scale internal area"',
    '',
    ':::', '',
    '### Purpose of this Report', '',
  ].join('\n');

  it('drops the valueless card and keeps the one that states something', () => {
    const { markdown, removed } = stripEmptyStatCards(ACER);
    expect(removed).toBe(1);
    expect(markdown).toContain('1922');
    expect(markdown).toContain('Land size');
    // The whole card goes — label, unit and caption with it. Keeping the label
    // would leave the promise standing with nothing behind it.
    expect(markdown).not.toContain('Building size');
    expect(markdown).not.toContain('Single dwelling, family-scale internal area');
  });

  it('keeps the surrounding document intact', () => {
    const { markdown } = stripEmptyStatCards(ACER);
    expect(markdown).toContain('### Property Snapshot');
    expect(markdown).toContain('### Purpose of this Report');
    // No hole where the card stood.
    expect(markdown).not.toMatch(/\n{3,}/);
  });

  it('answers the predicate on every shape of nothing', () => {
    expect(statCardHasValue('1922')).toBe(true);
    expect(statCardHasValue('4.8%')).toBe(true);
    expect(statCardHasValue('')).toBe(false);
    expect(statCardHasValue('\n\n')).toBe(false);
    expect(statCardHasValue('  \t  ')).toBe(false);
    // A non-breaking space is still nothing.
    expect(statCardHasValue(' ')).toBe(false);
  });

  it('leaves a card alone when the value is a legitimate zero', () => {
    // "Absent is never zero" cuts both ways: a measured 0 is a statement.
    const zero = '::: stat label="Land tax" unit="$" sub="Under the threshold"\n0\n:::\n';
    expect(stripEmptyStatCards(zero).removed).toBe(0);
  });

  it('never touches the other fence kinds the renderer draws', () => {
    const others = [
      '::: pullquote', 'A quote.', ':::', '',
      '::: dashboard eyebrow="X" title="Y" big="3.2%"', '', ':::', '',
      '::: divider stat="78" label="Investment score"', 'A headline.', ':::', '',
    ].join('\n');
    const { markdown, removed } = stripEmptyStatCards(others);
    expect(removed).toBe(0);
    expect(markdown).toBe(others);
  });

  it('matches exactly the blocks the renderer treats as cards, fences included', () => {
    // `applyEditorialMarkdown` runs its fence regex over the whole markdown
    // with no code-fence awareness, so a `::: stat` inside a ``` block IS drawn
    // as a card today. That is the renderer's pre-existing behaviour and not
    // this change's to alter — but the scrubber must match the same set, or the
    // write path would leave a card the read path then draws as a bare unit.
    //
    // One predicate, both ends agreeing, is the point.
    const doc = [
      'Here is how to write one:', '',
      '```', '::: stat label="Example" unit="m"', '', ':::', '```', '',
    ].join('\n');
    expect(stripEmptyStatCards(doc).removed).toBe(1);
  });
});

describe('a chart already drawn is not drawn again', () => {
  it('drops a near-identical repeat and keeps a real difference', () => {
    const doc = [
      '{{bars: Houses 3,120, Units 1—450 | title=Stock | max=4000}}', '',
      'Some prose about the mix.', '',
      '{{bars: Houses 3120, Units 1-450 | title=Stock | max=4000}}', '',
      '{{bars: Houses 3120, Units 1-451 | title=Stock | max=4000}}', '',
    ].join('\n');
    const { markdown, removed } = dedupeChartDirectives(doc);
    expect(removed).toBe(1);
    // The first drawing survives — a report is read forwards, and the earlier
    // placement is the one its prose introduced.
    expect(markdown).toContain('Houses 3,120');
    // One digit different is a different chart.
    expect(markdown).toContain('Units 1-451');
    expect(markdown).toContain('Some prose about the mix.');
  });

  it('normalises only case, space, dashes and thousands separators', () => {
    expect(directiveKey('{{bars: A 3,120, B 1—450}}'))
      .toBe(directiveKey('{{bars: A 3120, B 1-450}}'));
    expect(directiveKey('{{Bars: A 10}}')).toBe(directiveKey('{{bars:A  10}}'));
    // Anything that changes a value, a label or a title is a different chart.
    expect(directiveKey('{{bars: A 10}}')).not.toBe(directiveKey('{{bars: A 11}}'));
    expect(directiveKey('{{bars: A 10}}')).not.toBe(directiveKey('{{bars: B 10}}'));
    expect(directiveKey('{{bars: A 10 | title=X}}')).not.toBe(directiveKey('{{bars: A 10 | title=Y}}'));
  });

  it('leaves a document with no repeats byte-identical', () => {
    // Adoption safety: 21 of 26 chart-bearing reports repeat nothing, and must
    // come out exactly as they went in.
    const clean = '{{bars: A 1, B 2}}\n\ntext\n\n{{line: A 3, B 4}}\n';
    const { markdown, removed } = dedupeChartDirectives(clean);
    expect(removed).toBe(0);
    expect(markdown).toBe(clean);
  });

  it('does not de-duplicate a glance strip or a table directive', () => {
    // Only the kinds that DRAW A FIGURE. A repeated glance strip is prose the
    // author chose twice, and two identical `{{table:}}` calls may legitimately
    // introduce different surrounding rows.
    const doc = '{{glance: A | B}}\n\n{{glance: A | B}}\n';
    expect(dedupeChartDirectives(doc).removed).toBe(0);
  });
});

describe('both passes together', () => {
  it('reports what each removed, and reports nothing on a clean document', () => {
    const clean = '## Heading\n\nA paragraph.\n\n{{bars: A 1}}\n\n::: stat label="X" unit="%"\n4.8\n:::\n';
    const r = scrubBlocks(clean);
    expect(r.emptyStatCards).toBe(0);
    expect(r.duplicateDirectives).toBe(0);
    expect(r.markdown).toBe(clean);
  });

  it('handles an empty and an absent document without throwing', () => {
    for (const input of ['', null as unknown as string, undefined as unknown as string]) {
      const r = scrubBlocks(input);
      expect(r.emptyStatCards).toBe(0);
      expect(r.duplicateDirectives).toBe(0);
    }
  });
});

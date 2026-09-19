/**
 * A strip cell reports a finding about the PROPERTY, never a gap in our file.
 *
 * Found in the S6 acceptance run, 18 Sep 2026, by reading the rendered pages:
 * two issued documents draw `⚠ Exact bed/bath/car details not provided` and
 * `⚠ Exact facility distances not provided` in an at-a-glance strip.
 * `compassDocumentContract` forbids the first by name and quotes it verbatim —
 * "which a client reads as a defect in the house rather than a gap in our
 * file" — but that rule reaches the MODEL, and both documents were written
 * before it existed. §8 of RUNTIME_CONSOLIDATION is the precedent: the scrub
 * runs where stored content is read.
 */

import { describe, expect, it } from 'vitest';
import {
  presentStoredMarkdown,
  stripOwnGapCells,
} from '@/lib/reports/investment/derivedHygiene.pure';

/** Verbatim from `2f1f7f6f` and `8ef4bfc3`, as rendered. */
const MEASURED_A = '{{glance: ✓ Matches workaday local demand | ✓ Functional over flashy '
  + '| ⚠ Exact bed/bath/car details not provided | ★ Best for practical occupiers}}';
const MEASURED_B = '{{glance: ✓ Established township amenity | ⚠ Exact facility distances not provided '
  + '| ◆ Practical daily access profile | ★ Suits convenience-led occupiers}}';

describe('the measured cells go, and the strip stays', () => {
  it('removes the bed/bath/car cell and keeps the other three', () => {
    const { markdown, removedCells, removedDirectives } = stripOwnGapCells(MEASURED_A);
    expect(removedCells).toEqual(['⚠ Exact bed/bath/car details not provided']);
    expect(removedDirectives).toBe(0);
    expect(markdown).toBe('{{glance: ✓ Matches workaday local demand | ✓ Functional over flashy '
      + '| ★ Best for practical occupiers}}');
  });

  it('removes the facility-distances cell and keeps the other three', () => {
    const { markdown, removedCells } = stripOwnGapCells(MEASURED_B);
    expect(removedCells).toEqual(['⚠ Exact facility distances not provided']);
    expect(markdown).toContain('Established township amenity');
    expect(markdown).toContain('Suits convenience-led occupiers');
    expect(markdown).not.toContain('not provided');
  });

  it('reaches both through the read path', () => {
    for (const doc of [MEASURED_A, MEASURED_B]) {
      expect(presentStoredMarkdown(`## At a glance\n\n${doc}\n`)).not.toMatch(/not provided/i);
    }
  });
});

describe('a finding about the property is never removed', () => {
  it.each([
    '⚠ NBN not available',
    '⚠ No off-street parking',
    '⚠ Town water not available at the lot',
    '✓ Sewer connected',
    '⚠ Bus service unavailable after 7pm',
  ])('keeps %s', (cell) => {
    const doc = `{{glance: ✓ A | ${cell} | ★ C}}`;
    const { markdown, removedCells } = stripOwnGapCells(doc);
    expect(removedCells).toEqual([]);
    expect(markdown).toBe(doc);
  });

  it('a gap phrase alone is not enough — it must name an information noun', () => {
    // "not available" about a service is a finding; about DATA it is our gap.
    expect(stripOwnGapCells('{{glance: ⚠ Gas not available}}').removedCells).toEqual([]);
    expect(stripOwnGapCells('{{glance: ⚠ Sales data not available | ✓ B}}').removedCells)
      .toEqual(['⚠ Sales data not available']);
  });
});

describe('the edges', () => {
  it('drops a strip whose every cell was a gap', () => {
    const { markdown, removedDirectives } = stripOwnGapCells(
      'Before\n\n{{glance: ⚠ Exact details not provided | ⚠ Distance figures not available}}\n\nAfter',
    );
    expect(removedDirectives).toBe(1);
    expect(markdown).not.toContain('{{glance');
    expect(markdown).toContain('Before');
    expect(markdown).toContain('After');
    expect(markdown).not.toMatch(/\n{3,}/);
  });

  it('reaches tiles and chips, which draw the same kind of cell', () => {
    expect(stripOwnGapCells('{{tiles: ✓ A | ⚠ Land dimensions not stated}}').removedCells).toHaveLength(1);
    expect(stripOwnGapCells('{{chips: ✓ A | ⚠ Rental data not provided}}').removedCells).toHaveLength(1);
  });

  it('leaves a clean document byte for byte', () => {
    const clean = '## At a glance\n\n{{glance: ✓ A | ✓ B | ★ C}}\n\nProse here.\n';
    expect(stripOwnGapCells(clean).markdown).toBe(clean);
    expect(presentStoredMarkdown(clean)).toBe(clean);
  });

  it('does not touch prose that explains an absence in a sentence', () => {
    // "prose is never regex-scrubbed" — a sentence naming its reason is a
    // statement about evidence, not a placeholder in a value slot.
    const prose = 'Authoritative postcode-level demographic information was not available for this '
      + 'analysis, so no demographic claim is made.';
    expect(stripOwnGapCells(prose).markdown).toBe(prose);
  });
});

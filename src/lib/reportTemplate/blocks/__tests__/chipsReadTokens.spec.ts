/**
 * A colourway can reach the chips, and reaches nothing until it says so.
 *
 * The chip palettes were eleven literal pairs with no token reference, so a
 * family's ten palettes restyled the whole master and left every badge inside
 * it the same six colours. They resolve `token:chip*` now, with today's value
 * as each one's fallback.
 *
 * Both halves are asserted, because only the pair is the claim: a deployment
 * that declares no `chip*` token draws **exactly** what it drew before, and
 * one that declares them gets them.
 */
import { describe, expect, it } from 'vitest';

import type { ResolveContext } from '../../bindingResolver';
import {
  CONFIDENCE_PALETTE, RATING_PALETTE, confidenceChipHtml, ratingChipHtml,
} from '../_chips.html';

const ctxWith = (colors: Record<string, string>): ResolveContext => ({
  data: {},
  tokens: { colors, fonts: {}, spacing: {} } as never,
});

/** A deployment as it stands: real tokens, none of them a chip token. */
const TODAY = ctxWith({
  primary: '#8E6C15', text: '#FAF7EF', muted: '#6E6253',
  positive: '#157A3A', caution: '#856514', negative: '#D31212', info: '#0270A7',
});

describe('chips resolve through tokens', () => {
  it('draws what it drew before where no chip token is declared', () => {
    for (const rating of Object.keys(RATING_PALETTE)) {
      expect(ratingChipHtml(rating, 8, TODAY)).toBe(ratingChipHtml(rating));
    }
    for (const conf of Object.keys(CONFIDENCE_PALETTE)) {
      expect(confidenceChipHtml(conf, 7.5, TODAY)).toBe(confidenceChipHtml(conf));
    }
  });

  it('does not silently adopt the design system\'s own status colours', () => {
    // `positive` is #157A3A and the Strong chip's ink is #065F46. They are
    // different values, so repointing would change an accepted design.
    expect(ratingChipHtml('Strong', 8, TODAY)).toContain('#065F46');
    expect(ratingChipHtml('Strong', 8, TODAY)).not.toContain('#157A3A');
  });

  it('takes a colourway\'s chip tokens where it declares them', () => {
    const branded = ctxWith({ chipStrongBg: '#102A18', chipStrongFg: '#7BD9A2' });
    const html = ratingChipHtml('Strong', 8, branded);
    expect(html).toContain('#102A18');
    expect(html).toContain('#7BD9A2');
  });

  it('gives an unrecognised value the neutral pair, overridable too', () => {
    expect(ratingChipHtml('Sideways', 8, TODAY)).toContain('#F3F4F6');
    expect(ratingChipHtml('Sideways', 8, ctxWith({ chipNeutralBg: '#222222' })))
      .toContain('#222222');
  });

  it('still draws no chip for a confidence the record does not state', () => {
    for (const nothing of ['', '  ', 'N/A', 'not available', 'unknown']) {
      expect(confidenceChipHtml(nothing, 7.5, TODAY)).toBe('');
    }
  });
});

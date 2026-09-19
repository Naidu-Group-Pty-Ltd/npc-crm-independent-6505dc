/**
 * The colour a cash-flow figure takes from its sign.
 *
 * The reported defect: every negative figure in the 10-Year Projection
 * Overview rendered WHITE. The five sign-driven rows spelled the loss colour
 * `text-destructive-foreground`, which is the ink for text on a solid
 * `bg-destructive` fill — `0 0% 100%` in the light token block and in the
 * dark one, measured in Chromium as rgb(255,255,255) in both. Meanwhile the
 * two documents this screen exports had never lost it: the PDF writes
 * negatives in #B91C1C and the HTML export in #dc2626, on exactly those rows.
 *
 * These assertions are about the rule, not about a string a refactor may move.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  NEGATIVE_FIGURE_INK,
  POSITIVE_FIGURE_INK,
  signedFigureInk,
} from '../figureInk.pure';

const root = join(__dirname, '..', '..', '..', '..');
const read = (...parts: string[]) => readFileSync(join(root, ...parts), 'utf8');

const modal = read('src', 'components', 'reports', 'CashFlowAnalysisModal.tsx');
const tokens = read('src', 'styles', 'tokens.css');

/** The `--x: h s% l%;` triples a token carries, in declaration order. */
const declarationsOf = (token: string) =>
  [...tokens.matchAll(new RegExp(`^\\s*--${token}:\\s*([^;]+);`, 'gm'))].map(m => m[1].trim());

describe('a loss is red', () => {
  it('names the semantic token and never its -foreground twin', () => {
    expect(NEGATIVE_FIGURE_INK).toBe('text-destructive');
    expect(POSITIVE_FIGURE_INK).toBe('text-success');
    for (const ink of [NEGATIVE_FIGURE_INK, POSITIVE_FIGURE_INK]) {
      expect(ink).not.toContain('-foreground');
    }
  });

  it('colours by the sign, with zero reading as positive', () => {
    expect(signedFigureInk(-13_909)).toBe(NEGATIVE_FIGURE_INK);
    expect(signedFigureInk(-0.01)).toBe(NEGATIVE_FIGURE_INK);
    expect(signedFigureInk(0)).toBe(POSITIVE_FIGURE_INK);
    expect(signedFigureInk(5_373)).toBe(POSITIVE_FIGURE_INK);
  });
});

describe('why the -foreground twin is not an option', () => {
  /**
   * This is the fact the defect turned on, so it is asserted rather than
   * trusted. If a future palette ever gives `--destructive-foreground` a red
   * of its own, this test is the place that finds out.
   */
  it('--destructive-foreground is white in EVERY theme block', () => {
    const declared = declarationsOf('destructive-foreground');
    expect(declared.length).toBeGreaterThanOrEqual(2); // :root and .dark
    for (const value of declared) {
      expect(value).toBe('0 0% 100%');
    }
  });

  it('--destructive is the one that is actually red', () => {
    for (const value of declarationsOf('destructive')) {
      expect(value).toBe('0 84% 60%');
    }
  });

  it('--success-foreground is white too, so the positive half was silent as well', () => {
    for (const value of declarationsOf('success-foreground')) {
      expect(value).toBe('0 0% 100%');
    }
  });
});

describe('the cash-flow workspace goes through it', () => {
  it('leaves no figure coloured by sign with a -foreground ink', () => {
    // A ternary on a comparison or a `positive` flag that resolves to any
    // `text-*-foreground` class: the exact shape of all nine defects.
    const signDriven =
      /(?:[<>]=?\s*0|\.positive)\s*\?[^}]*text-(?:destructive|success|info|warning)-foreground/g;
    expect(modal.match(signDriven)).toBeNull();
  });

  it('draws all five projection rows through the shared rule', () => {
    for (const field of [
      'preTaxCashFlowPA',
      'preTaxCashFlowPW',
      'netProfitLoss',
      'afterTaxCashFlowPA',
      'afterTaxCashFlowPW',
    ]) {
      expect(modal).toContain(`signedFigureInk(p.${field})`);
    }
  });

  it('keeps -foreground only where there is a solid fill under it', () => {
    // The Reset-overrides confirmation is the one legitimate use left in the
    // file: white text on `bg-destructive`. Every other occurrence was ink on
    // an ordinary ground, which is the bug.
    //
    // Comments are stripped first, because this rule is about what the file
    // APPLIES, and the rows themselves carry a note naming the token they
    // must not use.
    const code = modal.replace(/\/\*[\s\S]*?\*\//g, '');
    const occurrences = code.match(/text-(?:destructive|success|info|warning|accent)-foreground/g) ?? [];
    expect(occurrences).toHaveLength(1);
    expect(code).toContain('bg-destructive text-destructive-foreground hover:bg-destructive/90');
  });
});

describe('the screen agrees with the documents it exports', () => {
  /**
   * The exports never lost the colour, and they are what "previously this
   * used to be red" was still true of. They are pinned here so the three
   * surfaces cannot drift apart again in either direction.
   */
  it('the PDF still writes negatives in red', () => {
    expect(modal).toMatch(/const negativeRed = \{ r: 185, g: 28, b: 28 \}/);
    expect(modal).toContain('pdf.setTextColor(negativeRed.r, negativeRed.g, negativeRed.b)');
  });

  it('the HTML export still writes negatives in red', () => {
    expect(modal).toMatch(/\.text-red \{ color: #dc2626; \}/);
  });

  it('and both colour every sign-driven row the screen does', () => {
    // `drawRow(..., true)` is the PDF's highlight flag; `text-red` is the
    // HTML export's. SIX rows now: the five cash-flow rows plus Tax Refund /
    // (Payable), which became sign-driven when a rental profit started being
    // taxed — a payable is a negative and must not print green.
    const pdfRows = modal.match(/\], false, false, true\);/g) ?? [];
    expect(pdfRows).toHaveLength(6);
    const htmlRows = modal.match(/< 0 \? 'text-red' : 'text-green'/g) ?? [];
    expect(htmlRows).toHaveLength(7); // the six rows plus the 10-year summary card
  });
});

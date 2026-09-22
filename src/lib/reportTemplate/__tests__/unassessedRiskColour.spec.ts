/**
 * An absence may not be rated — on a colour either.
 *
 * `severityFromRating` returns `null` for a rating it does not recognise,
 * deliberately, under its own comment: *"so the bar is omitted rather than
 * drawn at a length that states a severity nobody assessed."* The colour
 * derived from that severity is used **twice** — for the bar, and for the
 * rating WORD's own text colour — and it returned `caution` for `null`. So the
 * bar was correctly withheld and the word was printed in the caution colour
 * anyway: `NOT ASSESSED` in the same amber as `MODERATE`.
 *
 * One function guarded the absence and the next one below it undid the guard.
 * It is `PLANNING_CONTROLS_IN_THE_REPORT.md` §9's rule committed in colour
 * rather than in a word — the same shape as `withholdRatedAbsenceCharts`.
 *
 * The chip display already had this right (`ratingChipHtml` falls back to
 * `Neutral`), so the two displays of one register disagreed.
 */
import { describe, expect, it } from 'vitest';
import type { Block } from '../types';
import type { HtmlBlockContext } from '../blocks/_shared.html';
import { renderRiskRegisterHtml, severityFromRating } from '../blocks/riskRegister.html';
import { RISK_EXPOSURE_LEVELS } from '../../../../supabase/functions/_shared/reports/investment/riskRegister.pure';
import { resolveReportPalette } from '../../reportDesign/brandResolve.pure';

/*
 * The real resolved palette, not four literals.
 *
 * It makes the assertions stronger — they are about the colours a document
 * actually carries — and it keeps the hardcoded-hex lint rule satisfied in a
 * file whose whole subject is which colour is emitted.
 */
const PALETTE = resolveReportPalette({});
const NEGATIVE = PALETTE.negative;
const CAUTION = PALETTE.caution;
const POSITIVE = PALETTE.positive;
const MUTED = PALETTE.mutedInk;

const ctx = (data: Record<string, unknown> = {}): HtmlBlockContext => ({
  data, tokens: { colors: {}, fonts: {}, spacing: {} }, page: { width: 595, height: 842 },
  pageIndex: 0, pages: [], slots: {},
} as never);

const block = (props: Record<string, unknown>): Block =>
  ({ id: 'b-risk', type: 'risk-register', props, overlays: [] } as never);

/** The bars display, one named hazard, at a given rating. */
const render = (rating: string) => renderRiskRegisterHtml(
  block({
    display: 'bars',
    title: 'Hazard \u00b7 rating \u00b7 verification',
    items: [{ risk: 'Flood exposure', rating, confidence: 'Indicative', why: '', ddAction: '' }],
    negativeColor: NEGATIVE, cautionColor: CAUTION, positiveColor: POSITIVE, mutedColor: MUTED,
  }),
  ctx({}),
);

describe('a rating the register does not recognise', () => {
  it('scores no severity, so no bar is drawn', () => {
    for (const rating of ['Noted', 'Not assessed', 'Indicative', '']) {
      expect(severityFromRating(rating), rating).toBeNull();
    }
  });

  it('prints the word in the muted ink, never the caution ink', () => {
    for (const rating of ['Noted', 'Not assessed']) {
      const html = render(rating);
      expect(html, rating).toContain(`color:${MUTED}`);
      // That caution amber is what a MODERATE risk gets. A row that assessed
      // nothing must not wear it.
      expect(html.includes(`color:${CAUTION}`), `${rating} printed in caution`).toBe(false);
    }
  });

  it('draws no bar element at all for an unassessed row', () => {
    expect(render('Not assessed')).not.toMatch(/height:4pt;background:/);
  });

  it('still prints the word, because an absence is a reading', () => {
    expect(render('Not assessed')).toContain('Not assessed');
  });
});

describe('a rating the register does recognise still colours', () => {
  it('high is negative and carries a full bar', () => {
    const html = render('High');
    expect(html).toContain(`color:${NEGATIVE}`);
    expect(html).toMatch(/width:100%;height:4pt;background:/);
  });

  it('moderate is caution and keeps its bar', () => {
    const html = render('Moderate');
    expect(html).toContain(`color:${CAUTION}`);
    expect(html).toMatch(/height:4pt;background:/);
  });

  it('low is positive', () => {
    expect(render('Low')).toContain(`color:${POSITIVE}`);
  });
});

describe('the exposure vocabulary and the renderer agree', () => {
  it('Not assessed is the only level that scores nothing, and it reads as an absence', () => {
    const unscored = RISK_EXPOSURE_LEVELS.filter((l) => severityFromRating(l) === null);
    expect(unscored).toEqual(['Not assessed']);
    expect(render('Not assessed')).toContain(`color:${MUTED}`);
  });

  it('every other level draws a bar', () => {
    for (const level of RISK_EXPOSURE_LEVELS.filter((l) => l !== 'Not assessed')) {
      expect(render(level), level).toMatch(/height:4pt;background:/);
    }
  });
});

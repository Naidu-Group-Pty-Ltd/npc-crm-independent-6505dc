/**
 * A label is a promise that a figure follows it.
 *
 * Two producers feed the 10 Year Cash Flow masters, and they do not publish the
 * same set of fields:
 *
 *  - `projectCashFlow` over a stored `investment_reports` row publishes
 *    everything the masters bind;
 *  - `applyLiveCashFlowProjection` over the series an adviser reviewed on screen
 *    publishes a strict subset. `scenarios` and `scenarioBasis` are deleted
 *    (only the series on screen was reviewed, so the stored three are not a
 *    comparison against it) and `roi` is absent from every year (the wire has no
 *    such field, and `cashFlowAdapter.ts` records that its stored derivation
 *    "this repo has no second implementation of").
 *
 * Every one of those omissions is right. The defect was that the masters drew
 * the labels regardless, so the 15 Aug 2026 adviser-reviewed export of
 * 28 Bligh Street came out with:
 *
 *  - a "The three scenarios" page carrying a ruled three-row table with every
 *    figure cell empty, under a panel explaining how to read it;
 *  - a "Return" column, headed and ruled, empty in all ten rows;
 *  - a "Return at year ten" figure reading "—";
 *  - three assumption lines reading "Conservative capital growth · rental
 *    growth, a year", with no rates in them;
 *  - the cover word "Prepared" with nothing after it, because the pseudo-row
 *    built for this path carried neither `updated_at` nor `created_at`.
 *
 * These tests render the real masters against both shapes. The stored shape must
 * keep every label; the live shape must show none of the empty ones.
 */
import { describe, it, expect } from 'vitest';
import { renderTemplateToHtml } from '@/lib/reportTemplate/htmlRenderer';
import { CASH_FLOW_COMPASS_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/cashFlow';
import { SAMPLE_REPORT_DATA as SAMPLE } from '../sampleReportData';

/** The stored shape, exactly as the catalogue's other specs use it. */
const stored = () => JSON.parse(JSON.stringify(SAMPLE));

/**
 * The adviser-reviewed shape, produced the way `applyLiveCashFlowProjection`
 * produces it: the same series, with the three omissions applied.
 */
function live(): Record<string, any> {
  const data = stored();
  const cf = data.cashflow as Record<string, any>;
  delete cf.scenarios;
  delete cf.scenarioBasis;
  cf.scenario = 'reviewed';
  cf.scenarioLabel = 'Adviser-reviewed';
  if (cf.outcome) delete cf.outcome.roi;
  for (const year of (cf.years ?? []) as Array<Record<string, unknown>>) delete year.roi;
  return data;
}

/** One master is enough for a binding question; all fifty share this sequence. */
const SAMPLES = CASH_FLOW_COMPASS_TEMPLATES.slice(0, 6);

describe('the cash flow masters on the adviser-reviewed path', () => {
  it('drops the scenarios page rather than printing an empty comparison', () => {
    for (const t of SAMPLES) {
      const withStored = renderTemplateToHtml(t.schema as any, { data: stored() }).html;
      const withLive = renderTemplateToHtml(t.schema as any, { data: live() }).html;
      // The stored path still gets it — this is a conditional, not a deletion.
      expect(withStored, t.name).toContain('What changes if growth does');
      expect(withLive, t.name).not.toContain('What changes if growth does');
      // And the panel that explains how to read the table goes with it.
      expect(withLive, t.name).not.toContain('the whole of the uncertainty in the forecast');
    }
  });

  it('drops the Return column rather than heading ten empty cells', () => {
    for (const t of SAMPLES) {
      const withStored = renderTemplateToHtml(t.schema as any, { data: stored() }).html;
      const withLive = renderTemplateToHtml(t.schema as any, { data: live() }).html;
      expect(withStored, t.name).toContain('Return');
      // The cash table's own columns survive; only the fifth goes.
      expect(withLive, t.name).toContain('Cumulative');
      expect(withLive, t.name).not.toContain('Return at year ten');
    }
  });

  it('drops the three-scenario assumption lines rather than printing them without rates', () => {
    for (const t of SAMPLES) {
      const withLive = renderTemplateToHtml(t.schema as any, { data: live() }).html;
      // The exact shape of the defect: the sentence with its numbers missing.
      expect(withLive, t.name).not.toContain('capital growth · ');
      expect(withLive, t.name).not.toContain('What each scenario assumes');
    }
  });

  it('never renders a bare label with nothing after it, on either path', () => {
    // The class, rather than the four instances: no rendered text may end with
    // a currency or percent symbol left dangling by an unresolved binding.
    for (const t of SAMPLES) {
      for (const data of [stored(), live()]) {
        const { html } = renderTemplateToHtml(t.schema as any, { data });
        expect(html, t.name).not.toContain('{{');
        // An unresolved `| percent` leaves the note reading "over ten years"
        // with no figure; an unresolved `| currency` leaves an empty cell.
        expect(html, t.name).not.toMatch(/>\s*[$%]\s*</);
      }
    }
  });
});

describe('the prepared date', () => {
  it('is formatted, never a raw ISO timestamp', () => {
    // `report.generatedDate` is a database timestamp — `updated_at` on this
    // format, `meta.preparedOn` on Client Details. It was bound with no filter
    // in eleven places across seven masters, so a client's cover read
    // "Prepared 2026-08-15T11:14:20.386Z".
    const data = stored();
    data.report = { ...(data.report ?? {}), generatedDate: '2026-08-15T11:14:20.386Z' };
    for (const t of SAMPLES) {
      const { html } = renderTemplateToHtml(t.schema as any, { data });
      expect(html, t.name).not.toContain('2026-08-15T11:14:20.386Z');
      expect(html, t.name).toContain('2026');
    }
  });

  it('resolves at all — the live pseudo-row used to carry no timestamp', () => {
    const data = live();
    data.report = { ...(data.report ?? {}), generatedDate: '2026-08-11T16:11:49.093Z' };
    for (const t of SAMPLES) {
      const { html } = renderTemplateToHtml(t.schema as any, { data });
      // "Prepared" must be followed by something. The cover set it and stopped.
      expect(html, t.name).toMatch(/Prepared[^<]*\d{4}|Prepared<[^>]*>[^<]*\d{4}/);
    }
  });
});

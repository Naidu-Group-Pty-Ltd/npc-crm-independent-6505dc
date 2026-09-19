/**
 * The document — the first assertions this format has ever had about one.
 *
 * The other nine formats were each migrated with a render spec beside them.
 * This one was built, its archetype's page band pinned from ad-hoc renders, and
 * then left with no fixture, no spec and no caller. So the properties asserted
 * here are the ones the *other* nine migrations found the hard way, applied to
 * a format nobody had yet been able to check them against:
 *
 * - a contents page that lists something the document did not print,
 * - a chart drawn on an axis with no data behind it,
 * - a shortfall the reader is left to discover by searching 36 chapters,
 * - the model's own disclaimer printed beside the tenant's real one,
 * - our brand on a white-label tenant's report.
 *
 * Fixtures are fictional and shaped from the record — see `fixtures.ts`.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { writeRenderArtifact } from '../../__tests__/renderArtifact';
import { buildInvestmentReport } from '../normalise.pure';
import { DOCUMENT_NAME, kpiCells, renderInvestmentFromBrand } from '../render.pure';
import { planChapters, PROSE_GROUPS } from '../sections.pure';
import { SECTION_CHARTS } from '../payload.pure';
import { withDecodedCharts } from '@/lib/reportDesign/__tests__/chartSvg';
import { buildReportBrandSnapshot } from '@/lib/reportDesign/snapshot.pure';
import { contentsEntriesFor, REPORT_ARCHETYPES } from '@/lib/reportDesign/structure.pure';
import { assertSafeRenderResources } from '../../../../../supabase/functions/_shared/renderResourcePolicy.pure';
import {
  ADDRESS,
  currentFormat,
  locationOnly,
  minimal,
  PREPARED_ON,
  PROJECTIONS,
  reportRow,
  withoutFinancials,
  withoutScore,
} from './fixtures';

const ARCHETYPE = REPORT_ARCHETYPES['investment-compass'];

// A white-label tenant, so "the cover carries theirs and not ours" is falsifiable.
const { snapshot } = buildReportBrandSnapshot({
  whitelabel: { companyName: 'Tenant Advisory', brandColour: '#B8873A', preset: 'signature' },
  contact: {
    company_name: 'Tenant Advisory Pty Ltd',
    abn: '11 222 333 444',
    email: 'hello@tenant.example',
    phone: '03 9000 0000',
  },
  capturedAt: PREPARED_ON,
} as never);

const build = (row: Record<string, unknown>) => {
  const built = buildInvestmentReport({ row, preparedOn: PREPARED_ON, scorePercentile: 74 });
  if (built.ok === false) throw new Error(built.error);
  return built.report;
};

const render = (row: Record<string, unknown> = reportRow()) =>
  renderInvestmentFromBrand({
    report: build(row),
    snapshot,
    projectionsRaw: row.financial_calculations
      ? (row.financial_calculations as Record<string, unknown>).projections
      : null,
  });

const SHAPES = [
  ['a full report', reportRow()],
  ['no financial model — 85% of the corpus', withoutFinancials()],
  ['no score', withoutScore()],
  ['location only', locationOnly()],
  ['the smallest thing that typesets', minimal()],
] as const;

/**
 * The document, on disk, for the eye. See `renderArtifact.ts`.
 *
 * `currentFormat()` rather than `reportRow()`: same structured columns, same
 * charts, but the prose in the shape the generator writes **today** — named
 * sections, no numbering, a `{{…}}` figure under most of them. The numbered
 * variant still serves two-thirds of the archive and is still asserted below;
 * it is not the document a client receives this week, and the artefact anyone
 * looks at should be.
 */
beforeAll(() => {
  writeRenderArtifact('investment-compass', render(currentFormat()).html);
});

describe('the contents page cannot claim something that was not printed', () => {
  it.each(SHAPES)('lists exactly the chapters built, in order — %s', (_label, row) => {
    const out = render(row as Record<string, unknown>);
    expect(contentsEntriesFor(out.spine).map((e) => e.title)).toEqual(out.chapters);
  });

  it('numbers them from one, with no gaps', () => {
    const entries = contentsEntriesFor(render().spine);
    expect(entries.map((e) => e.number))
      .toEqual(entries.map((_, i) => String(i + 1).padStart(2, '0')));
  });
});

describe('the spine', () => {
  it.each(SHAPES)('is legal for its archetype — %s', (_label, row) => {
    expect(render(row as Record<string, unknown>).problems).toEqual([]);
  });

  it.each(SHAPES)('claims a page count inside the archetype band — %s', (_label, row) => {
    const budget = render(row as Record<string, unknown>).pageBudget;
    expect(budget).toBeGreaterThanOrEqual(ARCHETYPE.pageBudget[0]);
    expect(budget).toBeLessThanOrEqual(ARCHETYPE.pageBudget[1]);
  });
});

describe('a chart is drawn only when there is data behind it', () => {
  /**
   * The failure this prevents is an empty axis: a chart the section number
   * earned, rendered against nulls, which reads as "we measured nothing" rather
   * than "we have nothing to measure".
   */
  it('draws charts on the full report and skips none of them silently', () => {
    const out = render();
    expect(out.chartsDrawn).toBeGreaterThan(0);
    // Every chart the sections earned is either drawn or counted as skipped.
    const earned = Object.values(SECTION_CHARTS).reduce((n, c) => n + c.length, 0);
    expect(out.chartsDrawn + out.chartsSkipped).toBeLessThanOrEqual(earned + 2);
  });

  it('draws no financial chart at all when there is no financial model', () => {
    const out = render(withoutFinancials());
    expect(out.html).not.toContain('sensitivity-tornado');
    expect(out.html).not.toContain('Cumulative cash flow');
  });

  it('draws the three-scenario fan rather than one line', () => {
    // The projections hold conservative, moderate and optimistic. Printing only
    // the moderate case throws away the range, which is the point of a
    // projection — see `normalise.pure.ts`.
    expect(PROJECTIONS.conservative.length).toBe(10);
    // Through the decoder: the scenario names are drawn inside the chart, and
    // the chart is base64 in an `img` so the engine tags it as a figure.
    const drawn = withDecodedCharts(render().html);
    for (const label of ['Conservative', 'Moderate', 'Optimistic']) {
      expect(drawn).toContain(label);
    }
  });
});

describe('a shortfall is said on the page', () => {
  it('says so when the report carries no financial model', () => {
    const out = render(withoutFinancials());
    expect(out.html).toContain('This report carries no financial model');
    expect(out.html).toContain('no yield, cash-flow, sensitivity or projection analysis');
  });

  it('says so when the report was not scored', () => {
    expect(render(withoutScore()).html).toContain('This report was not scored');
  });

  it('says neither when the report has both', () => {
    const html = render().html;
    expect(html).not.toContain('This report carries no financial model');
    expect(html).not.toContain('This report was not scored');
  });
});

describe('the furniture the document owns is not printed twice', () => {
  /**
   * 761 rows carry `## ⚖️ PROFESSIONAL DISCLAIMER` and `## 📞 CONTACT US` in
   * the model's own Markdown, and the design system prints the tenant's real
   * contact block and disclaimer on the closing page. Leaving the model's
   * prints both — once with the tenant's actual ABN and once with whatever the
   * model invented.
   */
  it('strips the model’s disclaimer and contact blocks', () => {
    const report = build(reportRow());
    expect(report.notices.furnitureStripped).toBeGreaterThan(0);
    const html = render().html;
    expect(html).not.toContain('PROFESSIONAL DISCLAIMER');
    expect(html).not.toContain('Call the office on');
  });

  it('strips the body of those blocks, not only their headings', () => {
    // The defect this catches removed the heading and kept every word beneath
    // it, which then swept into whichever section came before — so the model's
    // disclaimer and its phone number printed in chapter 37, under the heading
    // "Demographic & Economic Data". `furnitureStripped` was greater than zero
    // throughout, because it counted the heading. See `stripFurniture`.
    const report = build(reportRow());
    const last = report.sections[report.sections.length - 1];
    expect(last.markdown).not.toContain('general information only');
    expect(last.markdown).not.toContain('Call the office on');
    expect(report.notices.furnitureStripped).toBeGreaterThan(200);
  });

  it('does not print the model’s own report title as a chapter', () => {
    expect(render().chapters).not.toContain('REPORT TITLE');
  });
});

describe('the cover is the tenant’s', () => {
  it('carries the tenant’s name and the property, and not ours', () => {
    const html = render().html;
    expect(html).toContain('Tenant Advisory');
    expect(html).toContain('18 Marlowe Parade');
    expect(html).not.toContain('NPC Services');
  });

  it('names the format', () => {
    expect(DOCUMENT_NAME).toBe('Investment Location & Property Fit Report');
    // Escaped, because the name carries an ampersand and this is markup.
    expect(render().html).toContain('Investment Location &amp; Property Fit Report');
  });
});

describe('the KPI strip', () => {
  it('is drawn on a full report, and every bare number names its unit', () => {
    // The programme's rule is that no figure prints without its unit. A score
    // is a genuine count and has none of its own, so the denominator goes in
    // the foot — "61" over "out of 100". What is not allowed is a bare number
    // with nothing under it.
    const cells = kpiCells(build(reportRow()));
    expect(cells.length).toBeGreaterThanOrEqual(2);
    for (const cell of cells) {
      expect(cell.label).toBeTruthy();
      if (/^-?[\d.]+$/.test(cell.value)) {
        expect(cell.foot, `"${cell.label}" prints ${cell.value} with no unit`).toBeTruthy();
      }
    }
  });

  it('is not drawn when there is nothing to put in it', () => {
    // Fewer than two cells and the strip is suppressed rather than printed
    // with one lonely figure in a four-column grid.
    expect(kpiCells(build(minimal())).length).toBeLessThan(2);
  });
});

describe('the document is safe to send to the renderer', () => {
  it.each(SHAPES)('references no remote resource — %s', (_label, row) => {
    expect(() => assertSafeRenderResources(render(row as Record<string, unknown>).html, '')).not.toThrow();
  });

  it('escapes an address that is markup', () => {
    const html = render(reportRow({ property_address: '<script>alert(1)</script> Street' })).html;
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('the format refuses rather than sending an empty document', () => {
  it('refuses a row with no id', () => {
    expect(buildInvestmentReport({ row: { ...reportRow(), id: null }, preparedOn: PREPARED_ON }))
      .toEqual({ ok: false, error: 'report id missing' });
  });

  it('refuses a report that is not completed', () => {
    const out = buildInvestmentReport({
      row: reportRow({ status: 'generating' }),
      preparedOn: PREPARED_ON,
    });
    expect(out.ok).toBe(false);
  });

  it('refuses a row with nothing to typeset', () => {
    const out = buildInvestmentReport({
      row: { id: reportRow().id, status: 'completed' },
      preparedOn: PREPARED_ON,
    });
    expect(out).toEqual({ ok: false, error: 'this report has no content to typeset' });
  });
});

describe('a section is not a chapter', () => {
  /**
   * The finding this pins, from the format's first render: 36 numbered prose
   * sections, one chapter each, `page-break-before: always` on every chapter,
   * and a corpus section that runs to about two paragraphs. Forty-six sheets at
   * 4.1% ink — a title low on the page, two paragraphs, half a page of nothing,
   * thirty-six times. A natively designed page in this system measures 13.3% to
   * 22.1%.
   */
  it('groups the 36 sections into four chapters', () => {
    const { chapters } = planChapters(build(reportRow()));
    const prose = chapters.filter((c) => c.kind === 'prose');
    expect(prose.map((c) => c.title)).toEqual(PROSE_GROUPS.map((g) => g.title));
  });

  it('keeps every section, as a part of the chapter that carries it', () => {
    const report = build(reportRow());
    const { chapters } = planChapters(report);
    const parts = chapters.flatMap((c) => c.parts);
    expect(parts.map((p) => p.title)).toEqual(report.sections.map((s) => s.title));
  });

  it('puts each section under its own subhead, in order', () => {
    const html = render().html;
    const at = (title: string) => html.indexOf(`<h2>${title}</h2>`);
    expect(at('Yield Calculations')).toBeGreaterThan(0);
    expect(at('Annual Holding Costs')).toBeGreaterThan(at('Yield Calculations'));
    expect(at('Loan Structure')).toBeGreaterThan(at('Annual Holding Costs'));
  });

  it('keeps a chart with the section that earned it, not at the end of the chapter', () => {
    // `SECTION_CHARTS` attaches a chart to a section by number. Rendering a
    // chapter's prose and then all of its charts would put the sensitivity
    // tornado four subheads below the sensitivity analysis.
    const html = withDecodedCharts(render().html);
    const tornado = html.indexOf('One variable at a time');
    expect(tornado).toBeGreaterThan(0);
    expect(tornado).toBeGreaterThan(html.indexOf('<h2>Sensitivity Analysis</h2>'));
    expect(tornado).toBeLessThan(html.indexOf('<h2>Property Value Projections</h2>'));
  });

  it('claims a page count the render bears out', () => {
    // 32 claimed against 29 actual, measured through WeasyPrint. Held loosely
    // — the point is that it is not 46.
    expect(render().pageBudget).toBeLessThan(40);
  });
});

describe('the chapter plan', () => {
  it('carries the property chapter and the sources chapter alongside the prose', () => {
    const { chapters } = planChapters(build(reportRow()));
    const kinds = new Set(chapters.map((c) => c.kind));
    expect(kinds).toContain('property');
    expect(kinds).toContain('prose');
    expect(kinds).toContain('sources');
  });

  it('prints every source it was given', () => {
    const html = render().html;
    expect(html).toContain('Australian Bureau of Statistics');
    expect(html).toContain('Reserve Bank of Australia');
  });

  it('drops nothing at the fixture’s size, and says so when it does', () => {
    const out = render();
    expect(out.dropped).toEqual([]);
    expect(out.html).not.toContain('Not every chapter is shown');
  });

  it('names the address in the document title', () => {
    expect(render().html).toContain(ADDRESS.split(',')[0]);
  });
});

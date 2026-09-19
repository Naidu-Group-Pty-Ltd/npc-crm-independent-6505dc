/**
 * Pins for the coverage-and-cascade pass measured on a real 15-page
 * Property Comparison (three properties, NSW, 2026-09-04) and the exit
 * inventory taken the same day — §18 of the reporting-engine audit:
 *
 *  1. running-head part numbers were baked at compose time, so pages a
 *     conditional dropped left holes in the numbering (Part 12 → Part 19);
 *  2. fixed-slot definition rows and table rows drew as empty ruled stripes
 *     under their labels when the record did not hold the slot;
 *  3. two whole pages rendered as furniture over nothing (an axis-group page
 *     with no rows, an investor-fit page with no matches);
 *  4. the verdict's "why there is no recommendation here" callout had a body
 *     only for salvaged rows — a structured row without a pick drew the
 *     heading over nothing;
 *  5. three Investment exits (the library viewer, the listings modal, the
 *     client-property sheet) offered no way to see or change the template
 *     the download comes out in.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderTemplateToHtml } from '../../reportTemplate/htmlRenderer';
import { FILTERS } from '../../reportTemplate/bindingResolver';
import { renderDefinitionListHtml } from '../../reportTemplate/blocks/extras.html';
import { applyComparisonProjection } from '../../../../supabase/functions/_shared/comparisonProjection.pure';

const REPO = resolve(__dirname, '../../../..');
const read = (p: string) => readFileSync(resolve(REPO, p), 'utf8');
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const page = (id: string, text: string, conditional?: string) => ({
  id,
  name: id,
  ...(conditional ? { conditional } : {}),
  blocks: [{
    id: `${id}-b`, type: 'text-block', x: 10, y: 10, width: 100, height: 20,
    props: { body: text },
  }],
});

const TEMPLATE = {
  id: 'part-check', name: 'part-check', version: 1,
  tokens: { colors: {}, fonts: {}, spacing: {} },
  pages: [
    page('cover', 'no parts here'),
    page('one', 'Part {{partNumber | pad2}} of {{partCount}}'),
    page('dropped', 'Part {{partNumber | pad2}}', 'missing && missing.key'),
    page('two', 'Part {{partNumber | pad2}}'),
  ],
};

describe('part numbers are counted over the pages that render', () => {
  it('a dropped conditional page leaves no hole', () => {
    const { html } = renderTemplateToHtml(TEMPLATE as never, { data: {} });
    expect(html).toContain('Part 01 of 2');
    expect(html).toContain('Part 02');
    expect(html).not.toContain('Part 03');
    expect(html).not.toContain('{{partNumber');
  });

  it('pad2 is a filter, so the furniture reads "Part 07" not "Part 7"', () => {
    expect(FILTERS.pad2(7)).toBe('07');
    expect(FILTERS.pad2(12)).toBe('12');
  });
});

describe('a definition item may carry a `when`, like a table row', () => {
  const block = {
    id: 'd', type: 'definition-list', x: 0, y: 0, width: 100, height: 40,
    props: {
      title: 'Basis',
      items: [
        { term: 'Time horizon', definition: '{{basis.timeHorizon}}', when: 'basis && basis.timeHorizon' },
        { term: 'Analysis depth', definition: '{{basis.depth}}', when: 'basis && basis.depth' },
      ],
    },
  };
  const ctx = (data: Record<string, unknown>) =>
    ({ data, tokens: { colors: {}, fonts: {}, spacing: {} }, page: { width: 595, height: 842 } });

  it('an absent fact loses its row rather than printing a labelled stripe', () => {
    const html = renderDefinitionListHtml(block as never, ctx({ basis: { timeHorizon: '5-7 years' } }) as never);
    expect(html).toContain('Time horizon');
    expect(html).not.toContain('Analysis depth');
  });

  it('a list whose every item is absent draws nothing at all', () => {
    expect(renderDefinitionListHtml(block as never, ctx({}) as never)).toBe('');
  });
});

describe('the verdict callout always has a body when it draws', () => {
  it('a structured, complete row without a pick gets the explanation', () => {
    const data = applyComparisonProjection({}, {
      row: {
        executive_summary: 'A complete analysis naming a winner only in prose.',
        rankings: [
          { propertyNumber: 1, rank: 1, finalScore: 62, address: '28 Bligh Street, Muswellbrook NSW 2333' },
          { propertyNumber: 2, rank: 2, finalScore: 56, address: '93 Bimbadeen Avenue, Banora Point NSW 2486' },
        ],
        financial_comparison: { bestYield: { propertyNumber: 1, reason: 'Highest yield.', value: '5.45%' } },
        recommendations: null,
        analysis_summary: JSON.stringify({ timeHorizon: '5-7 years' }),
      },
      now: '2026-09-04T00:00:00Z',
    });
    const comparison = data.comparison as Record<string, unknown>;
    expect(comparison.recommendations).toBeUndefined();
    expect(String(comparison.truncationNote)).toContain('records no single "best overall" pick');
  });
});

describe('the comparison composer keeps its promises', () => {
  const composer = code('scripts/template-library/investmentCompass/comparison.ts');

  it('no heading hardcodes a count over a data-dependent table', () => {
    expect(composer).not.toContain('Eleven axes');
  });

  it('scorecard and basis rows are conditional on the record holding them', () => {
    expect(composer).toContain('const scorecardRow = (group: string, i: number) => ({');
    expect(composer).toMatch(/when: `comparison && comparison\.axes && comparison\.axes\.\$\{group\}`/);
    expect(composer).toContain("when: 'comparison && comparison.basis && comparison.basis.depth'");
  });

  it('data-dependent pages are conditional, so no page is furniture over nothing', () => {
    // The axis-reason pages and the first investor-fit page — the two that
    // shipped empty on the real render.
    expect(composer).toMatch(/conditional: Array\.from\(\{ length: count \}/);
    expect(composer).toContain("conditional: 'comparison && comparison.matches && comparison.matches[0]'");
  });

  it('part furniture resolves at render time in every composer that numbers parts', () => {
    for (const f of ['comparison', 'borrowingCapacity', 'cashFlow', 'portfolio', 'clientDetails', 'cashFlowComparison']) {
      const s = code(`scripts/template-library/investmentCompass/${f}.ts`);
      expect(s, f).toContain('renderTimePart');
      expect(s, f).not.toContain('partNo += 1');
    }
  });
});

describe('every Investment exit says which template the download comes out in', () => {
  it.each([
    'src/components/reports/InvestmentReportViewer.tsx',
    'src/components/listings/InvestmentReportModal.tsx',
    'src/components/clients/ClientPropertyInvestmentReport.tsx',
  ])('%s mounts the selector', (p) => {
    const s = code(p);
    expect(s).toContain('ReportTemplateSelector');
    expect(s).toContain('INVESTMENT_REPORT_FORMAT.reportType');
  });
});

describe('the v11 seed and its active-row refresh ship together', () => {
  it('both migrations exist and the refresh keeps the row palette', () => {
    expect(read('supabase/migrations/20260918090000_seed_template_library_v11_render_parts_conditional_rows.sql').length)
      .toBeGreaterThan(1_000_000);
    const refresh = read('supabase/migrations/20260918100000_refresh_active_masters_from_library_v11.sql');
    expect(refresh).toContain("coalesce(t.schema -> 'tokens' -> 'colors'");
    expect(refresh).not.toMatch(/\bdelete\b/i);
  });
});

/**
 * The report the generator writes today, as opposed to the one it used to.
 *
 * Everything pinned here was measured against `investment_reports` rather than
 * inferred, and every one of these was silently wrong on every current report:
 *
 * | fact | before | corpus |
 * | --- | --- | --- |
 * | numbered headings on a current report | assumed | **0 of 35** |
 * | chapters a current report produced | **1**, plus three empty | 16 sections |
 * | score dimensions read | 0 of 5 | 985 rows, all objects |
 * | land / building size on the spec table | never printed | 110 rows, other column |
 * | citations counted | headings included | 3 furniture lines per report |
 */
import { describe, expect, it } from 'vitest';
import {
  attachChartsByTitle,
  buildInvestmentReport,
  toSources,
  toSpecs,
} from '../normalise.pure';
import { planChapters } from '../sections.pure';
import { scoreBreakdownTable } from '../charts.pure';
import {
  CURRENT_SECTION_TITLES,
  PREPARED_ON,
  SOURCE_COUNT,
  currentFormat,
  reportRow,
  sourcesContent,
} from './fixtures';

const normalise = (row: Record<string, unknown>) => {
  const result = buildInvestmentReport({ row, preparedOn: PREPARED_ON });
  if (result.ok === false) throw new Error(result.error);
  return result.report;
};

describe('a report with no numbered headings', () => {
  const report = normalise(currentFormat());

  it('reads every named section, and numbers none of them', () => {
    expect(report.sections.length).toBe(CURRENT_SECTION_TITLES.length);
    expect(report.sections.every((s) => s.number === null)).toBe(true);
    expect(report.sections.map((s) => s.title)).toEqual([...CURRENT_SECTION_TITLES]);
  });

  it('gives each section a chapter instead of folding all of them into one', () => {
    // The defect: `PROSE_GROUPS` advances on a section *number*, so with none
    // the group index never moved and all sixteen sections landed in "Location
    // & Market" — one chapter, three empty ones, and a contents page that named
    // none of the model's own sections.
    const { chapters } = planChapters(report);
    const prose = chapters.filter((c) => c.kind === 'prose');
    expect(prose).toHaveLength(CURRENT_SECTION_TITLES.length);
    expect(prose.map((c) => c.title)).toEqual([...CURRENT_SECTION_TITLES]);
  });

  it('keeps the model’s own order', () => {
    const { chapters } = planChapters(report);
    const titles = chapters.filter((c) => c.kind === 'prose').map((c) => c.title);
    expect(titles.indexOf('Executive Verdict')).toBeLessThan(titles.indexOf('Risk Dashboard'));
    expect(titles.indexOf('Risk Dashboard')).toBeLessThan(titles.indexOf('Final Recommendation'));
  });

  it('still folds a numbered report into its four groups', () => {
    const { chapters } = planChapters(normalise(reportRow()));
    expect(chapters.filter((c) => c.kind === 'prose').map((c) => c.title))
      .toEqual(['Location & Market', 'The Numbers', 'The Score', 'Risk, Tax & Next Steps']);
  });
});

describe('the named infographics find their section without a number', () => {
  it('attaches by title, each chart at most once', () => {
    const sections = attachChartsByTitle(
      ['Executive Verdict', 'Population & Housing Demand', 'Population Growth Detail']
        .map((title) => ({ number: null, title, markdown: 'x', charts: [] })),
    );
    expect(sections[0].charts).toEqual(['score-gauge']);
    expect(sections[1].charts).toEqual(['demographics-bars']);
    // The second population section does not get a second copy of the same bars.
    expect(sections[2].charts).toEqual([]);
  });

  it('leaves a numbered report’s chart mapping alone', () => {
    const sections = attachChartsByTitle([
      { number: 1, title: 'Location Overview', charts: ['locality-map'], markdown: 'x' },
      { number: 6, title: 'Executive Verdict', charts: [], markdown: 'x' },
    ]);
    // A stated number beats a guessed title; nothing is added.
    expect(sections[1].charts).toEqual([]);
  });

  it('puts real charts on a current report', () => {
    const report = normalise(currentFormat());
    const attached = report.sections.flatMap((s) => s.charts);
    expect(attached.length).toBeGreaterThanOrEqual(4);
    expect(new Set(attached).size).toBe(attached.length);
  });

  it('finds the v3.0 merged sections, which no pattern named before', () => {
    // `Demand Drivers` absorbed Population & Housing Demand, Tenant & Buyer
    // Profile and Employment & Economic Linkages; `Amenity & Access` absorbed
    // education, retail/healthcare/lifestyle and transport. The charts here are
    // drawn from structured jsonb columns and appear nowhere else in the
    // document, so a title that stops matching loses the data silently — the
    // module's own comment says a missed chart is invisible by design.
    const sections = attachChartsByTitle(
      ['Demand Drivers', 'Amenity & Access'].map((title) => ({
        number: null, title, markdown: 'x', charts: [],
      })),
    );
    expect(sections[0].charts).toContain('demographics-bars');
    expect(sections[0].charts).toContain('economic-bullets');
    expect(sections[1].charts).toContain('amenity-bullets');
  });

  it('caps a merged section at two charts', () => {
    // Demand Drivers matches three sections' worth of patterns. Without a cap a
    // page would carry the model's two figures plus three of ours, which is the
    // page-economy problem this release exists to fix, pointing the other way.
    const [demand] = attachChartsByTitle([
      { number: null, title: 'Demand Drivers', markdown: 'x', charts: [] },
    ]);
    expect(demand.charts.length).toBeLessThanOrEqual(2);
  });

  it('still claims each chart at most once across the document', () => {
    const sections = attachChartsByTitle(
      ['Demand Drivers', 'Amenity & Access', 'Population Growth Detail']
        .map((title) => ({ number: null, title, markdown: 'x', charts: [] })),
    );
    const all = sections.flatMap((s) => s.charts);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('the score breakdown', () => {
  const report = normalise(reportRow());

  it('reads a dimension written as an object, which is all of them', () => {
    expect(report.score?.breakdown.map((b) => b.value)).toEqual([68, 57, 62, 71, 49]);
    expect(report.score?.breakdown.map((b) => b.weight)).toEqual([30, 25, 20, 15, 10]);
    expect(report.score?.breakdown[0].details).toContain('Rail within 900m');
  });

  it('treats an excluded dimension as unscored, not as a zero', () => {
    const row = reportRow({
      investment_score: {
        totalScore: 55,
        breakdown: {
          locationScore: { score: 60, weight: 40, hasData: true, excluded: false, details: 'a' },
          yieldScore: { score: 0, weight: 0, hasData: false, excluded: true, details: '' },
          growthScore: { score: 50, weight: 30, hasData: true, excluded: false, details: 'c' },
          demandScore: { score: 58, weight: 30, hasData: true, excluded: false, details: 'd' },
          riskScore: { score: 44, weight: 0, hasData: true, excluded: false, details: 'e' },
        },
      },
    });
    const score = normalise(row).score!;
    const yieldDim = score.breakdown.find((b) => b.key === 'yieldScore')!;
    expect(yieldDim.value).toBeNull();
    expect(yieldDim.excluded).toBe(true);
  });

  it('prints the weights and the engine’s reasons as a table', () => {
    const html = scoreBreakdownTable(report.score!);
    expect(html).toContain('How the composite was built');
    expect(html).toContain('Rail within 900m');
    expect(html).toContain('Weight');
  });

  it('says "not scored" rather than leaving a blank cell', () => {
    const score = {
      ...report.score!,
      breakdown: report.score!.breakdown.map((b, i) =>
        (i === 1 ? { ...b, value: null, excluded: true, details: '' } : b)),
    };
    expect(scoreBreakdownTable(score)).toContain('Not scored');
  });
});

describe('the property specification comes from two columns', () => {
  it('takes land and building size from the finance run when the spec column is null', () => {
    const specs = normalise(reportRow()).specs;
    expect(specs.landSqm).toBe(612);
    expect(specs.buildingSqm).toBe(198);
    // And `carSpaces`, which is what that column calls parking.
    expect(specs.parking).toBe(2);
  });

  it('prefers the spec column wherever it has a value', () => {
    expect(toSpecs(
      { land_size_sqm: 500, bedrooms: 3 },
      { landSizeSqm: 999, bedrooms: 9 },
    )).toMatchObject({ landSqm: 500, bedrooms: 3 });
  });

  it('reads buildSizeSqm, which is the name the column actually uses', () => {
    // Not `building_size_sqm`, not `buildingSizeSqm` — both were already
    // accepted and neither exists on any row.
    expect(toSpecs({}, { buildSizeSqm: 143 }).buildingSqm).toBe(143);
  });
});

describe('the sources chapter counts sources', () => {
  it('does not count the column’s own headings', () => {
    const sources = toSources(sourcesContent);
    expect(sources).toHaveLength(SOURCE_COUNT);
    expect(sources.some((s) => /SOURCES & REFERENCES|Citations|Additional Sources/.test(s)))
      .toBe(false);
  });

  it('keeps a citation that merely starts with a hash inside the line', () => {
    expect(toSources('ABS Census 2021 — table #3 of the release')).toHaveLength(1);
  });
});

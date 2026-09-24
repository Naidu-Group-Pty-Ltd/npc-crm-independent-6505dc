import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { dropEmptySections, presentStoredMarkdown, stripPlaceholderRows } from '../derivedHygiene.pure';
import { projectRowForPdf } from '../investmentPdfSource';
import { readScoreComponents } from '../investmentPdfFigures';
import { confidenceChipHtml, UNSTATED_CONFIDENCE } from '@/lib/reportTemplate/blocks/_chips.html';

/**
 * RS-5a — "N/A or unavailable never should be included in reports" (the
 * owner, 14 Sep 2026).
 *
 * Measured on production the same day: every Executive Briefing produced in
 * the preceding 120 days (seven rows) carries 36 to 97 "N/A" cells, the newest
 * Snapshot 19, and 268 of 1,122 Compass reports hold a table row whose first
 * value cell is a placeholder — all stored before the write-path scrub, all
 * rendered verbatim by every reader, because `stripPlaceholderRows` ran on the
 * write path alone. These tests pin the four rules that close it:
 *
 *  1. the placeholder scrub is applied where stored content is READ, by one
 *     implementation every reader imports;
 *  2. a clean document is returned byte-identical;
 *  3. a chip, a chart point and a prompt line never carry a placeholder either;
 *  4. no generator prompt instructs the model to write one.
 */

const ROOT = resolve(__dirname, '../../../../..');
const src = (rel: string): string => readFileSync(resolve(ROOT, rel), 'utf8');

/** Verbatim from the production Snapshot of 4 Sep 2026 (row 8c6edc56). */
const PRODUCTION_SNAPSHOT_EXCERPT = `## Key Market Stats
| Metric | Value |
|---|---|
| Median Price | N/A |
| Rental Yield | N/A |
| Vacancy Rate | N/A |
| Capital Growth | N/A |
| Days on Market | N/A |
| Walk Score | N/A |

## Investment Score
- Grade: N/A
- Score: N/A/100
- Recommendation: PROCEED WITH CAUTION

## Financial Snapshot
| Metric | Value |
|---|---|
| Purchase Price | N/A |
| Weekly Rent | $450 |
| Gross Yield | N/A |

## Top 3 Risks
- **Data Gaps:** The listing did not confirm the car space, so N/A is how the agent recorded it.
`;

describe('the placeholder scrub is applied where stored content is read', () => {
  it('removes the placeholder tables, rows and lines a stored derived report carries', () => {
    const out = presentStoredMarkdown(PRODUCTION_SNAPSHOT_EXCERPT);
    expect(out).not.toContain('| N/A |');
    expect(out).not.toContain('Key Market Stats\n| Metric'); // the whole table went
    expect(out).not.toContain('- Grade: N/A');
    expect(out).not.toContain('- Score: N/A/100');
    // What was known survives, in place.
    expect(out).toContain('- Recommendation: PROCEED WITH CAUTION');
    expect(out).toContain('| Weekly Rent | $450 |');
    // Prose is the author's and is not scanned — the scrub's own contract.
    expect(out).toContain('so N/A is how the agent recorded it');
  });

  it('returns a clean document byte-identical, so nothing else changes', () => {
    const clean = 'Intro.\n\n\n\n| Metric | Value |\n|---|---|\n| Weekly Rent | $450 |\n\n- Grade: B\n';
    expect(presentStoredMarkdown(clean)).toBe(clean);
    expect(presentStoredMarkdown('')).toBe('');
    expect(presentStoredMarkdown(null)).toBe('');
    expect(presentStoredMarkdown(undefined)).toBe('');
  });

  it('is the write-path rule, not a second one', () => {
    const out = presentStoredMarkdown(PRODUCTION_SNAPSHOT_EXCERPT);
    expect(out).toBe(dropEmptySections(stripPlaceholderRows(PRODUCTION_SNAPSHOT_EXCERPT).markdown).markdown);
  });

  it('takes the heading a scrubbed table leaves standing over nothing', () => {
    // Measured through the real journey on the production Snapshot: "Key
    // Market Stats" printed as a heading with no body once its N/A table went.
    const out = presentStoredMarkdown(PRODUCTION_SNAPSHOT_EXCERPT);
    expect(out).not.toContain('## Key Market Stats');
    expect(out).toContain('## Investment Score'); // still has its recommendation line
    expect(out).toContain('## Financial Snapshot'); // still has its rent row
  });

  it('the browser projection both presentations draw from applies it', () => {
    const { report } = projectRowForPdf({ id: 'r', report_content: PRODUCTION_SNAPSHOT_EXCERPT });
    expect(report.content).not.toContain('| N/A |');
    expect(report.content).toContain('| Weekly Rent | $450 |');
  });

  it('every reader of stored content imports the one implementation', () => {
    for (const rel of [
      'src/lib/reports/investment/investmentPdfSource.ts',
      'src/lib/reportTemplate/adapters/investmentReportAdapter.ts',
      'supabase/functions/render-investment-report-pdf/index.ts',
      'src/components/reports/InvestmentReportViewer.tsx',
    ]) {
      const text = src(rel);
      expect(text, rel).toContain('presentStoredMarkdown(');
      expect(text, rel).toMatch(/import \{[^}]*presentStoredMarkdown[^}]*\} from ["'][^"']*derivedHygiene\.pure/);
    }
  });
});

describe('a chip, a chart point and a prompt line never carry a placeholder', () => {
  it('an unstated confidence draws no chip', () => {
    for (const conf of ['NotAvailable', 'N/A', 'n/a', 'Not available', 'unavailable', '', '  ']) {
      expect(confidenceChipHtml(conf), JSON.stringify(conf)).toBe('');
      expect(UNSTATED_CONFIDENCE.test(conf)).toBe(true);
    }
    expect(confidenceChipHtml('Verified')).toContain('Verified');
    expect(confidenceChipHtml('Indicative')).toContain('Indicative');
  });

  it('the standard presentation\'s score chart refuses the engine\'s placeholder 50', () => {
    const components = readScoreComponents({
      breakdown: {
        growthScore: { score: 50, weight: 0, excluded: true, hasData: false },
        locationScore: { score: 58, weight: 25 },
        yieldScore: { score: 50, weight: 15 },
        demandScore: { score: 50, weight: 0, hasData: false },
        riskScore: { score: 60, weight: 5 },
      },
    });
    expect(components.map((c) => c.label)).toEqual(['Location', 'Yield', 'Risk']);
  });

  it('no generator prompt tells the model to write a placeholder or an estimate', () => {
    const banned = [
      /appeared, write "Not available"/i,
      /could not be established for this property/i,
      /state plainly that .{0,40}not available/i,
      /realistic estimates/i,
      /clearly labelled estimates/i,
      /\|\| 'N\/A'\}\/100/,
      // A LABEL with a slot in it. The Snapshot guide named the row "Model
      // vacancy allowance (N weeks, X%)", and the 23 Sep 2026 Snapshot for
      // 97 Poole Road printed exactly that — the model copied the label it
      // was handed, slots and all.
      /\(\s*N\s+weeks\s*,\s*X\s*%\s*\)/,
      /\b[NX]\s+(?:weeks|years|months)\b/,
    ];
    for (const rel of [
      'supabase/functions/generate-investment-report/index.ts',
      'supabase/functions/_shared/engine-prompts.ts',
      'supabase/functions/_shared/reports/contract/governedNarrativeAuthority.pure.ts',
      'supabase/functions/condense-investment-report/index.ts',
    ]) {
      const text = src(rel);
      for (const re of banned) expect(text, `${rel} ${re}`).not.toMatch(re);
    }
  });

  it('the instrument that measures a final PDF exempts nothing', () => {
    const measure = src('scripts/verify/report-pdf/measure.mjs');
    expect(measure).not.toContain('(?! — [a-z])');
    expect(measure).toMatch(/not available\|unavailable/);
  });
});

describe('a heading with nothing under it is dropped', () => {
  it('drops an empty section and keeps a section with sub-sections', () => {
    const md = '## A\n\n## B\n\n### B.1\n\nprose\n\n## C\n';
    const r = dropEmptySections(md);
    expect(r.dropped).toEqual(['A', 'C']);
    expect(r.markdown).toBe('## B\n\n### B.1\n\nprose\n');
  });

  it('runs to a fixed point, so a parent emptied by its children goes too', () => {
    const md = '# Top\n\n## Parent\n\n### Child one\n\n### Child two\n\n## Sibling\n\ntext\n';
    const r = dropEmptySections(md);
    expect(r.dropped).toEqual(['Child one', 'Child two', 'Parent']);
    expect(r.markdown).toBe('# Top\n\n## Sibling\n\ntext\n');
  });

  it('returns a document with no empty section byte-identical', () => {
    const md = '## A\n\nprose\n\n\n\n## B\n\n- item\n';
    expect(dropEmptySections(md).markdown).toBe(md);
    expect(dropEmptySections(md).dropped).toEqual([]);
  });

  it('the write paths apply it after the placeholder scrub', () => {
    for (const rel of [
      // BOTH hygiene passes moved to the composition modules with the rest of
      // each engine's deterministic half — which is what makes a briefing, a
      // snapshot and the two fork documents producible outside a deployed
      // Deno runtime at all. The rule is about the PATH a document takes, not
      // about the file the pass happens to live in.
      'supabase/functions/_shared/reports/investment/condenseCompose.pure.ts',
      'supabase/functions/_shared/reports/investment/forkSplit.pure.ts',
    ]) {
      expect(src(rel), rel).toContain('dropEmptySections(');
    }
  });
});

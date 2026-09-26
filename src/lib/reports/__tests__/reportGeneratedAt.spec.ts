/**
 * When a report was generated — pinned on the library of 25 Sep 2026.
 *
 * The owner regenerated 60 Lawley Street, Spalding WA that afternoon (the run
 * finished at 06:29:35.871Z, "✓ Progress saved: 64379 chars") and the library
 * card still read "Latest Sep 24, 2026, 11:46 AM · completed" beside
 * "Version 7": every date surface printed `created_at`, and a regeneration
 * reuses the row, so `created_at` never moves. Blacktown and Schofields read
 * the evening of the 24th though both were regenerated on the morning of the
 * 25th.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  generatedAtLabel,
  reportGeneratedAt,
  reportGeneratedAtMs,
  resolveReportGeneratedAt,
} from '../investment/reportGeneratedAt.pure';
import { buildGeneratedReportGroups } from '../generatedReportGroups';
import type { InvestmentReport } from '@/components/reports/library/types';

// The Lawley row as the library reads it: inserted on the 24th, regenerated
// today, completed.
const LAWLEY_CREATED = '2026-09-24T01:46:00.000Z';
const LAWLEY_REGENERATED = '2026-09-25T06:29:35.871Z';

describe('resolveReportGeneratedAt', () => {
  it('dates a regenerated report by the generation that completed, not by its row', () => {
    const row = {
      status: 'completed',
      created_at: LAWLEY_CREATED,
      // The final write's quality metadata, as the detail projection carries it.
      data_sources: { _generationQuality: { generatedAt: LAWLEY_REGENERATED, averageScore: 99 } },
    };
    expect(resolveReportGeneratedAt(row)).toEqual({ at: LAWLEY_REGENERATED, basis: 'generation' });
  });

  it('reads the library projection alias the same way', () => {
    const row = { status: 'completed', created_at: LAWLEY_CREATED, generation_completed_at: LAWLEY_REGENERATED };
    expect(resolveReportGeneratedAt(row)).toEqual({ at: LAWLEY_REGENERATED, basis: 'generation' });
  });

  it('falls back to the row itself where nothing else is recorded — the date surfaces printed before', () => {
    expect(resolveReportGeneratedAt({ status: 'completed', created_at: LAWLEY_CREATED }))
      .toEqual({ at: LAWLEY_CREATED, basis: 'created' });
    // A missing status is treated as complete, as every surface already did.
    expect(resolveReportGeneratedAt({ created_at: LAWLEY_CREATED })).toEqual({ at: LAWLEY_CREATED, basis: 'created' });
  });

  it('never reads `updated_at` for a complete report — an override save is not a generation', () => {
    const row = {
      status: 'completed',
      created_at: LAWLEY_CREATED,
      updated_at: '2026-09-26T09:00:00.000Z',
      generation_completed_at: LAWLEY_REGENERATED,
    };
    expect(resolveReportGeneratedAt(row)?.at).toBe(LAWLEY_REGENERATED);
    expect(resolveReportGeneratedAt({ status: 'completed', created_at: LAWLEY_CREATED, updated_at: '2026-09-26T09:00:00.000Z' })?.at)
      .toBe(LAWLEY_CREATED);
  });

  it.each(['processing', 'pending', 'failed'])(
    'dates a %s report by its latest activity — the row holds that attempt\'s content',
    (status) => {
      const row = {
        status,
        created_at: LAWLEY_CREATED,
        updated_at: '2026-09-25T06:26:48.000Z',
        // The previous generation's stamp is still on the row until the final write.
        generation_completed_at: '2026-09-25T01:38:26.000Z',
      };
      expect(resolveReportGeneratedAt(row)).toEqual({ at: '2026-09-25T06:26:48.000Z', basis: 'activity' });
    },
  );

  it('dates an unfinished report with no recorded activity by its row', () => {
    expect(resolveReportGeneratedAt({ status: 'processing', created_at: LAWLEY_CREATED }))
      .toEqual({ at: LAWLEY_CREATED, basis: 'created' });
  });

  it('dates a child report by when it was last drawn from its parent', () => {
    const row = { status: 'completed', created_at: '2026-09-20T00:00:00.000Z', variant_generated_at: '2026-09-25T02:00:00.000Z' };
    expect(resolveReportGeneratedAt(row)).toEqual({ at: '2026-09-25T02:00:00.000Z', basis: 'generation' });
  });

  it('ignores a stamp older than the row — a copied parent stamp describes the parent', () => {
    const row = {
      status: 'completed',
      created_at: '2026-09-20T00:00:00.000Z',
      data_sources: { _generationQuality: { generatedAt: '2026-09-19T23:00:00.000Z' } },
    };
    expect(resolveReportGeneratedAt(row)).toEqual({ at: '2026-09-20T00:00:00.000Z', basis: 'created' });
  });

  it('takes the latest of several stamps', () => {
    const row = {
      status: 'completed',
      created_at: '2026-09-20T00:00:00.000Z',
      generation_completed_at: '2026-09-21T00:00:00.000Z',
      variant_generated_at: '2026-09-22T00:00:00.000Z',
    };
    expect(resolveReportGeneratedAt(row)?.at).toBe('2026-09-22T00:00:00.000Z');
  });

  it('ignores what is not a time', () => {
    const row = { status: 'completed', created_at: LAWLEY_CREATED, generation_completed_at: 'not a date', variant_generated_at: '' };
    expect(resolveReportGeneratedAt(row)).toEqual({ at: LAWLEY_CREATED, basis: 'created' });
    expect(resolveReportGeneratedAt({})).toBeNull();
    expect(resolveReportGeneratedAt(null)).toBeNull();
  });
});

describe('reportGeneratedAt', () => {
  it('reads what the server resolved first', () => {
    const row = { created_at: LAWLEY_CREATED, generated_at: LAWLEY_REGENERATED, generated_at_basis: 'generation' };
    expect(reportGeneratedAt(row)).toEqual({ at: LAWLEY_REGENERATED, basis: 'generation' });
    expect(reportGeneratedAt({ ...row, generated_at_basis: 'activity' })?.basis).toBe('activity');
    // A basis this build does not know is read as a generation, never dropped.
    expect(reportGeneratedAt({ ...row, generated_at_basis: 'something-new' })?.basis).toBe('generation');
  });

  it('resolves from the raw stamps where the row reached the browser another way', () => {
    expect(reportGeneratedAt({ status: 'completed', created_at: LAWLEY_CREATED, generation_completed_at: LAWLEY_REGENERATED })?.at)
      .toBe(LAWLEY_REGENERATED);
  });

  it('sorts a row with no time last', () => {
    expect(reportGeneratedAtMs({ created_at: LAWLEY_CREATED })).toBe(Date.parse(LAWLEY_CREATED));
    expect(reportGeneratedAtMs({})).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe('generatedAtLabel', () => {
  it('does not call an unfinished attempt "generated"', () => {
    expect(generatedAtLabel('generation')).toBe('Generated');
    expect(generatedAtLabel('created')).toBe('Generated');
    expect(generatedAtLabel('activity')).toBe('Last updated');
    expect(generatedAtLabel(null)).toBe('Generated');
  });
});

describe('the library groups by generation time', () => {
  const row = (over: Partial<InvestmentReport>): InvestmentReport => ({
    id: 'x',
    property_address: '60 Lawley Street, Spalding WA 6530',
    property_listing_id: null,
    canonical_property_key: 'listing:lawley',
    created_at: LAWLEY_CREATED,
    current_version: 1,
    report_variant: 'compass',
    report_tier: 'compass',
    status: 'completed',
    ...over,
  });

  it('names the regenerated report as the latest, at the time it was regenerated', () => {
    const groups = buildGeneratedReportGroups([
      // Inserted last, generated once, yesterday evening.
      row({ id: 'fork', report_variant: 'financial', report_tier: 'financial', created_at: '2026-09-24T10:18:00.000Z' }),
      // Inserted first, regenerated today.
      row({ id: 'compass', generated_at: LAWLEY_REGENERATED, generated_at_basis: 'generation', current_version: 8 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].latestGeneratedAt).toBe(LAWLEY_REGENERATED);
    expect(groups[0].latestReport?.id).toBe('compass');
  });
});

describe('every surface that prints a report date reads the rule', () => {
  const ROOT = join(__dirname, '..', '..', '..', '..');
  const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
  const SURFACES = [
    'src/components/reports/library/InvestmentReportCard.tsx',
    'src/components/reports/library/PropertyReportPackageCard.tsx',
    'src/components/reports/library/InvestmentReportTable.tsx',
    'src/components/reports/report-view/InvestmentReportHero.tsx',
    'src/components/reports/InvestmentReportViewer.tsx',
    'src/components/reports/InvestmentReportEditor.tsx',
    'src/components/reports/ComparisonBasket.tsx',
    'src/pages/GeneratedReports.tsx',
    'src/pages/InvestmentReportView.tsx',
    'src/lib/reports/generatedReportGroups.ts',
  ];

  it.each(SURFACES)('%s formats no bare created_at', (file) => {
    const source = read(file);
    // `created_at` may appear only as the fallback after the rule.
    expect(source).not.toMatch(/format\(new Date\((?:report|latest|r)\.created_at\)/);
    expect(source).not.toMatch(/safeDate\(report\.created_at\)/);
    expect(source).not.toMatch(/latestGeneratedAt: latest\?\.created_at/);
    expect(source).toMatch(/reportGeneratedAt/);
  });

  it("dates the client's investment reports by the rule, and its other reports as before", () => {
    const inventory = read('src/lib/reports/clientReportInventory.pure.ts');
    const start = inventory.indexOf('investmentReports.forEach');
    const end = inventory.indexOf('.forEach(', start + 'investmentReports.forEach'.length);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(inventory.slice(start, end)).toContain('generatedAt: reportGeneratedAt(r)?.at ?? r.created_at,');
    // Portfolio analyses and borrowing assessments are rows of other tables,
    // written once; their `created_at` is when they were produced.
    expect(inventory.slice(end)).toContain('generatedAt: r.created_at,');
    expect(inventory.slice(end)).not.toContain('reportGeneratedAt(');
  });

  it('the server publishes the resolved date on every list and detail read', () => {
    const route = read('supabase/functions/get-investment-reports/index.ts');
    const select = route.match(/INVESTMENT_LIBRARY_SELECT = '([^']+)'/)?.[1] ?? '';
    for (const column of ['created_at', 'updated_at', 'variant_generated_at', 'generation_completed_at:data_sources->_generationQuality->>generatedAt']) {
      expect(select.split(',')).toContain(column);
    }
    // Resolved once, by the shared rule, and the alias is not published.
    expect(route).toContain("import { resolveReportGeneratedAt } from '../_shared/reports/investment/reportGeneratedAt.pure.ts';");
    expect(route).toMatch(/generated_at: reading\?\.at \?\? null, generated_at_basis: reading\?\.basis \?\? null/);
    expect(route).toContain('delete dated.generation_completed_at;');
  });

  it('the generator still writes the completion stamp the rule reads', () => {
    const generator = read('supabase/functions/generate-investment-report/index.ts');
    expect(generator).toMatch(/const qualityMetadata = \{\s*generatedAt: new Date\(\)\.toISOString\(\),/);
    expect(generator).toContain('_generationQuality: qualityMetadata');
  });
});

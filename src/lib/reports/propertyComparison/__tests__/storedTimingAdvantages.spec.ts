/**
 * Market timing and competitive advantages, stored and printed (COMPARISON.md §14).
 *
 * The producer has asked the model for both since its first prompt and the
 * writer dropped them on every intact comparison, so a client's typeset
 * document printed them only when the answer had been cut off. The owner
 * approved the columns on 28 Sep 2026 with one condition: "the AI generated
 * recommendations and processes is not to be amended at all … but ultimately,
 * inject into the new template".
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildPropertyComparison } from '../normalise.pure';
import { renderComparisonFromBrand } from '../render.pure';
import { comparisonSections } from '../sections.pure';
import {
  readStoredAnalysis,
  STRUCTURED_COLUMNS,
  SUPPLEMENTARY_COLUMNS,
  supplementaryColumnsFor,
} from '../storedAnalysis.pure';
import { projectComparison } from '../../../../../supabase/functions/_shared/comparisonProjection.pure';
import { analysisFromComparisonRow } from '@/components/reports/comparisonRecovery.pure';
import { buildReportBrandSnapshot } from '@/lib/reportDesign/snapshot.pure';

const REPO = resolve(__dirname, '../../../../..');
const read = (p: string) => readFileSync(resolve(REPO, p), 'utf8');
const NOW = '2026-09-28T00:00:00.000Z';

const { snapshot } = buildReportBrandSnapshot({
  whitelabel: { companyName: 'Tenant Advisory', preset: 'signature' },
  contact: { company_name: 'Tenant Advisory Pty Ltd' },
  capturedAt: NOW,
});

/** The two sections, exactly as the prompt's JSON shape asks for them. */
const MARKET_TIMING = {
  buyFirst: { propertyNumber: 2, reason: 'Thin stock and a corridor already moving.' },
  holdingPeriods: [
    { propertyNumber: 1, recommendedPeriod: '7-10 years', reason: 'The growth case needs a full cycle.' },
    { propertyNumber: 2, recommendedPeriod: '5+ years', reason: 'Yield carries the hold.' },
  ],
  exitStrategies: [
    { propertyNumber: 1, strategy: 'Sell into the owner-occupier market once the rail extension opens.' },
    { propertyNumber: 2, strategy: 'Hold for income and refinance to release equity.' },
  ],
};
const COMPETITIVE_ADVANTAGES = [
  { propertyNumber: 1, advantages: ['Corner block with dual frontage', 'Walk score 91'] },
  { propertyNumber: 2, advantages: ['Gross yield 5.1% against a basket average of 4.2%'] },
];

const ranking = (n: number, score: number) => ({
  rank: n,
  propertyNumber: n,
  address: `${n} Example Street, Sampleton, QLD 4000`,
  finalScore: score,
  primaryStrengths: [`Strength ${n}`],
  primaryConcerns: [`Concern ${n}`],
  bestSuitedFor: 'Growth investors',
});

/** An intact row, as the producer writes it from now on. */
const row = (over: Record<string, unknown> = {}) => ({
  id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  created_at: NOW,
  property_count: 2,
  property_addresses: ['1 Example Street, Sampleton, QLD 4000', '2 Example Street, Sampleton, QLD 4000'],
  property_states: ['QLD'],
  report_title: 'COMPARISON ANALYSIS - 2 PROPERTIES, QLD',
  report_ids: ['r1', 'r2'],
  executive_summary: 'Two properties compared.',
  rankings: [ranking(1, 82), ranking(2, 74)],
  financial_comparison: { bestYield: { propertyNumber: 2, value: '5.1%', reason: 'Higher rent for the price.' } },
  location_comparison: null,
  risk_comparison: null,
  investor_matches: null,
  recommendations: { bestOverall: { propertyNumber: 1, reason: 'Best on balance.' } },
  red_flags: null,
  market_timing: MARKET_TIMING,
  competitive_advantages: COMPETITIVE_ADVANTAGES,
  analysis_summary: '{"timeHorizon":"5-7 years","riskTolerance":"moderate","customWeights":null}',
  is_archived: false,
  ...over,
});

const html = (over: Record<string, unknown> = {}) => renderComparisonFromBrand({
  comparison: buildPropertyComparison({ row: row(over), now: NOW }),
  snapshot,
}).html;

describe('the producer stores what the model already answered', () => {
  it('writes both sections as the model gave them, and nothing when there is nothing', () => {
    expect(supplementaryColumnsFor({ marketTiming: MARKET_TIMING, competitiveAdvantages: COMPETITIVE_ADVANTAGES }))
      .toEqual({ market_timing: MARKET_TIMING, competitive_advantages: COMPETITIVE_ADVANTAGES });
    expect(supplementaryColumnsFor({ marketTiming: MARKET_TIMING }))
      .toEqual({ market_timing: MARKET_TIMING, competitive_advantages: null });
    // An empty answer stays NULL rather than becoming `{}` / `[]`.
    expect(supplementaryColumnsFor({ marketTiming: {}, competitiveAdvantages: [] })).toBeNull();
    expect(supplementaryColumnsFor({ marketTiming: 'soon', competitiveAdvantages: 'many' })).toBeNull();
  });

  it('never changes what the model is asked, and never risks the comparison row to store them', () => {
    const src = read('supabase/functions/compare-investment-reports/index.ts');
    // The prompt's JSON shape still asks for exactly these, as it always did.
    expect(src).toContain('"marketTiming": {');
    expect(src).toContain('"exitStrategies": [{ "propertyNumber": number, "strategy": "string" }]');
    expect(src).toContain('"competitiveAdvantages": [');
    // Not part of the insert: a deployment the migration has not reached must
    // still save the comparison.
    const insert = src.slice(src.indexOf(".from('property_comparisons')\n      .insert("), src.indexOf('.select()\n      .single();'));
    expect(insert).not.toMatch(/market_timing|competitive_advantages/);
    expect(src).toContain('supplementaryColumnsFor(analysis)');
    expect(src).toMatch(/if \(!storeRaw && comparisonData\?\.id\)/);
  });

  it('adds the two columns in an additive migration, nullable, with no backfill', () => {
    const sql = read('supabase/migrations/20261228100000_property_comparisons_timing_and_advantages.sql');
    const code = sql.replace(/--.*$/gm, '');
    expect(code).toMatch(/add column if not exists market_timing jsonb/);
    expect(code).toMatch(/add column if not exists competitive_advantages jsonb/);
    expect(code).not.toMatch(/\b(update|insert|delete|drop|not null|default)\b/i);
  });
});

describe('the reader', () => {
  it('reads both on the columns path, and they do not decide the shape', () => {
    const stored = readStoredAnalysis(row());
    expect(stored.provenance.shape).toBe('columns');
    expect(stored.sections.marketTiming).toEqual(MARKET_TIMING);
    expect(stored.sections.competitiveAdvantages).toEqual(COMPETITIVE_ADVANTAGES);
    for (const c of SUPPLEMENTARY_COLUMNS) expect(STRUCTURED_COLUMNS as readonly string[]).not.toContain(c);
  });

  it('reads a row written before the migration exactly as before — the keys are simply absent', () => {
    const before = row();
    delete (before as Record<string, unknown>).market_timing;
    delete (before as Record<string, unknown>).competitive_advantages;
    const doc = buildPropertyComparison({ row: before, now: NOW });
    expect(doc.timing).toBeNull();
    expect(doc.advantages).toEqual([]);
    expect(comparisonSections(doc).map((s) => s.id)).not.toContain('timing');
  });
});

describe('the typeset document prints them', () => {
  it('draws "What sets each apart" and "Timing and holding" on an intact comparison', () => {
    const doc = buildPropertyComparison({ row: row(), now: NOW });
    const ids = comparisonSections(doc).map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(['advantages', 'timing']));
    // Where they sit: after the matches, before the recommendation.
    expect(ids.indexOf('timing')).toBeLessThan(ids.indexOf('plan'));

    const out = html();
    expect(out).toContain('What sets each apart');
    expect(out).toContain('Corner block with dual frontage');
    expect(out).toContain('Gross yield 5.1% against a basket average of 4.2%');
    expect(out).toContain('Timing and holding');
    expect(out).toContain('Thin stock and a corridor already moving.');
    expect(out).toContain('7-10 years');
  });

  it('prints the exit strategies, which no surface had printed', () => {
    const out = html();
    expect(out).toContain('Exit strategies');
    expect(out).toContain('Sell into the owner-occupier market once the rail extension opens.');
    expect(out).toContain('how to exit');
  });

  it('keeps the model’s words: nothing is reworded', () => {
    const doc = buildPropertyComparison({ row: row(), now: NOW });
    expect(doc.timing?.exitStrategies.map((e) => e.strategy))
      .toEqual(MARKET_TIMING.exitStrategies.map((e) => e.strategy));
    expect(doc.advantages.flatMap((a) => a.advantages))
      .toEqual(COMPETITIVE_ADVANTAGES.flatMap((a) => a.advantages));
  });

  it('reaches a chosen template’s bindings too', () => {
    const p = projectComparison({ row: row(), now: NOW, notes: [] }) as Record<string, any>;
    expect(p.comparison.timing.buyFirstReason).toBe('Thin stock and a corridor already moving.');
    expect(p.comparison.timing.exits.map((e: { strategy: string }) => e.strategy))
      .toEqual(MARKET_TIMING.exitStrategies.map((e) => e.strategy));
    expect(p.comparison.advantages[0].items).toEqual(COMPETITIVE_ADVANTAGES[0].advantages);
  });
});

describe('the basis table', () => {
  it('omits a setting the record does not hold rather than printing a dash', () => {
    const basis = (out: string) => out.slice(out.lastIndexOf('On what basis'));
    expect(basis(html())).not.toContain('Analysis depth');
    expect(basis(html({ analysis_depth: 'comprehensive' }))).toContain('Analysis depth');
    expect(basis(html())).toContain('Time horizon');
  });

  it('reads a stored setting as a setting: sentence case, a range with an en dash', () => {
    const basis = html().slice(html().lastIndexOf('On what basis'));
    expect(basis).toContain('5\u20137 years');
    expect(basis).toContain('>Moderate<');
    expect(basis).not.toContain('>moderate<');
  });

  // The model's identifier was printed as "Analysed by" on every production
  // comparison (`model_used` is `google/gemini-2.5-flash` on each). What it
  // stood for, that a model wrote the ranking, is said in words on every
  // comparison whether or not the record names the model (Audit 8).
  it('never prints the model, and always says in words that AI wrote it', () => {
    for (const out of [html(), html({ model_used: 'google/gemini-2.5-flash' })]) {
      const basis = out.slice(out.lastIndexOf('On what basis'));
      expect(basis).not.toContain('Analysed by');
      expect(out).not.toContain('gemini');
      expect(basis).toContain('Written by AI');
      expect(basis).toContain('written by an AI analysis');
    }
  });
});

describe('the on-screen History loader', () => {
  it('keeps the stored advantages rather than an empty list', () => {
    expect(analysisFromComparisonRow(row()).competitiveAdvantages).toEqual(COMPETITIVE_ADVANTAGES);
    expect(analysisFromComparisonRow({ ...row(), competitive_advantages: undefined }).competitiveAdvantages).toEqual([]);
  });
});

/**
 * RF-7.2B.1 — FORWARD-SAFE DATA ACTIVATION.
 *
 * RF-7.2B's suite proved the safety layer WORKS. This one proves it is
 * WIRED, which is the distinction that phase closed on: every module below
 * existed and passed its own tests while a report generated that day received
 * exactly what it had received before.
 *
 * So several of these are source-level assertions against the real Edge
 * Functions. That is deliberate. A unit test of a pure module cannot tell you
 * whether production calls it, and "the gate exists" was precisely the claim
 * that turned out not to mean what it sounded like.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  activateSafeGenerationInputs,
  demographicsAreRetrieved,
  poaOfCensusSource,
  DISOWNED_LOCATION_PATHS,
  ASSURANCE_VERSION,
  SAFE_GENERATION_VERSION,
} from '../contract/safeGenerationInputs.pure';
import { safeCashRateTarget, cashRateTargetStatement } from '../contract/safeMarketFacts.pure';
import { auditMarketClaims } from '../contract/marketClaimAudit.pure';
import { macroEconomicBlock } from '../../../../supabase/functions/_shared/reports/macroPromptBlocks.pure';
import { cashRateTargetOf } from '../../../../supabase/functions/_shared/rbaReading.pure';
import { parseCashRateDecisions } from '../../../../supabase/functions/_shared/rbaCashRateDecisions.pure';
import {
  PRODUCTION_SCORING_AUTHORITY,
  mayPublishOverallGrade,
  mayPublishDimensionScores,
} from '../../../../supabase/functions/_shared/reports/market/scoringInputPolicy.pure';
import {
  RBA_WANTED_SERIES,
  RBA_PERSIST_POLICY,
  observationsToPersist,
} from '../../../../supabase/functions/_shared/rbaTables.pure';

const ROOT = resolve(__dirname, '../../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf-8');

/** Source with comments stripped — the rules are about code, not prose. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const GENERATOR = 'supabase/functions/generate-investment-report/index.ts';
const REGENERATOR = 'supabase/functions/regenerate-report-qualitative/index.ts';

const LEGACY_LOCATION = {
  coordinates: { lat: -37.7, lng: 144.5 },
  walkScore: 68,
  commute: { durationMinutes: 42, distanceKm: 31 },
  transport: { qualityScore: 72, nearestStation: 'Cobblebank', stopsWithinRadius: 4 },
  schools: { nearestSchool: 'Cobblebank PS', distanceToSchool: 1.2, schoolsWithin3km: 20 },
  healthcare: { facilitiesWithin5km: 3 },
};
const GENERATED_DEMOGRAPHICS = {
  population: { total: 18234 },
  dataSource: 'ABS Census 2021 estimates',
  dataQuality: 'census',
  referencePeriod: '2021',
};
const RETRIEVED_DEMOGRAPHICS = {
  population: { total: 18234 },
  dataSource: 'ABS Census 2021 (POA 3338)',
  dataQuality: 'census',
  referencePeriod: '2021',
};
const TARGET_READING = {
  percent: 4.35,
  effectiveDate: '2026-08-12',
  effectiveLabel: '12 August 2026',
  lastChangedDate: '2026-05-06',
  lastChangedLabel: '6 May 2026',
  lastChangePoints: 0.25,
  decisionsSinceChange: 2,
  asAtLabel: '10 September 2026',
  seriesId: 'FIRMMCRTD',
  tableCode: 'f1',
  publicationDate: '11-Sep-2026',
  effectiveDateSource: 'RBA Cash Rate Target decision history',
};

/** A trusted point-in-polygon geography for the subject property. */
const SUBJECT_GEOGRAPHY = { status: 'resolved', postcode: '3338', suburb: 'Cobblebank', state: 'VIC' };

const activate = (
  enhancedData: unknown,
  target: unknown = TARGET_READING,
  geography: unknown = SUBJECT_GEOGRAPHY,
) =>
  activateSafeGenerationInputs({
    enhancedData,
    geography,
    cashRateTarget: target as never,
    cashRateMonthlyAverage: null,
    capturedAt: '2026-09-11T08:00:00.000Z',
  });

// ---------------------------------------------------------------------------
// 1. The live generator uses the Client-Safe Gate
// ---------------------------------------------------------------------------

describe('1 — the gate is wired into the actual generators', () => {
  it('generate-investment-report calls the activation and adopts its result', () => {
    const src = stripComments(read(GENERATOR));
    expect(src).toContain('activateSafeGenerationInputs');
    expect(src).toContain('enhancedData = safeGeneration.enhancedData');
  });

  it('regenerate-report-qualitative calls it too — the second narrative path', () => {
    const src = stripComments(read(REGENERATOR));
    expect(src).toContain('activateSafeGenerationInputs');
    expect(src).toContain('enhancedData = safeGeneration.enhancedData');
  });

  it('the activation runs BEFORE the first base prompt is composed', () => {
    const src = read(GENERATOR);
    const gate = src.indexOf('activateSafeGenerationInputs({');
    expect(gate).toBeGreaterThan(0);
    // All four base prompts must be composed after the gate, or one of them
    // could interpolate a fact the gate was about to withhold.
    for (const p of ['const suburbPrompt =', 'const postcodePrompt =', 'const statewidePrompt =', 'const propertyPrompt =']) {
      expect(src.indexOf(p), p).toBeGreaterThan(gate);
    }
  });
});

// ---------------------------------------------------------------------------
// 2-4. Demographics: generated blocked, trusted admitted, absence not estimated
// ---------------------------------------------------------------------------

describe('2-4 — demographics are admitted only as a recognised retrieval', () => {
  it('2 — legacy generated demographics cannot reach the prompt', () => {
    const r = activate({ demographics: GENERATED_DEMOGRAPHICS });
    expect(r.enhancedData.demographics).toBeUndefined();
    expect(r.demographicsKept).toBe(false);
  });

  it('3 — a trusted ABS POA retrieval does reach the prompt', () => {
    const r = activate({ demographics: RETRIEVED_DEMOGRAPHICS });
    expect(r.enhancedData.demographics).toBeDefined();
    expect(r.demographicsKept).toBe(true);
  });

  it('4 — withholding says so, and never estimates, synthesises or borrows', () => {
    const r = activate({ demographics: GENERATED_DEMOGRAPHICS });
    expect(r.demographicsRuling).toMatch(/withheld/i);
    expect(r.demographicsRuling).toMatch(/not estimated, synthesised or borrowed/i);
    // Nothing was substituted in its place.
    expect(Object.keys(r.enhancedData)).not.toContain('demographics');
  });

  it('trust is asymmetric — an unrecognised source fails rather than passes', () => {
    for (const source of [undefined, null, '', 'Local research', 'ABS Census 2021', 'abs_census_poa']) {
      expect(demographicsAreRetrieved({ dataSource: source, dataQuality: 'census' }), String(source)).toBe(false);
    }
    expect(demographicsAreRetrieved(RETRIEVED_DEMOGRAPHICS)).toBe(true);
  });

  it('5 — a POA fact keeps its POA grain and identifier in the snapshot', () => {
    const fact = activate({ demographics: RETRIEVED_DEMOGRAPHICS })
      .snapshot.facts.find((f) => f.name === 'market.demographics')!;
    expect(fact.grain).toBe('postcode');
    expect(fact.geographyId).toBe('3338');
    expect(fact.dataset).toBe('abs_census_poa');
    expect(poaOfCensusSource('ABS Census 2021 (POA 3338)')).toBe('3338');
  });
});

// ---------------------------------------------------------------------------
// 6-8. The cash rate
// ---------------------------------------------------------------------------

describe('6-8 — the cash rate is the in-force target, not a constant or a model', () => {
  it('6 — no hardcoded cash-rate constant survives anywhere in the generator', () => {
    const src = stripComments(read(GENERATOR));
    // 4.35 is today's target. A literal of it in the generator is either a
    // hardcoded rate or an illustrative one a model can copy; both were live.
    expect(src).not.toMatch(/\b4\.35\b/);
    expect(src).not.toMatch(/\b4\.10\b/);
  });

  it('7 — an LLM-sourced rate is not a recognised source', () => {
    const fact = safeCashRateTarget({ ...TARGET_READING, seriesId: 'perplexity-web-search' } as never);
    expect(fact.status).toBe('absent');
    expect(fact.absence?.reason).toMatch(/not the Reserve Bank cash rate target/i);
  });

  it('8 — the semantic choice is explicit: the target leads, the average is labelled', () => {
    const block = macroEconomicBlock({
      economics: {
        cashRateTarget: TARGET_READING,
        cashRate: {
          current: { value: 4.35, period: '2026-08', periodLabel: 'August 2026' },
          basis: 'Cash Rate Target; monthly average',
          source: 'RBA statistical table F1.1',
          publicationDate: '01-Sep-2026',
        },
      } as never,
    });
    expect(block).toContain('RBA cash rate target (current)');
    expect(block).toContain('12 August 2026 (most recent Board decision)');
    expect(block).toContain('Cash Rate Target — Monthly Average');
    const rows = block.split('\n').filter((l) => l.startsWith('|'));
    // The monthly row must never claim to be current.
    const monthly = rows.find((r) => r.includes('Monthly Average'))!;
    expect(monthly).not.toMatch(/current|in force|today/i);
  });

  it('8b — with no target the block fails closed rather than substituting', () => {
    const block = macroEconomicBlock({
      economics: {
        cashRate: {
          current: { value: 4.35, period: '2026-08', periodLabel: 'August 2026' },
          basis: 'Cash Rate Target; monthly average',
          source: 'RBA statistical table F1.1',
          publicationDate: '01-Sep-2026',
        },
      } as never,
    });
    expect(block).toContain('NO CURRENT CASH RATE TARGET IS AVAILABLE');
    expect(block).not.toContain('cash rate target (current)');
  });

  it('F1 alone CANNOT supply an effective date — it fails closed instead', () => {
    // The whole reason the decision history exists. F1's change column records
    // only non-zero moves, so deriving an effective date from it reports the
    // LAST CHANGE (6 May 2026) where the RBA publishes 12 August 2026.
    const meta = [{ series_id: 'FIRMMCRTD', table_code: 'f1', title: 'Cash Rate Target', description: 'Cash Rate Target on date', units: 'Per cent', publication_date: '11-Sep-2026' }];
    const obs = [
      { series_id: 'FIRMMCRTD', obs_date: '2026-05-06', value: 4.35 },
      { series_id: 'FIRMMCRTD', obs_date: '2026-09-10', value: 4.35 },
      { series_id: 'FIRMMCCRT', obs_date: '2026-05-06', value: 0.25 },
    ];
    expect(cashRateTargetOf(meta as never, obs as never, [])).toBeNull();
  });

  it('a refused target is REMOVED from the payload, not merely recorded absent', () => {
    // The macro block renders `economics.cashRateTarget` straight off the
    // object. Recording the gate's refusal in the fact list while leaving the
    // value in place printed a "current" row with an effective date from an
    // LLM-sourced series — found by the forward cohort, not by a unit test,
    // which is why the cohort runs against the sanitised object.
    const r = activate(
      { economics: { cashRateTarget: { ...TARGET_READING, seriesId: 'perplexity-web-search' } } },
      { ...TARGET_READING, seriesId: 'perplexity-web-search' },
    );
    const economics = r.enhancedData.economics as Record<string, unknown>;
    expect(economics.cashRateTarget).toBeUndefined();
    expect(r.removed.map((x) => x.path)).toContain('economics.cashRateTarget');

    const block = macroEconomicBlock({ economics: economics as never });
    expect(block).not.toContain('cash rate target (current)');
  });

  it('an accepted target is left on the payload untouched', () => {
    const r = activate({ economics: { cashRateTarget: TARGET_READING } });
    expect((r.enhancedData.economics as Record<string, unknown>).cashRateTarget).toEqual(TARGET_READING);
    expect(r.removed.map((x) => x.path)).not.toContain('economics.cashRateTarget');
  });

  it('the statement says effective, never "current rate today"', () => {
    const s = cashRateTargetStatement(safeCashRateTarget(TARGET_READING as never));
    expect(s).toContain('RBA Cash Rate Target: 4.35%');
    expect(s).toContain('effective 12 August 2026');
  });
});

// ---------------------------------------------------------------------------
// 9-10. Location, and no parallel route round the gate
// ---------------------------------------------------------------------------

describe('9-10 — the disowned Location facts, and no bypass', () => {
  it('9 — the trio plus the transport score cannot reach the prompt', () => {
    const r = activate({ locationIntelligence: LEGACY_LOCATION });
    const loc = r.enhancedData.locationIntelligence as Record<string, unknown>;
    expect(loc.walkScore).toBeUndefined();
    expect(loc.commute).toBeUndefined();
    expect((loc.transport as Record<string, unknown>).qualityScore).toBeUndefined();
    expect((loc.schools as Record<string, unknown>).schoolsWithin3km).toBeUndefined();
  });

  it('9b — and the measured neighbours beside them survive untouched', () => {
    const loc = activate({ locationIntelligence: LEGACY_LOCATION })
      .enhancedData.locationIntelligence as Record<string, unknown>;
    expect(loc.coordinates).toEqual(LEGACY_LOCATION.coordinates);
    expect((loc.transport as Record<string, unknown>).nearestStation).toBe('Cobblebank');
    expect((loc.schools as Record<string, unknown>).nearestSchool).toBe('Cobblebank PS');
    expect((loc.healthcare as Record<string, unknown>).facilitiesWithin5km).toBe(3);
  });

  it('9c — the derived livability conclusion loses its input', () => {
    // The inline area scorer reads `locationIntelligence.walkScore > 70` to
    // award "High walkability". With the field gone the comparison is false,
    // so the conclusion cannot be drawn rather than being drawn on nothing.
    const loc = activate({ locationIntelligence: { ...LEGACY_LOCATION, walkScore: 95 } })
      .enhancedData.locationIntelligence as Record<string, unknown>;
    expect(Number(loc.walkScore) > 70).toBe(false);
  });

  it('10 — no prompt in either generator still reads a disowned field', () => {
    for (const file of [GENERATOR, REGENERATOR]) {
      const src = stripComments(read(file));
      expect(src, file).not.toMatch(/locationIntelligence\?\.walkScore/);
      expect(src, file).not.toMatch(/\.transport\?\.qualityScore/);
      expect(src, file).not.toMatch(/commute\?\.durationMinutes/);
      expect(src, file).not.toMatch(/loc\.walkScore/);
    }
  });

  it('10b — the disowned ROWS are gone too, not just their values', () => {
    // A labelled row is a promise that a figure follows it. Leaving
    // "| Walk Score |" with an empty cell asks the model to fill it.
    const src = read(GENERATOR);
    expect(src).not.toContain('| Walk Score |');
    expect(src).not.toContain('| Public Transport Score |');
    expect(src).not.toContain('| Public Transport Quality Score |');
    expect(src).not.toContain('| CBD Commute Time |');
    // ...and the prompt says plainly that none of them may be stated.
    expect(src).toContain('Do NOT state a Walk Score');
  });

  it('the list of disowned paths is data, so the doc and the code cannot drift', () => {
    expect([...DISOWNED_LOCATION_PATHS]).toEqual([
      'walkScore', 'transport.qualityScore', 'commute', 'schools.schoolsWithin3km',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 13-14. The report-time snapshot
// ---------------------------------------------------------------------------

describe('13-14 — the report-time snapshot', () => {
  it('13 — it carries every field the mandate requires, per fact', () => {
    const fact = activate({ demographics: RETRIEVED_DEMOGRAPHICS })
      .snapshot.facts.find((f) => f.name === 'market.demographics')!;
    for (const key of ['name', 'status', 'value', 'source', 'dataset', 'grain', 'geographyId', 'referencePeriod', 'asOf', 'ruling']) {
      expect(Object.keys(fact), key).toContain(key);
    }
  });

  it('13b — and the assurance version it was produced under', () => {
    const snap = activate({}).snapshot;
    expect(snap.assuranceVersion).toBe(ASSURANCE_VERSION);
    expect(snap.assuranceVersion).toContain(SAFE_GENERATION_VERSION);
    expect(snap.capturedAt).toBe('2026-09-11T08:00:00.000Z');
  });

  it('13c — it is persisted by the generator, not merely computed', () => {
    const src = stripComments(read(GENERATOR));
    expect(src).toContain('market_fact_snapshot: safeGeneration.snapshot');
    expect(src).toContain('earlyUpdate.market_fact_snapshot');
  });

  it('14 — reopening reads the stored snapshot; nothing re-queries a market table', () => {
    // The column is additive and nullable, and nothing backfills it: a report
    // that predates the snapshot reads NULL rather than acquiring one.
    const migration = read('supabase/migrations/20261119100000_report_market_fact_snapshot.sql');
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS market_fact_snapshot jsonb/);
    expect(migration).not.toMatch(/\bUPDATE\b|\bINSERT\b/i);
  });
});

// ---------------------------------------------------------------------------
// 15-16. Null is not zero, and zero is not null
// ---------------------------------------------------------------------------

describe('15-16 — null and zero on the activated path', () => {
  it('15 — an absent fact is absent, never 0 and never a technical token', () => {
    const r = activate({ demographics: GENERATED_DEMOGRAPHICS, locationIntelligence: LEGACY_LOCATION });
    for (const fact of r.snapshot.facts.filter((f) => f.status === 'absent')) {
      expect(fact.value).toBeNull();
      expect(fact.value).not.toBe(0);
    }
    const serialised = JSON.stringify(r.snapshot);
    expect(serialised).not.toMatch(/"undefined"|"NaN"|"null"/);
  });

  it('16 — a genuine zero survives the gate as zero', () => {
    const r = activate({
      locationIntelligence: { ...LEGACY_LOCATION, healthcare: { facilitiesWithin5km: 0 } },
    });
    const loc = r.enhancedData.locationIntelligence as Record<string, unknown>;
    expect((loc.healthcare as Record<string, unknown>).facilitiesWithin5km).toBe(0);
  });

  it('16b — a zero cash rate is a reading, not an absence', () => {
    const fact = safeCashRateTarget({ ...TARGET_READING, percent: 0 } as never);
    expect(fact.status).toBe('present');
    expect(fact.value).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 17-19. Templates, history, and the rest of the suite
// ---------------------------------------------------------------------------

describe('17-19 — parity, history and preservation', () => {
  it('17 — the snapshot is the fact set, so every template receives the same one', () => {
    // Template selection happens downstream of generation and reads the stored
    // report. One snapshot per report is what makes cross-template parity a
    // property of the data rather than an agreement between renderers.
    const a = activate({ demographics: RETRIEVED_DEMOGRAPHICS, locationIntelligence: LEGACY_LOCATION });
    const b = activate({ demographics: RETRIEVED_DEMOGRAPHICS, locationIntelligence: LEGACY_LOCATION });
    expect(JSON.stringify(a.snapshot)).toBe(JSON.stringify(b.snapshot));
  });

  it('17b — the template-selection module is untouched by this phase', () => {
    // Selection is `reportTemplateSelection.pure.ts`, downstream of generation.
    // RF-7.2B.1 changes what a report CONTAINS, never which template draws it,
    // so that module must carry no reference to this phase's machinery.
    const selection = read('supabase/functions/_shared/reports/reportTemplateSelection.pure.ts');
    expect(selection).not.toContain('safeGenerationInputs');
    expect(selection).not.toContain('market_fact_snapshot');
    expect(selection).not.toContain('activateSafeGenerationInputs');
  });

  it('18 — the activation never mutates its input, so no stored row is rewritten', () => {
    const input = { demographics: { ...GENERATED_DEMOGRAPHICS }, locationIntelligence: { ...LEGACY_LOCATION } };
    const before = JSON.stringify(input);
    activate(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('18b — the migration is additive only', () => {
    const migration = read('supabase/migrations/20261119100000_report_market_fact_snapshot.sql');
    expect(migration).not.toMatch(/DROP\s+(COLUMN|TABLE)/i);
  });

  it('19 — F1 is stored at the grain of the fact, so the reader window still holds', () => {
    // The service reads a four-year window capped at 1,000 rows. F1 is daily:
    // stored whole it would evict every monthly and quarterly observation and
    // the macro reading would go quiet with nothing reporting it.
    expect(RBA_PERSIST_POLICY['f1']).toBe('target-changes-and-latest');
    expect(RBA_PERSIST_POLICY['f1.1']).toBe('all');
    expect([...RBA_WANTED_SERIES['f1']]).toEqual(['FIRMMCRTD', 'FIRMMCCRT']);

    const daily = Array.from({ length: 400 }, (_, i) => ({
      date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`.slice(0, 10),
      value: 4.35,
    }));
    const parsed = {
      tableCode: 'f1' as const,
      tableTitle: 'F1 INTEREST RATES AND YIELDS – MONEY MARKET',
      publicationDate: '11-Sep-2026',
      series: [
        { id: 'FIRMMCRTD', title: 'Cash Rate Target', description: null, frequency: 'Daily', units: 'Per cent', source: 'RBA', observations: daily },
        { id: 'FIRMMCCRT', title: 'Change', description: null, frequency: 'as announced', units: 'Per cent', source: 'RBA', observations: [{ date: '2026-01-05', value: 0.25 }] },
      ],
    };
    const kept = observationsToPersist(parsed);
    const target = kept.series.find((s) => s.id === 'FIRMMCRTD')!;
    expect(target.observations.length).toBeLessThan(daily.length);
    // The announced change and the latest date, and nothing else.
    expect(target.observations.map((o) => o.date)).toContain('2026-01-05');
  });
});

// ---------------------------------------------------------------------------
// 11-12. The market-claim audit: right number, wrong label
// ---------------------------------------------------------------------------

describe('11-12 — the narrative is reconciled on grain, period and source', () => {
  const POA_FACT = {
    name: 'market.population', status: 'present' as const, value: 18234,
    source: 'abs_census_poa', dataset: 'abs_census_poa', grain: 'postcode',
    geographyId: '3338', referencePeriod: '2021 Census', asOf: '2021', ruling: 'ok',
  };
  const MONTHLY_FACT = {
    name: 'market.cashRateTargetMonthlyAverage', status: 'present' as const, value: 4.35,
    source: 'rba_observations', dataset: 'RBA statistical table F1.1 — Cash Rate Target; monthly average',
    grain: 'national', geographyId: null, referencePeriod: 'August 2026 (monthly average)',
    asOf: '01-Sep-2026', ruling: 'ok',
  };

  it('11 — a postal-area figure described as a suburb figure is a grain fault', () => {
    const faults = auditMarketClaims("The suburb's population of 18,234 supports demand.", [POA_FACT]);
    expect(faults.map((f) => f.kind)).toContain('grain');
    expect(faults[0].supported).toContain('3338');
  });

  it('11b — a 2021 Census figure called current is a period fault', () => {
    const faults = auditMarketClaims('The current population is 18,234 people.', [POA_FACT]);
    expect(faults.map((f) => f.kind)).toContain('period');
  });

  it('11c — a monthly average called the rate in force is a source fault', () => {
    const faults = auditMarketClaims('The current cash rate of 4.35% shapes borrowing.', [MONTHLY_FACT]);
    expect(faults.map((f) => f.kind)).toContain('source');
  });

  it('12 — correctly-labelled prose raises nothing', () => {
    const clean = 'Across postal area 3338 the 2021 Census counted 18,234 residents. '
      + 'The cash rate target averaged 4.35% over August 2026.';
    expect(auditMarketClaims(clean, [POA_FACT, MONTHLY_FACT])).toEqual([]);
  });

  it('12b — an absent fact has no value to audit, and empty prose is not a fault', () => {
    expect(auditMarketClaims('', [POA_FACT])).toEqual([]);
    expect(auditMarketClaims('anything at all', [{ ...POA_FACT, status: 'absent' as const, value: null }])).toEqual([]);
  });

  it('12c — one finding per fact per kind, so the flag list stays readable', () => {
    const repeated = Array.from({ length: 8 }, () => "the suburb's 18,234 residents").join(' ');
    const faults = auditMarketClaims(repeated, [POA_FACT]);
    expect(faults.filter((f) => f.kind === 'grain')).toHaveLength(1);
  });

  it('12d — it is wired into the generator and only disclosed, never blocking', () => {
    const src = stripComments(read(GENERATOR));
    expect(src).toContain('auditMarketClaims(reportContent, safeGeneration.snapshot.facts)');
    expect(src).toContain('...claimFlags,');
    // A finding must not abort generation.
    expect(src).not.toMatch(/claimFaults\.length[^\n]*throw/);
  });
});

// ---------------------------------------------------------------------------
// RF-7.2B.1 corrections — the semantic-integrity pass
// ---------------------------------------------------------------------------

describe('C1 — the four cash-rate facts are distinct', () => {
  const meta = [{
    series_id: 'FIRMMCRTD', table_code: 'f1', title: 'Cash Rate Target',
    description: 'Cash Rate Target on date', units: 'Per cent', publication_date: '11-Sep-2026',
  }];
  const f1 = [
    { series_id: 'FIRMMCRTD', obs_date: '2026-05-06', value: 4.35 },
    { series_id: 'FIRMMCRTD', obs_date: '2026-09-10', value: 4.35 },
  ];
  // The RBA's own published history: a change, then two holds.
  const DECISIONS = [
    { effective_date: '2026-02-04', change_points: 0.25, target_percent: 3.85 },
    { effective_date: '2026-03-18', change_points: 0.25, target_percent: 4.10 },
    { effective_date: '2026-05-06', change_points: 0.25, target_percent: 4.35 },
    { effective_date: '2026-06-17', change_points: 0, target_percent: 4.35 },
    { effective_date: '2026-08-12', change_points: 0, target_percent: 4.35 },
  ];

  it('an unchanged Board decision after the last change sets the EFFECTIVE date', () => {
    const t = cashRateTargetOf(meta as never, f1 as never, DECISIONS as never)!;
    expect(t.percent).toBe(4.35);
    expect(t.effectiveDate).toBe('2026-08-12');      // most recent decision
    expect(t.lastChangedDate).toBe('2026-05-06');    // when it last MOVED
    expect(t.lastChangePoints).toBe(0.25);
    expect(t.decisionsSinceChange).toBe(2);          // 17 Jun and 12 Aug
  });

  it('the effective date is NEVER the last non-zero change when holds follow it', () => {
    const t = cashRateTargetOf(meta as never, f1 as never, DECISIONS as never)!;
    expect(t.effectiveDate).not.toBe(t.lastChangedDate);
  });

  it('with no hold since the change, effective and last-changed coincide', () => {
    const upTo = DECISIONS.slice(0, 3);
    const t = cashRateTargetOf(meta as never, f1 as never, upTo as never)!;
    expect(t.effectiveDate).toBe('2026-05-06');
    expect(t.lastChangedDate).toBe('2026-05-06');
    expect(t.decisionsSinceChange).toBe(0);
  });

  it('a history of holds alone cannot say when the rate moved, so it refuses', () => {
    const holdsOnly = DECISIONS.filter((d) => d.change_points === 0);
    expect(cashRateTargetOf(meta as never, f1 as never, holdsOnly as never)).toBeNull();
  });

  it('F1 disagreeing with the decision history is refused, never averaged', () => {
    const wrongF1 = [{ series_id: 'FIRMMCRTD', obs_date: '2026-09-10', value: 3.10 }];
    expect(cashRateTargetOf(meta as never, wrongF1 as never, DECISIONS as never)).toBeNull();
  });

  it('the decision history alone is sufficient — F1 is a cross-check, not the authority', () => {
    const t = cashRateTargetOf([] as never, [] as never, DECISIONS as never)!;
    expect(t.percent).toBe(4.35);
    expect(t.effectiveDate).toBe('2026-08-12');
    expect(t.asAtDate).toBeNull();
  });

  it('the parser refuses a history with no unchanged decision at all', () => {
    // That source would be F1 by another name, and would reintroduce the bug.
    const rows = DECISIONS.map((d) => `<tr><td>1 Jan 2020</td><td>+0.25</td><td>${d.target_percent}</td></tr>`).join('');
    const page = `<table><tr><th>Effective Date</th><th>Change % points</th><th>Cash rate target %</th></tr>${rows}</table>`;
    expect(() => parseCashRateDecisions(page)).toThrow();
  });
});

describe('C2 — the snapshot carries the actual values, not a marker', () => {
  const DEMOGRAPHICS = {
    population: { total: 18234 },
    income: { medianAge: 34, medianHouseholdIncome: 96000, medianWeeklyIncome: 1846, unemploymentRate: 4.2 },
    employment: { laborForce: 9100, laborForceParticipation: 62.4, employmentRate: 95.8 },
    dataSource: 'ABS Census 2021 (POA 3338)', dataQuality: 'census', referencePeriod: '2021',
  };

  it('every narrated ABS metric gets its own fact, with its own value', () => {
    const facts = activate({ demographics: DEMOGRAPHICS }).snapshot.facts;
    const byName = new Map(facts.map((f) => [f.name, f]));
    expect(byName.get('abs.population')?.value).toBe(18234);
    expect(byName.get('abs.medianAge')?.value).toBe(34);
    expect(byName.get('abs.medianHouseholdIncomeAnnual')?.value).toBe(96000);
    expect(byName.get('abs.unemploymentRate')?.value).toBe(4.2);
    expect(byName.get('abs.labourForce')?.value).toBe(9100);
    expect(byName.get('abs.employmentRate')?.value).toBe(95.8);
  });

  it('each carries source, dataset, grain, geography id, period and ruling', () => {
    const fact = activate({ demographics: DEMOGRAPHICS })
      .snapshot.facts.find((f) => f.name === 'abs.population')!;
    expect(fact.source).toBe('abs_census_poa');
    expect(fact.dataset).toBe('abs_census_poa');
    expect(fact.grain).toBe('postcode');
    expect(fact.geographyId).toBe('3338');
    expect(fact.referencePeriod).toBe('2021 Census');
    expect(fact.ruling).not.toBe('');
  });

  it('the RBA facts are individually snapshotted too', () => {
    const names = activate({}).snapshot.facts.map((f) => f.name);
    expect(names).toContain('market.cashRateTargetCurrent');
    expect(names).toContain('market.cashRateTargetEffectiveDate');
    expect(names).toContain('market.cashRateTargetLastChangedDate');
    expect(names).toContain('market.cashRateTargetLastChangePoints');
  });

  it('the effective and last-changed dates are stored as SEPARATE values', () => {
    const byName = new Map(activate({}).snapshot.facts.map((f) => [f.name, f]));
    expect(byName.get('market.cashRateTargetEffectiveDate')?.value).toBe('2026-08-12');
    expect(byName.get('market.cashRateTargetLastChangedDate')?.value).toBe('2026-05-06');
    expect(byName.get('market.cashRateTargetLastChangePoints')?.value).toBe(0.25);
  });

  it('a reader can reconstruct the narrative basis without re-querying', () => {
    // Every present fact names what it is, where it came from and when it was measured.
    for (const f of activate({ demographics: DEMOGRAPHICS }).snapshot.facts) {
      if (f.status !== 'present') continue;
      expect(f.source, f.name).not.toBeNull();
      expect(f.dataset, f.name).not.toBeNull();
    }
  });
});

describe('C3 — ABS data must describe the SUBJECT property', () => {
  const forPoa = (poa: string) => ({
    population: { total: 18234 },
    dataSource: `ABS Census 2021 (POA ${poa})`, dataQuality: 'census', referencePeriod: '2021',
  });

  it('a matching POA is admitted', () => {
    const r = activate({ demographics: forPoa('3338') }, TARGET_READING, { status: 'resolved', postcode: '3338' });
    expect(r.demographicsKept).toBe(true);
  });

  it('a WRONG POA is blocked — the adversarial case', () => {
    // Subject in 3024, genuine ABS data for 3338: real, authoritative, and
    // about somebody else's suburb.
    const r = activate({ demographics: forPoa('3338') }, TARGET_READING, { status: 'resolved', postcode: '3024' });
    expect(r.demographicsKept).toBe(false);
    expect(r.enhancedData.demographics).toBeUndefined();
    expect(r.demographicsRuling).toContain('3338');
    expect(r.demographicsRuling).toContain('3024');
    expect(r.demographicsRuling).toMatch(/not estimated, synthesised or borrowed/i);
  });

  it('SEIFA is withheld on the same geography ground', () => {
    const r = activate(
      { demographics: forPoa('3338'), seifaData: { irsad: { score: 1010, decile: 6 } } },
      TARGET_READING,
      { status: 'resolved', postcode: '3024' },
    );
    expect(r.enhancedData.seifaData).toBeUndefined();
    expect(r.removed.map((x) => x.path)).toContain('seifaData');
  });

  it('untrusted geography withholds rather than vouches', () => {
    for (const status of ['requires_review', 'unresolved', undefined]) {
      const r = activate({ demographics: forPoa('3338') }, TARGET_READING, { status, postcode: '3338' });
      expect(r.demographicsKept, String(status)).toBe(false);
    }
  });

  it('no geography at all withholds, and says which absence it is', () => {
    const r = activate({ demographics: forPoa('3338') }, TARGET_READING, null);
    expect(r.demographicsKept).toBe(false);
    expect(r.demographicsRuling).toMatch(/no trusted resolved postcode/i);
  });

  it('the generator supplies the trusted row rather than its own postcode', () => {
    const src = stripComments(read(GENERATOR));
    expect(src).toContain("from('report_geography')");
    expect(src).toContain('geography: subjectGeography');
  });
});

describe('C4 — a market-claim fault affects client readiness', () => {
  it('faults are raised in the severity vocabulary the QA page counts', () => {
    const src = read('supabase/functions/_shared/reports/contract/marketClaimAudit.pure.ts');
    expect(src).toContain("severity: 'high'");
    expect(src).not.toContain("severity: 'warning'");
  });

  it('and land in validation_flags, which is what splits clean from flagged', () => {
    const gen = stripComments(read(GENERATOR));
    expect(gen).toContain('...claimFlags,');
    // The existing readiness mechanism: any flag at all moves a report out of
    // `cleanReports`. Pinned here so a refactor of that page cannot quietly
    // make these faults client-ready again.
    const qa = read('src/pages/QualityAssurance.tsx');
    expect(qa).toContain('validation_flags');
    expect(qa).toMatch(/cleanReports\s*=\s*reports\.filter/);
  });
});

describe('C6 — the legacy scorer is untouched and cannot become client authority', () => {
  // The boundary itself is proven by `scoringInputPolicy.spec.ts`; these are
  // the minimum integration assertions that RF-7.2B.1 left it standing.
  it('production scoring authority is still "unavailable"', () => {
    expect(PRODUCTION_SCORING_AUTHORITY).toBe('unavailable');
  });

  it('no overall grade may be published under it', () => {
    expect(mayPublishOverallGrade(PRODUCTION_SCORING_AUTHORITY)).toBe(false);
  });

  it('no dimension assessment may be published under it', () => {
    expect(mayPublishDimensionScores(PRODUCTION_SCORING_AUTHORITY)).toBe(false);
  });

  it('this phase changed neither the scorer nor the policy', () => {
    // The gate deliberately runs AFTER scoring, so the engine still reads the
    // disowned fields — and cannot publish anything from them.
    const engine = read('supabase/functions/_shared/investmentScoreEngine.ts');
    expect(engine).not.toContain('safeGenerationInputs');
    expect(engine).not.toContain('activateSafeGenerationInputs');
    const policy = read('supabase/functions/_shared/reports/market/scoringInputPolicy.pure.ts');
    expect(policy).not.toContain('safeGenerationInputs');
  });
});

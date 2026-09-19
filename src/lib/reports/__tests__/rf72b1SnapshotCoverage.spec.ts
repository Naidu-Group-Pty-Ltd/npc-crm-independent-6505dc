/**
 * RF-7.2B.1 §C5 — narrated implies snapshotted.
 *
 * > Any market fact admitted to a narrative prompt must have a corresponding
 * > snapshot fact unless explicitly classified as non-snapshotted static copy.
 *
 * The point of the rule is future additions. A new figure added to a prompt
 * block is a figure a client will read, and `market_fact_snapshot` exists so a
 * reader can establish months later exactly which values a document was
 * written from. Those two facts drift the moment someone adds a row to a table
 * and nothing complains — which is precisely what had already happened twice
 * when this probe was first run.
 *
 * ## How it is enforced
 *
 * By measurement, not by reading the code. Every leaf number in a
 * production-shaped payload is stamped with a unique value, the REAL gate runs
 * over it, the REAL prompt blocks are composed from the sanitised object, and
 * every stamp that appears in the prose is looked for in the snapshot.
 *
 * A source scan was the obvious alternative and is not equivalent: the prompt
 * blocks read through local aliases (`emp['laborForce']` where `emp` is
 * `input.demographics?.employment`), so a scanner would have to resolve them,
 * and a scanner that is 90% right on that is worse than no scanner.
 *
 * ## What it found
 *
 * Two real gaps, on the first run, both now closed:
 *
 *  - the four **SEIFA deciles** — `seifaTable` prints score AND decile, and a
 *    decile is a separately published figure rather than a rounding of the
 *    score beside it, so it could not be re-derived;
 *  - **`decisionsSinceChange`** — the macro table prints "unchanged at 2 Board
 *    decisions since", and nothing recorded the 2.
 *
 * ## What it deliberately does not cover
 *
 * Crime, climate, planning and regional trends each reach the prompt through
 * their own block carrying their own provenance, and RF-7.2B.1's snapshot is
 * scoped to the ABS / SEIFA / RBA facts this phase took authority for. They
 * are named here rather than omitted — extending the snapshot to them is a
 * carry-forward, recorded in RF72B1_FORWARD_SAFE_ACTIVATION.md §10.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  activateSafeGenerationInputs,
  NON_SNAPSHOTTED_NARRATIVE_PATHS,
} from '../contract/safeGenerationInputs.pure';
import { demographicsStatBlocks } from '../../../../supabase/functions/_shared/reports/censusPromptBlocks.pure';
import { macroEconomicBlock } from '../../../../supabase/functions/_shared/reports/macroPromptBlocks.pure';

/** The blocks whose figures this phase's snapshot is the record for. */
const COVERED_BLOCKS = ['censusPromptBlocks (ABS + SEIFA)', 'macroPromptBlocks (RBA)'] as const;

/** Named, not omitted — see the header. */
const UNCOVERED_BLOCKS = [
  'crimePromptBlocks', 'climatePromptBlocks', 'planningPromptBlocks', 'regionalPromptBlocks',
] as const;

const SOURCE = 'ABS Census 2021 (POA 3338)';
const STAMP = { dataQuality: 'census', referencePeriod: '2021', source: SOURCE };

/**
 * A payload carrying every field the covered blocks can read. Shaped from
 * `censusDemographicsResponse` and `cashRateTargetOf`, because a fixture in a
 * vocabulary production does not use proves nothing.
 */
const TEMPLATE = {
  demographics: {
    dataSource: SOURCE, dataQuality: 'census', referencePeriod: '2021',
    population: { total: 1, ...STAMP },
    income: {
      medianAge: 1, medianHouseholdIncome: 1, medianWeeklyIncome: 1,
      medianHouseholdIncomeWeekly: 1, medianPersonalIncomeWeekly: 1,
      unemploymentRate: 1, ...STAMP,
    },
    employment: {
      laborForce: 1, laborForceParticipation: 1, employmentRate: 1,
      employmentToPopulationRate: 1, professionalOccupations: 1,
      managerialOccupations: 1, ...STAMP,
    },
    housing: {
      ownerOccupierRate: 1, renterRate: 1, medianRent: 1,
      medianMortgageMonthly: 1, averageHouseholdSize: 1, ...STAMP,
    },
  },
  seifaData: {
    referencePeriod: '2021',
    irsad: { score: 1, decile: 1, description: 'Mid-range' },
    irsd: { score: 1, decile: 1, description: 'Mid-range' },
    ier: { score: 1, decile: 1, description: 'Mid-range' },
    ieo: { score: 1, decile: 1, description: 'Mid-range' },
  },
  employmentData: {
    employmentRate: 1, unemploymentRate: 1, participationRate: 1, laborForceSize: 1,
    majorIndustries: [
      { name: 'Health Care and Social Assistance', percentage: 1 },
      { name: 'Retail Trade', percentage: 1 },
    ],
  },
  economics: {
    cashRateTarget: {
      percent: 1,
      effectiveDate: '2026-08-12', effectiveLabel: '12 August 2026',
      lastChangedDate: '2026-05-06', lastChangedLabel: '6 May 2026',
      lastChangePoints: 1, decisionsSinceChange: 1,
      asAtLabel: '10 September 2026', seriesId: 'FIRMMCRTD', tableCode: 'f1',
      publicationDate: '11-Sep-2026',
      effectiveDateSource: 'RBA Cash Rate Target decision history',
    },
    cashRate: { current: 1, source: 'RBA statistical table F1.1', publicationDate: '11-Sep-2026' },
    inflation: { yearEnded: 1, source: 'RBA statistical table G1', publicationDate: '11-Sep-2026' },
  },
};

/** Replace every leaf number with a unique stamp, remembering its path. */
function stampLeaves(o: unknown, prefix: string, next: () => number,
                     paths: Map<number, string>): unknown {
  if (Array.isArray(o)) return o.map((v, i) => stampLeaves(v, `${prefix}[${i}]`, next, paths));
  if (o && typeof o === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      out[k] = stampLeaves(v, prefix ? `${prefix}.${k}` : k, next, paths);
    }
    return out;
  }
  if (typeof o === 'number') {
    const stamp = next();
    paths.set(stamp, prefix);
    return stamp;
  }
  return o;
}

interface Coverage {
  /** Stamps that reached the prose, by the path they came from. */
  readonly narrated: ReadonlyMap<string, number>;
  /** Snapshot fact values, by fact name. */
  readonly snapshotted: ReadonlyMap<string, unknown>;
}

function measure(): Coverage {
  const paths = new Map<number, string>();
  let counter = 900_000;
  const payload = stampLeaves(TEMPLATE, '', () => (counter += 1), paths) as Record<string, unknown>;

  const result = activateSafeGenerationInputs({
    enhancedData: payload,
    geography: { status: 'resolved', postcode: '3338', suburb: 'Cobblebank', state: 'VIC' },
    // The SAME object the prompt will read. In production the generator passes
    // `enhancedData.economics.cashRateTarget`, so the snapshot and the macro
    // table cannot describe two different readings — asserted below.
    cashRateTarget: (payload.economics as Record<string, unknown>).cashRateTarget as never,
    cashRateMonthlyAverage: null,
    capturedAt: '2026-09-11T08:00:00.000Z',
  });

  const prose = [
    demographicsStatBlocks(result.enhancedData as never),
    macroEconomicBlock(result.enhancedData as never),
  ].join('\n');
  // Thousands separators are how these print; strip them before matching so a
  // stamp is not missed because the table wrote `900,001`.
  const flat = prose.replace(/,/g, '');

  const narrated = new Map<string, number>();
  for (const [stamp, path] of paths) {
    // Not inside a longer number: `900001` must not match `1900001`.
    if (new RegExp(`(?<![\\d.])${stamp}(?![\\d])`).test(flat)) narrated.set(path, stamp);
  }

  const snapshotted = new Map<string, unknown>();
  for (const fact of result.snapshot.facts) {
    if (fact.status === 'present') snapshotted.set(fact.name, fact.value);
  }
  return { narrated, snapshotted };
}

// ---------------------------------------------------------------------------

describe('C5 — every market fact in a narrative prompt is in the snapshot', () => {
  it('the probe actually reaches the prose (a silent zero would pass vacuously)', () => {
    const { narrated, snapshotted } = measure();
    expect(narrated.size).toBeGreaterThanOrEqual(19);
    expect(snapshotted.size).toBeGreaterThanOrEqual(19);
  });

  it('every narrated figure is recoverable from the stored snapshot', () => {
    const { narrated, snapshotted } = measure();
    const classified = new Set(NON_SNAPSHOTTED_NARRATIVE_PATHS.map((e) => e.path));
    const values = new Set(snapshotted.values());

    const unaccounted: string[] = [];
    for (const [path, stamp] of narrated) {
      if (classified.has(path)) continue;
      if (!values.has(stamp)) unaccounted.push(`${path} (printed as ${stamp})`);
    }

    // The message is the point: a future author who adds a row to a prompt
    // table should be told exactly which figure is unrecorded.
    expect(
      unaccounted,
      `These figures reach a client's page but not the record. Snapshot them, or `
      + `classify them in NON_SNAPSHOTTED_NARRATIVE_PATHS with a reason:\n  `
      + unaccounted.join('\n  '),
    ).toEqual([]);
  });

  it('the two gaps it found on its first run are closed', () => {
    const { snapshotted } = measure();
    for (const index of ['irsad', 'irsd', 'ier', 'ieo']) {
      expect(snapshotted.has(`abs.seifa.${index}`), index).toBe(true);
      expect(snapshotted.has(`abs.seifa.${index}Decile`), `${index} decile`).toBe(true);
    }
    expect(snapshotted.has('market.cashRateTargetDecisionsSinceChange')).toBe(true);
  });

  it('the snapshot and the macro table read ONE cash-rate reading', () => {
    const { narrated, snapshotted } = measure();
    // The stamp the table printed for the target IS the stamp the snapshot
    // stored. Two sources for one figure is how a record comes to disagree
    // with the document it is the record for.
    expect(snapshotted.get('market.cashRateTargetCurrent'))
      .toBe(narrated.get('economics.cashRateTarget.percent'));
    expect(snapshotted.get('market.cashRateTargetLastChangePoints'))
      .toBe(narrated.get('economics.cashRateTarget.lastChangePoints'));
    expect(snapshotted.get('market.cashRateTargetDecisionsSinceChange'))
      .toBe(narrated.get('economics.cashRateTarget.decisionsSinceChange'));
  });

  it('the escape hatch is empty, and any entry must carry a reason', () => {
    expect(NON_SNAPSHOTTED_NARRATIVE_PATHS).toEqual([]);
    for (const entry of NON_SNAPSHOTTED_NARRATIVE_PATHS) {
      expect(entry.reason.length, entry.path).toBeGreaterThan(20);
    }
  });

  it('the scope of this rule is declared rather than assumed', () => {
    expect(COVERED_BLOCKS).toHaveLength(2);
    expect(UNCOVERED_BLOCKS).toHaveLength(4);
  });

  it('a withheld fact narrates nothing, so it needs no snapshot value', () => {
    // The other direction of the same rule: the snapshot records the ABSENCE
    // with its reason, and no figure reaches the page to be unaccounted for.
    // Stamped, not the bare template — an unstamped payload makes this pass
    // whatever the gate does, which is how a vacuous assertion looks.
    const paths = new Map<number, string>();
    let counter = 900_000;
    const payload = stampLeaves(TEMPLATE, '', () => (counter += 1), paths) as Record<string, unknown>;

    const result = activateSafeGenerationInputs({
      enhancedData: payload,
      geography: null,
      cashRateTarget: (payload.economics as Record<string, unknown>).cashRateTarget as never,
      cashRateMonthlyAverage: null,
      capturedAt: '2026-09-11T08:00:00.000Z',
    });
    expect(result.demographicsKept).toBe(false);
    const absent = result.snapshot.facts.filter((f) => f.status === 'absent');
    expect(absent.length).toBeGreaterThan(0);
    for (const fact of absent) expect(fact.ruling.length).toBeGreaterThan(10);

    const prose = demographicsStatBlocks(result.enhancedData as never);
    for (const stamp of paths.keys()) expect(prose).not.toContain(String(stamp));
    expect(prose).toMatch(/unavailable for this postal area/i);
  });

  it('the employment payload is withheld on the same geography ground', () => {
    // The hole this probe found third: `industryTable` reads `employmentData`,
    // which is the SAME `abs_census_poa` row keyed on the SAME address-derived
    // postcode, and it prints INDEPENDENTLY of the population table. So a
    // report whose demographics were refused for describing the wrong postal
    // area still printed that area's industry mix under its own heading.
    const wrongArea = activateSafeGenerationInputs({
      enhancedData: TEMPLATE,
      geography: { status: 'resolved', postcode: '3024', suburb: 'Wyndham Vale', state: 'VIC' },
      cashRateTarget: null,
      cashRateMonthlyAverage: null,
      capturedAt: '2026-09-11T08:00:00.000Z',
    });
    expect(wrongArea.demographicsKept).toBe(false);
    const enhanced = wrongArea.enhancedData as Record<string, unknown>;
    expect(enhanced.demographics).toBeUndefined();
    expect(enhanced.seifaData).toBeUndefined();
    expect(enhanced.employmentData).toBeUndefined();
    expect(wrongArea.removed.map((r) => r.path)).toContain('employmentData');
    expect(demographicsStatBlocks(enhanced as never)).not.toContain('Industry');
  });

  it('and all three postal-area payloads are re-queried together', () => {
    // The other half of the same rule, at the other end of the pipe. Re-keying
    // demographics and SEIFA on the trusted POA while leaving employment on the
    // address-derived one would put a 3024 population table beside a 3338
    // industry mix on one page — which the gate would then ADMIT, because
    // `demographicsKept` is true.
    for (const fn of ['generate-investment-report', 'regenerate-report-qualitative']) {
      const src = readFileSync(
        resolve(__dirname, '../../../../supabase/functions', fn, 'index.ts'), 'utf-8');
      const block = src.slice(src.indexOf('const requery = async'));
      for (const service of ['abs-data-service', 'abs-seifa-service', 'abs-employment-service']) {
        expect(block.slice(0, 3000), `${fn} / ${service}`).toContain(`requery('${service}'`);
      }
      // The employment service also takes a suburb, and it must be the one the
      // BOUNDARY answered with — never the free-text suburb, which belongs to
      // the postcode we have just stopped believing.
      expect(block.slice(0, 3000), fn).toContain('subjectGeography?.suburb');
    }
  });
});

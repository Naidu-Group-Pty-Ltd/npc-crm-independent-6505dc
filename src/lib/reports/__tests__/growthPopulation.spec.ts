/**
 * ME-6 closure — the canonical Growth population, and the ME-7 entry gate.
 *
 * The reconciliation is pinned as ARITHMETIC over the real production route
 * counts rather than as prose, because "641 and 663 are the same predicate
 * with and without the land exclusion" is a claim, and a claim that nothing
 * executes is one that drifts back into ambiguity the next time somebody
 * counts.
 */
import { describe, it, expect } from 'vitest';
import {
  GROWTH_POPULATION_VERSION,
  isGrowthBacktestReady,
  resolveDwellingType,
  tallyGrowthPopulation,
  type GrowthCandidate,
  type GrowthReadiness,
} from '@/lib/reports/market/growthPopulation.pure';
import {
  ME7_GATE_VERSION,
  evaluateMe7Gate,
  mayServeSubjectGrowth,
  benchmarkOnly,
  SUBJECT_GROWTH_PRECEDENCE,
  DEMAND_PRECEDENCE,
  type StateCoverage,
} from '@/lib/reports/market/me7EntryGate.pure';
import {
  acquisitionOf,
  mayEnterProductionEvidence,
  type EvidencePoint,
} from '@/lib/reports/market/marketEvidence.pure';

const candidate = (over: Partial<GrowthCandidate> = {}): GrowthCandidate => ({
  reportId: 'r1',
  suburb: 'Parmelia',
  state: 'WA',
  postcode: '6167',
  propertySpecsType: 'House',
  financialCalcsType: null,
  siblingType: null,
  ...over,
});

describe('ME-6 closure — the 641 vs 663 reconciliation', () => {
  // Measured on 2026-09-09 over the 867 trusted-geography reports.
  const MEASURED = {
    trustedGeography: 867,
    propertySpecsResolved: 663,   // route 1, before the land exclusion
    landExcluded: 26,
    financialCalcsAdds: 15,       // route 2, all 'house'
    siblingAdds: 13,              // route 3
    siblingAddsInAudit624: 4,     // §62.4's figure, from a poorer pool
  };

  it('shows 663 and 641 as the same predicate, with and without the land exclusion', () => {
    const { propertySpecsResolved, landExcluded, siblingAddsInAudit624 } = MEASURED;
    // 663 — property_specs only, land INCLUDED. Too loose.
    expect(propertySpecsResolved).toBe(663);
    // 637 — the same, land excluded. §62.4's "before".
    expect(propertySpecsResolved - landExcluded).toBe(637);
    // 641 — plus §62.4's sibling recovery. Too narrow: one field only.
    expect(propertySpecsResolved - landExcluded + siblingAddsInAudit624).toBe(641);
  });

  it('reaches the canonical 665 by being both stricter and more complete', () => {
    const { propertySpecsResolved, landExcluded, financialCalcsAdds, siblingAdds } = MEASURED;
    const anyTypeResolved = propertySpecsResolved + financialCalcsAdds + siblingAdds;
    expect(anyTypeResolved).toBe(691);
    expect(anyTypeResolved - landExcluded).toBe(665);
    // Not "the larger one": it excludes 26 that 663 counted, and adds 28 that
    // 641 never looked for. Landing two above 663 is a coincidence of the two
    // independent corrections.
    expect(665).toBeGreaterThan(propertySpecsResolved);
    expect(665 - propertySpecsResolved).toBe(2);
  });

  it('pins the version so a manifest can name the rule that built it', () => {
    expect(GROWTH_POPULATION_VERSION).toBe('me7.pop.1');
  });
});

describe('ME-6 closure — isGrowthBacktestReady', () => {
  it('resolves by the three routes in precedence order', () => {
    expect(resolveDwellingType({
      propertySpecsType: 'Unit', financialCalcsType: 'House', siblingType: 'Land',
    })).toEqual({ value: 'unit', route: 'property_specs' });

    expect(resolveDwellingType({
      propertySpecsType: null, financialCalcsType: 'House', siblingType: 'Unit',
    })).toEqual({ value: 'house', route: 'financial_calculations' });

    expect(resolveDwellingType({
      propertySpecsType: null, financialCalcsType: null, siblingType: 'Townhouse',
    })).toEqual({ value: 'townhouse', route: 'sibling_canonical_key' });

    expect(resolveDwellingType({
      propertySpecsType: null, financialCalcsType: null, siblingType: null,
    })).toBeNull();
  });

  it('treats the generator placeholders as absent, never as a default', () => {
    // §62.5: the generator wrote 'Residential Property' whenever nothing was
    // known, which is indistinguishable from a type somebody established.
    for (const p of ['Residential Property', 'Other', 'Unknown', 'N/A', '  ']) {
      const r = isGrowthBacktestReady(candidate({ propertySpecsType: p }));
      expect(r.ready, p).toBe(false);
      expect(r.exclusionReason, p).toBe('dwelling_type_unresolved');
    }
  });

  it('falls THROUGH a placeholder to the next route rather than stopping on it', () => {
    // The bug in the first measurement: coalescing the raw values and then
    // testing for a placeholder never consults the second source.
    const r = isGrowthBacktestReady(candidate({
      propertySpecsType: 'Residential Property', financialCalcsType: 'House',
    }));
    expect(r.ready).toBe(true);
    expect(r.route).toBe('financial_calculations');
  });

  it('maps the stored vocabulary onto the two classes providers publish', () => {
    const houses = ['House', 'house_and_land'];
    const attached = ['Apartment', 'Unit', 'Townhouse', 'Villa', 'Duplex'];
    for (const t of houses) {
      expect(isGrowthBacktestReady(candidate({ propertySpecsType: t })).dwellingClass, t)
        .toBe('house');
    }
    for (const t of attached) {
      expect(isGrowthBacktestReady(candidate({ propertySpecsType: t })).dwellingClass, t)
        .toBe('attached');
    }
  });

  it('excludes land with its own reason — no dwelling means no dwelling series', () => {
    const r = isGrowthBacktestReady(candidate({ propertySpecsType: 'Land' }));
    expect(r.ready).toBe(false);
    expect(r.exclusionReason).toBe('dwelling_type_not_segmentable');
    // The type is still recorded: an exclusion says what it excluded.
    expect(r.dwellingType).toBe('land');
  });

  it('excludes an unmapped type rather than folding it into house', () => {
    const r = isGrowthBacktestReady(candidate({ propertySpecsType: 'Houseboat' }));
    expect(r.ready).toBe(false);
    expect(r.exclusionReason).toBe('dwelling_type_not_segmentable');
  });

  it('requires suburb and state, and does NOT require postcode', () => {
    expect(isGrowthBacktestReady(candidate({ suburb: null })).exclusionReason)
      .toBe('geography_absent');
    expect(isGrowthBacktestReady(candidate({ state: null })).exclusionReason)
      .toBe('geography_absent');
    // Postcode is a provider refinement, not a condition. Measured: 0 of the
    // 663 lack one, so requiring it changes no count today and could exclude a
    // legitimate report later.
    expect(isGrowthBacktestReady(candidate({ postcode: null })).ready).toBe(true);
  });

  it('reads nothing outside geography and dwelling type', () => {
    // The predicate's whole input surface. If LVR, rent, cash flow or risk
    // ever appear here, Growth readiness has quietly become composite
    // readiness and the denominator stops meaning what it says.
    const keys = Object.keys(candidate()).sort();
    expect(keys).toEqual([
      'financialCalcsType', 'postcode', 'propertySpecsType',
      'reportId', 'siblingType', 'state', 'suburb',
    ]);
  });

  it('tallies a population by state, class and route', () => {
    const rows: GrowthReadiness[] = [
      isGrowthBacktestReady(candidate({ reportId: 'a', state: 'QLD', propertySpecsType: 'House' })),
      isGrowthBacktestReady(candidate({ reportId: 'b', state: 'QLD', propertySpecsType: 'Unit' })),
      isGrowthBacktestReady(candidate({ reportId: 'c', state: 'WA', propertySpecsType: 'Land' })),
      isGrowthBacktestReady(candidate({
        reportId: 'd', state: 'WA', propertySpecsType: null, financialCalcsType: 'House',
      })),
    ];
    const t = tallyGrowthPopulation(rows);
    expect(t.considered).toBe(4);
    expect(t.ready).toBe(3);
    expect(t.byState).toEqual({ QLD: 2, WA: 1 });
    expect(t.byClass).toEqual({ house: 2, attached: 1 });
    expect(t.byRoute.property_specs).toBe(2);
    expect(t.byRoute.financial_calculations).toBe(1);
    expect(t.excluded.dwelling_type_not_segmentable).toBe(1);
  });
});

describe('ME-6 closure — evidence precedence', () => {
  it('puts unavailable last in both orderings, never a substitute value', () => {
    expect(SUBJECT_GROWTH_PRECEDENCE.at(-1)).toBe('unavailable');
    expect(DEMAND_PRECEDENCE.at(-1)).toBe('unavailable');
  });

  it('refuses ABS regional/state series as SUBJECT Growth', () => {
    // A state mean price is identical for hundreds of properties; using it as
    // the subject's own Growth is how a score comes to rest on nothing about
    // the suburb.
    for (const p of benchmarkOnly()) {
      expect(mayServeSubjectGrowth(p), p).toBe(false);
    }
    expect(mayServeSubjectGrowth('abs_res_dwell_st')).toBe(false);
    expect(mayServeSubjectGrowth('domain')).toBe(true);
    expect(mayServeSubjectGrowth('proptrack')).toBe(true);
  });

  it('has no benchmark tier inside the subject-growth ordering', () => {
    for (const tier of SUBJECT_GROWTH_PRECEDENCE) {
      expect(benchmarkOnly()).not.toContain(tier);
    }
  });
});

describe('ME-6 closure — the ME-7 entry gate', () => {
  const cover = (state: string, covered: number): StateCoverage =>
    ({ state, population: 100, covered, classes: covered ? ['house'] : [] });

  const open = {
    populationVersion: 'me7.pop.1',
    populationSealed: true,
    coverage: [cover('QLD', 40), cover('WA', 20), cover('VIC', 10)],
    acquisitions: ['existing_licensed'] as const,
    snapshotSealed: true,
  };

  it('opens when the population is sealed and QLD and WA are both covered', () => {
    const v = evaluateMe7Gate({ ...open, acquisitions: [...open.acquisitions] });
    expect(v.mayBegin).toBe(true);
    expect(v.blockers).toEqual([]);
  });

  it('refuses a VIC/NSW-only sample, naming why', () => {
    const v = evaluateMe7Gate({
      ...open, acquisitions: [...open.acquisitions],
      coverage: [cover('VIC', 30), cover('NSW', 10), cover('QLD', 0), cover('WA', 0)],
    });
    expect(v.mayBegin).toBe(false);
    expect(v.blockers.join(' ')).toMatch(/QLD/);
    expect(v.blockers.join(' ')).toMatch(/WA/);
    expect(v.blockers.join(' ')).toMatch(/representative/i);
  });

  it('refuses an unsealed population and an unsealed snapshot', () => {
    expect(evaluateMe7Gate({ ...open, acquisitions: [...open.acquisitions], populationSealed: false })
      .blockers.join(' ')).toMatch(/population manifest is not sealed/);
    expect(evaluateMe7Gate({ ...open, acquisitions: [...open.acquisitions], snapshotSealed: false })
      .blockers.join(' ')).toMatch(/not sealed.*reproducible/);
  });

  it('refuses when every source is behind an unpurchased upgrade', () => {
    const v = evaluateMe7Gate({
      ...open, acquisitions: ['commercial_upgrade_required'],
    });
    expect(v.mayBegin).toBe(false);
    expect(v.blockers.join(' ')).toMatch(/unpurchased upgrade/);
  });

  it('opens on trial evidence — shadow work is what a trial is for', () => {
    const v = evaluateMe7Gate({ ...open, acquisitions: ['trial_shadow_only'] });
    expect(v.mayBegin).toBe(true);
  });

  it('does NOT require full coverage, a complete Demand set, or Victoria', () => {
    const notRequired = evaluateMe7Gate({ ...open, acquisitions: [...open.acquisitions] }).notRequired.join(' ');
    expect(notRequired).toMatch(/100% corpus coverage/);
    expect(notRequired).toMatch(/complete Demand/);
    expect(notRequired).toMatch(/Victoria/);
    // Proven, not just asserted: a sample with no VIC still opens.
    expect(evaluateMe7Gate({
      ...open, acquisitions: [...open.acquisitions],
      coverage: [cover('QLD', 40), cover('WA', 20)],
    }).mayBegin).toBe(true);
    expect(ME7_GATE_VERSION).toBe('me7.gate.1');
  });
});

describe('ME-6 closure — provider name never overrides acquisition footing', () => {
  const point = (over: Partial<EvidencePoint<number>>): EvidencePoint<number> => ({
    value: 1, level: 'suburb', areaName: 'Gosnells', dwellingType: 'house',
    dwellingTypeMatched: true, provider: 'abs_res_dwell', asOf: '2026-Q2',
    sampleSize: null, periodsAvailable: null, method: 'observed', sourceNote: null,
    ...over,
  });

  it('does not infer an open footing from an open-data provider name', () => {
    // ABS is open data, and that is a fact about ABS — not about whether THIS
    // point was obtained on a footing anybody recorded.
    expect(acquisitionOf(point({ provider: 'abs_res_dwell' }))).toBe('licensing_unverified');
    expect(mayEnterProductionEvidence(point({ provider: 'abs_res_dwell' }))).toBe(false);
  });

  it('lets the same provider carry different footings on different points', () => {
    const trial = point({ provider: 'proptrack', acquisition: 'trial_shadow_only' });
    const licensed = point({ provider: 'proptrack', acquisition: 'existing_licensed' });
    expect(mayEnterProductionEvidence(trial)).toBe(false);
    expect(mayEnterProductionEvidence(licensed)).toBe(true);
  });

  it('does not let the point\'s shape stand in for a footing', () => {
    // A fully populated, high-quality point with no declared footing is still
    // not production evidence. Completeness is not permission.
    const rich = point({ sampleSize: 400, periodsAvailable: 20, sourceNote: 'full series' });
    expect(mayEnterProductionEvidence(rich)).toBe(false);
  });
});

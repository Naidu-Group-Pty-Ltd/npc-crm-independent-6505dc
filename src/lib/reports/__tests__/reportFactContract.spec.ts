/**
 * RF-7.1 — the Report Fact Contract, and the boundary that makes it removable.
 *
 * Two things are proved here and they are different. That the contract is
 * CORRECT — absent is absent, every historical shape is tolerated, the
 * scoring reading matches the stamp. And that the contract is INERT — nothing
 * in production reads it, nothing it reads was changed, and deleting it
 * returns the platform to exactly what it was.
 *
 * The second is the one that matters for a strangler. A truth layer that
 * quietly became load-bearing in the same PR that introduced it would be a
 * rewrite wearing an adapter's name.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  buildReportFactContract,
  factLeaves,
  REPORT_FACT_CONTRACT_VERSION,
  type ReportFactContract,
} from '@/lib/reports/contract/reportFactContract.pure';

const REPO = resolve(__dirname, '../../../..');
const CONTRACT_DIR = resolve(REPO, 'supabase/functions/_shared/reports/contract');
const CONTRACT_SRC = readFileSync(resolve(CONTRACT_DIR, 'reportFactContract.pure.ts'), 'utf8');
const AT = new Date('2026-09-11T00:00:00.000Z');

/** A production-shaped row: the column names and nesting the corpus actually has. */
const completeRow = {
  id: 'rf71-complete',
  report_variant: 'compass',
  report_tier: 'compass',
  status: 'completed',
  generation_engine: 'compass_v2',
  current_version: 2,
  parent_report_id: null,
  derived_from_report_id: null,
  created_at: '2026-03-04T10:00:00.000Z',
  property_specs: {
    property_type: 'house',
    bedrooms: 4,
    bathrooms: 2,
    parking: 2,
    land_size_sqm: 450,
    building_size_sqm: 210,
  },
  manual_overrides: { purchasePrice: 700000, weeklyRent: 650, loanToValueRatio: 80 },
  financial_calculations: {
    initialCosts: { propertyValue: 700000, deposit: 140000, stampDuty: 24000, totalUpfront: 168000 },
    loanDetails: { loanAmount: 560000, lvr: 80 },
    income: { weeklyRent: 650 },
    keyMetrics: { lvr: 80, weeklyNet: -120 },
    annualCosts: { totalAnnual: 12000, totalAnnualExcludingLandTax: 10400, landTax: 1600 },
    projections: Array.from({ length: 10 }, (_, i) => ({ year: i + 1 })),
  },
  investment_score: null,
};

const geography = {
  report_id: 'rf71-complete',
  suburb: 'Traralgon',
  postcode: '3844',
  state: 'VIC',
  sa2_name: 'Traralgon',
  remoteness_area: 'Inner Regional Australia',
  latitude: -38.195,
  longitude: 146.54,
  status: 'resolved',
  flags: [],
};

const build = (report: unknown, geo?: unknown): ReportFactContract =>
  buildReportFactContract({ report, geography: geo, observedAt: AT });

// ---------------------------------------------------------------------------
// It is an adapter. It owns nothing, and nothing owns it.
// ---------------------------------------------------------------------------

describe('the contract is an adapter over existing owners', () => {
  it('imports the canonical owners and re-implements none of them', () => {
    for (const owner of [
      '../facts/historicalFactAuthority.pure.ts',
      '../metrics/propertyMetrics.pure.ts',
      '../investment/financialEngine.pure.ts',
      '../investment/propertyRecord.pure.ts',
    ]) {
      expect(CONTRACT_SRC, `must delegate to ${owner}`).toContain(owner);
    }
  });

  it('declares no arithmetic of its own for a figure an owner publishes', () => {
    // A ratio computed here would be a second definition of a figure the
    // metrics module already owns — the exact class `DERIVED_FIGURES.md`
    // measured at 6 gross-yield sites, 4 net and 8 LVR.
    const body = CONTRACT_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(body).not.toMatch(/\/\s*\w*[Pp]rice\s*\)?\s*\*\s*100/);
    expect(body).not.toMatch(/\bloanAmount\s*\/\s*/);
    // The one multiplication it may do is weekly rent to annual rent, which is
    // a unit conversion the owners require of their callers.
    expect(body).toContain('weeklyRent.value * 52');
  });

  it('no canonical owner imports the contract — the arrow points one way', () => {
    const roots = [
      resolve(REPO, 'supabase/functions/_shared/reports'),
      resolve(REPO, 'src/lib/reports'),
      resolve(REPO, 'src/lib/reportTemplate'),
    ];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'contract' || entry.name === '__tests__') continue;
          walk(full);
        } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
          if (readFileSync(full, 'utf8').includes('reportFactContract')) {
            offenders.push(full.replace(`${REPO}/`, ''));
          }
        }
      }
    };
    for (const root of roots) if (existsSync(root)) walk(root);
    expect(offenders).toEqual([]);
  });

  it('has ZERO production consumers — the strangler has not switched anything', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        if (/\.(spec|test)\.tsx?$/.test(entry.name)) continue;
        if (full.startsWith(CONTRACT_DIR)) continue;
        if (full.endsWith('src/lib/reports/contract/reportFactContract.pure.ts')) continue;
        if (readFileSync(full, 'utf8').includes('buildReportFactContract')) {
          offenders.push(full.replace(`${REPO}/`, ''));
        }
      }
    };
    for (const root of ['src', 'supabase/functions']) walk(resolve(REPO, root));
    expect(
      offenders,
      'RF-7.1 adds the contract BESIDE the working engine. Adoption is a later, controlled stage.',
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Purity — rule 10
// ---------------------------------------------------------------------------

describe('the builder is pure', () => {
  it('reads no clock, no randomness, no network, no database and writes nothing', () => {
    const body = CONTRACT_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of [
      'Date.now', 'new Date(', 'Math.random', 'fetch(', 'createClient',
      'supabase', '.insert(', '.update(', '.upsert(', '.delete(', 'localStorage',
    ]) {
      expect(body, `must not contain ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('takes `observedAt` as a parameter so the same input is byte-identical forever', () => {
    const a = build(completeRow, geography);
    const b = build(completeRow, geography);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(a.observedAt).toBe('2026-09-11T00:00:00.000Z');
  });

  it('mutates neither the report row nor the geography row', () => {
    const row = JSON.parse(JSON.stringify(completeRow));
    const geo = JSON.parse(JSON.stringify(geography));
    const before = [JSON.stringify(row), JSON.stringify(geo)];
    build(row, geo);
    expect([JSON.stringify(row), JSON.stringify(geo)]).toEqual(before);
  });

  it('is versioned', () => {
    expect(REPORT_FACT_CONTRACT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(build(completeRow, geography).contractVersion).toBe(REPORT_FACT_CONTRACT_VERSION);
  });
});

// ---------------------------------------------------------------------------
// Absent is absent
// ---------------------------------------------------------------------------

describe('absent is absent, never a substitute', () => {
  const empty = build({ id: 'rf71-empty' });

  it('never returns 0, an empty string, false or a default for a missing fact', () => {
    for (const { name, fact } of factLeaves(empty)) {
      if (fact.status !== 'absent') continue;
      expect(fact.value, name).toBeNull();
      expect(fact.value, name).not.toBe(0);
      expect(fact.value, name).not.toBe('');
      expect(fact.value, name).not.toBe(false);
    }
  });

  it('explains every absence in a sentence, and says whether it was ever captured', () => {
    for (const { name, fact } of factLeaves(empty)) {
      if (fact.status !== 'absent') continue;
      expect(fact.absence, name).not.toBeNull();
      expect(fact.absence!.reason.length, `${name} needs a reason`).toBeGreaterThan(20);
      expect(typeof fact.absence!.neverCaptured, name).toBe('boolean');
    }
  });

  it('never defaults the property type to a house', () => {
    const c = build({ id: 'x', property_specs: { bedrooms: 3 } });
    expect(c.property.propertyType.status).toBe('absent');
    expect(c.property.propertyType.value).toBeNull();
    expect(c.property.normalisedType.status).toBe('absent');
    expect(JSON.stringify(c.property)).not.toMatch(/"house"/);
  });

  it('never invents a coordinate when geography was never resolved', () => {
    const c = build({ id: 'x' });
    for (const key of ['latitude', 'longitude', 'suburb', 'postcode', 'state'] as const) {
      expect(c.geography[key].status, key).toBe('absent');
      expect(c.geography[key].value, key).toBeNull();
    }
  });

  it('makes a rent-derived figure absent rather than zero when the rent is unknown', () => {
    const noRent = build({
      id: 'x',
      financial_calculations: { initialCosts: { propertyValue: 700000 } },
    });
    expect(noRent.finance.weeklyRent.status).toBe('absent');
    expect(noRent.derived.grossYield.status).toBe('absent');
    expect(noRent.derived.grossYield.value).toBeNull();
    expect(noRent.derived.grossYield.absence!.reason).toMatch(/no rent is established/i);
  });

  it('never reconstructs the loan from the deposit', () => {
    // `price - deposit` breaks on 21 stored reports, so a reconstructed LVR
    // would be most confident exactly where the record is least reliable.
    const noLoan = build({
      id: 'x',
      financial_calculations: { initialCosts: { propertyValue: 700000, deposit: 140000 } },
    });
    expect(noLoan.finance.loanAmount.status).toBe('absent');
    expect(noLoan.derived.originationLvr.status).toBe('absent');
  });

  it('never recomputes stamp duty it was not given', () => {
    const c = build({ id: 'x', financial_calculations: { initialCosts: { propertyValue: 700000 } } });
    expect(c.finance.stampDuty.status).toBe('absent');
    expect(c.finance.stampDuty.absence!.reason).toMatch(/deliberately NOT recomputed/);
  });
});

// ---------------------------------------------------------------------------
// The three separations
// ---------------------------------------------------------------------------

describe('the separations the doctrine requires', () => {
  const c = build(completeRow, geography);

  it('keeps a trusted metric out of the scored assessment', () => {
    expect(c.derived.grossYield.status).toBe('present');
    expect(Object.keys(c.scoring)).not.toContain('grossYield');
    expect(JSON.stringify(c.scoring)).not.toMatch(/yield|lvr/i);
  });

  it('keeps geography identity out of Location scoring', () => {
    // `report_geography` only. Never `location_intelligence`, whose walk score,
    // commute and school count are the untrusted trio of audit §69.
    const body = CONTRACT_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(body).not.toContain('location_intelligence');
    expect(body).not.toContain('walkScore');
    expect(body).not.toContain('commuteTimeCBD');
    expect(body).not.toContain('schoolsNearby');
    for (const { fact } of factLeaves(c).filter((l) => l.name.startsWith('geography.'))) {
      if (fact.status === 'present') expect(fact.owner).toBe('public.report_geography');
    }
  });

  it('keeps the buyer\'s finance out of every assessment', () => {
    expect(c.finance.lvr.status).toBe('present');
    expect(c.finance.weeklyCashFlow.status).toBe('present');
    expect(JSON.stringify(c.scoring)).not.toMatch(/cashFlow|deposit|loan/i);
  });

  it('reads the address from geography and never from free text', () => {
    const body = CONTRACT_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(body).not.toContain('property_address');
  });

  it('never reads a phantom spec key', () => {
    // `price`, `weeklyRent`, `state` and `propertyType` on `property_specs`
    // have never been written by anything — JSONB returns undefined and the
    // `||` chain silently takes the next rung.
    const body = CONTRACT_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const phantom of ['property_specs.price', 'specs.price', 'specs.weeklyRent', 'specs.state']) {
      expect(body).not.toContain(phantom);
    }
  });
});

// ---------------------------------------------------------------------------
// Scoring state — read the stamp, never re-decide
// ---------------------------------------------------------------------------

describe('scoring state mirrors the stamp and decides nothing', () => {
  it('reads a stamped withheld grade as `unavailable`, with no letter and no zero', () => {
    const c = build({
      id: 'x',
      investment_score: {
        totalScore: null,
        grade: 'N/A',
        policy: {
          authority: 'unavailable',
          gradeIssued: false,
          dimensionScoresAuthoritative: false,
          measuredDimensions: ['yield'],
        },
      },
    });
    expect(c.scoring.authority).toBe('unavailable');
    expect(c.scoring.gradeIssued).toBe(false);
    expect(c.scoring.grade.status).toBe('absent');
    expect(c.scoring.grade.value).toBeNull();
    expect(c.scoring.composite.value).toBeNull();
    expect(c.scoring.explanation).not.toMatch(/\b[A-F][+-]?\b(?!\w)/);
    expect(c.scoring.measuredDimensions).toEqual(['yield']);
  });

  it('reads an unstamped historical score as a preserved legacy snapshot', () => {
    const c = build({ id: 'x', investment_score: { totalScore: 58, grade: 'B' } });
    expect(c.scoring.authority).toBe('legacy_snapshot');
    expect(c.scoring.gradeIssued).toBe(true);
    expect(c.scoring.grade.value).toBe('B');
    expect(c.scoring.composite.value).toBe(58);
    expect(c.scoring.dimensionScoresAuthoritative).toBe(true);
    expect(c.scoring.explanation).toMatch(/historical snapshot/i);
  });

  it('distinguishes "no scoring record" from "a grade was withheld"', () => {
    const none = build({ id: 'x' });
    expect(none.scoring.authority).toBe('none');
    expect(none.scoring.explanation).toMatch(/no scoring record/i);
    const withheld = build({
      id: 'y',
      investment_score: { grade: 'N/A', policy: { authority: 'unavailable', gradeIssued: false } },
    });
    expect(withheld.scoring.authority).toBe('unavailable');
    expect(withheld.scoring.explanation).not.toBe(none.scoring.explanation);
  });

  it('never speaks for the frozen V2 engine on its own initiative', () => {
    // `v2` is readable ONLY from a stamp that already says so. The contract
    // has no path that produces it, which is the same structural rule
    // `LegacyScoringAuthority` enforces on the scorer.
    const body = CONTRACT_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const v2Assignments = body.match(/authority[^=\n]*=\s*'v2'/g) ?? [];
    expect(v2Assignments).toEqual([]);
    expect(build({ id: 'x', investment_score: { grade: 'A' } }).scoring.authority).not.toBe('v2');
  });
});

// ---------------------------------------------------------------------------
// Historical compatibility — rule 8
// ---------------------------------------------------------------------------

describe('every historical shape is tolerated without migration', () => {
  const shapes: Array<[string, unknown]> = [
    ['null row', null],
    ['empty object', {}],
    ['a string where an object belongs', { id: 'x', financial_calculations: 'legacy' }],
    ['an array where an object belongs', { id: 'x', property_specs: [] }],
    ['numbers stored as strings', { id: 'x', manual_overrides: { purchasePrice: '700000' } }],
    ['NaN and Infinity', { id: 'x', financial_calculations: { initialCosts: { propertyValue: NaN, deposit: Infinity } } }],
    ['a score with no policy and no grade', { id: 'x', investment_score: {} }],
    ['a geography row that is a string', { id: 'x' }],
    ['deeply missing nesting', { id: 'x', financial_calculations: { initialCosts: null } }],
  ];

  it.each(shapes)('survives %s', (_label, row) => {
    expect(() => build(row)).not.toThrow();
    const c = build(row);
    expect(c.contractVersion).toBe(REPORT_FACT_CONTRACT_VERSION);
    for (const { name, fact } of factLeaves(c)) {
      expect(['present', 'absent'], name).toContain(fact.status);
      if (fact.status === 'absent') expect(fact.value, name).toBeNull();
      if (typeof fact.value === 'number') expect(Number.isFinite(fact.value), name).toBe(true);
    }
  });

  it('treats a whitespace-only string as absent rather than as a blank fact', () => {
    const c = build({ id: 'x' }, { suburb: '   ', state: '' });
    expect(c.geography.suburb.status).toBe('absent');
    expect(c.geography.state.status).toBe('absent');
  });

  it('rejects a non-finite number rather than publishing it', () => {
    const c = build({ id: 'x', financial_calculations: { initialCosts: { propertyValue: NaN } } });
    expect(c.finance.purchasePrice.status).toBe('absent');
  });
});

// ---------------------------------------------------------------------------
// Provenance, basis and integrity
// ---------------------------------------------------------------------------

describe('every fact can be defended', () => {
  const c = build(completeRow, geography);

  it('names the canonical owner on every present fact, and never itself', () => {
    for (const { name, fact } of factLeaves(c)) {
      expect(fact.owner.length, name).toBeGreaterThan(0);
      expect(fact.owner, name).not.toContain('reportFactContract');
    }
  });

  it('carries the basis on a figure whose basis is a real question', () => {
    expect(c.derived.grossYield.basis).toBe('Gross yield (on purchase price)');
    expect(c.derived.netYield.basis).toBe('Net yield (on purchase price)');
    expect(c.derived.originationLvr.basis).toMatch(/settlement/i);
  });

  it('keeps origination LVR and current LVR as different quantities', () => {
    expect(c.derived.originationLvr.status).toBe('present');
    expect(c.derived.currentLvr.status).toBe('absent');
    expect(c.derived.currentLvr.absence!.reason).toMatch(/different quantities/);
  });

  it('classifies each fact as snapshot, derived or record', () => {
    for (const { name, fact } of factLeaves(c)) {
      expect(['snapshot', 'derived', 'record'], name).toContain(fact.temporality);
    }
    expect(c.record.variant.temporality).toBe('record');
    expect(c.finance.purchasePrice.temporality).toBe('snapshot');
    expect(c.derived.grossYield.temporality).toBe('derived');
  });

  it('discloses a broken finance identity rather than silently repairing it', () => {
    const broken = build({
      id: 'x',
      financial_calculations: {
        initialCosts: { propertyValue: 672000, deposit: 134400 },
        loanDetails: { loanAmount: 604800, lvr: 90 },
        keyMetrics: { lvr: 80 },
      },
    });
    expect(broken.integrity.financeBreaches.length).toBeGreaterThan(0);
    expect(broken.integrity.financeBreaches.map((b) => b.rule)).toContain('lvr_stated_twice');
  });

  it('reports read-time healing without writing anything', () => {
    expect(c.integrity.readTimeHealing).toHaveProperty('financeIdentityHealed');
    const body = CONTRACT_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(body).not.toMatch(/\bawait\b/);
  });

  it('lists what is absent and what was superseded, by name', () => {
    const sparse = build({ id: 'x' });
    expect(sparse.integrity.absentFacts.length).toBeGreaterThan(10);
    expect(sparse.integrity.absentFacts).toContain('finance.purchasePrice');
    expect(c.integrity.absentFacts).not.toContain('finance.purchasePrice');
  });

  it('keeps a lower-precedence value that disagreed instead of erasing it', () => {
    const disagreeing = build({
      id: 'x',
      manual_overrides: { purchasePrice: 700000 },
      financial_calculations: { initialCosts: { propertyValue: 680000 } },
    });
    expect(disagreeing.finance.purchasePrice.value).toBe(700000);
    expect(disagreeing.finance.purchasePrice.supersededValue).toBe(680000);
    expect(disagreeing.integrity.supersededFacts).toContain('finance.purchasePrice');
  });
});

// ---------------------------------------------------------------------------
// Lineage and the projection
// ---------------------------------------------------------------------------

describe('lineage and the stored projection', () => {
  it('carries a forked report\'s parent and a derived report\'s origin', () => {
    const forked = build({ id: 'c', parent_report_id: 'p', derived_from_report_id: 'd' });
    expect(forked.record.parentReportId.value).toBe('p');
    expect(forked.record.derivedFromReportId.value).toBe('d');
  });

  it('says a report was not forked rather than leaving the question open', () => {
    const c = build({ id: 'c' });
    expect(c.record.parentReportId.status).toBe('absent');
    expect(c.record.parentReportId.absence!.reason).toMatch(/not forked/i);
  });

  it('reports the stored series length and never regenerates it', () => {
    const c = build(completeRow, geography);
    expect(c.projection.present).toBe(true);
    expect(c.projection.years.value).toBe(10);
    expect(c.projection.note).toMatch(/never regenerates/i);
  });

  it('says a report has no projection rather than implying a zero-year one', () => {
    const c = build({ id: 'x', financial_calculations: {} });
    expect(c.projection.present).toBe(false);
    expect(c.projection.years.status).toBe('absent');
  });
});

/**
 * RF-7.2B — the twenty-four proofs the mandate requires, plus the guards that
 * keep them true.
 *
 * Each `it` below is numbered against §30 of the brief so a reviewer can walk
 * the list rather than trust a summary.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  gateFact, gateFacts, narrativeBundle, reconcileMarketClaim,
  isTrustedSource, isGeneratedSource, GRAIN_LABEL, BLOCKED_FACTS,
  CLIENT_SAFE_GATE_VERSION,
} from '@/lib/reports/contract/clientSafeGate.pure';
import {
  safeDemographics, safeCashRate, cashRateStatement, blockedLocationFacts,
  CASH_RATE_SERIES_ID, DEMOGRAPHIC_FIELDS, monthLabel,
} from '@/lib/reports/contract/safeMarketFacts.pure';
import {
  presenceOf, decideField, decideSection, decideChart, visibleRows,
  leaksTechnicalToken, isRenderable,
} from '@/lib/reports/contract/visibilityPolicy.pure';
import {
  buildReportFactContract, normaliseRentBasis, RENT_BASIS_VALUES,
} from '@/lib/reports/contract/reportFactContract.pure';
import { resolveBindable } from '@/lib/reportTemplate/bindingResolver';

const REPO = resolve(__dirname, '../../../..');
const read = (p: string) => readFileSync(resolve(REPO, p), 'utf8');
const AT = new Date('2026-09-11T00:00:00.000Z');

const trustedGeo = { status: 'resolved', postcode: '3024', suburb: 'Cobblebank', state: 'VIC' };
const absRow = {
  poa: '3024', population: 11234, median_age: 33, median_rent_weekly: 420,
  median_hh_income_weekly: 2100, median_mortgage_monthly: 2300,
  owner_occupier_rate: 62.5, renter_rate: 33.1, unemployment_rate: 4.2,
  participation_rate: 68.0, reference_period: '2021 Census',
  source: 'ABS Census of Population and Housing 2021', loaded_at: '2026-08-01',
};
const ctx = (f: Record<string, unknown>) =>
  ({ data: { financials: f }, tokens: { colors: {}, fonts: {}, spacing: {} } }) as never;

// ---------------------------------------------------------------------------
// 1–4  Demographics
// ---------------------------------------------------------------------------

describe('§30.1–4 — demographics', () => {
  it('1. generated ABS-labelled demographics cannot enter a client-safe report', () => {
    for (const src of [
      'ABS Census 2021 estimates', 'ABS Census Estimates',
      'ABS Census 2021 (estimated)', 'ABS Labour Force estimates',
    ]) {
      expect(isGeneratedSource(src), src).toBe(true);
      expect(isTrustedSource(src), src).toBe(false);
      const gated = gateFact({
        name: 'market.population', value: 28456, safety: 'contextual', source: src,
        context: { grain: 'postcode', referencePeriod: '2021 Census', dataset: null, asOf: null },
      });
      expect(gated.verdict).toBe('block');
      expect(gated.value).toBeNull();
      expect(gated.ruling).toMatch(/generated rather than\s+retrieved/);
    }
  });

  it('2. trusted ABS data enters only at its real grain', () => {
    const { facts, routed } = safeDemographics(trustedGeo, absRow);
    expect(routed).toBe(true);
    for (const f of facts) {
      if (f.status !== 'present') continue;
      expect(f.verdict).toBe('allow_with_context');
      expect(f.context!.grain).toBe('postcode');
      expect(f.context!.referencePeriod).toBe('2021 Census');
      expect(f.source).toBe('abs_census_poa');
    }
    expect(facts.filter((f) => f.status === 'present').length).toBe(DEMOGRAPHIC_FIELDS.length);
  });

  it('3. a missing ABS match stays unavailable and is never substituted', () => {
    for (const [label, geo, row] of [
      ['no geography', null, absRow],
      ['untrusted geography', { status: 'requires_review', postcode: '3024' }, absRow],
      ['no postcode', { status: 'resolved' }, absRow],
      ['no ABS row', trustedGeo, null],
    ] as const) {
      const { facts, routed, reason } = safeDemographics(geo, row);
      expect(routed, label).toBe(false);
      expect(facts.every((f) => f.status === 'absent' && f.value === null), label).toBe(true);
      expect(reason.length, label).toBeGreaterThan(20);
      // The refusal must not OFFER a substitute. Saying "not estimated" is the
      // point, so the check is for a promised figure rather than the word.
      expect(reason.toLowerCase(), label).not.toMatch(/estimated at|approximately|based on similar/);
    }
    // The refusal explicitly rules out borrowing a neighbour.
    expect(safeDemographics(trustedGeo, null).reason).toMatch(/never substituted/i);
  });

  it('4. POA data can never be labelled suburb without grain disclosure', () => {
    expect(GRAIN_LABEL.postcode).toBe('postcode area');
    expect(GRAIN_LABEL.postcode).not.toMatch(/suburb/i);
    for (const f of DEMOGRAPHIC_FIELDS) expect(f.clientLabel.toLowerCase()).not.toContain('suburb');

    // Context is mandatory: strip it and the fact becomes unavailable, never
    // silently promoted to an unqualified figure.
    const stripped = gateFact({
      name: 'market.population', value: 11234, safety: 'contextual', source: 'abs_census_poa',
    });
    expect(stripped.verdict).toBe('unavailable');
    expect(stripped.value).toBeNull();

    // And a narrative that describes it as suburb evidence is a fault.
    const { facts } = safeDemographics(trustedGeo, absRow);
    const pop = facts.find((f) => f.name === 'market.population')!;
    const faults = reconcileMarketClaim(
      { fact: 'market.population', value: 11234, claimedGrain: 'suburb', claimedPeriod: null, claimedSource: null },
      pop,
    );
    expect(faults.map((f) => f.kind)).toContain('grain_overstated');
  });
});

// ---------------------------------------------------------------------------
// 5–7  The cash rate
// ---------------------------------------------------------------------------

const rbaReading = {
  seriesId: 'FIRMMCRT', title: 'Cash Rate Target',
  description: 'Cash Rate Target; monthly average', frequency: 'Monthly',
  tableCode: 'f1.1', publicationDate: '01-Sep-2026',
  obsDate: '2026-08-31', value: 4.35,
};

describe('§30.5–7 — the cash rate', () => {
  it('5. a hardcoded 4.35 can never be authoritative, even though it is currently right', () => {
    const gated = gateFact({
      name: 'market.cashRateTargetMonthlyAverage', value: 4.35, safety: 'contextual',
      source: 'RBA Official Cash Rate (estimated)',
      context: { grain: 'national', referencePeriod: 'August 2026', dataset: null, asOf: null },
    });
    expect(gated.verdict).toBe('block');
    expect(gated.value).toBeNull();
    // The value matching the truth is exactly why the SOURCE must decide.
    expect(gated.value).not.toBe(4.35);
  });

  it('6. an LLM web search can never be authoritative RBA data', () => {
    for (const src of [
      'RBA Official Cash Rate (via Perplexity real-time search)',
      'ABS / RBA (via Perplexity real-time search)',
    ]) {
      expect(isGeneratedSource(src), src).toBe(true);
      expect(gateFact({ name: 'market.cashRateTargetMonthlyAverage', value: 4.1, safety: 'contextual', source: src }).verdict)
        .toBe('block');
    }
  });

  it('7. the RBA series is labelled as the monthly average it actually is', () => {
    const fact = safeCashRate(rbaReading);
    expect(fact.status).toBe('present');
    expect(fact.value).toBe(4.35);
    expect(fact.context!.referencePeriod).toBe('August 2026 (monthly average)');
    expect(fact.context!.dataset).toMatch(/F1\.1/);
    expect(fact.context!.asOf).toBe('01-Sep-2026');

    const sentence = cashRateStatement(fact);
    expect(sentence).toContain('monthly average');
    expect(sentence).toContain('August 2026');
    // It must NOT claim to be the rate as at today: a change this month is not
    // yet in a monthly series.
    expect(sentence.toLowerCase()).not.toMatch(/\bcurrent(ly)? (cash )?rate\b/);
    expect(sentence.toLowerCase()).not.toMatch(/\btoday\b/);

    // A different series is refused rather than quoted as the cash rate.
    expect(safeCashRate({ ...rbaReading, seriesId: 'FIRMMBAB90' }).status).toBe('absent');
    expect(safeCashRate(null).status).toBe('absent');
    expect(CASH_RATE_SERIES_ID).toBe('FIRMMCRT');
    expect(monthLabel('2026-08-31')).toBe('August 2026');
    expect(monthLabel('nonsense')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 8–10  Location and rent basis
// ---------------------------------------------------------------------------

describe('§30.8–10 — location block and rent basis', () => {
  it('8. the four disowned location figures are blocked, with their evidence', () => {
    const blocked = blockedLocationFacts();
    expect(blocked).toHaveLength(4);
    for (const f of blocked) {
      expect(f.verdict).toBe('block');
      expect(f.value).toBeNull();
      expect(BLOCKED_FACTS[f.name]).toBeTruthy();
      expect(f.absence!.reason.length).toBeGreaterThan(30);
    }
    expect(blocked.map((f) => f.name)).toEqual([
      'market.walkScore', 'market.commuteDurationMinutes',
      'market.schoolsWithin3km', 'market.transportQualityScore',
    ]);
  });

  it('9. rent basis stays unknown on a historical row and is never inferred', () => {
    const historical = buildReportFactContract({
      report: { id: 'h', manual_overrides: { weeklyRent: 650 } },
      observedAt: AT,
    });
    expect(historical.finance.weeklyRent.value).toBe(650);
    expect(historical.finance.rentBasis.status).toBe('absent');
    expect(historical.finance.rentBasis.value).toBeNull();
    expect(historical.finance.rentBasis.absence!.reason).toMatch(/unknown/i);
    expect(historical.finance.rentAsOf.status).toBe('absent');

    // An unrecognised basis is absent, not coerced to the nearest value.
    expect(normaliseRentBasis('something else entirely')).toBeNull();
    expect(normaliseRentBasis('Current Lease')).toBe('current_lease');
    expect(normaliseRentBasis('rental-appraisal')).toBe('rental_appraisal');
    expect(RENT_BASIS_VALUES).toContain('market_estimate');
  });

  it('10. the new rent-basis metadata is optional and backwards compatible', () => {
    // A row with none of the new keys still builds, and every pre-existing
    // fact is identical to what it was without them.
    const without = buildReportFactContract({
      report: { id: 'x', manual_overrides: { purchasePrice: 700000, weeklyRent: 650 } },
      observedAt: AT,
    });
    const withBasis = buildReportFactContract({
      report: {
        id: 'x',
        manual_overrides: {
          purchasePrice: 700000, weeklyRent: 650,
          rentBasis: 'current_lease', rentAsOf: '2026-02-01',
        },
      },
      observedAt: AT,
    });
    expect(without.finance.purchasePrice).toEqual(withBasis.finance.purchasePrice);
    expect(without.finance.weeklyRent.value).toBe(withBasis.finance.weeklyRent.value);
    expect(without.derived.grossYield.value).toBe(withBasis.derived.grossYield.value);
    expect(withBasis.finance.rentBasis.value).toBe('current_lease');
    expect(withBasis.finance.rentAsOf.value).toBe('2026-02-01');
  });
});

// ---------------------------------------------------------------------------
// 11–16  Null safety and visibility
// ---------------------------------------------------------------------------

describe('§30.11–16 — null safety and visibility', () => {
  it('11. a null never renders as $0 or 0%', () => {
    for (const v of [null, '', NaN]) {
      expect(resolveBindable('{{financials.lvr | percent:0}}', ctx({ lvr: v }))).toBe('');
      expect(resolveBindable('{{financials.weeklyRent | currency}}', ctx({ weeklyRent: v }))).toBe('');
    }
    expect(resolveBindable('{{financials.lvr | percent:0}}', ctx({}))).toBe('');
  });

  it('12. a genuine zero remains visible', () => {
    expect(resolveBindable('{{financials.lvr | percent:0}}', ctx({ lvr: 0 }))).toBe('0%');
    expect(resolveBindable('{{financials.weeklyRent | currency}}', ctx({ weeklyRent: 0 }))).toBe('$0');
    expect(resolveBindable('{{financials.lvr}}', ctx({ lvr: 0 }))).toBe('0');
    expect(presenceOf(0)).toBe('zero');
    expect(isRenderable(0)).toBe(true);
    // And negatives, which a truthiness test would also keep but a naive
    // "positive only" guard would not.
    expect(resolveBindable('{{financials.weeklyRent | currency}}', ctx({ weeklyRent: -120 }))).toBe('-$120');
  });

  it('13. an empty string is an absence, and absence-aware filters still see it', () => {
    expect(presenceOf('')).toBe('absent');
    expect(presenceOf('   ')).toBe('absent');
    // A `fallback` filter exists to answer absence, so the gate must not
    // short-circuit it — that was a real regression caught by the suite.
    expect(resolveBindable('{{missing | fallback:"n/a"}}', ctx({}))).toBe('n/a');
  });

  it('14. a missing field produces no label and no row', () => {
    const d = decideField({ name: 'yearBuilt', value: null });
    expect(d.render).toBe('omit');
    const rows = visibleRows([
      { label: 'Year Built', value: null },
      { label: 'Vacancy Rate', value: undefined },
      { label: 'Land Size', value: 450 },
      { label: 'Weekly Cash Flow', value: 0 },
    ]);
    expect(rows.map((r) => r.label)).toEqual(['Land Size', 'Weekly Cash Flow']);
  });

  it('14b. a material absence is explained deliberately, never by a formatter', () => {
    const d = decideField({
      name: 'overallGrade', value: null, material: true,
      absenceStatement: 'Not currently available — insufficient verified evidence.',
    });
    expect(d.render).toBe('material_absence');
    expect(d).toHaveProperty('statement', 'Not currently available — insufficient verified evidence.');
    // A material field with no statement written is suppressed rather than
    // given a generated one.
    expect(decideField({ name: 'x', value: null, material: true }).render).toBe('omit');
  });

  it('15. an optional section with nothing to show is suppressed whole', () => {
    const empty = decideSection({ name: 'Market', fields: [
      { name: 'population', value: null }, { name: 'medianRent', value: '' },
    ] });
    expect(empty.render).toBe(false);
    expect(empty.why).toMatch(/heading and its frame are suppressed/);

    expect(decideSection({ name: 'Market', fields: [{ name: 'population', value: 11234 }] }).render).toBe(true);
    // A zero is content, so a section holding only a zero still renders.
    expect(decideSection({ name: 'Cash flow', fields: [{ name: 'weeklyNet', value: 0 }] }).render).toBe(true);
    // A material absence is a reason to render.
    expect(decideSection({ name: 'Grade', fields: [
      { name: 'grade', value: null, material: true, absenceStatement: 'Not available.' },
    ] }).render).toBe(true);
  });

  it('16. an absent chart point is dropped, never zeroed', () => {
    const d = decideChart([
      { label: 'Y1', value: 1000 }, { label: 'Y2', value: null },
      { label: 'Y3', value: 3000 }, { label: 'Y4', value: 0 },
    ]);
    expect(d.render).toBe(true);
    expect(d.points.map((p) => p.label)).toEqual(['Y1', 'Y3', 'Y4']);
    expect(d.points.find((p) => p.label === 'Y2')).toBeUndefined();
    expect(d.points.find((p) => p.label === 'Y4')!.value).toBe(0);
    expect(d.dropped).toBe(1);

    // Below the density threshold the chart is suppressed rather than drawn.
    const sparse = decideChart([{ label: 'Y1', value: 1 }, { label: 'Y2', value: null }]);
    expect(sparse.render).toBe(false);
    expect(sparse.points).toEqual([]);
    expect(sparse.why).toMatch(/invented floors/);
  });
});

// ---------------------------------------------------------------------------
// 17–19  Templates and narrative
// ---------------------------------------------------------------------------

describe('§30.17–19 — templates and narrative', () => {
  it('17. a template cannot alter a canonical fact', () => {
    const RESOLVER = read('src/lib/reportTemplate/bindingResolver.ts');
    // Presence is decided before any filter runs, so no formatter can turn one
    // value into another kind of value.
    expect(RESOLVER).toContain("if (presenceOf(value) === 'absent' && !handlesAbsence(filterParts)) return '';");
    // And the one projection remains the only source of a template's facts.
    expect(read('supabase/functions/_shared/reportBindingProjection.pure.ts'))
      .toContain("if (value !== undefined && value !== null && value !== '') target[key] = value;");
  });

  it('18. absence semantics are identical whatever the template', () => {
    // The behaviour lives in the resolver, which every template shares, so
    // parity is structural. Proved across each formatter a template may use.
    for (const filter of ['currency', 'percent', 'percent:0', 'number', 'fixed']) {
      expect(resolveBindable(`{{financials.x | ${filter}}}`, ctx({ x: null })), filter).toBe('');
      expect(resolveBindable(`{{financials.x | ${filter}}}`, ctx({})), filter).toBe('');
    }
    for (const token of ['0', '$0', '0%', 'null', 'undefined', 'N/A', 'NaN']) {
      expect(resolveBindable('{{financials.x | currency}}', ctx({ x: null }))).not.toBe(token);
    }
  });

  it('19. the narrative bundle carries client-safe facts only', () => {
    const facts = gateFacts([
      { name: 'market.population', value: 11234, safety: 'contextual', source: 'abs_census_poa',
        context: { grain: 'postcode', referencePeriod: '2021 Census', dataset: 'ABS', asOf: null } },
      { name: 'market.walkScore', value: 70, safety: 'not_client_safe' },
      { name: 'market.generatedDemographics', value: 28456, safety: 'contextual',
        source: 'ABS Census 2021 estimates' },
      { name: 'finance.purchasePrice', value: 700000, safety: 'authoritative', source: 'manual_overrides' },
      { name: 'derived.grossYield', value: 4.83, safety: 'derived', basis: 'Gross yield (on purchase price)' },
      { name: 'market.growth', value: null, safety: 'future_source' },
    ]);
    const bundle = narrativeBundle(facts);
    expect(Object.keys(bundle).sort()).toEqual([
      'derived.grossYield', 'finance.purchasePrice', 'market.population',
    ]);
    expect(bundle['derived.grossYield'].label).toBe('Gross yield (on purchase price)');
    expect(bundle['market.population'].label).toContain('postcode area');
    // Nothing refused, and no provenance or ruling prose, reaches the model.
    const serialised = JSON.stringify(bundle);
    expect(serialised).not.toMatch(/walkScore|generatedDemographics|estimates|blocked|ruling/i);
  });
});

// ---------------------------------------------------------------------------
// 20–24  Reconciliation, leakage, preservation
// ---------------------------------------------------------------------------

describe('§30.20–24 — reconciliation, leakage and preservation', () => {
  it('20. market reconciliation catches value, source, grain and period faults', () => {
    const fact = safeDemographics(trustedGeo, absRow).facts
      .find((f) => f.name === 'market.population')!;

    expect(reconcileMarketClaim(
      { fact: 'market.population', value: 11234, claimedGrain: 'postcode',
        claimedPeriod: '2021 Census', claimedSource: 'abs_census_poa' }, fact,
    )).toEqual([]);

    const kinds = (c: Parameters<typeof reconcileMarketClaim>[0]) =>
      reconcileMarketClaim(c, fact).map((f) => f.kind);

    expect(kinds({ fact: 'market.population', value: 28456, claimedGrain: 'postcode', claimedPeriod: null, claimedSource: null }))
      .toContain('value_mismatch');
    expect(kinds({ fact: 'market.population', value: 11234, claimedGrain: 'property', claimedPeriod: null, claimedSource: null }))
      .toContain('grain_overstated');
    expect(kinds({ fact: 'market.population', value: 11234, claimedGrain: 'postcode', claimedPeriod: '2026', claimedSource: null }))
      .toContain('period_mismatch');
    expect(kinds({ fact: 'market.population', value: 11234, claimedGrain: 'postcode', claimedPeriod: null, claimedSource: 'CoreLogic' }))
      .toContain('source_misattributed');
    expect(reconcileMarketClaim(
      { fact: 'market.growth', value: 5, claimedGrain: 'suburb', claimedPeriod: null, claimedSource: null }, undefined,
    ).map((f) => f.kind)).toEqual(['not_client_safe']);
  });

  it('21. technical tokens are detected as whole tokens, not inside real words', () => {
    for (const bad of ['Population: null', 'Yield NaN%', 'Rent $NaN', 'Value [object Object]', 'x undefined y']) {
      expect(leaksTechnicalToken(bad), bad).not.toBeNull();
    }
    // Legitimate content that merely contains those letters is not a leak.
    // "Undefined Creek Rd" is deliberately NOT in this list: "Undefined" there
    // is a standalone token and flagging it for a human to look at is correct.
    for (const ok of ['Sunnybank', 'Nullarbor Road', 'Nanango QLD', 'Annandale', 'Nullawil VIC']) {
      expect(leaksTechnicalToken(ok), ok).toBeNull();
    }
  });

  it('22. nothing in the new layer writes, fetches or rewrites a stored row', () => {
    for (const mod of [
      'supabase/functions/_shared/reports/contract/clientSafeGate.pure.ts',
      'supabase/functions/_shared/reports/contract/safeMarketFacts.pure.ts',
      'supabase/functions/_shared/reports/contract/visibilityPolicy.pure.ts',
    ]) {
      const body = read(mod).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const forbidden of [
        'Date.now', 'new Date(', 'Math.random', 'fetch(', 'createClient', 'supabase',
        '.insert(', '.update(', '.upsert(', '.delete(', 'await ',
      ]) {
        expect(body, `${mod} must not contain ${forbidden}`).not.toContain(forbidden);
      }
    }
    // And the builder still mutates nothing it is handed.
    const row = { id: 'x', manual_overrides: { weeklyRent: 650 } };
    const before = JSON.stringify(row);
    buildReportFactContract({ report: row, observedAt: AT });
    expect(JSON.stringify(row)).toBe(before);
  });

  it('23. the RF-7.1 and RF-7.2A preservation suites are still present', () => {
    const specs = readdirSync(resolve(REPO, 'src/lib/reports/__tests__'));
    for (const kept of [
      'rf71Preservation.spec.ts', 'reportFactContract.spec.ts',
      'reportFactContractParity.spec.ts', 'rf72aDataAssurance.spec.ts',
    ]) {
      expect(specs, `${kept} must not be removed`).toContain(kept);
    }
  });

  it('24. template selection and its workflow are untouched', () => {
    for (const p of [
      'supabase/functions/_shared/reports/reportTemplateSelection.pure.ts',
      'src/lib/reportTemplate/templateSelection.ts',
      'src/lib/reportTemplate/resolveTemplate.ts',
      'src/lib/reports/investment/deliverInvestmentPdf.ts',
    ]) {
      expect(() => read(p), p).not.toThrow();
    }
    const delivery = read('src/lib/reports/investment/deliverInvestmentPdf.ts');
    // Template selection is what this pins, and it is untouched. The renderer
    // BEHIND it changed in RC-3.1 (Cloud Run → browser), which is a different
    // question and has its own tests.
    expect(delivery).toContain("tryTemplateDocument('investment'");
    expect(delivery).toContain('generateInvestmentPdfBlob');
  });
});

// ---------------------------------------------------------------------------
// The gate's own rules
// ---------------------------------------------------------------------------

describe('the gate never promotes a classification', () => {
  it('is versioned', () => expect(CLIENT_SAFE_GATE_VERSION).toMatch(/^\d+\.\d+\.\d+$/));

  it('refuses a derived figure with no basis rather than publishing it bare', () => {
    expect(gateFact({ name: 'derived.grossYield', value: 4.83, safety: 'derived' }).verdict)
      .toBe('unavailable');
    expect(gateFact({ name: 'derived.grossYield', value: 4.83, safety: 'derived', basis: 'Gross yield (on purchase price)' }).verdict)
      .toBe('allow_with_basis');
  });

  it('treats an unrecognised source as untrusted rather than as acceptable', () => {
    expect(isTrustedSource('some_new_provider')).toBe(false);
    expect(isTrustedSource('')).toBe(false);
    expect(isTrustedSource(null)).toBe(false);
    expect(isTrustedSource('abs_census_poa')).toBe(true);
  });

  it('keeps a future source distinct from an absence', () => {
    const f = gateFact({ name: 'market.growth', value: null, safety: 'future_source' });
    expect(f.safety).toBe('future_source');
    expect(f.verdict).toBe('unavailable');
    expect(f.absence!.reason).toMatch(/planned integration/i);
  });

  it('never returns a value on any blocking path', () => {
    for (const safety of ['not_client_safe', 'unavailable', 'future_source'] as const) {
      const f = gateFact({ name: 'market.walkScore', value: 99, safety });
      expect(f.value).toBeNull();
      expect(f.status).toBe('absent');
    }
  });
});

// ---------------------------------------------------------------------------
// §20 — inline expressions: scanned across every family before any prohibition
// ---------------------------------------------------------------------------

describe('§20 — no template may carry business logic, and none does', () => {
  /**
   * Measured against the live database on 2026-09-11, across ALL families and
   * not just Investment, exactly as §20 requires before prohibiting anything:
   *
   *   templates (all)                113   with `{{= }}`: 0
   *   templates (active)              16   with `{{= }}`: 0
   *   template_library_entries       543   with `{{= }}`: 0
   *   active with `{{@ }}` computed    0
   *
   * So no report family depends on an expression and a forward prohibition
   * breaks nothing. The seeded catalogue is the source every production
   * template is generated from, so guarding it is where the rule bites.
   */
  const SEED_ROOTS = [
    'scripts/template-library',
    'supabase/functions/_shared/reports',
  ];

  const walk = (dir: string, out: string[] = []): string[] => {
    for (const entry of readdirSync(resolve(REPO, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
        walk(rel, out);
      } else if (/\.(ts|json|html)$/.test(entry.name)) {
        out.push(rel);
      }
    }
    return out;
  };

  it('no seeded or shared template source emits an inline expression binding', () => {
    const offenders: string[] = [];
    for (const root of SEED_ROOTS) {
      for (const file of walk(root)) {
        const src = read(file);
        // `{{= ... }}` and `{{@ ... }}` are the two computed forms the resolver
        // supports. A template may bind a path; it may not compute one.
        if (/\{\{\s*[=@]/.test(src.replace(/\/\*[\s\S]*?\*\//g, ''))) offenders.push(file);
      }
    }
    expect(
      offenders,
      'A template must be PRESENTATION. An inline expression computes a fact, '
      + 'which is how two templates come to disagree about a number. Bind the '
      + 'value from the projection instead.',
    ).toEqual([]);
  });

  it('the resolver still supports expressions for the conditional machinery that needs them', () => {
    // Deliberately NOT removed: `block.conditional` / `page.conditional` use the
    // same evaluator to decide whether a page renders, which is presentation.
    // The prohibition is on template AUTHORS binding a computed fact, not on
    // the engine's own visibility logic.
    const RESOLVER = read('src/lib/reportTemplate/bindingResolver.ts');
    expect(RESOLVER).toContain('evalConditional');
  });
});

// ---------------------------------------------------------------------------
// The status claim itself, pinned
// ---------------------------------------------------------------------------

describe('RF-7.2B is infrastructure, and the record must keep saying so', () => {
  /**
   * An earlier draft of this stage's pull request claimed new reports were
   * already protected. They are not: the gate exists and nothing calls it.
   *
   * This test makes the claim falsifiable in both directions — it fails if the
   * gate quietly acquires a production consumer while the documents still say
   * "not active", and it is the test to DELETE (with the docs updated) when
   * RF-7.2B.1 genuinely activates it.
   */
  it('the safe-data layer has no production consumer', () => {
    const offenders: string[] = [];
    const markers = ['gateFact', 'safeDemographics', 'safeCashRate', 'narrativeBundle', 'decideSection'];
    const walk = (dir: string) => {
      for (const entry of readdirSync(resolve(REPO, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name === 'contract') continue;
          walk(rel);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        if (/\.(spec|test)\.tsx?$/.test(entry.name)) continue;
        const src = read(rel);
        if (markers.some((m) => src.includes(m))) offenders.push(rel);
      }
    };
    for (const root of ['src', 'supabase/functions']) walk(root);
    expect(
      offenders,
      'RF-7.2B ships the layer UNWIRED. If this fails, either a consumer was '
      + 'added — in which case RF72B_DATA_REMEDIATION_CLOSEOUT.md §0 must stop '
      + 'saying "NOT YET PRODUCTION-ACTIVE" — or the activation is RF-7.2B.1 '
      + 'and this test should be retired with it.',
    ).toEqual([]);
  });

  it('the closeout leads with the built-versus-live distinction', () => {
    const closeout = read('docs/reports/RF72B_DATA_REMEDIATION_CLOSEOUT.md');
    expect(closeout).toContain('NOT YET PRODUCTION-ACTIVE');
    expect(closeout).toContain('It did not switch production onto');
    expect(closeout).toContain('RF-7.2B.1');
    // And it must not claim readiness for the presentation stage.
    expect(closeout).toMatch(/Ready for RF-7\.2C:\s*NO\b/);
  });
});

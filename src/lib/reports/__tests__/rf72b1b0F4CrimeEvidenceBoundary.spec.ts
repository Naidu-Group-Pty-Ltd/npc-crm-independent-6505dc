import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ADMISSION_REFUSAL_NOTE,
  admitPopulationForArea,
  type AdmittedPopulation,
} from '../../../../supabase/functions/_shared/crimePopulationAdmission.pure.ts';
import { nswCrimeReading } from '../../../../supabase/functions/_shared/crimeReading.pure.ts';

/**
 * RF-7.2B.1B0-F4 — a crime rate's denominator is admitted evidence.
 *
 * The defect, measured on production report 0ec278ea-9d35-4b27-a948-88572411241d
 * (48 Redfern Street, Cowra NSW 2794, geography UNRESOLVED):
 *
 *   abs_census_poa.population['2794'] = 10,504   ← withheld from the report
 *   crime_reference offences (12m)    =  1,144
 *   published rate                    = 10,891 per 100,000
 *
 * The same document said population for 2794 was "explicitly unavailable and
 * must not be substituted from broader geographies", then printed a figure
 * that cannot exist without it. `crime-statistics-service` had read the table
 * itself, on the untrusted postcode scraped out of the free-text address.
 */
const REPO = resolve(__dirname, '../../../..');
const service = readFileSync(
  resolve(REPO, 'supabase/functions/crime-statistics-service/index.ts'), 'utf8',
);
const generator = readFileSync(
  resolve(REPO, 'supabase/functions/generate-investment-report/index.ts'), 'utf8',
);
const codeOnly = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const COWRA: AdmittedPopulation = {
  value: 10_504,
  source: 'abs_census_poa',
  geography: '2794',
  grain: 'postcode',
  vintage: '2021 Census usual residents',
};

/** One BOCSAR-shaped row summing to the production count. */
const rows = [{
  area: '2794',
  offence: 'Total',
  months12: 1144,
  prior12: 1100,
  yearTotals: { '2025': 1144 },
  latestMonth: '2025-12',
  seriesFrom: '2020-01',
  source: 'NSW BOCSAR recorded criminal incidents by postcode',
  seriesNote: null,
}];

const reading = (pop: number | null) => nswCrimeReading(
  rows as never,
  '2794',
  rows[0].source,
  { area: pop, state: 8_166_000, vintage: '2021 Census usual residents' },
  620_000,
  null,
);

describe('F4 — 1/2/3: the population must be admitted, at the same grain, for the same area', () => {
  it('1. admitted same-grain postcode population → rate allowed', () => {
    const v = admitPopulationForArea(COWRA, 'postcode', '2794');
    expect(v.value).toBe(10_504);
    expect(v.refusedBecause).toBeNull();
    const r = reading(v.value);
    expect(r?.ratePer100k?.area).toBe(10_891); // 1144 / 10504 * 100000
  });

  it('2. postcode population withheld → no rate is calculated', () => {
    const v = admitPopulationForArea(null, 'postcode', '2794');
    expect(v.value).toBeNull();
    expect(v.refusedBecause).toBe('not_admitted');
    expect(reading(v.value)?.ratePer100k).toBeNull();
  });

  it('3. unresolved geography cannot recover a population through the free-text postcode', () => {
    // This is the whole defect: with geography unresolved nothing upstream
    // produces a candidate at all, so there is nothing to admit. The module
    // cannot be talked into finding one — it has no lookup.
    const v = admitPopulationForArea(undefined, 'postcode', '2794');
    expect(v.value).toBeNull();
    expect(reading(v.value)?.ratePer100k).toBeNull();
    // And the service that used to do the lookup no longer contains one.
    expect(codeOnly(service)).not.toContain('abs_census_poa');
  });
});

describe('F4 — 4/5: grain is explicit and never substituted', () => {
  it('4. an LGA population may not divide postcode offence counts', () => {
    const lga: AdmittedPopulation = { ...COWRA, grain: 'lga', geography: 'Cowra Shire' };
    const v = admitPopulationForArea(lga, 'postcode', '2794');
    expect(v.value).toBeNull();
    expect(v.refusedBecause).toBe('grain_mismatch');
  });

  it('5. an SA2 population may not divide postcode offence counts', () => {
    const sa2: AdmittedPopulation = { ...COWRA, grain: 'sa2', geography: 'Cowra' };
    expect(admitPopulationForArea(sa2, 'postcode', '2794').refusedBecause).toBe('grain_mismatch');
    // ...and the reverse direction is refused too.
    expect(admitPopulationForArea(COWRA, 'sa2', 'Cowra').refusedBecause).toBe('grain_mismatch');
  });

  it('the reading NAMES its own grain, so a wider statistic cannot read as postcode evidence', () => {
    // `areaKind` is what the document prints beside the number. A rate that
    // belongs to an LGA must say so; the requirement is that the grain travels
    // with the figure rather than being inferred from where it appears.
    const r = reading(10_504);
    expect(r?.areaKind).toBe('postcode');
    expect(r?.area).toBe('2794');
    // The four registers publish at three different grains and each is named
    // by the reader, never defaulted.
    const kinds = readFileSync(
      resolve(REPO, 'supabase/functions/_shared/crimeReading.pure.ts'), 'utf8',
    );
    expect(kinds).toContain("'local government area'");
    expect(kinds).toContain("'reporting region'");
    expect(kinds).toContain("'postcode'");
  });

  it('the right grain for the wrong area is its own refusal', () => {
    expect(admitPopulationForArea(COWRA, 'postcode', '2795').refusedBecause)
      .toBe('geography_mismatch');
    // Case and padding are not a geography difference.
    expect(admitPopulationForArea({ ...COWRA, geography: ' 2794 ' }, 'postcode', '2794').value)
      .toBe(10_504);
  });
});

describe('F4 — 6/9/10: supported crime evidence is untouched', () => {
  it('6. raw offence counts remain when no rate can be calculated', () => {
    const r = reading(null);
    expect(r).not.toBeNull();
    expect(r?.totalLast12Months).toBe(1144);
    expect(r?.ratePer100k).toBeNull();
  });

  it('9. trend and change survive the refusal', () => {
    const withRate = reading(10_504);
    const without = reading(null);
    // Everything except the rate is identical: refusing a denominator is not
    // refusing the register.
    expect(without?.totalLast12Months).toBe(withRate?.totalLast12Months);
    expect(without?.latestMonth).toBe(withRate?.latestMonth);
    expect(without?.source).toBe(withRate?.source);
  });

  it('10. the BOCSAR source and area are still named', () => {
    const r = reading(null);
    expect(r?.source).toContain('BOCSAR');
    expect(r?.area).toBe('2794');
  });
});

describe('F4 — 7: the crime module cannot bypass governed evidence authority', () => {
  it('7. the service performs no population lookup of any kind', () => {
    const code = codeOnly(service);
    expect(code).not.toContain('abs_census_poa');
    // It must consume an admitted value rather than resolve one.
    expect(service).toContain('admitPopulationForArea');
    expect(service).toContain("from '../_shared/crimePopulationAdmission.pure.ts'");
  });

  it('a population with no provenance is not admitted evidence', () => {
    for (const bad of [
      { ...COWRA, source: '' },
      { ...COWRA, vintage: '' },
      { ...COWRA, geography: '' },
    ]) {
      expect(admitPopulationForArea(bad, 'postcode', '2794').value).toBeNull();
    }
  });

  it('a zero or negative population is refused rather than treated as absent', () => {
    expect(admitPopulationForArea({ ...COWRA, value: 0 }, 'postcode', '2794').refusedBecause)
      .toBe('not_a_population');
    expect(admitPopulationForArea({ ...COWRA, value: -1 }, 'postcode', '2794').refusedBecause)
      .toBe('not_a_population');
    expect(admitPopulationForArea({ ...COWRA, value: Number.NaN }, 'postcode', '2794').refusedBecause)
      .toBe('not_a_population');
  });

  it('the generator requires BOTH trusted geography AND canonical admission', () => {
    // (1) trusted geography — the boundary service's own POA.
    expect(generator).toContain('const crimePoa = subjectPostcodeOf(subjectGeography);');
    // (2) canonical admission — the population comes from the ADMITTED
    //     demographics payload, not from a table this function reads itself.
    expect(generator).toContain('const admittedPop = (enhancedData.demographics as {');
    expect(generator).toContain('const admittedPopValue = typeof admittedPop?.total === \'number\'');
    // Both, in one condition. Either alone must not authorise a denominator.
    expect(generator).toMatch(/if \(crimePoa && admittedPopValue &&/);
    expect(generator).toContain("grain: 'postcode'");
  });

  it('the generator performs no population lookup of its own', () => {
    // The whole repair: holding a correct postcode must not let anything go
    // and FIND a population. A direct read here would simply move the side
    // channel one function upstream.
    const code = codeOnly(generator);
    expect(code).not.toMatch(/from\('abs_census_poa'\)[\s\S]{0,200}crimePoa/);
    expect(code).not.toMatch(/crimePoa[\s\S]{0,300}from\('abs_census_poa'\)/);
  });

  it('every refusal has an operator-facing note and none names a client', () => {
    for (const note of Object.values(ADMISSION_REFUSAL_NOTE)) {
      expect(note).toMatch(/rate/i);
      expect(note.length).toBeGreaterThan(40);
    }
    // The notes explain OUR limitation, never the customer's address.
    expect(Object.values(ADMISSION_REFUSAL_NOTE).join(' ')).not.toMatch(/address/i);
  });
});

describe('F4 — 8: the Cowra replay', () => {
  it('reproduces the former defect and proves the corrected behaviour', () => {
    // BEFORE — the service found 10,504 for itself on an untrusted postcode.
    const before = reading(10_504);
    expect(before?.ratePer100k?.area).toBe(10_891);

    // AFTER — geography unresolved, so nothing admits a population, so the
    // document carries counts and no rate. The contradiction is gone: there is
    // no figure on the page that requires a population the report withheld.
    const admission = admitPopulationForArea(null, 'postcode', '2794');
    const after = reading(admission.value);
    expect(after?.ratePer100k).toBeNull();
    expect(after?.totalLast12Months).toBe(1144);

    // And once geography DOES resolve, the same 10,891 returns — through the
    // front door, with its denominator described.
    const admitted = admitPopulationForArea(COWRA, 'postcode', '2794');
    expect(reading(admitted.value)?.ratePer100k?.area).toBe(10_891);
    expect(admitted.admitted?.source).toBe('abs_census_poa');
    expect(admitted.admitted?.vintage).toBe('2021 Census usual residents');
  });
});


// ── §3 — the five provenance cases, stated as the release instruction states them
//
// "Resolved geography alone must never authorise a population denominator.
//  The crime denominator must require BOTH (1) trusted/resolved geography at
//  the required grain AND (2) population evidence admitted through the
//  canonical evidence-authority pathway."
//
// The generator's gate is `crimePoa && admittedPopValue`, so each case below
// is modelled as the pair that gate receives, and then carried through the
// service's own admission check to the reading that is actually served.
describe('F4 §3 — provenance cases A to E', () => {
  /** Exactly the generator's two conditions, then the service's admission. */
  const served = (
    trustedPoa: string | null,
    admitted: AdmittedPopulation | null,
    areaKey = '2794',
  ) => {
    // (1) no trusted geography → the generator never offers a population.
    // (2) no admitted demographics → likewise.
    const offered = trustedPoa && admitted ? admitted : null;
    const verdict = admitPopulationForArea(offered, 'postcode', areaKey);
    return { verdict, reading: reading(verdict.value) };
  };

  it('A. resolved geography + admitted same-grain population → rate permitted', () => {
    const { verdict, reading: r } = served('2794', COWRA);
    expect(verdict.refusedBecause).toBeNull();
    expect(r?.ratePer100k?.area).toBe(10_891);
    expect(r?.ratePer100k?.denominator).toContain('2021 Census usual residents');
  });

  it('B. resolved geography + population withheld → rate NOT calculated', () => {
    // The demographics payload is absent, so `admittedPopValue` is null even
    // though the POA is trusted. Condition (1) alone is not enough.
    const { verdict, reading: r } = served('2794', null);
    expect(verdict.refusedBecause).toBe('not_admitted');
    expect(r?.ratePer100k).toBeNull();
    expect(r?.totalLast12Months).toBe(1144); // counts survive
  });

  it('C. correct postcode + candidate fails canonical admission → rate NOT calculated', () => {
    // A population that exists but carries no provenance never became admitted
    // evidence, so it cannot become a denominator however right the postcode is.
    const unprovenanced = { ...COWRA, source: '', vintage: '' };
    const { verdict, reading: r } = served('2794', unprovenanced);
    expect(verdict.value).toBeNull();
    expect(r?.ratePer100k).toBeNull();
  });

  it('D. unresolved geography + free-text postcode → rate NOT calculated', () => {
    // This is the production defect. `subjectPostcodeOf(null)` yields nothing,
    // so the generator offers no population at all — and even if a candidate
    // were somehow constructed, the service has no lookup to fall back on.
    const { verdict, reading: r } = served(null, COWRA);
    expect(verdict.refusedBecause).toBe('not_admitted');
    expect(r?.ratePer100k).toBeNull();
    expect(r?.totalLast12Months).toBe(1144);
    expect(r?.area).toBe('2794');
    expect(r?.areaKind).toBe('postcode');
  });

  it('E. admitted population at a mismatched grain → not presented as postcode evidence', () => {
    const lga: AdmittedPopulation = {
      ...COWRA, grain: 'lga', geography: 'Cowra Shire',
    };
    const { verdict, reading: r } = served('2794', lga);
    expect(verdict.refusedBecause).toBe('grain_mismatch');
    expect(r?.ratePer100k).toBeNull();
    // What IS presented still names its own grain honestly.
    expect(r?.areaKind).toBe('postcode');
  });

  it('the two conditions are independent — neither alone authorises', () => {
    expect(served('2794', null).verdict.value).toBeNull();   // geography only
    expect(served(null, COWRA).verdict.value).toBeNull();    // admission only
    expect(served('2794', COWRA).verdict.value).toBe(10_504); // both
  });
});

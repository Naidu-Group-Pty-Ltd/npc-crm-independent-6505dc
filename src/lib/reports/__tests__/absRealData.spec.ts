/**
 * The real ABS data path — parser, projection and prompt blocks, pinned.
 *
 * On 2026-09-06 the platform's demographic, employment and SEIFA figures
 * stopped being invented (§24) and started being the ABS's own: the
 * `abs-poa-ingest` edge function downloads the published 2021 Census GCP
 * DataPack (POA) and the SEIFA 2021 POA workbook, parses them through
 * `_shared/absPoaIngest.pure.ts`, verifies national totals, and loads
 * `abs_census_poa` / `abs_seifa_poa`. The production load was verified
 * against the source files: 2,643 POAs, national population 25,422,756
 * (the Census counted 25,422,788; POA coverage excludes the
 * migratory/offshore remainder), 2,627 SEIFA rows, all matched.
 *
 * `POA_2150` below is the loaded production row for Parramatta, verbatim —
 * every figure traceable to the DataPack. It is the fixture because an
 * invented fixture proves only that the assertion matches the fixture.
 */
import { describe, expect, it } from 'vitest';
import {
  GCP_TABLES,
  assembleCensusRows,
  checkSeifaCoverage,
  parseGcpCsv,
  parseSeifaTable1,
} from '../../../../supabase/functions/_shared/absPoaIngest.pure';
import {
  censusDemographicsResponse,
  censusEmploymentResponse,
  employmentRateOfLabourForce,
  topIndustries,
  type AbsCensusPoaTableRow,
} from '../../../../supabase/functions/_shared/absCensusProjection.pure';
import {
  demographicsStatBlocks,
  industryTable,
  populationEmploymentTable,
  seifaTable,
} from '../../../../supabase/functions/_shared/reports/censusPromptBlocks.pure';

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

describe('parseGcpCsv', () => {
  it('maps columns by header name and strips the POA prefix', () => {
    const csv = 'POA_CODE_2021,Tot_P_P,Other\nPOA2000,27936,1\nPOA2150,35254,2\n';
    const out = parseGcpCsv(csv, ['Tot_P_P']);
    expect(out.get('2000')).toEqual({ Tot_P_P: 27936 });
    expect(out.get('2150')).toEqual({ Tot_P_P: 35254 });
  });

  it('reads an empty cell as null — the ABS suppresses, it never zeroes', () => {
    const csv = 'POA_CODE_2021,Median_rent_weekly\nPOA0872,\n';
    expect(parseGcpCsv(csv, ['Median_rent_weekly']).get('0872')).toEqual({ Median_rent_weekly: null });
  });

  it('throws on a column the file does not have — a mistyped name is never silent', () => {
    // The Airtable lesson: undefined for a wrong column looks exactly like an
    // empty one, and that invisibility is how the worst defects here lived.
    expect(() => parseGcpCsv('POA_CODE_2021,Tot_P_P\nPOA2000,5\n', ['Tot_P_p']))
      .toThrow(/column Tot_P_p not found/);
  });

  it('refuses a zero-row parse and a non-numeric cell', () => {
    expect(() => parseGcpCsv('POA_CODE_2021,Tot_P_P\n', ['Tot_P_P'])).toThrow(/no data rows|zero POAs/);
    expect(() => parseGcpCsv('POA_CODE_2021,Tot_P_P\nPOA2000,abc\n', ['Tot_P_P'])).toThrow(/non-numeric/);
  });
});

describe('parseSeifaTable1', () => {
  /** The sheet's real geometry: titles, group header (row 5), column header, data. */
  const sheet = (firstIndex: string, secondIndex: string): unknown[][] => [
    [], [], [], ['Table 1 Postal Area (POA) SEIFA Summary, 2021'],
    [null, firstIndex, null, secondIndex, null, 'Index of Economic Resources', null, 'Index of Education and Occupation'],
    ['2021 Postal Area (POA) Code', 'Score', 'Decile', 'Score', 'Decile', 'Score', 'Decile', 'Score', 'Decile', 'Usual Resident Population'],
    // POA 0800 (Darwin CBD), verbatim from the published workbook.
    ['0800', 1064.3497942, 9, 1084.2614326, 9, 921.3952539, 1, 1089.647675, 9, 7149],
  ];

  it('parses the real column order: IRSD first, then IRSAD', () => {
    const rows = parseSeifaTable1(sheet(
      'Index of Relative Socio-economic Disadvantage',
      'Index of Relative Socio-economic Advantage and Disadvantage',
    ));
    expect(rows).toHaveLength(1);
    expect(rows[0].poa).toBe('0800');
    expect(rows[0].irsd_score).toBe(1064.3);
    expect(rows[0].irsad_score).toBe(1084.3);
    expect(rows[0].ier_decile).toBe(1);
    expect(rows[0].usual_resident_population).toBe(7149);
  });

  it('refuses a sheet whose index order is not what the header says', () => {
    // The platform's old fabricated shape listed IRSAD first; loading a sheet
    // on that assumption would swap advantage for disadvantage on every
    // report. The header is the authority and a mismatch refuses the load.
    expect(() => parseSeifaTable1(sheet(
      'Index of Relative Socio-economic Advantage and Disadvantage',
      'Index of Relative Socio-economic Disadvantage',
    ))).toThrow(/column order/);
  });
});

describe('assembleCensusRows verification', () => {
  it('refuses a national population that is not the 2021 Census', () => {
    const one = (cols: Record<string, number>) => new Map([['2000', cols]]);
    const gcp = {
      G01: one({ Tot_P_P: 1000 }), G02: one({}), G37: one({}), G46B: one({}),
      G54C: one({}), G54D: one({}), G60B: one({}),
    } as never;
    // 1 POA / 1,000 people is a truncated download, not Australia.
    expect(() => assembleCensusRows(gcp)).toThrow(/outside the plausible range/);
  });

  it('checkSeifaCoverage refuses a join that did not land', () => {
    const census = Array.from({ length: 2500 }, (_, i) => ({ poa: String(1000 + i) })) as never;
    expect(() => checkSeifaCoverage(census, new Set(['9999']))).toThrow(/join key is wrong/);
    expect(checkSeifaCoverage(census, new Set(Array.from({ length: 2500 }, (_, i) => String(1000 + i))))).toBe(2500);
  });
});

// ---------------------------------------------------------------------------
// Projection — the loaded production row for Parramatta, verbatim
// ---------------------------------------------------------------------------

/** abs_census_poa row for POA 2150 as loaded from the DataPack (2026-09-06). */
const POA_2150: AbsCensusPoaTableRow = {
  poa: '2150',
  population: 35254,
  median_age: 32,
  median_rent_weekly: 425,
  median_hh_income_weekly: 2055,
  median_personal_income_weekly: 970,
  median_family_income_weekly: 2262,
  median_mortgage_monthly: 2002,
  avg_household_size: 2.4,
  owned_outright: 1301,
  owned_mortgage: 2400,
  rented: 9591,
  tenure_total: 13624,
  owner_occupier_rate: 27.2,
  renter_rate: 70.4,
  employed: 18480,
  unemployed: 1439,
  labour_force: 19925,
  not_in_labour_force: 7586,
  pop_15_plus: 29599,
  unemployment_rate: 7.2,
  participation_rate: 67.3,
  employment_to_pop_rate: 62.4,
  industries: [
    { name: 'Professional, Scientific and Technical Services', employed: 3677, percentage: 19.9 },
    { name: 'Health Care and Social Assistance', employed: 2307, percentage: 12.5 },
    { name: 'Financial and Insurance Services', employed: 1755, percentage: 9.5 },
    { name: 'Retail Trade', employed: 1636, percentage: 8.9 },
    { name: 'Accommodation and Food Services', employed: 1078, percentage: 5.8 },
    { name: 'Construction', employed: 729, percentage: 3.9 },
  ],
  occupations: [
    { name: 'Professionals', employed: 7464, percentage: 40.4 },
    { name: 'Managers', employed: 1858, percentage: 10.1 },
    { name: 'Clerical and Administrative Workers', employed: 2169, percentage: 11.7 },
  ],
  reference_period: '2021',
  source: 'ABS Census 2021 GCP DataPack (POA) G01/G02/G37/G46/G54/G60; SEIFA 2021 POA indexes',
};

describe('censusDemographicsResponse', () => {
  const res = censusDemographicsResponse(POA_2150);

  it('serves the ABS figures under their true vintage', () => {
    expect(res.population.total).toBe(35254);
    expect(res.income.medianWeeklyIncome).toBe(2055);
    expect(res.income.medianHouseholdIncome).toBe(2055 * 52); // annualised, disclosed
    expect(res.income.unemploymentRate).toBe(7.2);
    expect(res.housing.ownerOccupierRate).toBe(27.2);
    expect(res.housing.medianRent).toBe(425);
    expect(res.dataSource).toBe('ABS Census 2021 (POA 2150)');
    expect(res.dataQuality).toBe('census');
    expect(res.referencePeriod).toBe('2021');
  });

  it('never claims a vintage the data does not have', () => {
    expect(JSON.stringify(res)).not.toContain('2025');
    expect(JSON.stringify(res)).not.toContain('estimate');
  });

  it('employment rate is employed over labour force, as the label promises', () => {
    // 18,480 / 19,925 = 92.7% — NOT the employment-to-population ratio
    // (62.4%), which is published under its own name beside it.
    expect(employmentRateOfLabourForce(POA_2150)).toBe(92.7);
    expect(res.employment.employmentRate).toBe(92.7);
    expect(res.employment.employmentToPopulationRate).toBe(62.4);
  });

  it('top industries are sorted by measured employment, not by template position', () => {
    const top = topIndustries(POA_2150);
    expect(top[0].name).toBe('Professional, Scientific and Technical Services');
    expect(top[1].name).toBe('Health Care and Social Assistance');
    expect(top).toHaveLength(5);
  });

  it('offers no growth figure of any kind', () => {
    const s = JSON.stringify(res).toLowerCase();
    expect(s).not.toContain('growth');
    expect(s).not.toContain('outlook');
    expect(s).not.toContain('trend');
  });
});

describe('censusEmploymentResponse', () => {
  const res = censusEmploymentResponse(POA_2150, 'Parramatta', 'NSW');

  it('is local, labelled, and free of invented series', () => {
    expect(res.postcode).toBe('2150');
    expect(res.laborForceSize).toBe(19925);
    expect(res.majorIndustries[0]).toEqual({ name: 'Professional, Scientific and Technical Services', percentage: 19.9 });
    expect(res.medianIncome.weekly).toBe(970);
    expect(res.medianIncome.annual).toBe(970 * 52);
    const s = JSON.stringify(res);
    // The fabricated predecessor's signatures, none of which may return.
    expect(s).not.toContain('jobGrowth');
    expect(s).not.toContain('futureOutlook');
    expect(s).not.toContain('Latest available data');
    expect(s).not.toMatch(/\+\d+\.\d+%/);
  });
});

// ---------------------------------------------------------------------------
// Prompt blocks — the tables the model is handed
// ---------------------------------------------------------------------------

describe('demographicsStatBlocks', () => {
  const input = {
    demographics: censusDemographicsResponse(POA_2150),
    employmentData: censusEmploymentResponse(POA_2150, 'Parramatta', 'NSW'),
    seifaData: {
      irsad: { score: 1054.6, decile: 9, description: 'Very High Advantage' },
      irsd: { score: 1002.6, decile: 5, description: 'Index of Relative Socio-economic Disadvantage' },
      ier: { score: 885.7, decile: 1, description: 'Index of Economic Resources' },
      ieo: { score: 1110.9, decile: 9, description: 'Index of Education and Occupation' },
      referencePeriod: '2021',
    },
  };

  it('writes industry rows from the data, largest first — no fixed names', () => {
    const t = industryTable(input);
    const lines = t.split('\n');
    expect(lines[2]).toContain('Professional, Scientific and Technical Services');
    expect(lines[2]).toContain('19.9%');
    // The old template's row five was always "Construction"; here row five is
    // whatever actually ranks fifth.
    expect(lines[6]).toContain('Accommodation and Food Services');
    expect(t).not.toContain('Growth');
  });

  it('labels every figure with its true vintage', () => {
    const t = populationEmploymentTable(input);
    expect(t).toContain('ABS Census 2021 (POA)');
    expect(t).not.toContain('2025');
    expect(t).toContain('| Unemployment Rate | 7.2% |');
    expect(t).toContain('Median Annual Household Income (annualised from weekly) | $106,860');
  });

  it('renders SEIFA from data and never asserts a rating without one', () => {
    const t = seifaTable(input);
    expect(t).toContain('| IRSAD | 1055 | 9/10 |');
    expect(t).toContain('| IER | 886 | 1/10 |');
    expect(seifaTable({})).toBe('');
    expect(seifaTable({ seifaData: { irsad: { score: null, decile: null } } })).toBe('');
  });

  it('a labelled row is a promise — absent figures omit the row', () => {
    const thin = { demographics: { income: { unemploymentRate: 5.1, referencePeriod: '2021' } } };
    const t = populationEmploymentTable(thin);
    expect(t).toContain('Unemployment Rate');
    expect(t).not.toContain('Labour Force');
    expect(t).not.toContain('XX');
  });

  it('with nothing available, says so in one honest line — no placeholder grid', () => {
    const out = demographicsStatBlocks({});
    expect(out).toContain('unavailable');
    expect(out).not.toContain('|');
  });

  it('always forbids growth assertions when tables are present', () => {
    const out = demographicsStatBlocks(input);
    expect(out).toContain('do NOT assert job-growth');
    expect(out).not.toContain('XX');
    expect(out).not.toContain("|| '");
  });
});

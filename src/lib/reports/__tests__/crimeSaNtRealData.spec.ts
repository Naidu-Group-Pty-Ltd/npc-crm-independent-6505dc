/**
 * South Australia and the Northern Territory — the contracts, pinned against
 * the real files' measured shapes.
 *
 * Every number here was produced by parsing the published files in full on
 * 2026-09-07 (eight of them: SAPOL's seven financial years and NT's June 2026
 * release), and each parse was cross-checked against an independent
 * implementation before a line of this was written. The production load
 * reproduced them to the digit — acquisition log in
 * `docs/reports/CRIME_SOURCES.md`.
 *
 * The fixtures reproduce the files' quirks exactly: SAPOL's `NOT DISCLOSED`
 * postcode, its leading-zero damage on 0872, its interstate incident rows and
 * its July 2025 reclassification; NT's trailing space in `Offence type ` and
 * its alcohol/DV cross-tabulation.
 */
import { describe, expect, it } from 'vitest';
import {
  assertNtCellsDisjoint,
  auDateToIsoMonth,
  isSaPostcode,
  MALFORMED_ROW_TOLERANCE,
  NT_MIN_PUBLISHED_ROWS,
  RATIO_FLOOR_ROWS,
  SA_MIN_PUBLISHED_ROWS,
  assertPublishedSize,
  normaliseSaPostcode,
  NT_HEADER,
  NT_OFFENCE_CATEGORIES,
  NT_REGIONS,
  parseNtCrimeCsv,
  parseSaCrimeCsv,
  SA_CLASSIFICATION_FROM,
  SA_HEADER,
  SA_LEVEL1,
  SA_LEVEL2_CURRENT,
  SA_LEVEL2_SERIES_NOTE,
  saFinancialYearLabel,
  totalsByOffence,
  UNATTRIBUTABLE_ROW_TOLERANCE,
  windowsFromMonthCounts,
} from '../../../../supabase/functions/_shared/crimeIngestSaNt.pure';
import {
  ntCrimeReading,
  saCrimeReading,
  stateContextFrom,
} from '../../../../supabase/functions/_shared/crimeReading.pure';
import { crimeStatBlocks } from '../../../../supabase/functions/_shared/reports/crimePromptBlocks.pure';

// ---------------------------------------------------------------------------
// Fixtures — the real files' shapes in miniature
// ---------------------------------------------------------------------------

const saRow = (date: string, suburb: string, pc: string, l1: string, l2: string, l3: string, n: string) =>
  [date, suburb, pc, l1, l2, l3, n].join(',');

const saCsv = (rows: string[]) => [SA_HEADER.join(','), ...rows].join('\n');

const ntRow = (
  year: string, month: string, cat: string, type: string,
  alcohol: string, dv: string, region: string, sa2: string, n: string,
) => ['4/08/2026', year, month, cat, type, alcohol, dv, region, sa2, n].join(',');

const ntCsv = (rows: string[]) => [NT_HEADER.join(','), ...rows].join('\n');

// ---------------------------------------------------------------------------
// SA — the postcode rules
// ---------------------------------------------------------------------------

describe('SA postcodes: padding is not a guess, and interstate rows are not SA', () => {
  it('pads a stripped leading zero, because one postcode arrived under two spellings', () => {
    // Measured in FY2025-26: `0872` carries 699 offences and `872` carries 9
    // more — the same postal area split into two keys by an export that lost
    // the leading zero.
    expect(normaliseSaPostcode('872')).toBe('0872');
    expect(normaliseSaPostcode('0872')).toBe('0872');
    expect(normaliseSaPostcode('5000')).toBe('5000');
  });

  it('refuses anything that is not a postcode at all', () => {
    for (const v of ['NOT DISCLOSED', '', '  ', 'SA5000', '50000']) {
      expect(normaliseSaPostcode(v), v).toBeNull();
    }
  });

  it('keeps SA postal areas and 0872, and excludes the interstate scatter', () => {
    expect(isSaPostcode('5000')).toBe(true);
    expect(isSaPostcode('5999')).toBe(true);
    expect(isSaPostcode('0872')).toBe(true);
    // SAPOL records incidents outside the state; measured FY2025-26, 55 rows.
    // Keeping them would put "2 recorded offences" against Sydney's postcode
    // 2000 in a register that is not Sydney's.
    for (const pc of ['2000', '3000', '4810', '6430', '7253', '0870']) {
      expect(isSaPostcode(pc), pc).toBe(false);
    }
  });

  it('reads the register date format and refuses anything else', () => {
    expect(auDateToIsoMonth('01/07/2025')).toBe('2025-07');
    expect(auDateToIsoMonth('31/12/2019')).toBe('2019-12');
    for (const v of ['2025-07-01', '', 'Jul 2025', '01/13/2025']) {
      expect(auDateToIsoMonth(v), v).toBeNull();
    }
  });
});

describe('the SAPOL catalogue matcher never picks up a Family & Domestic Abuse file', () => {
  it('matches the crime family, both capitalisations the catalogue uses', () => {
    expect(saFinancialYearLabel('Crime Statistics 2025-26')).toBe('2025-26');
    expect(saFinancialYearLabel('Crime statistics 2016-17')).toBe('2016-17');
  });

  it('refuses the FDA family, which SAPOL states is a SUBSET of the crime file', () => {
    // "the two files for the same financial year must not be added together"
    // — data.sa.gov.au's own dataset note. A matcher that picked one up would
    // double-count every domestic-abuse offence in that year.
    for (const n of [
      'Family & Domestic Abuse related-offences 2025-26',
      'Family & Domestic Abuse-related offences 2010-11',
      'data_sa_fdv_q1_q2_q3_q4_2025-26',
    ]) {
      expect(saFinancialYearLabel(n), n).toBeNull();
    }
  });
});

describe('parsing a SAPOL financial year', () => {
  const csv = saCsv([
    saRow('01/07/2025', 'ADELAIDE', '5000', 'OFFENCES AGAINST PROPERTY', 'THEFT', 'Theft from retail premises', '3'),
    saRow('15/07/2025', 'ADELAIDE', '5000', 'OFFENCES AGAINST THE PERSON', 'ASSAULT', 'Serious Assault', '2'),
    saRow('02/08/2025', 'UMUWA', '872', 'OFFENCES AGAINST PROPERTY', 'THEFT', 'Theft from a person', '1'),
    saRow('03/08/2025', 'NOT DISCLOSED', 'NOT DISCLOSED', 'OFFENCES AGAINST PROPERTY', 'THEFT', 'Theft from a person', '7'),
    saRow('04/08/2025', 'SYDNEY', '2000', 'OFFENCES AGAINST PROPERTY', 'THEFT', 'Theft from a person', '5'),
  ]);
  const parsed = parseSaCrimeCsv(csv);

  it('counts only offences it can place in South Australia', () => {
    // 3 + 2 + 1 = 6. The NOT DISCLOSED row (7) and the Sydney row (5) are
    // both real offences and neither belongs to an SA postcode.
    expect(parsed.audit.totalCount).toBe(6);
    expect(parsed.audit.rows).toBe(3);
  });

  it('reports the unplaced rows rather than hiding them, and keeps them out of malformed', () => {
    expect(parsed.audit.unattributable).toEqual({ not_disclosed: 1 });
    expect(parsed.audit.excludedInterstate).toBe(1);
    expect(parsed.audit.malformed).toEqual({});
  });

  it('folds 872 and 0872 into one postal area', () => {
    const umuwa = parsed.level1.filter((c) => c.area === '0872');
    expect(umuwa).toHaveLength(1);
    expect(umuwa[0].count).toBe(1);
  });

  it('refuses a drifted header rather than reading the wrong columns', () => {
    const drifted = saCsv([]).replace('Postcode - Incident', 'Postcode');
    expect(() => parseSaCrimeCsv(drifted)).toThrow(/header mismatch/i);
  });

  it('refuses an unknown Level 1, because that is the classification moving', () => {
    const bad = saCsv([
      saRow('01/07/2025', 'ADELAIDE', '5000', 'OFFENCES AGAINST THE PLANET', 'THEFT', 'x', '1'),
    ]);
    expect(() => parseSaCrimeCsv(bad)).toThrow(/unknown Offence Level 1/i);
  });
});

describe('the July 2025 reclassification is a boundary, not a rename', () => {
  it('collects Level 2 only from the current classification', () => {
    const csv = saCsv([
      // Under the OLD classification — Level 1 still counts, Level 2 does not.
      saRow('01/06/2025', 'ADELAIDE', '5000', 'OFFENCES AGAINST PROPERTY', 'THEFT AND RELATED OFFENCES', 'Theft from shop', '4'),
      // Under the NEW one.
      saRow('01/08/2025', 'ADELAIDE', '5000', 'OFFENCES AGAINST PROPERTY', 'THEFT', 'Theft from retail premises', '6'),
    ]);
    const parsed = parseSaCrimeCsv(csv);
    expect(parsed.level1).toHaveLength(2);
    expect(parsed.level1.reduce((s, c) => s + c.count, 0)).toBe(10);
    // Only the post-boundary month reaches Level 2, so the stored series is
    // ONE classification rather than two under overlapping names.
    expect(parsed.level2.map((c) => [c.offence, c.month, c.count])).toEqual([['THEFT', '2025-08', 6]]);
  });

  it('the boundary is the month SAPOL changed, stated once', () => {
    expect(SA_CLASSIFICATION_FROM).toBe('2025-07');
  });

  it('the current vocabulary is the nine categories the current file carries', () => {
    expect([...SA_LEVEL2_CURRENT].sort()).toEqual([...SA_LEVEL2_CURRENT].sort());
    expect(SA_LEVEL2_CURRENT).toHaveLength(9);
    expect(SA_LEVEL2_CURRENT).toContain('HARM OR ENDANGER PERSONS');
    // The pre-2025 spellings must NOT be in the current set — they are
    // different groupings, not older names for these.
    for (const old of [
      'ACTS INTENDED TO CAUSE INJURY', 'THEFT AND RELATED OFFENCES',
      'PROPERTY DAMAGE AND ENVIRONMENTAL', 'SEXUAL ASSAULT AND RELATED OFFENCES',
      'ROBBERY AND RELATED OFFENCES', 'HOMICIDE AND RELATED OFFENCES',
      'OTHER OFFENCES AGAINST THE PERSON', 'FRAUD DECEPTION AND RELATED OFFENCES',
    ]) {
      expect(SA_LEVEL2_CURRENT, old).not.toContain(old);
    }
  });

  it('a Level 2 window carries no prior year, and the reason travels with it', () => {
    const counts = [
      { area: '5000', offence: 'THEFT', month: '2025-07', count: 10 },
      { area: '5000', offence: 'THEFT', month: '2026-06', count: 12 },
    ];
    const [row] = windowsFromMonthCounts(counts, { comparablePrior: false });
    expect(row.prior12).toBeNull();
    expect(row.months12).toBe(22);
    // And the note is a sentence a reader gets, not a code comment.
    expect(SA_LEVEL2_SERIES_NOTE).toMatch(/classification/i);
    expect(SA_LEVEL2_SERIES_NOTE).toMatch(/no like-for-like comparison/i);
  });

  it('Level 1 keeps its prior year, because those two groupings did not move', () => {
    const months = Array.from({ length: 24 }, (_, i) => {
      const m = ((i + 6) % 12) + 1;
      const y = 2024 + Math.floor((i + 6) / 12);
      return { area: '5000', offence: SA_LEVEL1[0], month: `${y}-${String(m).padStart(2, '0')}`, count: 10 };
    });
    const [row] = windowsFromMonthCounts(months, { comparablePrior: true });
    expect(row.months12).toBe(120);
    expect(row.prior12).toBe(120);
  });
});

// ---------------------------------------------------------------------------
// NT — the cross-tabulation
// ---------------------------------------------------------------------------

describe('NT: the alcohol/DV rows are a cross-tab, and summing them is proved safe', () => {
  it('transcribes the trailing space in the published header', () => {
    // `Offence type ` — the file's own. Tidying it here is a column the file
    // does not have, and that failure is invisible.
    expect(NT_HEADER[4]).toBe('Offence type ');
    expect(NT_HEADER).toHaveLength(10);
  });

  it('sums the four cells of one cross-tab into one offence count', () => {
    const csv = ntCsv([
      ntRow('2026', '6', '02 Assault', '021 Serious Assault', 'No', 'No', 'Darwin', '', '10'),
      ntRow('2026', '6', '02 Assault', '021 Serious Assault', 'No', 'Yes', 'Darwin', '', '5'),
      ntRow('2026', '6', '02 Assault', '021 Serious Assault', 'Yes', 'No', 'Darwin', '', '3'),
      ntRow('2026', '6', '02 Assault', '021 Serious Assault', 'Yes', 'Yes', 'Darwin', '', '2'),
    ]);
    const parsed = parseNtCrimeCsv(csv);
    expect(parsed.region).toEqual([{ area: 'Darwin', offence: '02 Assault', month: '2026-06', count: 20 }]);
    expect(parsed.audit.crossTabKeys).toBe(1);
  });

  it('refuses a repeated cell, which would be a duplicate counted twice', () => {
    const csv = ntCsv([
      ntRow('2026', '6', '02 Assault', '021 Serious Assault', 'No', 'No', 'Darwin', '', '10'),
      ntRow('2026', '6', '02 Assault', '021 Serious Assault', 'No', 'No', 'Darwin', '', '10'),
    ]);
    expect(() => parseNtCrimeCsv(csv)).toThrow(/repeated alcohol\/DV cell/i);
  });

  it("refuses a '-' total sitting beside its own parts — the QLD rollup trap", () => {
    const csv = ntCsv([
      ntRow('2026', '6', '02 Assault', '021 Serious Assault', '-', '-', 'Darwin', '', '20'),
      ntRow('2026', '6', '02 Assault', '021 Serious Assault', 'No', 'No', 'Darwin', '', '10'),
    ]);
    expect(() => parseNtCrimeCsv(csv)).toThrow(/total row sits beside its own parts/i);
  });

  it('the disjointness check is a function, so it can be asserted directly', () => {
    expect(() => assertNtCellsDisjoint(new Map([['k', ['No\tNo', 'Yes\tNo']]]))).not.toThrow();
    expect(() => assertNtCellsDisjoint(new Map([['k', ['No\tNo', 'No\tNo']]]))).toThrow();
    expect(() => assertNtCellsDisjoint(new Map([['k', ['-\t-', 'No\tNo']]]))).toThrow();
  });

  it('splits region from Statistical Area 2, which only NT Balance carries', () => {
    const csv = ntCsv([
      ntRow('2026', '6', '07 Theft', '07 Theft', '-', '-', 'Darwin', '', '10'),
      ntRow('2026', '6', '07 Theft', '07 Theft', '-', '-', 'NT Balance', 'East Arnhem', '4'),
      ntRow('2026', '6', '07 Theft', '07 Theft', '-', '-', 'NT Balance', 'Gulf', '6'),
    ]);
    const parsed = parseNtCrimeCsv(csv);
    expect(parsed.region.find((r) => r.area === 'NT Balance')?.count).toBe(10);
    expect(parsed.sa2.map((r) => [r.area, r.count]).sort()).toEqual([['East Arnhem', 4], ['Gulf', 6]]);
  });

  it('refuses an unknown category or region rather than dropping the rows', () => {
    expect(() => parseNtCrimeCsv(ntCsv([
      ntRow('2026', '6', '99 Space Piracy', 'x', '-', '-', 'Darwin', '', '1'),
    ]))).toThrow(/unknown Offence category/i);
    expect(() => parseNtCrimeCsv(ntCsv([
      ntRow('2026', '6', '07 Theft', 'x', '-', '-', 'Atlantis', '', '1'),
    ]))).toThrow(/unknown Reporting Region/i);
  });

  it('the transcribed vocabularies are the file’s own', () => {
    expect(NT_OFFENCE_CATEGORIES).toHaveLength(9);
    expect(NT_OFFENCE_CATEGORIES).toContain('061 Burglary - dwelling');
    expect(NT_REGIONS).toContain('NT Balance');
    expect(NT_REGIONS).toContain('Unknown');
  });
});

// ---------------------------------------------------------------------------
// The tolerances are two different things
// ---------------------------------------------------------------------------

describe('an unplaced row is not a malformed row', () => {
  it('holds the malformed cap far tighter than the unplaced one', () => {
    // Measured: malformed rows are 0-1 per file (worst case 1 in 84,949);
    // rows SAPOL declines to place run 1.18%-1.90% in every file and are the
    // register being careful, not a defect.
    expect(MALFORMED_ROW_TOLERANCE).toBeLessThan(UNATTRIBUTABLE_ROW_TOLERANCE);
    expect(UNATTRIBUTABLE_ROW_TOLERANCE).toBeGreaterThan(0.019);
  });

  it('refuses a file whose count column stopped being numbers', () => {
    const rows = Array.from({ length: RATIO_FLOOR_ROWS + 100 }, () =>
      saRow('01/07/2025', 'ADELAIDE', '5000', SA_LEVEL1[0], 'THEFT', 'x', 'n/a'));
    expect(() => parseSaCrimeCsv(saCsv(rows))).toThrow(/no usable data rows|malformed/i);
  });

  it('tolerates SAPOL’s own NOT DISCLOSED at its measured share', () => {
    const rows = [
      ...Array.from({ length: RATIO_FLOOR_ROWS + 100 }, () =>
        saRow('01/07/2025', 'ADELAIDE', '5000', SA_LEVEL1[0], 'THEFT', 'x', '1')),
      ...Array.from({ length: 10 }, () =>
        saRow('01/07/2025', 'NOT DISCLOSED', 'NOT DISCLOSED', SA_LEVEL1[0], 'THEFT', 'x', '1')),
    ];
    const parsed = parseSaCrimeCsv(saCsv(rows));
    expect(parsed.audit.rows).toBe(RATIO_FLOOR_ROWS + 100);
    expect(parsed.audit.unattributable.not_disclosed).toBe(10);
  });

  it('refuses a share it cannot compute, rather than computing it on four rows', () => {
    // One unplaced row in four is 25%, and says nothing at all about whether
    // a column moved. Below the floor the ratios are not asked; truncation is
    // a separate question, asked by the loader.
    const parsed = parseSaCrimeCsv(saCsv([
      saRow('01/07/2025', 'ADELAIDE', '5000', SA_LEVEL1[0], 'THEFT', 'x', '1'),
      saRow('01/07/2025', 'NOT DISCLOSED', 'NOT DISCLOSED', SA_LEVEL1[0], 'THEFT', 'x', '1'),
    ]));
    expect(parsed.audit.rows).toBe(1);
    expect(parsed.audit.unattributable.not_disclosed).toBe(1);
  });
});

describe('a short download is caught where the file is known to be a published one', () => {
  it('refuses a parse smaller than the register has ever published', () => {
    const audit = { rows: 400, unattributable: {}, malformed: {}, months: { from: '', to: '', count: 0 }, totalCount: 0 };
    expect(() => assertPublishedSize(audit, SA_MIN_PUBLISHED_ROWS, 'SA 2025-26'))
      .toThrow(/truncated download/i);
    expect(() => assertPublishedSize(audit, NT_MIN_PUBLISHED_ROWS, 'NT release'))
      .toThrow(/truncated download/i);
  });

  it('accepts the measured sizes, with room beneath the leanest real file', () => {
    // SAPOL's leanest financial year is 84,949 rows; NT's release is 9,723.
    expect(SA_MIN_PUBLISHED_ROWS).toBeLessThan(84_949);
    expect(NT_MIN_PUBLISHED_ROWS).toBeLessThan(9_723);
    const sa = { rows: 93_447, unattributable: { not_disclosed: 1024 }, malformed: {}, months: { from: '', to: '', count: 12 }, totalCount: 116_151 };
    expect(() => assertPublishedSize(sa, SA_MIN_PUBLISHED_ROWS, 'SA 2025-26')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// The readings, and what they refuse to say
// ---------------------------------------------------------------------------

const saRows = [
  { area: '5000', offence: 'OFFENCES AGAINST PROPERTY', months12: 6051, prior12: 6279, yearTotals: { '2025': 6094 }, latestMonth: '2026-06', seriesFrom: '2019-07' },
  { area: '5000', offence: 'OFFENCES AGAINST THE PERSON', months12: 2091, prior12: 2222, yearTotals: { '2025': 2098 }, latestMonth: '2026-06', seriesFrom: '2019-07' },
  { area: '5000', offence: 'THEFT', months12: 4130, prior12: null, yearTotals: {}, latestMonth: '2026-06', seriesFrom: '2025-07', seriesNote: SA_LEVEL2_SERIES_NOTE },
  { area: '5000', offence: 'ASSAULT', months12: 1865, prior12: null, yearTotals: {}, latestMonth: '2026-06', seriesFrom: '2025-07', seriesNote: SA_LEVEL2_SERIES_NOTE },
];

describe('the SA reading totals the stable grain and never both', () => {
  const reading = saCrimeReading(
    saRows, '5000', 'SAPOL',
    { area: 18202, state: 1790479, vintage: '2021 Census usual residents (POA)' },
    116151, null,
  )!;

  it('totals the two Level 1 groupings, not the overlapping Level 2 rows', () => {
    // 6,051 + 2,091 = 8,142. Adding the Level 2 rows would count Adelaide's
    // offences twice over.
    expect(reading.totalLast12Months).toBe(8142);
    expect(reading.totalPrevious12Months).toBe(8501);
    expect(reading.totalChangePct).toBe(-4.2);
  });

  it('leads with the stable grain and carries the note on the rest', () => {
    expect(reading.categories.slice(0, 2).map((c) => c.offence)).toEqual([...SA_LEVEL1]);
    const theft = reading.categories.find((c) => c.offence === 'THEFT')!;
    expect(theft.previous12Months).toBeNull();
    expect(theft.changePct).toBeNull();
    expect(theft.seriesNote).toBe(SA_LEVEL2_SERIES_NOTE);
  });

  it('names the denominator of every rate it publishes', () => {
    expect(reading.ratePer100k?.denominator).toMatch(/2021 Census usual residents/);
    expect(reading.ratePer100k?.area).toBe(Math.round((8142 / 18202) * 100_000));
  });
});

describe('the NT reading offers no rate, because no population is published for that geography', () => {
  const rows = [
    { area: 'Darwin', offence: '07 Theft', months12: 2769, prior12: 3329, yearTotals: { '2025': 2961 }, latestMonth: '2026-06', seriesFrom: '2023-12' },
    { area: 'Darwin', offence: '02 Assault', months12: 2334, prior12: 2676, yearTotals: { '2025': 2402 }, latestMonth: '2026-06', seriesFrom: '2023-12' },
  ];
  const reading = ntCrimeReading(rows, 'Darwin', 'reporting region', 'NT Police', null)!;

  it('sums the categories, which partition', () => {
    expect(reading.totalLast12Months).toBe(5103);
    expect(reading.totalPrevious12Months).toBe(6005);
  });

  it('publishes no per-capita rate rather than one with an unnamed denominator', () => {
    expect(reading.ratePer100k).toBeNull();
  });

  it('names the geography that answered, because a region is not a suburb', () => {
    expect(reading.areaKind).toBe('reporting region');
  });
});

describe('one incomparable part makes a total incomparable', () => {
  it('refuses to sum a prior window across a null', () => {
    const ctx = stateContextFrom(
      [
        { area: 'SA', offence: 'OFFENCES AGAINST PROPERTY', months12: 10, prior12: 9, yearTotals: {}, latestMonth: '2026-06', seriesFrom: '2019-07' },
        { area: 'SA', offence: 'THEFT', months12: 5, prior12: null, yearTotals: {}, latestMonth: '2026-06', seriesFrom: '2025-07' },
      ],
      'SA',
    );
    // Only the Level 1 grouping is in SA's partition, so the total is
    // comparable — the Level 2 row is excluded rather than nulling it.
    expect(ctx).toEqual({ totalLast12Months: 10, totalPrevious12Months: 9, totalChangePct: 11.1 });
  });

  it('nulls a total whose own parts are incomparable', () => {
    const ctx = stateContextFrom(
      [
        { area: 'NT', offence: '07 Theft', months12: 10, prior12: null, yearTotals: {}, latestMonth: '2026-06', seriesFrom: '2023-12' },
        { area: 'NT', offence: '02 Assault', months12: 5, prior12: 4, yearTotals: {}, latestMonth: '2026-06', seriesFrom: '2023-12' },
      ],
      'NT',
    );
    expect(ctx?.totalPrevious12Months).toBeNull();
    expect(ctx?.totalChangePct).toBeNull();
  });
});

describe('what reaches a report', () => {
  const reading = saCrimeReading(saRows, '5000', 'SAPOL', null, null, null)!;
  const block = crimeStatBlocks({ crimeStatistics: reading as unknown as Record<string, unknown> });

  it('never prints a blank cell where no comparison exists', () => {
    expect(block).toContain('not comparable');
    expect(block).not.toMatch(/\|\s*\|\s*—\s*\|/);
  });

  it('carries the reason once, in the register’s own words', () => {
    expect(block).toContain('Note on comparability:');
    expect(block.match(/Note on comparability:/g)).toHaveLength(1);
    expect(block).toContain('SAPOL adopted a new offence classification');
  });

  it('tells the reader the two levels must not be added', () => {
    expect(block).toMatch(/never add the two levels together/i);
  });

  it('carries no score, rating or rank as a FIGURE, and forbids inventing one', () => {
    // The phrase "safety score" does appear — inside the prohibition. What
    // must never appear is a score presented as a value, which is what the
    // fabricated predecessor did (§24: an invented `safetyScore` beside
    // "safer than state average").
    expect(block).not.toMatch(/safetyScore/);
    expect(block).not.toMatch(/(score|rating|rank(ing)?)\s*[:=]\s*\d/i);
    expect(block).not.toMatch(/\b(safer|less safe|low crime|high crime)\b/i);
    expect(block).toMatch(/Do NOT compute or assert a safety score, a rating, a ranking/);
  });

  it('says a region is a region, on the NT block', () => {
    const nt = ntCrimeReading(
      [{ area: 'Darwin', offence: '07 Theft', months12: 2769, prior12: 3329, yearTotals: {}, latestMonth: '2026-06', seriesFrom: '2023-12' }],
      'Darwin', 'reporting region', 'NT Police', null,
    )!;
    const ntBlock = crimeStatBlocks({ crimeStatistics: nt as unknown as Record<string, unknown> });
    expect(ntBlock).toMatch(/reporting region rather than by suburb or postcode/);
    expect(ntBlock).toMatch(/no per-capita rate/);
  });
});

describe('state totals', () => {
  it('adds areas, and keeps an incomparable prior incomparable', () => {
    const totals = totalsByOffence([
      { area: '5000', offence: 'THEFT', months12: 10, prior12: null, yearTotals: { '2025': 3 }, latestMonth: '2026-06', seriesFrom: '2025-07' },
      { area: '5001', offence: 'THEFT', months12: 5, prior12: null, yearTotals: { '2025': 2 }, latestMonth: '2026-06', seriesFrom: '2025-07' },
    ]);
    expect(totals).toHaveLength(1);
    expect(totals[0].months12).toBe(15);
    expect(totals[0].prior12).toBeNull();
    expect(totals[0].yearTotals).toEqual({ '2025': 5 });
    expect(totals[0].area).toBe('state_total');
  });
});

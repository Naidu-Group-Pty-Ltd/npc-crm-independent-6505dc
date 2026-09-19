/**
 * The check that decides whether the 10 Year Cash Flow may be templated.
 *
 * The two mistakes are not worth the same. Refusing a series that does match
 * costs the legacy layout. Accepting one that does not ships a client a
 * document whose figures are not the ones their adviser was reading. So the
 * cases below are mostly attempts to make it say yes when it should say no —
 * an override that moves one column, a series that agrees for a year and then
 * diverges, a stored scenario missing a field, two scenarios that are the same.
 */
import { describe, expect, it } from 'vitest';
import { matchStoredScenario } from '../storedSeriesMatch';

/** One year as the wire carries it. Only the compared fields matter here. */
const wireYear = (over: Record<string, number> = {}) => ({
  year: 1,
  calendarYear: 2027,
  propertyValue: 800_000,
  loanBalance: 640_000,
  rentalIncome: 31_200,
  grossYield: 3.9,
  netYield: 2.6,
  expenses: 8_000,
  interestRate: 6.2,
  interest: 39_680,
  principal: 0,
  preTaxAnnual: -16_480,
  afterTaxAnnual: -9_100,
  depreciation: 7_000,
  taxRefund: 7_380,
  landTax: 0,
  capitalGrowth: 4,
  cpiGrowth: 2.5,
  ...over,
});

/** The same year as the stored series carries it. */
const storedYear = (over: Record<string, number> = {}) => ({
  year: 1,
  propertyValue: 800_000,
  loanBalance: 640_000,
  equity: 160_000,
  annualRent: 31_200,
  cashFlow: -16_480,
  cumulativeCashFlow: -16_480,
  roi: -2.1,
  ...over,
});

const wire = (years: Array<ReturnType<typeof wireYear>>) => ({ years });

const row = (scenarios: Record<string, unknown>) => ({
  financial_calculations: { projections: scenarios },
});

const TWO_WIRE = [wireYear(), wireYear({ year: 2, propertyValue: 832_000, preTaxAnnual: -15_900 })];
const TWO_STORED = [storedYear(), storedYear({ year: 2, propertyValue: 832_000, cashFlow: -15_900 })];

describe('it matches only the series that is actually stored', () => {
  it('names the scenario when every compared figure agrees', () => {
    expect(matchStoredScenario(wire(TWO_WIRE), row({ moderate: TWO_STORED })))
      .toBe('moderate');
  });

  it('names the right one of three', () => {
    expect(matchStoredScenario(wire(TWO_WIRE), row({
      conservative: [storedYear({ propertyValue: 790_000 }), storedYear({ year: 2 })],
      moderate: [storedYear({ propertyValue: 795_000 }), storedYear({ year: 2 })],
      optimistic: TWO_STORED,
    }))).toBe('optimistic');
  });

  it('accepts a series stored as the after-tax column, consistently', () => {
    // The stored series states no tax treatment, so either of the wire's two
    // cash-flow columns may be the one it holds — but only one of them.
    const stored = [
      storedYear({ cashFlow: -9_100 }),
      storedYear({ year: 2, propertyValue: 832_000, cashFlow: -8_400 }),
    ];
    const years = [
      wireYear(),
      wireYear({ year: 2, propertyValue: 832_000, preTaxAnnual: -15_900, afterTaxAnnual: -8_400 }),
    ];
    expect(matchStoredScenario(wire(years), row({ moderate: stored }))).toBe('moderate');
  });
});

describe('and refuses everything else', () => {
  it('refuses a cash flow that changed while the balances did not', () => {
    // The case that makes the whole check necessary: an interest-rate override
    // on an interest-only loan moves the cash flow and leaves the property
    // value, the loan balance and the rent exactly where they were.
    const overridden = [
      wireYear({ preTaxAnnual: -21_000, afterTaxAnnual: -13_400 }),
      wireYear({ year: 2, propertyValue: 832_000, preTaxAnnual: -20_100, afterTaxAnnual: -12_800 }),
    ];
    expect(matchStoredScenario(wire(overridden), row({ moderate: TWO_STORED }))).toBeNull();
  });

  it('refuses a series that agrees for one year and then diverges', () => {
    const stored = [storedYear(), storedYear({ year: 2, propertyValue: 832_000, cashFlow: -1 })];
    expect(matchStoredScenario(wire(TWO_WIRE), row({ moderate: stored }))).toBeNull();
  });

  it('refuses a cash flow that swaps columns midway', () => {
    // Year one matches the pre-tax column and year two the after-tax one. Each
    // year has a counterpart, and the series still describes no single figure.
    const years = [
      wireYear(),
      wireYear({ year: 2, propertyValue: 832_000, preTaxAnnual: -15_900, afterTaxAnnual: -8_400 }),
    ];
    const stored = [
      storedYear(),
      storedYear({ year: 2, propertyValue: 832_000, cashFlow: -8_400 }),
    ];
    expect(matchStoredScenario(wire(years), row({ moderate: stored }))).toBeNull();
  });

  it('refuses when the lengths differ', () => {
    // A stored series that still carries its settlement row must not
    // half-match a ten-year one.
    expect(matchStoredScenario(wire(TWO_WIRE), row({ moderate: [storedYear()] }))).toBeNull();
    expect(matchStoredScenario(wire([wireYear()]), row({ moderate: TWO_STORED }))).toBeNull();
  });

  it('refuses when a compared field is absent from the stored year', () => {
    const missing = TWO_STORED.map(({ loanBalance: _drop, ...rest }) => rest);
    expect(matchStoredScenario(wire(TWO_WIRE), row({ moderate: missing }))).toBeNull();
  });

  it('refuses when the rent differs, however slightly', () => {
    const stored = TWO_STORED.map((y) => ({ ...y, annualRent: y.annualRent + 1 }));
    expect(matchStoredScenario(wire(TWO_WIRE), row({ moderate: stored }))).toBeNull();
  });

  it('refuses when two scenarios would both match', () => {
    // Both are the series on screen, so the figures would be right either way
    // — but the page prints the scenario's name, and a document labelled with
    // an assumption nobody made is wrong.
    expect(matchStoredScenario(wire(TWO_WIRE), row({
      moderate: TWO_STORED,
      optimistic: TWO_STORED,
    }))).toBeNull();
  });

  it('refuses a report that stores no projection at all', () => {
    // 1,020 of the 1,182 stored reports.
    expect(matchStoredScenario(wire(TWO_WIRE), { financial_calculations: {} })).toBeNull();
    expect(matchStoredScenario(wire(TWO_WIRE), {})).toBeNull();
    expect(matchStoredScenario(wire(TWO_WIRE), null)).toBeNull();
    expect(matchStoredScenario(wire(TWO_WIRE), row({ moderate: 'not a series' }))).toBeNull();
  });

  it('refuses an empty on-screen series', () => {
    expect(matchStoredScenario(wire([]), row({ moderate: TWO_STORED }))).toBeNull();
    expect(matchStoredScenario(null, row({ moderate: TWO_STORED }))).toBeNull();
  });

  it('tolerates float noise and nothing wider', () => {
    const noisy = TWO_STORED.map((y) => ({ ...y, propertyValue: y.propertyValue + 0.004 }));
    expect(matchStoredScenario(wire(TWO_WIRE), row({ moderate: noisy }))).toBe('moderate');

    const dollar = TWO_STORED.map((y) => ({ ...y, propertyValue: y.propertyValue + 1 }));
    expect(matchStoredScenario(wire(TWO_WIRE), row({ moderate: dollar }))).toBeNull();
  });
});

/**
 * The same questions against a row taken verbatim from production — the check
 * this programme's rules ask for, because a fixture written beside the code
 * agrees with the code by construction and a stored row does not.
 *
 * Two things this row settles. The stored series carries exactly the eight
 * fields the matcher reads (`annualRent, cashFlow, cumulativeCashFlow, equity,
 * loanBalance, propertyValue, roi, year`), ten years, numbered from 1 — so it
 * lines up with a wire series that has already dropped its settlement row. And
 * **`loanBalance` is identical across all three scenarios**, because
 * amortisation does not depend on a growth assumption: a check that compared
 * balances alone could not tell the three apart, which is why the property
 * value, the rent and the cash flow are compared too.
 */
const PRODUCTION = {
  moderate: [
    { roi: -8.35, year: 1, equity: 130556, cashFlow: -29771, annualRent: 29458, loanBalance: 415444, propertyValue: 546000, cumulativeCashFlow: -29771 },
    { roi: -7.89, year: 2, equity: 157249, cashFlow: -29709, annualRent: 30342, loanBalance: 410591, propertyValue: 567840, cumulativeCashFlow: -59480 },
    { roi: -7.37, year: 3, equity: 185130, cashFlow: -29588, annualRent: 31252, loanBalance: 405424, propertyValue: 590554, cumulativeCashFlow: -89068 },
    { roi: -6.83, year: 4, equity: 214256, cashFlow: -29462, annualRent: 32190, loanBalance: 399920, propertyValue: 614176, cumulativeCashFlow: -118530 },
    { roi: -6.24, year: 5, equity: 244684, cashFlow: -29301, annualRent: 33155, loanBalance: 394058, propertyValue: 638743, cumulativeCashFlow: -147831 },
    { roi: -5.61, year: 6, equity: 276476, cashFlow: -29102, annualRent: 34150, loanBalance: 387816, propertyValue: 664292, cumulativeCashFlow: -176932 },
    { roi: -4.92, year: 7, equity: 309696, cashFlow: -28862, annualRent: 35174, loanBalance: 381168, propertyValue: 690864, cumulativeCashFlow: -205794 },
    { roi: -4.21, year: 8, equity: 344411, cashFlow: -28611, annualRent: 36230, loanBalance: 374088, propertyValue: 718499, cumulativeCashFlow: -234406 },
    { roi: -3.48, year: 9, equity: 380692, cashFlow: -28349, annualRent: 37317, loanBalance: 366547, propertyValue: 747239, cumulativeCashFlow: -262755 },
    { roi: -2.73, year: 10, equity: 418612, cashFlow: -28075, annualRent: 38436, loanBalance: 358516, propertyValue: 777128, cumulativeCashFlow: -290830 },
  ],
  optimistic: [
    { roi: 1.92, year: 1, equity: 141056, cashFlow: -29485, annualRent: 29744, loanBalance: 415444, propertyValue: 556500, cumulativeCashFlow: -29485 },
    { roi: 3.17, year: 2, equity: 179299, cashFlow: -29117, annualRent: 30934, loanBalance: 410591, propertyValue: 589890, cumulativeCashFlow: -58602 },
    { roi: 4.53, year: 3, equity: 219860, cashFlow: -28669, annualRent: 32171, loanBalance: 405424, propertyValue: 625283, cumulativeCashFlow: -87271 },
    { roi: 5.96, year: 4, equity: 262880, cashFlow: -28194, annualRent: 33458, loanBalance: 399920, propertyValue: 662800, cumulativeCashFlow: -115464 },
    { roi: 7.48, year: 5, equity: 308510, cashFlow: -27660, annualRent: 34796, loanBalance: 394058, propertyValue: 702568, cumulativeCashFlow: -143124 },
    { roi: 9.1, year: 6, equity: 356906, cashFlow: -27063, annualRent: 36188, loanBalance: 387816, propertyValue: 744723, cumulativeCashFlow: -170188 },
    { roi: 10.83, year: 7, equity: 408238, cashFlow: -26401, annualRent: 37636, loanBalance: 381168, propertyValue: 789406, cumulativeCashFlow: -196588 },
    { roi: 12.64, year: 8, equity: 462683, cashFlow: -25700, annualRent: 39141, loanBalance: 374088, propertyValue: 836770, cumulativeCashFlow: -222288 },
    { roi: 14.53, year: 9, equity: 520429, cashFlow: -24959, annualRent: 40707, loanBalance: 366547, propertyValue: 886976, cumulativeCashFlow: -247247 },
    { roi: 16.52, year: 10, equity: 581679, cashFlow: -24176, annualRent: 42335, loanBalance: 358516, propertyValue: 940195, cumulativeCashFlow: -271423 },
  ],
  conservative: [
    { roi: -18.63, year: 1, equity: 120056, cashFlow: -30057, annualRent: 29172, loanBalance: 415444, propertyValue: 535500, cumulativeCashFlow: -30057 },
    { roi: -18.75, year: 2, equity: 135619, cashFlow: -30295, annualRent: 29755, loanBalance: 410591, propertyValue: 546210, cumulativeCashFlow: -60352 },
    { roi: -18.84, year: 3, equity: 151711, cashFlow: -30489, annualRent: 30351, loanBalance: 405424, propertyValue: 557134, cumulativeCashFlow: -90842 },
    { roi: -18.93, year: 4, equity: 168357, cashFlow: -30694, annualRent: 30958, loanBalance: 399920, propertyValue: 568277, cumulativeCashFlow: -121536 },
    { roi: -19, year: 5, equity: 185584, cashFlow: -30879, annualRent: 31577, loanBalance: 394058, propertyValue: 579642, cumulativeCashFlow: -152415 },
    { roi: -19.05, year: 6, equity: 203419, cashFlow: -31043, annualRent: 32208, loanBalance: 387816, propertyValue: 591235, cumulativeCashFlow: -183458 },
    { roi: -19.08, year: 7, equity: 221892, cashFlow: -31184, annualRent: 32852, loanBalance: 381168, propertyValue: 603060, cumulativeCashFlow: -214642 },
    { roi: -19.11, year: 8, equity: 241034, cashFlow: -31332, annualRent: 33509, loanBalance: 374088, propertyValue: 615121, cumulativeCashFlow: -245974 },
    { roi: -19.15, year: 9, equity: 260877, cashFlow: -31486, annualRent: 34180, loanBalance: 366547, propertyValue: 627424, cumulativeCashFlow: -277460 },
    { roi: -19.19, year: 10, equity: 281456, cashFlow: -31648, annualRent: 34863, loanBalance: 358516, propertyValue: 639972, cumulativeCashFlow: -309107 },
  ],
};

/** The wire series the modal would build from a stored one it has not altered. */
const wireFrom = (series: typeof PRODUCTION.moderate) => ({
  years: series.map((y) => wireYear({
    year: y.year,
    propertyValue: y.propertyValue,
    loanBalance: y.loanBalance,
    rentalIncome: y.annualRent,
    preTaxAnnual: y.cashFlow,
    // Deliberately not the stored figure: the stored series states no tax
    // treatment, and the matcher must settle on one column for the series.
    afterTaxAnnual: y.cashFlow + 6_000,
  })),
});

describe('against a production row', () => {
  it('names each of the three scenarios from its own series', () => {
    expect(matchStoredScenario(wireFrom(PRODUCTION.moderate), row(PRODUCTION))).toBe('moderate');
    expect(matchStoredScenario(wireFrom(PRODUCTION.optimistic), row(PRODUCTION))).toBe('optimistic');
    expect(matchStoredScenario(wireFrom(PRODUCTION.conservative), row(PRODUCTION)))
      .toBe('conservative');
  });

  it('refuses a single adjusted year in a ten-year series', () => {
    // One overridden year is the whole point: an adviser who changed year
    // seven's interest rate must not be handed the unadjusted document.
    const edited = wireFrom(PRODUCTION.moderate);
    edited.years[6] = { ...edited.years[6], preTaxAnnual: edited.years[6].preTaxAnnual - 1_500 };
    expect(matchStoredScenario(edited, row(PRODUCTION))).toBeNull();
  });

  it('is not fooled by the loan balances, which every scenario shares', () => {
    // Amortisation does not depend on a growth assumption, so all three stored
    // series carry the same balances year for year. A series that matched on
    // those alone would match all three — and the ambiguity rule would refuse
    // it anyway, but it would be refusing the right answer for the wrong
    // reason. Here only the property value, rent and cash flow separate them.
    const balancesOnly = {
      years: PRODUCTION.moderate.map((y) => wireYear({
        year: y.year,
        loanBalance: y.loanBalance,
        propertyValue: 1,
        rentalIncome: 1,
        preTaxAnnual: 1,
        afterTaxAnnual: 2,
      })),
    };
    expect(matchStoredScenario(balancesOnly, row(PRODUCTION))).toBeNull();
  });
});

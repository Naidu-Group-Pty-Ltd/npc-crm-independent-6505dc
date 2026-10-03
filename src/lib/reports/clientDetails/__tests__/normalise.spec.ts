/**
 * What the client-details normaliser must survive, and what it works out.
 *
 * The posture here is the opposite of the comparison formats'. There, a missing
 * property meant a table with a hole in it and refusing was right. Here the
 * ordinary record *is* mostly empty — 745 of 771 clients have no property — so
 * almost nothing is refused and almost everything is derived over an empty set.
 */
import { describe, expect, it } from 'vitest';

import {
  addressLine,
  buildClientDetails,
  ClientDetailsPayloadError,
  composeClientName,
  humanise,
  liabilityBasis,
  propertyOutgoings,
  shortAddress,
  streetLine,
} from '../normalise.pure';
import { recordHoldsFinancials } from '../payload.pure';

const NOW = '2026-08-02T00:00:00.000Z';
const ID = '11111111-1111-4111-8111-111111111111';

const build = (over: Record<string, unknown> = {}) => buildClientDetails({
  client: { id: ID, primary_first_name: 'Ada', primary_surname: 'Lovelace' },
  now: NOW,
  ...over,
});

describe('a client with nothing but a name', () => {
  /** The 97% case. If this throws, the format cannot serve most of the book. */
  it('produces a valid payload', () => {
    const p = build();
    expect(p.meta.clientName).toBe('Ada Lovelace');
    expect(p.meta.propertyCount).toBe(0);
    expect(p.meta.hasSecondaryContact).toBe(false);
    expect(p.properties).toEqual([]);
    expect(p.ownerOccupied).toBeNull();
  });

  it('has a position, and every figure in it is zero', () => {
    const { position } = build();
    expect(position.netWorth.value).toBe(0);
    expect(position.incomeMonthly.value).toBe(0);
    expect(position.commitmentsMonthly.value).toBe(0);
    // Null rather than a division by nothing.
    expect(position.commitmentRatio).toBeNull();
  });

  /**
   * A record with nothing financial in it gets no summary of absences. The
   * closing section says in one callout that nothing is recorded, and the
   * summary used to say it twice more above it — "No investment property is
   * recorded… No income has been recorded…" — on a one-page document
   * (CLIENT_DETAILS.md §12). What the record does say about the household is
   * still said.
   */
  it('says nothing in its summary that the closing callout already says', () => {
    expect(build().narrative).toBe('');
    const household = build({
      client: {
        id: ID, primary_first_name: 'Ada', primary_surname: 'Lovelace',
        marital_status: 'married', dependents_count: 2,
      },
    });
    expect(household.narrative).toBe('Ada Lovelace is recorded as married, with 2 dependents.');
  });

  it('refuses only a record that is not a client', () => {
    expect(() => buildClientDetails({ client: null, now: NOW }))
      .toThrow(ClientDetailsPayloadError);
    expect(() => buildClientDetails({ client: { primary_first_name: 'Ada' }, now: NOW }))
      .toThrow(/no id/);
  });
});

describe('the second person', () => {
  /** Every row has all fourteen secondary columns; 13 of 771 name a person. */
  it('exists when they are named, not when the columns do', () => {
    expect(build().household.contacts).toHaveLength(1);
    expect(build({
      client: { id: ID, primary_first_name: 'Ada', secondary_first_name: 'Charles', secondary_surname: 'Babbage' },
    }).household.contacts).toHaveLength(2);
  });

  it('shares the primary address rather than repeating it', () => {
    const p = build({
      client: {
        id: ID, primary_first_name: 'Ada', primary_surname: 'Lovelace',
        secondary_first_name: 'Charles', secondary_surname: 'Babbage',
        current_address: '12 Example Street', current_suburb: 'Suburbia',
        secondary_same_address_as_primary: true,
      },
    });
    const secondary = p.household.residences.find((r) => r.contact === 'secondary');
    expect(secondary?.sharedWithPrimary).toBe(true);
    expect(secondary?.residence.address).toBe('12 Example Street');
  });

  it('names both on the cover', () => {
    expect(build({
      client: {
        id: ID, primary_first_name: 'Ada', primary_surname: 'Lovelace',
        secondary_first_name: 'Charles', secondary_surname: 'Babbage',
      },
    }).meta.clientName).toBe('Ada Lovelace & Charles Babbage');
  });
});

describe('derive, never accept', () => {
  /**
   * `clients.total_portfolio_value` and `total_debt` are stored columns and are
   * deliberately not read. A stored aggregate is a cache, and a cache printed
   * beside the table it caches is a second answer waiting to disagree.
   */
  it('ignores the stored portfolio totals and sums the rows instead', () => {
    const p = build({
      client: {
        id: ID, primary_first_name: 'Ada', primary_surname: 'Lovelace',
        total_portfolio_value: 99_999_999, total_debt: 88_888_888,
      },
      properties: [
        { property_type: 'investment', address: '1 A St', value: 600_000, loan_remaining: 400_000 },
      ],
    });
    expect(p.position.propertyValue.value).toBe(600_000);
    expect(p.position.propertyDebt.value).toBe(400_000);
    expect(p.position.propertyEquity.value).toBe(200_000);
  });

  it('derives equity and LVR rather than reading the stored ones', () => {
    const [property] = build({
      properties: [{
        property_type: 'investment', address: '1 A St',
        value: 500_000, loan_remaining: 400_000,
        // Both stored and both wrong. Neither should reach the page.
        total_monthly_expenditure: 999_999, net_monthly_cashflow: 999_999,
      }],
    }).properties;
    expect(property.equity.value).toBe(100_000);
    expect(property.lvr.value).toBe(80);
    expect(property.expensesMonthly.value).not.toBe(999_999);
    expect(property.netMonthly.value).not.toBe(999_999);
  });

  it('divides a zero-valued property by nothing rather than by zero', () => {
    const [property] = build({
      properties: [{ property_type: 'investment', address: '1 A St', value: 0, loan_remaining: 50_000 }],
    }).properties;
    expect(property.lvr.value).toBe(0);
    expect(Number.isFinite(property.equity.value)).toBe(true);
  });

  /** Council and water are stored as annual figures under a `monthly_` name. */
  it('annualises the rates columns that lie about their own period', () => {
    expect(propertyOutgoings({ monthly_council_rates: 2400, monthly_water_rates: 1200 }))
      .toBe(300);
  });

  it('derives the weekly rent from a monthly figure and back', () => {
    const [property] = build({
      properties: [{ property_type: 'investment', address: '1 A St', weekly_rental_income: 500 }],
    }).properties;
    // 500/wk → monthly → back to weekly. The record often holds only one.
    expect(Math.round(property.rentMonthly.value)).toBe(2167);
    expect(Math.round(property.rentWeekly.value)).toBe(500);
  });
});

describe('frequencies are converted once', () => {
  /**
   * `client_expenses` carries `monthly_amount` *and* `frequency` — a column name
   * asserting something the schema does not enforce. All 506 stored rows say
   * `monthly`, so the conversion is the identity, but it is the conversion.
   */
  it('converts an expense that is not actually monthly', () => {
    const p = build({
      expenses: [
        { expense_category: 'groceries', monthly_amount: 100, frequency: 'monthly' },
        { expense_category: 'insurance', monthly_amount: 1200, frequency: 'annual' },
        { expense_category: 'transport', monthly_amount: 100, frequency: 'weekly' },
      ],
    });
    const byCategory = Object.fromEntries(p.expenses.map((x) => [x.category, x.monthly.value]));
    expect(byCategory.Groceries).toBe(100);
    expect(byCategory.Insurance).toBe(100);
    expect(Math.round(byCategory.Transport)).toBe(433);
  });
});

describe('liability servicing', () => {
  it('says when a servicing figure is a model rather than a record', () => {
    const p = build({
      liabilities: [
        { liability_type: 'credit_card', provider_name: 'Meridian', credit_limit: 10_000, monthly_repayment: 0 },
        { liability_type: 'personal_loan', provider_name: 'Coastline', current_balance: 20_000, monthly_repayment: 400 },
      ],
    });
    expect(p.liabilitiesIncludeEstimates).toBe(true);
    expect(p.liabilities[0].isEstimated).toBe(true);
    expect(p.liabilities[0].monthlyServicing.value).toBe(300);
    // In words. The engine's own note is `3% of credit limit`, and the page
    // printed it after "Estimated —".
    expect(p.liabilities[0].basis).toBe('Estimated: 3% of the limit');
    expect(p.liabilities[1].isEstimated).toBe(false);
    expect(p.liabilities[1].basis).toBe('As recorded');
  });

  /**
   * No `hecs` or `help` row exists in the record — student debt is recorded as
   * `student_loan` — so this branch has never fired in production. Without an
   * injected estimator it reports what was recorded and says so.
   */
  it('reports a recorded HECS repayment rather than estimating one', () => {
    const p = build({
      liabilities: [{ liability_type: 'hecs', current_balance: 30_000, monthly_repayment: 250 }],
    });
    expect(p.liabilities[0].monthlyServicing.value).toBe(250);
    expect(p.liabilities[0].basis).toBe('As recorded');
  });
});

describe('nothing that reaches the page is an emoji or a symbol', () => {
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;

  it('turns a stored value into a word', () => {
    expect(humanise('owner_occupied')).toBe('Owner occupied');
    expect(humanise('pending_audit')).toBe('Pending audit');
    expect(humanise(null, 'Fallback')).toBe('Fallback');
  });

  it('labels a property type in words', () => {
    const p = build({
      properties: [
        { property_type: 'smsf', address: '1 A St', smsf_compliance_status: 'compliant', smsf_trustee_type: 'corporate' },
      ],
    });
    expect(p.properties[0].kindLabel).toBe('SMSF');
    expect(p.properties[0].smsf?.complianceStatus).toBe('Compliant');
    expect(p.properties[0].smsf?.trusteeType).toBe('Corporate trustee');
  });

  it('lets no emoji through anywhere in the payload', () => {
    const p = build({
      client: { id: ID, primary_first_name: 'Ada', primary_surname: 'Lovelace', living_situation: 'owner_occupied' },
      properties: [
        { property_type: 'owner_occupied', address: '1 A St', value: 800_000, loan_remaining: 300_000 },
        { property_type: 'smsf', address: '2 B St', smsf_compliance_status: 'pending_audit' },
        { property_type: 'investment', address: '3 C St', value: 400_000 },
      ],
      expenses: [{ expense_category: 'groceries', monthly_amount: 100, frequency: 'monthly' }],
    });
    expect(JSON.stringify(p)).not.toMatch(EMOJI);
  });
});

describe('an address short enough to head a column', () => {
  /**
   * The first comma segment is often "Unit 7" or "Lot 2418" — true, useless,
   * and printed as the heading over a column of somebody's financial position.
   * Found by rendering the portfolio matrix and reading the headings.
   */
  it('takes the street line when the first segment names nothing', () => {
    expect(shortAddress('Unit 7, 118 Mariners Quay Boulevard, Newstead, QLD 4006'))
      .toBe('Unit 7, 118 Mariners Quay…');
    expect(shortAddress('Lot 2418 Silverbark Rise, Brookhaven Estate, QLD 4506'))
      .toBe('Lot 2418 Silverbark Rise');
  });

  it('clips on a word rather than mid-name', () => {
    const clipped = shortAddress('148 Extraordinarily Overlong Boulevard Of Dreams, Somewhere');
    expect(clipped.length).toBeLessThanOrEqual(31);
    expect(clipped.endsWith('…')).toBe(true);
    expect(clipped).not.toMatch(/\s…$/);
  });

  it('copes with an address that has no commas at all', () => {
    expect(shortAddress('No commas here')).toBe('No commas here');
    expect(shortAddress('')).toBe('');
  });

  /**
   * Where the heading may wrap, the same head is never clipped: "Unit 14,
   * 238-242 Great…" headed a portrait column whose street the reader then had
   * to find in the next section (CLIENT_DETAILS.md §12).
   */
  it('keeps the whole street line where the heading can wrap', () => {
    expect(streetLine('Unit 7, 118 Mariners Quay Boulevard, Newstead, QLD 4006'))
      .toBe('Unit 7, 118 Mariners Quay Boulevard');
    expect(streetLine('Lot 2418 Silverbark Rise, Brookhaven Estate, QLD 4506'))
      .toBe('Lot 2418 Silverbark Rise');
    expect(streetLine('No commas here')).toBe('No commas here');
    expect(streetLine('')).toBe('');
  });
});

describe('a name is cased for print', () => {
  /**
   * 746 of the 775 stored clients have an all-lowercase first name and 740 an
   * all-lowercase surname. This module printed them as stored, so a fact-find
   * addressed to a broker opened with "sachin mathew" — while the legacy
   * `FormaraPDFGenerator`, which has always run the same columns through
   * `smartCapitalize`, printed "Sachin Mathew" for the same client. The
   * divergence was between two documents of the same record, not a house style.
   */
  it('title-cases the ordinary lowercase record', () => {
    const p = build({ client: { id: ID, primary_first_name: 'sachin', primary_surname: 'mathew' } });
    expect(p.meta.clientName).toBe('Sachin Mathew');
    expect(p.household.contacts[0].name).toBe('Sachin Mathew');
  });

  it('quiets a shouted one and leaves a deliberately cased one alone', () => {
    expect(composeClientName({ primary_first_name: 'JORDAN', primary_surname: 'NGUYEN' }))
      .toBe('Jordan Nguyen');
    // Mixed case is somebody's own spelling of their name, and re-casing it
    // would be the same defect in the other direction.
    expect(composeClientName({ primary_first_name: 'Fiona', primary_surname: 'McDonald' }))
      .toBe('Fiona McDonald');
  });

  it('keeps the middle name and joins a household the way the pages read', () => {
    expect(composeClientName({
      primary_first_name: 'ada', primary_middle_name: 'beatrice', primary_surname: 'lovelace',
    })).toBe('Ada Beatrice Lovelace');
    expect(composeClientName({
      primary_first_name: 'ada', primary_surname: 'lovelace',
      secondary_first_name: 'charles', secondary_surname: 'babbage',
    })).toBe('Ada Lovelace & Charles Babbage');
    expect(composeClientName({})).toBe('Client');
  });

  it('composes meta.clientName and the contact block identically', () => {
    // Two compositions of one person's name are two chances to disagree, on
    // the page and in the file. The adapter titles the document with
    // `composeClientName` without loading the other eight tables, so this is
    // the assertion that keeps that shortcut honest.
    const client = {
      id: ID,
      primary_first_name: 'ada', primary_middle_name: 'beatrice', primary_surname: 'lovelace',
      secondary_first_name: 'charles', secondary_surname: 'babbage',
    };
    const p = build({ client });
    expect(p.meta.clientName).toBe(composeClientName(client));
    expect(p.household.contacts.map((c) => c.name).join(' & ')).toBe(p.meta.clientName);
  });

  it('does not re-case an asset, which is not a person', () => {
    // `joinName` composes a vehicle's make and model as well as a name, and
    // title-casing that turns "BMW X5" into "Bmw X5". Only names may be
    // re-cased, which is why the casing lives in a second helper.
    const p = build({ assets: [{ asset_type: 'vehicle', make_model: 'BMW X5' }] });
    expect(p.assets[0].description).toBe('BMW X5');
  });
});

describe('the portfolio excludes the home', () => {
  /**
   * A home is somewhere to live before it is an asset. Counting it as a holding
   * overstates what the client invests; leaving it out of net worth would
   * understate what they own. So it is in one and not the other.
   */
  it('keeps the owner-occupied property out of the holdings but inside net worth', () => {
    const p = build({
      properties: [
        { property_type: 'owner_occupied', address: 'Home', value: 900_000, loan_remaining: 400_000 },
        { property_type: 'investment', address: 'Rental', value: 600_000, loan_remaining: 500_000 },
      ],
    });
    expect(p.properties).toHaveLength(1);
    expect(p.meta.propertyCount).toBe(1);
    expect(p.ownerOccupied?.address).toBe('Home');
    expect(p.position.propertyValue.value).toBe(1_500_000);
    expect(p.position.propertyEquity.value).toBe(600_000);
  });
});

/**
 * The words the audit of 1 Oct 2026 changed (CLIENT_DETAILS.md §12). Each was
 * read off a rendered page of the five record shapes in all 51 designs.
 */
describe('a person is written down the way a person is', () => {
  it('dates a birth and an address the way a reader writes them', () => {
    const p = build({
      client: { id: ID, primary_first_name: 'Ada', primary_surname: 'Lovelace', primary_dob: '1984-03-17' },
      addressHistory: [{ address: '12 Bayview Terrace', current_suburb: 'Rhodes', current_state: 'nsw', start_date: '2024-02-01', end_date: '2026-01-31' }],
    });
    // It printed `1984-03-17` and `2024-02-01`.
    expect(p.household.contacts[0].dateOfBirth).toBe('17 March 1984');
    expect(p.household.history[0].startDate).toBe('01 Feb 2024');
    expect(p.household.history[0].endDate).toBe('31 Jan 2026');
  });

  it('keeps a date it cannot read as it was recorded, rather than losing it', () => {
    const p = build({
      client: { id: ID, primary_first_name: 'Ada', primary_surname: 'Lovelace', primary_dob: 'March 1984' },
    });
    expect(p.household.contacts[0].dateOfBirth).toBe('March 1984');
  });

  it('prints a provider as it was typed — a provider is a proper noun', () => {
    const p = build({
      liabilities: [
        { liability_type: 'personal_loan', provider_name: 'NAB', current_balance: 9_000, monthly_repayment: 300 },
        { liability_type: 'credit_card', provider_name: 'Commonwealth Bank', credit_limit: 5_000, monthly_repayment: 150 },
        { liability_type: 'other', current_balance: 1_000, monthly_repayment: 50 },
      ],
    });
    // It printed "Nab" and "Commonwealth bank", and repeated the type where no
    // provider was recorded.
    expect(p.liabilities.map((l) => l.provider)).toEqual(['NAB', 'Commonwealth Bank', '']);
  });

  it('names an expense category the way the expense form does', () => {
    const p = build({
      expenses: [
        { expense_category: 'internet_phone', monthly_amount: 90, frequency: 'monthly' },
        { expense_category: 'gym_fitness', monthly_amount: 60, frequency: 'monthly' },
        { expense_category: 'health_insurance', monthly_amount: 300, frequency: 'monthly' },
      ],
    });
    expect(p.expenses.map((x) => x.category)).toEqual(['Internet and phone', 'Gym and fitness', 'Health insurance']);
  });

  it('says whose an income line is once, in its own column', () => {
    const p = build({
      client: { id: ID, primary_first_name: 'Ada', primary_surname: 'Lovelace', secondary_first_name: 'Charles', secondary_surname: 'Babbage' },
      incomeSources: [{ source_category: 'government', source_name: 'Family Tax Benefit', contact_type: 'secondary', input_amount: 400, input_frequency: 'fortnightly' }],
    });
    // The engine labels it "… (Secondary)" for its own list.
    expect(p.income.otherIncome[0].label).toBe('Family Tax Benefit');
    expect(p.income.otherIncome[0].contact).toBe('secondary');
  });
});

describe('an Australian address on one line', () => {
  it('sets the locality as one group and names no country at home', () => {
    expect(addressLine('12 Bayview Terrace', 'Rhodes', 'nsw', '2138', 'Australia'))
      .toBe('12 Bayview Terrace, Rhodes NSW 2138');
  });

  it('names a country that is not Australia', () => {
    expect(addressLine('1 Queen St', 'Auckland', '', '1010', 'New Zealand'))
      .toBe('1 Queen St, Auckland 1010, New Zealand');
  });

  it('does not print a suburb the street line already ends with', () => {
    expect(addressLine('1407/18 Harbourside Promenade, Wentworth Point', 'Wentworth Point', 'NSW', '2127'))
      .toBe('1407/18 Harbourside Promenade, Wentworth Point NSW 2127');
    expect(addressLine('1407/18 Harbourside Promenade, Wentworth Point NSW 2127', 'Wentworth Point', 'NSW', '2127'))
      .toBe('1407/18 Harbourside Promenade, Wentworth Point NSW 2127');
  });

  /** Judged by position: streets are named after the suburbs they run through. */
  it('keeps a suburb a street is named after', () => {
    expect(addressLine('18 Schofields Farm Road', 'Schofields', 'NSW', '2762'))
      .toBe('18 Schofields Farm Road, Schofields NSW 2762');
    expect(addressLine('Schofields Farm Road', 'Schofields', 'NSW', '2762'))
      .toBe('Schofields Farm Road, Schofields NSW 2762');
  });
});

describe('the basis of a servicing figure, in words', () => {
  it('translates the engine\'s shorthand and says when the figure is a model', () => {
    expect(liabilityBasis({ calculationNote: 'Est. P&I @ 9% / 5yr', isEstimated: true }))
      .toBe('Estimated: principal and interest at 9% over 5 years');
    expect(liabilityBasis({ calculationNote: '3% of credit limit', isEstimated: false, limit: 8_000 }))
      .toBe('3% of the limit');
    expect(liabilityBasis({ calculationNote: '3% of credit limit', isEstimated: true, limit: 0 }))
      .toBe('Estimated: 3% of the balance');
    expect(liabilityBasis({ calculationNote: '5% of limit/balance', isEstimated: true }))
      .toBe('Estimated: 5% of the limit or balance');
    expect(liabilityBasis({ calculationNote: '', isEstimated: false })).toBe('As recorded');
  });

  it('prints a note it does not know as written, never guessing', () => {
    expect(liabilityBasis({ calculationNote: '4.2% of income (ATO brackets)', isEstimated: true }))
      .toBe('Estimated: 4.2% of income (ATO brackets)');
  });

  it('never prints the engine\'s own shorthand', () => {
    const p = build({
      liabilities: [
        { liability_type: 'other', current_balance: 12_000, monthly_repayment: 0 },
        { liability_type: 'afterpay_bnpl', credit_limit: 1_000, monthly_repayment: 0 },
      ],
    });
    for (const l of p.liabilities) {
      expect(l.basis).not.toMatch(/Est\.|P&I|@|\/\s*\d+yr|limit\/balance/);
    }
  });
});

describe('the summary agrees with the record it summarises', () => {
  it('counts the home with the value it adds in', () => {
    const p = build({
      properties: [
        { property_type: 'owner_occupied', address: 'Home', value: 900_000, loan_remaining: 400_000 },
        { property_type: 'investment', address: '1 A St', value: 600_000, loan_remaining: 500_000 },
      ],
    });
    // It read "holds 1 property worth $1,500,000": the value took the home in
    // and the count left it out.
    expect(p.narrative).toContain('The record holds 2 properties, the home included, worth $1,500,000 against $900,000 of debt, leaving $600,000 of equity.');
  });

  it('says a property owned outright has no debt recorded, not "$0 of debt"', () => {
    const p = build({
      properties: [{ property_type: 'investment', address: '1 A St', value: 600_000 }],
    });
    expect(p.narrative).toContain('The record holds 1 property worth $600,000, with no debt recorded against it.');
    expect(p.narrative).not.toContain('$0 of debt');
  });

  it('writes a household of two as one household', () => {
    const p = build({
      client: {
        id: ID, primary_first_name: 'Ada', primary_surname: 'Lovelace',
        secondary_first_name: 'Charles', secondary_surname: 'Babbage',
        marital_status: 'married', dependents_count: 1,
      },
      employment: [{ contact_type: 'primary', employer_name: 'Engines', gross_annual_salary: 120_000 }],
    });
    // It read "are recorded as a household as married".
    expect(p.narrative.startsWith('Ada Lovelace & Charles Babbage are recorded as one household: married, with 1 dependent.')).toBe(true);
  });
});

describe('whether a record holds anything financial is one rule', () => {
  const p = (over: Record<string, unknown>) => build(over);

  it('counts income on its own', () => {
    // A pension-only record was "empty" to the projection and not to the
    // renderer; the two read different things.
    expect(recordHoldsFinancials(p({
      incomeSources: [{ source_category: 'government', source_name: 'Age Pension', input_amount: 1_000, input_frequency: 'fortnightly' }],
    }))).toBe(true);
  });

  it('counts a property worth exactly what is owed on it', () => {
    expect(recordHoldsFinancials(p({
      properties: [{ property_type: 'investment', address: '1 A St', value: 500_000, loan_remaining: 500_000 }],
    }))).toBe(true);
  });

  it('is false for a name and nothing else', () => {
    expect(recordHoldsFinancials(build())).toBe(false);
  });
});

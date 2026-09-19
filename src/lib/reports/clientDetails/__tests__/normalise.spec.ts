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
  buildClientDetails,
  ClientDetailsPayloadError,
  composeClientName,
  humanise,
  propertyOutgoings,
  shortAddress,
} from '../normalise.pure';

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

  it('says something true in its opening paragraph', () => {
    const narrative = build().narrative;
    expect(narrative).toContain('Ada Lovelace');
    expect(narrative).toContain('No investment property is recorded');
    expect(narrative).toContain('No income has been recorded');
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
    expect(p.liabilities[0].basis).toBe('3% of credit limit');
    expect(p.liabilities[1].isEstimated).toBe(false);
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
    expect(p.liabilities[0].basis).toBe('As recorded; not estimated');
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

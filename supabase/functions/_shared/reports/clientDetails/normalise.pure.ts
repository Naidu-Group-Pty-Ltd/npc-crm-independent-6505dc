/**
 * Turning nine tables of rows into a document payload — or refusing to.
 *
 * ## What it must survive
 *
 * A client with a name and nothing else. That is not an edge case here, it is
 * the ordinary one: 745 of 771 clients have no property, and the financial
 * tables are sparser still — 39 employment rows and 26 income rows across 771
 * people. So every collection is optional, every total is defined over an empty
 * set, and the only thing this module refuses outright is a record with no
 * client at all.
 *
 * That is the opposite posture from the comparison formats, and deliberately.
 * There, a missing property meant a table with a hole in it and refusing was
 * right. Here, refusing would mean the 97% case cannot produce a document —
 * which is exactly the state the legacy generator leaves them in, except that it
 * produces one with empty tables instead of not producing one at all.
 *
 * ## Derive, never accept
 *
 * `clients.total_portfolio_value` and `clients.total_debt` are stored columns and
 * they are **not read**. Every total in `position` is summed from the rows the
 * document also prints, so a figure in the summary cannot disagree with the
 * table it summarises. A stored aggregate is a cache, and a cache on a document
 * is a second answer waiting to be wrong.
 *
 * Equity, LVR, per-property outgoings and net cash flow are derived the same
 * way, even though `client_properties` has `total_monthly_expenditure` and
 * `net_monthly_cashflow` columns that claim to hold them.
 *
 * ## Frequencies are converted once
 *
 * `client_expenses` carries both `monthly_amount` and `frequency`, which is a
 * trap: the column name asserts something the schema does not enforce. Every
 * amount goes through `freqToMonthly`, the same function the income path uses.
 * **Measured: all 506 rows are `monthly` today**, so the conversion is the
 * identity — but it is the conversion, not an assumption.
 */
import type { Measure } from '../../reportDesign/measure.pure.ts';
import { aud, audPerMonth, audPerYear, count, percent } from '../../reportDesign/measure.pure.ts';
// The one casing rule for a person's name in this repo. See `personName`.
import { smartCapitalize } from '../../clientName.ts';
import {
  buildHouseholdIncome,
  buildLiabilityServicing,
  buildPropertyExpenditure,
  freqToMonthly,
} from './finance.pure.ts';
import type {
  AddressPeriod,
  AssetRow,
  ClientDetails,
  Contact,
  ContactRole,
  EmploymentRow,
  ExpenseRow,
  Household,
  IncomeBlock,
  LiabilityRow,
  Position,
  PropertyKind,
  PropertyRow,
  Residence,
  SmsfDetails,
} from './payload.pure.ts';
import { MAX_ROWS } from './payload.pure.ts';

/** A record arrived that is not a client. */
export class ClientDetailsPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClientDetailsPayloadError';
  }
}

// ── Reading primitives ──────────────────────────────────────────────────────

type Row = Record<string, unknown>;

const isRecord = (v: unknown): v is Row =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** A trimmed, capped string. Anything else is empty. */
const text = (value: unknown, max = 200): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

/** A finite number, or zero. Never `NaN` printed as a figure. */
const num = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** A finite number, or null — for the figures where zero is a claim. */
const optionalNum = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

const rows = (value: unknown): Row[] =>
  (Array.isArray(value) ? value : []).filter(isRecord).slice(0, MAX_ROWS);

/** `some_stored_value` → `Some stored value`. Never a symbol, never an emoji. */
export function humanise(value: unknown, fallback = ''): string {
  const raw = text(value, 80);
  if (!raw) return fallback;
  const spaced = raw.replace(/[_-]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

const contactRole = (value: unknown): ContactRole =>
  text(value, 20).toLowerCase() === 'secondary' ? 'secondary' : 'primary';

const joinName = (...parts: unknown[]): string =>
  parts.map((p) => text(p, 60)).filter(Boolean).join(' ');

/**
 * A person's name, cased for print.
 *
 * Separate from `joinName` because only *names* may be re-cased: `joinName`
 * also composes an asset's make and model, and title-casing that turns "BMW
 * X5" into "Bmw X5".
 *
 * 746 of the 775 stored clients have an all-lowercase first name and 740 an
 * all-lowercase surname — the data is entered that way — and this module
 * printed them exactly as stored, so a fact-find addressed to a broker opened
 * with "sachin mathew". The legacy `FormaraPDFGenerator` has always run the
 * same names through `smartCapitalize`, so this was a divergence from the
 * document clients actually receive rather than a house style: the shipping
 * PDF said "Sachin Mathew" and the WeasyPrint route, and every template drawn
 * from this payload, said "sachin mathew".
 *
 * `smartCapitalize` is the sanctioned implementation and is imported rather
 * than restated: it leaves a name that is already mixed case alone, so
 * "McDonald" and "van Dijk" survive, and title-cases one that is all upper or
 * all lower, which is what both spellings in this table need.
 */
const personName = (...parts: unknown[]): string =>
  parts.map((p) => smartCapitalize(text(p, 60))).filter(Boolean).join(' ');

/**
 * The document's own name for its subject — "Ada Lovelace", or "Ada Lovelace &
 * Charles Babbage" for the thirteen records that describe two people.
 *
 * Exported because the Template Builder adapter needs the same string to title
 * a document without loading all nine tables to get it, and two compositions
 * of one person's name are two chances to disagree on the page and in the
 * file. `clientDetailsAdapter.resolveRoutingContext` calls this.
 */
export function composeClientName(client: Row): string {
  const primary = personName(
    client.primary_first_name, client.primary_middle_name, client.primary_surname,
  );
  const secondary = personName(
    client.secondary_first_name, client.secondary_middle_name, client.secondary_surname,
  );
  return [primary, secondary].filter(Boolean).join(' & ') || 'Client';
}

/** Past this, a column heading wraps and the matrix loses a row of height. */
const SHORT_ADDRESS_CHARS = 30;

/**
 * An address short enough for a column heading and still long enough to name a
 * property.
 *
 * The obvious rule — take everything before the first comma — is wrong here, and
 * wrong in a way that only shows up on the page. Addresses in this record open
 * with a unit or lot number about half the time, so the first segment is often
 * "Unit 7" or "Lot 2418": true, useless, and printed as the heading of a column
 * of somebody's financial position. Found by rendering the portfolio matrix and
 * reading the headings.
 *
 * So a first segment too short to identify anything takes the street line with
 * it, and the result is clipped on a word rather than mid-name.
 */
export function shortAddress(address: string): string {
  const parts = address.split(',').map((x) => x.trim()).filter(Boolean);
  if (!parts.length) return address.trim();

  const head = parts.length > 1 && parts[0].length < 12
    ? `${parts[0]}, ${parts[1]}`
    : parts[0];

  if (head.length <= SHORT_ADDRESS_CHARS) return head;
  const clipped = head.slice(0, SHORT_ADDRESS_CHARS);
  const lastSpace = clipped.lastIndexOf(' ');
  return `${(lastSpace > 12 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`;
}

// ── The people ──────────────────────────────────────────────────────────────

function toContacts(client: Row): Contact[] {
  const contacts: Contact[] = [{
    role: 'primary',
    name: personName(
      client.primary_first_name, client.primary_middle_name, client.primary_surname,
    ),
    email: text(client.primary_email, 120),
    mobile: text(client.primary_mobile, 40),
    gender: humanise(client.primary_gender),
    dateOfBirth: text(client.primary_dob, 40),
  }];

  // A second person exists when they are named, not when the columns exist.
  // Every client row has all fourteen secondary columns; three of 771 records
  // actually describe two people.
  const secondaryName = personName(
    client.secondary_first_name, client.secondary_middle_name, client.secondary_surname,
  );
  if (secondaryName) {
    contacts.push({
      role: 'secondary',
      name: secondaryName,
      email: text(client.secondary_email, 120),
      mobile: text(client.secondary_mobile, 40),
      gender: humanise(client.secondary_gender),
      dateOfBirth: text(client.secondary_dob, 40),
    });
  }
  return contacts;
}

const residenceOf = (client: Row, prefix: '' | 'secondary_'): Residence => ({
  address: text(client[`${prefix}current_address`], 200),
  suburb: text(client[`${prefix}current_suburb`], 80),
  state: text(client[`${prefix}current_state`], 20).toUpperCase(),
  postcode: text(client[`${prefix}current_postcode`], 12),
  country: text(client[`${prefix}country`], 60),
  livingSituation: humanise(client[`${prefix}living_situation`]),
  residentialStatus: humanise(client[`${prefix}residential_status`]),
});

const hasResidence = (r: Residence): boolean =>
  Boolean(r.address || r.suburb || r.livingSituation || r.residentialStatus);

function toHousehold(client: Row, history: unknown): Household {
  const contacts = toContacts(client);
  const primary = residenceOf(client, '');
  const residences: { contact: ContactRole; residence: Residence; sharedWithPrimary: boolean }[] = [];
  if (hasResidence(primary)) {
    residences.push({ contact: 'primary', residence: primary, sharedWithPrimary: false });
  }

  if (contacts.length > 1) {
    const shares = client.secondary_same_address_as_primary === true;
    const secondary = shares ? primary : residenceOf(client, 'secondary_');
    if (hasResidence(secondary)) {
      residences.push({ contact: 'secondary', residence: secondary, sharedWithPrimary: shares });
    }
  }

  const periods: AddressPeriod[] = rows(history).map((h) => ({
    contact: contactRole(h.contact_type),
    address: [text(h.address, 200), text(h.current_suburb, 80), text(h.current_state, 20).toUpperCase()]
      .filter(Boolean).join(', '),
    isCurrent: h.is_current === true,
    startDate: text(h.start_date, 40),
    endDate: text(h.end_date, 40),
    months: optionalNum(h.months_at_address),
    livingSituation: humanise(h.living_situation),
  })).filter((p) => p.address);

  const dependents = optionalNum(client.dependents_count);

  return {
    contacts,
    residences,
    maritalStatus: humanise(client.marital_status),
    dependents: dependents === null ? null : count(dependents),
    history: periods,
  };
}

// ── Work, and what it pays ──────────────────────────────────────────────────

function toEmployment(employment: unknown): EmploymentRow[] {
  return rows(employment).map((e): EmploymentRow => {
    // `gross_annual_salary` when it is there, otherwise the captured amount at
    // its own frequency, annualised — the precedence `buildHouseholdIncome`
    // applies, restated here only for the printed row.
    const annual = num(e.gross_annual_salary)
      || freqToMonthly(num(e.salary_amount), text(e.salary_frequency, 20)) * 12;
    const extras = num(e.bonus) + num(e.commission) + num(e.overtime_essential)
      + num(e.overtime_non_essential) + num(e.allowance) + num(e.other_taxable_income);

    return {
      contact: contactRole(e.contact_type),
      employer: text(e.employer_name, 120),
      employmentType: humanise(e.employment_type),
      role: text(e.occupation_role, 120),
      startDate: text(e.start_date, 40),
      isCurrent: e.is_current !== false,
      workplace: [
        text(e.workplace_suburb, 80),
        text(e.workplace_state, 20).toUpperCase(),
      ].filter(Boolean).join(', '),
      workArrangement: humanise(e.work_arrangement),
      grossAnnual: audPerYear(annual),
      extrasAnnual: audPerYear(extras),
    };
  }).filter((e) => e.employer || e.role || e.grossAnnual.value > 0);
}

// ── What is owned, owed and spent ───────────────────────────────────────────

const toAssets = (assets: unknown): AssetRow[] =>
  rows(assets).map((a): AssetRow => ({
    type: humanise(a.asset_type, 'Asset'),
    description: text(a.description, 160)
      || joinName(a.make_model) || text(a.institution_name, 120)
      || humanise(a.vehicle_type),
    value: aud(num(a.value)),
  })).filter((a) => a.value.value !== 0 || a.description);

const toExpenses = (expenses: unknown): ExpenseRow[] =>
  rows(expenses).map((x): ExpenseRow => ({
    category: humanise(x.expense_category, 'Other'),
    name: text(x.expense_name, 120),
    // Through the conversion even though every stored row says `monthly`. The
    // column name is an assertion the schema does not enforce.
    monthly: audPerMonth(freqToMonthly(num(x.monthly_amount), text(x.frequency, 20))),
    isEssential: x.is_essential === true,
  })).filter((x) => x.monthly.value !== 0 || x.name);

// ── Property ────────────────────────────────────────────────────────────────

const PROPERTY_KINDS: Readonly<Record<string, { kind: PropertyKind; label: string }>> = {
  owner_occupied: { kind: 'owner-occupied', label: 'Owner occupied' },
  ppor: { kind: 'owner-occupied', label: 'Owner occupied' },
  principal_place_of_residence: { kind: 'owner-occupied', label: 'Owner occupied' },
  home: { kind: 'owner-occupied', label: 'Owner occupied' },
  investment: { kind: 'investment', label: 'Investment' },
  smsf: { kind: 'smsf', label: 'SMSF' },
  rental: { kind: 'rental', label: 'Rental' },
};

/** Every recorded monthly outgoing on a property, the loan included. */
export function propertyOutgoings(p: Row): number {
  return num(p.monthly_interest_repayment)
    + num(p.monthly_body_corporate)
    + num(p.monthly_landlord_insurance)
    + num(p.monthly_building_insurance)
    + num(p.monthly_repairs_maintenance)
    + num(p.monthly_property_management)
    // Council and water are stored as annual figures under a `monthly_` name —
    // the same trap `finance.pure.ts` documents, and divided the same way.
    + num(p.monthly_council_rates) / 12
    + num(p.monthly_water_rates) / 12;
}

/**
 * The fund's particulars, when the record holds any.
 *
 * "Any" is the rule, not "an identifying one". An earlier version required a
 * fund name, a trustee or an ABN before it would show the block, which would
 * have silently dropped a compliance status recorded without them — and a
 * compliance status is exactly the kind of thing a broker looks for.
 *
 * **Measured: all seven SMSF properties in the record carry none of these seven
 * columns.** So the legacy's "Fund Details & Compliance" block, ticks and
 * hourglasses included, has never had anything to show. Here the section is
 * simply absent until something is recorded.
 */
function toSmsf(p: Row): SmsfDetails | null {
  const fundName = text(p.smsf_fund_name, 160);
  const trusteeName = text(p.smsf_trustee_name, 160);
  const abn = text(p.smsf_abn, 40);
  const anyRecorded = [
    fundName, trusteeName, abn,
    text(p.smsf_trustee_type, 40),
    text(p.smsf_compliance_status, 40),
    text(p.smsf_auditor_name, 160),
  ].some(Boolean);
  if (!anyRecorded) return null;

  const trusteeType = text(p.smsf_trustee_type, 40).toLowerCase();
  return {
    fundName,
    trusteeName,
    // The word, never a symbol. The legacy prints `✓ Compliant`.
    trusteeType: trusteeType === 'corporate'
      ? 'Corporate trustee'
      : trusteeType === 'individual' ? 'Individual trustee' : humanise(trusteeType),
    abn,
    complianceStatus: humanise(p.smsf_compliance_status),
    auditorName: text(p.smsf_auditor_name, 160),
  };
}

export function toProperty(p: Row): PropertyRow {
  const mapped = PROPERTY_KINDS[text(p.property_type, 60).toLowerCase()]
    ?? { kind: 'other' as PropertyKind, label: humanise(p.property_type, 'Property') };

  const value = num(p.value);
  const loan = num(p.loan_remaining);
  const rentMonthly = num(p.monthly_rental_income)
    // The legacy derives the missing direction; this derives the other one too,
    // so a record holding only a weekly figure still produces both.
    || num(p.weekly_rental_income) * (52 / 12);
  const outgoings = propertyOutgoings(p);

  return {
    kind: mapped.kind,
    kindLabel: mapped.label,
    address: text(p.address, 200),
    shortAddress: shortAddress(text(p.address, 200)) || mapped.label,
    value: aud(value),
    loanRemaining: aud(loan),
    equity: aud(value - loan),
    lvr: percent(value > 0 ? (loan / value) * 100 : 0, 1),
    interestRate: optionalNum(p.interest_rate) === null ? null : percent(num(p.interest_rate), 2),
    ownershipPercentage: optionalNum(p.ownership_percentage) === null
      ? null
      : percent(num(p.ownership_percentage), 0),
    lender: text(p.lender_name, 120),
    repaymentType: humanise(p.repayment_type),
    rentMonthly: audPerMonth(rentMonthly),
    rentWeekly: aud(rentMonthly * (12 / 52)),
    expensesMonthly: audPerMonth(outgoings),
    netMonthly: audPerMonth(rentMonthly - outgoings),
    smsf: toSmsf(p),
  };
}

// ── The sentence under the headline ─────────────────────────────────────────

const money = (m: Measure): string => {
  const abs = Math.abs(Math.round(m.value));
  const grouped = String(abs).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${m.value < 0 ? '-' : ''}$${grouped}`;
};

/**
 * Two or three sentences that agree with the tables, because they are built
 * from them.
 *
 * Written to work for a client with nothing recorded, which is what a first
 * draft of this always gets wrong: a paragraph that assumes a portfolio reads as
 * broken for 97% of the record.
 */
export function describeClient(
  meta: ClientDetails['meta'],
  household: Household,
  position: Position,
  properties: readonly PropertyRow[],
): string {
  const who = meta.hasSecondaryContact
    ? `${meta.clientName} are recorded as a household`
    : `${meta.clientName} is recorded`;

  const family = household.maritalStatus
    ? ` as ${household.maritalStatus.toLowerCase()}`
    : '';
  const dependents = household.dependents && household.dependents.value > 0
    ? ` with ${household.dependents.value} dependent${household.dependents.value === 1 ? '' : 's'}`
    : '';

  const holdings = properties.length
    ? `The record holds ${properties.length} ${properties.length === 1 ? 'property' : 'properties'} `
      + `worth ${money(position.propertyValue)} against ${money(position.propertyDebt)} of debt, `
      + `leaving ${money(position.propertyEquity)} of equity. `
    : 'No investment property is recorded against this client. ';

  const standing = position.incomeMonthly.value > 0
    ? `Recorded income is ${money(position.incomeMonthly)} a month against `
      + `${money(position.commitmentsMonthly)} of commitments.`
    : 'No income has been recorded against this client.';

  return `${who}${family}${dependents}. ${holdings}${standing}`;
}

// ── The whole payload ───────────────────────────────────────────────────────

export interface BuildClientDetailsInput {
  /** The `clients` row. The only thing this module refuses to do without. */
  client: unknown;
  properties?: unknown;
  employment?: unknown;
  income?: unknown;
  incomeSources?: unknown;
  assets?: unknown;
  liabilities?: unknown;
  expenses?: unknown;
  addressHistory?: unknown;
  /** The clock lives at the edge. */
  now: string;
}

export function buildClientDetails(input: BuildClientDetailsInput): ClientDetails {
  if (!isRecord(input.client)) {
    throw new ClientDetailsPayloadError('client must be a record');
  }
  const client = input.client;
  const clientId = text(client.id, 64);
  if (!clientId) {
    throw new ClientDetailsPayloadError('the client record has no id');
  }

  const household = toHousehold(client, input.addressHistory);
  const hasSecondaryContact = household.contacts.length > 1;
  // One composition, so the name in `meta` cannot drift from the names on the
  // contact block — or from the title the adapter gives the file, which calls
  // this same function rather than joining the columns itself.
  const clientName = composeClientName(client);

  const allProperties = rows(input.properties).map(toProperty);
  const ownerOccupied = allProperties.find((p) => p.kind === 'owner-occupied') ?? null;
  // The portfolio is everything that is not the home they live in. The
  // owner-occupied one gets its own section, because a client's home is not a
  // holding and putting it in a portfolio table overstates what they invest.
  const properties = allProperties.filter((p) => p.kind !== 'owner-occupied');

  const employment = toEmployment(input.employment);
  const assets = toAssets(input.assets);
  const expenses = toExpenses(input.expenses);

  const rentalMonthly = properties.reduce((s, p) => s + p.rentMonthly.value, 0);

  // The one implementation, shared with the browser. `hecsMonthlyFor` is not
  // supplied here on purpose — see `finance.pure.ts`. No row in the record
  // reaches that branch.
  const rawIncome = buildHouseholdIncome({
    employment: rows(input.employment) as never,
    income: rows(input.income) as never,
    incomeSources: rows(input.incomeSources) as never,
    monthlyRentalIncome: rentalMonthly,
  });

  const servicing = buildLiabilityServicing(rows(input.liabilities) as never, {
    totalGrossAnnualIncome: rawIncome.totalGrossAnnual,
  });

  const rawLiabilities = rows(input.liabilities);
  const liabilities: LiabilityRow[] = servicing.items.map((item, i) => {
    const source = rawLiabilities[i] ?? {};
    return {
      type: humanise(item.type, 'Liability'),
      provider: humanise(source.provider_name, humanise(item.type)),
      balance: aud(item.balance),
      creditLimit: item.limit === undefined ? null : aud(item.limit),
      interestRate: optionalNum(source.interest_rate) === null
        ? null
        : percent(num(source.interest_rate), 2),
      captured: audPerMonth(item.captured),
      monthlyServicing: audPerMonth(item.monthlyServicing),
      isEstimated: item.isEstimated,
      basis: item.calculationNote || 'As recorded',
    };
  });

  const income: IncomeBlock = {
    primaryEmploymentMonthly: audPerMonth(rawIncome.primaryEmploymentMonthly),
    secondaryEmploymentMonthly: audPerMonth(rawIncome.secondaryEmploymentMonthly),
    totalEmploymentMonthly: audPerMonth(rawIncome.totalEmploymentMonthly),
    otherIncome: rawIncome.otherIncome.map((line) => ({
      label: text(line.label, 120),
      monthly: audPerMonth(line.monthly),
      contact: contactRole(line.contactType),
    })),
    totalOtherMonthly: audPerMonth(rawIncome.totalOtherIncomeMonthly),
    rentalMonthly: audPerMonth(rawIncome.totalRentalMonthly),
    totalMonthly: audPerMonth(rawIncome.totalMonthly),
    totalGrossAnnual: audPerYear(rawIncome.totalGrossAnnual),
  };

  // ── The position, every figure summed from the rows printed above ────────
  //
  // `clients.total_portfolio_value` and `clients.total_debt` exist and are
  // deliberately not read: a stored aggregate is a cache, and a cache printed
  // beside the table it caches is a second answer waiting to disagree.

  const propertyValue = properties.reduce((s, p) => s + p.value.value, 0)
    + (ownerOccupied?.value.value ?? 0);
  const propertyDebt = properties.reduce((s, p) => s + p.loanRemaining.value, 0)
    + (ownerOccupied?.loanRemaining.value ?? 0);
  const otherAssets = assets.reduce((s, a) => s + a.value.value, 0);
  const otherLiabilities = liabilities.reduce((s, l) => s + l.balance.value, 0);

  const expenditure = buildPropertyExpenditure(rows(input.properties) as never);
  const personalExpenses = expenses.reduce((s, x) => s + x.monthly.value, 0);
  const commitments = servicing.totalMonthly
    + expenditure.homeLoanRepayments
    + expenditure.totalHoldingCosts
    + personalExpenses;

  const position: Position = {
    propertyValue: aud(propertyValue),
    propertyDebt: aud(propertyDebt),
    propertyEquity: aud(propertyValue - propertyDebt),
    otherAssets: aud(otherAssets),
    otherLiabilities: aud(otherLiabilities),
    netWorth: aud(propertyValue - propertyDebt + otherAssets - otherLiabilities),
    incomeMonthly: audPerMonth(rawIncome.totalMonthly),
    commitmentsMonthly: audPerMonth(commitments),
    surplusMonthly: audPerMonth(rawIncome.totalMonthly - commitments),
    // A share, not a multiple. `1.54x` reads as a debt-to-income ratio, which
    // this is not — it is how much of a month's income is already spoken for.
    commitmentRatio: rawIncome.totalMonthly > 0
      ? percent((commitments / rawIncome.totalMonthly) * 100, 0)
      : null,
  };

  const meta = {
    clientId,
    clientName,
    preparedOn: input.now,
    propertyCount: properties.length,
    hasSecondaryContact,
  };

  return {
    meta,
    narrative: describeClient(meta, household, position, properties),
    household,
    ownerOccupied,
    employment,
    income,
    assets,
    liabilities,
    liabilitiesIncludeEstimates: servicing.hasEstimated,
    expenses,
    properties,
    position,
  };
}

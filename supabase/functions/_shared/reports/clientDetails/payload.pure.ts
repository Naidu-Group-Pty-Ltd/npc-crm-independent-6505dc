/**
 * What a Client Details report says, as a shape.
 *
 * ## The document is about a person, not a portfolio
 *
 * The generator this replaces leads with the property portfolio: Properties
 * Overview, per-property blocks, Portfolio Summary. Measured against the record,
 * **26 of 771 clients have any property at all**. For the other 745 the shipping
 * PDF is a cover, some contact details, and several pages of empty tables.
 *
 * So the shape here puts the person first and makes the portfolio conditional.
 * `household` and `position` are always present; `properties` is routinely
 * empty and the document simply does not have those sections when it is.
 *
 * ## Everything is persisted, so the server reads it
 *
 * Unlike the cash flow formats, nothing here is computed live in a modal against
 * unsaved overrides. Every figure comes from a row in one of nine tables, so the
 * server reads them and the browser sends only a client id. That also means this
 * document can be produced without anyone opening the client.
 *
 * ## No emoji
 *
 * The legacy headings carry `🏠 Owner Occupied`, `📈 Investment`, `🏛️ SMSF`,
 * `💸 Personal Expenses`, and `✓ ✗ ⏳ ▲ ▼ ●` for compliance and cash-flow
 * direction. That is safe when every page is a raster of the browser's own
 * rendering and unsafe the moment the page is real text: the design system's
 * faces carry no emoji coverage, so WeasyPrint would set them as tofu. Every one
 * of them is a word or a sign in this payload.
 */
import type { Measure } from '../../reportDesign/measure.pure.ts';

/** More than this many rows in one collection is a paste, not a client. */
export const MAX_ROWS = 200;

export type ContactRole = 'primary' | 'secondary';

/** One of the two people a client record can describe. */
export interface Contact {
  role: ContactRole;
  /** Given, middle and surname, joined. Empty when the record has no name. */
  name: string;
  email: string;
  mobile: string;
  gender: string;
  /** As stored — a date, not an age. Ages move; the record does not. */
  dateOfBirth: string;
}

/** Where somebody lives, and on what terms. */
export interface Residence {
  address: string;
  suburb: string;
  state: string;
  postcode: string;
  country: string;
  /** `Renting`, `Owner occupied`, … as recorded. */
  livingSituation: string;
  /** `Australian citizen`, `PR`, … as recorded. */
  residentialStatus: string;
}

/** A period at an address, from `client_address_history`. */
export interface AddressPeriod {
  contact: ContactRole | string;
  address: string;
  isCurrent: boolean;
  startDate: string;
  endDate: string;
  months: number | null;
  livingSituation: string;
}

export interface Household {
  contacts: readonly Contact[];
  /** Keyed by role. A secondary sharing the primary's address appears once. */
  residences: readonly { contact: ContactRole; residence: Residence; sharedWithPrimary: boolean }[];
  maritalStatus: string;
  dependents: Measure | null;
  history: readonly AddressPeriod[];
}

export interface EmploymentRow {
  contact: ContactRole | string;
  employer: string;
  /** `Full time`, `Self employed`, … as recorded. */
  employmentType: string;
  role: string;
  startDate: string;
  isCurrent: boolean;
  workplace: string;
  workArrangement: string;
  /** Base salary as an annual figure, whatever frequency it was captured at. */
  grossAnnual: Measure;
  /** Bonus, commission, overtime and allowances, annualised. */
  extrasAnnual: Measure;
}

/** A non-employment income line — dividends, government payments, a trust. */
export interface IncomeLine {
  label: string;
  monthly: Measure;
  contact: ContactRole | string;
}

export interface IncomeBlock {
  primaryEmploymentMonthly: Measure;
  secondaryEmploymentMonthly: Measure;
  totalEmploymentMonthly: Measure;
  otherIncome: readonly IncomeLine[];
  totalOtherMonthly: Measure;
  rentalMonthly: Measure;
  totalMonthly: Measure;
  totalGrossAnnual: Measure;
}

export interface AssetRow {
  /** `Savings`, `Superannuation`, `Vehicle`, … as recorded. */
  type: string;
  description: string;
  value: Measure;
}

export interface LiabilityRow {
  type: string;
  provider: string;
  balance: Measure;
  /** Only for the revolving types. Null elsewhere. */
  creditLimit: Measure | null;
  interestRate: Measure | null;
  /** What the client actually records paying. */
  captured: Measure;
  /** What the servicing engine says it costs to hold. */
  monthlyServicing: Measure;
  /** True when the servicing figure is a model rather than a record. */
  isEstimated: boolean;
  /** How the servicing figure was arrived at, in words. */
  basis: string;
}

export interface ExpenseRow {
  category: string;
  name: string;
  monthly: Measure;
  isEssential: boolean;
}

export type PropertyKind = 'owner-occupied' | 'investment' | 'smsf' | 'rental' | 'other';

/** SMSF particulars, when the property is held in a fund. */
export interface SmsfDetails {
  fundName: string;
  trusteeName: string;
  /** `Corporate trustee` / `Individual trustee` — the word, never a symbol. */
  trusteeType: string;
  abn: string;
  /** `Compliant` / `Non-compliant` / `Pending audit` — the word, never a tick. */
  complianceStatus: string;
  auditorName: string;
}

export interface PropertyRow {
  kind: PropertyKind;
  /** What the reader sees — `Owner occupied`, `Investment`, `SMSF`. */
  kindLabel: string;
  address: string;
  /**
   * A column heading and a chart label — short, but still identifying.
   *
   * Not simply the first comma segment. Half the addresses in the record open
   * with a unit or a lot number, and "Unit 7" as a column header over someone's
   * financial position names nothing. See `shortAddress`.
   */
  shortAddress: string;
  value: Measure;
  loanRemaining: Measure;
  /** Value less what is owed. Derived, never read. */
  equity: Measure;
  /** Derived. Zero-valued property gives zero rather than a division by nothing. */
  lvr: Measure;
  interestRate: Measure | null;
  ownershipPercentage: Measure | null;
  lender: string;
  repaymentType: string;
  rentMonthly: Measure;
  rentWeekly: Measure;
  /** Every recorded monthly outgoing, loan repayment included. Derived. */
  expensesMonthly: Measure;
  /** Rent less outgoings. Derived, so it cannot disagree with its own parts. */
  netMonthly: Measure;
  smsf: SmsfDetails | null;
}

/** Where the client stands, in one block. */
export interface Position {
  propertyValue: Measure;
  propertyDebt: Measure;
  propertyEquity: Measure;
  otherAssets: Measure;
  otherLiabilities: Measure;
  /** Property equity plus other assets less other liabilities. Derived. */
  netWorth: Measure;
  incomeMonthly: Measure;
  /** Liability servicing + property outgoings + personal expenses. Derived. */
  commitmentsMonthly: Measure;
  /** Income less commitments. Routinely negative, and printed as it falls. */
  surplusMonthly: Measure;
  /** Commitments over income. Null when there is no income to divide by. */
  commitmentRatio: Measure | null;
}

/** Everything the document is about. */
export interface ClientDetails {
  meta: {
    clientId: string;
    /** Both names when there are two. The document's title. */
    clientName: string;
    /** ISO instant, supplied by the caller. Nothing here has a clock. */
    preparedOn: string;
    propertyCount: number;
    /** True when the record carries a second person. */
    hasSecondaryContact: boolean;
  };
  /** Two or three sentences framing the record. Built from it, not written. */
  narrative: string;
  household: Household;
  ownerOccupied: PropertyRow | null;
  employment: readonly EmploymentRow[];
  income: IncomeBlock;
  assets: readonly AssetRow[];
  liabilities: readonly LiabilityRow[];
  /** True when any servicing figure above is a model rather than a record. */
  liabilitiesIncludeEstimates: boolean;
  expenses: readonly ExpenseRow[];
  /** Investment and SMSF holdings. The owner-occupied one is not in here. */
  properties: readonly PropertyRow[];
  position: Position;
}

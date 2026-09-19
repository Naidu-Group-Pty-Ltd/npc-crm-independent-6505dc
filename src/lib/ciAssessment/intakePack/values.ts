/**
 * Value coding shared by the pack generator and the pack parser.
 *
 * Both directions live in this one file deliberately. A label the generator
 * writes and a label the parser expects have to agree exactly, and the only
 * way to guarantee that is to derive both from the same table.
 */

import {
  ASSESSMENT_TYPE_DEFINITIONS,
  type AssessmentType,
  type AustralianState,
  type AssetClass,
  type BorrowerStructure,
  type GstTreatmentKey,
  type LiabilityType,
  type PortfolioAssetType,
  type RepaymentType,
  type VerificationStatus,
  type AddbackCategory,
  type IncomePeriodBasis,
  type PropertyClassification,
} from '../types';
import type { FieldType } from './schema';

/** A two-way lookup between engine codes and the human labels in the pack. */
export interface Codec<T extends string> {
  toLabel(code: T): string;
  toCode(label: unknown): T | undefined;
  labels: readonly string[];
}

function buildCodec<T extends string>(pairs: ReadonlyArray<readonly [T, string]>): Codec<T> {
  const codeToLabel = new Map<T, string>(pairs);
  // Match case-insensitively and ignore surrounding whitespace: a user typing
  // over a dropdown is the normal case, not the exception.
  const labelToCode = new Map<string, T>();
  pairs.forEach(([code, label]) => {
    labelToCode.set(label.toLowerCase(), code);
    labelToCode.set(String(code).toLowerCase(), code);
  });
  return {
    toLabel: (code) => codeToLabel.get(code) ?? String(code ?? ''),
    toCode: (label) => {
      if (label == null) return undefined;
      const key = String(label).trim().toLowerCase();
      if (!key) return undefined;
      return labelToCode.get(key);
    },
    labels: pairs.map(([, label]) => label),
  };
}

export const assessmentTypeCodec = buildCodec<AssessmentType>(
  ASSESSMENT_TYPE_DEFINITIONS.map((definition) => [definition.key, definition.label] as const),
);

export const stateCodec = buildCodec<AustralianState>([
  ['NSW', 'NSW'], ['VIC', 'VIC'], ['QLD', 'QLD'], ['WA', 'WA'],
  ['SA', 'SA'], ['TAS', 'TAS'], ['ACT', 'ACT'], ['NT', 'NT'],
]);

export const classificationCodec = buildCodec<PropertyClassification>([
  ['commercial', 'Commercial'], ['industrial', 'Industrial'],
  ['mixed_use', 'Mixed use'], ['land', 'Land'], ['specialised', 'Specialised'],
]);

export const assetClassCodec = buildCodec<AssetClass>([
  ['office', 'Office'], ['retail', 'Retail'], ['warehouse', 'Warehouse'],
  ['logistics', 'Logistics'], ['manufacturing', 'Manufacturing'],
  ['cold_storage', 'Cold storage'], ['medical', 'Medical'], ['childcare', 'Childcare'],
  ['hospitality', 'Hospitality'], ['showroom', 'Showroom'],
  ['transport_yard', 'Transport yard'], ['data_centre', 'Data centre'],
  ['mixed_use', 'Mixed use'], ['other', 'Other'],
]);

export const gstCodec = buildCodec<GstTreatmentKey>([
  ['going_concern', 'Going concern (GST-free)'], ['margin_scheme', 'Margin scheme'],
  ['plus_gst', 'Plus GST'], ['gst_inclusive', 'GST inclusive in price'],
  ['input_taxed', 'Input taxed'], ['unknown', 'Not yet determined'],
]);

/**
 * Borrower structures. Individuals, trusts and SMSFs are as ordinary here as
 * companies — the pack must not push a field consultant towards recording a
 * trust purchase as a company one just because the wording nudges that way.
 */
export const structureCodec = buildCodec<BorrowerStructure>([
  ['individual', 'Individual'], ['joint_individuals', 'Joint individuals'],
  ['company', 'Company'], ['trust', 'Trust'],
  ['corporate_trustee', 'Corporate trustee'], ['partnership', 'Partnership'],
  ['smsf', 'SMSF'], ['spv', 'Special-purpose vehicle'],
]);

export const assetTypeCodec = buildCodec<PortfolioAssetType>([
  ['residential', 'Residential'], ['commercial', 'Commercial'],
  ['industrial', 'Industrial'], ['mixed_use', 'Mixed use'],
  ['land', 'Land'], ['development', 'Development'],
]);

export const liabilityTypeCodec = buildCodec<LiabilityType>([
  ['home_loan', 'Home loan'], ['investment_loan', 'Investment loan'],
  ['commercial_facility', 'Commercial facility'], ['equipment_finance', 'Equipment finance'],
  ['vehicle_finance', 'Vehicle finance'], ['credit_card', 'Credit card'],
  ['overdraft', 'Overdraft'], ['line_of_credit', 'Line of credit'],
  ['tax_debt', 'Tax debt'], ['lease', 'Lease'], ['guarantee', 'Guarantee'],
  ['contingent', 'Contingent liability'], ['private_debt', 'Private debt'],
  ['hecs_help', 'HECS / HELP'], ['other', 'Other'],
]);

export const repaymentCodec = buildCodec<RepaymentType>([
  ['principalAndInterest', 'Principal and interest'],
  ['interestOnly', 'Interest only'],
  ['residualTerm', 'Residual / balloon'],
]);

export const verificationCodec = buildCodec<VerificationStatus>([
  ['unverified', 'Not verified'],
  ['documents_held', 'Documents held, not checked'],
  ['verified', 'Verified'],
]);

export const periodBasisCodec = buildCodec<IncomePeriodBasis>([
  ['financial_statements', 'Accountant-prepared financial statements'],
  ['tax_return', 'Tax return'],
  ['notice_of_assessment', 'Notice of assessment'],
  ['management_accounts', 'Management accounts'],
  ['ytd', 'Year to date'],
  ['projection', 'Projection'],
]);

export const addbackCategoryCodec = buildCodec<AddbackCategory>([
  ['depreciation', 'Depreciation'], ['interest', 'Interest'],
  ['director_remuneration', 'Director remuneration'],
  ['one_off', 'One-off / non-recurring'], ['non_cash', 'Non-cash'],
  ['rent_to_related_party', 'Rent to a related party'],
  ['superannuation', 'Superannuation'], ['other', 'Other'],
]);

export const tenantQualityCodec = buildCodec<string>([
  ['government', 'Government'], ['national', 'National tenant'],
  ['listed', 'Listed company'], ['established_sme', 'Established SME'],
  ['new_business', 'New business'], ['related_party', 'Related party'],
  ['unknown', 'Not yet known'],
]);

export const leaseBasisCodec = buildCodec<string>([
  ['net', 'Net — tenant pays outgoings'],
  ['gross', 'Gross — landlord pays outgoings'],
  ['semi_gross', 'Semi-gross'],
]);

export const residencyCodec = buildCodec<string>([
  ['australian', 'Australian citizen'],
  ['permanent_resident', 'Permanent resident'],
  ['foreign', 'Foreign resident'],
]);

export const taxResidencyCodec = buildCodec<string>([
  ['australian', 'Australian tax resident'],
  ['foreign', 'Foreign tax resident'],
  ['unknown', 'Not yet confirmed'],
]);

/** Which codec applies to a given field key. */
export const FIELD_CODECS: Record<string, Codec<string>> = {
  'assessment.type': assessmentTypeCodec as Codec<string>,
  'property.state': stateCodec as Codec<string>,
  'property.classification': classificationCodec as Codec<string>,
  'property.assetClass': assetClassCodec as Codec<string>,
  'property.gstTreatment': gstCodec as Codec<string>,
  'loan.repaymentType': repaymentCodec as Codec<string>,
  'entity.structure': structureCodec as Codec<string>,
  'entity.residency': residencyCodec,
  'entity.taxResidency': taxResidencyCodec,
  'asset.assetType': assetTypeCodec as Codec<string>,
  'asset.repaymentType': repaymentCodec as Codec<string>,
  'liability.liabilityType': liabilityTypeCodec as Codec<string>,
  'liability.repaymentType': repaymentCodec as Codec<string>,
  'period.basis': periodBasisCodec as Codec<string>,
  'period.verification': verificationCodec as Codec<string>,
  'addback.category': addbackCategoryCodec as Codec<string>,
  'tenancy.tenantQuality': tenantQualityCodec,
  'tenancy.verification': verificationCodec as Codec<string>,
  'lease.leaseBasis': leaseBasisCodec,
};

// ---------------------------------------------------------------------------
// Scalar coercion
// ---------------------------------------------------------------------------

/** Yes/No/unknown, as written into the pack. */
export function encodeBoolean(value: unknown): string {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  return '';
}

/**
 * Decode a tri-state answer. Returns `null` for "not yet known" so a genuine
 * unknown is not silently collapsed into `false` — that distinction drives the
 * compliance classification.
 */
export function decodeTriState(value: unknown): boolean | null | undefined {
  if (value == null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  const text = String(value).trim().toLowerCase();
  if (['yes', 'y', 'true', '1'].includes(text)) return true;
  if (['no', 'n', 'false', '0'].includes(text)) return false;
  if (['not yet known', 'unknown', 'unsure', 'tbc', 'n/a'].includes(text)) return null;
  return undefined;
}

/** Strict boolean decode for fields with no meaningful third state. */
export function decodeBoolean(value: unknown): boolean | undefined {
  const decoded = decodeTriState(value);
  return decoded === null ? undefined : decoded;
}

/**
 * Parse a money or numeric cell. Tolerates the way people actually type into
 * spreadsheets: `$1,250,000`, `1.25m`, `(500)` for negatives, stray spaces.
 */
export function decodeNumber(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;

  let text = String(value).trim().toLowerCase();
  if (!text) return undefined;

  // Accounting negatives.
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }

  let multiplier = 1;
  if (/[0-9]\s*m$/.test(text)) { multiplier = 1_000_000; text = text.replace(/m$/, ''); }
  else if (/[0-9]\s*k$/.test(text)) { multiplier = 1_000; text = text.replace(/k$/, ''); }

  const cleaned = text.replace(/[$,%\s]/g, '');
  if (cleaned === '' || cleaned === '-') return undefined;

  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return undefined;
  const result = parsed * multiplier;
  return negative ? -result : result;
}

/**
 * Normalise a date cell to `YYYY-MM-DD`.
 * Excel hands back either a JS Date (when the cell is date-formatted) or a
 * string, and Australian users write `dd/mm/yyyy` — which `new Date()` parses
 * as US month-first and would silently shift the date.
 */
export function decodeDate(value: unknown): string | undefined {
  if (value == null || value === '') return undefined;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return toIsoDate(value);
  }

  // A bare number in a date field is an Excel serial. Workbooks rebuilt by
  // hand (or by another tool) often lose the date number-format, so the cell
  // arrives as e.g. 45838 rather than a Date. The plausible window 1955–2118
  // keeps a stray small count or a year typed as a number from being read as
  // a date.
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= 20000 && value <= 80000 && Number.isInteger(value)) {
      // Excel's day 0 is 30 December 1899 (the off-by-two Lotus legacy).
      const millis = Date.UTC(1899, 11, 30) + value * 86_400_000;
      const date = new Date(millis);
      return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    }
    return undefined;
  }

  const text = String(value).trim();
  if (!text) return undefined;

  // Already ISO.
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // Australian day-first, with / . or - separators.
  const auStyle = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (auStyle) {
    const day = Number(auStyle[1]);
    const month = Number(auStyle[2]);
    let year = Number(auStyle[3]);
    if (year < 100) year += year < 70 ? 2000 : 1900;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? undefined : toIsoDate(parsed);
}

/**
 * An ISO date as a real `Date`, for writing into a spreadsheet cell.
 *
 * Written as a string, a date is text: Excel left-aligns it, will not sort it,
 * and the `dd/mm/yyyy` number format on the cell does nothing. Written as a
 * Date it behaves like one. Midday UTC because a midnight value shifts to the
 * previous day everywhere west of Greenwich, which for Australian users turns
 * every settlement date into the day before.
 */
export function toSpreadsheetDate(value: unknown): Date | null {
  const iso = decodeDate(value);
  if (!iso) return null;
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

/**
 * An encoded value formatted for a human to read.
 *
 * The workbook does not use this: there a money field has to stay a number so
 * Excel can total it, and the `#,##0` format on the cell is what turns it into
 * `5,850,000` on screen. The Word guide and the in-app viewer have no such
 * layer, so a raw `5850000` printed on a client-facing page is just an
 * unreadable string of digits. This applies the same formatting the spreadsheet
 * would, so all three read alike.
 */
export function toDisplayValue(type: FieldType, value: string | number): string {
  const text = String(value ?? '');
  if (!text) return '';

  switch (type) {
    case 'date':
      return toDisplayDate(text) || text;
    case 'money': {
      const numeric = typeof value === 'number' ? value : decodeNumber(value);
      return numeric == null
        ? text
        : `$${numeric.toLocaleString('en-AU', { maximumFractionDigits: 0 })}`;
    }
    case 'percent': {
      const numeric = typeof value === 'number' ? value : decodeNumber(value);
      return numeric == null ? text : `${numeric.toLocaleString('en-AU')}%`;
    }
    case 'number': {
      const numeric = typeof value === 'number' ? value : decodeNumber(value);
      return numeric == null ? text : numeric.toLocaleString('en-AU');
    }
    default:
      return text;
  }
}

/** An ISO date as `dd/mm/yyyy`, for reading on a printed page. */
export function toDisplayDate(value: unknown): string {
  const iso = decodeDate(value);
  if (!iso) return '';
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}

function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export interface EncodeOptions {
  /**
   * Write a genuine zero as `0` rather than leaving the cell blank.
   *
   * Off by default, because a pack pre-filled from an empty assessment would
   * otherwise arrive at the client meeting sprayed with meaningless zeroes.
   * On when the pack is generated from data somebody actually entered, where a
   * zero is an answer: a guarantor holding 0% of the property, a refinance of
   * nil, a residual of nil. Blanking those loses the fact that they were asked.
   */
  preserveZeroes?: boolean;
}

/** Encode an engine value for writing into a pack cell. */
export function encodeValue(
  fieldKey: string, type: FieldType, value: unknown, options: EncodeOptions = {},
): string | number {
  if (value == null || value === '') return '';

  const codec = FIELD_CODECS[fieldKey];
  if (codec) {
    // Tri-state selects hold booleans rather than codes.
    if (typeof value === 'boolean') return encodeBoolean(value);
    return codec.toLabel(String(value));
  }

  switch (type) {
    case 'boolean':
      return encodeBoolean(value);
    case 'money':
    case 'percent':
    case 'number': {
      const numeric = typeof value === 'number' ? value : decodeNumber(value);
      if (numeric == null) return '';
      // See `EncodeOptions.preserveZeroes` for why a zero is usually blanked.
      return numeric === 0 && !options.preserveZeroes ? '' : numeric;
    }
    case 'select':
      return String(value);
    default:
      return String(value);
  }
}

/** Decode a pack cell back into the engine's representation. */
export function decodeValue(fieldKey: string, type: FieldType, raw: unknown): unknown {
  if (raw == null || String(raw).trim() === '') return undefined;

  // Tri-state selects that map onto booleans/null in the payload.
  if (fieldKey === 'ownership.purposeIsPredominantlyBusiness') return decodeTriState(raw);
  if (fieldKey === 'ownership.residentialSecurityInvolved') {
    const decoded = decodeTriState(raw);
    return decoded === null ? false : decoded;
  }

  const codec = FIELD_CODECS[fieldKey];
  if (codec) return codec.toCode(raw);

  switch (type) {
    case 'boolean': return decodeBoolean(raw);
    case 'money':
    case 'number': return decodeNumber(raw);
    case 'percent': {
      const numeric = decodeNumber(raw);
      if (numeric == null) return undefined;
      // A user writing 0.065 for a 6.5% rate is unambiguous — no real
      // commercial rate or allowance is a fraction of one per cent.
      return numeric > 0 && numeric < 1 ? numeric * 100 : numeric;
    }
    case 'date': return decodeDate(raw);
    default: return String(raw).trim();
  }
}

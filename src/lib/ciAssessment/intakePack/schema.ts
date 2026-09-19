/**
 * Intake-pack field schema.
 *
 * One canonical description of every field the offline pack collects. The
 * spreadsheet generator, the spreadsheet parser and the Word interview script
 * are all built from this list, so a field added here appears in all three and
 * none of them can silently drift out of step with the others.
 *
 * Two properties make the round-trip reliable:
 *
 *  - every field carries a stable `key` that is written into the workbook and
 *    read back from it. Values are matched by key, never by row position or
 *    label text, so a user inserting rows, re-ordering sections or rewording a
 *    label cannot corrupt the import.
 *  - every field states its `path` into `AssessmentPayload`, so the parser
 *    reconstructs a real payload rather than a loose bag of strings.
 *
 * `question` is the wording a consultant reads aloud when sitting with a
 * client. It is deliberately conversational — this pack is a sales and
 * fact-find instrument, not a database form.
 */

import {
  ASSESSMENT_TYPE_DEFINITIONS,
  type AssessmentPayload,
} from '../types';

export type FieldType = 'text' | 'money' | 'percent' | 'number' | 'date' | 'select' | 'boolean' | 'longtext';

export interface PackField {
  /** Stable identifier written to the workbook. Never change once shipped. */
  key: string;
  label: string;
  /** Interview wording. Shown in the Word script and as a spreadsheet note. */
  question: string;
  type: FieldType;
  /** Dot path into AssessmentPayload, relative to the section root. */
  path: string;
  options?: readonly string[];
  /** Advanced fields are collected but marked optional in the pack. */
  optional?: boolean;
  help?: string;
}

export interface PackSection {
  id: string;
  /** Sheet name in the workbook. Excel caps these at 31 characters. */
  sheetName: string;
  title: string;
  /** Which wizard step this maps to, for the user's orientation. */
  step: number;
  intro: string;
  /** 'single' writes key/label/value rows; 'table' writes a repeatable grid. */
  shape: 'single' | 'table';
  /** For table sections: the payload array this populates. */
  collectionPath?: string;
  fields: readonly PackField[];
}

// ---------------------------------------------------------------------------
// Option lists — kept in step with the engine's own unions.
// ---------------------------------------------------------------------------

export const ASSESSMENT_TYPE_OPTIONS = ASSESSMENT_TYPE_DEFINITIONS.map((d) => d.label);

export const STATE_OPTIONS = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'] as const;

export const CLASSIFICATION_OPTIONS = ['Commercial', 'Industrial', 'Mixed use', 'Land', 'Specialised'] as const;

export const ASSET_CLASS_OPTIONS = [
  'Office', 'Retail', 'Warehouse', 'Logistics', 'Manufacturing', 'Cold storage',
  'Medical', 'Childcare', 'Hospitality', 'Showroom', 'Transport yard',
  'Data centre', 'Mixed use', 'Other',
] as const;

export const GST_OPTIONS = [
  'Going concern (GST-free)', 'Margin scheme', 'Plus GST',
  'GST inclusive in price', 'Input taxed', 'Not yet determined',
] as const;

/**
 * Borrower structures.
 *
 * Individuals, trusts and SMSFs all acquire commercial and industrial property,
 * so the pack treats them as first-class rather than assuming a company
 * borrower. The trustee, beneficiary and SMSF columns below exist precisely so
 * a trust or fund purchase can be captured properly in the field.
 */
export const STRUCTURE_OPTIONS = [
  'Individual', 'Joint individuals', 'Company', 'Trust',
  'Corporate trustee', 'Partnership', 'SMSF', 'Special-purpose vehicle',
] as const;

export const ASSET_TYPE_OPTIONS = [
  'Residential', 'Commercial', 'Industrial', 'Mixed use', 'Land', 'Development',
] as const;

export const LIABILITY_TYPE_OPTIONS = [
  'Home loan', 'Investment loan', 'Commercial facility', 'Equipment finance',
  'Vehicle finance', 'Credit card', 'Overdraft', 'Line of credit', 'Tax debt',
  'Lease', 'Guarantee', 'Contingent liability', 'Private debt', 'HECS / HELP', 'Other',
] as const;

export const REPAYMENT_OPTIONS = ['Principal and interest', 'Interest only', 'Residual / balloon'] as const;

export const VERIFICATION_OPTIONS = ['Not verified', 'Documents held, not checked', 'Verified'] as const;

export const PERIOD_BASIS_OPTIONS = [
  'Accountant-prepared financial statements', 'Tax return', 'Notice of assessment',
  'Management accounts', 'Year to date', 'Projection',
] as const;

export const ADDBACK_CATEGORY_OPTIONS = [
  'Depreciation', 'Interest', 'Director remuneration', 'One-off / non-recurring',
  'Non-cash', 'Rent to a related party', 'Superannuation', 'Other',
] as const;

export const TENANT_QUALITY_OPTIONS = [
  'Government', 'National tenant', 'Listed company', 'Established SME',
  'New business', 'Related party', 'Not yet known',
] as const;

export const YES_NO_OPTIONS = ['Yes', 'No', 'Not yet known'] as const;

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

const transactionFields: readonly PackField[] = [
  {
    key: 'assessment.type', label: 'Transaction type', type: 'select', path: 'assessmentType',
    options: ASSESSMENT_TYPE_OPTIONS,
    question: 'What kind of transaction is this — an investment purchase, owner-occupied premises, a refinance, or something else?',
    help: 'This decides which income drives the servicing test.',
  },
  {
    key: 'property.address', label: 'Street address', type: 'text', path: 'property.address',
    question: 'What is the full street address of the property?',
  },
  { key: 'property.suburb', label: 'Suburb', type: 'text', path: 'property.suburb', question: 'Which suburb?' },
  {
    key: 'property.state', label: 'State', type: 'select', path: 'property.state', options: STATE_OPTIONS,
    question: 'Which state or territory?',
  },
  { key: 'property.postcode', label: 'Postcode', type: 'text', path: 'property.postcode', question: 'Postcode?' },
  {
    key: 'property.classification', label: 'Property classification', type: 'select',
    path: 'property.classification', options: CLASSIFICATION_OPTIONS,
    question: 'Is the property commercial, industrial, mixed use, land or specialised?',
  },
  {
    key: 'property.assetClass', label: 'Asset class', type: 'select',
    path: 'property.assetClass', options: ASSET_CLASS_OPTIONS,
    question: 'What type of building is it — office, retail, warehouse, and so on?',
  },
  {
    key: 'property.purchasePrice', label: 'Purchase price', type: 'money', path: 'property.purchasePrice',
    question: 'What is the purchase price, or the price being negotiated?',
  },
  {
    key: 'property.currentValuation', label: 'Current valuation or estimate', type: 'money',
    path: 'property.currentValuation',
    question: 'Is there a valuation, or an estimate of what it is worth?',
    help: 'Lending is struck against the lower of price and valuation.',
  },
  {
    key: 'property.valuationDate', label: 'Valuation date', type: 'date', path: 'property.valuationDate',
    question: 'When was that valuation done?', optional: true,
  },
  {
    key: 'property.valuationSource', label: 'Valuation source', type: 'text', path: 'property.valuationSource',
    question: 'Who prepared it?', optional: true,
  },
  {
    key: 'property.contractDate', label: 'Contract date', type: 'date', path: 'property.contractDate',
    question: 'Has a contract been signed, and if so when?', optional: true,
  },
  {
    key: 'property.settlementDate', label: 'Settlement date', type: 'date', path: 'property.settlementDate',
    question: 'When is settlement due?', optional: true,
  },
  {
    key: 'property.gstTreatment', label: 'GST treatment', type: 'select',
    path: 'property.gstTreatment', options: GST_OPTIONS,
    question: 'How is GST being handled — going concern, margin scheme, plus GST, or not yet decided?',
  },
  {
    key: 'property.lettableAreaSqm', label: 'Lettable area (m²)', type: 'number',
    path: 'property.lettableAreaSqm', question: 'How large is the lettable area?', optional: true,
  },
  {
    key: 'property.siteAreaSqm', label: 'Site area (m²)', type: 'number',
    path: 'property.siteAreaSqm', question: 'How large is the site?', optional: true,
  },
  { key: 'property.stampDuty', label: 'Stamp duty', type: 'money', path: 'property.stampDuty', question: 'Estimated stamp duty?' },
  { key: 'property.legalCosts', label: 'Legal costs', type: 'money', path: 'property.legalCosts', question: 'Legal and conveyancing costs?', optional: true },
  { key: 'property.valuationCosts', label: 'Valuation costs', type: 'money', path: 'property.valuationCosts', question: 'Valuation fees?', optional: true },
  { key: 'property.lenderFees', label: 'Lender fees', type: 'money', path: 'property.lenderFees', question: 'Any lender or broker fees?', optional: true },
  { key: 'property.fitOut', label: 'Fit-out', type: 'money', path: 'property.fitOut', question: 'Is any fit-out being funded?', optional: true },
  { key: 'property.plantAndEquipment', label: 'Plant and equipment', type: 'money', path: 'property.plantAndEquipment', question: 'Plant or equipment being purchased with it?', optional: true },
  { key: 'property.repairs', label: 'Repairs', type: 'money', path: 'property.repairs', question: 'Immediate repairs needed?', optional: true },
  { key: 'property.immediateCapex', label: 'Immediate capital works', type: 'money', path: 'property.immediateCapex', question: 'Any capital works planned straight away?', optional: true },
  { key: 'property.contingency', label: 'Contingency', type: 'money', path: 'property.contingency', question: 'What contingency should we allow?', optional: true },
  {
    key: 'property.depositOrContribution', label: 'Deposit / cash contribution', type: 'money',
    path: 'property.depositOrContribution',
    question: 'How much of their own funds is the borrower contributing?',
  },
  {
    key: 'property.refinanceAmount', label: 'Amount being refinanced', type: 'money',
    path: 'property.refinanceAmount', question: 'If refinancing, what is the existing balance?', optional: true,
  },
  {
    key: 'property.proposedEquityRelease', label: 'Proposed equity release', type: 'money',
    path: 'property.proposedEquityRelease', question: 'Is any equity being released, and what for?', optional: true,
  },
  // ---- Loan structure (step 7) --------------------------------------------
  { key: 'loan.requestedLoan', label: 'Requested loan amount', type: 'money', path: 'loan.requestedLoan', question: 'How much are they looking to borrow?' },
  { key: 'loan.actualRatePercent', label: 'Expected interest rate (%)', type: 'percent', path: 'loan.actualRatePercent', question: 'What rate are we assuming?' },
  { key: 'loan.repaymentType', label: 'Repayment type', type: 'select', path: 'loan.repaymentType', options: REPAYMENT_OPTIONS, question: 'Principal and interest, or interest only?' },
  { key: 'loan.loanTermYears', label: 'Loan term (years)', type: 'number', path: 'loan.loanTermYears', question: 'What facility term?' },
  { key: 'loan.amortisationYears', label: 'Amortisation (years)', type: 'number', path: 'loan.amortisationYears', question: 'Over how many years does it amortise?' },
  { key: 'loan.interestOnlyPeriodYears', label: 'Interest-only period (years)', type: 'number', path: 'loan.interestOnlyPeriodYears', question: 'Any interest-only period at the start?', optional: true },
  { key: 'loan.residualBalloonAmount', label: 'Residual / balloon', type: 'money', path: 'loan.residualBalloonAmount', question: 'Is there a residual or balloon at the end?', optional: true },
  { key: 'loan.establishmentFees', label: 'Establishment fees', type: 'money', path: 'loan.establishmentFees', question: 'Establishment fees?', optional: true },
  { key: 'loan.annualFees', label: 'Annual fees', type: 'money', path: 'loan.annualFees', question: 'Ongoing annual fees?', optional: true },
];

/**
 * Ownership — one row per borrowing entity.
 *
 * Trusts, SMSFs and individuals buy commercial property routinely, so this
 * table carries trustee, beneficiary and fund columns alongside the company
 * ones. Getting the structure right here is what lets the engine attribute a
 * linked client's portfolio and strike a defensible global position.
 */
const ownershipFields: readonly PackField[] = [
  { key: 'entity.name', label: 'Entity or person name', type: 'text', path: 'entityName', question: 'Who exactly is borrowing? Give the full legal name.' },
  { key: 'entity.structure', label: 'Structure', type: 'select', path: 'structure', options: STRUCTURE_OPTIONS, question: 'Is that an individual, a company, a trust, an SMSF, or something else?' },
  { key: 'entity.abnAcn', label: 'ABN / ACN', type: 'text', path: 'abnAcn', question: 'What is the ABN or ACN?', optional: true },
  { key: 'entity.ownershipPercent', label: 'Ownership (%)', type: 'percent', path: 'ownershipPercent', question: 'What share will this party hold? All parties must total 100%.' },
  { key: 'entity.directors', label: 'Directors', type: 'text', path: 'directors', question: 'Who are the directors?', optional: true },
  { key: 'entity.trustees', label: 'Trustee(s)', type: 'text', path: 'trustees', question: 'If a trust or SMSF, who is the trustee? Is it a corporate trustee?', optional: true },
  { key: 'entity.beneficiaries', label: 'Beneficiaries / members', type: 'text', path: 'beneficiaries', question: 'Who are the beneficiaries, or the fund members?', optional: true },
  { key: 'entity.isGuarantor', label: 'Provides a guarantee', type: 'boolean', path: 'isGuarantor', question: 'Will this party guarantee the loan?', optional: true },
  { key: 'entity.relatedEntities', label: 'Related entities', type: 'text', path: 'relatedEntities', question: 'Are there related entities we should know about?', optional: true },
  { key: 'entity.yearsTrading', label: 'Years trading', type: 'number', path: 'yearsTrading', question: 'How long has the business been trading?', optional: true },
  { key: 'entity.industry', label: 'Industry', type: 'text', path: 'industry', question: 'What industry are they in?', optional: true },
  { key: 'entity.residency', label: 'Residency', type: 'select', path: 'residency', options: ['Australian citizen', 'Permanent resident', 'Foreign resident'], question: 'Are all parties Australian residents?', optional: true },
  { key: 'entity.taxResidency', label: 'Tax residency', type: 'select', path: 'taxResidency', options: ['Australian tax resident', 'Foreign tax resident', 'Not yet confirmed'], question: 'And for tax purposes?', optional: true },
  { key: 'entity.beneficialOwnership', label: 'Beneficial ownership / control', type: 'longtext', path: 'beneficialOwnership', question: 'Who ultimately owns or controls this entity?', optional: true, help: 'Recorded for the assessment. Formal AML verification stays in the AML workflow.' },
];

const incomePeriodFields: readonly PackField[] = [
  { key: 'period.label', label: 'Period', type: 'text', path: 'label', question: 'Which financial year or period is this?' },
  { key: 'period.periodEnd', label: 'Period end date', type: 'date', path: 'periodEnd', question: 'What date does it end?' },
  { key: 'period.basis', label: 'Basis', type: 'select', path: 'basis', options: PERIOD_BASIS_OPTIONS, question: 'Are these accountant-prepared figures, a tax return, or management accounts?' },
  { key: 'period.verification', label: 'Verification', type: 'select', path: 'verification', options: VERIFICATION_OPTIONS, question: 'Do we hold the documents, and have they been checked?' },
  { key: 'period.salaryWages', label: 'Salary and wages', type: 'money', path: 'salaryWages', question: 'Any PAYG salary income?', optional: true },
  { key: 'period.businessRevenue', label: 'Business revenue', type: 'money', path: 'businessRevenue', question: 'What was turnover?', optional: true },
  { key: 'period.ebitda', label: 'EBITDA', type: 'money', path: 'ebitda', question: 'What was EBITDA?', optional: true },
  { key: 'period.npat', label: 'Net profit after tax', type: 'money', path: 'npat', question: 'Net profit after tax?', optional: true },
  { key: 'period.depreciation', label: 'Depreciation', type: 'money', path: 'depreciation', question: 'Depreciation charged?', optional: true },
  { key: 'period.interestExpense', label: 'Interest expense', type: 'money', path: 'interestExpense', question: 'Interest expense?', optional: true },
  { key: 'period.directorRemuneration', label: 'Director remuneration', type: 'money', path: 'directorRemuneration', question: 'What are the directors paying themselves?', optional: true },
  { key: 'period.distributions', label: 'Trust distributions', type: 'money', path: 'distributions', question: 'Any trust distributions?', optional: true },
  { key: 'period.dividends', label: 'Dividends', type: 'money', path: 'dividends', question: 'Any dividends?', optional: true },
  { key: 'period.rentReceived', label: 'Rent received', type: 'money', path: 'rentReceived', question: 'Rental income received?', optional: true },
  { key: 'period.otherRecurringIncome', label: 'Other recurring income', type: 'money', path: 'otherRecurringIncome', question: 'Any other income that recurs?', optional: true },
  { key: 'period.nonRecurringIncome', label: 'Non-recurring income', type: 'money', path: 'nonRecurringIncome', question: 'Any one-off income?', optional: true, help: 'Shaded to nil by default policy.' },
];

const addbackFields: readonly PackField[] = [
  { key: 'addback.periodLabel', label: 'Period', type: 'text', path: 'periodLabel', question: 'Which period does this add-back belong to? Use the same label as the income sheet.' },
  { key: 'addback.category', label: 'Category', type: 'select', path: 'category', options: ADDBACK_CATEGORY_OPTIONS, question: 'What kind of add-back is it?' },
  { key: 'addback.amount', label: 'Amount', type: 'money', path: 'amount', question: 'How much?' },
  { key: 'addback.reason', label: 'Reason', type: 'longtext', path: 'reason', question: 'Why will this not recur, or why is it not a real cash cost?' },
  { key: 'addback.source', label: 'Source document', type: 'text', path: 'source', question: 'Which document evidences it?' },
  { key: 'addback.confirmed', label: 'Confirmed', type: 'boolean', path: 'confirmed', question: 'Has this been confirmed against the source?', help: 'An add-back is excluded from income until this is Yes and a reason and source are recorded.' },
];

const portfolioFields: readonly PackField[] = [
  { key: 'asset.address', label: 'Property address', type: 'text', path: 'address', question: 'What other properties are owned? Start with the address.' },
  { key: 'asset.ownershipEntity', label: 'Owning entity', type: 'text', path: 'ownershipEntity', question: 'Which entity owns it — personally, through a trust, the SMSF, or a company?', help: 'Match this to a name on the Ownership sheet so the group position adds up.' },
  { key: 'asset.ownershipPercent', label: 'Ownership (%)', type: 'percent', path: 'ownershipPercent', question: 'What share do they own?' },
  { key: 'asset.assetType', label: 'Asset type', type: 'select', path: 'assetType', options: ASSET_TYPE_OPTIONS, question: 'Is it residential, commercial, industrial, land?' },
  { key: 'asset.currentValue', label: 'Current value', type: 'money', path: 'currentValue', question: 'What is it worth today?' },
  { key: 'asset.currentBalance', label: 'Loan balance', type: 'money', path: 'currentBalance', question: 'What is still owing on it?' },
  { key: 'asset.existingLender', label: 'Lender', type: 'text', path: 'existingLender', question: 'Who is the lender?', optional: true },
  { key: 'asset.facilityLimit', label: 'Facility limit', type: 'money', path: 'facilityLimit', question: 'What is the facility limit?', optional: true },
  { key: 'asset.interestRate', label: 'Interest rate (%)', type: 'percent', path: 'interestRate', question: 'What rate are they paying?' },
  { key: 'asset.repaymentType', label: 'Repayment type', type: 'select', path: 'repaymentType', options: REPAYMENT_OPTIONS, question: 'Principal and interest, or interest only?' },
  { key: 'asset.remainingTermYears', label: 'Remaining term (years)', type: 'number', path: 'remainingTermYears', question: 'How many years are left?', optional: true },
  { key: 'asset.annualRepayments', label: 'Annual repayments', type: 'money', path: 'annualRepayments', question: 'What do they actually repay each year?', optional: true, help: 'Leave blank and it will be derived from balance, rate and term.' },
  { key: 'asset.annualRent', label: 'Annual rent received', type: 'money', path: 'annualRent', question: 'What rent does it bring in?', optional: true },
  { key: 'asset.leaseExpiry', label: 'Lease expiry', type: 'date', path: 'leaseExpiry', question: 'When does the lease expire?', optional: true },
  { key: 'asset.vacancyPercent', label: 'Vacancy (%)', type: 'percent', path: 'vacancyPercent', question: 'Any vacancy to allow for?', optional: true },
  { key: 'asset.outgoings', label: 'Outgoings', type: 'money', path: 'outgoings', question: 'Annual outgoings?', optional: true },
  { key: 'asset.rates', label: 'Rates', type: 'money', path: 'rates', question: 'Council rates?', optional: true },
  { key: 'asset.insurance', label: 'Insurance', type: 'money', path: 'insurance', question: 'Insurance?', optional: true },
  { key: 'asset.maintenance', label: 'Maintenance', type: 'money', path: 'maintenance', question: 'Maintenance?', optional: true },
  { key: 'asset.managementCosts', label: 'Management costs', type: 'money', path: 'managementCosts', question: 'Property management fees?', optional: true },
  { key: 'asset.crossCollateralised', label: 'Cross-collateralised', type: 'boolean', path: 'crossCollateralised', question: 'Is it cross-secured with anything else?', optional: true },
];

const liabilityFields: readonly PackField[] = [
  { key: 'liability.description', label: 'Description', type: 'text', path: 'description', question: 'What other debts or commitments are there?' },
  { key: 'liability.liabilityType', label: 'Type', type: 'select', path: 'liabilityType', options: LIABILITY_TYPE_OPTIONS, question: 'What kind of facility is it?' },
  { key: 'liability.ownershipEntity', label: 'Held by (entity)', type: 'text', path: 'ownershipEntity', question: 'Which entity or person holds it?', help: 'Match a name from the Ownership sheet.' },
  { key: 'liability.lender', label: 'Lender', type: 'text', path: 'lender', question: 'Who is the lender or provider?', optional: true },
  { key: 'liability.balance', label: 'Balance owing', type: 'money', path: 'balance', question: 'What is the balance?' },
  { key: 'liability.limit', label: 'Limit', type: 'money', path: 'limit', question: 'What is the limit?', help: 'Cards and overdrafts are assessed on the limit, not the balance.' },
  { key: 'liability.interestRate', label: 'Interest rate (%)', type: 'percent', path: 'interestRate', question: 'What rate?', optional: true },
  { key: 'liability.repaymentType', label: 'Repayment type', type: 'select', path: 'repaymentType', options: REPAYMENT_OPTIONS, question: 'How is it repaid?', optional: true },
  { key: 'liability.remainingTermYears', label: 'Remaining term (years)', type: 'number', path: 'remainingTermYears', question: 'How long left to run?', optional: true },
  { key: 'liability.annualRepayments', label: 'Annual repayments', type: 'money', path: 'annualRepayments', question: 'Annual repayments?', optional: true },
  { key: 'liability.isContingent', label: 'Contingent / guarantee', type: 'boolean', path: 'isContingent', question: 'Is this a guarantee or contingent exposure rather than a drawn debt?', optional: true },
];

const tenancyFields: readonly PackField[] = [
  { key: 'tenancy.tenantName', label: 'Tenant', type: 'text', path: 'tenantName', question: 'Who are the tenants in the property being bought?' },
  { key: 'tenancy.annualRent', label: 'Annual rent', type: 'money', path: 'annualRent', question: 'What rent do they pay each year?' },
  { key: 'tenancy.areaSqm', label: 'Area (m²)', type: 'number', path: 'areaSqm', question: 'How much area do they occupy?', optional: true },
  { key: 'tenancy.leaseCommencement', label: 'Lease start', type: 'date', path: 'leaseCommencement', question: 'When did the lease start?', optional: true },
  { key: 'tenancy.leaseExpiry', label: 'Lease expiry', type: 'date', path: 'leaseExpiry', question: 'When does it expire?' },
  { key: 'tenancy.optionsYears', label: 'Options (years)', type: 'number', path: 'optionsYears', question: 'Are there options to renew?', optional: true },
  { key: 'tenancy.annualEscalationPercent', label: 'Annual increase (%)', type: 'percent', path: 'annualEscalationPercent', question: 'How does the rent increase each year?', optional: true },
  { key: 'tenancy.tenantQuality', label: 'Tenant quality', type: 'select', path: 'tenantQuality', options: TENANT_QUALITY_OPTIONS, question: 'What sort of covenant is the tenant?', optional: true },
  { key: 'tenancy.verification', label: 'Lease verification', type: 'select', path: 'verification', options: VERIFICATION_OPTIONS, question: 'Do we hold the lease?', optional: true },
];

const leaseSettingsFields: readonly PackField[] = [
  { key: 'lease.leaseBasis', label: 'Lease basis', type: 'select', path: 'lease.leaseBasis', options: ['Net — tenant pays outgoings', 'Gross — landlord pays outgoings', 'Semi-gross'], question: 'Are the leases net or gross?' },
  { key: 'lease.recoverableOutgoings', label: 'Recoverable outgoings', type: 'money', path: 'lease.recoverableOutgoings', question: 'What outgoings are recovered from tenants?', optional: true },
  { key: 'lease.nonRecoverableOutgoings', label: 'Non-recoverable outgoings', type: 'money', path: 'lease.nonRecoverableOutgoings', question: 'What outgoings does the landlord absorb?', optional: true },
  { key: 'lease.vacancyAllowancePercent', label: 'Vacancy allowance (%)', type: 'percent', path: 'lease.vacancyAllowancePercent', question: 'What vacancy allowance should we apply?', optional: true },
  { key: 'lease.managementAllowancePercent', label: 'Management allowance (%)', type: 'percent', path: 'lease.managementAllowancePercent', question: 'What management allowance?', optional: true },
  { key: 'lease.marketRentAnnual', label: 'Market rent (annual)', type: 'money', path: 'lease.marketRentAnnual', question: 'What would market rent be?', optional: true },
  { key: 'lease.rentFreeMonths', label: 'Rent-free months', type: 'number', path: 'lease.rentFreeMonths', question: 'Any rent-free period?', optional: true },
];

const purposeFields: readonly PackField[] = [
  {
    key: 'ownership.borrowingPurpose', label: 'Purpose of the borrowing', type: 'longtext',
    path: 'ownership.borrowingPurpose',
    question: 'In their own words, what are the funds for?',
    help: 'The predominant purpose of the credit governs how it is regulated — the asset class does not.',
  },
  {
    key: 'ownership.purposeIsPredominantlyBusiness', label: 'Predominantly for business?', type: 'select',
    path: 'ownership.purposeIsPredominantlyBusiness', options: YES_NO_OPTIONS,
    question: 'Is the borrowing predominantly for business or investment purposes?',
    help: 'Answering No or leaving it unknown routes the assessment to specialist review.',
  },
  {
    key: 'ownership.residentialSecurityInvolved', label: 'Residential security involved?', type: 'select',
    path: 'ownership.residentialSecurityInvolved', options: YES_NO_OPTIONS,
    question: 'Is any residential property being offered as security?',
  },
];

export const PACK_SECTIONS: readonly PackSection[] = [
  {
    id: 'transaction', sheetName: '1. Transaction', title: 'Property and transaction', step: 2,
    shape: 'single',
    intro: 'The property being bought or refinanced, what it costs to complete, and the facility being sought.',
    fields: transactionFields,
  },
  {
    id: 'purpose', sheetName: '2. Purpose', title: 'Purpose and regulation', step: 3,
    shape: 'single',
    intro: 'Why they are borrowing. This drives the compliance classification, so answer it in the client’s own words.',
    fields: purposeFields,
  },
  {
    id: 'ownership', sheetName: '3. Ownership', title: 'Borrowing entities', step: 3,
    shape: 'table', collectionPath: 'ownership.entities',
    intro: 'One row per borrowing party. Individuals, trusts and SMSFs all buy commercial and industrial property — capture the structure exactly, including trustees and members, because it determines how the group position is assessed.',
    fields: ownershipFields,
  },
  {
    id: 'incomePeriods', sheetName: '4. Income', title: 'Financial periods', step: 4,
    shape: 'table', collectionPath: 'income.periods',
    intro: 'One row per financial year. Two or three years lets the engine weight the trend rather than trusting a single period.',
    fields: incomePeriodFields,
  },
  {
    id: 'addbacks', sheetName: '4b. Add-backs', title: 'Add-backs', step: 4,
    shape: 'table', collectionPath: 'income.addbacks',
    intro: 'Expenses added back to earnings. Each one needs an amount, a reason and a source document before it counts towards income.',
    fields: addbackFields,
  },
  {
    id: 'portfolio', sheetName: '5. Portfolio', title: 'Existing properties', step: 5,
    shape: 'table', collectionPath: 'portfolio.assets',
    intro: 'Everything they already own, across every entity. Without this the result is a standalone deal rather than a global borrowing position.',
    fields: portfolioFields,
  },
  {
    id: 'liabilities', sheetName: '5b. Liabilities', title: 'Other liabilities', step: 5,
    shape: 'table', collectionPath: 'portfolio.liabilities',
    intro: 'Debts not already listed against a property above — cards, overdrafts, equipment finance, tax debts and guarantees.',
    fields: liabilityFields,
  },
  {
    id: 'tenancies', sheetName: '6. Tenancies', title: 'Tenancies in this property', step: 6,
    shape: 'table', collectionPath: 'lease.tenancies',
    intro: 'The leases in the property being acquired. This income is what the coverage tests are struck against.',
    fields: tenancyFields,
  },
  {
    id: 'leaseSettings', sheetName: '6b. Lease terms', title: 'Lease terms and allowances', step: 6,
    shape: 'single',
    intro: 'How the leases are written and what allowances to apply.',
    fields: leaseSettingsFields,
  },
];

/** Every field across every section, for parser lookup by key. */
export const ALL_PACK_FIELDS: ReadonlyMap<string, { field: PackField; section: PackSection }> = (() => {
  const map = new Map<string, { field: PackField; section: PackSection }>();
  PACK_SECTIONS.forEach((section) => {
    section.fields.forEach((field) => map.set(field.key, { field, section }));
  });
  return map;
})();

/** Sections that produce repeatable rows. */
export const TABLE_SECTIONS = PACK_SECTIONS.filter((section) => section.shape === 'table');

/** Sections that produce key/value rows. */
export const SINGLE_SECTIONS = PACK_SECTIONS.filter((section) => section.shape === 'single');

/** Number of rows pre-drawn for a repeatable table so there is room to write. */
export const BLANK_TABLE_ROWS = 8;

export type PackPayloadPatch = Partial<AssessmentPayload>;

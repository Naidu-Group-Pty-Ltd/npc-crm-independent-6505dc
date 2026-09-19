/**
 * Domain model for a Commercial & Industrial Finance Assessment.
 *
 * An assessment is a self-contained working document. It carries the proposed
 * transaction, the borrower structure, their *existing* portfolio and
 * liabilities, and the policy assumptions used to test it — deliberately with
 * no client foreign key, because client association is the last step of the
 * workflow, not the first.
 *
 * Every monetary field below is stored in *dollars* (what the user typed and
 * what the database holds). The engine converts to cents at its boundary; see
 * `money.ts` for why.
 */

import type { LenderPolicyProfileKey } from '@/utils/commercial/borrowing/calculatorTypes';

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export const ASSESSMENT_STATUSES = [
  'draft',
  'data_entry',
  'ready_to_calculate',
  'calculated',
  'requires_review',
  'completed',
  'linked',
  'archived',
] as const;
export type AssessmentStatus = (typeof ASSESSMENT_STATUSES)[number];

/** Statuses a user may still edit the working data of. */
export const EDITABLE_STATUSES: readonly AssessmentStatus[] = [
  'draft',
  'data_entry',
  'ready_to_calculate',
  'calculated',
  'requires_review',
];

export const ASSESSMENT_STATUS_LABELS: Record<AssessmentStatus, string> = {
  draft: 'Draft',
  data_entry: 'In progress',
  ready_to_calculate: 'Ready to calculate',
  calculated: 'Calculated',
  requires_review: 'Requires review',
  completed: 'Completed',
  linked: 'Linked to client',
  archived: 'Archived',
};

// ---------------------------------------------------------------------------
// Step 1 — Assessment type
// ---------------------------------------------------------------------------

export const ASSESSMENT_TYPES = [
  'commercial_investment',
  'industrial_investment',
  'owner_occupied_commercial',
  'owner_occupied_industrial',
  'mixed_use',
  'development_construction',
  'refinance',
  'equity_release',
  'purchase_plus_fitout',
  'lease_doc',
] as const;
export type AssessmentType = (typeof ASSESSMENT_TYPES)[number];

export interface AssessmentTypeDefinition {
  key: AssessmentType;
  label: string;
  segment: 'commercial' | 'industrial' | 'either';
  description: string;
  /** Transactions of this shape have no purchase — they refinance existing debt. */
  isRefinance: boolean;
  /** Owner-occupier deals lean on business cash flow rather than passing rent. */
  isOwnerOccupied: boolean;
  /** Types the platform supports only behind a specialist-review flag. */
  requiresSpecialistReview: boolean;
}

export const ASSESSMENT_TYPE_DEFINITIONS: readonly AssessmentTypeDefinition[] = [
  {
    key: 'commercial_investment',
    label: 'Commercial investment',
    segment: 'commercial',
    description: 'Office, retail, medical or mixed tenancy acquired for rental return.',
    isRefinance: false,
    isOwnerOccupied: false,
    requiresSpecialistReview: false,
  },
  {
    key: 'industrial_investment',
    label: 'Industrial investment',
    segment: 'industrial',
    description: 'Warehouse, logistics or manufacturing asset acquired for rental return.',
    isRefinance: false,
    isOwnerOccupied: false,
    requiresSpecialistReview: false,
  },
  {
    key: 'owner_occupied_commercial',
    label: 'Owner-occupied commercial',
    segment: 'commercial',
    description: 'Borrower’s own business trades from the premises. Serviced by business cash flow.',
    isRefinance: false,
    isOwnerOccupied: true,
    requiresSpecialistReview: false,
  },
  {
    key: 'owner_occupied_industrial',
    label: 'Owner-occupied industrial',
    segment: 'industrial',
    description: 'Borrower’s own operation occupies the warehouse or yard.',
    isRefinance: false,
    isOwnerOccupied: true,
    requiresSpecialistReview: false,
  },
  {
    key: 'mixed_use',
    label: 'Mixed use',
    segment: 'either',
    description: 'Combined commercial and residential components in one security.',
    isRefinance: false,
    isOwnerOccupied: false,
    requiresSpecialistReview: false,
  },
  {
    key: 'development_construction',
    label: 'Development or construction',
    segment: 'either',
    description: 'Staged drawdown against construction cost. Always routed to specialist review.',
    isRefinance: false,
    isOwnerOccupied: false,
    requiresSpecialistReview: true,
  },
  {
    key: 'refinance',
    label: 'Refinance',
    segment: 'either',
    description: 'Replace an existing facility on an asset the borrower already owns.',
    isRefinance: true,
    isOwnerOccupied: false,
    requiresSpecialistReview: false,
  },
  {
    key: 'equity_release',
    label: 'Equity release',
    segment: 'either',
    description: 'Draw equity from an existing asset. Purpose of the release drives classification.',
    isRefinance: true,
    isOwnerOccupied: false,
    requiresSpecialistReview: false,
  },
  {
    key: 'purchase_plus_fitout',
    label: 'Purchase plus fit-out',
    segment: 'either',
    description: 'Acquisition funded together with fit-out, plant and immediate capital works.',
    isRefinance: false,
    isOwnerOccupied: false,
    requiresSpecialistReview: false,
  },
  {
    key: 'lease_doc',
    label: 'Lease-doc / low-doc',
    segment: 'either',
    description: 'Assessed on lease income alone, subject to configured policy. Specialist review.',
    isRefinance: false,
    isOwnerOccupied: false,
    requiresSpecialistReview: true,
  },
];

export function assessmentTypeDefinition(type: AssessmentType): AssessmentTypeDefinition {
  return (
    ASSESSMENT_TYPE_DEFINITIONS.find((definition) => definition.key === type)
    ?? ASSESSMENT_TYPE_DEFINITIONS[0]
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Property & transaction
// ---------------------------------------------------------------------------

export type AustralianState = 'NSW' | 'VIC' | 'QLD' | 'WA' | 'SA' | 'TAS' | 'ACT' | 'NT';

export type PropertyClassification =
  | 'commercial' | 'industrial' | 'mixed_use' | 'land' | 'specialised';

export type AssetClass =
  | 'office' | 'retail' | 'warehouse' | 'logistics' | 'manufacturing'
  | 'cold_storage' | 'medical' | 'childcare' | 'hospitality'
  | 'showroom' | 'transport_yard' | 'data_centre' | 'mixed_use' | 'other';

export type GstTreatmentKey =
  | 'going_concern' | 'margin_scheme' | 'plus_gst' | 'gst_inclusive' | 'input_taxed' | 'unknown';

export type SecurityPosition = 'first_mortgage' | 'second_mortgage' | 'subsequent' | 'unsecured';

/** How a piece of data got into the assessment. Drives the provenance badges. */
export type FieldSource = 'manual' | 'url_import' | 'document_import' | 'client_profile' | 'ai_estimate' | 'calculated';

export interface FieldProvenance {
  field: string;
  source: FieldSource;
  /** 0-1 where the importer reported one. Absent means "not scored". */
  confidence?: number;
  sourceRef?: string;
  /** True until a human has explicitly accepted the imported value. */
  requiresConfirmation: boolean;
  confirmedAt?: string;
  confirmedBy?: string;
  capturedAt: string;
}

export interface PropertyTransactionSection {
  address: string;
  suburb: string;
  state: AustralianState | '';
  postcode: string;
  classification: PropertyClassification;
  assetClass: AssetClass;
  assetSubType: string;

  purchasePrice: number;
  currentValuation: number;
  valuationDate: string;
  valuationSource: string;
  valuationConfidence: 'low' | 'medium' | 'high';
  contractDate: string;
  settlementDate: string;

  gstTreatment: GstTreatmentKey;
  goingConcern: boolean;
  vacantPossession: boolean;

  stampDuty: number;
  legalCosts: number;
  valuationCosts: number;
  lenderFees: number;
  fitOut: number;
  plantAndEquipment: number;
  repairs: number;
  immediateCapex: number;
  contingency: number;
  otherAcquisitionCosts: number;

  requestedLoanAmount: number;
  depositOrContribution: number;
  refinanceAmount: number;
  proposedEquityRelease: number;

  securityPosition: SecurityPosition;
  additionalSecurity: string;
  guarantors: string;

  /** Site metrics used by yield-per-sqm and site-cover analysis. */
  lettableAreaSqm: number;
  siteAreaSqm: number;
}

// ---------------------------------------------------------------------------
// Step 3 — Ownership & borrower structure
// ---------------------------------------------------------------------------

export type BorrowerStructure =
  | 'individual' | 'joint_individuals' | 'company' | 'trust'
  | 'corporate_trustee' | 'partnership' | 'smsf' | 'spv';

export interface BorrowerEntity {
  id: string;
  entityName: string;
  structure: BorrowerStructure;
  abnAcn: string;
  ownershipPercent: number;
  directors: string;
  trustees: string;
  beneficiaries: string;
  isGuarantor: boolean;
  relatedEntities: string;
  yearsTrading: number;
  industry: string;
  borrowerExperience: 'first_time' | 'some' | 'experienced' | 'institutional';
  residency: 'australian' | 'permanent_resident' | 'foreign';
  taxResidency: 'australian' | 'foreign' | 'unknown';
  /** Beneficial ownership / control note. Feeds the AML surface, never replaces it. */
  beneficialOwnership: string;
}

export interface OwnershipSection {
  entities: BorrowerEntity[];
  borrowingPurpose: string;
  /** Free-text purpose is classified, not trusted — see complianceEngine. */
  purposeIsPredominantlyBusiness: boolean | null;
  naturalPersonBorrower: boolean;
  residentialSecurityInvolved: boolean;
}

// ---------------------------------------------------------------------------
// Step 4 — Income & business performance
// ---------------------------------------------------------------------------

export type IncomePeriodBasis =
  | 'tax_return' | 'financial_statements' | 'management_accounts'
  | 'ytd' | 'notice_of_assessment' | 'projection';

export type VerificationStatus = 'unverified' | 'documents_held' | 'verified';

export interface IncomePeriod {
  id: string;
  label: string;
  periodEnd: string;
  basis: IncomePeriodBasis;
  verification: VerificationStatus;

  salaryWages: number;
  businessRevenue: number;
  ebitda: number;
  ebit: number;
  npat: number;
  depreciation: number;
  interestExpense: number;
  directorRemuneration: number;
  distributions: number;
  rentReceived: number;
  dividends: number;
  otherRecurringIncome: number;
  nonRecurringIncome: number;
}

export type AddbackCategory =
  | 'depreciation' | 'interest' | 'director_remuneration' | 'one_off'
  | 'non_cash' | 'rent_to_related_party' | 'superannuation' | 'other';

export interface Addback {
  id: string;
  periodId: string;
  category: AddbackCategory;
  amount: number;
  reason: string;
  source: string;
  /** An add-back only counts once a human has confirmed it. Enforced by the engine. */
  confirmed: boolean;
  confirmedBy?: string;
  confirmedAt?: string;
}

export interface IncomeSection {
  periods: IncomePeriod[];
  addbacks: Addback[];
  /** 'weighted' blends the periods; 'latest' and 'lowest' are policy selections. */
  assessableIncomeBasis: 'weighted' | 'latest' | 'lowest' | 'average';
  otherIncomeNotes: string;
}

// ---------------------------------------------------------------------------
// Step 5 — Existing portfolio & commitments
// ---------------------------------------------------------------------------

export type PortfolioAssetType =
  | 'residential' | 'commercial' | 'industrial' | 'mixed_use' | 'land' | 'development';

export type RepaymentType = 'interestOnly' | 'principalAndInterest' | 'residualTerm';

export interface PortfolioAsset {
  id: string;
  address: string;
  ownershipEntity: string;
  ownershipPercent: number;
  assetType: PortfolioAssetType;

  currentValue: number;
  valuationDate: string;

  existingLender: string;
  currentBalance: number;
  facilityLimit: number;
  interestRate: number;
  repaymentType: RepaymentType;
  remainingTermYears: number;
  /** Blank means "derive it from balance, rate and term". */
  annualRepayments: number | null;

  annualRent: number;
  leaseExpiry: string;
  vacancyPercent: number;
  outgoings: number;
  managementCosts: number;
  rates: number;
  insurance: number;
  maintenance: number;
  capitalExpenditure: number;

  crossCollateralised: boolean;
  /** Set when this row was matched to a client-profile record during linking. */
  clientPropertyId?: string | null;
}

export type LiabilityType =
  | 'home_loan' | 'investment_loan' | 'commercial_facility' | 'equipment_finance'
  | 'vehicle_finance' | 'credit_card' | 'overdraft' | 'line_of_credit'
  | 'tax_debt' | 'lease' | 'guarantee' | 'contingent' | 'private_debt'
  | 'hecs_help' | 'other';

export interface Liability {
  id: string;
  description: string;
  liabilityType: LiabilityType;
  ownershipEntity: string;
  lender: string;
  balance: number;
  limit: number;
  interestRate: number;
  repaymentType: RepaymentType;
  remainingTermYears: number;
  annualRepayments: number | null;
  /** Guarantees and contingent liabilities are disclosed but not serviced. */
  isContingent: boolean;
  /** Marks a facility already counted inside a portfolio asset row. */
  securedAgainstAssetId?: string | null;
  clientLiabilityId?: string | null;
}

export interface PortfolioSection {
  assets: PortfolioAsset[];
  liabilities: Liability[];
  /** Loans shared across related entities are counted once, at this share. */
  relatedEntityDebtSharePercent: number;
}

// ---------------------------------------------------------------------------
// Step 6 — Lease & property income for the proposed asset
// ---------------------------------------------------------------------------

export interface LeaseTenancy {
  id: string;
  tenantName: string;
  areaSqm: number;
  annualRent: number;
  leaseCommencement: string;
  leaseExpiry: string;
  optionsYears: number;
  annualEscalationPercent: number;
  tenantQuality: 'government' | 'national' | 'listed' | 'established_sme' | 'new_business' | 'related_party' | 'unknown';
  verification: VerificationStatus;
}

export interface LeaseIncomeSection {
  tenancies: LeaseTenancy[];
  rentFrequency: 'annual' | 'monthly' | 'quarterly' | 'weekly';
  leaseBasis: 'net' | 'gross' | 'semi_gross';
  recoverableOutgoings: number;
  nonRecoverableOutgoings: number;
  vacancyAllowancePercent: number;
  managementAllowancePercent: number;
  incentiveAllowance: number;
  rentFreeMonths: number;
  marketRentAnnual: number;
  tenantQualityNotes: string;
}

// ---------------------------------------------------------------------------
// Step 7 — Loan structure & policy assumptions
// ---------------------------------------------------------------------------

export interface LoanStructureSection {
  requestedLoan: number;
  actualRatePercent: number;
  /** Blank/0 means "derive from the policy buffer and floor". */
  assessmentRateOverridePercent: number;
  interestRateBufferPercent: number;
  repaymentType: RepaymentType;
  interestOnlyPeriodYears: number;
  loanTermYears: number;
  amortisationYears: number;
  residualBalloonAmount: number;
  repaymentFrequency: 'monthly' | 'quarterly' | 'annual';

  establishmentFees: number;
  annualFees: number;
  lineFeePercent: number;
  unusedLimitFeePercent: number;
  riskFees: number;
  capitalisedCosts: number;

  lenderPolicyProfile: LenderPolicyProfileKey;
  crossCollateralised: boolean;

  /** Scenario-level overrides of the policy profile. Recorded in the snapshot. */
  policyOverrides: PolicyOverrides;
}

export interface PolicyOverrides {
  maxLvr?: number;
  hardMaxLvr?: number;
  minIcr?: number;
  minDscr?: number;
  minDebtYield?: number;
  debtYieldEnabled?: boolean;
  assessmentFloorRatePercent?: number;
  rentalShadingPercent?: number;
  creditCardAssessmentPercent?: number;
  livingExpenseFloorAnnual?: number;
}

// ---------------------------------------------------------------------------
// Whole assessment payload
// ---------------------------------------------------------------------------

export interface AssessmentPayload {
  assessmentType: AssessmentType;
  property: PropertyTransactionSection;
  ownership: OwnershipSection;
  income: IncomeSection;
  portfolio: PortfolioSection;
  lease: LeaseIncomeSection;
  loan: LoanStructureSection;
  provenance: FieldProvenance[];
  /** Free-form internal notes. Excluded from client-facing report output. */
  internalNotes: string;
  /**
   * Investment-analysis assumptions — valuation, forecast and industrial site
   * metrics. Optional because every assessment written before the analysis
   * workspace existed predates it; `analysisOf()` reads it with defaults, and
   * it only appears on disk once somebody sets one. See `analysis.ts`.
   */
  analysis?: import('./analysis').AnalysisSection;
}

export interface AssessmentRecord {
  id: string;
  userId: string;
  reference: string;
  title: string;
  status: AssessmentStatus;
  segment: 'commercial' | 'industrial';
  payload: AssessmentPayload;
  /** Populated only once the final linking step has run. */
  clientId: string | null;
  linkedAt: string | null;
  linkedBy: string | null;
  currentCalculationId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
  archivedAt: string | null;
}

/** A persisted calculation run — immutable once written. */
export interface CalculationRunRecord {
  id: string;
  assessmentId: string;
  engineVersion: string;
  policyVersion: string;
  scenarioKey: string;
  inputsSnapshot: AssessmentPayload;
  policySnapshot: unknown;
  outputs: unknown;
  createdAt: string;
  createdBy: string | null;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export function emptyPropertySection(): PropertyTransactionSection {
  return {
    address: '', suburb: '', state: '', postcode: '',
    classification: 'commercial', assetClass: 'office', assetSubType: '',
    purchasePrice: 0, currentValuation: 0, valuationDate: '', valuationSource: '',
    valuationConfidence: 'medium', contractDate: '', settlementDate: '',
    gstTreatment: 'unknown', goingConcern: false, vacantPossession: false,
    stampDuty: 0, legalCosts: 0, valuationCosts: 0, lenderFees: 0,
    fitOut: 0, plantAndEquipment: 0, repairs: 0, immediateCapex: 0,
    contingency: 0, otherAcquisitionCosts: 0,
    requestedLoanAmount: 0, depositOrContribution: 0, refinanceAmount: 0,
    proposedEquityRelease: 0,
    securityPosition: 'first_mortgage', additionalSecurity: '', guarantors: '',
    lettableAreaSqm: 0, siteAreaSqm: 0,
  };
}

export function emptyOwnershipSection(): OwnershipSection {
  return {
    entities: [],
    borrowingPurpose: '',
    purposeIsPredominantlyBusiness: null,
    naturalPersonBorrower: false,
    residentialSecurityInvolved: false,
  };
}

export function emptyIncomeSection(): IncomeSection {
  return { periods: [], addbacks: [], assessableIncomeBasis: 'weighted', otherIncomeNotes: '' };
}

export function emptyPortfolioSection(): PortfolioSection {
  return { assets: [], liabilities: [], relatedEntityDebtSharePercent: 100 };
}

export function emptyLeaseSection(): LeaseIncomeSection {
  return {
    tenancies: [], rentFrequency: 'annual', leaseBasis: 'net',
    recoverableOutgoings: 0, nonRecoverableOutgoings: 0,
    vacancyAllowancePercent: 0, managementAllowancePercent: 0,
    incentiveAllowance: 0, rentFreeMonths: 0, marketRentAnnual: 0,
    tenantQualityNotes: '',
  };
}

export function emptyLoanSection(): LoanStructureSection {
  return {
    requestedLoan: 0, actualRatePercent: 0, assessmentRateOverridePercent: 0,
    interestRateBufferPercent: 0, repaymentType: 'principalAndInterest',
    interestOnlyPeriodYears: 0, loanTermYears: 15, amortisationYears: 20,
    residualBalloonAmount: 0, repaymentFrequency: 'monthly',
    establishmentFees: 0, annualFees: 0, lineFeePercent: 0,
    unusedLimitFeePercent: 0, riskFees: 0, capitalisedCosts: 0,
    lenderPolicyProfile: 'mainstreamCommercialBank', crossCollateralised: false,
    policyOverrides: {},
  };
}

export function emptyAssessmentPayload(type: AssessmentType = 'commercial_investment'): AssessmentPayload {
  const definition = assessmentTypeDefinition(type);
  const property = emptyPropertySection();
  if (definition.segment === 'industrial') {
    property.classification = 'industrial';
    property.assetClass = 'warehouse';
  }
  return {
    assessmentType: type,
    property,
    ownership: emptyOwnershipSection(),
    income: emptyIncomeSection(),
    portfolio: emptyPortfolioSection(),
    lease: emptyLeaseSection(),
    loan: emptyLoanSection(),
    provenance: [],
    internalNotes: '',
  };
}

/**
 * Merge a partial payload (from the database, an import or an older schema
 * version) over the current defaults. Older records simply pick up defaults for
 * fields that did not exist when they were written, which is what keeps
 * historical assessments readable after the shape grows.
 */
export function hydrateAssessmentPayload(raw: unknown): AssessmentPayload {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Partial<AssessmentPayload>;
  const base = emptyAssessmentPayload(source.assessmentType ?? 'commercial_investment');
  return {
    assessmentType: source.assessmentType ?? base.assessmentType,
    property: { ...base.property, ...(source.property ?? {}) },
    ownership: {
      ...base.ownership,
      ...(source.ownership ?? {}),
      entities: source.ownership?.entities ?? [],
    },
    income: {
      ...base.income,
      ...(source.income ?? {}),
      periods: source.income?.periods ?? [],
      addbacks: source.income?.addbacks ?? [],
    },
    portfolio: {
      ...base.portfolio,
      ...(source.portfolio ?? {}),
      assets: source.portfolio?.assets ?? [],
      liabilities: source.portfolio?.liabilities ?? [],
    },
    lease: {
      ...base.lease,
      ...(source.lease ?? {}),
      tenancies: source.lease?.tenancies ?? [],
    },
    loan: {
      ...base.loan,
      ...(source.loan ?? {}),
      policyOverrides: source.loan?.policyOverrides ?? {},
    },
    provenance: source.provenance ?? [],
    internalNotes: source.internalNotes ?? '',
    // Left undefined rather than defaulted, so a record that has never carried
    // analysis assumptions is not rewritten with a set of them on its next
    // autosave. `analysisOf()` supplies the defaults at the point of reading.
    ...(source.analysis ? { analysis: source.analysis } : {}),
  };
}

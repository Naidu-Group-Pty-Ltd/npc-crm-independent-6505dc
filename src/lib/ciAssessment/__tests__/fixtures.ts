/**
 * Shared fixtures for the assessment engine tests.
 *
 * A single realistic deal that every suite mutates rather than each test
 * building its own — it keeps the expected numbers in one place and makes a
 * regression obvious when it moves.
 */

import {
  emptyAssessmentPayload,
  type Addback,
  type AssessmentPayload,
  type AssessmentType,
  type IncomePeriod,
  type LeaseTenancy,
  type Liability,
  type PortfolioAsset,
} from '../types';

export function tenancy(overrides: Partial<LeaseTenancy> = {}): LeaseTenancy {
  return {
    id: 'tenancy-1',
    tenantName: 'National Logistics Pty Ltd',
    areaSqm: 2_500,
    annualRent: 350_000,
    leaseCommencement: '2024-01-01',
    leaseExpiry: '2031-01-01',
    optionsYears: 5,
    annualEscalationPercent: 3,
    tenantQuality: 'national',
    verification: 'verified',
    ...overrides,
  };
}

export function portfolioAsset(overrides: Partial<PortfolioAsset> = {}): PortfolioAsset {
  return {
    id: 'asset-1',
    address: '12 Example Road, Smithfield NSW 2164',
    ownershipEntity: 'Example Holdings Pty Ltd',
    ownershipPercent: 100,
    assetType: 'industrial',
    currentValue: 3_000_000,
    valuationDate: '2026-02-01',
    existingLender: 'Existing Bank',
    currentBalance: 1_500_000,
    facilityLimit: 1_500_000,
    interestRate: 6.5,
    repaymentType: 'principalAndInterest',
    remainingTermYears: 20,
    annualRepayments: null,
    annualRent: 210_000,
    leaseExpiry: '2029-06-30',
    vacancyPercent: 0,
    outgoings: 20_000,
    managementCosts: 6_000,
    rates: 12_000,
    insurance: 5_000,
    maintenance: 8_000,
    capitalExpenditure: 0,
    crossCollateralised: false,
    ...overrides,
  };
}

export function liability(overrides: Partial<Liability> = {}): Liability {
  return {
    id: 'liability-1',
    description: 'Equipment finance',
    liabilityType: 'equipment_finance',
    ownershipEntity: 'Example Holdings Pty Ltd',
    lender: 'Asset Finance Co',
    balance: 180_000,
    limit: 180_000,
    interestRate: 8,
    repaymentType: 'principalAndInterest',
    remainingTermYears: 4,
    annualRepayments: null,
    isContingent: false,
    securedAgainstAssetId: null,
    clientLiabilityId: null,
    ...overrides,
  };
}

export function incomePeriod(overrides: Partial<IncomePeriod> = {}): IncomePeriod {
  return {
    id: 'period-2025',
    label: 'FY2025',
    periodEnd: '2025-06-30',
    basis: 'financial_statements',
    verification: 'verified',
    salaryWages: 0,
    businessRevenue: 4_200_000,
    ebitda: 620_000,
    ebit: 540_000,
    npat: 380_000,
    depreciation: 80_000,
    interestExpense: 95_000,
    directorRemuneration: 180_000,
    distributions: 0,
    rentReceived: 0,
    dividends: 0,
    otherRecurringIncome: 0,
    nonRecurringIncome: 0,
    ...overrides,
  };
}

export function addback(overrides: Partial<Addback> = {}): Addback {
  return {
    id: 'addback-1',
    periodId: 'period-2025',
    category: 'one_off',
    amount: 45_000,
    reason: 'One-off legal costs on a settled dispute, not expected to recur.',
    source: 'FY2025 financial statements, note 7',
    confirmed: true,
    confirmedBy: 'test-user',
    confirmedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * A leased industrial investment: $5m purchase, $3.25m facility at 6.75%,
 * $350k passing rent, one existing portfolio asset and one equipment facility.
 */
export function baseAssessment(type: AssessmentType = 'industrial_investment'): AssessmentPayload {
  const payload = emptyAssessmentPayload(type);

  payload.property = {
    ...payload.property,
    address: '45 Industrial Drive',
    suburb: 'Wetherill Park',
    state: 'NSW',
    postcode: '2164',
    classification: 'industrial',
    assetClass: 'warehouse',
    purchasePrice: 5_000_000,
    currentValuation: 5_000_000,
    valuationDate: '2026-07-01',
    valuationSource: 'Independent valuation',
    valuationConfidence: 'high',
    contractDate: '2026-07-15',
    settlementDate: '2026-09-15',
    gstTreatment: 'going_concern',
    goingConcern: true,
    stampDuty: 275_000,
    legalCosts: 8_000,
    valuationCosts: 4_500,
    lenderFees: 12_000,
    depositOrContribution: 2_050_000,
    requestedLoanAmount: 3_250_000,
    lettableAreaSqm: 2_500,
    siteAreaSqm: 5_000,
  };

  payload.ownership = {
    entities: [{
      id: 'entity-1',
      entityName: 'Example Holdings Pty Ltd',
      structure: 'company',
      abnAcn: '12 345 678 901',
      ownershipPercent: 100,
      directors: 'A Director',
      trustees: '',
      beneficiaries: '',
      isGuarantor: true,
      relatedEntities: '',
      yearsTrading: 12,
      industry: 'Logistics',
      borrowerExperience: 'experienced',
      residency: 'australian',
      taxResidency: 'australian',
      beneficialOwnership: 'A Director 100%',
    }],
    borrowingPurpose: 'Acquisition of a commercial investment property for business investment purposes.',
    purposeIsPredominantlyBusiness: true,
    naturalPersonBorrower: false,
    residentialSecurityInvolved: false,
  };

  payload.income = {
    periods: [incomePeriod()],
    addbacks: [addback()],
    assessableIncomeBasis: 'weighted',
    otherIncomeNotes: '',
  };

  payload.portfolio = {
    assets: [portfolioAsset()],
    liabilities: [liability()],
    relatedEntityDebtSharePercent: 100,
  };

  payload.lease = {
    ...payload.lease,
    tenancies: [tenancy()],
    leaseBasis: 'net',
    recoverableOutgoings: 45_000,
    nonRecoverableOutgoings: 12_000,
    vacancyAllowancePercent: 3,
    managementAllowancePercent: 2,
    marketRentAnnual: 345_000,
  };

  payload.loan = {
    ...payload.loan,
    requestedLoan: 3_250_000,
    actualRatePercent: 6.75,
    repaymentType: 'principalAndInterest',
    loanTermYears: 15,
    amortisationYears: 20,
    establishmentFees: 16_250,
    annualFees: 1_500,
    lenderPolicyProfile: 'mainstreamCommercialBank',
  };

  return payload;
}

/** A fixed clock so lease-expiry maths is reproducible. */
export const AS_AT = new Date('2026-08-03T00:00:00.000Z');

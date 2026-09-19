import type { AssumptionConfidenceTag } from './assumptionRegistry';
import type { CommercialIndustrialDealProfile } from './commercialDealState';

export type TenYearCashFlowMode = 'investor' | 'ownerOccupier' | 'relatedPartyLease';
export type TenYearRiskStatus = 'green' | 'amber' | 'red' | 'specialistReview';

export interface TaggedAssumption<T = number | string | boolean | null> {
  key: string;
  label: string;
  value: T;
  status: AssumptionConfidenceTag | 'Overridden';
  source: 'global' | 'manual' | 'ai' | 'savedProperty' | 'calculated';
  notes?: string;
}


export type TenYearAnnualOverrideField = 'passingRent' | 'rentGrowthPct' | 'vacancyAllowancePct' | 'recoveredOutgoings' | 'outgoingsGrowthPct' | 'otherOwnerExpenses' | 'annualCapexReserve' | 'majorCapexAmount' | 'downtimeMonths' | 'incentiveMonths' | 'interestRatePct' | 'taxRatePct' | 'capitalGrowthPct' | 'terminalCapRatePct';

export interface TenYearAnnualOverrideCell {
  value: number;
  originalValue: number;
  user?: string;
  timestamp: string;
}

export type TenYearAnnualOverrides = Partial<Record<TenYearAnnualOverrideField, Partial<Record<number, TenYearAnnualOverrideCell>>>>;

export interface TenYearCashFlowInputs {
  mode: TenYearCashFlowMode;
  assetDomain: 'commercial' | 'industrial';
  assetSubtype?: string;
  state?: string;
  purchasePrice: number;
  propertyValue: number;
  loanAmount: number;
  availableEquity: number;
  taxRatePct: number;
  depreciationPa: number;
  capitalWorksDeductionPa: number;
  plantEquipmentDepreciationPa: number;
  lossOffsetAllowed: boolean;
  accountantReviewRequired: boolean;
  passingRent: number;
  marketRent: number;
  otherIncome: number;
  recoveredOutgoings: number;
  vacancyAllowancePct: number;
  rentGrowthPct: number;
  marketRentGrowthPct: number;
  outgoingsGrowthPct: number;
  expenseGrowthPct: number;
  capitalGrowthPct: number;
  selectedCapRatePct: number;
  terminalCapRatePct: number;
  sellingCostPct: number;
  downtimeMonths: number;
  incentiveMonths: number;
  leasingFeePct: number;
  relettingCostAllowance: number;
  leaseRiskHaircutPct: number;
  tenantRiskHaircutPct: number;
  annualCapexReserve: number;
  majorCapexYear?: number;
  majorCapexAmount?: number;
  environmentalReserve: number;
  asbestosReserve: number;
  specialistReserve: number;
  councilRates: number;
  waterRates: number;
  landTax: number;
  insurance: number;
  strataOwnersCorp: number;
  managementFees: number;
  repairsMaintenance: number;
  utilities: number;
  cleaning: number;
  security: number;
  otherOwnerExpenses: number;
  gstSettlementCashflow: number;
  gstEconomicCost: number;
  totalAcquisitionCosts: number;
  totalCostBase: number;
  requiredEquity: number;
  postSettlementLiquidity: number;
  interestRatePct: number;
  annualDebtService: number;
  amortisationYears: number;
  interestOnlyYears: number;
  repaymentType: 'interestOnly' | 'principalAndInterest';
  ownershipStructure?: string;
  businessRevenue: number;
  businessEbitda: number | null;
  businessAddbacks: number;
  directorDrawings: number;
  existingBusinessDebtService: number;
  equipmentFinanceRepayments: number;
  vehicleFinanceRepayments: number;
  workingCapitalRequirement: number;
  businessCashReserves: number;
  currentRentPaid: number;
  currentOutgoingsPaid: number;
  rentEscalationPct: number;
  businessIncomeGrowthPct: number;
  businessExpenseGrowthPct: number;
  relatedPartyRent: number;
  relatedPartyRentGrowthPct: number;
  relatedPartyLeaseVerified: boolean;
  marketRentSupportAvailable: boolean;
  stagedScheduleEnabled: boolean;
  annualOverrides?: TenYearAnnualOverrides;
}

export interface TenYearCashFlowYear {
  year: number;
  capitalGrowthPct: number;
  propertyValue: number;
  capRateValue: number | null;
  terminalValue: number | null;
  netSaleProceeds: number | null;
  openingLoanBalance: number;
  interestRatePct: number;
  interestPayment: number;
  principalPayment: number;
  annualDebtService: number;
  closingLoanBalance: number;
  lvr: number | null;
  icr: number | null;
  dscr: number | null;
  debtYield: number | null;
  passingRent: number;
  marketRent: number;
  otherIncome: number;
  potentialGrossIncome: number;
  vacancyLoss: number;
  recoveredOutgoings: number;
  effectiveGrossIncome: number;
  totalOwnerBorneExpenses: number;
  actualNoi: number;
  stabilisedNoi: number;
  lenderAdjustedNoi: number;
  noiHaircutAmount: number;
  noiHaircutPct: number;
  leaseDowntimeLoss: number;
  tenantIncentiveCost: number;
  leasingFee: number;
  relettingCost: number;
  totalLeasingVacancyCost: number;
  annualCapexReserve: number;
  majorCapex: number;
  specialistReserves: number;
  totalCapex: number;
  preDebtOperatingCashflow: number;
  preTaxCashflow: number;
  taxableIncome: number;
  taxPayableBenefit: number;
  afterTaxCashflow: number;
  afterTaxCashflowWeekly: number;
  cumulativeAfterTaxCashflow: number;
  equityPosition: number;
  equityCreated: number;
  equityMultiple: number | null;
  rentAvoided: number;
  outgoingsAvoided: number;
  leasingCostAvoided: number;
  cumulativeLeasingCostAvoided: number;
  ownershipCashCost: number;
  netSavingCostVsLeasing: number;
  cumulativeNetSavingCost: number;
  availableBusinessCashflow: number | null;
  businessDscr: number | null;
  occupancyCostRatio: number | null;
  freeCashflowAfterOccupancy: number | null;
  propertyEntityCashflow: number;
  operatingBusinessOccupancyCost: number;
  groupCashflow: number;
  groupDscr: number | null;
  cumulativeGroupBenefit: number;
}

export interface TenYearCashFlowSummary {
  mode: TenYearCashFlowMode;
  purchasePrice: number;
  totalCostBase: number;
  requiredEquity: number;
  year1Noi: number;
  year1PreTaxCashflow: number;
  year1AfterTaxCashflow: number;
  year10PropertyValue: number;
  year10LoanBalance: number;
  year10Equity: number;
  cumulativeAfterTaxCashflow: number;
  leveredIrr: number | null;
  unleveredIrr: number | null;
  equityMultiple: number | null;
  terminalValue: number | null;
  ownerOccupierNetSavingCost?: number;
  businessDscr?: number | null;
  occupancyCostRatio?: number | null;
  cumulativeOwnershipBenefit?: number;
  propertyEntityCashflow?: number;
  groupCashflow?: number;
  groupDscr?: number | null;
  cumulativeGroupBenefit?: number;
  riskStatus: TenYearRiskStatus;
}

export interface TenYearCashFlowResult {
  mode: TenYearCashFlowMode;
  inputs: TenYearCashFlowInputs;
  years: TenYearCashFlowYear[];
  summary: TenYearCashFlowSummary;
  assumptions: Record<string, TaggedAssumption>;
  warnings: string[];
  requiredDocuments: Array<{ documentName: string; requiredBecause: string; relatedField: string; status: 'Required' | 'Uploaded' | 'Reviewed' | 'Verified' | 'Missing' | 'Not Applicable' }>;
  commentary: string;
}

export type TenYearGlobalProfile = CommercialIndustrialDealProfile;

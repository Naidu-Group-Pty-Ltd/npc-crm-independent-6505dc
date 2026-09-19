import type { BorrowingResult } from './borrowing/calculatorTypes';

export type ScenarioStatus = 'Draft' | 'Recommended' | 'Committed' | 'Archived';
export type ScenarioType = 'Base Current Position' | 'Acquire Commercial Asset' | 'Acquire Industrial Asset' | 'Owner-Occupied Business Premises' | 'Related-Party Lease Structure' | 'Sell Existing Asset' | 'Refinance Existing Debt' | 'Equity Release' | 'Debt Restructure' | 'Cash Injection' | 'Interest Rate Stress' | 'Vacancy / Rent Stress' | 'Capex Shock' | 'Multi-Asset Strategy';
export type AssumptionStatus = 'Verified' | 'Property Record Source' | 'Client Profile Source' | 'Global Deal Source' | 'Manual Estimate' | 'AI Estimate' | 'Unknown' | 'Overridden' | 'Specialist Review Required';

export interface ClientPortfolioAsset {
  id: string;
  address: string;
  assetType: 'residential' | 'commercial' | 'industrial';
  propertyType?: string;
  subtype?: string;
  assetSubtype?: string;
  industrialSubtype?: string;
  ownershipEntity?: string;
  currentValue: number;
  loanBalance: number;
  lender?: string;
  rate?: number;
  repaymentType?: 'principalAndInterest' | 'interestOnly' | 'lineOfCredit' | 'unknown';
  annualRent?: number;
  expenses?: number;
  equity?: number;
  lvr?: number;
  cashflow?: number;
  noi?: number;
  tenant?: string;
  wale?: number;
  leaseStatus?: string;
  capRate?: number;
  icr?: number;
  dscr?: number;
  debtYield?: number;
  gla?: number;
  siteArea?: number;
  siteCover?: number;
  hardstand?: number;
  environmentalStatus?: AssumptionStatus | string;
  asbestosStatus?: AssumptionStatus | string;
}

export interface ResidentialAsset extends ClientPortfolioAsset { assetType: 'residential'; propertyType: string; }
export interface CommercialAsset extends ClientPortfolioAsset { assetType: 'commercial'; assetSubtype?: string; noi: number; }
export interface IndustrialAsset extends ClientPortfolioAsset { assetType: 'industrial'; industrialSubtype?: string; noi: number; gla?: number; siteArea?: number; siteCover?: number; hardstand?: number; }
export interface SharePortfolio { portfolioValue: number; listedShares: number; etfs: number; managedFunds: number; dividendIncome: number; marginLoan: number; liquidityHaircutPct: number; availableLiquidValue: number; }
export interface CashAndOffsets { cashBalance: number; offsetBalance: number; businessCash: number; availableEquityContribution: number; postSettlementLiquidity: number; }
export interface ClientLiabilities { residentialLoans: number; commercialLoans: number; businessLoans: number; equipmentFinance: number; vehicleFinance: number; creditCards: number; overdrafts: number; atoPaymentPlans: number; personalLoans: number; directorGuarantees: number; relatedPartyLoans: number; annualDebtService: number; }
export interface BusinessFinancials { businessRevenue: number; ebitdaNpbt: number | null; addbacks: number; directorDrawings: number; existingRent: number; existingDebtService: number; equipmentFinance: number; workingCapitalRequirement: number; basAvailable: boolean; financialsAvailable: boolean; taxReturnsAvailable: boolean; }
export interface ClientScenarioAuditEvent { timestamp: string; user: string; action: string; field?: string; previousValue?: unknown; newValue?: unknown; source: string; scenarioId?: string; }

export interface ClientProfile {
  clientId: string; clientName: string; lastUpdated: string; personalIncome: number; businessIncome: number; ownershipStructures: string[];
  residentialAssets: ResidentialAsset[]; commercialAssets: CommercialAsset[]; industrialAssets: IndustrialAsset[];
  sharePortfolio: SharePortfolio; cashAndOffsets: CashAndOffsets; otherInvestments: number; liabilities: ClientLiabilities; existingLoans: ClientLiabilities; businessFinancials: BusinessFinancials; guarantors: string[]; taxProfile: Record<string, unknown>; gstProfile: Record<string, unknown>; latestBorrowingCapacity?: number; scenarios: ClientScenario[];
}

export interface PortfolioPositionSummary { totalAssetValue: number; residentialAssetValue: number; commercialAssetValue: number; industrialAssetValue: number; shareLiquidInvestmentValue: number; cashOffsets: number; totalDebt: number; residentialDebt: number; commercialDebt: number; businessDebt: number; equipmentVehicleFinance: number; netEquity: number; weightedLvr: number | null; annualGrossIncome: number; annualRentalIncome: number; annualNoi: number; annualBusinessIncome: number; annualDebtService: number; portfolioIcr: number | null; portfolioDscr: number | null; debtYield: number | null; availableLiquidity: number; requiredEquity: number; postSettlementLiquidity: number; preTaxCashflow: number; afterTaxCashflow: number; riskRating: 'green' | 'amber' | 'red'; borrowingCapacity: number; keyConstraint: string; }
export interface ScenarioComparison { current: PortfolioPositionSummary; proposed: PortfolioPositionSummary; difference: PortfolioPositionSummary; status: 'improves' | 'weakens' | 'mixed'; warnings: string[]; }
export interface ClientScenario { scenarioId: string; clientId: string; scenarioName: string; scenarioType: ScenarioType; status: ScenarioStatus; createdAt: string; createdBy: string; currentPositionSnapshot: PortfolioPositionSummary; proposedChanges: Record<string, unknown>; resultingPosition: PortfolioPositionSummary; calculatorInputs: Record<string, unknown>; calculatorOutputs?: Partial<BorrowingResult>; warnings: string[]; requiredDocuments: string[]; reportSummary: string; auditLog: ClientScenarioAuditEvent[]; }

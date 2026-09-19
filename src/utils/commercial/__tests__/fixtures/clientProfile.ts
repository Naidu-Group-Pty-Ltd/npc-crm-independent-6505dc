import type { ClientProfile } from '../../clientPortfolioTypes';

// Deliberately synthetic data kept under test fixtures so it is never imported by production bundles.
export const testClientProfiles: ClientProfile[] = [{
  clientId: 'synthetic-client-001', clientName: 'Synthetic Portfolio Test Client', lastUpdated: '2025-01-01T00:00:00.000Z',
  personalIncome: 240_000, businessIncome: 0, ownershipStructures: ['Company', 'Discretionary Trust'],
  residentialAssets: [{ id: 'test-r1', address: '1 Example Street, Testville', assetType: 'residential', propertyType: 'House', subtype: 'House', currentValue: 1_600_000, loanBalance: 820_000, annualRent: 62_400, expenses: 18_000 }],
  commercialAssets: [{ id: 'test-c1', address: '2 Example Street, Testville', assetType: 'commercial', assetSubtype: 'Office', subtype: 'Office', currentValue: 2_200_000, loanBalance: 1_250_000, annualRent: 165_000, expenses: 35_000, noi: 130_000, tenant: 'Synthetic tenant', wale: 3.2, leaseStatus: 'Leased', capRate: 0.06, icr: 1.7, dscr: 1.35, debtYield: 0.104 }],
  industrialAssets: [{ id: 'test-i1', address: '3 Example Street, Testville', assetType: 'industrial', industrialSubtype: 'Warehouse', subtype: 'Warehouse', currentValue: 3_100_000, loanBalance: 1_850_000, annualRent: 235_000, expenses: 42_000, noi: 193_000, gla: 1800, siteArea: 3200, siteCover: 0.56, hardstand: 900, tenant: 'Synthetic operator', wale: 4.1, leaseStatus: 'Leased', capRate: 0.062, environmentalStatus: 'Unknown', asbestosStatus: 'Unknown' }],
  sharePortfolio: { portfolioValue: 420_000, listedShares: 220_000, etfs: 150_000, managedFunds: 50_000, dividendIncome: 14_000, marginLoan: 0, liquidityHaircutPct: 20, availableLiquidValue: 336_000 },
  cashAndOffsets: { cashBalance: 260_000, offsetBalance: 180_000, businessCash: 150_000, availableEquityContribution: 360_000, postSettlementLiquidity: 80_000 }, otherInvestments: 50_000,
  liabilities: { residentialLoans: 820_000, commercialLoans: 0, businessLoans: 180_000, equipmentFinance: 65_000, vehicleFinance: 35_000, creditCards: 25_000, overdrafts: 40_000, atoPaymentPlans: 0, personalLoans: 0, directorGuarantees: 0, relatedPartyLoans: 0, annualDebtService: 310_000 },
  existingLoans: { residentialLoans: 820_000, commercialLoans: 3_100_000, businessLoans: 180_000, equipmentFinance: 65_000, vehicleFinance: 35_000, creditCards: 25_000, overdrafts: 40_000, atoPaymentPlans: 0, personalLoans: 0, directorGuarantees: 0, relatedPartyLoans: 0, annualDebtService: 310_000 },
  businessFinancials: { businessRevenue: 2_800_000, ebitdaNpbt: 520_000, addbacks: 45_000, directorDrawings: 180_000, existingRent: 190_000, existingDebtService: 85_000, equipmentFinance: 65_000, workingCapitalRequirement: 120_000, basAvailable: true, financialsAvailable: true, taxReturnsAvailable: false },
  guarantors: ['Synthetic guarantor'], taxProfile: { accountantReviewRequired: true }, gstProfile: { registered: true }, latestBorrowingCapacity: 2_400_000, scenarios: [],
}];

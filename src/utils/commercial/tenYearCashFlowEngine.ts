import type { CommercialIndustrialDealProfile } from './commercialDealState';
import { calculateInvestorYears, calculateIrr } from './tenYearInvestorCashFlowEngine';
import { calculateOwnerOccupierYears } from './tenYearOwnerOccupierEngine';
import { calculateRelatedPartyLeaseYears } from './tenYearRelatedPartyLeaseEngine';
import { buildCapexWarnings } from './capexScheduleEngine';
import { buildLeasingWarnings } from './leasingEventEngine';
import { buildTaxWarnings } from './taxAssumptionEngine';
import { generateTenYearCashFlowCommentary } from './cashFlowCommentaryGenerator';
import type { TaggedAssumption, TenYearCashFlowInputs, TenYearCashFlowMode, TenYearCashFlowResult, TenYearRiskStatus } from './tenYearCashFlowTypes';

const n = (v: unknown, fallback = 0) => typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const pct = (v: unknown, fallback = 0) => n(v, fallback);

export function buildTenYearInputsFromGlobal(profile: CommercialIndustrialDealProfile, mode: TenYearCashFlowMode = 'investor', overrides: Partial<TenYearCashFlowInputs> = {}): TenYearCashFlowInputs {
  const borrowing = profile.borrowingOutputs;
  const pv = profile.propertyValuation;
  const acq = profile.acquisitionCosts;
  const funds = borrowing?.fundsToComplete ?? profile.fundsToComplete;
  const lease = profile.leaseIncome as any;
  const expenses = profile.operatingExpenses as any;
  const purchaser = profile.purchaserStructure as any;
  const propertyValue = borrowing?.propertyValueUsedForLvr ?? n(pv.estimatedMarketValue, n(pv.purchasePrice, 0));
  const ownerExpenses = borrowing?.noi.totalOperatingExpenses ?? 0;
  const base: TenYearCashFlowInputs = {
    mode,
    assetDomain: profile.dealProfile.assetCategory === 'industrial' ? 'industrial' : 'commercial',
    assetSubtype: profile.dealProfile.assetSubtype,
    state: profile.dealProfile.state,
    purchasePrice: n(pv.purchasePrice),
    propertyValue,
    loanAmount: borrowing?.finalRiskAdjustedLoan ?? n(profile.debtInputs.proposedLoanAmount),
    availableEquity: n(purchaser.availableCashEquity),
    taxRatePct: purchaser.purchaserType === 'company' ? 30 : purchaser.purchaserType === 'smsf' ? 15 : 32.5,
    depreciationPa: 0,
    capitalWorksDeductionPa: 0,
    plantEquipmentDepreciationPa: 0,
    lossOffsetAllowed: false,
    accountantReviewRequired: true,
    passingRent: n(lease.grossPassingRent),
    marketRent: n(lease.marketRent),
    otherIncome: n(lease.otherIncome),
    recoveredOutgoings: n(lease.recoveredOutgoings),
    vacancyAllowancePct: n(lease.vacancyAllowancePct, 5),
    rentGrowthPct: 3,
    marketRentGrowthPct: 3,
    outgoingsGrowthPct: 3,
    expenseGrowthPct: 3,
    capitalGrowthPct: 2.5,
    selectedCapRatePct: n((profile.capRateOutputs as any)?.capitalisationRate, 6.5),
    terminalCapRatePct: n(profile.dcfInputs.terminalCapRatePct, 6.75),
    sellingCostPct: 2,
    downtimeMonths: 3,
    incentiveMonths: 1,
    leasingFeePct: 12,
    relettingCostAllowance: 0,
    leaseRiskHaircutPct: borrowing?.baseRiskAdjustedCriteria.noiHaircutPercentage ? borrowing.baseRiskAdjustedCriteria.noiHaircutPercentage * 100 : 0,
    tenantRiskHaircutPct: 0,
    annualCapexReserve: n(acq.capexReserve, borrowing?.capexReserve.totalCapexReserve ?? 0),
    majorCapexYear: 5,
    majorCapexAmount: 0,
    environmentalReserve: n(acq.environmentalReport),
    asbestosReserve: n(acq.asbestosReport),
    specialistReserve: profile.dealProfile.assetCategory === 'industrial' ? 10_000 : 5_000,
    councilRates: n(expenses.councilRates ?? expenses.rates ?? expenses.council), waterRates: n(expenses.waterRates ?? expenses.water), landTax: n(expenses.landTax ?? expenses.land_tax), insurance: n(expenses.insurance), strataOwnersCorp: n(expenses.strataOwnersCorp ?? expenses.strata), managementFees: n(expenses.managementFees ?? expenses.management), repairsMaintenance: n(expenses.repairsMaintenance ?? expenses.repairs_maintenance), utilities: n(expenses.utilities), cleaning: n(expenses.cleaning), security: n(expenses.security), otherOwnerExpenses: n(expenses.otherExpenses, ownerExpenses),
    gstSettlementCashflow: n(funds?.gstCashflowRequirement),
    gstEconomicCost: n((funds as any)?.gst?.economicCost),
    totalAcquisitionCosts: n(funds?.totalAcquisitionCosts),
    totalCostBase: n(funds?.totalCostBase, n(pv.purchasePrice) + n(funds?.totalAcquisitionCosts)),
    requiredEquity: n(funds?.requiredEquity),
    postSettlementLiquidity: n(funds?.postSettlementLiquidity),
    interestRatePct: n(profile.lendingAssumptions.contractInterestRatePct, 7.25),
    annualDebtService: borrowing?.annualDebtService ?? 0,
    amortisationYears: n(profile.lendingAssumptions.amortisationYears, 25),
    interestOnlyYears: n(profile.lendingAssumptions.interestOnlyPeriodYears),
    repaymentType: profile.lendingAssumptions.repaymentType === 'interestOnly' ? 'interestOnly' : 'principalAndInterest',
    ownershipStructure: String(purchaser.purchaserType ?? 'company'),
    businessRevenue: 0,
    businessEbitda: purchaser.existingBusinessEbitda && purchaser.existingBusinessEbitda > 0 ? purchaser.existingBusinessEbitda : null,
    businessAddbacks: 0,
    directorDrawings: 0,
    existingBusinessDebtService: n(purchaser.existingBusinessDebts) * 0.1,
    equipmentFinanceRepayments: 0,
    vehicleFinanceRepayments: 0,
    workingCapitalRequirement: n(acq.workingCapitalReserve),
    businessCashReserves: n(purchaser.sponsorLiquidity),
    currentRentPaid: n(purchaser.existingRentPaid),
    currentOutgoingsPaid: 0,
    rentEscalationPct: 3,
    businessIncomeGrowthPct: 3,
    businessExpenseGrowthPct: 3,
    relatedPartyRent: n(purchaser.proposedRentPayable, n(lease.marketRent)),
    relatedPartyRentGrowthPct: 3,
    relatedPartyLeaseVerified: Boolean(purchaser.relatedPartyTenant),
    marketRentSupportAvailable: false,
    stagedScheduleEnabled: ['development'].includes(String(profile.dealProfile.acquisitionPurpose)),
  };
  return { ...base, ...overrides, mode };
}

export function buildTenYearAssumptions(inputs: TenYearCashFlowInputs, overridden: string[] = []): Record<string, TaggedAssumption> {
  const mk = (key: keyof TenYearCashFlowInputs, label: string, status: TaggedAssumption['status'] = 'Manual Estimate') => ({ key: String(key), label, value: inputs[key] as any, status: overridden.includes(String(key)) ? 'Overridden' : status, source: overridden.includes(String(key)) ? 'manual' : 'global' } as TaggedAssumption);
  return {
    purchasePrice: mk('purchasePrice', 'Purchase price', 'Verified'),
    rentGrowthPct: mk('rentGrowthPct', 'Rent growth', 'Manual Estimate'),
    vacancyAllowancePct: mk('vacancyAllowancePct', 'Vacancy allowance', 'Manual Estimate'),
    annualCapexReserve: mk('annualCapexReserve', 'Capex reserve', 'Manual Estimate'),
    terminalCapRatePct: mk('terminalCapRatePct', 'Terminal cap rate', 'AI Estimate'),
    taxRatePct: mk('taxRatePct', 'Tax rate', 'Specialist Review Required'),
    gstEconomicCost: mk('gstEconomicCost', 'GST economic cost', inputs.gstEconomicCost > 0 ? 'Specialist Review Required' : 'Unknown'),
  };
}

export function validateTenYearInputs(inputs: TenYearCashFlowInputs): string[] {
  const warnings: string[] = [];
  if (inputs.purchasePrice <= 0) warnings.push('Purchase price must be greater than 0.');
  if (inputs.loanAmount < 0) warnings.push('Loan amount must be greater than or equal to 0.');
  if (inputs.interestRatePct < 0) warnings.push('Interest rate must be greater than or equal to 0.');
  if (inputs.selectedCapRatePct <= 0) warnings.push('Cap rate must be greater than 0.');
  if (inputs.terminalCapRatePct <= 0) warnings.push('Terminal cap rate must be greater than 0; terminal value is not calculated.');
  if (Math.abs(inputs.rentGrowthPct) > 10 || Math.abs(inputs.capitalGrowthPct) > 10) warnings.push('Extreme growth rate assumption detected.');
  if (inputs.mode === 'ownerOccupier' && inputs.currentRentPaid <= 0) warnings.push('Current rent avoided must be provided or estimated for owner-occupier mode.');
  if (inputs.mode === 'ownerOccupier' && inputs.businessRevenue <= 0) warnings.push('Business revenue is required to calculate occupancy cost ratio.');
  if (inputs.mode === 'ownerOccupier' && inputs.businessEbitda == null) warnings.push('EBITDA / NPBT must be provided to calculate Business DSCR; Business DSCR shown as N/A.');
  if (inputs.mode === 'relatedPartyLease' && !inputs.relatedPartyLeaseVerified) warnings.push('Related-party lease is not verified; specialist review required.');
  return warnings.concat(buildCapexWarnings(inputs), buildLeasingWarnings(inputs), buildTaxWarnings(inputs));
}

function riskStatus(warnings: string[]): TenYearRiskStatus {
  if (warnings.some(w => /must|required|specialist|unknown gst|not verified/i.test(w))) return 'red';
  if (warnings.length) return 'amber';
  return 'green';
}

export function calculateTenYearCashFlow(inputs: TenYearCashFlowInputs, overriddenFields: string[] = []): TenYearCashFlowResult {
  const years = inputs.mode === 'ownerOccupier' ? calculateOwnerOccupierYears(inputs) : inputs.mode === 'relatedPartyLease' ? calculateRelatedPartyLeaseYears(inputs) : calculateInvestorYears(inputs);
  const warnings = validateTenYearInputs(inputs);
  const y1 = years[0]; const y10 = years[9] ?? y1;
  const initialEquity = Math.max(inputs.requiredEquity, inputs.totalCostBase - inputs.loanAmount, 0);
  const leveredCashflows = [-initialEquity, ...years.map(y => y.afterTaxCashflow)];
  if (y10?.netSaleProceeds != null) leveredCashflows[10] += y10.netSaleProceeds;
  const unleveredCashflows = [-inputs.totalCostBase, ...years.map(y => y.preDebtOperatingCashflow)];
  if (y10?.terminalValue != null) unleveredCashflows[10] += y10.terminalValue * (1 - inputs.sellingCostPct / 100);
  const result: TenYearCashFlowResult = {
    mode: inputs.mode,
    inputs,
    years,
    summary: { mode: inputs.mode, purchasePrice: inputs.purchasePrice, totalCostBase: inputs.totalCostBase, requiredEquity: inputs.requiredEquity, year1Noi: y1?.actualNoi ?? 0, year1PreTaxCashflow: y1?.preTaxCashflow ?? 0, year1AfterTaxCashflow: y1?.afterTaxCashflow ?? 0, year10PropertyValue: y10?.propertyValue ?? 0, year10LoanBalance: y10?.closingLoanBalance ?? 0, year10Equity: y10?.equityPosition ?? 0, cumulativeAfterTaxCashflow: y10?.cumulativeAfterTaxCashflow ?? 0, leveredIrr: calculateIrr(leveredCashflows), unleveredIrr: calculateIrr(unleveredCashflows), equityMultiple: y10?.equityMultiple ?? null, terminalValue: y10?.terminalValue ?? null, ownerOccupierNetSavingCost: y1?.netSavingCostVsLeasing, businessDscr: y1?.businessDscr ?? null, occupancyCostRatio: y1?.occupancyCostRatio ?? null, cumulativeOwnershipBenefit: (y10?.cumulativeLeasingCostAvoided ?? 0) + (y10?.equityCreated ?? 0) + (y10?.cumulativeNetSavingCost ?? 0), propertyEntityCashflow: y1?.propertyEntityCashflow, groupCashflow: y1?.groupCashflow, groupDscr: y1?.groupDscr ?? null, cumulativeGroupBenefit: y10?.cumulativeGroupBenefit, riskStatus: riskStatus(warnings) },
    assumptions: buildTenYearAssumptions(inputs, overriddenFields),
    warnings,
    requiredDocuments: buildRequiredDocuments(inputs),
    commentary: '',
  };
  return { ...result, commentary: generateTenYearCashFlowCommentary(result) };
}

export function buildRequiredDocuments(inputs: TenYearCashFlowInputs): TenYearCashFlowResult['requiredDocuments'] {
  const base = ['Contract of sale','Lease agreement','Rent ledger','Outgoings statement','Council rates notice','Water rates notice','Land tax estimate','Insurance certificate','Depreciation schedule','Valuation','GST treatment confirmation','Loan terms / lender quote'].map(documentName => ({ documentName, requiredBecause: 'Supports 10-year commercial/industrial cashflow assumptions', relatedField: 'tenYearCashFlow', status: 'Required' as const }));
  if (inputs.assetDomain === 'industrial') base.push(...['Environmental report','Asbestos register/review','Roof inspection','Slab/structural inspection','Fire services report','Power capacity confirmation','Hardstand/truck access details','Trade waste approvals','Dangerous goods information','Make-good obligations'].map(documentName => ({ documentName, requiredBecause: 'Industrial cashflow and capex risk verification', relatedField: 'industrialCapex', status: 'Required' as const })));
  if (inputs.mode !== 'investor') base.push(...['Business financial statements','Business tax returns','BAS','Existing lease / rental evidence','Business debt schedule','Equipment finance schedule','Working capital evidence','Director guarantees'].map(documentName => ({ documentName, requiredBecause: 'Owner-occupier / related-party business servicing analysis', relatedField: 'businessImpact', status: 'Required' as const })));
  base.push({ documentName: 'Accountant confirmation of tax assumptions', requiredBecause: 'Tax outputs are indicative only unless verified', relatedField: 'taxRatePct', status: 'Required' as const });
  return base;
}

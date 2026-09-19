import type { TenYearCashFlowInputs, TenYearCashFlowYear } from './tenYearCashFlowTypes';

const safeDiv = (a: number, b: number): number | null => b > 0 ? a / b : null;
const annual = (inputs: TenYearCashFlowInputs, field: keyof NonNullable<TenYearCashFlowInputs['annualOverrides']>, year: number, fallback: number) => {
  const override = inputs.annualOverrides?.[field]?.[year];
  return typeof override?.value === 'number' && Number.isFinite(override.value) ? override.value : fallback;
};

export function calculateIrr(cashflows: number[], iterations = 60): number | null {
  if (!cashflows.some(v => v < 0) || !cashflows.some(v => v > 0)) return null;
  let low = -0.95, high = 1;
  const npv = (rate: number) => cashflows.reduce((sum, cf, i) => sum + cf / Math.pow(1 + rate, i), 0);
  while (npv(high) > 0 && high < 10) high *= 2;
  for (let i = 0; i < iterations; i += 1) {
    const mid = (low + high) / 2;
    if (npv(mid) > 0) low = mid; else high = mid;
  }
  const out = (low + high) / 2;
  return Number.isFinite(out) ? out : null;
}

export function calculateInvestorYears(inputs: TenYearCashFlowInputs): TenYearCashFlowYear[] {
  const years: TenYearCashFlowYear[] = [];
  let propertyValue = inputs.propertyValue || inputs.purchasePrice;
  let openingLoan = Math.max(0, inputs.loanAmount);
  let cumulativeAfterTax = 0;
  let cumulativeLeasingAvoided = 0;
  let cumulativeSaving = 0;
  let cumulativeGroupBenefit = 0;
  const initialEquity = Math.max(inputs.requiredEquity, inputs.totalCostBase - inputs.loanAmount, 0);
  let rentGrowth = 1;
  let marketGrowth = 1;
  let expenseGrowth = 1;
  let outgoingsGrowth = 1;
  for (let year = 1; year <= 10; year += 1) {
    const rentGrowthPct = annual(inputs, 'rentGrowthPct', year, inputs.rentGrowthPct);
    const outgoingsGrowthPct = annual(inputs, 'outgoingsGrowthPct', year, inputs.outgoingsGrowthPct);
    const vacancyAllowancePct = annual(inputs, 'vacancyAllowancePct', year, inputs.vacancyAllowancePct);
    const capitalGrowthPct = annual(inputs, 'capitalGrowthPct', year, inputs.capitalGrowthPct);
    const interestRatePct = annual(inputs, 'interestRatePct', year, inputs.interestRatePct);
    const taxRatePct = annual(inputs, 'taxRatePct', year, inputs.taxRatePct);
    const annualCapexReserve = annual(inputs, 'annualCapexReserve', year, inputs.annualCapexReserve);
    const downtimeMonths = annual(inputs, 'downtimeMonths', year, inputs.downtimeMonths);
    const incentiveMonths = annual(inputs, 'incentiveMonths', year, inputs.incentiveMonths);
    if (year > 1) {
      rentGrowth *= 1 + rentGrowthPct / 100;
      marketGrowth *= 1 + inputs.marketRentGrowthPct / 100;
      expenseGrowth *= 1 + inputs.expenseGrowthPct / 100;
      outgoingsGrowth *= 1 + outgoingsGrowthPct / 100;
    }
    propertyValue *= 1 + capitalGrowthPct / 100;

    const passingRent = annual(inputs, 'passingRent', year, inputs.passingRent * rentGrowth);
    const marketRent = inputs.marketRent * marketGrowth;
    const otherIncome = inputs.otherIncome * rentGrowth;
    const potentialGrossIncome = passingRent + otherIncome;
    const vacancyLoss = potentialGrossIncome * vacancyAllowancePct / 100;
    const recoveredOutgoings = annual(inputs, 'recoveredOutgoings', year, inputs.recoveredOutgoings * outgoingsGrowth);
    const effectiveGrossIncome = potentialGrossIncome - vacancyLoss + recoveredOutgoings;
    const globalOwnerBorneExpenses = [inputs.councilRates, inputs.waterRates, inputs.landTax, inputs.insurance, inputs.strataOwnersCorp, inputs.managementFees, inputs.repairsMaintenance, inputs.utilities, inputs.cleaning, inputs.security, inputs.otherOwnerExpenses].reduce((a, b) => a + b, 0) * expenseGrowth;
    const totalOwnerBorneExpenses = annual(inputs, 'otherOwnerExpenses', year, globalOwnerBorneExpenses);
    const actualNoi = effectiveGrossIncome - totalOwnerBorneExpenses;
    const stabilisedNoi = marketRent + otherIncome + recoveredOutgoings - (marketRent + otherIncome) * vacancyAllowancePct / 100 - totalOwnerBorneExpenses;
    const noiHaircutPct = Math.max(0, inputs.leaseRiskHaircutPct + inputs.tenantRiskHaircutPct);
    const noiHaircutAmount = actualNoi * noiHaircutPct / 100;
    const lenderAdjustedNoi = actualNoi - noiHaircutAmount;

    const annualDebtService = inputs.repaymentType === 'interestOnly' || year <= inputs.interestOnlyYears ? openingLoan * interestRatePct / 100 : inputs.annualDebtService;
    const interestPayment = openingLoan * interestRatePct / 100;
    const principalPayment = Math.max(0, annualDebtService - interestPayment);
    const closingLoanBalance = Math.max(0, openingLoan - principalPayment);

    const monthlyRent = passingRent / 12;
    const leaseDowntimeLoss = monthlyRent * downtimeMonths;
    const tenantIncentiveCost = monthlyRent * incentiveMonths;
    const leasingFee = passingRent * inputs.leasingFeePct / 100;
    const relettingCost = inputs.relettingCostAllowance;
    const totalLeasingVacancyCost = leaseDowntimeLoss + tenantIncentiveCost + leasingFee + relettingCost;
    const majorCapex = annual(inputs, 'majorCapexAmount', year, inputs.majorCapexYear === year ? inputs.majorCapexAmount ?? 0 : 0);
    const specialistReserves = inputs.environmentalReserve + inputs.asbestosReserve + inputs.specialistReserve;
    const totalCapex = annualCapexReserve + majorCapex + specialistReserves;
    const preDebtOperatingCashflow = actualNoi - totalLeasingVacancyCost - totalCapex;
    const preTaxCashflow = preDebtOperatingCashflow - annualDebtService;
    const deductions = interestPayment + totalOwnerBorneExpenses + inputs.depreciationPa + inputs.capitalWorksDeductionPa + inputs.plantEquipmentDepreciationPa;
    const taxableIncome = actualNoi - deductions;
    const rawTax = taxableIncome * taxRatePct / 100;
    const taxPayableBenefit = rawTax < 0 && !inputs.lossOffsetAllowed ? 0 : rawTax;
    const afterTaxCashflow = preTaxCashflow - taxPayableBenefit;
    cumulativeAfterTax += afterTaxCashflow;

    const terminalCapRatePct = year === 10 ? annual(inputs, 'terminalCapRatePct', year, inputs.terminalCapRatePct) : inputs.terminalCapRatePct;
    const terminalValue = year === 10 && terminalCapRatePct > 0 ? (stabilisedNoi * (1 + rentGrowthPct / 100)) / (terminalCapRatePct / 100) : null;
    const capRateValue = inputs.selectedCapRatePct > 0 ? stabilisedNoi / (inputs.selectedCapRatePct / 100) : null;
    const netSaleProceeds = terminalValue == null ? null : terminalValue * (1 - inputs.sellingCostPct / 100) - closingLoanBalance;
    const equityPosition = propertyValue - closingLoanBalance;
    const equityCreated = equityPosition - initialEquity;
    const equityMultiple = initialEquity > 0 ? (equityPosition + cumulativeAfterTax) / initialEquity : null;

    const rentAvoided = inputs.currentRentPaid * Math.pow(1 + inputs.rentEscalationPct / 100, year - 1);
    const outgoingsAvoided = inputs.currentOutgoingsPaid * expenseGrowth;
    const leasingCostAvoided = rentAvoided + outgoingsAvoided;
    cumulativeLeasingAvoided += leasingCostAvoided;
    const ownershipCashCost = annualDebtService + totalOwnerBorneExpenses + totalCapex + inputs.workingCapitalRequirement;
    const netSavingCostVsLeasing = leasingCostAvoided - ownershipCashCost;
    cumulativeSaving += netSavingCostVsLeasing;
    const availableBusinessCashflow = inputs.businessEbitda == null ? null : inputs.businessEbitda * Math.pow(1 + inputs.businessIncomeGrowthPct / 100, year - 1) + inputs.businessAddbacks - inputs.directorDrawings - inputs.workingCapitalRequirement;
    const totalBusinessDebtService = inputs.existingBusinessDebtService + inputs.equipmentFinanceRepayments + inputs.vehicleFinanceRepayments + annualDebtService;
    const businessDscr = availableBusinessCashflow == null ? null : safeDiv(availableBusinessCashflow, totalBusinessDebtService);
    const occupancyCostRatio = inputs.businessRevenue > 0 ? ownershipCashCost / (inputs.businessRevenue * Math.pow(1 + inputs.businessIncomeGrowthPct / 100, year - 1)) : null;
    const freeCashflowAfterOccupancy = availableBusinessCashflow == null ? null : availableBusinessCashflow - totalBusinessDebtService - totalOwnerBorneExpenses;

    const propertyEntityCashflow = inputs.relatedPartyRent * Math.pow(1 + inputs.relatedPartyRentGrowthPct / 100, year - 1) + recoveredOutgoings - totalOwnerBorneExpenses - annualDebtService - totalCapex;
    const operatingBusinessOccupancyCost = inputs.relatedPartyRent * Math.pow(1 + inputs.relatedPartyRentGrowthPct / 100, year - 1) + recoveredOutgoings;
    const groupCashflow = (inputs.currentRentPaid ? leasingCostAvoided : 0) - annualDebtService - totalOwnerBorneExpenses - totalCapex;
    cumulativeGroupBenefit += groupCashflow + Math.max(0, equityCreated);
    const groupDscr = availableBusinessCashflow == null ? null : safeDiv(availableBusinessCashflow + actualNoi - inputs.relatedPartyRent, totalBusinessDebtService);

    years.push({ year, capitalGrowthPct, propertyValue, capRateValue, terminalValue, netSaleProceeds, openingLoanBalance: openingLoan, interestRatePct, interestPayment, principalPayment, annualDebtService, closingLoanBalance, lvr: safeDiv(closingLoanBalance, propertyValue), icr: safeDiv(actualNoi, interestPayment), dscr: safeDiv(actualNoi, annualDebtService), debtYield: safeDiv(actualNoi, openingLoan), passingRent, marketRent, otherIncome, potentialGrossIncome, vacancyLoss, recoveredOutgoings, effectiveGrossIncome, totalOwnerBorneExpenses, actualNoi, stabilisedNoi, lenderAdjustedNoi, noiHaircutAmount, noiHaircutPct, leaseDowntimeLoss, tenantIncentiveCost, leasingFee, relettingCost, totalLeasingVacancyCost, annualCapexReserve, majorCapex, specialistReserves, totalCapex, preDebtOperatingCashflow, preTaxCashflow, taxableIncome, taxPayableBenefit, afterTaxCashflow, afterTaxCashflowWeekly: afterTaxCashflow / 52, cumulativeAfterTaxCashflow: cumulativeAfterTax, equityPosition, equityCreated, equityMultiple, rentAvoided, outgoingsAvoided, leasingCostAvoided, cumulativeLeasingCostAvoided: cumulativeLeasingAvoided, ownershipCashCost, netSavingCostVsLeasing, cumulativeNetSavingCost: cumulativeSaving, availableBusinessCashflow, businessDscr, occupancyCostRatio, freeCashflowAfterOccupancy, propertyEntityCashflow, operatingBusinessOccupancyCost, groupCashflow, groupDscr, cumulativeGroupBenefit });
    openingLoan = closingLoanBalance;
  }
  return years;
}

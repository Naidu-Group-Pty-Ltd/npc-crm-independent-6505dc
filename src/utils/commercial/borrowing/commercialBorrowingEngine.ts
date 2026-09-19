import { annualInterest, annualPI, maxLoanByIcr } from '../icrDscrCalculator';
import type { BindingConstraint, BorrowingInputs, BorrowingResult, CreditAssessmentStatus, LendingAssumptions, PurchaseAbilityStatus, RiskRating } from './calculatorTypes';
import { calculateAssessmentRate } from './assessmentRateEngine';
import { calculateBusinessServicing } from './businessServicingEngine';
import { calculateCapexReserve } from './capexReserveEngine';
import { generateCommentary } from './commentaryGenerator';
import { calculateCovenantPressure } from './covenantPressureEngine';
import { generateDocumentChecklist } from './documentChecklistEngine';
import { calculateFundsToComplete } from './fundsToCompleteEngine';
import { calculateGroupDebt } from './groupDebtEngine';
import { calculateNoi } from './noiAdjustmentEngine';
import { calculateRepaymentTesting } from './repaymentTestingEngine';
import { calculateReverseCalculators } from './reverseCalculatorEngine';
import { assessRiskOverlay } from './riskOverlayEngine';
import { groupWarnings } from './warningEngine';

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));
const pct = (n: number) => clamp(n, 0, 100) / 100;
const round = (n: number) => Math.round(Number.isFinite(n) ? n : 0);

function maxLoanByDscr(noi: number, assessRatePct: number, termYears: number, minDscr: number): number {
  if (noi <= 0 || assessRatePct <= 0 || minDscr <= 0) return 0;
  const targetAnnualPI = noi / minDscr;
  if (termYears <= 0) return targetAnnualPI / (assessRatePct / 100);
  const r = assessRatePct / 100 / 12;
  const n = termYears * 12;
  if (r === 0) return (targetAnnualPI / 12) * n;
  return (targetAnnualPI / 12) * (1 - Math.pow(1 + r, -n)) / r;
}

function valuationUsed(inputs: BorrowingInputs): number {
  const v = inputs.propertyValuation;
  const values = [v.purchasePrice, v.estimatedMarketValue, v.bankValuation ?? 0].filter(value => value > 0);
  if (!v.useConservativeValuation) return v.bankValuation && v.bankValuation > 0 ? v.bankValuation : v.estimatedMarketValue || v.purchasePrice;
  return values.length ? Math.min(...values) : 0;
}

function validate(inputs: BorrowingInputs, assumptions: LendingAssumptions, assessmentRatePct: number): string[] {
  const warnings: string[] = [];
  if (inputs.propertyValuation.purchasePrice <= 0) warnings.push('Purchase price must be greater than zero.');
  if (valuationUsed(inputs) <= 0) warnings.push('Property value used for LVR must be greater than zero.');
  if (pct(assumptions.maxLvr * 100) <= 0 || assumptions.maxLvr > 1) warnings.push('Maximum LVR must be between 0 and 1.');
  if (assumptions.contractInterestRatePct < 0) warnings.push('Interest rate must be greater than or equal to zero.');
  if (assessmentRatePct <= 0) warnings.push('Assessment rate must be greater than zero.');
  if (assumptions.minIcr <= 0 || assumptions.minDscr <= 0 || assumptions.minDebtYield <= 0) warnings.push('Minimum ICR, DSCR and debt yield must be greater than zero.');
  if (assumptions.loanTermYears <= 0) warnings.push('Loan term must be greater than zero.');
  if (!assumptions.disablePiDscrTest && assumptions.amortisationYears <= 0) warnings.push('Amortisation period must be greater than zero if DSCR is enabled.');
  if (inputs.dealProfile.leaseStatus === 'fullyLeased' && inputs.income.grossPassingRent <= 0) warnings.push('Fully leased assets require rent greater than zero.');
  if (inputs.riskInputs.leaseDocumentationComplete !== 'yes') warnings.push('Incomplete or unknown lease documents cannot result in Green credit status.');
  if (inputs.acquisitionCosts.gstTreatment === 'unknown') warnings.push('Unknown GST treatment cannot result in Green purchase ability status.');
  if (inputs.dealProfile.assetCategory === 'industrial' && (inputs.riskInputs.environmentalRisk == null || inputs.riskInputs.environmentalRisk === 'unknown')) warnings.push('Unknown industrial environmental risk cannot result in Green overall status.');
  if (['discretionaryTrust', 'unitTrust'].includes(inputs.purchaserStructure.purchaserType) && !inputs.purchaserStructure.trusteeDetails) warnings.push('Trust borrower with missing trust details requires structure warning.');
  if (inputs.purchaserStructure.purchaserType === 'smsf') warnings.push('SMSF borrower must remain Specialist Review unless the SMSF module is fully implemented.');
  return warnings;
}

function bindingFromCaps(caps: Array<{ key: BindingConstraint; value: number }>): { key: BindingConstraint; value: number } {
  return caps.reduce((min, c) => (c.value < min.value ? c : min), caps[0]);
}

function derivePurchaseAbility(credit: CreditAssessmentStatus, equityShortfall: number, liquidityStatus: string, gstSpecialist: boolean, maxLoan: number): PurchaseAbilityStatus {
  if (gstSpecialist || credit === 'specialistReview') return 'specialistReviewRequired';
  if (equityShortfall < 0) return 'equityShortfall';
  if (maxLoan <= 0) return 'notSupportable';
  if (liquidityStatus === 'tight') return 'supportableSubjectToVerification';
  if (liquidityStatus === 'insufficient') return 'equityShortfall';
  return 'supportable';
}

const creditLabel = (s: CreditAssessmentStatus) => s === 'green' ? 'Credit supportable' : s === 'amber' ? 'Credit supportable subject to verification' : s === 'red' ? 'Not Supportable' : 'Specialist review required before relying on result';
const purchaseLabel = (s: PurchaseAbilityStatus) => s === 'supportable' ? 'Sufficient equity to complete' : s === 'supportableSubjectToVerification' ? 'Sufficient equity but limited post-settlement buffer' : s === 'equityShortfall' ? 'Equity shortfall' : s === 'specialistReviewRequired' ? 'GST, duty, structure, SMSF, valuation or legal review required' : 'Not supportable under current assumptions';

export function calculateCommercialIndustrialBorrowing(inputs: BorrowingInputs, includeScenarios = true): BorrowingResult {
  const overlay = assessRiskOverlay(inputs);
  const assumptions: LendingAssumptions = {
    ...inputs.lendingAssumptions,
    maxLvr: clamp(inputs.lendingAssumptions.maxLvr + overlay.lvrAdjustmentPct, 0, 1),
    minIcr: Math.max(0.01, inputs.lendingAssumptions.minIcr + overlay.icrAdjustment),
    minDscr: Math.max(0.01, inputs.lendingAssumptions.minDscr + overlay.dscrAdjustment),
    minDebtYield: Math.max(0.001, inputs.lendingAssumptions.minDebtYield + overlay.debtYieldAdjustment),
  };
  const assessmentRateEngine = calculateAssessmentRate(assumptions);
  const assessmentRatePct = assessmentRateEngine.assessmentRatePct;
  const noi = calculateNoi(inputs, overlay);
  const propertyValueUsedForLvr = valuationUsed(inputs);
  const baseHardLvr = inputs.lendingAssumptions.hardMaxLvr ?? Math.max(inputs.lendingAssumptions.maxLvr, assumptions.maxLvr);
  const lvrCap = Math.max(0, propertyValueUsedForLvr * assumptions.maxLvr);
  const hardLvrCap = Math.max(0, propertyValueUsedForLvr * baseHardLvr);
  const icrCap = Math.max(0, maxLoanByIcr(noi.selectedNoi, assessmentRatePct, assumptions.minIcr));
  const dscrCap = assumptions.disablePiDscrTest ? Number.POSITIVE_INFINITY : Math.max(0, maxLoanByDscr(noi.selectedNoi, assessmentRatePct, assumptions.amortisationYears || assumptions.loanTermYears, assumptions.minDscr));
  const debtYieldCap = assumptions.debtYieldEnabled && assumptions.minDebtYield > 0 ? Math.max(0, noi.selectedNoi / assumptions.minDebtYield) : Number.POSITIVE_INFINITY;
  const liquidityCap = inputs.purchaserStructure.liquidityMultiplier > 0 ? Math.max(0, inputs.purchaserStructure.sponsorLiquidity * inputs.purchaserStructure.liquidityMultiplier) : null;
  const riskAdjustedCap = overlay.riskAdjustedAssetCap ?? null;
  const propertyCaps = [{ key: 'lvr' as const, value: lvrCap }, { key: 'icr' as const, value: icrCap }, { key: 'dscr' as const, value: dscrCap }, ...(assumptions.debtYieldEnabled ? [{ key: 'debtYield' as const, value: debtYieldCap }] : [])];
  const propertyBinding = bindingFromCaps(propertyCaps);
  const propertySupportedLoan = Math.max(0, propertyBinding.value);
  const preliminaryDebtService = annualPI(Math.max(propertySupportedLoan, 1), assessmentRatePct, assumptions.amortisationYears || assumptions.loanTermYears);
  const businessServicing = calculateBusinessServicing(inputs, noi.selectedNoi, preliminaryDebtService);
  const upliftAllowed = assumptions.sponsorUpliftAllowed !== false && businessServicing.sponsorUpliftEligible;
  const sponsorSupportedUplift = upliftAllowed ? Math.min(Math.max(0, hardLvrCap - propertySupportedLoan), Math.max(0, businessServicing.businessDebtServiceAvailable) / Math.max(assessmentRatePct / 100, 0.01) / 4) : 0;
  const allCaps = [{ key: propertyBinding.key, value: propertySupportedLoan + sponsorSupportedUplift }, { key: 'lvr' as const, value: lvrCap }, { key: 'lvr' as const, value: hardLvrCap }, ...(liquidityCap != null ? [{ key: 'liquidity' as const, value: liquidityCap }] : []), ...(riskAdjustedCap != null ? [{ key: 'riskOverlay' as const, value: riskAdjustedCap }] : []), ...(overlay.specialistReview ? [{ key: 'specialistReview' as const, value: Math.min(propertySupportedLoan, lvrCap) }] : [])];
  const finalBinding = bindingFromCaps(allCaps);
  const finalRiskAdjustedLoan = round(Math.max(0, Math.min(finalBinding.value, lvrCap, hardLvrCap)));
  const annualInt = annualInterest(finalRiskAdjustedLoan, assessmentRatePct);
  const annualDebtService = annualPI(finalRiskAdjustedLoan, assessmentRatePct, assumptions.amortisationYears || assumptions.loanTermYears);
  const fundsToComplete = calculateFundsToComplete(inputs.propertyValuation.purchasePrice, inputs.acquisitionCosts, finalRiskAdjustedLoan, inputs.purchaserStructure.availableCashEquity, overlay.additionalCapexReserve, annualDebtService, noi.totalOperatingExpenses - inputs.income.recoveredOutgoings);
  const icr = annualInt > 0 ? noi.selectedNoi / annualInt : 0;
  const dscr = annualDebtService > 0 ? noi.selectedNoi / annualDebtService : 0;
  const debtYield = finalRiskAdjustedLoan > 0 ? noi.selectedNoi / finalRiskAdjustedLoan : 0;
  const impliedLvr = propertyValueUsedForLvr > 0 ? finalRiskAdjustedLoan / propertyValueUsedForLvr : 0;
  const proposedLoan = inputs.dealProfile.proposedLoan && inputs.dealProfile.proposedLoan > 0 ? inputs.dealProfile.proposedLoan : finalRiskAdjustedLoan;
  const loanSupportabilityGap = finalRiskAdjustedLoan - proposedLoan;
  const proposedLoanSupportabilityMessage = inputs.dealProfile.proposedLoan == null ? 'No proposed loan entered. Maximum risk-adjusted loan shown for reference.' : proposedLoan <= finalRiskAdjustedLoan ? 'Proposed loan supportable.' : 'Proposed debt is not supportable under current assumptions.';
  const capexReserve = calculateCapexReserve(inputs, overlay.additionalCapexReserve);
  const repaymentTesting = calculateRepaymentTesting(inputs, finalRiskAdjustedLoan, noi.selectedNoi, assessmentRatePct);
  const groupDebt = calculateGroupDebt(inputs, finalRiskAdjustedLoan, annualDebtService, businessServicing.businessDebtServiceAvailable);
  const covenantPressure = calculateCovenantPressure(inputs, impliedLvr, icr, dscr, debtYield);
  const reverseCalculators = calculateReverseCalculators(inputs, proposedLoan, fundsToComplete.requiredEquity, assessmentRatePct, assumptions.minIcr, assumptions.maxLvr, assumptions.minDscr, annualDebtService > 0 && finalRiskAdjustedLoan > 0 ? annualDebtService / finalRiskAdjustedLoan : undefined, assumptions.minDebtYield);
  const warnings = [...validate(inputs, assumptions, assessmentRatePct), ...overlay.warnings, ...businessServicing.warnings, ...groupDebt.warnings, ...fundsToComplete.warnings, ...capexReserve.warnings, ...covenantPressure.warnings, ...repaymentTesting.warnings];
  let creditAssessmentStatus: CreditAssessmentStatus = 'green';
  if (overlay.specialistReview) creditAssessmentStatus = 'specialistReview';
  else if (finalRiskAdjustedLoan <= 0 || proposedLoan > finalRiskAdjustedLoan || icr < assumptions.minIcr || dscr < assumptions.minDscr || overlay.level === 'high' || businessServicing.status === 'notSupportable') creditAssessmentStatus = 'red';
  else if (warnings.length || overlay.level === 'medium' || inputs.propertyValuation.valuationConfidence !== 'high' || businessServicing.status === 'documentsRequired' || businessServicing.status === 'tight') creditAssessmentStatus = 'amber';
  const purchaseAbilityStatus = derivePurchaseAbility(creditAssessmentStatus, fundsToComplete.equitySurplusShortfall, fundsToComplete.liquidityStatus, fundsToComplete.gst.status === 'specialistReview', finalRiskAdjustedLoan);
  let overallStatus: RiskRating = creditAssessmentStatus;
  if (purchaseAbilityStatus === 'specialistReviewRequired') overallStatus = 'specialistReview';
  else if (purchaseAbilityStatus === 'equityShortfall' || purchaseAbilityStatus === 'notSupportable') overallStatus = overallStatus === 'specialistReview' ? overallStatus : 'red';
  else if (purchaseAbilityStatus === 'supportableSubjectToVerification' && overallStatus === 'green') overallStatus = 'amber';
  const primaryReason = finalBinding.key === 'icr' ? `Income is limited by the final minimum ICR hurdle of ${assumptions.minIcr.toFixed(2)}x.` : finalBinding.key === 'dscr' ? `Income is limited by the final minimum DSCR hurdle of ${assumptions.minDscr.toFixed(2)}x.` : finalBinding.key === 'lvr' ? `The result is capped by the final ${(assumptions.maxLvr * 100).toFixed(0)}% LVR ceiling.` : finalBinding.key === 'liquidity' ? 'Sponsor liquidity caps the supportable loan.' : finalBinding.key === 'specialistReview' ? 'A specialist review trigger prevents reliance on the output.' : 'Debt yield or risk settings are limiting the transaction.';
  const requiredNextAction = overallStatus === 'specialistReview' ? 'Obtain specialist lender/legal/accounting review before relying on this result.' : fundsToComplete.equitySurplusShortfall < 0 ? 'Confirm additional equity, vendor terms or a lower purchase price.' : 'Verify lease, valuation, GST, purchaser structure and due-diligence documents.';
  const warningGroups = groupWarnings(warnings);
  const documentChecklist = generateDocumentChecklist(inputs);
  const baseRiskAdjustedCriteria = { baseMaxLvr: inputs.lendingAssumptions.maxLvr, lvrRiskAdjustment: overlay.lvrAdjustmentPct, finalMaxLvrUsed: assumptions.maxLvr, baseMinimumIcr: inputs.lendingAssumptions.minIcr, icrRiskAdjustment: overlay.icrAdjustment, finalMinimumIcrUsed: assumptions.minIcr, baseMinimumDscr: inputs.lendingAssumptions.minDscr, dscrRiskAdjustment: overlay.dscrAdjustment, finalMinimumDscrUsed: assumptions.minDscr, baseMinimumDebtYield: inputs.lendingAssumptions.minDebtYield, debtYieldRiskAdjustment: overlay.debtYieldAdjustment, finalMinimumDebtYieldUsed: assumptions.minDebtYield, actualNoi: noi.actualNoi, stabilisedNoi: noi.stabilisedNoi, lenderAdjustedNoi: noi.lenderAdjustedNoi, noiHaircutAmount: Math.max(0, noi.stabilisedNoi - noi.lenderAdjustedNoi), noiHaircutPercentage: noi.stabilisedNoi > 0 ? Math.max(0, (noi.stabilisedNoi - noi.lenderAdjustedNoi) / noi.stabilisedNoi) : 0, lvrAdjustmentDriver: overlay.warnings.find(w => w.toLowerCase().includes('lvr')) ?? 'Profile Default', icrAdjustmentDriver: overlay.warnings.find(w => w.toLowerCase().includes('icr') || w.toLowerCase().includes('income')) ?? 'Profile Default', dscrAdjustmentDriver: overlay.warnings.find(w => w.toLowerCase().includes('dscr')) ?? 'Profile Default', debtYieldAdjustmentDriver: overlay.warnings.find(w => w.toLowerCase().includes('debt yield')) ?? 'Profile Default', noiHaircutDriver: noi.adjustments?.[0] ?? 'Profile Default' };
  const resultWithoutCommentary = { propertyValueUsedForLvr, propertySupportedLoan: round(propertySupportedLoan), sponsorSupportedUplift: round(sponsorSupportedUplift), finalRiskAdjustedLoan, proposedLoan, loanSupportabilityGap, proposedLoanSupportabilityMessage, creditAssessmentStatus, purchaseAbilityStatus, overallStatus, riskRating: overallStatus, bindingConstraint: finalBinding.key, impliedLvr, assessmentRate: assessmentRatePct / 100, assessmentRateEngine, icr, dscr, debtYield, annualInterest: round(annualInt), annualDebtService: round(annualDebtService), componentCaps: { lvrCap: round(lvrCap), icrCap: round(icrCap), dscrCap: Number.isFinite(dscrCap) ? round(dscrCap) : 0, debtYieldCap: assumptions.debtYieldEnabled ? round(debtYieldCap) : 0, liquidityCap: liquidityCap == null ? null : round(liquidityCap), riskAdjustedCap }, baseRiskAdjustedCriteria, noi, fundsToComplete, businessServicing, groupDebt, capexReserve, covenantPressure, repaymentTesting, reverseCalculators, warningGroups, purchaseAbilityStatusLabel: purchaseLabel(purchaseAbilityStatus), creditAssessmentStatusLabel: creditLabel(creditAssessmentStatus), primaryReason, secondaryRisks: warnings.slice(0, 8), requiredNextAction, warnings, documentChecklist, commentarySections: {} as BorrowingResult['commentarySections'], scenarios: [] } satisfies Omit<BorrowingResult, 'commentary'>;
  const commentary = generateCommentary(inputs, resultWithoutCommentary);
  const scenarios = includeScenarios ? generateScenarioComparison(inputs, finalRiskAdjustedLoan) : [];
  return { ...resultWithoutCommentary, commentary, commentarySections: resultWithoutCommentary.commentarySections, scenarios };
}

export function generateScenarioComparison(inputs: BorrowingInputs, baseLoan?: number): BorrowingResult['scenarios'] {
  const variants = [
    ['Base Case', {}], ['Conservative Bank Case', { lvr: -0.05, rate: 0.75, icr: 0.15, dscr: 0.1 }], ['Non-Bank Case', { lvr: 0.05, rate: 0.5, icr: -0.15, dscr: -0.1 }], ['Interest-Only Case', { amortisation: inputs.lendingAssumptions.loanTermYears, basis: 'interestOnlyAssessment' }], ['Principal-and-Interest Case', { amortisation: inputs.lendingAssumptions.loanTermYears, basis: 'principalAndInterestAssessment' }], ['Conservative Valuation Case', { valuation: 0.9 }], ['Higher Vacancy Case', { vacancy: 3 }], ['Higher Rate Case', { rate: 1 }],
  ] as const;
  return variants.map(([name, v]) => {
    const cloned: BorrowingInputs = JSON.parse(JSON.stringify(inputs));
    cloned.lendingAssumptions.contractInterestRatePct += 'rate' in v ? v.rate ?? 0 : 0;
    cloned.lendingAssumptions.maxLvr = clamp(cloned.lendingAssumptions.maxLvr + ('lvr' in v ? v.lvr ?? 0 : 0), 0, 1);
    cloned.lendingAssumptions.minIcr = Math.max(0.01, cloned.lendingAssumptions.minIcr + ('icr' in v ? v.icr ?? 0 : 0));
    cloned.lendingAssumptions.minDscr = Math.max(0.01, cloned.lendingAssumptions.minDscr + ('dscr' in v ? v.dscr ?? 0 : 0));
    cloned.income.vacancyAllowancePct = Math.max(0, cloned.income.vacancyAllowancePct + ('vacancy' in v ? v.vacancy ?? 0 : 0));
    if ('valuation' in v) cloned.propertyValuation.estimatedMarketValue *= v.valuation ?? 1;
    if ('amortisation' in v) cloned.lendingAssumptions.amortisationYears = v.amortisation || cloned.lendingAssumptions.loanTermYears;
    if ('basis' in v) cloned.lendingAssumptions.assessmentBasis = v.basis as any;
    const r = calculateCommercialIndustrialBorrowingNoScenarios(cloned);
    return { name, maxLoan: r.finalRiskAdjustedLoan || baseLoan || 0, proposedLoanSupportability: r.proposedLoanSupportabilityMessage, requiredEquity: r.fundsToComplete.requiredEquity, equitySurplusShortfall: r.fundsToComplete.equitySurplusShortfall, impliedLvr: r.impliedLvr, icr: r.icr, dscr: r.dscr, debtYield: r.debtYield, creditAssessmentStatus: r.creditAssessmentStatus, purchaseAbilityStatus: r.purchaseAbilityStatus, riskRating: r.riskRating, bindingConstraint: r.bindingConstraint, explanation: r.bindingConstraint === calculateCommercialIndustrialBorrowingNoScenarios(inputs).bindingConstraint ? `Loan unchanged because ${r.bindingConstraint.toUpperCase()}, not the changed assumption, remains the binding constraint.` : `Loan changed because the binding constraint moved to ${r.bindingConstraint.toUpperCase()}.` };
  });
}

function calculateCommercialIndustrialBorrowingNoScenarios(inputs: BorrowingInputs): Omit<BorrowingResult, 'scenarios' | 'commentary'> {
  const r = calculateCommercialIndustrialBorrowing({ ...inputs, lendingAssumptions: { ...inputs.lendingAssumptions } }, false);
  const { scenarios: _s, commentary: _c, ...rest } = r;
  return rest;
}

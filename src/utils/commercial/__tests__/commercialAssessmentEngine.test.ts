import { describe, expect, it } from 'vitest';
import { acceptAiEstimate, calculateBorrowingNoi, calculateCapRateEngine, calculateCommercialGst, calculateCommercialGstEngine, calculateIcrDscrEngine, calculateNoiEngine, createAiEstimate, markEstimateVerified, rejectAiEstimate, replaceWithManualValue, runDcfAssessment } from '..';
import { calculateCommercialIndustrialBorrowing } from '../borrowing/commercialBorrowingEngine';
import type { BorrowingInputs } from '../borrowing/calculatorTypes';

const borrowingBase = (patch: Partial<BorrowingInputs> = {}): BorrowingInputs => ({
  dealProfile: { assetCategory: 'commercial', assetSubtype: 'Office', acquisitionPurpose: 'investment', leaseStatus: 'fullyLeased', state: 'NSW', proposedLoan: undefined },
  purchaserStructure: { purchaserType: 'company', guaranteesAvailable: 'yes', gstRegistered: 'unknown', availableCashEquity: 1_000_000, sponsorLiquidity: 0, liquidityMultiplier: 0, existingBusinessEbitda: 0 },
  propertyValuation: { purchasePrice: 3_000_000, estimatedMarketValue: 3_000_000, useConservativeValuation: true, valuationConfidence: 'medium' },
  income: { grossPassingRent: 240_000, otherIncome: 10_000, recoveredOutgoings: 30_000, marketRent: 260_000, vacancyAllowancePct: 5, incentivesAdjustment: 0, tenantArrearsAdjustment: 0, nonRecoverableExpenses: 20_000, councilRates: 10_000, water: 2_000, landTax: 8_000, insurance: 5_000, strataOwnersCorp: 0, managementFees: 6_000, repairsMaintenance: 4_000, utilities: 0, cleaning: 0, security: 0, otherExpenses: 0, wale: 3, tenantCovenant: 'establishedSme', rentOverMarket: 'no', noiBasis: 'lenderAdjusted' },
  acquisitionCosts: { depositPaid: 0, stampDuty: 150_000, transferRegistrationFee: 180, mortgageRegistrationFee: 180, pexaSettlementFee: 150, legalConveyancingFee: 10_000, bankLegalFee: 5_000, valuationFee: 4_000, loanApplicationFee: 0, buyersAgentFee: 0, buildingInspection: 0, pestInspection: 0, structuralInspection: 0, fireComplianceInspection: 0, planningZoningReview: 0, environmentalReport: 0, asbestosReport: 0, dueDiligence: 5_000, capexReserve: 20_000, workingCapitalReserve: 10_000, otherAcquisitionCosts: 0, gstTreatment: 'gstInclusive', gstAmount: 0, gstClaimable: 'yes', gstCashflowRequired: 'no', goingConcernConfirmed: 'yes' },
  lendingAssumptions: { profile: 'mainstreamCommercialBank', contractInterestRatePct: 7, assessmentBufferPct: 1, assessmentFloorRatePct: 0, loanTermYears: 25, interestOnlyPeriodYears: 0, amortisationYears: 25, maxLvr: 0.65, minIcr: 1.5, minDscr: 1.25, minDebtYield: 0.09, debtYieldEnabled: true },
  riskInputs: { tenantStrength: 'established', vacancyLevel: 'minor', buildingCondition: 'good', zoningPlanningRisk: 'low', leaseDocumentationQuality: 'complete', environmentalRisk: 'low', asbestosRisk: 'low', capexRequired: 'minor' },
  ...patch,
} as BorrowingInputs);

describe('Commercial / Industrial Assessment Engine', () => {
  /**
   * The itemised expenses SUPERSEDE the single-figure entry; they do not add to
   * it.
   *
   * This asserted the two "together" — 20,000 non-recoverable + 42,000 itemised
   * = 62,000 — and that double-counts under either reading of
   * `nonRecoverableExpenses`. It is the borrowing engine's simple-mode slot for
   * total operating expenses, exactly as `simpleTotalOperatingExpenses` is in
   * `noiEngine`, whose own test — "NOI supports **either** simple total
   * operating expenses **or** itemised expenses" — has been asserting and
   * passing that contract all along. `reverseCalculatorEngine` reads it the
   * same way, deducting `nonRecoverableExpenses` alone as the whole expense
   * line. And if it were instead the not-recovered PORTION of the itemised
   * outgoings, adding it to them would double-count those same dollars.
   *
   * Every coherent reading gives 42,000 for this fixture; only "sum them" gives
   * 62,000. The test and the engine were written in the same merge and the file
   * has never run, so nothing reconciled them.
   *
   * All three modes are pinned rather than the one number, because the mode
   * that matters is the one nobody looks at: what happens when both are filled
   * in.
   */
  it('borrowing NOI takes the itemised expenses over the single-figure entry', () => {
    const withItemised = borrowingBase();
    withItemised.income.strataOwnersCorp = 7_000;

    const both = calculateBorrowingNoi(withItemised);
    expect(both.totalOperatingExpenses).toBe(42_000);
    expect(both.actualNoi).toBe(225_500);
    expect(both.selectedNoi).toBe(225_500);

    // Itemised alone: the same answer, so the 20,000 above changed nothing.
    const itemisedOnly = borrowingBase();
    itemisedOnly.income.strataOwnersCorp = 7_000;
    itemisedOnly.income.nonRecoverableExpenses = 0;
    expect(calculateBorrowingNoi(itemisedOnly).totalOperatingExpenses).toBe(42_000);

    // Simple alone: the single figure IS the total operating expense line.
    const simpleOnly = borrowingBase();
    Object.assign(simpleOnly.income, {
      councilRates: 0, water: 0, landTax: 0, insurance: 0,
      strataOwnersCorp: 0, managementFees: 0, repairsMaintenance: 0,
    });
    const simple = calculateBorrowingNoi(simpleOnly);
    expect(simple.totalOperatingExpenses).toBe(20_000);
    expect(simple.actualNoi).toBe(247_500);
  });

  it('NOI supports recovered outgoings, vacancy, lender adjustment, over-rent and unknown lease docs', () => {
    const r = calculateNoiEngine({ leaseType: 'unknown', grossPassingRent: 100_000, otherIncome: 5_000, marketRent: 90_000, vacancyAllowancePct: 5, recoveredOutgoings: 20_000, outgoings: [{ name: 'rates', amount: 20_000, recoverablePct: 100 }], incentiveAdjustment: 2_000, overRentAdjustment: 4_000, leaseDocsVerified: false }, 'lenderAdjusted');
    expect(r.potentialGrossIncome).toBe(105_000);
    expect(r.vacancyLoss).toBe(5_250);
    expect(r.actualNoi).toBe(99_750);
    expect(r.lenderAdjustedNoi).toBe(93_750);
    expect(r.confidenceTag).toBe('Specialist Review Required');
  });

  it('NOI parses currency strings, commas and percent inputs without display-formatted math', () => {
    const r = calculateNoiEngine({
      leaseType: 'net',
      grossPassingRent: '$100,000',
      otherIncome: '$5,000',
      marketRent: '$110,000',
      vacancyAllowancePct: '5%',
      recoveredOutgoings: '$20,000',
      outgoings: [{ name: 'Council Rates', amount: '$10,000', recoverablePct: '100%' }],
      incentiveAdjustment: '$2,000',
      tenantRiskHaircut: '$3,000',
      leaseDocsVerified: true,
    }, 'lenderAdjusted');

    expect(r.potentialGrossIncome).toBe(105_000);
    expect(r.vacancyLoss).toBe(5_250);
    expect(r.effectiveGrossIncome).toBe(119_750);
    expect(r.totalOperatingExpenses).toBe(10_000);
    expect(r.actualNoi).toBe(109_750);
    expect(r.stabilisedNoi).toBe(119_250);
    expect(r.lenderAdjustedNoi).toBe(104_750);
    expect(r.selectedNoi).toBe(104_750);
  });

  it('NOI remains pending-safe when required values are empty or invalid', () => {
    const r = calculateNoiEngine({
      leaseType: 'gross',
      grossPassingRent: '',
      vacancyAllowancePct: 'not a number',
      otherIncome: '$1,000',
      recoveredOutgoings: '$2,000',
      outgoings: [{ name: 'Insurance', amount: '$3,000', recoverablePct: '100%' }],
    }, 'actual');

    expect(r.selectedNoi).toBe(0);
    expect(r.totalOperatingExpenses).toBe(0);
    expect(r.warnings.join(' ')).toContain('pending required gross rent and vacancy allowance');
  });

  it('NOI supports either simple total operating expenses or itemised expenses', () => {
    const simple = calculateNoiEngine({
      leaseType: 'gross',
      grossPassingRent: 100_000,
      otherIncome: 5_000,
      vacancyAllowancePct: 5,
      recoveredOutgoings: 10_000,
      simpleTotalOperatingExpenses: 20_000,
    }, 'actual');
    const itemised = calculateNoiEngine({
      leaseType: 'gross',
      grossPassingRent: 100_000,
      otherIncome: 5_000,
      vacancyAllowancePct: 5,
      recoveredOutgoings: 10_000,
      outgoings: [
        { name: 'Council Rates', amount: 8_000, recoverablePct: 0 },
        { name: 'Water', amount: 2_000, recoverablePct: 0 },
        { name: 'Insurance', amount: 10_000, recoverablePct: 0 },
      ],
    }, 'actual');

    expect(simple.totalOperatingExpenses).toBe(20_000);
    expect(itemised.totalOperatingExpenses).toBe(20_000);
    expect(simple.actualNoi).toBe(itemised.actualNoi);
  });

  it('Cap rate calculates passing, reversionary, blended, implied value, valuation gap percentage and sensitivity', () => {
    const r = calculateCapRateEngine({ passingNoi: 70_000, marketNoi: 80_000, selectedNoi: 75_000, price: 1_000_000, targetCapRatePct: 7.5, sensitivityCapRatesPct: [7, 8] });
    expect(r.passingYield).toBe(7);
    expect(r.reversionaryYield).toBe(8);
    expect(r.blendedYield).toBe(7.5);
    expect(r.impliedValue).toBeCloseTo(1_000_000, 0);
    expect(r.valuationGap).toBeCloseTo(0, 0);
    expect(r.valuationGapPct).toBeCloseTo(0, 0);
    expect(r.valueSensitivity).toHaveLength(2);
  });

  it('Cap rate parses display-formatted inputs, treats cap rates as percentages and honours NOI valuation basis', () => {
    const r = calculateCapRateEngine({ passingNoi: '$70,000', marketNoi: '$80,000', lenderAdjustedNoi: '$60,000', price: '$1,000,000', targetCapRatePct: '6.5%', valuationBasis: 'lenderAdjusted', sensitivityCapRatesPct: ['6%', 'invalid'] });
    expect(r.passingYield).toBe(7);
    expect(r.reversionaryYield).toBe(8);
    expect(r.selectedNoi).toBe(60_000);
    expect(r.impliedValue).toBeCloseTo(923_077, 0);
    expect(r.valueSensitivity).toHaveLength(1);
  });

  it('Cap rate returns pending-safe nulls instead of zero, NaN or Infinity when required inputs are missing', () => {
    const r = calculateCapRateEngine({ passingNoi: '', marketNoi: 'not a number', selectedNoi: '', price: '0', targetCapRatePct: '0', sensitivityCapRatesPct: [0, ''] });
    expect(r.passingYield).toBeNull();
    expect(r.reversionaryYield).toBeNull();
    expect(r.blendedYield).toBeNull();
    expect(r.impliedValue).toBeNull();
    expect(r.valuationGap).toBeNull();
    expect(r.valuationGapPct).toBeNull();
    expect(r.valueSensitivity).toHaveLength(0);
  });

  it('ICR/DSCR calculates interest, P&I service, debt yield and max loans', () => {
    const r = calculateIcrDscrEngine({ noi: 150_000, loanAmount: 1_000_000, contractInterestRatePct: 7, assessmentBufferPct: 1, repaymentType: 'principalAndInterest', amortisationYears: 25, minimumIcr: 1.5, minimumDscr: 1.25, minimumDebtYield: 0.09 });
    expect(r.annualInterest).toBe(80_000);
    expect(r.annualDebtService).toBeGreaterThan(90_000);
    expect(r.icr).toBe(1.88);
    expect(r.dscr).toBeGreaterThan(1);
    expect(r.debtYield).toBe(0.15);
    expect(r.maxLoanByIcr).toBeCloseTo(1_250_000, 0);
    expect(r.maxLoanByDscr).toBeGreaterThan(0);
    // 150,000 / 0.09 = 1,666,666.67 — the engine is exact and this assertion
    // was the truncated integer at ±0.5, so it failed by 0.67 of a dollar. The
    // expectation is the arithmetic, not a rounding of it.
    expect(r.maxLoanByDebtYield).toBeCloseTo(150_000 / 0.09, 2);
  });

  it('GST handles inclusive, plus GST, verified/unverified going concern, unknown and claimable cashflow', () => {
    expect(calculateCommercialGstEngine({ purchasePrice: 1_100_000, treatment: 'gstInclusive', purchaserGstRegistered: 'yes' }).gstClaimableAmount).toBeCloseTo(100_000, 0);
    expect(calculateCommercialGstEngine({ purchasePrice: 1_000_000, treatment: 'plusGst', purchaserGstRegistered: 'yes' }).gstSettlementCashflowRequirement).toBe(100_000);
    expect(calculateCommercialGst({ purchasePrice: 1_000_000, treatment: 'plus_gst', purchaserRegistered: true })).toMatchObject({ gstAmount: 100_000, gstClaimable: 100_000, netAcquisitionCost: 1_100_000 });
    expect(calculateCommercialGstEngine({ purchasePrice: 1_000_000, treatment: 'goingConcern', vendorGstRegistered: 'yes', purchaserGstRegistered: 'yes', goingConcernAgreedInWriting: 'yes', enterpriseCarriedOnUntilSettlement: 'yes', supplierProvidesAllThingsNecessary: 'yes', propertyLeasedOrOperatingEnterprise: 'yes' }).gstVerificationStatus).toBe('Verified');
    expect(calculateCommercialGstEngine({ purchasePrice: 1_000_000, treatment: 'goingConcern' }).gstVerificationStatus).toBe('Specialist Review Required');
    expect(calculateCommercialGstEngine({ purchasePrice: 1_000_000, treatment: 'unknown' }).warnings.join(' ')).toContain('Unknown GST');
  });

  it('GST honours an explicit ITC denial for a registered purchaser', () => {
    const r = calculateCommercialGstEngine({
      purchasePrice: 1_100_000,
      treatment: 'gstInclusive',
      purchaserGstRegistered: 'yes',
      gstClaimableAsInputTaxCredit: 'no',
    });

    expect(r.gstClaimableAmount).toBe(0);
    expect(r.gstEconomicCost).toBeCloseTo(100_000, 0);
    expect(r.netAcquisitionCost).toBeCloseTo(1_200_000, 0);
  });

  it('DCF includes growth, vacancy, capex, debt service, terminal value, sale proceeds, IRR, NPV and equity multiple', () => {
    const r = runDcfAssessment({ purchasePrice: 5_000_000, acquisitionCosts: 250_000, initialNoi: 400_000, holdPeriodYears: 10, rentalGrowthPct: 3, vacancyAllowancePct: 5, annualCapex: 10_000, terminalCapRatePct: 6.5, sellingCostsPct: 1.5, discountRatePct: 8, loanAmount: 3_000_000, interestRatePct: 6, loanTermYears: 25 });
    expect(r.rows[1].grossNoi).toBeGreaterThan(r.rows[0].grossNoi);
    expect(r.rows[0].capex).toBe(10_000);
    expect(r.rows[0].debtService).toBeGreaterThan(0);
    expect(r.terminalValue).toBeGreaterThan(0);
    expect(r.netSaleProceeds).toBeGreaterThan(0);
    expect(r.unleveredIrr).not.toBeNull();
    expect(r.leveredIrr).not.toBeNull();
    expect(r.unleveredNpv).not.toBe(0);
    expect(r.equityMultiple).toBeGreaterThan(1);
  });

  it('Borrowing fixes blank proposed loan, invalid EBITDA, liquidity N/A and price solver', () => {
    const r = calculateCommercialIndustrialBorrowing(borrowingBase({ purchaserStructure: { ...borrowingBase().purchaserStructure, availableCashEquity: 100_000, existingBusinessEbitda: 0 } }));
    expect(r.proposedLoanSupportabilityMessage).toContain('No proposed loan entered');
    expect(r.groupDebt.debtToEbitda).toBeNull();
    expect(r.fundsToComplete.monthsDebtServiceCovered).toBeNull();
    expect(r.reverseCalculators.requiredPurchasePriceToFitAvailableEquity).toBeGreaterThanOrEqual(0);
    expect(r.fundsToComplete.acquisitionCostLineItems?.transferRegistrationFee).toBe(180);
  });

  it('Borrowing NOI includes strata and owners corporation expenses', () => {
    const strataOwnersCorp = 50_000;
    const withoutStrata = calculateCommercialIndustrialBorrowing(borrowingBase());
    const withStrata = calculateCommercialIndustrialBorrowing(borrowingBase({
      income: { ...borrowingBase().income, strataOwnersCorp },
    }));

    expect(withStrata.noi.totalOperatingExpenses).toBe(withoutStrata.noi.totalOperatingExpenses + strataOwnersCorp);
    expect(withStrata.noi.actualNoi).toBe(withoutStrata.noi.actualNoi - strataOwnersCorp);
    expect(withStrata.noi.selectedNoi).toBe(withoutStrata.noi.selectedNoi - strataOwnersCorp);
  });

  it('Borrowing scenarios explain changed or unchanged values', () => {
    const r = calculateCommercialIndustrialBorrowing(borrowingBase({ dealProfile: { ...borrowingBase().dealProfile, proposedLoan: 1_000_000 } }));
    expect(r.scenarios.length).toBeGreaterThan(0);
    expect(r.scenarios[0].explanation).toBeTruthy();
  });

  it('AI estimates can be accepted, rejected, overridden, verified and audited safely', () => {
    const estimate = createAiEstimate({ fieldKey: 'leaseIncome.vacancyAllowancePct', estimatedValue: 5, confidence: 'medium', impactAreas: ['lending'], requiredDocuments: ['Lease schedule'] });
    expect(estimate.canProduceGreenStatus).toBe(false);
    expect(acceptAiEstimate(estimate).confidenceTag).toBe('AI Estimate');
    expect(rejectAiEstimate(estimate).canUseInFinalReport).toBe(false);
    expect(replaceWithManualValue(estimate, 6).confidenceTag).toBe('Manual Estimate');
    expect(markEstimateVerified(estimate).canProduceGreenStatus).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { calculateCommercialIndustrialBorrowing } from '../borrowing/commercialBorrowingEngine';
import { buildClientScenario } from '../scenarioModellingEngine';
import { buildScenarioComparisonRows, comparePortfolioScenario } from '../scenarioComparisonEngine';
import { testClientProfiles } from './fixtures/clientProfile';

const baseBorrowingInputs = {
  dealProfile: { assetCategory: 'commercial' as const, assetSubtype: 'Office', acquisitionPurpose: 'investment' as const, leaseStatus: 'fullyLeased' as const, state: 'NSW' as const },
  purchaserStructure: { purchaserType: 'company' as const, guaranteesAvailable: 'yes' as const, relatedPartyTenant: false, gstRegistered: 'yes' as const, availableCashEquity: 900_000, sponsorLiquidity: 300_000, liquidityMultiplier: 0, existingBusinessDebts: 0, existingBusinessEbitda: 0, existingRentPaid: 0, proposedRentPayable: 0, smsfBalance: 0, smsfSpecialistReviewRequired: false },
  propertyValuation: { purchasePrice: 2_000_000, estimatedMarketValue: 2_000_000, useConservativeValuation: true, valuationConfidence: 'medium' as const, landArea: 1000, buildingArea: 700, lettableArea: 650, truckAccessQuality: 'good' as const, powerCapacity: 'unknown' as const, slabCondition: 'good' as const, roofCondition: 'good' as const },
  income: { grossPassingRent: 160_000, otherIncome: 0, recoveredOutgoings: 20_000, marketRent: 160_000, vacancyAllowancePct: 3, incentivesAdjustment: 0, tenantArrearsAdjustment: 0, nonRecoverableExpenses: 10_000, councilRates: 8_000, water: 2_000, landTax: 5_000, insurance: 4_000, strataOwnersCorp: 0, managementFees: 4_000, repairsMaintenance: 3_000, utilities: 0, cleaning: 0, security: 0, otherExpenses: 0, wale: 4, tenantCovenant: 'establishedSme' as const, rentOverMarket: 'no' as const, percentageAboveMarket: 0, noiBasis: 'lenderAdjusted' as const },
  acquisitionCosts: { depositPaid: 0, stampDuty: 100_000, transferRegistrationFee: 180, mortgageRegistrationFee: 180, pexaSettlementFee: 150, legalConveyancingFee: 10_000, bankLegalFee: 5_000, valuationFee: 3_000, loanApplicationFee: 0, buyersAgentFee: 0, buildingInspection: 0, pestInspection: 0, structuralInspection: 0, fireComplianceInspection: 0, planningZoningReview: 0, environmentalReport: 0, asbestosReport: 0, dueDiligence: 5_000, capexReserve: 20_000, workingCapitalReserve: 10_000, otherAcquisitionCosts: 0, gstTreatment: 'unknown' as const, gstAmount: 0, gstClaimable: 'unknown' as const, gstCashflowRequired: 'unknown' as const, goingConcernConfirmed: 'unknown' as const, landholderAcquisition: 'no' as const, vicCommercialIndustrialPropertyTax: 'no' as const, saQualifyingNonResidentialLand: 'no' as const },
  lendingAssumptions: { profile: 'mainstreamCommercialBank' as const, contractInterestRatePct: 7, assessmentBufferPct: 1, assessmentFloorRatePct: 0, assessmentBasis: 'contractPlusBuffer' as const, repaymentType: 'principalAndInterest' as const, exitStrategy: 'unknown' as const, loanTermYears: 25, interestOnlyPeriodYears: 0, amortisationYears: 25, maxLvr: 0.65, minIcr: 1.5, minDscr: 1.25, minDebtYield: 0.09, debtYieldEnabled: true },
  riskInputs: { tenantStrength: 'established' as const, vacancyLevel: 'minor' as const, buildingCondition: 'good' as const, zoningCertainty: 'clear' as const, leaseDocumentationComplete: 'yes' as const, environmentalRisk: 'low' as const, asbestosRisk: 'low' as const, capexRequired: 'some' as const, rentComparedToMarket: 'belowOrAtMarket' as const },
};

describe('commercial client portfolio scenario engine', () => {
  /**
   * NOI is pinned by its parts, not as a constant.
   *
   * This asserted `actualNoi === 148_200`, which is not reconstructible from
   * the fixture under any rule I could find — the components below give
   * **149,200**, and the 1,000 difference corresponds to nothing in the inputs.
   * The engine's figure follows the stated formula exactly:
   *
   *     PGI            160,000   grossPassingRent + otherIncome
   *     less vacancy    -4,800   3% of PGI
   *     plus recoveries +20,000  recoveredOutgoings
   *     = EGI          175,200
   *     less opex      -26,000   the ITEMISED outgoings (8+2+5+4+4+3k); the
   *                              10,000 single-figure entry is superseded, see
   *                              commercialAssessmentEngine.test.ts
   *     = actual NOI   149,200
   *
   * Asserting the components is the point: a bare total tells whoever breaks it
   * that a number moved, and these tell them which term did. The old constant
   * could not do that, and — like every other assertion in this merge — had
   * never run to find out.
   */
  it('preserves deterministic property-only borrowing calculation', () => {
    const result = calculateCommercialIndustrialBorrowing(baseBorrowingInputs);
    expect(result.finalRiskAdjustedLoan).toBeGreaterThan(0);

    const noi = result.noi;
    expect(noi.potentialGrossIncome).toBe(160_000);
    expect(noi.vacancyLoss).toBe(4_800);
    expect(noi.effectiveGrossIncome).toBe(175_200);
    expect(noi.totalOperatingExpenses).toBe(26_000);
    expect(noi.actualNoi).toBe(149_200);
    // No lender adjustments are supplied, so all three bases agree.
    expect(noi.selectedNoi).toBe(noi.actualNoi);
  });

  it('calculates client-profile scenario outputs and comparison rows', () => {
    const client = testClientProfiles[0];
    const result = calculateCommercialIndustrialBorrowing(baseBorrowingInputs);
    const scenario = buildClientScenario(client, { scenarioName: 'Acquire office', scenarioType: 'Acquire Commercial Asset', purchasePrice: 2_000_000, proposedDebt: result.finalRiskAdjustedLoan, requiredEquity: result.fundsToComplete.requiredEquity, annualNoi: result.noi.actualNoi, annualDebtService: result.annualDebtService, borrowingResult: result });
    const comparison = comparePortfolioScenario(scenario.currentPositionSnapshot, scenario.resultingPosition);
    expect(comparison.difference.totalAssetValue).toBe(2_000_000);
    // The scenario is handed `result.noi.actualNoi` and the current position
    // holds no such asset, so the difference IS that figure. Asserted against
    // the source rather than as a second copy of the constant — the property
    // worth pinning here is that the scenario carries it through unchanged,
    // and a literal cannot say that.
    expect(comparison.difference.annualNoi).toBe(result.noi.actualNoi);
    expect(comparison.difference.annualNoi).toBe(149_200);
    expect(buildScenarioComparisonRows(comparison.current, comparison.proposed)).toHaveLength(29);
  });

  it('triggers reliability warnings for missing liabilities and business financials', () => {
    const client = { ...testClientProfiles[0], liabilities: { ...testClientProfiles[0].liabilities, residentialLoans: 0, commercialLoans: 0, businessLoans: 0, equipmentFinance: 0, vehicleFinance: 0, creditCards: 0, overdrafts: 0, atoPaymentPlans: 0, personalLoans: 0, directorGuarantees: 0, relatedPartyLoans: 0 }, businessFinancials: { ...testClientProfiles[0].businessFinancials, ebitdaNpbt: null, financialsAvailable: false } };
    const scenario = buildClientScenario(client, { scenarioName: 'Limited data', scenarioType: 'Acquire Industrial Asset', purchasePrice: 1_000_000, proposedDebt: 700_000, requiredEquity: 400_000, annualNoi: 60_000, annualDebtService: 70_000 });
    expect(scenario.proposedChanges.reliability).toBe('Limited');
    expect(scenario.warnings.join(' ')).toContain('Liabilities are missing');
    expect(scenario.warnings.join(' ')).toContain('Business financials missing');
  });

  it('marks equity shortfall red and negative liquidity months as N/A', () => {
    const scenario = buildClientScenario(testClientProfiles[0], { scenarioName: 'Shortfall', scenarioType: 'Acquire Commercial Asset', purchasePrice: 10_000_000, proposedDebt: 5_000_000, requiredEquity: 99_000_000, annualNoi: 100_000, annualDebtService: 450_000 });
    expect(scenario.resultingPosition.riskRating).toBe('red');
    expect(scenario.proposedChanges.postSettlementLiquidityMonths).toBe('N/A');
  });
});

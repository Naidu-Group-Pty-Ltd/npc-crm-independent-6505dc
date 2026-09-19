import { describe, expect, it } from 'vitest';
import { calculateTenYearCashFlow, type TenYearCashFlowInputs } from '..';

const baseInputs = (patch: Partial<TenYearCashFlowInputs> = {}): TenYearCashFlowInputs => ({
  mode: 'investor', assetDomain: 'commercial', assetSubtype: 'Office', state: 'NSW', purchasePrice: 1_000_000, propertyValue: 1_000_000, loanAmount: 600_000, availableEquity: 500_000, taxRatePct: 30, depreciationPa: 10_000, capitalWorksDeductionPa: 5_000, plantEquipmentDepreciationPa: 0, lossOffsetAllowed: true, accountantReviewRequired: true,
  passingRent: 100_000, marketRent: 110_000, otherIncome: 5_000, recoveredOutgoings: 20_000, vacancyAllowancePct: 5, rentGrowthPct: 3, marketRentGrowthPct: 3, outgoingsGrowthPct: 3, expenseGrowthPct: 3, capitalGrowthPct: 2, selectedCapRatePct: 6.5, terminalCapRatePct: 7, sellingCostPct: 2,
  downtimeMonths: 1, incentiveMonths: 1, leasingFeePct: 10, relettingCostAllowance: 2_000, leaseRiskHaircutPct: 2, tenantRiskHaircutPct: 1, annualCapexReserve: 8_000, majorCapexYear: 5, majorCapexAmount: 50_000, environmentalReserve: 0, asbestosReserve: 0, specialistReserve: 0,
  councilRates: 5_000, waterRates: 1_000, landTax: 4_000, insurance: 2_000, strataOwnersCorp: 0, managementFees: 3_000, repairsMaintenance: 2_000, utilities: 0, cleaning: 0, security: 0, otherOwnerExpenses: 0,
  gstSettlementCashflow: 0, gstEconomicCost: 0, totalAcquisitionCosts: 70_000, totalCostBase: 1_070_000, requiredEquity: 470_000, postSettlementLiquidity: 30_000,
  interestRatePct: 6, annualDebtService: 45_000, amortisationYears: 25, interestOnlyYears: 0, repaymentType: 'principalAndInterest', ownershipStructure: 'company',
  businessRevenue: 1_000_000, businessEbitda: 200_000, businessAddbacks: 20_000, directorDrawings: 60_000, existingBusinessDebtService: 20_000, equipmentFinanceRepayments: 5_000, vehicleFinanceRepayments: 5_000, workingCapitalRequirement: 10_000, businessCashReserves: 100_000, currentRentPaid: 90_000, currentOutgoingsPaid: 10_000, rentEscalationPct: 3, businessIncomeGrowthPct: 3, businessExpenseGrowthPct: 3,
  relatedPartyRent: 100_000, relatedPartyRentGrowthPct: 3, relatedPartyLeaseVerified: true, marketRentSupportAvailable: true, stagedScheduleEnabled: false, ...patch,
});

describe('Commercial / Industrial 10-Year Cash Flow', () => {
  it('Investor Mode calculates rent growth, vacancy, NOI, capex, debt, tax, LVR, ICR, DSCR, debt yield, terminal value, IRR and equity multiple', () => {
    const r = calculateTenYearCashFlow(baseInputs());
    const y1 = r.years[0];
    expect(y1.passingRent).toBe(100_000);
    expect(r.years[1].passingRent).toBeCloseTo(103_000, 0);
    expect(y1.vacancyLoss).toBeCloseTo(5_250, 0);
    expect(y1.recoveredOutgoings).toBe(20_000);
    expect(y1.totalOwnerBorneExpenses).toBe(17_000);
    expect(y1.actualNoi).toBeCloseTo(102_750, 0);
    expect(y1.lenderAdjustedNoi).toBeCloseTo(99_667.5, 0);
    expect(y1.totalCapex).toBe(8_000);
    expect(y1.annualDebtService).toBe(45_000);
    /*
     * 21,083.33, not 29,416.67 — the fixture grants BOTH concessions.
     *
     *     actual NOI            102,750.00
     *     less capex             -8,000.00
     *     less debt service     -45,000.00
     *     less leasing costs    -28,666.67
     *     = pre-tax cashflow     21,083.33
     *
     * and the leasing costs are one month of downtime (8,333.33) + one month
     * of incentive (8,333.33) + the 10% leasing fee on passing rent (10,000) +
     * the reletting allowance (2,000).
     *
     * The old constant is what the engine returns when EITHER
     * `downtimeMonths` or `incentiveMonths` is zero — measured, both give
     * 29,416.67 — and this fixture sets both to 1. Charging both is the
     * coherent reading: they are separately named inputs describing different
     * concessions (a vacant period between tenants, and rent-free granted to
     * the incoming tenant), and a model that charged only one would leave the
     * other with no effect at all. The case below pins exactly that, which
     * nothing asserted.
     */
    expect(y1.preTaxCashflow).toBeCloseTo(21_083.33, 2);
    expect(y1.taxableIncome).toBeCloseTo(34_750, 0);
    expect(y1.taxPayableBenefit).toBeCloseTo(10_425, 0);
    // Carries the same 8,333.33 as the pre-tax figure above: tax is assessed
    // on `taxableIncome` (34,750, unchanged and asserted), so the second
    // concession moves the cashflow and not the tax.
    expect(y1.afterTaxCashflow).toBeCloseTo(10_658.33, 2);
    expect(y1.preTaxCashflow - y1.taxPayableBenefit).toBeCloseTo(y1.afterTaxCashflow, 2);
    expect(y1.closingLoanBalance).toBe(591_000);
    expect(y1.equityPosition).toBeCloseTo(429_000, 0);
    expect(y1.lvr).toBeCloseTo(0.5794, 3);
    expect(y1.icr).toBeCloseTo(2.854, 3);
    expect(y1.dscr).toBeCloseTo(2.283, 3);
    expect(y1.debtYield).toBeCloseTo(0.17125, 4);
    expect(r.years[9].terminalValue).toBeGreaterThan(1_000_000);
    expect(r.summary.equityMultiple).toBeGreaterThan(0);
    expect(r.summary.leveredIrr).not.toBeNull();
  });

  it('Owner-Occupier Mode calculates rent avoided, ownership cost, savings, Business DSCR, occupancy ratio and free cashflow; missing EBITDA is N/A', () => {
    const r = calculateTenYearCashFlow(baseInputs({ mode: 'ownerOccupier' }));
    const y1 = r.years[0];
    expect(y1.rentAvoided).toBe(90_000);
    expect(y1.outgoingsAvoided).toBe(10_000);
    expect(y1.ownershipCashCost).toBe(80_000);
    expect(y1.netSavingCostVsLeasing).toBe(20_000);
    /*
     * The working-capital requirement is retained before debt is serviced.
     *
     * These two constants — 160,000/75,000 and 68,000 — both omit the
     * fixture's `workingCapitalRequirement: 10_000`, and both are wrong by
     * exactly that. Measured by moving one input at a time:
     *
     *     denominator  75,000 = property debt service 45,000 + existing
     *                  business debt service 20,000 + equipment 5,000 +
     *                  vehicle 5,000            (matches the old expectation)
     *     numerator   150,000 = EBITDA 200,000 + addbacks 20,000
     *                           - director drawings 60,000
     *                           - working capital 10,000
     *
     * Cash a business must retain to trade is not cash available to service
     * debt, so deducting it is the conservative and the conventional read —
     * and the model that omits it leaves `workingCapitalRequirement` with no
     * effect on either figure it belongs to. The sensitivity is asserted below
     * rather than left implicit in a constant.
     */
    expect(y1.businessDscr).toBeCloseTo(150_000 / 75_000, 3);
    expect(y1.occupancyCostRatio).toBeCloseTo(0.08, 3);
    expect(y1.freeCashflowAfterOccupancy).toBeCloseTo(58_000, 0);

    const noWorkingCapital = calculateTenYearCashFlow(baseInputs({ mode: 'ownerOccupier', workingCapitalRequirement: 0 }));
    expect(noWorkingCapital.years[0].businessDscr).toBeCloseTo(160_000 / 75_000, 3);
    expect(noWorkingCapital.years[0].freeCashflowAfterOccupancy).toBeCloseTo(68_000, 0);
    expect(r.years[9].equityCreated).toBeGreaterThan(0);
    expect(r.summary.cumulativeOwnershipBenefit).toBeGreaterThan(0);
    const missing = calculateTenYearCashFlow(baseInputs({ mode: 'ownerOccupier', businessEbitda: null }));
    expect(missing.years[0].businessDscr).toBeNull();
    expect(missing.warnings.join(' ')).toContain('Business DSCR shown as N/A');
  });

  it('Related-Party Lease Mode calculates property entity, operating business and group views with internal rent neutralised', () => {
    const r = calculateTenYearCashFlow(baseInputs({ mode: 'relatedPartyLease' }));
    const y1 = r.years[0];
    expect(y1.propertyEntityCashflow).toBeCloseTo(50_000, 0);
    expect(y1.operatingBusinessOccupancyCost).toBe(120_000);
    expect(y1.groupCashflow).toBeCloseTo(30_000, 0);
    expect(y1.groupDscr).not.toBeNull();
    expect(r.years[9].cumulativeGroupBenefit).toBeGreaterThan(0);
  });

  it('Validation captures GST/tax, capex, terminal cap rate and manual override tags', () => {
    const r = calculateTenYearCashFlow(baseInputs({ annualCapexReserve: 0, terminalCapRatePct: 0, relatedPartyLeaseVerified: false }), ['rentGrowthPct']);
    expect(r.warnings.join(' ')).toContain('Terminal cap rate must be greater than 0');
    expect(r.warnings.join(' ')).toContain('Capex estimates are zero');
    expect(r.assumptions.rentGrowthPct.status).toBe('Overridden');
    expect(r.assumptions.terminalCapRatePct.status).toBe('AI Estimate');
    expect(r.assumptions.taxRatePct.status).toBe('Specialist Review Required');
  });
});

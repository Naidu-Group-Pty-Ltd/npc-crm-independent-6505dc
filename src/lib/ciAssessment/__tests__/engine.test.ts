import { describe, expect, it } from 'vitest';
import { toWholeDollars } from '../money';
import { calculateTransaction, resolveValuation } from '../transaction';
import { calculatePropertyIncome, calculateWale } from '../propertyIncome';
import { calculateBusinessIncome, debtToEbitda, isAddbackAssessable } from '../businessIncome';
import { calculatePortfolio, calculatePortfolioImpact, liabilityAnnualCommitment } from '../portfolio';
import { calculateServiceability } from '../serviceability';
import { classifyCompliance } from '../compliance';
import { resolvePolicy, assessmentRate } from '../policy';
import { runAssessment } from '../engine';
import { runScenarios } from '../scenarios';
import { validateAssessment } from '../validation';
import { AS_AT, addback, baseAssessment, liability, portfolioAsset, tenancy } from './fixtures';

const policy = () => resolvePolicy({ profileKey: 'mainstreamCommercialBank' });

// ---------------------------------------------------------------------------
// Transaction
// ---------------------------------------------------------------------------

describe('calculateTransaction', () => {
  it('sums total acquisition cost from price plus every acquisition line', () => {
    const result = calculateTransaction(baseAssessment());
    // 5,000,000 + 275,000 + 8,000 + 4,500 + 12,000 + 16,250 establishment
    expect(toWholeDollars(result.totalAcquisitionCostCents)).toBe(5_315_750);
  });

  it('adds works and contingency into total project cost', () => {
    const payload = baseAssessment();
    payload.property.fitOut = 120_000;
    payload.property.contingency = 30_000;
    const result = calculateTransaction(payload);
    expect(toWholeDollars(result.totalProjectCostCents)).toBe(5_465_750);
  });

  it('strikes LVR against the lower of price and valuation', () => {
    const payload = baseAssessment();
    payload.property.currentValuation = 4_600_000;
    const result = calculateTransaction(payload);
    expect(toWholeDollars(result.valuationUsedCents)).toBe(4_600_000);
    expect(result.proposedLvr).toBeCloseTo(3_250_000 / 4_600_000, 4);
  });

  it('uses the valuation alone on a refinance', () => {
    const payload = baseAssessment('refinance');
    payload.property.purchasePrice = 0;
    payload.property.currentValuation = 5_200_000;
    const { valuationCents } = resolveValuation(payload);
    expect(toWholeDollars(valuationCents)).toBe(5_200_000);
  });

  it('computes LTC against total project cost', () => {
    const result = calculateTransaction(baseAssessment());
    expect(result.proposedLtc).toBeCloseTo(3_250_000 / 5_315_750, 4);
  });

  it('reports a funding gap when loan plus contribution falls short', () => {
    const payload = baseAssessment();
    payload.property.depositOrContribution = 1_000_000;
    const result = calculateTransaction(payload);
    expect(toWholeDollars(result.fundingGapCents)).toBe(1_065_750);
    expect(result.fundingSurplusCents).toBe(0);
  });

  it('reports a surplus when the borrower over-funds', () => {
    const payload = baseAssessment();
    payload.property.depositOrContribution = 3_000_000;
    const result = calculateTransaction(payload);
    expect(result.fundingGapCents).toBe(0);
    expect(toWholeDollars(result.fundingSurplusCents)).toBe(934_250);
  });

  it('treats a full interest-only facility as balloon exposure', () => {
    const payload = baseAssessment();
    payload.loan.repaymentType = 'interestOnly';
    const result = calculateTransaction(payload);
    expect(toWholeDollars(result.balloonExposureCents)).toBe(3_250_000);
  });

  it('handles an all-zero payload without producing NaN', () => {
    const payload = baseAssessment();
    payload.property.purchasePrice = 0;
    payload.property.currentValuation = 0;
    payload.loan.requestedLoan = 0;
    payload.property.requestedLoanAmount = 0;
    const result = calculateTransaction(payload);
    expect(result.proposedLvr).toBe(0);
    expect(result.proposedLtc).toBe(0);
    expect(Number.isFinite(result.annualDebtServiceCents)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Property income
// ---------------------------------------------------------------------------

describe('calculatePropertyIncome', () => {
  const run = (payload = baseAssessment()) => {
    const transaction = calculateTransaction(payload);
    return calculatePropertyIncome(payload, transaction.valuationUsedCents, transaction.requestedLoanCents, AS_AT);
  };

  it('builds potential gross income from rent plus recoverable outgoings on a net lease', () => {
    expect(toWholeDollars(run().potentialGrossIncomeCents)).toBe(395_000);
  });

  it('excludes recoverable outgoings from income on a gross lease', () => {
    const payload = baseAssessment();
    payload.lease.leaseBasis = 'gross';
    const result = run(payload);
    expect(toWholeDollars(result.potentialGrossIncomeCents)).toBe(350_000);
    expect(result.notes.some((note) => note.includes('gross basis'))).toBe(true);
  });

  it('deducts vacancy from potential gross income', () => {
    // 395,000 × 3% = 11,850
    expect(toWholeDollars(run().vacancyAllowanceCents)).toBe(11_850);
    expect(toWholeDollars(run().effectiveGrossIncomeCents)).toBe(383_150);
  });

  it('amortises a rent-free period across year one', () => {
    const payload = baseAssessment();
    payload.lease.rentFreeMonths = 3;
    const result = run(payload);
    expect(toWholeDollars(result.incentiveAllowanceCents)).toBe(87_500);
  });

  it('nets operating expenses to reach NOI', () => {
    const result = run();
    // EGI 383,150 − (12,000 non-recoverable + 2% management 7,663 + 45,000 recoverable)
    expect(toWholeDollars(result.totalOperatingExpensesCents)).toBe(64_663);
    expect(toWholeDollars(result.netOperatingIncomeCents)).toBe(318_487);
  });

  it('derives net yield, cap rate and debt yield from NOI', () => {
    const result = run();
    expect(result.netYield).toBeCloseTo(318_487 / 5_000_000, 3);
    expect(result.capitalisationRate).toBe(result.netYield);
    expect(result.debtYield).toBeCloseTo(318_487 / 3_250_000, 3);
  });

  it('computes break-even occupancy from expenses over potential gross income', () => {
    expect(run().breakEvenOccupancy).toBeCloseTo(64_663 / 395_000, 3);
  });

  it('flags a negative NOI rather than hiding it', () => {
    const payload = baseAssessment();
    payload.lease.nonRecoverableOutgoings = 500_000;
    const result = run(payload);
    expect(result.netOperatingIncomeCents).toBeLessThan(0);
    expect(result.notes.some((note) => note.includes('negative'))).toBe(true);
  });

  it('returns zeroes for an asset with no tenancies', () => {
    const payload = baseAssessment();
    payload.lease.tenancies = [];
    payload.lease.recoverableOutgoings = 0;
    payload.lease.nonRecoverableOutgoings = 0;
    const result = run(payload);
    expect(result.netOperatingIncomeCents).toBe(0);
    expect(result.debtYield).toBe(0);
  });

  it('measures tenant concentration and single-tenant risk', () => {
    const single = run();
    expect(single.tenantConcentration).toBe(1);
    expect(single.notes.some((note) => note.includes('Single-tenant'))).toBe(true);

    const payload = baseAssessment();
    payload.lease.tenancies = [
      tenancy({ id: 't1', annualRent: 200_000 }),
      tenancy({ id: 't2', tenantName: 'Second Tenant', annualRent: 150_000 }),
    ];
    expect(run(payload).tenantConcentration).toBeCloseTo(200_000 / 350_000, 3);
  });

  it('flags rent materially above market', () => {
    const payload = baseAssessment();
    payload.lease.marketRentAnnual = 280_000;
    expect(run(payload).notes.some((note) => note.includes('above the stated market rent'))).toBe(true);
  });
});

describe('calculateWale', () => {
  it('weights expiry by income, not area', () => {
    const result = calculateWale([
      tenancy({ id: 'a', annualRent: 100_000, leaseExpiry: '2028-08-03' }),
      tenancy({ id: 'b', annualRent: 300_000, leaseExpiry: '2032-08-03' }),
    ], AS_AT);
    // (2×0.25 + 6×0.75) = 5.0 years
    expect(result).toBeCloseTo(5, 1);
  });

  it('returns zero when no tenancy carries an expiry', () => {
    expect(calculateWale([tenancy({ leaseExpiry: '' })], AS_AT)).toBe(0);
    expect(calculateWale([], AS_AT)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Business income and add-backs
// ---------------------------------------------------------------------------

describe('calculateBusinessIncome', () => {
  it('adds confirmed add-backs to reported EBITDA', () => {
    const result = calculateBusinessIncome(baseAssessment(), policy());
    expect(toWholeDollars(result.adjustedEbitdaCents)).toBe(665_000);
    expect(toWholeDollars(result.confirmedAddbacksCents)).toBe(45_000);
  });

  it('refuses an unconfirmed add-back', () => {
    const payload = baseAssessment();
    payload.income.addbacks = [addback({ confirmed: false })];
    const result = calculateBusinessIncome(payload, policy());
    expect(toWholeDollars(result.adjustedEbitdaCents)).toBe(620_000);
    expect(toWholeDollars(result.proposedAddbacksCents)).toBe(45_000);
  });

  it('refuses a confirmed add-back that is missing a reason or source', () => {
    expect(isAddbackAssessable(addback({ reason: '' }))).toBe(false);
    expect(isAddbackAssessable(addback({ source: '  ' }))).toBe(false);
    expect(isAddbackAssessable(addback({ amount: 0 }))).toBe(false);
    expect(isAddbackAssessable(addback())).toBe(true);
  });

  it('rebuilds EBITDA from NPAT when it has not been supplied', () => {
    const payload = baseAssessment();
    payload.income.periods = [{ ...payload.income.periods[0], ebitda: 0 }];
    payload.income.addbacks = [];
    const result = calculateBusinessIncome(payload, policy());
    // 380,000 NPAT + 95,000 interest + 80,000 depreciation
    expect(toWholeDollars(result.adjustedEbitdaCents)).toBe(555_000);
  });

  it('shades non-recurring income to nothing under default policy', () => {
    const payload = baseAssessment();
    payload.income.periods = [{ ...payload.income.periods[0], nonRecurringIncome: 200_000 }];
    const result = calculateBusinessIncome(payload, policy());
    expect(result.periods[0].nonRecurringIncomeCents).toBe(0);
  });

  it('weights multiple periods towards the most recent', () => {
    const payload = baseAssessment();
    payload.income.addbacks = [];
    payload.income.periods = [
      { ...payload.income.periods[0], id: 'p2025', periodEnd: '2025-06-30', ebitda: 600_000 },
      { ...payload.income.periods[0], id: 'p2024', periodEnd: '2024-06-30', ebitda: 300_000 },
    ];
    const result = calculateBusinessIncome(payload, policy());
    // (600k×3 + 300k×2) / 5 = 480k
    expect(toWholeDollars(result.assessableBusinessIncomeCents)).toBe(480_000);
  });

  it('honours the lowest-period selection basis', () => {
    const payload = baseAssessment();
    payload.income.addbacks = [];
    payload.income.assessableIncomeBasis = 'lowest';
    payload.income.periods = [
      { ...payload.income.periods[0], id: 'p2025', periodEnd: '2025-06-30', ebitda: 600_000 },
      { ...payload.income.periods[0], id: 'p2024', periodEnd: '2024-06-30', ebitda: 300_000 },
    ];
    const result = calculateBusinessIncome(payload, policy());
    expect(toWholeDollars(result.assessableBusinessIncomeCents)).toBe(300_000);
  });

  it('flags declining earnings', () => {
    const payload = baseAssessment();
    payload.income.addbacks = [];
    payload.income.periods = [
      { ...payload.income.periods[0], id: 'p2025', periodEnd: '2025-06-30', ebitda: 400_000 },
      { ...payload.income.periods[0], id: 'p2024', periodEnd: '2024-06-30', ebitda: 600_000 },
    ];
    const result = calculateBusinessIncome(payload, policy());
    expect(result.decliningIncome).toBe(true);
    expect(result.varianceWarnings.length).toBeGreaterThan(0);
  });

  it('returns zeroes when no periods are supplied', () => {
    const payload = baseAssessment();
    payload.income.periods = [];
    payload.income.addbacks = [];
    const result = calculateBusinessIncome(payload, policy());
    expect(result.totalAssessableIncomeCents).toBe(0);
    expect(result.verificationStatus).toBe('unverified');
  });
});

describe('debtToEbitda', () => {
  it('returns leverage where EBITDA is positive', () => {
    expect(debtToEbitda(1_000_000, 250_000)).toBe(4);
  });

  it('returns null rather than Infinity where EBITDA is zero or negative', () => {
    expect(debtToEbitda(1_000_000, 0)).toBeNull();
    expect(debtToEbitda(1_000_000, -50)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Portfolio
// ---------------------------------------------------------------------------

describe('calculatePortfolio', () => {
  it('nets property income after vacancy and operating costs', () => {
    const result = calculatePortfolio(baseAssessment(), policy());
    // 210,000 rent − (20k + 6k + 12k + 5k + 8k) = 159,000
    expect(toWholeDollars(result.assets[0].netPropertyIncomeCents)).toBe(159_000);
  });

  it('applies the ownership share to value, debt and income', () => {
    const payload = baseAssessment();
    payload.portfolio.assets = [portfolioAsset({ ownershipPercent: 50 })];
    const result = calculatePortfolio(payload, policy());
    expect(toWholeDollars(result.assets[0].valueCents)).toBe(1_500_000);
    expect(toWholeDollars(result.assets[0].debtCents)).toBe(750_000);
  });

  it('prefers a supplied repayment figure over a derived one', () => {
    const payload = baseAssessment();
    payload.portfolio.assets = [portfolioAsset({ annualRepayments: 111_111 })];
    const result = calculatePortfolio(payload, policy());
    expect(toWholeDollars(result.assets[0].annualDebtServiceCents)).toBe(111_111);
  });

  it('does not double-count a liability already secured against an asset', () => {
    const payload = baseAssessment();
    payload.portfolio.liabilities = [liability({ securedAgainstAssetId: 'asset-1', balance: 1_500_000 })];
    const result = calculatePortfolio(payload, policy());
    expect(result.excludedLiabilities).toHaveLength(1);
    expect(toWholeDollars(result.current.totalDebtCents)).toBe(1_500_000);
  });

  it('assesses a credit card on its limit, not its balance', () => {
    const card = liability({
      liabilityType: 'credit_card', balance: 0, limit: 50_000,
      annualRepayments: null, interestRate: 0,
    });
    // 3.8% monthly minimum × 12 = $22,800 a year on a $50k limit.
    expect(toWholeDollars(liabilityAnnualCommitment(card, policy()))).toBe(22_800);
  });

  it('excludes contingent liabilities from servicing but still discloses them', () => {
    const payload = baseAssessment();
    payload.portfolio.liabilities = [liability({ liabilityType: 'guarantee', isContingent: true, balance: 400_000 })];
    const result = calculatePortfolio(payload, policy());
    expect(toWholeDollars(result.contingentLiabilitiesCents)).toBe(400_000);
    expect(result.warnings.some((warning) => warning.includes('Contingent'))).toBe(true);
  });

  it('counts related-entity debt at the configured share', () => {
    const payload = baseAssessment();
    payload.portfolio.relatedEntityDebtSharePercent = 50;
    const result = calculatePortfolio(payload, policy());
    // Asset debt is unshared; the standalone liability halves.
    expect(toWholeDollars(result.current.totalDebtCents)).toBe(1_590_000);
  });

  it('reports concentration when one asset dominates', () => {
    const payload = baseAssessment();
    payload.portfolio.assets = [
      portfolioAsset({ id: 'a1', currentValue: 9_000_000 }),
      portfolioAsset({ id: 'a2', address: 'Other', currentValue: 1_000_000 }),
    ];
    const result = calculatePortfolio(payload, policy());
    expect(result.largestAssetShare).toBeCloseTo(0.9, 2);
    expect(result.warnings.some((warning) => warning.includes('single asset'))).toBe(true);
  });

  it('handles an entirely empty portfolio', () => {
    const payload = baseAssessment();
    payload.portfolio.assets = [];
    payload.portfolio.liabilities = [];
    const result = calculatePortfolio(payload, policy());
    expect(result.current.totalDebtCents).toBe(0);
    expect(result.current.lvr).toBe(0);
    expect(result.current.dscr).toBe(0);
  });
});

describe('calculatePortfolioImpact', () => {
  it('reports the post-transaction position and the delta', () => {
    const payload = baseAssessment();
    const portfolio = calculatePortfolio(payload, policy());
    const transaction = calculateTransaction(payload);
    const income = calculatePropertyIncome(payload, transaction.valuationUsedCents, transaction.requestedLoanCents, AS_AT);
    const impact = calculatePortfolioImpact({
      portfolio,
      proposedValueCents: transaction.valuationUsedCents,
      proposedDebtCents: transaction.requestedLoanCents,
      proposedNetIncomeCents: income.netOperatingIncomeCents,
      proposedGrossIncomeCents: income.potentialGrossIncomeCents,
      proposedDebtServiceCents: transaction.annualDebtServiceCents,
      proposedRatePct: payload.loan.actualRatePercent,
    });

    expect(toWholeDollars(impact.proposed.totalValueCents)).toBe(8_000_000);
    expect(toWholeDollars(impact.proposed.totalDebtCents)).toBe(4_930_000);
    expect(impact.proposed.lvr).toBeGreaterThan(impact.current.lvr);
    expect(impact.deltaLvr).toBeGreaterThan(0);
  });

  it('classifies a deal that raises leverage and cuts cash as weakening', () => {
    const payload = baseAssessment();
    payload.lease.tenancies = [tenancy({ annualRent: 50_000 })];
    const portfolio = calculatePortfolio(payload, policy());
    const transaction = calculateTransaction(payload);
    const income = calculatePropertyIncome(payload, transaction.valuationUsedCents, transaction.requestedLoanCents, AS_AT);
    const impact = calculatePortfolioImpact({
      portfolio,
      proposedValueCents: transaction.valuationUsedCents,
      proposedDebtCents: transaction.requestedLoanCents,
      proposedNetIncomeCents: income.netOperatingIncomeCents,
      proposedGrossIncomeCents: income.potentialGrossIncomeCents,
      proposedDebtServiceCents: transaction.annualDebtServiceCents,
      proposedRatePct: payload.loan.actualRatePercent,
    });
    expect(impact.direction).toBe('weakens');
    expect(impact.deltaAnnualCashFlowCents).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
// Policy and serviceability
// ---------------------------------------------------------------------------

describe('resolvePolicy', () => {
  it('layers lender profile over platform defaults', () => {
    const resolved = resolvePolicy({ profileKey: 'conservativeBank' });
    expect(resolved.maxLvr).toBe(0.6);
    expect(resolved.minDscr).toBe(1.35);
    expect(resolved.layers.map((layer) => layer.layer)).toContain('lender_profile');
  });

  it('lets a scenario override beat the profile', () => {
    const resolved = resolvePolicy({
      profileKey: 'conservativeBank',
      overrides: { maxLvr: 0.5, minDscr: 1.5 },
    });
    expect(resolved.maxLvr).toBe(0.5);
    expect(resolved.minDscr).toBe(1.5);
    expect(resolved.layers.some((layer) => layer.layer === 'scenario_override')).toBe(true);
  });

  it('never lets the hard ceiling fall below the soft ceiling', () => {
    const resolved = resolvePolicy({ profileKey: 'custom', overrides: { maxLvr: 0.8, hardMaxLvr: 0.6 } });
    expect(resolved.hardMaxLvr).toBeGreaterThanOrEqual(resolved.maxLvr);
  });

  it('forces specialist review for SMSF and private credit profiles', () => {
    expect(resolvePolicy({ profileKey: 'smsfCommercial' }).requiresSpecialistReview).toBe(true);
    expect(resolvePolicy({ profileKey: 'mainstreamCommercialBank' }).requiresSpecialistReview).toBe(false);
  });

  it('records the policy and engine version on the resolved set', () => {
    const resolved = resolvePolicy({ profileKey: 'mainstreamCommercialBank' });
    expect(resolved.policyVersion).toMatch(/^\d{4}\./);
    expect(resolved.engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('assessmentRate', () => {
  it('takes contract plus buffer when it beats the floor', () => {
    const result = assessmentRate({ contractRatePct: 8, policy: resolvePolicy({ profileKey: 'mainstreamCommercialBank' }) });
    expect(result.assessmentRatePct).toBe(9);
  });

  it('takes the floor when it beats contract plus buffer', () => {
    const result = assessmentRate({ contractRatePct: 4, policy: resolvePolicy({ profileKey: 'conservativeBank' }) });
    expect(result.assessmentRatePct).toBe(8);
    expect(result.basis).toContain('floor');
  });

  it('honours a manual override above everything else', () => {
    const result = assessmentRate({
      contractRatePct: 4,
      policy: resolvePolicy({ profileKey: 'conservativeBank' }),
      rateOverridePct: 10.5,
    });
    expect(result.assessmentRatePct).toBe(10.5);
  });
});

describe('calculateServiceability', () => {
  const run = (payload = baseAssessment()) => {
    const resolvedPolicy = resolvePolicy({
      profileKey: payload.loan.lenderPolicyProfile,
      overrides: payload.loan.policyOverrides,
    });
    const transaction = calculateTransaction(payload);
    const propertyIncome = calculatePropertyIncome(payload, transaction.valuationUsedCents, transaction.requestedLoanCents, AS_AT);
    const businessIncome = calculateBusinessIncome(payload, resolvedPolicy);
    const portfolio = calculatePortfolio(payload, resolvedPolicy);
    return calculateServiceability({ payload, policy: resolvedPolicy, transaction, propertyIncome, businessIncome, portfolio });
  };

  it('produces a maximum bound by the smallest applicable cap', () => {
    const result = run();
    const applied = result.caps.filter((cap) => cap.applied);
    const smallest = Math.min(...applied.map((cap) => cap.capCents));
    expect(result.maximumIndicativeLoanCents).toBe(smallest);
    expect(result.bindingConstraint).not.toBe('none');
  });

  it('marks exactly the binding cap', () => {
    const result = run();
    const binding = result.caps.filter((cap) => cap.binding);
    expect(binding).toHaveLength(1);
    expect(binding[0].key).toBe(result.bindingConstraint);
  });

  it('lets LVR bind when the valuation is the scarce resource', () => {
    const payload = baseAssessment();
    payload.property.currentValuation = 3_500_000;
    payload.lease.tenancies = [tenancy({ annualRent: 900_000 })];
    expect(run(payload).bindingConstraint).toBe('lvr');
  });

  it('lets a coverage test bind when income is the scarce resource', () => {
    const payload = baseAssessment();
    payload.lease.tenancies = [tenancy({ annualRent: 120_000 })];
    const result = run(payload);
    expect(['dscr', 'icr', 'debt_yield', 'global_servicing']).toContain(result.bindingConstraint);
  });

  it('raises the assessment rate above the contract rate', () => {
    const result = run();
    expect(result.assessmentRatePct).toBeGreaterThan(baseAssessment().loan.actualRatePercent);
  });

  it('includes existing commitments in global debt service', () => {
    const result = run();
    expect(result.existingDebtCommitmentsCents).toBeGreaterThan(0);
    expect(result.globalAnnualDebtServiceCents)
      .toBe(result.existingDebtCommitmentsCents + result.proposedDebtCommitmentCents);
  });

  it('reports a negative sensitised surplus before a negative base surplus', () => {
    const result = run();
    expect(result.sensitisedSurplusCents).toBeLessThan(result.surplusAfterDebtServiceCents);
  });

  it('warns when the requested facility exceeds capacity', () => {
    const payload = baseAssessment();
    payload.loan.requestedLoan = 9_000_000;
    const result = run(payload);
    expect(result.headroomCents).toBeLessThan(0);
    expect(result.warnings.some((warning) => warning.includes('exceeds the maximum'))).toBe(true);
  });

  it('produces no capacity and a clear warning when nothing can be tested', () => {
    const payload = baseAssessment();
    payload.property.purchasePrice = 0;
    payload.property.currentValuation = 0;
    payload.property.stampDuty = 0;
    payload.property.legalCosts = 0;
    payload.property.valuationCosts = 0;
    payload.property.lenderFees = 0;
    payload.loan.establishmentFees = 0;
    payload.lease.tenancies = [];
    payload.income.periods = [];
    payload.income.addbacks = [];
    payload.portfolio.assets = [];
    payload.portfolio.liabilities = [];
    const result = run(payload);
    expect(result.maximumIndicativeLoanCents).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Compliance
// ---------------------------------------------------------------------------

describe('classifyCompliance', () => {
  it('classifies a company borrower on a commercial asset as business purpose', () => {
    const result = classifyCompliance(baseAssessment());
    expect(result.classification).toBe('business_purpose');
    expect(result.requiresComplianceReview).toBe(false);
  });

  it('does NOT assume a commercial label means unregulated', () => {
    const payload = baseAssessment();
    payload.ownership.naturalPersonBorrower = true;
    payload.ownership.residentialSecurityInvolved = true;
    payload.ownership.purposeIsPredominantlyBusiness = null;
    const result = classifyCompliance(payload);
    expect(result.classification).toBe('possible_consumer_credit');
    expect(result.requiresSpecialistReview).toBe(true);
    expect(result.flags.some((flag) => flag.code === 'NATURAL_PERSON_RESIDENTIAL')).toBe(true);
  });

  it('escalates a declared non-business purpose with a blocking flag', () => {
    const payload = baseAssessment();
    payload.ownership.purposeIsPredominantlyBusiness = false;
    const result = classifyCompliance(payload);
    expect(result.classification).toBe('possible_consumer_credit');
    expect(result.flags.some((flag) => flag.severity === 'block')).toBe(true);
  });

  it('detects mixed personal and business purpose language', () => {
    const payload = baseAssessment();
    payload.ownership.borrowingPurpose = 'Purchase business premises and renovate our home.';
    expect(classifyCompliance(payload).classification).toBe('mixed_purpose');
  });

  it('routes SMSF and development transactions to specialist review', () => {
    const smsf = baseAssessment();
    smsf.ownership.entities = [{ ...smsf.ownership.entities[0], structure: 'smsf' }];
    expect(classifyCompliance(smsf).requiresSpecialistReview).toBe(true);

    const development = baseAssessment('development_construction');
    expect(classifyCompliance(development).requiresSpecialistReview).toBe(true);
  });

  it('reports insufficient information when no borrower or purpose is recorded', () => {
    const payload = baseAssessment();
    payload.ownership.entities = [];
    payload.ownership.borrowingPurpose = '';
    payload.ownership.purposeIsPredominantlyBusiness = null;
    expect(classifyCompliance(payload).classification).toBe('insufficient_information');
  });

  it('flags a foreign resident party', () => {
    const payload = baseAssessment();
    payload.ownership.entities = [{ ...payload.ownership.entities[0], residency: 'foreign' }];
    expect(classifyCompliance(payload).flags.some((flag) => flag.code === 'FOREIGN_PARTY')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

describe('runAssessment', () => {
  it('is deterministic for the same payload and clock', () => {
    const payload = baseAssessment();
    const first = runAssessment(payload, { asAt: AS_AT });
    const second = runAssessment(payload, { asAt: AS_AT });
    expect(second.summary).toEqual(first.summary);
    expect(second.serviceability.bindingConstraint).toBe(first.serviceability.bindingConstraint);
  });

  it('stamps the engine and policy version on every result', () => {
    const result = runAssessment(baseAssessment(), { asAt: AS_AT });
    expect(result.engineVersion).toBeTruthy();
    expect(result.policyVersion).toBeTruthy();
    expect(result.policy.profileKey).toBe('mainstreamCommercialBank');
  });

  it('never uses approval language in its outcome labels', () => {
    const result = runAssessment(baseAssessment(), { asAt: AS_AT });
    expect(result.outcomeLabel.toLowerCase()).not.toContain('approv');
    expect(result.disclaimer.toLowerCase()).toContain('not a credit approval');
  });

  it('reports insufficient information when a blocking field is absent', () => {
    const payload = baseAssessment();
    payload.property.purchasePrice = 0;
    payload.property.currentValuation = 0;
    const result = runAssessment(payload, { asAt: AS_AT });
    expect(result.outcome).toBe('insufficient_information');
  });

  it('reports outside current assumptions when the ask exceeds capacity', () => {
    const payload = baseAssessment();
    payload.loan.requestedLoan = 12_000_000;
    const result = runAssessment(payload, { asAt: AS_AT });
    expect(result.outcome).toBe('outside_current_assumptions');
  });

  it('routes a possible consumer-credit transaction to specialist review', () => {
    const payload = baseAssessment();
    payload.ownership.purposeIsPredominantlyBusiness = false;
    const result = runAssessment(payload, { asAt: AS_AT });
    expect(result.outcome).toBe('requires_specialist_review');
  });

  it('builds an explain trace covering every calculation group', () => {
    const result = runAssessment(baseAssessment(), { asAt: AS_AT });
    const groups = new Set(result.explain.map((step) => step.group));
    expect(groups).toContain('Transaction');
    expect(groups).toContain('Property income');
    expect(groups).toContain('Servicing');
    expect(groups).toContain('Portfolio impact');
    expect(groups).toContain('Capacity caps');
    result.explain.forEach((step) => {
      expect(step.formula.length).toBeGreaterThan(0);
      expect(step.value.length).toBeGreaterThan(0);
    });
  });

  it('de-duplicates warnings rather than repeating the same message', () => {
    const result = runAssessment(baseAssessment(), { asAt: AS_AT });
    const messages = result.warnings.map((warning) => `${warning.category}:${warning.message}`);
    expect(new Set(messages).size).toBe(messages.length);
  });

  it('always offers at least one next action', () => {
    expect(runAssessment(baseAssessment(), { asAt: AS_AT }).nextActions.length).toBeGreaterThan(0);
  });

  it('survives a completely empty payload without throwing', () => {
    const payload = baseAssessment();
    payload.property.purchasePrice = 0;
    payload.property.currentValuation = 0;
    payload.lease.tenancies = [];
    payload.income.periods = [];
    payload.income.addbacks = [];
    payload.portfolio.assets = [];
    payload.portfolio.liabilities = [];
    payload.ownership.entities = [];
    expect(() => runAssessment(payload, { asAt: AS_AT })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

describe('runScenarios', () => {
  it('always returns the base case first with zero deltas', () => {
    const outcomes = runScenarios(baseAssessment(), ['higher_rate'], { asAt: AS_AT });
    expect(outcomes[0].key).toBe('base');
    expect(outcomes[0].comparison.deltaMaximumLoan).toBe(0);
    expect(outcomes[0].comparison.deltaDscr).toBe(0);
  });

  it('names the single assumption that changed', () => {
    const outcomes = runScenarios(baseAssessment(), ['higher_rate', 'vacancy'], { asAt: AS_AT });
    expect(outcomes[1].changedAssumption).toContain('interest rate');
    expect(outcomes[2].changedAssumption).toContain('Vacancy');
  });

  it('reduces capacity under a rate rise', () => {
    const outcomes = runScenarios(baseAssessment(), ['higher_rate'], { asAt: AS_AT });
    expect(outcomes[1].comparison.deltaMaximumLoan).toBeLessThan(0);
  });

  it('reduces capacity under a rent reduction', () => {
    const outcomes = runScenarios(baseAssessment(), ['lower_rent'], { asAt: AS_AT });
    expect(outcomes[1].comparison.maximumIndicativeLoan)
      .toBeLessThanOrEqual(outcomes[0].comparison.maximumIndicativeLoan);
  });

  it('lifts LVR when the valuation is cut', () => {
    const outcomes = runScenarios(baseAssessment(), ['valuation_reduction'], { asAt: AS_AT });
    expect(outcomes[1].comparison.lvr).toBeGreaterThan(outcomes[0].comparison.lvr);
  });

  it('makes interest-only cheaper to service than principal and interest', () => {
    const outcomes = runScenarios(baseAssessment(), ['interest_only', 'principal_and_interest'], { asAt: AS_AT });
    const io = outcomes.find((outcome) => outcome.key === 'interest_only');
    const pi = outcomes.find((outcome) => outcome.key === 'principal_and_interest');
    expect(io?.comparison.annualDebtService).toBeLessThan(pi?.comparison.annualDebtService ?? 0);
  });

  it('does not mutate the payload it was given', () => {
    const payload = baseAssessment();
    const before = JSON.stringify(payload);
    runScenarios(payload, ['higher_rate', 'lower_rent', 'vacancy'], { asAt: AS_AT });
    expect(JSON.stringify(payload)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe('validateAssessment', () => {
  it('passes a well-formed assessment', () => {
    const result = validateAssessment(baseAssessment());
    expect(result.ok).toBe(true);
  });

  it('rejects ownership percentages that do not total 100', () => {
    const payload = baseAssessment();
    payload.ownership.entities = [{ ...payload.ownership.entities[0], ownershipPercent: 60 }];
    const result = validateAssessment(payload);
    expect(result.ok).toBe(false);
    expect(result.errors.some((issue) => issue.field === 'ownership.entities')).toBe(true);
  });

  it('rejects a settlement date before the contract date', () => {
    const payload = baseAssessment();
    payload.property.settlementDate = '2026-06-01';
    expect(validateAssessment(payload).ok).toBe(false);
  });

  it('rejects a lease expiry before its commencement', () => {
    const payload = baseAssessment();
    payload.lease.tenancies = [tenancy({ leaseCommencement: '2030-01-01', leaseExpiry: '2028-01-01' })];
    expect(validateAssessment(payload).ok).toBe(false);
  });

  it('rejects a confirmed add-back with no reason', () => {
    const payload = baseAssessment();
    payload.income.addbacks = [addback({ reason: '' })];
    expect(validateAssessment(payload).ok).toBe(false);
  });

  it('rejects an interest-only period longer than the loan term', () => {
    const payload = baseAssessment();
    payload.loan.interestOnlyPeriodYears = 20;
    payload.loan.loanTermYears = 15;
    expect(validateAssessment(payload).ok).toBe(false);
  });

  it('warns without blocking on a duplicate portfolio address', () => {
    const payload = baseAssessment();
    payload.portfolio.assets = [portfolioAsset({ id: 'a1' }), portfolioAsset({ id: 'a2' })];
    const result = validateAssessment(payload);
    expect(result.ok).toBe(true);
    expect(result.warnings.some((issue) => issue.message.includes('Duplicate address'))).toBe(true);
  });

  it('warns without blocking on a stale valuation', () => {
    const payload = baseAssessment();
    payload.property.valuationDate = '2020-01-01';
    const result = validateAssessment(payload);
    expect(result.ok).toBe(true);
    expect(result.warnings.some((issue) => issue.field === 'property.valuationDate')).toBe(true);
  });

  it('rejects a residual that equals or exceeds the facility', () => {
    const payload = baseAssessment();
    payload.loan.residualBalloonAmount = 3_250_000;
    expect(validateAssessment(payload).ok).toBe(false);
  });
});

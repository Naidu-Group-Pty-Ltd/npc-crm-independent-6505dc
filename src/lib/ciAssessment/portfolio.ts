/**
 * Existing portfolio and commitments.
 *
 * Produces the borrower's position *before* the proposed transaction, and the
 * position *after* it, so the results screen can show the delta rather than a
 * standalone number that tells nobody whether the deal helps or hurts.
 *
 * Double-counting is guarded in two places:
 *  - a liability flagged as secured against a portfolio asset is not counted
 *    again (the asset row already carries its loan); and
 *  - debt held across related entities is counted at the configured share.
 */

import {
  annualDebtServiceCents,
  centsOf,
  multiplyCents,
  percentOfCents,
  ratio,
  roundRatio,
  safePercent,
  sumCents,
  type Cents,
} from './money';
import type { ResolvedPolicy } from './policy';
import { shadeRent } from './businessIncome';
import type { AssessmentPayload, Liability, PortfolioAsset } from './types';

export interface PortfolioAssetAnalysis {
  id: string;
  address: string;
  assetType: PortfolioAsset['assetType'];
  ownershipShare: number;
  valueCents: Cents;
  debtCents: Cents;
  equityCents: Cents;
  lvr: number;
  grossRentCents: Cents;
  operatingCostsCents: Cents;
  netPropertyIncomeCents: Cents;
  annualDebtServiceCents: Cents;
  netCashFlowCents: Cents;
  crossCollateralised: boolean;
}

export interface PortfolioPosition {
  totalValueCents: Cents;
  totalDebtCents: Cents;
  totalLimitCents: Cents;
  netEquityCents: Cents;
  lvr: number;
  weightedAverageRatePct: number;
  grossIncomeCents: Cents;
  netIncomeCents: Cents;
  annualDebtServiceCents: Cents;
  dscr: number;
  netCashFlowCents: Cents;
}

export interface PortfolioResult {
  assets: PortfolioAssetAnalysis[];
  current: PortfolioPosition;
  /** Existing commitments only — the servicing load before the new facility. */
  existingCommitmentsCents: Cents;
  contingentLiabilitiesCents: Cents;
  undrawnLimitsCents: Cents;
  /** Rental income after policy shading, available to service debt. */
  shadedRentalIncomeCents: Cents;

  propertyConcentration: number;
  largestAssetShare: number;
  crossCollateralisedShare: number;

  excludedLiabilities: Array<{ id: string; description: string; reason: string }>;
  warnings: string[];
}

export interface PortfolioImpact {
  current: PortfolioPosition;
  proposed: PortfolioPosition;
  deltaValueCents: Cents;
  deltaDebtCents: Cents;
  deltaLvr: number;
  deltaAnnualDebtServiceCents: Cents;
  deltaMonthlyCashFlowCents: Cents;
  deltaAnnualCashFlowCents: Cents;
  deltaDscr: number;
  direction: 'improves' | 'weakens' | 'mixed' | 'unchanged';
}

/** Ownership percentage as a fraction, defaulting to 100% when unset. */
function ownershipShare(percent: number): number {
  if (!Number.isFinite(percent) || percent <= 0) return 1;
  return Math.min(1, percent / 100);
}

function analyseAsset(asset: PortfolioAsset): PortfolioAssetAnalysis {
  const share = ownershipShare(asset.ownershipPercent);

  const valueCents = multiplyCents(centsOf(asset.currentValue), share);
  const debtCents = multiplyCents(centsOf(asset.currentBalance), share);

  const grossRentCents = multiplyCents(centsOf(asset.annualRent), share);
  const vacancyCents = percentOfCents(grossRentCents, safePercent(asset.vacancyPercent));
  const operatingCostsCents = multiplyCents(
    sumCents(
      centsOf(asset.outgoings), centsOf(asset.managementCosts), centsOf(asset.rates),
      centsOf(asset.insurance), centsOf(asset.maintenance), centsOf(asset.capitalExpenditure),
    ),
    share,
  );
  const netPropertyIncomeCents = grossRentCents - vacancyCents - operatingCostsCents;

  // A supplied repayment figure is authoritative — it is what the borrower
  // actually pays. Otherwise derive it from balance, rate and term.
  const debtServiceCents = asset.annualRepayments != null && asset.annualRepayments > 0
    ? multiplyCents(centsOf(asset.annualRepayments), share)
    : annualDebtServiceCents({
      principalCents: debtCents,
      ratePct: asset.interestRate,
      repaymentType: asset.repaymentType,
      amortisationYears: asset.remainingTermYears,
    });

  return {
    id: asset.id,
    address: asset.address,
    assetType: asset.assetType,
    ownershipShare: share,
    valueCents,
    debtCents,
    equityCents: valueCents - debtCents,
    lvr: ratio(debtCents, valueCents),
    grossRentCents,
    operatingCostsCents: operatingCostsCents + vacancyCents,
    netPropertyIncomeCents,
    annualDebtServiceCents: debtServiceCents,
    netCashFlowCents: netPropertyIncomeCents - debtServiceCents,
    crossCollateralised: asset.crossCollateralised,
  };
}

/**
 * Annual servicing cost of a standalone liability under policy.
 * Revolving facilities are assessed on their *limit*, not their balance —
 * an undrawn card can be drawn tomorrow.
 */
export function liabilityAnnualCommitment(liability: Liability, policy: ResolvedPolicy): Cents {
  if (liability.isContingent) return 0;

  const isRevolving = liability.liabilityType === 'credit_card'
    || liability.liabilityType === 'overdraft'
    || liability.liabilityType === 'line_of_credit';

  if (isRevolving) {
    const assessedBase = policy.undrawnLimitAssessed
      ? Math.max(centsOf(liability.limit), centsOf(liability.balance))
      : centsOf(liability.balance);
    // The policy percentage is the monthly minimum-payment convention, so the
    // annual commitment is twelve of them.
    return percentOfCents(assessedBase, policy.creditCardAssessmentPct) * 12;
  }

  if (liability.annualRepayments != null && liability.annualRepayments > 0) {
    return centsOf(liability.annualRepayments);
  }

  return annualDebtServiceCents({
    principalCents: centsOf(liability.balance),
    ratePct: liability.interestRate,
    repaymentType: liability.repaymentType,
    amortisationYears: liability.remainingTermYears,
  });
}

export function calculatePortfolio(payload: AssessmentPayload, policy: ResolvedPolicy): PortfolioResult {
  const warnings: string[] = [];
  const excludedLiabilities: PortfolioResult['excludedLiabilities'] = [];

  const assets = payload.portfolio.assets.map(analyseAsset);
  const assetIds = new Set(assets.map((asset) => asset.id));

  const relatedShare = ownershipShare(payload.portfolio.relatedEntityDebtSharePercent);

  const totalValueCents = sumCents(...assets.map((asset) => asset.valueCents));
  const assetDebtCents = sumCents(...assets.map((asset) => asset.debtCents));
  const assetDebtServiceCents = sumCents(...assets.map((asset) => asset.annualDebtServiceCents));
  const grossIncomeCents = sumCents(...assets.map((asset) => asset.grossRentCents));
  const netIncomeCents = sumCents(...assets.map((asset) => asset.netPropertyIncomeCents));

  let standaloneDebtCents: Cents = 0;
  let standaloneCommitmentCents: Cents = 0;
  let contingentLiabilitiesCents: Cents = 0;
  let undrawnLimitsCents: Cents = 0;
  let totalLimitCents: Cents = sumCents(
    ...payload.portfolio.assets.map((asset) => centsOf(asset.facilityLimit || asset.currentBalance)),
  );

  payload.portfolio.liabilities.forEach((liability) => {
    if (liability.isContingent) {
      contingentLiabilitiesCents = sumCents(contingentLiabilitiesCents, centsOf(liability.balance || liability.limit));
      return;
    }
    // Already carried by the asset row it secures — counting it again would
    // double the borrower's debt on the very facility they told us about twice.
    if (liability.securedAgainstAssetId && assetIds.has(liability.securedAgainstAssetId)) {
      excludedLiabilities.push({
        id: liability.id,
        description: liability.description || liability.lender || 'Liability',
        reason: 'Already counted within the secured portfolio asset.',
      });
      return;
    }

    const balanceCents = centsOf(liability.balance);
    const limitCents = centsOf(liability.limit);
    standaloneDebtCents = sumCents(standaloneDebtCents, multiplyCents(balanceCents, relatedShare));
    totalLimitCents = sumCents(totalLimitCents, Math.max(balanceCents, limitCents));
    if (limitCents > balanceCents) {
      undrawnLimitsCents = sumCents(undrawnLimitsCents, limitCents - balanceCents);
    }
    standaloneCommitmentCents = sumCents(
      standaloneCommitmentCents,
      multiplyCents(liabilityAnnualCommitment(liability, policy), relatedShare),
    );
  });

  const totalDebtCents = sumCents(assetDebtCents, standaloneDebtCents);
  const totalDebtServiceCents = sumCents(assetDebtServiceCents, standaloneCommitmentCents);

  // Value-weighted average rate across every rate-bearing facility.
  const rateWeighted = payload.portfolio.assets.reduce(
    (sum, asset) => sum + centsOf(asset.currentBalance) * Math.max(0, asset.interestRate), 0,
  ) + payload.portfolio.liabilities.reduce(
    (sum, liability) => liability.isContingent ? sum : sum + centsOf(liability.balance) * Math.max(0, liability.interestRate), 0,
  );
  const rateBase = sumCents(
    ...payload.portfolio.assets.map((asset) => centsOf(asset.currentBalance)),
    ...payload.portfolio.liabilities.filter((l) => !l.isContingent).map((l) => centsOf(l.balance)),
  );
  const weightedAverageRatePct = rateBase > 0 ? Number((rateWeighted / rateBase).toFixed(2)) : 0;

  const shadedRentalIncomeCents = shadeRent(netIncomeCents, policy);

  const largestAssetValue = assets.length ? Math.max(...assets.map((asset) => asset.valueCents)) : 0;
  const largestAssetShare = totalValueCents > 0 ? roundRatio(largestAssetValue / totalValueCents) : 0;
  const crossCollateralisedValue = sumCents(
    ...assets.filter((asset) => asset.crossCollateralised).map((asset) => asset.valueCents),
  );
  const crossCollateralisedShare = totalValueCents > 0
    ? roundRatio(crossCollateralisedValue / totalValueCents)
    : 0;

  const typeTotals = new Map<string, Cents>();
  assets.forEach((asset) => {
    typeTotals.set(asset.assetType, sumCents(typeTotals.get(asset.assetType) ?? 0, asset.valueCents));
  });
  const largestTypeValue = typeTotals.size ? Math.max(...typeTotals.values()) : 0;
  const propertyConcentration = totalValueCents > 0 ? roundRatio(largestTypeValue / totalValueCents) : 0;

  if (largestAssetShare > 0.6 && assets.length > 1) {
    warnings.push('More than 60% of portfolio value sits in a single asset.');
  }
  if (crossCollateralisedShare > 0.5) {
    warnings.push('Over half the portfolio is cross-collateralised — releasing any one security will be constrained.');
  }
  if (contingentLiabilitiesCents > 0) {
    warnings.push('Contingent liabilities and guarantees are disclosed but not included in the servicing calculation.');
  }
  if (payload.portfolio.relatedEntityDebtSharePercent < 100) {
    warnings.push(`Related-entity debt counted at ${payload.portfolio.relatedEntityDebtSharePercent}% share to avoid double-counting.`);
  }

  const current: PortfolioPosition = {
    totalValueCents,
    totalDebtCents,
    totalLimitCents,
    netEquityCents: totalValueCents - totalDebtCents,
    lvr: ratio(totalDebtCents, totalValueCents),
    weightedAverageRatePct,
    grossIncomeCents,
    netIncomeCents,
    annualDebtServiceCents: totalDebtServiceCents,
    dscr: ratio(netIncomeCents, totalDebtServiceCents),
    netCashFlowCents: netIncomeCents - totalDebtServiceCents,
  };

  return {
    assets,
    current,
    existingCommitmentsCents: totalDebtServiceCents,
    contingentLiabilitiesCents,
    undrawnLimitsCents,
    shadedRentalIncomeCents,
    propertyConcentration,
    largestAssetShare,
    crossCollateralisedShare,
    excludedLiabilities,
    warnings,
  };
}

/**
 * Overlay the proposed transaction on the existing portfolio.
 *
 * The proposed asset contributes its valuation and net operating income; the
 * proposed facility contributes its balance and its annual debt service.
 */
export function calculatePortfolioImpact(input: {
  portfolio: PortfolioResult;
  proposedValueCents: Cents;
  proposedDebtCents: Cents;
  proposedNetIncomeCents: Cents;
  proposedGrossIncomeCents: Cents;
  proposedDebtServiceCents: Cents;
  proposedRatePct: number;
}): PortfolioImpact {
  const { current } = input.portfolio;

  const totalValueCents = sumCents(current.totalValueCents, input.proposedValueCents);
  const totalDebtCents = sumCents(current.totalDebtCents, input.proposedDebtCents);
  const grossIncomeCents = sumCents(current.grossIncomeCents, input.proposedGrossIncomeCents);
  const netIncomeCents = sumCents(current.netIncomeCents, input.proposedNetIncomeCents);
  const debtServiceCents = sumCents(current.annualDebtServiceCents, input.proposedDebtServiceCents);

  const combinedRateBase = current.totalDebtCents + input.proposedDebtCents;
  const weightedAverageRatePct = combinedRateBase > 0
    ? Number((
      (current.totalDebtCents * current.weightedAverageRatePct
        + input.proposedDebtCents * Math.max(0, input.proposedRatePct)) / combinedRateBase
    ).toFixed(2))
    : 0;

  const proposed: PortfolioPosition = {
    totalValueCents,
    totalDebtCents,
    totalLimitCents: sumCents(current.totalLimitCents, input.proposedDebtCents),
    netEquityCents: totalValueCents - totalDebtCents,
    lvr: ratio(totalDebtCents, totalValueCents),
    weightedAverageRatePct,
    grossIncomeCents,
    netIncomeCents,
    annualDebtServiceCents: debtServiceCents,
    dscr: ratio(netIncomeCents, debtServiceCents),
    netCashFlowCents: netIncomeCents - debtServiceCents,
  };

  const deltaAnnualCashFlowCents = proposed.netCashFlowCents - current.netCashFlowCents;
  const deltaLvr = roundRatio(proposed.lvr - current.lvr);
  const deltaDscr = roundRatio(proposed.dscr - current.dscr);

  // "Improves" requires the deal to leave the borrower no more leveraged and
  // no worse off on cash — either alone is a mixed outcome, not an improvement.
  const leverageBetter = deltaLvr <= 0;
  const cashBetter = deltaAnnualCashFlowCents >= 0;
  const direction: PortfolioImpact['direction'] =
    deltaLvr === 0 && deltaAnnualCashFlowCents === 0 ? 'unchanged'
      : leverageBetter && cashBetter ? 'improves'
        : !leverageBetter && !cashBetter ? 'weakens'
          : 'mixed';

  return {
    current,
    proposed,
    deltaValueCents: proposed.totalValueCents - current.totalValueCents,
    deltaDebtCents: proposed.totalDebtCents - current.totalDebtCents,
    deltaLvr,
    deltaAnnualDebtServiceCents: proposed.annualDebtServiceCents - current.annualDebtServiceCents,
    deltaMonthlyCashFlowCents: Math.round(deltaAnnualCashFlowCents / 12),
    deltaAnnualCashFlowCents,
    deltaDscr,
    direction,
  };
}

/**
 * Assessment orchestrator.
 *
 * Runs the whole calculation chain deterministically: the same payload and the
 * same policy always produce the same outputs, with no clock, no randomness
 * and no I/O. `asAt` is injected so lease-expiry maths stays reproducible when
 * a historical run is replayed.
 */

import {
  formatMoney,
  ratio,
  roundRatio,
  toWholeDollars,
  type Cents,
} from './money';
import { CALCULATION_ENGINE_VERSION, POLICY_VERSION, resolvePolicy, type OrganisationPolicySettings, type ResolvedPolicy } from './policy';
import { calculateTransaction, type TransactionResult } from './transaction';
import { calculatePropertyIncome, type PropertyIncomeResult } from './propertyIncome';
import { calculateBusinessIncome, debtToEbitda, type BusinessIncomeResult } from './businessIncome';
import { calculatePortfolio, calculatePortfolioImpact, type PortfolioImpact, type PortfolioResult } from './portfolio';
import { calculateServiceability, type ServiceabilityResult } from './serviceability';
import { classifyCompliance, INDICATIVE_RESULT_DISCLAIMER, type ComplianceResult } from './compliance';
import type { AssessmentPayload } from './types';
import { assessmentTypeDefinition } from './types';

export type AssessmentOutcome =
  | 'indicatively_supported'
  | 'supported_subject_to_verification'
  | 'outside_current_assumptions'
  | 'requires_specialist_review'
  | 'insufficient_information';

export const OUTCOME_LABELS: Record<AssessmentOutcome, string> = {
  indicatively_supported: 'Indicatively Supported',
  supported_subject_to_verification: 'Supported Subject to Verification',
  outside_current_assumptions: 'Outside Current Assumptions',
  requires_specialist_review: 'Requires Specialist Review',
  insufficient_information: 'Insufficient Information',
};

export interface ExplainStep {
  group: string;
  label: string;
  /** Inputs named as the user would recognise them. */
  inputs: string[];
  formula: string;
  /** Rendered value, already rounded per the engine's rules. */
  value: string;
  note?: string;
}

export interface AssessmentWarning {
  severity: 'info' | 'warning' | 'critical';
  category: 'data' | 'financial' | 'policy' | 'compliance' | 'portfolio' | 'verification';
  message: string;
}

export interface MissingItem {
  field: string;
  label: string;
  step: number;
  blocksCalculation: boolean;
}

export interface AssessmentResult {
  engineVersion: string;
  policyVersion: string;
  calculatedAt: string;
  policy: ResolvedPolicy;

  transaction: TransactionResult;
  propertyIncome: PropertyIncomeResult;
  businessIncome: BusinessIncomeResult;
  portfolio: PortfolioResult;
  portfolioImpact: PortfolioImpact;
  serviceability: ServiceabilityResult;
  compliance: ComplianceResult;

  outcome: AssessmentOutcome;
  outcomeLabel: string;
  outcomeReason: string;

  debtToEbitda: number | null;

  warnings: AssessmentWarning[];
  missing: MissingItem[];
  nextActions: string[];
  explain: ExplainStep[];
  disclaimer: string;

  /** Flat, display-ready summary. Whole dollars; ratios at 4dp. */
  summary: {
    maximumIndicativeLoan: number;
    requestedLoan: number;
    difference: number;
    requiredContribution: number;
    proposedLvr: number;
    proposedLtc: number;
    proposedDscr: number;
    proposedIcr: number;
    debtYield: number;
    netOperatingIncome: number;
    postTransactionPortfolioLvr: number;
    postTransactionPortfolioDscr: number;
    monthlyDebtService: number;
    annualDebtService: number;
    surplusAfterDebtService: number;
    bindingConstraint: string;
  };
}

export interface RunAssessmentOptions {
  organisationPolicy?: OrganisationPolicySettings | null;
  /** Injected for determinism. Defaults to now. */
  asAt?: Date;
}

/** Fields the engine cannot produce a meaningful answer without. */
function collectMissing(payload: AssessmentPayload): MissingItem[] {
  const missing: MissingItem[] = [];
  const definition = assessmentTypeDefinition(payload.assessmentType);

  if (!payload.property.address.trim()) {
    missing.push({ field: 'property.address', label: 'Property address', step: 2, blocksCalculation: false });
  }
  if (!definition.isRefinance && payload.property.purchasePrice <= 0) {
    missing.push({ field: 'property.purchasePrice', label: 'Purchase price', step: 2, blocksCalculation: true });
  }
  if (payload.property.currentValuation <= 0 && payload.property.purchasePrice <= 0) {
    missing.push({ field: 'property.currentValuation', label: 'Current valuation or estimated value', step: 2, blocksCalculation: true });
  }
  if (payload.loan.requestedLoan <= 0 && payload.property.requestedLoanAmount <= 0) {
    missing.push({ field: 'loan.requestedLoan', label: 'Requested loan amount', step: 7, blocksCalculation: false });
  }
  if (payload.loan.actualRatePercent <= 0) {
    missing.push({ field: 'loan.actualRatePercent', label: 'Interest rate', step: 7, blocksCalculation: true });
  }
  if (!payload.ownership.entities.length) {
    missing.push({ field: 'ownership.entities', label: 'Borrower entity', step: 3, blocksCalculation: false });
  }
  if (!definition.isOwnerOccupied && !payload.lease.tenancies.length) {
    missing.push({ field: 'lease.tenancies', label: 'Lease or tenancy income', step: 6, blocksCalculation: false });
  }
  if (definition.isOwnerOccupied && !payload.income.periods.length) {
    missing.push({ field: 'income.periods', label: 'Business financial period', step: 4, blocksCalculation: false });
  }
  if (payload.property.gstTreatment === 'unknown') {
    missing.push({ field: 'property.gstTreatment', label: 'GST treatment', step: 2, blocksCalculation: false });
  }
  return missing;
}

function buildExplain(input: {
  policy: ResolvedPolicy;
  transaction: TransactionResult;
  propertyIncome: PropertyIncomeResult;
  businessIncome: BusinessIncomeResult;
  serviceability: ServiceabilityResult;
  portfolioImpact: PortfolioImpact;
}): ExplainStep[] {
  const { policy, transaction, propertyIncome, businessIncome, serviceability, portfolioImpact } = input;
  const money = (cents: Cents) => formatMoney(cents);

  const steps: ExplainStep[] = [
    {
      group: 'Transaction',
      label: 'Total acquisition cost',
      inputs: ['Purchase price', 'Stamp duty', 'Legal', 'Valuation', 'Lender and establishment fees'],
      formula: 'Purchase price + all acquisition costs',
      value: money(transaction.totalAcquisitionCostCents),
    },
    {
      group: 'Transaction',
      label: 'Total project cost',
      inputs: ['Total acquisition cost', 'Fit-out', 'Plant and equipment', 'Repairs', 'Capex', 'Contingency'],
      formula: 'Total acquisition cost + works and contingency',
      value: money(transaction.totalProjectCostCents),
    },
    {
      group: 'Transaction',
      label: 'Valuation used for LVR',
      inputs: ['Purchase price', 'Current valuation'],
      formula: transaction.valuationBasis,
      value: money(transaction.valuationUsedCents),
      note: 'Paying above valuation does not create additional security.',
    },
    {
      group: 'Transaction',
      label: 'Proposed LVR',
      inputs: ['Requested loan', 'Valuation used'],
      formula: 'Requested loan ÷ valuation used',
      value: `${(transaction.proposedLvr * 100).toFixed(2)}%`,
    },
    {
      group: 'Transaction',
      label: 'Proposed LTC',
      inputs: ['Requested loan', 'Total project cost'],
      formula: 'Requested loan ÷ total project cost',
      value: `${(transaction.proposedLtc * 100).toFixed(2)}%`,
    },
    {
      group: 'Property income',
      label: 'Potential gross income',
      inputs: ['Tenancy rents', 'Recoverable outgoings'],
      formula: 'Annualised passing rent + recoverable outgoings',
      value: money(propertyIncome.potentialGrossIncomeCents),
    },
    {
      group: 'Property income',
      label: 'Effective gross income',
      inputs: ['Potential gross income', 'Vacancy allowance', 'Incentives and rent-free'],
      formula: 'Potential gross income − vacancy − incentives',
      value: money(propertyIncome.effectiveGrossIncomeCents),
    },
    {
      group: 'Property income',
      label: 'Net operating income',
      inputs: ['Effective gross income', 'Operating expenses', 'Management allowance'],
      formula: 'Effective gross income − total operating expenses',
      value: money(propertyIncome.netOperatingIncomeCents),
    },
    {
      group: 'Property income',
      label: 'Net yield / capitalisation rate',
      inputs: ['Net operating income', 'Valuation used'],
      formula: 'NOI ÷ valuation used',
      value: `${(propertyIncome.netYield * 100).toFixed(2)}%`,
    },
    {
      group: 'Property income',
      label: 'Debt yield',
      inputs: ['Net operating income', 'Requested loan'],
      formula: 'NOI ÷ requested loan',
      value: `${(propertyIncome.debtYield * 100).toFixed(2)}%`,
    },
    {
      group: 'Property income',
      label: 'Break-even occupancy',
      inputs: ['Total operating expenses', 'Potential gross income'],
      formula: 'Operating expenses ÷ potential gross income',
      value: `${(propertyIncome.breakEvenOccupancy * 100).toFixed(1)}%`,
    },
    {
      group: 'Income',
      label: 'Adjusted EBITDA',
      inputs: ['Reported EBITDA or NPAT rebuild', 'Confirmed add-backs'],
      formula: 'Reported EBITDA + confirmed add-backs',
      value: money(businessIncome.adjustedEbitdaCents),
      note: businessIncome.proposedAddbacksCents > 0
        ? `${formatMoney(businessIncome.proposedAddbacksCents)} of proposed add-backs excluded pending confirmation.`
        : undefined,
    },
    {
      group: 'Income',
      label: 'Assessable income',
      inputs: ['Business income', 'Personal income', 'Other income after shading'],
      formula: businessIncome.selectionBasis,
      value: money(businessIncome.totalAssessableIncomeCents),
    },
    {
      group: 'Servicing',
      label: 'Assessment rate',
      inputs: ['Contract rate', 'Policy buffer', 'Policy floor'],
      formula: serviceability.assessmentRateBasis,
      value: `${serviceability.assessmentRatePct.toFixed(2)}%`,
    },
    {
      group: 'Servicing',
      label: 'Total assessable income',
      inputs: ['Business income', 'Shaded proposed rent', 'Shaded portfolio rent'],
      formula: `Assessable income + rent shaded at ${policy.rentalShadingPct}%`,
      value: money(serviceability.totalAssessableIncomeCents),
    },
    {
      group: 'Servicing',
      label: 'Global annual debt service',
      inputs: ['Existing commitments', 'Proposed facility at assessment rate', 'Facility fees'],
      formula: 'Existing commitments + proposed debt service',
      value: money(serviceability.globalAnnualDebtServiceCents),
    },
    {
      group: 'Servicing',
      label: 'Surplus after debt service',
      inputs: ['Total assessable income', 'Global annual debt service'],
      formula: 'Assessable income − global debt service',
      value: money(serviceability.surplusAfterDebtServiceCents),
    },
    {
      group: 'Servicing',
      label: 'Sensitised surplus (+2%)',
      inputs: ['Total assessable income', 'Debt service at assessment rate + 2%'],
      formula: 'Assessable income − sensitised debt service',
      value: money(serviceability.sensitisedSurplusCents),
    },
    {
      group: 'Portfolio impact',
      label: 'Post-transaction portfolio LVR',
      inputs: ['Existing portfolio debt and value', 'Proposed loan and valuation'],
      formula: '(Existing debt + proposed loan) ÷ (existing value + proposed value)',
      value: `${(portfolioImpact.proposed.lvr * 100).toFixed(2)}%`,
      note: `Change of ${(portfolioImpact.deltaLvr * 100).toFixed(2)} percentage points.`,
    },
    {
      group: 'Portfolio impact',
      label: 'Change in annual cash flow',
      inputs: ['Portfolio net income', 'Portfolio debt service', 'Proposed NOI and debt service'],
      formula: 'Post-transaction net cash flow − current net cash flow',
      value: money(portfolioImpact.deltaAnnualCashFlowCents),
    },
  ];

  input.serviceability.caps.forEach((cap) => {
    steps.push({
      group: 'Capacity caps',
      label: `${cap.label}${cap.binding ? ' (binding)' : ''}`,
      inputs: [cap.label],
      formula: cap.formula,
      value: cap.applied ? money(cap.capCents) : 'Not applied',
      note: cap.binding ? 'This is the smallest applicable cap and therefore sets the maximum.' : undefined,
    });
  });

  return steps;
}

function deriveOutcome(input: {
  serviceability: ServiceabilityResult;
  compliance: ComplianceResult;
  missing: MissingItem[];
  businessIncome: BusinessIncomeResult;
  propertyIncome: PropertyIncomeResult;
}): { outcome: AssessmentOutcome; reason: string } {
  const { serviceability, compliance, missing, businessIncome } = input;

  if (missing.some((item) => item.blocksCalculation)) {
    return {
      outcome: 'insufficient_information',
      reason: `Required inputs are missing: ${missing.filter((item) => item.blocksCalculation).map((item) => item.label).join(', ')}.`,
    };
  }

  if (compliance.requiresSpecialistReview) {
    return {
      outcome: 'requires_specialist_review',
      reason: compliance.flags.find((flag) => flag.severity === 'block')?.message
        ?? `Classified as ${compliance.classificationLabel.toLowerCase()}.`,
    };
  }

  if (serviceability.maximumIndicativeLoanCents <= 0) {
    return {
      outcome: 'outside_current_assumptions',
      reason: 'No facility is supportable under the selected assumptions.',
    };
  }

  if (serviceability.requestedLoanCents > serviceability.maximumIndicativeLoanCents) {
    return {
      outcome: 'outside_current_assumptions',
      reason: `The requested facility exceeds the maximum indicative capacity, which is bound by ${serviceability.bindingConstraintLabel.toLowerCase()}.`,
    };
  }

  if (serviceability.surplusAfterDebtServiceCents < 0) {
    return {
      outcome: 'outside_current_assumptions',
      reason: 'Global servicing is negative under the assessment rate.',
    };
  }

  if (
    businessIncome.verificationStatus !== 'verified'
    || compliance.requiresComplianceReview
    || serviceability.sensitisedSurplusCents < 0
    || missing.length > 0
  ) {
    return {
      outcome: 'supported_subject_to_verification',
      reason: 'The transaction fits the assumptions but depends on information that is not yet verified.',
    };
  }

  return {
    outcome: 'indicatively_supported',
    reason: `The requested facility sits within every applicable policy cap, with ${serviceability.bindingConstraintLabel.toLowerCase()} binding.`,
  };
}

export function runAssessment(
  payload: AssessmentPayload,
  options: RunAssessmentOptions = {},
): AssessmentResult {
  const asAt = options.asAt ?? new Date();
  const definition = assessmentTypeDefinition(payload.assessmentType);

  const policy = resolvePolicy({
    profileKey: payload.loan.lenderPolicyProfile,
    organisation: options.organisationPolicy,
    overrides: payload.loan.policyOverrides,
    forceSpecialistReview: definition.requiresSpecialistReview,
  });

  const transaction = calculateTransaction(payload);
  const propertyIncome = calculatePropertyIncome(
    payload, transaction.valuationUsedCents, transaction.requestedLoanCents, asAt,
  );
  const businessIncome = calculateBusinessIncome(payload, policy);
  const portfolio = calculatePortfolio(payload, policy);
  const serviceability = calculateServiceability({
    payload, policy, transaction, propertyIncome, businessIncome, portfolio,
  });
  const portfolioImpact = calculatePortfolioImpact({
    portfolio,
    proposedValueCents: transaction.valuationUsedCents,
    proposedDebtCents: transaction.requestedLoanCents,
    proposedNetIncomeCents: propertyIncome.netOperatingIncomeCents,
    proposedGrossIncomeCents: propertyIncome.potentialGrossIncomeCents,
    proposedDebtServiceCents: transaction.annualDebtServiceCents,
    proposedRatePct: payload.loan.actualRatePercent,
  });
  const compliance = classifyCompliance(payload);
  const missing = collectMissing(payload);

  const { outcome, reason } = deriveOutcome({
    serviceability, compliance, missing, businessIncome, propertyIncome,
  });

  // ---- Warnings, proportionate and de-duplicated ---------------------------
  const warnings: AssessmentWarning[] = [];
  const seen = new Set<string>();
  const push = (severity: AssessmentWarning['severity'], category: AssessmentWarning['category'], message: string) => {
    const key = `${category}:${message}`;
    if (seen.has(key)) return;
    seen.add(key);
    warnings.push({ severity, category, message });
  };

  serviceability.warnings.forEach((message) => push('critical', 'financial', message));
  portfolio.warnings.forEach((message) => push('warning', 'portfolio', message));
  propertyIncome.notes.forEach((message) => push('warning', 'financial', message));
  businessIncome.varianceWarnings.forEach((message) => push('warning', 'verification', message));
  businessIncome.notes.forEach((message) => push('info', 'verification', message));
  compliance.flags.forEach((flag) => push(
    flag.severity === 'block' ? 'critical' : flag.severity === 'review' ? 'warning' : 'info',
    'compliance',
    flag.message,
  ));
  missing
    .filter((item) => item.blocksCalculation)
    .forEach((item) => push('critical', 'data', `${item.label} is required before the result can be relied on.`));

  const nextActions: string[] = [];
  if (missing.length) {
    nextActions.push(`Complete ${missing.length} outstanding field(s): ${missing.slice(0, 3).map((item) => item.label).join(', ')}${missing.length > 3 ? '…' : ''}.`);
  }
  if (compliance.requiresComplianceReview) {
    nextActions.push('Resolve the compliance classification before presenting this as a business-purpose assessment.');
  }
  if (businessIncome.verificationStatus !== 'verified' && payload.income.periods.length) {
    nextActions.push('Obtain and verify financial statements, tax returns or notices of assessment.');
  }
  if (serviceability.headroomCents < 0) {
    nextActions.push(`Reduce the requested facility by ${formatMoney(Math.abs(serviceability.headroomCents))} or improve the ${serviceability.bindingConstraintLabel.toLowerCase()} position.`);
  }
  if (transaction.fundingGapCents > 0) {
    nextActions.push(`Fund the ${formatMoney(transaction.fundingGapCents)} shortfall between total project cost and available funding.`);
  }
  if (!nextActions.length) {
    nextActions.push('Verify lease, valuation and structure documents, then generate the assessment report.');
  }

  const explain = buildExplain({
    policy, transaction, propertyIncome, businessIncome, serviceability, portfolioImpact,
  });

  return {
    engineVersion: CALCULATION_ENGINE_VERSION,
    policyVersion: POLICY_VERSION,
    calculatedAt: asAt.toISOString(),
    policy,
    transaction,
    propertyIncome,
    businessIncome,
    portfolio,
    portfolioImpact,
    serviceability,
    compliance,
    outcome,
    outcomeLabel: OUTCOME_LABELS[outcome],
    outcomeReason: reason,
    debtToEbitda: debtToEbitda(
      portfolioImpact.proposed.totalDebtCents, businessIncome.adjustedEbitdaCents,
    ),
    warnings,
    missing,
    nextActions,
    explain,
    disclaimer: INDICATIVE_RESULT_DISCLAIMER,
    summary: {
      maximumIndicativeLoan: toWholeDollars(serviceability.maximumIndicativeLoanCents),
      requestedLoan: toWholeDollars(serviceability.requestedLoanCents),
      difference: toWholeDollars(serviceability.headroomCents),
      requiredContribution: toWholeDollars(serviceability.requiredContributionCents),
      proposedLvr: transaction.proposedLvr,
      proposedLtc: transaction.proposedLtc,
      proposedDscr: serviceability.proposedDscr,
      proposedIcr: serviceability.proposedIcr,
      debtYield: propertyIncome.debtYield,
      netOperatingIncome: toWholeDollars(propertyIncome.netOperatingIncomeCents),
      postTransactionPortfolioLvr: portfolioImpact.proposed.lvr,
      postTransactionPortfolioDscr: portfolioImpact.proposed.dscr,
      monthlyDebtService: toWholeDollars(transaction.monthlyDebtServiceCents),
      annualDebtService: toWholeDollars(transaction.annualDebtServiceCents),
      surplusAfterDebtService: toWholeDollars(serviceability.surplusAfterDebtServiceCents),
      bindingConstraint: serviceability.bindingConstraintLabel,
    },
  };
}

/** Ratio helpers re-exported so UI code has one import site. */
export { ratio, roundRatio };

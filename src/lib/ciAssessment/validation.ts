/**
 * Shared validation. The same rules run in the browser (for immediate field
 * feedback) and inside the edge function (because a client that validates is
 * not a server that is safe).
 *
 * The distinction that matters: an `error` makes the calculation invalid or
 * unsafe and blocks progress; a `warning` is information the user should see
 * but must not be stopped by. Blocking a commercial assessment because a
 * postcode is missing is how a tool gets abandoned.
 */

import { z } from 'zod';
import { num } from './money';
import { ASSESSMENT_TYPES, type AssessmentPayload } from './types';

/**
 * The workspace step an issue belongs to.
 *
 * A stable key, deliberately not a position. These were numbers once, and the
 * workspace resolved them with `STEPS[step - 1]` — so inserting the Intake pack
 * chip silently shifted every issue one step short, sending a Loan-structure
 * error to the Lease income panel and putting the red marker on the wrong chip.
 * A key cannot drift when the step order changes.
 */
export type ValidationSection =
  | 'property' | 'ownership' | 'income' | 'portfolio' | 'lease' | 'loan';

export interface ValidationIssue {
  /** Dot path into the payload; also the DOM target for scroll-and-highlight. */
  field: string;
  section: ValidationSection;
  severity: 'error' | 'warning';
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

// ---------------------------------------------------------------------------
// Server-side schema. Deliberately permissive about *shape* and strict about
// *bounds* — a draft is allowed to be incomplete, but never nonsensical.
// ---------------------------------------------------------------------------

const money = z.number().finite().min(-1_000_000_000).max(100_000_000_000);
const percent = z.number().finite().min(-100).max(1000);
const optionalDate = z.string().max(40).optional().or(z.literal(''));

export const assessmentPayloadSchema = z.object({
  assessmentType: z.enum(ASSESSMENT_TYPES),
  property: z.object({
    address: z.string().max(500),
    suburb: z.string().max(200),
    state: z.string().max(3),
    postcode: z.string().max(10),
    purchasePrice: money,
    currentValuation: money,
    requestedLoanAmount: money,
    depositOrContribution: money,
    valuationDate: optionalDate,
    contractDate: optionalDate,
    settlementDate: optionalDate,
  }).passthrough(),
  ownership: z.object({
    entities: z.array(z.object({
      id: z.string().max(64),
      entityName: z.string().max(300),
      ownershipPercent: percent,
    }).passthrough()).max(50),
  }).passthrough(),
  income: z.object({
    periods: z.array(z.object({ id: z.string().max(64) }).passthrough()).max(20),
    addbacks: z.array(z.object({ id: z.string().max(64) }).passthrough()).max(200),
  }).passthrough(),
  portfolio: z.object({
    assets: z.array(z.object({ id: z.string().max(64) }).passthrough()).max(200),
    liabilities: z.array(z.object({ id: z.string().max(64) }).passthrough()).max(200),
  }).passthrough(),
  lease: z.object({
    tenancies: z.array(z.object({ id: z.string().max(64) }).passthrough()).max(200),
  }).passthrough(),
  loan: z.object({
    requestedLoan: money,
    actualRatePercent: percent,
    loanTermYears: z.number().finite().min(0).max(50),
    amortisationYears: z.number().finite().min(0).max(50),
  }).passthrough(),
  internalNotes: z.string().max(20_000).optional(),
}).passthrough();

// ---------------------------------------------------------------------------
// Business rules
// ---------------------------------------------------------------------------

export function validateAssessment(payload: AssessmentPayload): ValidationResult {
  const issues: ValidationIssue[] = [];
  const add = (
    severity: ValidationIssue['severity'],
    section: ValidationSection,
    field: string,
    message: string,
  ) => issues.push({ severity, section, field, message });

  const { property, loan, ownership, portfolio, lease, income } = payload;

  // ---- Step 2: property and transaction ----------------------------------
  if (property.purchasePrice < 0) add('error', 'property', 'property.purchasePrice', 'Purchase price cannot be negative.');
  if (property.currentValuation < 0) add('error', 'property', 'property.currentValuation', 'Valuation cannot be negative.');
  if (property.depositOrContribution < 0) add('error', 'property', 'property.depositOrContribution', 'Contribution cannot be negative.');

  if (property.contractDate && property.settlementDate && property.settlementDate < property.contractDate) {
    add('error', 'property', 'property.settlementDate', 'Settlement date cannot fall before the contract date.');
  }
  if (property.valuationDate) {
    const valuationDate = new Date(property.valuationDate);
    if (!Number.isNaN(valuationDate.getTime())) {
      const monthsOld = (Date.now() - valuationDate.getTime()) / (30.44 * 24 * 60 * 60 * 1000);
      if (monthsOld > 12) add('warning', 'property', 'property.valuationDate', 'The valuation is more than 12 months old — most lenders will require a fresh one.');
      if (monthsOld < -1) add('error', 'property', 'property.valuationDate', 'Valuation date is in the future.');
    }
  }
  if (property.state && !/^(NSW|VIC|QLD|WA|SA|TAS|ACT|NT)$/.test(property.state)) {
    add('error', 'property', 'property.state', 'State must be one of NSW, VIC, QLD, WA, SA, TAS, ACT or NT.');
  }
  if (property.postcode && !/^\d{4}$/.test(property.postcode)) {
    add('warning', 'property', 'property.postcode', 'Australian postcodes are four digits.');
  }

  // ---- Step 3: ownership --------------------------------------------------
  if (ownership.entities.length) {
    const totalOwnership = ownership.entities.reduce((sum, entity) => sum + num(entity.ownershipPercent), 0);
    if (Math.abs(totalOwnership - 100) > 0.5) {
      add('error', 'ownership', 'ownership.entities', `Ownership percentages total ${totalOwnership.toFixed(1)}% — they must total 100%.`);
    }
    ownership.entities.forEach((entity, index) => {
      if (!entity.entityName.trim()) {
        add('warning', 'ownership', `ownership.entities.${index}.entityName`, 'Borrower entity has no name.');
      }
      const needsAbn = ['company', 'trust', 'corporate_trustee', 'partnership', 'smsf', 'spv'].includes(entity.structure);
      if (needsAbn && !entity.abnAcn.trim()) {
        add('warning', 'ownership', `ownership.entities.${index}.abnAcn`, `${entity.entityName || 'This entity'} is a ${entity.structure.replace(/_/g, ' ')} — record its ABN or ACN.`);
      }
    });
  }

  // ---- Step 4: income -----------------------------------------------------
  const periodIds = new Set(income.periods.map((period) => period.id));
  income.addbacks.forEach((addback, index) => {
    if (!periodIds.has(addback.periodId)) {
      add('error', 'income', `income.addbacks.${index}.periodId`, 'Add-back is attached to a financial period that no longer exists.');
    }
    if (addback.amount <= 0) {
      add('error', 'income', `income.addbacks.${index}.amount`, 'Add-back amount must be greater than zero.');
    }
    if (addback.confirmed && (!addback.reason.trim() || !addback.source.trim())) {
      add('error', 'income', `income.addbacks.${index}.reason`, 'A confirmed add-back must record both a reason and a source document.');
    }
  });
  const periodEnds = income.periods.map((period) => period.periodEnd).filter(Boolean);
  if (new Set(periodEnds).size !== periodEnds.length) {
    add('warning', 'income', 'income.periods', 'Two financial periods share the same end date.');
  }

  // ---- Step 5: portfolio --------------------------------------------------
  const addressSeen = new Map<string, number>();
  portfolio.assets.forEach((asset, index) => {
    if (asset.currentBalance > asset.currentValue && asset.currentValue > 0) {
      add('warning', 'portfolio', `portfolio.assets.${index}.currentBalance`, `${asset.address || 'A portfolio asset'} carries more debt than its recorded value.`);
    }
    if (asset.ownershipPercent < 0 || asset.ownershipPercent > 100) {
      add('error', 'portfolio', `portfolio.assets.${index}.ownershipPercent`, 'Ownership percentage must be between 0 and 100.');
    }
    if (asset.facilityLimit > 0 && asset.currentBalance > asset.facilityLimit) {
      add('warning', 'portfolio', `portfolio.assets.${index}.currentBalance`, 'Current balance exceeds the recorded facility limit.');
    }
    const key = asset.address.trim().toLowerCase();
    if (key) {
      const previous = addressSeen.get(key);
      if (previous != null) {
        add('warning', 'portfolio', `portfolio.assets.${index}.address`, `Duplicate address — the same property appears at rows ${previous + 1} and ${index + 1}.`);
      } else {
        addressSeen.set(key, index);
      }
    }
  });
  portfolio.liabilities.forEach((liability, index) => {
    if (liability.balance < 0) {
      add('error', 'portfolio', `portfolio.liabilities.${index}.balance`, 'Liability balance cannot be negative.');
    }
    if (liability.limit > 0 && liability.balance > liability.limit) {
      add('warning', 'portfolio', `portfolio.liabilities.${index}.balance`, 'Balance exceeds the facility limit.');
    }
  });

  // ---- Step 6: lease ------------------------------------------------------
  lease.tenancies.forEach((tenancy, index) => {
    if (tenancy.leaseCommencement && tenancy.leaseExpiry && tenancy.leaseExpiry < tenancy.leaseCommencement) {
      add('error', 'lease', `lease.tenancies.${index}.leaseExpiry`, 'Lease expiry falls before its commencement.');
    }
    if (tenancy.annualRent < 0) {
      add('error', 'lease', `lease.tenancies.${index}.annualRent`, 'Rent cannot be negative.');
    }
  });
  if (lease.vacancyAllowancePercent < 0 || lease.vacancyAllowancePercent > 100) {
    add('error', 'lease', 'lease.vacancyAllowancePercent', 'Vacancy allowance must be between 0% and 100%.');
  }
  if (lease.managementAllowancePercent < 0 || lease.managementAllowancePercent > 100) {
    add('error', 'lease', 'lease.managementAllowancePercent', 'Management allowance must be between 0% and 100%.');
  }

  // ---- Step 7: loan structure ---------------------------------------------
  if (loan.actualRatePercent < 0) add('error', 'loan', 'loan.actualRatePercent', 'Interest rate cannot be negative.');
  if (loan.actualRatePercent > 30) add('warning', 'loan', 'loan.actualRatePercent', 'Interest rate above 30% — confirm this is correct.');
  if (loan.loanTermYears > 0 && loan.amortisationYears > 0 && loan.amortisationYears < loan.loanTermYears) {
    add('warning', 'loan', 'loan.amortisationYears', 'Amortisation is shorter than the loan term, which implies the facility repays before maturity.');
  }
  if (loan.interestOnlyPeriodYears > loan.loanTermYears && loan.loanTermYears > 0) {
    add('error', 'loan', 'loan.interestOnlyPeriodYears', 'Interest-only period cannot exceed the loan term.');
  }
  if (loan.residualBalloonAmount > 0 && loan.residualBalloonAmount >= loan.requestedLoan && loan.requestedLoan > 0) {
    add('error', 'loan', 'loan.residualBalloonAmount', 'Residual cannot equal or exceed the facility amount.');
  }
  if (loan.requestedLoan < 0) add('error', 'loan', 'loan.requestedLoan', 'Requested loan cannot be negative.');

  const totalProjectCost = num(property.purchasePrice)
    + num(property.stampDuty) + num(property.legalCosts) + num(property.valuationCosts)
    + num(property.lenderFees) + num(property.fitOut) + num(property.plantAndEquipment)
    + num(property.repairs) + num(property.immediateCapex) + num(property.contingency)
    + num(property.otherAcquisitionCosts);
  const requested = loan.requestedLoan > 0 ? loan.requestedLoan : property.requestedLoanAmount;
  if (requested > 0 && totalProjectCost > 0 && requested > totalProjectCost) {
    add('warning', 'loan', 'loan.requestedLoan', 'The requested facility exceeds the total project cost — confirm whether this includes an equity release.');
  }

  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');
  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Client reconciliation — the last step of the workflow.
 *
 * When a completed assessment is linked to a client, nothing is written
 * silently. Every field the assessment holds is compared against the client
 * record and classified, and the user chooses a disposition per item. Only the
 * items they explicitly accept are applied, and the whole decision set is
 * recorded on the audit trail.
 */

import { num } from './money';
import type { AssessmentPayload, Liability, PortfolioAsset } from './types';
import type { ClientProfile } from '@/utils/commercial/clientPortfolioTypes';

export type ReconciliationCategory =
  | 'matching'      // assessment and client agree
  | 'new'           // assessment has it, client does not
  | 'conflicting'   // both have it, values differ
  | 'outdated'      // client value is older than the assessment's
  | 'excluded';     // deliberately not carried across

export type ReconciliationDisposition =
  | 'assessment_only'      // keep in the assessment, do not touch the client
  | 'update_client'        // overwrite the client field
  | 'create_portfolio_item'
  | 'update_portfolio_item';

export interface ReconciliationItem {
  id: string;
  section: 'property' | 'liability' | 'income' | 'borrower';
  label: string;
  field: string;
  assessmentValue: unknown;
  clientValue: unknown;
  category: ReconciliationCategory;
  /** What the UI should pre-select. Users may change it. */
  suggestedDisposition: ReconciliationDisposition;
  disposition: ReconciliationDisposition;
  /** Set for property/liability rows matched to an existing client record. */
  clientRecordId?: string | null;
  reason: string;
}

export interface ReconciliationSummary {
  items: ReconciliationItem[];
  counts: Record<ReconciliationCategory, number>;
  /** Duplicate-risk warnings surfaced before anything is written. */
  duplicateWarnings: string[];
}

/** Normalise an address for fuzzy comparison — case, punctuation and spacing. */
export function normaliseAddress(value: string | null | undefined): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, ' ')
    .replace(/\b(street|st|road|rd|avenue|ave|drive|dr|lane|ln|court|ct|place|pl|highway|hwy|unit|suite|level|lvl)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Two money figures agree when they are within 1% or $1,000, whichever is larger. */
function moneyMatches(a: number, b: number): boolean {
  const left = num(a);
  const right = num(b);
  if (left === 0 && right === 0) return true;
  const tolerance = Math.max(1000, Math.abs(Math.max(left, right)) * 0.01);
  return Math.abs(left - right) <= tolerance;
}

function categoriseMoney(
  assessmentValue: number,
  clientValue: number | null | undefined,
): { category: ReconciliationCategory; reason: string } {
  if (clientValue == null) {
    return { category: 'new', reason: 'Not present on the client record.' };
  }
  if (moneyMatches(assessmentValue, clientValue)) {
    return { category: 'matching', reason: 'Within tolerance of the client record.' };
  }
  return {
    category: 'conflicting',
    reason: `Assessment holds ${assessmentValue.toLocaleString('en-AU')}; client record holds ${Number(clientValue).toLocaleString('en-AU')}.`,
  };
}

function suggestedFor(category: ReconciliationCategory): ReconciliationDisposition {
  switch (category) {
    case 'new': return 'create_portfolio_item';
    case 'conflicting': return 'assessment_only';
    case 'outdated': return 'update_client';
    case 'matching': return 'assessment_only';
    default: return 'assessment_only';
  }
}

/** All client-held properties flattened into one comparable list. */
function clientProperties(profile: ClientProfile) {
  return [
    ...profile.residentialAssets,
    ...profile.commercialAssets,
    ...profile.industrialAssets,
  ];
}

export function reconcileAssessmentWithClient(
  payload: AssessmentPayload,
  profile: ClientProfile,
): ReconciliationSummary {
  const items: ReconciliationItem[] = [];
  const duplicateWarnings: string[] = [];
  const existing = clientProperties(profile);

  // ---- Portfolio properties ------------------------------------------------
  payload.portfolio.assets.forEach((asset: PortfolioAsset) => {
    const key = normaliseAddress(asset.address);
    const match = key ? existing.find((candidate) => normaliseAddress(candidate.address) === key) : undefined;

    if (!match) {
      items.push({
        id: `asset:${asset.id}`,
        section: 'property',
        label: asset.address || 'Unnamed property',
        field: 'portfolio.asset',
        assessmentValue: { value: asset.currentValue, debt: asset.currentBalance, rent: asset.annualRent },
        clientValue: null,
        category: 'new',
        suggestedDisposition: 'create_portfolio_item',
        disposition: 'create_portfolio_item',
        clientRecordId: null,
        reason: 'This property is not on the client record.',
      });
      return;
    }

    const valueCheck = categoriseMoney(asset.currentValue, match.currentValue);
    const debtCheck = categoriseMoney(asset.currentBalance, match.loanBalance);
    const category: ReconciliationCategory =
      valueCheck.category === 'matching' && debtCheck.category === 'matching' ? 'matching' : 'conflicting';

    items.push({
      id: `asset:${asset.id}`,
      section: 'property',
      label: asset.address || match.address,
      field: 'portfolio.asset',
      assessmentValue: { value: asset.currentValue, debt: asset.currentBalance, rent: asset.annualRent },
      clientValue: { value: match.currentValue, debt: match.loanBalance, rent: match.annualRent ?? 0 },
      category,
      suggestedDisposition: category === 'matching' ? 'assessment_only' : 'update_portfolio_item',
      disposition: category === 'matching' ? 'assessment_only' : 'update_portfolio_item',
      clientRecordId: match.id,
      reason: category === 'matching'
        ? 'Value and debt agree with the client record within tolerance.'
        : `${valueCheck.reason} ${debtCheck.reason}`.trim(),
    });

    duplicateWarnings.push(
      `"${asset.address}" matches an existing client property. Choosing "create" would duplicate it.`,
    );
  });

  // ---- Liabilities ---------------------------------------------------------
  const clientLiabilityTotals: Record<string, number> = {
    commercial_facility: num(profile.liabilities?.commercialLoans),
    home_loan: num(profile.liabilities?.residentialLoans),
    investment_loan: num(profile.liabilities?.residentialLoans),
    equipment_finance: num(profile.liabilities?.equipmentFinance),
    vehicle_finance: num(profile.liabilities?.vehicleFinance),
    credit_card: num(profile.liabilities?.creditCards),
    overdraft: num(profile.liabilities?.overdrafts),
    tax_debt: num(profile.liabilities?.atoPaymentPlans),
    private_debt: num(profile.liabilities?.relatedPartyLoans),
  };

  payload.portfolio.liabilities.forEach((liability: Liability) => {
    const clientTotal = clientLiabilityTotals[liability.liabilityType];
    const check = categoriseMoney(liability.balance, clientTotal ?? null);
    items.push({
      id: `liability:${liability.id}`,
      section: 'liability',
      label: liability.description || liability.lender || liability.liabilityType,
      field: `liabilities.${liability.liabilityType}`,
      assessmentValue: liability.balance,
      clientValue: clientTotal ?? null,
      category: check.category,
      suggestedDisposition: suggestedFor(check.category),
      disposition: suggestedFor(check.category),
      clientRecordId: liability.clientLiabilityId ?? null,
      reason: clientTotal == null
        ? 'No liability of this type on the client record.'
        : `${check.reason} Client totals are held per category, so compare with care.`,
    });
  });

  // ---- Income --------------------------------------------------------------
  const latestPeriod = [...payload.income.periods]
    .sort((a, b) => (b.periodEnd || '').localeCompare(a.periodEnd || ''))[0];
  if (latestPeriod) {
    const assessmentPersonal = num(latestPeriod.salaryWages) + num(latestPeriod.directorRemuneration);
    const personalCheck = categoriseMoney(assessmentPersonal, profile.personalIncome);
    items.push({
      id: 'income:personal',
      section: 'income',
      label: 'Personal income',
      field: 'income.personal',
      assessmentValue: assessmentPersonal,
      clientValue: profile.personalIncome,
      category: personalCheck.category,
      suggestedDisposition: suggestedFor(personalCheck.category),
      disposition: suggestedFor(personalCheck.category),
      reason: personalCheck.reason,
    });

    const businessCheck = categoriseMoney(num(latestPeriod.ebitda), profile.businessIncome);
    items.push({
      id: 'income:business',
      section: 'income',
      label: 'Business income (EBITDA)',
      field: 'income.business',
      assessmentValue: num(latestPeriod.ebitda),
      clientValue: profile.businessIncome,
      category: businessCheck.category,
      suggestedDisposition: suggestedFor(businessCheck.category),
      disposition: suggestedFor(businessCheck.category),
      reason: businessCheck.reason,
    });
  }

  // ---- Borrower entities ---------------------------------------------------
  payload.ownership.entities.forEach((entity) => {
    const known = (profile.ownershipStructures ?? []).some(
      (structure) => structure.toLowerCase() === entity.entityName.toLowerCase(),
    );
    items.push({
      id: `entity:${entity.id}`,
      section: 'borrower',
      label: entity.entityName || 'Unnamed entity',
      field: 'ownership.entity',
      assessmentValue: { name: entity.entityName, structure: entity.structure, abnAcn: entity.abnAcn },
      clientValue: known ? entity.entityName : null,
      category: known ? 'matching' : 'new',
      suggestedDisposition: known ? 'assessment_only' : 'update_client',
      disposition: known ? 'assessment_only' : 'update_client',
      reason: known
        ? 'Entity already recorded against the client.'
        : 'Entity is not recorded against the client.',
    });
  });

  const counts = items.reduce<Record<ReconciliationCategory, number>>(
    (accumulator, item) => {
      accumulator[item.category] += 1;
      return accumulator;
    },
    { matching: 0, new: 0, conflicting: 0, outdated: 0, excluded: 0 },
  );

  return { items, counts, duplicateWarnings };
}

/**
 * Reduce the user's dispositions into the exact set of writes to perform.
 * Anything left as `assessment_only` produces no client mutation at all.
 */
export function buildReconciliationPlan(items: ReconciliationItem[]) {
  return {
    clientUpdates: items.filter((item) => item.disposition === 'update_client'),
    portfolioCreates: items.filter((item) => item.disposition === 'create_portfolio_item'),
    portfolioUpdates: items.filter((item) => item.disposition === 'update_portfolio_item'),
    untouched: items.filter((item) => item.disposition === 'assessment_only'),
  };
}

/**
 * Income Component Mapping — Phase I1 Wiring
 *
 * Bridges the UI's `IncomeBreakdownItem[]` (label-based) into the engine's
 * typed `ScenarioIncomeComponent[]` so lender-aware re-shading can fire when
 * a scenario flips lender profiles via `dti_cap_change.meta.lenderProfile`.
 *
 * The mapper is intentionally label-fuzzy — incomeBreakdown labels are
 * built dynamically in BorrowingCapacityModal and we'd rather classify
 * "Primary Bonus" as `bonus` than fail closed on `other`.
 */

import type { IncomeComponentType, ScenarioIncomeComponent } from './lenderShadingProfiles';

export interface IncomeBreakdownLike {
  id: string;
  label: string;
  grossAmount: number;
  shadingRate: number;
  shadedAmount: number;
}

/** Match a UI label to an engine `IncomeComponentType`. Falls back to `other`. */
export function classifyIncomeLabel(label: string): IncomeComponentType {
  const l = (label || '').toLowerCase();
  if (l.includes('bonus')) return 'bonus';
  if (l.includes('commission')) return 'commission';
  if (l.includes('essential overtime') || l.includes('essential ot')) return 'overtime_essential';
  if (l.includes('overtime') || l.includes('ot')) return 'overtime_non_essential';
  if (l.includes('allowance')) return 'allowance';
  if (l.includes('rental') || l.includes('rent')) {
    if (l.includes('commercial')) return 'rental_commercial';
    return 'rental_residential';
  }
  if (l.includes('positive cash flow') || l.includes('positive cashflow') || l.includes('cash flow')) {
    return 'rental_residential'; // positive property cashflow = rental income
  }
  if (l.includes('self') && l.includes('employ')) return 'self_employed';
  if (l.includes('dividend') || l.includes('investment income')) return 'investment_dividend';
  if (l.includes('family tax')) return 'family_tax_benefit';
  if (l.includes('centrelink') || l.includes('pension') || l.includes('benefit')) return 'centrelink_other';
  if (l.includes('child support')) return 'child_support';
  if (l.includes('salary') || l.includes('base') || l.includes('wage')) return 'base_salary';
  return 'base_salary'; // safer default than 'other' — most rows are PAYG salary
}

export function toScenarioIncomeComponents(
  items: IncomeBreakdownLike[],
): ScenarioIncomeComponent[] {
  return (items || [])
    .filter(it => Number.isFinite(it.grossAmount) && it.grossAmount > 0)
    .map(it => ({
      id: it.id,
      label: it.label,
      type: classifyIncomeLabel(it.label),
      grossAnnual: it.grossAmount,
      currentShadingRate: typeof it.shadingRate === 'number' ? it.shadingRate : 1,
    }));
}

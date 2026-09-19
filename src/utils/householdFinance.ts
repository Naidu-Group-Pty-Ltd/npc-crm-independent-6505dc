/**
 * The browser's binding to the household finance engine.
 *
 * The arithmetic moved to
 * `supabase/functions/_shared/reports/clientDetails/finance.pure.ts` — and its
 * rules moved with it, unchanged — so that the Client Details document rendered
 * on the server and the surfaces rendered here cannot disagree about what a
 * household earns or what it services. There is one implementation and this
 * re-exports it.
 *
 * What is left here is the single thing a pure module cannot have: the HECS
 * estimator, which reaches `policyEngine.ts` for the ATO bracket table. Every
 * existing caller — `BorrowingCapacityModal`, `FormaraPDFGenerator`,
 * `borrowingCapacityPdfSections` — keeps its exact behaviour, because
 * `buildLiabilityServicing` and `computeLiabilityServicing` are wrapped below to
 * inject it by default.
 *
 * Import from here in browser code. Import the `.pure` module directly only from
 * the Edge Functions, which have no access to the policy engine.
 */
import { getHecsRepayment } from '@/utils/borrowingCapacityCalculations';
import {
  buildLiabilityServicing as buildLiabilityServicingPure,
  computeLiabilityServicing as computeLiabilityServicingPure,
  type LiabilityRowLike,
  type LiabilityServicing,
  type LiabilityServicingOptions,
  type LiabilityServicingSummary,
} from '@/lib/reports/clientDetails/finance.pure';

export type {
  BuildIncomeOptions,
  EmploymentRowLike,
  HouseholdIncome,
  IncomeFrequency,
  IncomeRowLike,
  IncomeSourceRowLike,
  LiabilityRowLike,
  LiabilityServicing,
  LiabilityServicingOptions,
  LiabilityServicingSummary,
  OtherIncomeLine,
  PropertyExpenditure,
  PropertyRowLike,
} from '@/lib/reports/clientDetails/finance.pure';

export {
  buildHouseholdIncome,
  buildPropertyExpenditure,
  freqToMonthly,
  isInvestmentProperty,
} from '@/lib/reports/clientDetails/finance.pure';

/** As the pure module, with the ATO bracket estimator supplied. */
export function computeLiabilityServicing(
  lib: LiabilityRowLike,
  opts: LiabilityServicingOptions = {},
): LiabilityServicing {
  return computeLiabilityServicingPure(lib, { hecsMonthlyFor: getHecsRepayment, ...opts });
}

/** As the pure module, with the ATO bracket estimator supplied. */
export function buildLiabilityServicing(
  liabilities: LiabilityRowLike[],
  opts: LiabilityServicingOptions = {},
): LiabilityServicingSummary {
  return buildLiabilityServicingPure(liabilities, { hecsMonthlyFor: getHecsRepayment, ...opts });
}

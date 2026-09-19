/**
 * Household income, liability servicing and property cash flow.
 *
 * Moved here from `src/utils/householdFinance.ts` so that the browser and the
 * server cannot disagree about what a household earns. Its rules are unchanged
 * and its original header is reproduced below, because they are the reason this
 * module exists at all:
 *
 * > Rules baked in here (do NOT duplicate elsewhere):
 * >  1. `client_employment` is the source of truth for salary income. The
 * >     legacy `client_income` table is only consulted per contact when no
 * >     employment row exists.
 * >  2. Secondary contact income MUST be aggregated separately and added to
 * >     the household total.
 * >  3. Non-employment income from `client_income_sources` (dividends,
 * >     government payments, trust distributions, child support, etc.) is
 * >     itemised on its own row so the figure is fully traceable.
 * >  4. Owner-occupied mortgage repayments are reported as
 * >     "Home Loan Repayments", NOT as "Property Holding Costs".
 * >  5. Credit cards with $0 captured monthly repayment fall back to the
 * >     APRA-style 3% of credit-limit (or balance) estimate. BNPL → 5%.
 * >     Other loans with $0 captured but a positive balance fall back to a
 * >     P&I estimate. HECS uses ATO brackets via getHecsRepayment().
 *
 * `src/utils/householdFinance.ts` is now the browser's binding to this file: it
 * re-exports everything and supplies the one thing a pure module cannot have —
 * see below.
 *
 * ## The one dependency that could not come across
 *
 * Rule 5's HECS estimate called `getHecsRepayment`, which reaches
 * `src/utils/policyEngine.ts` for the ATO bracket table. Dragging the policy
 * engine into a report format would be a much larger move than this one, so the
 * estimator is **injected**: `hecsMonthlyFor` in the options. The browser passes
 * `getHecsRepayment` and behaves exactly as it did; a caller that does not pass
 * one gets the captured repayment and a note saying so.
 *
 * **No row in the record exercises this.** Measured across all 96
 * `client_liabilities` rows, the types present are `other` (31), `credit_card`
 * (28), `vehicle_loan` (13), `personal_loan` (12), `student_loan` (10),
 * `car_loan` (1) and `mortgage` (1). There is no `hecs` and no `help`, so the
 * branch this note is about has never fired in production — student debt is
 * recorded as `student_loan`, which takes the ordinary path, and all ten of
 * those rows carry a captured repayment.
 *
 * That measurement also turned up a latent mismatch left as it was found:
 * `ASSUMED_TERMS` keys `car_loan` (1 row) but not `vehicle_loan` (13 rows), so
 * a vehicle loan with no captured repayment would be estimated on the generic
 * `other` terms rather than a car's. No such row exists today.
 */

export type IncomeFrequency =
  | 'weekly' | 'fortnightly' | 'monthly'
  | 'annual' | 'annually' | 'yearly' | string | null | undefined;

export const freqToMonthly = (amount: number, freq?: IncomeFrequency): number => {
  const a = Number(amount) || 0;
  const f = String(freq || 'annual').toLowerCase();
  if (f === 'weekly') return a * (52 / 12);
  if (f === 'fortnightly') return a * (26 / 12);
  if (f === 'monthly') return a;
  return a / 12;
};

const isOwnerOccupiedType = (t?: string | null) => {
  const v = String(t || '').toLowerCase();
  return ['owner_occupied', 'ppor', 'principal_place_of_residence', 'home'].includes(v);
};

// ─── Income ────────────────────────────────────────────────────────────────
export interface EmploymentRowLike {
  contact_type?: string | null;
  is_current?: boolean | null;
  gross_annual_salary?: number | null;
  salary_amount?: number | null;
  salary_frequency?: string | null;
  bonus?: number | null;
  commission?: number | null;
  overtime_essential?: number | null;
  overtime_non_essential?: number | null;
  allowance?: number | null;
  other_taxable_income?: number | null;
}

export interface IncomeRowLike {
  contact_type?: string | null;
  gross_salary?: number | null;
  salary_frequency?: string | null;
  bonus?: number | null;
  commission?: number | null;
  overtime_essential?: number | null;
  overtime_non_essential?: number | null;
  allowance?: number | null;
  other_taxable_income?: number | null;
}

export interface IncomeSourceRowLike {
  is_active?: boolean | null;
  source_category?: string | null;
  source_type?: string | null;
  source_name?: string | null;
  contact_type?: string | null;
  gross_annual_amount?: number | null;
  input_amount?: number | null;
  input_frequency?: string | null;
}

export interface OtherIncomeLine {
  label: string;
  monthly: number;
  contactType: 'primary' | 'secondary' | string;
}

export interface HouseholdIncome {
  primaryEmploymentMonthly: number;
  secondaryEmploymentMonthly: number;
  totalEmploymentMonthly: number;
  byContactMonthly: Record<string, number>;
  otherIncome: OtherIncomeLine[];
  totalOtherIncomeMonthly: number;
  totalRentalMonthly: number;
  totalMonthly: number;
  totalGrossAnnual: number;
}

export interface BuildIncomeOptions {
  employment?: EmploymentRowLike[];
  income?: IncomeRowLike[];
  incomeSources?: IncomeSourceRowLike[];
  /** Aggregated monthly rental income across investment properties. */
  monthlyRentalIncome?: number;
}

export function buildHouseholdIncome(opts: BuildIncomeOptions): HouseholdIncome {
  const employment = opts.employment ?? [];
  const income = opts.income ?? [];
  const incomeSources = opts.incomeSources ?? [];
  const monthlyRental = Number(opts.monthlyRentalIncome) || 0;

  const byContact: Record<string, number> = {};
  for (const e of employment) {
    if (e.is_current === false) continue;
    const key = String(e.contact_type || 'primary').toLowerCase();
    const base = Number(e.gross_annual_salary || e.salary_amount || 0);
    const baseMonthly = base ? freqToMonthly(base, e.salary_frequency) : 0;
    const extras =
      ((e.bonus || 0) + (e.commission || 0) + (e.overtime_essential || 0) +
       (e.overtime_non_essential || 0) + (e.allowance || 0) + (e.other_taxable_income || 0)) / 12;
    byContact[key] = (byContact[key] || 0) + baseMonthly + extras;
  }
  for (const inc of income) {
    const key = String(inc.contact_type || 'primary').toLowerCase();
    if (byContact[key]) continue; // employment row wins
    const baseMonthly = freqToMonthly(Number(inc.gross_salary || 0), inc.salary_frequency);
    const extras =
      ((inc.bonus || 0) + (inc.commission || 0) + (inc.overtime_essential || 0) +
       (inc.overtime_non_essential || 0) + (inc.allowance || 0) + (inc.other_taxable_income || 0)) / 12;
    byContact[key] = baseMonthly + extras;
  }

  const primary = byContact['primary'] || 0;
  const secondary = Object.entries(byContact)
    .filter(([k]) => k !== 'primary')
    .reduce((s, [, v]) => s + v, 0);

  const otherIncome: OtherIncomeLine[] = incomeSources
    .filter((s) => s.is_active !== false)
    .filter((s) => !['employment', 'salary', 'paye', 'wages']
      .includes(String(s.source_category || '').toLowerCase()))
    .map((s) => {
      const annual = Number(s.gross_annual_amount || 0);
      const inputAmt = Number(s.input_amount || 0);
      const monthly = annual > 0
        ? annual / 12
        : (inputAmt > 0 ? freqToMonthly(inputAmt, s.input_frequency) : 0);
      const label = s.source_name || s.source_type || s.source_category || 'Other income';
      const contactType = String(s.contact_type || 'primary').toLowerCase();
      const who = contactType === 'primary' ? '' : ' (Secondary)';
      return { label: `${label}${who}`, monthly, contactType };
    })
    .filter((s) => s.monthly > 0);

  const totalEmployment = primary + secondary;
  const totalOther = otherIncome.reduce((s, x) => s + x.monthly, 0);
  const totalMonthly = totalEmployment + totalOther + monthlyRental;

  return {
    primaryEmploymentMonthly: primary,
    secondaryEmploymentMonthly: secondary,
    totalEmploymentMonthly: totalEmployment,
    byContactMonthly: byContact,
    otherIncome,
    totalOtherIncomeMonthly: totalOther,
    totalRentalMonthly: monthlyRental,
    totalMonthly,
    totalGrossAnnual: totalMonthly * 12,
  };
}

// ─── Liability servicing ───────────────────────────────────────────────────
export interface LiabilityRowLike {
  id?: string;
  liability_type?: string | null;
  provider_name?: string | null;
  current_balance?: number | null;
  credit_limit?: number | null;
  monthly_repayment?: number | null;
}

export interface LiabilityServicing {
  id?: string;
  type: string;
  label: string;
  balance: number;
  limit?: number;
  monthlyServicing: number;
  captured: number;
  isEstimated: boolean;
  calculationNote: string;
}

const ASSUMED_TERMS: Record<string, { rate: number; years: number; label: string }> = {
  car_loan:      { rate: 0.08, years: 5, label: 'Est. P&I @ 8% / 5yr' },
  personal_loan: { rate: 0.10, years: 7, label: 'Est. P&I @ 10% / 7yr' },
  afterpay_bnpl: { rate: 0,    years: 0, label: '5% of limit/balance' },
  other:         { rate: 0.09, years: 5, label: 'Est. P&I @ 9% / 5yr' },
};

const estimatePIRepayment = (balance: number, annualRate: number, years: number): number => {
  if (balance <= 0 || years <= 0) return 0;
  const monthlyRate = annualRate / 12;
  const periods = years * 12;
  if (monthlyRate === 0) return balance / periods;
  return balance * (monthlyRate * Math.pow(1 + monthlyRate, periods)) /
                   (Math.pow(1 + monthlyRate, periods) - 1);
};

export interface LiabilityServicingOptions {
  totalGrossAnnualIncome?: number;
  balanceOverride?: number;
  limitOverride?: number;
  /**
   * The ATO-bracket HECS estimator, injected.
   *
   * A pure module cannot reach `policyEngine.ts` for the bracket table, and
   * moving that table here would drag the whole policy engine into a report
   * format. The browser passes `getHecsRepayment`; a caller that passes nothing
   * gets the captured repayment and a note saying it was not estimated — which
   * for a document recording what a client actually pays is arguably the more
   * correct answer, and an estimate belongs in a capacity assessment instead.
   */
  hecsMonthlyFor?: (annualIncome: number) => number;
}

export function computeLiabilityServicing(
  lib: LiabilityRowLike,
  opts: LiabilityServicingOptions = {},
): LiabilityServicing {
  const balance = opts.balanceOverride ?? (Number(lib.current_balance) || 0);
  const creditLimit = opts.limitOverride ?? (Number(lib.credit_limit) || 0);
  const captured = Number(lib.monthly_repayment) || 0;
  const type = String(lib.liability_type || 'other').toLowerCase();

  let monthlyServicing = captured;
  let isEstimated = false;
  let calculationNote = '';

  if (type === 'credit_card' || type.includes('credit')) {
    const base = creditLimit > 0 ? creditLimit : balance;
    monthlyServicing = Math.round(base * 0.03);
    isEstimated = captured === 0;
    calculationNote = '3% of credit limit';
  } else if (type === 'afterpay_bnpl' || type === 'bnpl') {
    const bnplBase = Math.max(creditLimit, balance);
    monthlyServicing = Math.round(bnplBase * 0.05);
    isEstimated = captured === 0;
    calculationNote = '5% of limit/balance';
  } else if (type === 'hecs' || type === 'help') {
    const annualIncome = Number(opts.totalGrossAnnualIncome) || 0;
    if (opts.hecsMonthlyFor) {
      monthlyServicing = opts.hecsMonthlyFor(annualIncome);
      isEstimated = true;
      calculationNote = monthlyServicing > 0
        ? `${((monthlyServicing * 12) / Math.max(annualIncome, 1) * 100).toFixed(1)}% of income (ATO brackets)`
        : 'Below repayment threshold';
    } else {
      monthlyServicing = captured;
      calculationNote = 'As recorded; not estimated';
    }
  } else if (captured === 0 && balance > 0) {
    const assumed = ASSUMED_TERMS[type] || ASSUMED_TERMS.other;
    monthlyServicing = Math.round(estimatePIRepayment(balance, assumed.rate, assumed.years));
    isEstimated = true;
    calculationNote = assumed.label;
  }

  return {
    id: lib.id,
    type,
    label: lib.provider_name || type,
    balance,
    limit: (type === 'credit_card' || type === 'afterpay_bnpl') ? creditLimit : undefined,
    monthlyServicing: Math.round(monthlyServicing * 100) / 100,
    captured,
    isEstimated,
    calculationNote,
  };
}

export interface LiabilityServicingSummary {
  items: LiabilityServicing[];
  totalMonthly: number;
  hasEstimated: boolean;
  hasAny: boolean;
}

export function buildLiabilityServicing(
  liabilities: LiabilityRowLike[],
  opts: LiabilityServicingOptions = {},
): LiabilityServicingSummary {
  const items = (liabilities || []).map((l) => computeLiabilityServicing(l, opts));
  return {
    items,
    totalMonthly: items.reduce((s, x) => s + x.monthlyServicing, 0),
    hasEstimated: items.some((x) => x.isEstimated && x.monthlyServicing > 0),
    hasAny: items.length > 0,
  };
}

// ─── Property holding costs / home loan repayments ─────────────────────────
export interface PropertyRowLike {
  property_type?: string | null;
  monthly_interest_repayment?: number | null;
  monthly_body_corporate?: number | null;
  monthly_landlord_insurance?: number | null;
  monthly_building_insurance?: number | null;
  monthly_repairs_maintenance?: number | null;
  monthly_property_management?: number | null;
  monthly_council_rates?: number | null; // annual
  monthly_water_rates?: number | null;   // annual
}

export const isInvestmentProperty = (p: PropertyRowLike): boolean =>
  !!p.property_type && !isOwnerOccupiedType(p.property_type);

const sumTrueHolding = (p: PropertyRowLike): number =>
  (p.monthly_body_corporate || 0) +
  (p.monthly_landlord_insurance || 0) +
  (p.monthly_building_insurance || 0) +
  (p.monthly_repairs_maintenance || 0) +
  (p.monthly_property_management || 0) +
  ((p.monthly_council_rates || 0) / 12) +
  ((p.monthly_water_rates || 0) / 12);

export interface PropertyExpenditure {
  homeLoanRepayments: number;        // owner-occupied loan interest/repayments
  investmentHoldingCosts: number;    // investment loan interest + true costs
  ownerOccHoldingCosts: number;      // true holding costs on owner-occupied
  totalHoldingCosts: number;         // both investment + owner-occ true costs
}

export function buildPropertyExpenditure(properties: PropertyRowLike[]): PropertyExpenditure {
  const props = properties || [];
  const investment = props.filter(isInvestmentProperty);
  const ownerOcc = props.filter((p) => !isInvestmentProperty(p));

  const investmentHoldingCosts = investment.reduce(
    (s, p) => s + sumTrueHolding(p) + (p.monthly_interest_repayment || 0), 0);
  const ownerOccHoldingCosts = ownerOcc.reduce((s, p) => s + sumTrueHolding(p), 0);
  const homeLoanRepayments = ownerOcc.reduce(
    (s, p) => s + (p.monthly_interest_repayment || 0), 0);

  return {
    homeLoanRepayments,
    investmentHoldingCosts,
    ownerOccHoldingCosts,
    totalHoldingCosts: investmentHoldingCosts + ownerOccHoldingCosts,
  };
}

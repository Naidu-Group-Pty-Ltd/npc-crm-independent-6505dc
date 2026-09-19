/**
 * Decimal-safe monetary and ratio helpers for the Commercial & Industrial
 * assessment engine.
 *
 * Currency is carried as AUD *cents* (a safe integer) for every intermediate
 * step, so a chain of additions can never accumulate binary floating-point
 * drift the way `0.1 + 0.2` does. Dollars only reappear at the boundary —
 * when a value is read out of the engine for display, storage or a report.
 *
 * Rounding rules (documented once, applied everywhere):
 *  - money        → half-up to the nearest cent
 *  - display money→ half-up to the nearest whole dollar
 *  - ratios       → 4 decimal places (0.6512 = 65.12% LVR)
 *  - percentages  → 2 decimal places when expressed as 0-100
 *
 * Half-up (not banker's rounding) matches how lenders and conveyancers quote
 * figures in Australia, and matters because a repeated banker's-rounded cent
 * on a schedule of 360 repayments is visible in the total.
 */

/** A monetary amount in whole AUD cents. Always an integer. */
export type Cents = number;

const CENTS_PER_DOLLAR = 100;

/** Half-up rounding that behaves correctly for negative numbers. */
export function roundHalfUp(value: number, decimals = 0): number {
  if (!Number.isFinite(value)) return 0;
  const factor = Math.pow(10, decimals);
  const scaled = value * factor;
  // Nudge by an epsilon proportional to the magnitude so that values which are
  // mathematically exact but stored a hair below (e.g. 2.675 → 2.67499…)
  // still round the way a human reading the decimal expects.
  const epsilon = Math.abs(scaled) * Number.EPSILON * 4;
  const adjusted = scaled >= 0 ? scaled + epsilon : scaled - epsilon;
  const rounded = adjusted >= 0
    ? Math.floor(adjusted + 0.5)
    : Math.ceil(adjusted - 0.5);
  return rounded / factor;
}

/** Convert a dollar figure (possibly undefined/NaN) into integer cents. */
export function toCents(dollars: number | null | undefined): Cents {
  if (dollars == null || !Number.isFinite(dollars)) return 0;
  return roundHalfUp(dollars * CENTS_PER_DOLLAR, 0);
}

/** Convert integer cents back to dollars, exact to 2dp. */
export function toDollars(cents: Cents): number {
  if (!Number.isFinite(cents)) return 0;
  return roundHalfUp(cents / CENTS_PER_DOLLAR, 2);
}

/** Convert cents to whole dollars — the display and report rounding rule. */
export function toWholeDollars(cents: Cents): number {
  if (!Number.isFinite(cents)) return 0;
  return roundHalfUp(cents / CENTS_PER_DOLLAR, 0);
}

/** Sum a list of cent amounts, ignoring nullish entries. */
export function sumCents(...values: Array<Cents | null | undefined>): Cents {
  return values.reduce<Cents>((total, value) => {
    if (value == null || !Number.isFinite(value)) return total;
    return total + Math.trunc(value);
  }, 0);
}

/** Multiply a cent amount by a unitless factor, re-rounding to whole cents. */
export function multiplyCents(cents: Cents, factor: number): Cents {
  if (!Number.isFinite(cents) || !Number.isFinite(factor)) return 0;
  return roundHalfUp(cents * factor, 0);
}

/**
 * Apply a percentage expressed on a 0-100 scale (e.g. `5` = 5%).
 * Percentages arrive from the UI on that scale, never as fractions.
 */
export function percentOfCents(cents: Cents, percent: number): Cents {
  return multiplyCents(cents, safePercent(percent) / 100);
}

/** Divide two cent amounts into a unitless ratio; 0 when the divisor is 0. */
export function ratio(numeratorCents: Cents, denominatorCents: Cents): number {
  if (!Number.isFinite(numeratorCents) || !Number.isFinite(denominatorCents)) return 0;
  if (denominatorCents === 0) return 0;
  return roundHalfUp(numeratorCents / denominatorCents, 4);
}

/** Round a unitless ratio (LVR, DSCR, ICR) to the engine's 4dp standard. */
export function roundRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return roundHalfUp(value, 4);
}

/** Round a 0-100 percentage to the engine's 2dp standard. */
export function roundPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return roundHalfUp(value, 2);
}

/** Clamp a percentage input to a sane 0-100 band without throwing. */
export function safePercent(value: number | null | undefined, max = 100): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(0, value));
}

/** Coerce arbitrary user input to a finite number, defaulting to 0. */
export function num(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.replace(/[$,\s]/g, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

/** Read a dollar-denominated field off an arbitrary object as cents. */
export function centsOf(value: unknown): Cents {
  return toCents(num(value, 0));
}

/**
 * Annual interest-only cost of a facility.
 * `ratePct` is on the 0-100 scale.
 */
export function annualInterestCents(principalCents: Cents, ratePct: number): Cents {
  if (principalCents <= 0) return 0;
  return multiplyCents(principalCents, Math.max(0, num(ratePct)) / 100);
}

/**
 * Annual principal-and-interest cost of an amortising facility, optionally
 * with a balloon/residual balance outstanding at the end of the term.
 *
 * A residual reduces the amount that must be amortised: the present value of
 * the balloon is subtracted from the principal before the annuity factor is
 * applied, which is how lenders quote a residual-term repayment.
 */
export function annualPrincipalAndInterestCents(
  principalCents: Cents,
  ratePct: number,
  amortisationYears: number,
  residualCents: Cents = 0,
): Cents {
  if (principalCents <= 0) return 0;
  const rate = Math.max(0, num(ratePct));
  const years = num(amortisationYears);
  if (years <= 0) return annualInterestCents(principalCents, rate);

  const monthlyRate = rate / 100 / 12;
  const periods = Math.round(years * 12);
  const residual = Math.max(0, Math.min(residualCents, principalCents));

  if (monthlyRate === 0) {
    return roundHalfUp(((principalCents - residual) / periods) * 12, 0);
  }

  const discount = Math.pow(1 + monthlyRate, -periods);
  const amortising = principalCents - residual * discount;
  const monthly = (amortising * monthlyRate) / (1 - discount);
  return roundHalfUp(monthly * 12, 0);
}

/**
 * Annual debt service for a facility given its repayment shape.
 * Interest-only periods are assessed at their interest cost; a facility that
 * amortises after an IO period is assessed on the *post-IO* amortisation
 * profile, because that is the payment the borrower must eventually meet.
 */
export function annualDebtServiceCents(input: {
  principalCents: Cents;
  ratePct: number;
  repaymentType: 'interestOnly' | 'principalAndInterest' | 'residualTerm';
  amortisationYears?: number;
  residualCents?: Cents;
}): Cents {
  const { principalCents, ratePct, repaymentType } = input;
  if (principalCents <= 0) return 0;
  if (repaymentType === 'interestOnly') {
    return annualInterestCents(principalCents, ratePct);
  }
  return annualPrincipalAndInterestCents(
    principalCents,
    ratePct,
    num(input.amortisationYears, 0),
    repaymentType === 'residualTerm' ? num(input.residualCents, 0) : 0,
  );
}

/**
 * Largest principal whose annual P&I cost does not exceed `capacityCents`.
 * The inverse of {@link annualPrincipalAndInterestCents} with no residual.
 */
export function principalForAnnualPayment(
  capacityCents: Cents,
  ratePct: number,
  amortisationYears: number,
): Cents {
  if (capacityCents <= 0) return 0;
  const rate = Math.max(0, num(ratePct));
  const years = num(amortisationYears);
  if (rate <= 0) {
    return years > 0 ? roundHalfUp((capacityCents / 12) * years * 12, 0) : 0;
  }
  if (years <= 0) {
    // Interest-only: principal = annual capacity / rate.
    return roundHalfUp(capacityCents / (rate / 100), 0);
  }
  const monthlyRate = rate / 100 / 12;
  const periods = Math.round(years * 12);
  const monthlyCapacity = capacityCents / 12;
  return roundHalfUp((monthlyCapacity * (1 - Math.pow(1 + monthlyRate, -periods))) / monthlyRate, 0);
}

/** Format cents as AUD for UI surfaces. Whole dollars — reports never show cents. */
export function formatMoney(cents: Cents | null | undefined, options?: { compact?: boolean }): string {
  if (cents == null || !Number.isFinite(cents)) return '—';
  const dollars = toWholeDollars(cents);
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
    notation: options?.compact ? 'compact' : 'standard',
  }).format(dollars);
}

/** Format a unitless ratio as a coverage multiple, e.g. `1.42x`. */
export function formatMultiple(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return '—';
  return `${roundHalfUp(value, 2).toFixed(2)}x`;
}

/** Format a unitless ratio as a percentage, e.g. 0.6512 → `65.1%`. */
export function formatRatioPercent(value: number | null | undefined, decimals = 1): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${roundHalfUp(value * 100, decimals).toFixed(decimals)}%`;
}

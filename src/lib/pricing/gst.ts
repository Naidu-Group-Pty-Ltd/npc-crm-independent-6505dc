/**
 * Australian GST, for prices that already contain it, and the commitment
 * discount that prices the annual plan.
 *
 * Every figure in the signed-off price list is tax-inclusive: the number is
 * what a customer pays. So GST is derived by dividing by 11, never by
 * multiplying by 1.1 — inverting that overstates every price by 10%.
 *
 * Mirrors Mission Control's `aurixa-catalog.ts`, which is the source of truth.
 * Duplicated rather than imported because this is a separate deployment that
 * only talks to Mission Control over HTTP.
 */
export const GST_DIVISOR = 11;

/**
 * A 12-month commitment takes 15% off the plan's price, in basis points so the
 * arithmetic stays in whole cents.
 *
 * This is clause 5.1 of the Subscription Agreement. The owner decided on
 * 25 September 2026 that the price list follows it, so the annual plan (a
 * 12-month commitment paid up front) takes the same 15%. It took 10% before.
 */
export const COMMITMENT_DISCOUNT_BPS = 1500;

/** The same discount as a fraction, for saying "15%". The arithmetic uses the basis points. */
export const ANNUAL_DISCOUNT = COMMITMENT_DISCOUNT_BPS / 10_000;

/** The GST contained within a tax-inclusive amount. */
export const gstComponentCents = (inclGstCents: number): number =>
  Math.round(inclGstCents / GST_DIVISOR);

/** The ex-GST (net) amount of a tax-inclusive total. */
export const exGstCents = (inclGstCents: number): number =>
  inclGstCents - gstComponentCents(inclGstCents);

/** What a 12-month commitment takes off one month of a tax-inclusive price, to the cent. */
export const commitmentDiscountCents = (monthlyInclGstCents: number): number =>
  Math.round((monthlyInclGstCents * COMMITMENT_DISCOUNT_BPS) / 10_000);

/**
 * Annual charge for a monthly tax-inclusive price: twelve discounted months.
 * The discount comes off each month and is rounded to the cent before the
 * twelve are added up. That is the order Mission Control mints the annual
 * Stripe price in, so the two agree to the cent for any price.
 */
export const annualCents = (monthlyInclGstCents: number): number =>
  (monthlyInclGstCents - commitmentDiscountCents(monthlyInclGstCents)) * 12;

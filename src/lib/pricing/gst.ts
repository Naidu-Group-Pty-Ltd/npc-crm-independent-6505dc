/**
 * Australian GST, for prices that already contain it.
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
export const ANNUAL_DISCOUNT = 0.1;

/** The GST contained within a tax-inclusive amount. */
export const gstComponentCents = (inclGstCents: number): number =>
  Math.round(inclGstCents / GST_DIVISOR);

/** The ex-GST (net) amount of a tax-inclusive total. */
export const exGstCents = (inclGstCents: number): number =>
  inclGstCents - gstComponentCents(inclGstCents);

/** Annual charge for a monthly tax-inclusive price: twelve months less 10%. */
export const annualCents = (monthlyInclGstCents: number): number =>
  Math.round(monthlyInclGstCents * 12 * (1 - ANNUAL_DISCOUNT));

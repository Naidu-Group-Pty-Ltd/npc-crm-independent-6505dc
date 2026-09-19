/**
 * Cap Rate / Yield Calculators
 *  - Passing Yield = NOI based on CURRENT (passing) rent / Price
 *  - Reversionary Yield = NOI based on MARKET rent / Price
 *  - Blended Yield / Simple Average Yield approximation = weighted average using over/under-rented adjustment
 */

export interface CapRateInputs {
  noi: number | string | null | undefined;
  price: number | string | null | undefined;
}

const parseNumeric = (value: number | string | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(/[$,£€¥₹\s]/g, '').replace(/%$/, ''));
  return Number.isFinite(parsed) ? parsed : null;
};

export function capRate({ noi, price }: CapRateInputs): number | null {
  const parsedNoi = parseNumeric(noi);
  const parsedPrice = parseNumeric(price);
  if (parsedNoi === null || parsedPrice === null || parsedPrice <= 0) return null;
  return Number(((parsedNoi / parsedPrice) * 100).toFixed(2));
}

export interface YieldSetInputs {
  passingNoi: number | string | null | undefined;
  marketNoi: number | string | null | undefined;
  price: number | string | null | undefined;
}

export interface YieldSetResult {
  passingYield: number | null;
  reversionaryYield: number | null;
  equivalentYield: number | null;
  blendedYield: number | null;
  simpleAverageYield: number | null;
}

export function calculateYields({ passingNoi, marketNoi, price }: YieldSetInputs): YieldSetResult {
  const passing = capRate({ noi: passingNoi, price });
  const reversionary = capRate({ noi: marketNoi, price });
  // Simple equivalent yield: arithmetic mean of passing & reversionary
  // (Full equivalent yield is IRR of rent reversions — done in DCF engine)
  const equivalent = passing !== null && reversionary !== null ? Number(((passing + reversionary) / 2).toFixed(2)) : null;
  return { passingYield: passing, reversionaryYield: reversionary, equivalentYield: equivalent, blendedYield: equivalent, simpleAverageYield: equivalent };
}

/** Value derived from a NOI and target cap rate (cap rate as %) */
export function valueFromCap(noi: number | string | null | undefined, capPct: number | string | null | undefined): number | null {
  const parsedNoi = parseNumeric(noi);
  const parsedCapPct = parseNumeric(capPct);
  if (parsedNoi === null || parsedCapPct === null || parsedCapPct <= 0) return null;
  return parsedNoi / (parsedCapPct / 100);
}

/**
 * Slim ATO income tax helper for the chat-preview BC kernel.
 *
 * Mirrors the Stage 3 (FY2024-25) resident tax brackets used by the canonical
 * `calculate-borrowing-capacity` engine. The chat preview is directional —
 * the post-Apply engine produces the canonical figure — so we deliberately
 * avoid Medicare levy / LITO complexity here. Discrepancy stays within the
 * rounding band the broker already tolerates between preview and Apply.
 */

interface TaxBracket {
  threshold: number;
  rate: number;
}

// FY2024-25 resident brackets (Stage 3 cuts in effect)
const BRACKETS: TaxBracket[] = [
  { threshold: 18_200, rate: 0 },
  { threshold: 45_000, rate: 0.16 },
  { threshold: 135_000, rate: 0.30 },
  { threshold: 190_000, rate: 0.37 },
  { threshold: Infinity, rate: 0.45 },
];

export function getTaxBreakdown(assessableIncome: number): {
  taxPayable: number;
  afterTaxIncome: number;
} {
  if (!Number.isFinite(assessableIncome) || assessableIncome <= 0) {
    return { taxPayable: 0, afterTaxIncome: 0 };
  }
  let tax = 0;
  let lower = 0;
  for (const bracket of BRACKETS) {
    if (assessableIncome <= bracket.threshold) {
      tax += (assessableIncome - lower) * bracket.rate;
      break;
    }
    tax += (bracket.threshold - lower) * bracket.rate;
    lower = bracket.threshold;
  }
  return {
    taxPayable: Math.round(tax),
    afterTaxIncome: Math.round(assessableIncome - tax),
  };
}

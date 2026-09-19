/**
 * LMI (Lenders Mortgage Insurance) — Deno mirror.
 *
 * Compact version of `src/utils/lmiCalculations.ts` focused on what the
 * scenario engine needs: estimate premium from LVR and loan size with optional
 * FHB discount. Kept structurally identical so values match the client preview.
 */

export type LmiMode = 'none' | 'display_deduction' | 'debt_capitalised';

interface RateTier {
  lvrMin: number; lvrMax: number; band: string;
  rates: { maxLoan: number; rate: number }[];
}

const LMI_RATE_TABLE: RateTier[] = [
  { lvrMin: 0,     lvrMax: 80,    band: '≤ 80%',          rates: [{ maxLoan: Infinity, rate: 0 }] },
  { lvrMin: 80.01, lvrMax: 85,    band: '80.01% – 85%',
    rates: [
      { maxLoan: 300000, rate: 0.50 }, { maxLoan: 500000, rate: 0.67 },
      { maxLoan: 750000, rate: 0.85 }, { maxLoan: 1000000, rate: 1.05 },
      { maxLoan: Infinity, rate: 1.20 },
    ] },
  { lvrMin: 85.01, lvrMax: 90,    band: '85.01% – 90%',
    rates: [
      { maxLoan: 300000, rate: 1.40 }, { maxLoan: 500000, rate: 1.75 },
      { maxLoan: 750000, rate: 2.10 }, { maxLoan: 1000000, rate: 2.50 },
      { maxLoan: Infinity, rate: 2.80 },
    ] },
  { lvrMin: 90.01, lvrMax: 95,    band: '90.01% – 95%',
    rates: [
      { maxLoan: 300000, rate: 2.90 }, { maxLoan: 500000, rate: 3.30 },
      { maxLoan: 750000, rate: 3.70 }, { maxLoan: 1000000, rate: 4.10 },
      { maxLoan: Infinity, rate: 4.50 },
    ] },
];

export function calculateLVR(loan: number, value: number): number {
  if (value <= 0) return 0;
  return Math.round((loan / value) * 10000) / 100;
}

export function estimateLmi(args: {
  propertyValue: number;
  loanAmount: number;
  isFirstHomeBuyer?: boolean;
}): { lmiAmount: number; lvr: number; band: string; rate: number; required: boolean } {
  const lvr = calculateLVR(args.loanAmount, args.propertyValue);
  if (lvr <= 80 || args.loanAmount <= 0 || args.propertyValue <= 0) {
    return { lmiAmount: 0, lvr, band: '≤ 80%', rate: 0, required: false };
  }
  const tier = LMI_RATE_TABLE.find(t => lvr >= t.lvrMin && lvr <= t.lvrMax);
  if (!tier) return { lmiAmount: 0, lvr, band: 'Unknown', rate: 0, required: true };
  let rate = 0;
  for (const r of tier.rates) {
    if (args.loanAmount <= r.maxLoan) { rate = r.rate; break; }
  }
  if (args.isFirstHomeBuyer && rate > 0) rate *= 0.85;
  const lmiAmount = Math.round(args.loanAmount * (rate / 100));
  return { lmiAmount, lvr, band: tier.band, rate: Math.round(rate * 100) / 100, required: true };
}

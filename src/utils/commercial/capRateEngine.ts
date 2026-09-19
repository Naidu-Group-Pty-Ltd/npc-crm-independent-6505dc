export type CapRateNoiBasis = 'passing' | 'market' | 'actual' | 'stabilised' | 'lenderAdjusted';
export type NumericInput = number | string | null | undefined;

export interface CapRateEngineInputs {
  passingNoi: NumericInput;
  marketNoi: NumericInput;
  selectedNoi?: NumericInput;
  stabilisedNoi?: NumericInput;
  lenderAdjustedNoi?: NumericInput;
  price: NumericInput;
  targetCapRatePct: NumericInput;
  valuationBasis?: CapRateNoiBasis;
  sensitivityCapRatesPct?: NumericInput[];
  benchmarkLowPct?: NumericInput;
  benchmarkHighPct?: NumericInput;
  aiBenchmark?: boolean;
}
export interface CapRateEngineResult {
  passingYield: number | null;
  reversionaryYield: number | null;
  blendedYield: number | null;
  simpleAverageYield: number | null;
  selectedNoi: number | null;
  impliedValue: number | null;
  valuationGap: number | null;
  valuationGapPct: number | null;
  valueSensitivity: Array<{ capRatePct: number; impliedValue: number | null }>;
  warnings: string[];
  benchmarkLabel?: string;
}

export const parseCapRateNumber = (value: NumericInput): number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalised = trimmed.replace(/[$,£€¥₹\s]/g, '').replace(/%$/, '');
  if (!normalised) return null;
  const parsed = Number(normalised);
  return Number.isFinite(parsed) ? parsed : null;
};

const round2 = (n: number) => Number(n.toFixed(2));
const safePositive = (value: NumericInput) => {
  const parsed = parseCapRateNumber(value);
  return parsed !== null && parsed > 0 ? parsed : null;
};
const safeYield = (noi: number | null, price: number | null) => (noi !== null && price !== null && price > 0 ? round2((noi / price) * 100) : null);
const safeCapitalise = (noi: number | null, capRatePct: number | null) => (noi !== null && capRatePct !== null && capRatePct > 0 ? noi / (capRatePct / 100) : null);

export function selectCapRateNoi(i: CapRateEngineInputs): number | null {
  const passingNoi = parseCapRateNumber(i.passingNoi);
  const marketNoi = parseCapRateNumber(i.marketNoi);
  const stabilisedNoi = parseCapRateNumber(i.stabilisedNoi) ?? marketNoi;
  const lenderAdjustedNoi = parseCapRateNumber(i.lenderAdjustedNoi);
  const explicitSelectedNoi = parseCapRateNumber(i.selectedNoi);

  switch (i.valuationBasis) {
    case 'passing':
    case 'actual':
      return passingNoi;
    case 'market':
      return marketNoi;
    case 'stabilised':
      return stabilisedNoi;
    case 'lenderAdjusted':
      return lenderAdjustedNoi ?? explicitSelectedNoi;
    default:
      return explicitSelectedNoi ?? marketNoi ?? passingNoi;
  }
}

export function calculateCapRateEngine(i: CapRateEngineInputs): CapRateEngineResult {
  const warnings: string[] = [];
  const passingNoi = parseCapRateNumber(i.passingNoi);
  const marketNoi = parseCapRateNumber(i.marketNoi);
  const price = safePositive(i.price);
  const targetCapRatePct = safePositive(i.targetCapRatePct);
  const selectedNoi = selectCapRateNoi(i);

  if (price === null) warnings.push('Price/value is missing or invalid; yield and valuation gap are pending.');
  if (targetCapRatePct === null) warnings.push('Target cap rate is missing or invalid; implied value is pending.');
  if (selectedNoi === null) warnings.push('Selected NOI is missing or invalid; implied value is pending.');
  if (passingNoi === null) warnings.push('Passing NOI is missing or invalid; passing yield is pending.');
  if (marketNoi === null) warnings.push('Market NOI is missing or invalid; reversionary yield is pending.');
  if (i.aiBenchmark) warnings.push('AI cap-rate estimate is benchmark only — valuer confirmation required.');

  const impliedValue = safeCapitalise(selectedNoi, targetCapRatePct);
  const valuationGap = impliedValue !== null && price !== null ? impliedValue - price : null;
  const valuationGapPct = valuationGap !== null && price !== null && price > 0 ? valuationGap / price : null;
  if (impliedValue !== null && price !== null && Math.abs(impliedValue - price) / impliedValue > 0.1) warnings.push('Purchase price/value differs materially from implied value; valuation risk exists.');
  const passingYield = safeYield(passingNoi, price);
  const reversionaryYield = safeYield(marketNoi, price);
  const blendedYield = passingYield !== null && reversionaryYield !== null ? round2((passingYield + reversionaryYield) / 2) : null;

  return {
    passingYield,
    reversionaryYield,
    blendedYield,
    simpleAverageYield: blendedYield,
    selectedNoi,
    impliedValue,
    valuationGap,
    valuationGapPct,
    valueSensitivity: (i.sensitivityCapRatesPct ?? []).map(raw => {
      const capRatePct = safePositive(raw);
      return capRatePct === null ? null : { capRatePct, impliedValue: safeCapitalise(selectedNoi, capRatePct) };
    }).filter((row): row is { capRatePct: number; impliedValue: number | null } => row !== null),
    warnings,
    benchmarkLabel: i.aiBenchmark || parseCapRateNumber(i.benchmarkLowPct) || parseCapRateNumber(i.benchmarkHighPct) ? 'Benchmark only — valuer confirmation required.' : undefined,
  };
}

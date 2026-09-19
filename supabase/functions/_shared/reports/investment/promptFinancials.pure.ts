/**
 * The financial rows the generator's prompt hands the model, composed FROM
 * THE RECORD rather than from keys nothing ever wrote.
 *
 * The audit of 291 Stone Mason Drive found three interest-rate sensitivity
 * rows all labelled "Interest Rate: 6.5%" while their values reproduced
 * 5.5%, 7.5% and 8.5% (QA-08), and a projection-assumptions block that said
 * "2% / 4% / 6%" while the series had been built at 3% / 5% / 7% (QA-10).
 * Both were the prompt's doing: the sensitivity table read
 * `sensitivityAnalysis.interestRateUp.monthlyPayment`, a key the engine has
 * never written, so every cell was `$0` and the model wrote its own rows
 * with the base rate as their label; and the assumptions were a literal.
 *
 * These helpers read what the engine actually publishes
 * (`sensitivityAnalysis.scenarios`, `assumptions.scenarioGrowth`) and, for a
 * record written before those keys existed, the keys it does hold — never a
 * placeholder. A row that cannot be filled from the record is not written.
 *
 * Deno-compatible: imports a sibling only.
 */
import { groupThousands } from './figures.pure.ts';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Rec) : {});
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
// Grouped without the runtime locale: Deno and Node need not agree on ICU.
const money = (v: number): string => `$${groupThousands(Math.round(Math.abs(v)))}`;
const cash = (v: number): string => (v < 0 ? `(${money(v)})` : money(v));
const pctText = (v: number): string => `${Number(v.toFixed(2))}%`;

/**
 * The sensitivity table as Markdown rows, every row labelled with the
 * parameter it actually tested. Returns the header alone when the record
 * holds no scenarios, so the model has nothing to invent from.
 */
export function sensitivityRowsForPrompt(financials: unknown): string {
  const fin = rec(financials);
  const sens = rec(fin.sensitivityAnalysis);
  const loan = rec(fin.loanDetails);
  const metrics = rec(fin.keyMetrics);
  const baseRate = num(loan.interestRate);
  const baseNet = num(metrics.annualNet);
  const header = [
    '| Scenario | Interest rate tested | Annual cashflow (pre-tax) |',
    '|----------|----------------------|---------------------------|',
  ];
  const rows: string[] = [];

  const scenarios = Array.isArray(sens.scenarios) ? sens.scenarios.map(rec) : [];
  const rateScenarios = scenarios.filter((s) => s.kind === 'rate');
  if (rateScenarios.length) {
    if (baseRate !== undefined && baseNet !== undefined) {
      rows.push(`| Base case | ${pctText(baseRate)} | ${cash(baseNet)} |`);
    }
    for (const s of rateScenarios) {
      const rate = num(s.rate);
      const net = num(s.annualNet);
      const delta = num(s.deltaPoints);
      if (rate === undefined || net === undefined) continue;
      const change = delta === undefined ? '' : ` (${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)} pt)`;
      rows.push(`| ${delta !== undefined && delta > 0 ? 'Stress' : 'Improvement'} case | ${pctText(rate)}${change} | ${cash(net)} |`);
    }
  } else {
    // A record written before `scenarios` existed: the engine's keyed
    // deltas, labelled from the base rate they moved off.
    const changes = rec(sens.interestRateChanges);
    const keyed: Array<[string, number]> = [['minus1Percent', -1], ['plus1Percent', 1], ['plus2Percent', 2]];
    if (baseRate !== undefined && baseNet !== undefined) {
      rows.push(`| Base case | ${pctText(baseRate)} | ${cash(baseNet)} |`);
    }
    for (const [key, delta] of keyed) {
      const net = num(changes[key]);
      if (net === undefined || baseRate === undefined) continue;
      rows.push(`| ${delta > 0 ? 'Stress' : 'Improvement'} case | ${pctText(baseRate + delta)} (${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)} pt) | ${cash(net)} |`);
    }
  }
  return [...header, ...rows].join('\n');
}

/**
 * The growth each projection scenario was built at, as the assumptions
 * block. Read from `assumptions.scenarioGrowth`; for an older record the
 * rates are derived from the series themselves (value₂ / value₁ − 1), which
 * is what the table under this block was actually drawn with.
 */
export function projectionAssumptionLinesForPrompt(financials: unknown): string {
  const fin = rec(financials);
  const declared = rec(rec(fin.assumptions).scenarioGrowth);
  const projections = rec(fin.projections);
  const labels: Array<[string, string]> = [['conservative', 'Conservative Scenario'], ['moderate', 'Base Case Scenario'], ['optimistic', 'Optimistic Scenario']];
  const lines: string[] = [];
  for (const [key, label] of labels) {
    const d = rec(declared[key]);
    let capital = num(d.capitalGrowth);
    let rent = num(d.rentGrowth);
    if (capital === undefined || rent === undefined) {
      const series = Array.isArray(projections[key]) ? projections[key].map(rec) : [];
      const y1 = series[0];
      const y2 = series[1];
      const v1 = num(y1?.propertyValue); const v2 = num(y2?.propertyValue);
      const r1 = num(y1?.annualRent); const r2 = num(y2?.annualRent);
      if (capital === undefined && v1 && v2) capital = Math.round((v2 / v1 - 1) * 10000) / 100;
      if (rent === undefined && r1 && r2) rent = Math.round((r2 / r1 - 1) * 10000) / 100;
    }
    if (capital === undefined || rent === undefined) continue;
    lines.push(`- ${label}: ${pctText(capital)} annual price growth, ${pctText(rent)} annual rent growth`);
  }
  const timing = rec(fin.assumptions).growthTiming;
  if (typeof timing === 'string' && timing.trim()) lines.push(`- Timing: ${timing.trim()}`);
  const occupancy = num(rec(fin.assumptions).occupancyWeeks) ?? num(rec(fin.income).occupancyWeeks);
  if (occupancy !== undefined) lines.push(`- Occupancy: ${occupancy} weeks let per year; percentage fees charged on rent collected`);
  const structure = rec(fin.loanDetails).structure;
  if (typeof structure === 'string' && structure.trim()) lines.push(`- Loan: ${structure.trim()}`);
  return lines.length ? lines.join('\n') : '- The scenario growth rates are those recorded against the projection table below.';
}

/**
 * The month's interest on the opening balance — what an interest-only
 * repayment is. Written by the calculator now; derived here from the
 * record's own loan amount and rate for a row written before it was, so the
 * prompt's interest-only rows never print `$0`.
 */
export function interestOnlyMonthlyPaymentFor(financials: unknown): number | undefined {
  const fin = rec(financials);
  const loan = rec(fin.loanDetails);
  const stated = num(loan.interestOnlyPayment);
  if (stated !== undefined && stated > 0) return stated;
  const amount = num(loan.loanAmount) ?? num(rec(fin.initialCosts).loanAmount);
  const rate = num(loan.interestRate);
  if (amount === undefined || rate === undefined || amount <= 0 || rate <= 0) return undefined;
  return Math.round((amount * rate / 100 / 12) * 100) / 100;
}

/**
 * The financial warnings the recommendation must reconcile (QA-37).
 *
 * The audited documents recommended the purchase in prose that never
 * mentioned the year-1 shortfall, the ten-year cumulative deficit, the rate
 * shocks or the D grade that the same documents' own tables stated. The
 * generator now hands the model those facts, from the record, at the point
 * it writes the recommendation, with the rule that each must be reconciled.
 * Empty when the record states none — nothing here is estimated.
 */
export function financialWarningsForPrompt(financials: unknown, score: unknown): string {
  const fin = rec(financials);
  const metrics = rec(fin.keyMetrics);
  const loan = rec(fin.loanDetails);
  const sens = rec(fin.sensitivityAnalysis);
  const rates = rec(sens.interestRateChanges);
  const projections = rec(fin.projections);
  const moderate = Array.isArray(projections.moderate) ? projections.moderate.map(rec) : [];
  const last = moderate.length ? moderate[moderate.length - 1] : {};
  const published = Array.isArray(sens.scenarios) ? sens.scenarios.map(rec) : [];
  const labelFor = (key: string, fallback: string): string => {
    const hit = published.find((x) => x.id === key);
    return (hit && typeof hit.label === 'string' && hit.label) || fallback;
  };

  const lines: string[] = [];
  const annualNet = num(metrics.annualNet);
  const weeklyNet = num(metrics.weeklyNet);
  if (annualNet !== undefined && annualNet < 0) {
    lines.push(`- Year-1 cash shortfall: ${cash(annualNet)} a year${weeklyNet !== undefined ? ` (${cash(weeklyNet)} a week)` : ''}, before tax, which the investor funds.`);
  }
  const cumulative = num(last.cumulativeCashFlow);
  const year = num(last.year);
  if (cumulative !== undefined && cumulative < 0) {
    lines.push(`- Cumulative cash shortfall to year ${year ?? moderate.length}: ${cash(cumulative)} (base case).`);
  }
  const plus1 = num(rates.plus1Percent);
  const plus2 = num(rates.plus2Percent);
  if (plus1 !== undefined) lines.push(`- ${labelFor('plus1Percent', 'Interest rate +1%')}: annual cash position ${cash(plus1)}.`);
  if (plus2 !== undefined) lines.push(`- ${labelFor('plus2Percent', 'Interest rate +2%')}: annual cash position ${cash(plus2)}.`);
  const ioYears = num(loan.interestOnlyPeriod);
  const ioPayment = num(loan.interestOnlyPayment);
  const piPayment = num(loan.amortisingMonthlyPayment);
  if (ioYears !== undefined && ioYears > 0 && ioPayment !== undefined && piPayment !== undefined && piPayment > ioPayment) {
    lines.push(`- Repayment step-up: ${money(piPayment)} a month from year ${ioYears + 1}, up from ${money(ioPayment)} interest-only.`);
  }
  const sc = rec(score);
  const grade = typeof sc.grade === 'string' && sc.grade.trim().toUpperCase() !== 'N/A' ? sc.grade.trim() : undefined;
  const total = num(sc.totalScore);
  const recommendation = typeof sc.recommendation === 'string' ? sc.recommendation.trim() : undefined;
  if (grade && total !== undefined) {
    lines.push(`- Recorded assessment: grade ${grade}, ${Math.round(total)}/100${recommendation ? `, recommendation "${recommendation}"` : ''}.`);
  }
  if (!lines.length) return '';
  return [
    '**FINANCIAL WARNINGS THIS RECOMMENDATION MUST RECONCILE (from the recorded calculation — quote each figure exactly):**',
    ...lines,
    '',
    'Rule: the recommendation must state each warning above and say how it bears on the verdict. A recommendation that omits one, or that reads more favourably than the recorded grade without saying why, is incomplete. Do not soften a figure and do not restate it as a range.',
  ].join('\n');
}


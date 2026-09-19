/**
 * Direction-of-change commentary for the 10-year cash flow, computed from the
 * numbers rather than asserted beside them.
 *
 * The standalone cash flow of 291 Stone Mason Drive (QA-291SM, 15 Sep 2026)
 * printed gross and net yields of 0.00% in every year — its rent had not
 * reached the model — and the fixed sentence under the chart still read "This
 * compression occurs because property value appreciates faster than rental
 * income" (QA-38). A zero-to-zero series has no compression, and a series
 * built on absent rent is not assessable at all. The same page described
 * equity growth of 271.4% "over ten years" from end-of-year-1 equity — a
 * nine-year interval under a ten-year label (QA-39).
 *
 * Every sentence here names its own horizon and is derived from the two
 * endpoints it quotes.
 */

export type YieldMovementKind = 'not_assessable' | 'unchanged' | 'compression' | 'expansion';

export interface YieldMovement {
  kind: YieldMovementKind;
  /** Year-1 and year-10 yields, in percent, as the table prints them. */
  from: number | null;
  to: number | null;
  /** `to − from` in percentage points; null when not assessable. */
  deltaPoints: number | null;
  sentence: string;
}

const round2 = (v: number): number => Math.round(v * 100) / 100;
const fmt = (v: number): string => v.toFixed(2);

/**
 * The gross-yield sentence. `rentEstablished` is the caller's statement that
 * a rent reached the model; without it the yields are arithmetic on nothing.
 */
export function describeYieldMovement(input: {
  label: string;
  yearOne: number | null | undefined;
  yearTen: number | null | undefined;
  rentEstablished: boolean;
  horizon?: { from: number; to: number };
}): YieldMovement {
  const from = typeof input.yearOne === 'number' && Number.isFinite(input.yearOne) ? round2(input.yearOne) : null;
  const to = typeof input.yearTen === 'number' && Number.isFinite(input.yearTen) ? round2(input.yearTen) : null;
  const h = input.horizon ?? { from: 1, to: 10 };
  if (!input.rentEstablished || from === null || to === null) {
    return {
      kind: 'not_assessable', from, to, deltaPoints: null,
      sentence: `${input.label}: not assessable — no rental income is recorded for this property, so the yield series carries no information.`,
    };
  }
  const delta = round2(to - from);
  if (Math.abs(delta) < 0.005) {
    return {
      kind: 'unchanged', from, to, deltaPoints: 0,
      sentence: `${input.label}: unchanged at ${fmt(from)}% from Year ${h.from} to Year ${h.to}.`,
    };
  }
  if (delta < 0) {
    return {
      kind: 'compression', from, to, deltaPoints: delta,
      sentence: `${input.label}: moves from ${fmt(from)}% (Year ${h.from}) to ${fmt(to)}% (Year ${h.to}), a compression of ${fmt(Math.abs(delta))} percentage points. Yield compresses when the property's value grows faster than its rent.`,
    };
  }
  return {
    kind: 'expansion', from, to, deltaPoints: delta,
    sentence: `${input.label}: moves from ${fmt(from)}% (Year ${h.from}) to ${fmt(to)}% (Year ${h.to}), an expansion of ${fmt(delta)} percentage points. Yield expands when rent grows faster than the property's value.`,
  };
}

export interface GrowthStatistic {
  /** Percent change, or null where the start value is not a positive figure. */
  percent: number | null;
  startLabel: string;
  endLabel: string;
  sentence: string;
}

/**
 * A growth statistic with its own start and end named. The cash flow used to
 * divide by END-OF-YEAR-1 equity and call the result "over ten years"; the
 * settlement figure is the ten-year base, and the year-1 figure is a nine-year
 * one. Both are valid — only when they say which they are.
 */
export function describeGrowth(input: {
  label: string;
  startValue: number | null | undefined;
  endValue: number | null | undefined;
  startLabel: string;
  endLabel: string;
  formatValue: (v: number) => string;
}): GrowthStatistic {
  const start = typeof input.startValue === 'number' && Number.isFinite(input.startValue) ? input.startValue : null;
  const end = typeof input.endValue === 'number' && Number.isFinite(input.endValue) ? input.endValue : null;
  if (start === null || end === null || start <= 0) {
    return {
      percent: null, startLabel: input.startLabel, endLabel: input.endLabel,
      sentence: `${input.label}: not stated — the ${input.startLabel} figure is not a positive amount, so no growth percentage can be formed.`,
    };
  }
  const percent = Math.round(((end - start) / start) * 1000) / 10;
  return {
    percent, startLabel: input.startLabel, endLabel: input.endLabel,
    sentence: `${input.label}: ${percent.toFixed(1)}% from ${input.formatValue(start)} at ${input.startLabel} to ${input.formatValue(end)} at ${input.endLabel}.`,
  };
}

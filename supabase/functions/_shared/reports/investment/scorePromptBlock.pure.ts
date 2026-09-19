/**
 * The Investment Score block of the generator's base prompt — from the record,
 * never from a default.
 *
 * ## The defect this closes
 *
 * The base prompt's score section read
 *
 *     **Investment Grade:** ${score?.grade || 'B'}
 *     **Total Score:** ${score?.totalScore || 'XX'}/100
 *     **Recommendation:** ${score?.recommendation || 'HOLD'}
 *
 * followed by a five-row table whose weights (30/25/20/15/10) were not the
 * engine's (40/25/15/15/5) and whose cells fell back to `XX`. So on every
 * report whose run WITHHELD the grade — every new report since 11 Sep 2026 —
 * the model was told the property was graded **B**, recommended **HOLD**, and
 * handed a table of placeholders to transcribe. The section-10 injection had
 * already been fixed to hand the model no placeholder; this was the same
 * defect one prompt earlier, on the document's own "Investment Score
 * Analysis" section.
 *
 * ## The rule
 *
 * `publishableGrade` is the one rule that decides whether a grade may be
 * printed, and this block reads it. Where a grade is issued the block states
 * the record's grade, total, recommendation and the weights the record itself
 * carries. Where none is, the block says so and forbids the model from
 * inventing one — and lists the measured dimensions as the only scores it may
 * quote, because "no grade" is not "no analysis".
 */
import { dimensionLabel, dimensionWasScored, publishableGrade } from './scoreSections.pure.ts';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const DIMENSION_ORDER = ['growthScore', 'locationScore', 'yieldScore', 'demandScore', 'riskScore'] as const;

/** `| Growth | 40% | 71 |` for each dimension the record scored, in the engine's order. */
export function scoredDimensionRows(score: unknown): string[] {
  if (!isRecord(score) || !isRecord(score.breakdown)) return [];
  const rows: string[] = [];
  for (const key of DIMENSION_ORDER) {
    const raw = score.breakdown[key];
    if (!isRecord(raw) || !dimensionWasScored(raw)) continue;
    const value = typeof raw.score === 'number' && Number.isFinite(raw.score) ? Math.round(raw.score) : null;
    if (value === null) continue;
    const weight = typeof raw.weight === 'number' && Number.isFinite(raw.weight) ? `${Math.round(raw.weight)}%` : '—';
    rows.push(`| ${dimensionLabel(key)} | ${weight} | ${value} |`);
  }
  return rows;
}

export const NO_GRADE_INSTRUCTION =
  'No overall investment grade or total score has been issued for this property. '
  + 'Do NOT state a grade, a score out of 100 or a buy/hold/avoid recommendation, and do not write that a grade is unavailable — '
  + 'describe the measured analysis and nothing more.';

/**
 * The block. Deterministic over the record; the `hasDocument` flag only
 * changes the parenthetical the base prompt has always carried.
 */
export function investmentScorePromptBlock(score: unknown, opts: { hasDocument: boolean }): string {
  const grade = publishableGrade(score);
  const rec = isRecord(score) ? score : null;
  const total = typeof rec?.totalScore === 'number' && Number.isFinite(rec.totalScore) ? Math.round(rec.totalScore) : null;
  const recommendation = typeof rec?.recommendation === 'string' && rec.recommendation.trim() ? rec.recommendation.trim() : null;
  const rows = scoredDimensionRows(score);
  const table = rows.length
    ? `\n| Component | Weight (%) | Score (/100) |\n|-----------|------------|--------------|\n${rows.join('\n')}`
    : '';

  if (!grade || total === null) {
    return `**Investment Grade:** ${NO_GRADE_INSTRUCTION}${rows.length
      ? `\n\n**Measured dimensions (the only scores that may be quoted):**\n${table}`
      : '\n\nNo dimension of the investment score was measured; quote no score of any kind.'}`;
  }

  return `**Investment Grade:** ${grade} (${opts.hasDocument ? 'Based on property analysis' : 'Based on suburb fundamentals - requires property-specific assessment'})

**Total Score:** ${total}/100

**Recommendation:** ${recommendation ?? 'As stated by the investment score'}

**Score Breakdown (use these exact values):**
${table}`;
}

/** The closing recommendation line: the record's verdict, or none. */
export function overallRecommendationLine(score: unknown): string {
  const grade = publishableGrade(score);
  const rec = isRecord(score) && typeof score.recommendation === 'string' ? score.recommendation.trim() : '';
  if (grade && rec) return `**QUALIFIED ${rec} with Contingencies**`;
  return '**Overall recommendation:** no overall grade or buy/hold verdict has been issued for this property — state the measured findings and the contingencies a buyer must resolve, without a verdict.';
}

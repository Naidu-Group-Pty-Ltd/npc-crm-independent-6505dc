/**
 * Which of the two stored shapes a `property_comparisons` row is in, and what
 * it holds.
 *
 * ## Why this is one function and not two readings
 *
 * A comparison is stored one of two ways and always has been:
 *
 *   **columns**   the seven jsonb columns are populated and `executive_summary`
 *                 is short prose. 23 of the first 50 rows. Since 28 Sep 2026
 *                 `market_timing` and `competitive_advantages` ride with them.
 *   **salvaged**  all seven columns are NULL and `executive_summary` holds the
 *                 model's whole raw response, cut off or mis-bracketed. 30 of
 *                 the 53 rows in the table today.
 *
 * Three surfaces have to make that call — the typeset PDF's normaliser, the
 * on-screen viewer, and anything else that wants to know what the model said —
 * and `COMPARISON.md` is explicit about what happens when more than one of them
 * decides for itself: *"a second reader would eventually disagree with the first
 * on one of them, and the disagreement would surface as a client's document
 * rather than as a test failure."* It already had: the viewer's own reader tried
 * `JSON.parse` on the blob and **returned the cleaned string on failure**, so
 * every salvaged row rendered 16 KB of raw JSON on screen under the heading
 * "Executive Summary", while the PDF route read the same row correctly.
 *
 * So the decision is made here, once, and both callers take it.
 *
 * It never repairs and never invents; recovery is `salvage.pure.ts`, which
 * records a top-level pair only after seeing that pair's terminator and so
 * cannot hand back a half-written ranking row.
 */

import type { Provenance, SourceShape } from './payload.pure.ts';
import { canonicalSection, salvageTruncatedJson } from './salvage.pure.ts';

/**
 * The columns that decide the shape.
 *
 * `executive_summary` is deliberately not among them: it is populated on BOTH
 * shapes — as prose on one and as the raw response on the other — so a row is
 * on the columns path when a *structured* column holds something, and never
 * because it has a summary.
 */
export const STRUCTURED_COLUMNS = [
  'rankings',
  'financial_comparison',
  'location_comparison',
  'risk_comparison',
  'investor_matches',
  'recommendations',
  'red_flags',
] as const;

/**
 * Two sections with a column of their own since 28 Sep 2026, read on the
 * columns path beside the seven.
 *
 * They do NOT decide the shape. The producer fills them only when it fills the
 * seven, so a row holding one of these and none of the seven cannot be written
 * — and if one were, reading it as `columns` would lose the salvage of a raw
 * response sitting in `executive_summary`. Every row written before the
 * migration holds neither (or, before it is applied, has no such key at all),
 * and reads exactly as it did.
 */
export const SUPPLEMENTARY_COLUMNS = [
  'market_timing',
  'competitive_advantages',
] as const;

export interface SupplementaryColumns {
  market_timing: Record<string, unknown> | null;
  competitive_advantages: unknown[] | null;
}

/**
 * What the producer writes into the two supplementary columns, or `null` when
 * there is nothing to write.
 *
 * The model's own sections, stored as it gave them: nothing is re-read,
 * re-worded or validated beyond "is it the shape the column says". An empty
 * section is not written, so an absent answer stays NULL rather than becoming
 * `{}` — which is what lets `section()` treat both the same way.
 */
export function supplementaryColumnsFor(analysis: Record<string, unknown>): SupplementaryColumns | null {
  const timing = isRecord(analysis.marketTiming) && Object.keys(analysis.marketTiming).length
    ? analysis.marketTiming
    : null;
  const advantages = Array.isArray(analysis.competitiveAdvantages) && analysis.competitiveAdvantages.length
    ? analysis.competitiveAdvantages
    : null;
  return timing || advantages
    ? { market_timing: timing, competitive_advantages: advantages }
    : null;
}

export interface StoredAnalysis {
  /** Empty when the row could be read; the reason it could not, otherwise. */
  error: string;
  /** The sections, in the producer's own vocabulary. Empty when `error` is set. */
  sections: Record<string, unknown>;
  provenance: Provenance;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v);

function failed(error: string): StoredAnalysis {
  return {
    error,
    sections: {},
    provenance: { shape: 'salvaged', recovered: [], missing: [], truncated: true },
  };
}

/**
 * `finalRecommendation` is the producer's other name for `recommendations`, and
 * the column writer has always mapped either into the same column. Folding it
 * here is what stops one section being reported missing and held at the same
 * time.
 */
function withRecommendationAlias(source: Record<string, unknown>): Record<string, unknown> {
  if (source.finalRecommendation && !source.recommendations) {
    return { ...source, recommendations: source.finalRecommendation };
  }
  return source;
}

export function readStoredAnalysis(row: Record<string, unknown>): StoredAnalysis {
  const hasColumns = STRUCTURED_COLUMNS.some((c) => {
    const v = row[c];
    return v !== null && v !== undefined && (!Array.isArray(v) || v.length > 0);
  });

  if (hasColumns) {
    const shape: SourceShape = 'columns';
    return {
      error: '',
      sections: {
        executiveSummary: row.executive_summary,
        rankings: row.rankings,
        financialComparison: row.financial_comparison,
        locationComparison: row.location_comparison,
        riskComparison: row.risk_comparison,
        investorMatches: row.investor_matches,
        marketTiming: row.market_timing,
        competitiveAdvantages: row.competitive_advantages,
        recommendations: row.recommendations,
        redFlags: row.red_flags,
      },
      // Nothing is reported missing on this path. A null column is ordinary
      // absence — the analysis had nothing to say — not a record that was cut
      // off, and the document drops the section silently as the other three
      // formats do.
      provenance: { shape, recovered: [], missing: [], truncated: false },
    };
  }

  const salvaged = salvageTruncatedJson(
    typeof row.executive_summary === 'string' ? row.executive_summary : null,
  );
  if (!salvaged || !salvaged.recovered.length) {
    return failed(
      salvaged?.reason
        || 'the comparison holds no structured sections and no readable stored response',
    );
  }

  return {
    error: '',
    sections: withRecommendationAlias({ ...salvaged.value }),
    provenance: {
      shape: 'salvaged',
      recovered: salvaged.recovered.map(canonicalSection),
      missing: salvaged.missing,
      truncated: salvaged.truncated,
    },
  };
}

/**
 * A section as the row holds it, or `null`.
 *
 * A column comes back from PostgREST already parsed; a salvaged section comes
 * back from `JSON.parse`. Both are values, never strings that still need
 * parsing — which is the assumption the viewer's own reader got wrong, and why
 * it fell through to printing the raw text.
 */
export function section(stored: StoredAnalysis, key: string): unknown {
  const v = stored.sections[key];
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' ? null : t;
  }
  if (Array.isArray(v)) return v.length ? v : null;
  if (isRecord(v)) return Object.keys(v).length ? v : null;
  return v;
}

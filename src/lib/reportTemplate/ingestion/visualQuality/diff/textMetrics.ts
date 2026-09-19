/**
 * Phase 4 — Visual diff harness: text coverage metric.
 *
 * Pure: compares expected source text (Docling / OCR / DOM textContent) to
 * the text the rendered template actually contains, and returns a 0..1
 * `textCoverageScore`. Tokenisation is whitespace-based after aggressive
 * normalisation so spacing/punctuation drift doesn't dominate the signal.
 *
 * W0 — WHAT COVERAGE CANNOT SEE
 * -----------------------------
 * `measureTextCoverage` answers exactly one question: did the words survive?
 * It is deliberately blind to layout, and that blindness had a cost. Text
 * clipped by `overflow:hidden` still has its `textContent`, so coverage scored
 * 1.0 on pages whose boxes were visibly cutting their contents off. Across 117
 * production imports the CDIR summary reported `textAccuracy == 1` on 89 of
 * them while the visual gate flagged 74% of pages as needing review — one
 * document (`BC Snapshot`) scored 1.0 and 0.507 simultaneously.
 *
 * Coverage is not wrong, it is narrow. `measureTextGeometry` below is its
 * counterpart: it asks whether the text occupies the same SPACE as the source,
 * which is the question a constricted box actually fails. Report both; never
 * treat coverage alone as a fidelity verdict.
 */

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[^\p{L}\p{N}\s']+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenise(text: string): string[] {
  const n = normalise(text);
  if (!n) return [];
  return n.split(' ').filter(Boolean);
}

/** Multiset of tokens → count map. */
function toMultiset(tokens: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const tok of tokens) m.set(tok, (m.get(tok) ?? 0) + 1);
  return m;
}

export interface TextCoverageResult {
  /** 0..1 — share of expected tokens that survived to the rendered output. */
  textCoverageScore: number;
  /** Token count in the expected source for this page. */
  expectedTokenCount: number;
  /** Token count produced by the renderer for this page. */
  renderedTokenCount: number;
  /** Distinct expected tokens that did not appear in the rendered output. */
  missingTokens: string[];
}

/**
 * Bag-of-words coverage: for each expected token, take min(expected, rendered)
 * occurrences — that's how many copies survived. Divide by the expected
 * token count.
 *
 * - Returns score `1` when there is no expected text (nothing to preserve).
 * - Returns score `0` when the renderer produced nothing but expected did.
 * - Top 20 missing tokens (by expected frequency) are surfaced for UX.
 */
export function measureTextCoverage(expected: string, rendered: string): TextCoverageResult {
  const eTokens = tokenise(expected);
  const rTokens = tokenise(rendered);
  if (eTokens.length === 0) {
    return {
      textCoverageScore: 1,
      expectedTokenCount: 0,
      renderedTokenCount: rTokens.length,
      missingTokens: [],
    };
  }
  const eBag = toMultiset(eTokens);
  const rBag = toMultiset(rTokens);

  let survived = 0;
  const missing: Array<{ tok: string; count: number }> = [];
  for (const [tok, eCount] of eBag) {
    const rCount = rBag.get(tok) ?? 0;
    const kept = Math.min(eCount, rCount);
    survived += kept;
    const lost = eCount - kept;
    if (lost > 0) missing.push({ tok, count: lost });
  }
  missing.sort((a, b) => b.count - a.count);

  return {
    textCoverageScore: Math.max(0, Math.min(1, survived / eTokens.length)),
    expectedTokenCount: eTokens.length,
    renderedTokenCount: rTokens.length,
    missingTokens: missing.slice(0, 20).map((m) => m.tok),
  };
}

// ── Geometry ─────────────────────────────────────────────────────────────────

/** One measured line, in whatever unit both sides share (pt for source data). */
export interface TextLineGeometry {
  /** Advance width — how much horizontal space the line actually occupies. */
  width: number;
  /** Line-box height, when the producer supplies it. */
  height?: number;
}

export interface TextGeometryResult {
  /** 0..1 — how closely rendered advance widths track the source. */
  advanceFidelityScore: number;
  expectedLineCount: number;
  renderedLineCount: number;
  /** False when the renderer wrapped (or merged) lines the source did not. */
  lineCountMatch: boolean;
  /** Rendered/expected width for the worst single line. >1 means it ran wider. */
  maxAdvanceRatio: number;
  /** Rendered/expected width at the median — the systematic drift. */
  medianAdvanceRatio: number;
  /** Lines whose rendered width exceeded the source beyond tolerance. */
  overrunLineCount: number;
  /** True when nothing could be compared (either side empty). */
  indeterminate: boolean;
}

function median(values: number[]): number {
  if (values.length === 0) return 1;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Compare rendered line geometry against the source's.
 *
 * This is the measurement a constricted text box actually fails, and the one
 * the harness lacked. A substituted font that runs 12% wide does not lose a
 * single token — coverage stays 1.0 — but every line overruns its box and
 * either clips or spills. Here that shows up as `medianAdvanceRatio ≈ 1.12`
 * and a non-zero `overrunLineCount`.
 *
 * `tolerance` is the fraction by which a rendered line may exceed its source
 * before it counts as an overrun; 0.02 (2%) matches the tolerance
 * `resolveFontV2` already uses for metric-compatible font substitution.
 *
 * Pure, and never throws: mismatched counts compare pairwise up to the shorter
 * side and are reported through `lineCountMatch` rather than by discarding data.
 */
export function measureTextGeometry(
  expected: TextLineGeometry[],
  rendered: TextLineGeometry[],
  tolerance = 0.02,
): TextGeometryResult {
  const expectedLineCount = expected.length;
  const renderedLineCount = rendered.length;
  const lineCountMatch = expectedLineCount === renderedLineCount;

  const pairs = Math.min(expectedLineCount, renderedLineCount);
  if (pairs === 0) {
    return {
      advanceFidelityScore: expectedLineCount === 0 && renderedLineCount === 0 ? 1 : 0,
      expectedLineCount, renderedLineCount, lineCountMatch,
      maxAdvanceRatio: 1, medianAdvanceRatio: 1, overrunLineCount: 0,
      indeterminate: true,
    };
  }

  const ratios: number[] = [];
  let overrunLineCount = 0;
  for (let i = 0; i < pairs; i += 1) {
    const e = expected[i].width;
    const r = rendered[i].width;
    // A zero-width source line carries no information; skip rather than divide.
    if (!Number.isFinite(e) || e <= 0 || !Number.isFinite(r) || r < 0) continue;
    const ratio = r / e;
    ratios.push(ratio);
    if (ratio > 1 + tolerance) overrunLineCount += 1;
  }

  if (ratios.length === 0) {
    return {
      advanceFidelityScore: 0,
      expectedLineCount, renderedLineCount, lineCountMatch,
      maxAdvanceRatio: 1, medianAdvanceRatio: 1, overrunLineCount: 0,
      indeterminate: true,
    };
  }

  const med = median(ratios);
  const maxAdvanceRatio = Math.max(...ratios);

  // Score on absolute deviation from 1, so text that renders NARROW is penalised
  // as well as text that runs wide — both are geometry drift, and a too-narrow
  // line signals a wrong substitution just as clearly.
  const deviation = ratios.reduce((acc, r) => acc + Math.abs(r - 1), 0) / ratios.length;
  const lineCountPenalty = lineCountMatch ? 0 : 0.25;
  const advanceFidelityScore = Math.max(0, Math.min(1, 1 - deviation - lineCountPenalty));

  return {
    advanceFidelityScore,
    expectedLineCount, renderedLineCount, lineCountMatch,
    maxAdvanceRatio, medianAdvanceRatio: med, overrunLineCount,
    indeterminate: false,
  };
}

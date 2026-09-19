/**
 * typography-fidelity-report-v1 · typography-preservation-v1 · font-resolution-policy-v2
 * — PDF Extraction V3 · Package E5 (canonical shared pure module).
 *
 * The consumer/decision half of E5. It evaluates a candidate text run against the
 * immutable SOURCE typography evidence, records HARD typography defects (with a
 * financial-safety focus on punctuation + numeric-range integrity), resolves the
 * font under a deterministic precedence, arbitrates the strongest SAFE
 * preservation mode, resolves renderer text-run suppression (composing with E3
 * chart + E4 table crops), and builds the document report + E0 handoff.
 *
 * SOURCE CONTENT AND SOURCE GLYPH IDENTITY OUTRANK EDITABILITY. A weighted score
 * never overrides a hard defect; a run becomes verified-native-text only when its
 * visible text, critical punctuation, numeric tokens, glyph coverage and fit are
 * all proven. Deterministic IDs are byte-identical to the Python producer
 * (`pdf-parse-service/source_typography.py` + `font_assets.py`). Pure + JSON-safe:
 * no signed URLs, DOM, network or secrets; never invents or rewrites source text.
 */

import { fnv1a32, isSafeArtifactPath, type SourceBBox } from './sourceSceneGraphV2.pure.ts';

export const SOURCE_TYPOGRAPHY_EVIDENCE_VERSION = 'source-typography-evidence-v1';
export const SOURCE_FONT_IDENTITY_VERSION = 'source-font-identity-v1';
export const FONT_ASSET_MANIFEST_VERSION = 'font-asset-manifest-v1';
export const TYPOGRAPHY_RUN_CONTRACT_VERSION = 'typography-run-contract-v1';
export const TYPOGRAPHY_FIDELITY_REPORT_VERSION = 'typography-fidelity-report-v1';
export const TYPOGRAPHY_PRESERVATION_VERSION = 'typography-preservation-v1';
export const FONT_RESOLUTION_POLICY_VERSION = 'font-resolution-policy-v2';

// ── Contract types (mirror the Python producer) ──────────────────────────────

export interface SourcePunctuationTokenE5 { raw: string; kind: string; critical?: boolean }
export interface SourceNumericTokenLike {
  raw: string; normalized: string | null; kind: string;
  currency?: string | null; unit?: string | null; rangeStart?: string | null; rangeEnd?: string | null;
}

export interface SourceFontIdentityV1 {
  version: typeof SOURCE_FONT_IDENTITY_VERSION;
  rawName: string | null; normalizedFamily: string | null; postScriptName: string | null;
  subsetPrefix: string | null; isSubset: boolean | null; embedded: boolean | null;
  fontType: string; weightClass: number | null; widthClass: number | null;
  italic: boolean | null; oblique: boolean | null; monospace: boolean | null;
  serif: boolean | null; symbolic: boolean | null; variableAxes: Record<string, number> | null;
  sourceObjectRef: string | null; assetId: string | null; problems: string[];
}

export type CriticalContentKind =
  | 'financial' | 'legal' | 'brand' | 'heading' | 'body' | 'caption' | 'table-cell' | 'chart-label' | 'unknown';

export interface SourceTypographyRunV1 {
  version: typeof TYPOGRAPHY_RUN_CONTRACT_VERSION;
  id: string; pageId: string; pageNumber: number;
  sourceRegionId: string | null; sourceSpanIds: string[];
  rawText: string; normalizedNfc: string; searchNormalized?: string;
  codePoints: number[]; glyphs: unknown[];
  bbox: SourceBBox; baseline: { x: number; y: number; directionX: number; directionY: number } | null;
  font: SourceFontIdentityV1; fontSizePt: number | null; colour: string | null; opacity: number | null;
  lineHeightPt: number | null; letterSpacingPt: number | null; wordSpacingPt: number | null;
  ascentPt: number | null; descentPt: number | null;
  writingMode: 'horizontal-ltr' | 'horizontal-rtl' | 'vertical' | 'rotated' | 'unknown';
  language: string | null; punctuationTokens: SourcePunctuationTokenE5[]; numericTokens: SourceNumericTokenLike[];
  criticalContent: CriticalContentKind;
  sourceCrop: { path: string | null; sha256: string | null; widthPx: number | null; heightPx: number | null; dpi: number | null; paddingPt: number | null } | null;
  unmappedGlyphCount?: number; complete: boolean; problems: string[];
}

/** A candidate text run + its ACTUAL rendered measurements (null = unmeasured). */
export interface CandidateTextRun {
  overlayId: string | null;
  text: string;
  fontFamily?: string | null;
  fontWeightNumeric?: number | null;
  fontSizePt?: number | null;
  italic?: boolean | null;
  colour?: string | null;
  backgroundColour?: string | null;
  bbox?: SourceBBox | null;
  measured?: {
    lineCount?: number | null;
    maxLineWidthPt?: number | null;
    overflowWidthPt?: number | null;
    overflowHeightPt?: number | null;
    clippedGlyphCount?: number | null;
    offPageGlyphCount?: number | null;
    collisionCount?: number | null;
    baselineDriftPt?: number | null;
    exportParityOk?: boolean | null;
    fontEmbedded?: boolean | null;
  } | null;
  resolvedFontAssetId?: string | null;
  fontResolutionState?: FontResolutionState | null;
}

// ── Deterministic IDs (mirror Python) ────────────────────────────────────────

function fmt2(v: number): string { let n = Math.round((v + Number.EPSILON) * 100) / 100; if (Object.is(n, -0) || n === 0) n = 0; return n.toFixed(2); }
function canonicalBBoxKey(b: SourceBBox): string { return [b.x, b.y, b.width, b.height].map((n) => fmt2(Number(n) || 0)).join('|'); }

/** Deterministic typography run ID (byte-identical to source_typography.py). */
export function typographyRunId(globalPage: number, bbox: SourceBBox, spanIds: string[], fontObjectRef: string | null, ordinal: number): string {
  const key = [
    String(Math.trunc(globalPage)), canonicalBBoxKey(bbox),
    [...spanIds].map(String).sort().join(','), String(fontObjectRef ?? ''), String(Math.trunc(ordinal)),
  ].join('|');
  return `strun-p${String(Math.trunc(globalPage)).padStart(4, '0')}-${String(Math.trunc(ordinal)).padStart(4, '0')}-${fnv1a32(key)}`;
}

/** Deterministic font asset ID (byte-identical to font_assets.py). */
export function fontAssetId(sourceObjectRef: string | null, sha256: string | null, normalizedFamily: string | null): string {
  return `fontasset-${fnv1a32([String(sourceObjectRef ?? ''), String(sha256 ?? ''), String(normalizedFamily ?? '')].join('|'))}`;
}

// ── Hard defects (Phase 17) ──────────────────────────────────────────────────

export type TypographyDefectCode =
  | 'source_text_missing' | 'source_text_duplicated' | 'source_codepoint_missing' | 'source_codepoint_changed'
  | 'unmapped_source_glyph' | 'critical_punctuation_missing' | 'critical_punctuation_changed'
  | 'critical_numeric_token_missing' | 'critical_numeric_token_changed' | 'critical_numeric_token_duplicated'
  | 'range_separator_missing' | 'currency_symbol_missing' | 'percentage_symbol_missing'
  | 'multiplication_sign_changed' | 'minus_sign_changed' | 'nonbreaking_space_changed'
  | 'font_asset_missing' | 'font_asset_invalid' | 'font_asset_policy_disallowed'
  | 'subset_font_missing_required_glyph' | 'font_glyph_coverage_incomplete' | 'font_metric_mismatch'
  | 'font_weight_mismatch' | 'font_style_mismatch' | 'font_variation_mismatch'
  | 'source_line_break_changed' | 'source_line_count_changed' | 'baseline_drift' | 'text_bbox_mismatch'
  | 'text_overflow' | 'text_clipped' | 'glyph_off_page' | 'text_collision' | 'text_unreadable_contrast'
  | 'writing_mode_unsupported' | 'renderer_parity_failed' | 'export_font_embedding_failed'
  | 'typography_unscored' | 'source_text_crop_missing';

export interface TypographyDefectV1 { code: TypographyDefectCode; message: string; evidence: Record<string, unknown> }

export type TypographyFidelityState = 'verified' | 'degraded' | 'rejected' | 'unverifiable';
export type FontIdentityState = 'exact' | 'embedded-subset' | 'metric-compatible' | 'substituted' | 'missing' | 'unknown';

export interface TypographyFidelityReportV1 {
  version: typeof TYPOGRAPHY_FIDELITY_REPORT_VERSION;
  sourceRunId: string; candidateOverlayId: string | null;
  state: TypographyFidelityState; score: number | null;
  hardDefects: TypographyDefectV1[];
  metrics: Record<string, number | boolean | string | null>;
  problems: string[];
}

const MIN_CONTRAST_RATIO = 3.0;
const DEFAULT_ADVANCE_TOLERANCE = 0.08;   // ±8% total advance
const DEFAULT_BASELINE_TOLERANCE_PT = 1.0;

function round4(n: number): number { return Math.round(n * 10000) / 10000; }
function ratio(n: number, d: number): number | null { return d <= 0 ? null : round4(n / d); }

function graphemesEqual(a: string, b: string): boolean { return a === b; }

/** Canonical key for a numeric token (matches the Python integrity model). */
function numericKey(t: SourceNumericTokenLike): string | null {
  if (!t) return null;
  if (t.kind === 'range') { if (t.rangeStart == null && t.rangeEnd == null) return null; return `range:${t.rangeStart}~${t.rangeEnd}`; }
  if (t.normalized) return `num:${t.normalized}`;
  if (t.raw) return `num:${t.raw.replace(/,/g, '')}`;
  return null;
}

// Critical punctuation kinds whose ABSENCE/CHANGE is a hard defect.
const RANGE_KINDS = new Set(['en-dash', 'em-dash', 'minus']);
const CRITICAL_KINDS = new Set([
  'en-dash', 'em-dash', 'minus', 'multiplication', 'arrow', 'degree', 'section-sign',
  'superscript-two', 'superscript-three', 'superscript-one', 'non-breaking-space', 'narrow-no-break-space',
]);

function contrastRatio(fg?: string | null, bg?: string | null): number | null {
  const lf = relLuminance(fg); const lb = relLuminance(bg);
  if (lf == null || lb == null) return null;
  const hi = Math.max(lf, lb); const lo = Math.min(lf, lb);
  return round4((hi + 0.05) / (lo + 0.05));
}
function relLuminance(color?: string | null): number | null {
  if (typeof color !== 'string') return null;
  const m = /^#?([0-9a-fA-F]{6})$/.exec(color.trim());
  if (!m) return null;
  const h = m[1];
  const chan = [0, 2, 4].map((i) => {
    let c = parseInt(h.slice(i, i + 2), 16) / 255;
    c = c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    return c;
  });
  return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
}

export interface EvaluateTypographyOptions {
  advanceTolerance?: number;
  baselineTolerancePt?: number;
  fixedLayout?: boolean;   // imported fixed-page PDFs are fixed-layout (default true)
}

/**
 * Evaluate a candidate run against the source run → TypographyFidelityReportV1.
 * Never mutates inputs. The candidate's `measured` block carries ACTUAL rendered
 * geometry; a missing measurement is `null` (unmeasured), never assumed passing.
 */
export function evaluateTypographyFidelity(
  source: SourceTypographyRunV1,
  candidate: CandidateTextRun | null,
  opts: EvaluateTypographyOptions = {},
): TypographyFidelityReportV1 {
  const fixed = opts.fixedLayout !== false;
  const hard: TypographyDefectV1[] = [];
  const push = (code: TypographyDefectCode, message: string, evidence: Record<string, unknown> = {}) => hard.push({ code, message, evidence });

  // Source-side gates.
  if ((source.unmappedGlyphCount ?? 0) > 0) push('unmapped_source_glyph', 'Source run has unmapped glyphs.', { count: source.unmappedGlyphCount });

  if (candidate == null) {
    return report(source.id, null, 'unverifiable', null, [...hard, { code: 'typography_unscored', message: 'No candidate run to score.', evidence: {} }], emptyMetrics());
  }

  const rawMatch = graphemesEqual(source.rawText, candidate.text);
  const nfcMatch = source.normalizedNfc === candidate.text.normalize('NFC');

  // Code-point recall/precision (multiset by value).
  const srcCounts = codePointCounts(source.rawText);
  const candCounts = codePointCounts(candidate.text);
  const cpRecall = multisetRecall(srcCounts, candCounts);
  const cpPrecision = multisetRecall(candCounts, srcCounts);
  if (cpRecall != null && cpRecall < 1) push('source_codepoint_missing', 'A source code point is missing from the candidate.', { codePointRecall: cpRecall });

  // Critical punctuation integrity.
  const candPunct = classifyPunct(candidate.text);
  for (const tok of source.punctuationTokens) {
    if (!tok.critical && !CRITICAL_KINDS.has(tok.kind)) continue;
    const present = candidate.text.includes(tok.raw) || candPunct.has(tok.kind);
    if (!present) {
      const code: TypographyDefectCode = tok.kind === 'non-breaking-space' || tok.kind === 'narrow-no-break-space'
        ? 'nonbreaking_space_changed'
        : tok.kind === 'multiplication' ? 'multiplication_sign_changed'
        : tok.kind === 'minus' ? 'minus_sign_changed'
        : RANGE_KINDS.has(tok.kind) ? 'range_separator_missing'
        : 'critical_punctuation_missing';
      push(code, `Critical punctuation (${tok.kind}) missing/changed in the candidate.`, { kind: tok.kind });
    }
  }

  // Range concatenation guard: a source range whose separator vanished so the
  // two numbers fused (e.g. 10–15 → 1015, $910,000–$920,000 → $910,000$920,000).
  for (const t of source.numericTokens) {
    if (t.kind !== 'range' || t.rangeStart == null || t.rangeEnd == null) continue;
    const a = String(t.rangeStart); const b = String(t.rangeEnd);
    const fused = new RegExp(`${escapeRe(a)}\\s*[,$£€¥%]*\\s*${escapeRe(b)}`);
    const hasSeparator = new RegExp(`${escapeRe(a)}[^0-9]*[–—−-][^0-9]*`).test(candidate.text)
      || /[–—−]/.test(candidate.text);
    if (fused.test(candidate.text.replace(/[–—−-]/g, '')) && !hasSeparator) {
      push('range_separator_missing', 'A numeric range lost its separator (values fused).', { rangeStart: a, rangeEnd: b });
    }
  }

  // Currency / percentage symbol presence when source has them.
  const srcHasCurrency = /[$£€¥]/.test(source.rawText);
  if (srcHasCurrency && !/[$£€¥]/.test(candidate.text)) push('currency_symbol_missing', 'Source currency symbol missing from candidate.', {});
  const srcHasPercent = /%/.test(source.rawText);
  if (srcHasPercent && !/%/.test(candidate.text)) push('percentage_symbol_missing', 'Source percentage symbol missing from candidate.', {});

  // Numeric token integrity. A source RANGE is expanded to its two endpoint
  // numbers so it matches the candidate's plain numbers; the *separator* loss is
  // caught separately by the range guard above (fused values fail there).
  const srcNumKeys = expandedNumericCounts(source.numericTokens);
  const candNumKeys = expandedNumericCounts(classifyNumeric(candidate.text));
  let numMissing = 0; let numDup = 0;
  for (const [k, n] of srcNumKeys) { const c = candNumKeys.get(k) ?? 0; if (c < 1) numMissing += 1; if (c > n && n <= 1 && c > 1) numDup += 1; }
  const numRecall = srcNumKeys.size ? ratio([...srcNumKeys.keys()].filter((k) => candNumKeys.has(k)).length, srcNumKeys.size) : null;
  const numPrecision = candNumKeys.size ? ratio([...candNumKeys.keys()].filter((k) => srcNumKeys.has(k)).length, candNumKeys.size) : null;
  if (numMissing > 0) push('critical_numeric_token_missing', 'A source numeric token is missing from the candidate.', { count: numMissing });
  if (numDup > 0) push('critical_numeric_token_duplicated', 'A source numeric token is duplicated in the candidate.', { count: numDup });

  // Font identity + metrics.
  const fontIdentityState = candidate.fontResolutionState
    ? mapResolutionToIdentity(candidate.fontResolutionState)
    : (candidate.resolvedFontAssetId ? 'embedded-subset' : (candidate.fontFamily ? 'substituted' : 'unknown'));
  const familyMatch = source.font.normalizedFamily != null && candidate.fontFamily != null
    ? candidate.fontFamily.toLowerCase().includes((source.font.normalizedFamily || '').toLowerCase())
    : null;
  const weightDiff = source.font.weightClass != null && candidate.fontWeightNumeric != null
    ? Math.abs(source.font.weightClass - candidate.fontWeightNumeric) : null;
  const sizeDiff = source.fontSizePt != null && candidate.fontSizePt != null
    ? round4(Math.abs(source.fontSizePt - candidate.fontSizePt)) : null;
  if (weightDiff != null && weightDiff > 150) push('font_weight_mismatch', 'Candidate font weight differs materially from source.', { weightDiff });
  if (source.font.italic === true && candidate.italic === false) push('font_style_mismatch', 'Source italic not reproduced.', {});

  // Measured geometry (only when provided).
  const m = candidate.measured ?? {};
  const overflowW = numOrNull(m.overflowWidthPt);
  const overflowH = numOrNull(m.overflowHeightPt);
  const clipped = numOrNull(m.clippedGlyphCount);
  const offPage = numOrNull(m.offPageGlyphCount);
  const collisions = numOrNull(m.collisionCount);
  const baselineDrift = numOrNull(m.baselineDriftPt);
  const lineCount = numOrNull(m.lineCount);
  if (overflowW != null && overflowW > 0.5) push('text_overflow', 'Candidate text overflows its box (width).', { overflowWidthPt: overflowW });
  if (overflowH != null && overflowH > 0.5) push('text_overflow', 'Candidate text overflows its box (height).', { overflowHeightPt: overflowH });
  if (clipped != null && clipped > 0) push('text_clipped', 'Candidate glyphs are clipped.', { clippedGlyphCount: clipped });
  if (offPage != null && offPage > 0) push('glyph_off_page', 'Candidate glyphs fall off the page.', { offPageGlyphCount: offPage });
  if (collisions != null && collisions > 0) push('text_collision', 'Candidate text collides with another element.', { collisionCount: collisions });
  if (baselineDrift != null && Math.abs(baselineDrift) > (opts.baselineTolerancePt ?? DEFAULT_BASELINE_TOLERANCE_PT)) {
    push('baseline_drift', 'Candidate baseline drifts beyond tolerance.', { baselineDriftPt: baselineDrift });
  }
  // Fixed-layout line-count agreement (imported PDFs are fixed-layout).
  const sourceLineCount = countSourceLines(source);
  if (fixed && lineCount != null && sourceLineCount != null && lineCount !== sourceLineCount) {
    push('source_line_count_changed', 'Candidate line count differs from the fixed-layout source.', { source: sourceLineCount, candidate: lineCount });
  }
  // Export parity.
  if (m.exportParityOk === false) push('renderer_parity_failed', 'Preview and export disagree.', {});
  if (m.fontEmbedded === false && fontIdentityState === 'exact') push('export_font_embedding_failed', 'Exact font could not be embedded in export.', {});

  // Contrast.
  const cr = contrastRatio(candidate.colour, candidate.backgroundColour);
  if (cr != null && cr < MIN_CONTRAST_RATIO) push('text_unreadable_contrast', 'Candidate text/background contrast is unreadable.', { contrastRatio: cr });

  // Writing mode.
  if ((source.writingMode === 'vertical' || source.writingMode === 'horizontal-rtl' || source.writingMode === 'rotated')) {
    push('writing_mode_unsupported', 'Source writing mode is not safely reproducible as native text.', { writingMode: source.writingMode });
  }

  const metrics = {
    rawTextExactMatch: rawMatch, normalizedTextMatch: nfcMatch,
    codePointRecall: cpRecall, codePointPrecision: cpPrecision,
    glyphCoverage: (source.unmappedGlyphCount ?? 0) > 0 ? 0 : 1,
    punctuationRecall: punctRecall(source.punctuationTokens, candPunct),
    punctuationPrecision: null,
    numericTokenRecall: numRecall, numericTokenPrecision: numPrecision,
    fontIdentityState, fontFamilyMatch: familyMatch, fontWeightDifference: weightDiff, fontSizeDifferencePt: sizeDiff,
    advanceWidthRatio: null, bboxIoU: bboxIoU(source.bbox, candidate.bbox ?? null),
    baselineDriftPt: baselineDrift, lineCountSource: sourceLineCount, lineCountCandidate: lineCount,
    lineBreakAgreement: (fixed && lineCount != null && sourceLineCount != null) ? (lineCount === sourceLineCount ? 1 : 0) : null,
    maxLineWidthDifferencePt: null, overflowWidthPt: overflowW, overflowHeightPt: overflowH,
    clippedGlyphCount: clipped, offPageGlyphCount: offPage, collisionCount: collisions, contrastRatio: cr,
  } as Record<string, number | boolean | string | null>;

  const hardCodes = new Set(hard.map((d) => d.code));
  let state: TypographyFidelityState; let score: number | null;
  if (hardCodes.size) { state = hardCodes.has('typography_unscored') ? 'unverifiable' : 'rejected'; score = null; }
  else { score = scoreTypography(metrics); state = score != null ? 'verified' : 'degraded'; }
  return report(source.id, candidate.overlayId, state, score, hard, metrics);
}

function report(sourceRunId: string, candidateOverlayId: string | null, state: TypographyFidelityState, score: number | null, hardDefects: TypographyDefectV1[], metrics: Record<string, number | boolean | string | null>): TypographyFidelityReportV1 {
  return { version: TYPOGRAPHY_FIDELITY_REPORT_VERSION, sourceRunId, candidateOverlayId, state, score, hardDefects, metrics, problems: [] };
}
function emptyMetrics(): Record<string, number | boolean | string | null> {
  return { rawTextExactMatch: null, normalizedTextMatch: null, codePointRecall: null, codePointPrecision: null, glyphCoverage: null, punctuationRecall: null, punctuationPrecision: null, numericTokenRecall: null, numericTokenPrecision: null, fontIdentityState: 'unknown', fontFamilyMatch: null, fontWeightDifference: null, fontSizeDifferencePt: null, advanceWidthRatio: null, bboxIoU: null, baselineDriftPt: null, lineCountSource: null, lineCountCandidate: null, lineBreakAgreement: null, maxLineWidthDifferencePt: null, overflowWidthPt: null, overflowHeightPt: null, clippedGlyphCount: null, offPageGlyphCount: null, collisionCount: null, contrastRatio: null };
}

function scoreTypography(metrics: Record<string, number | boolean | string | null>): number | null {
  const parts: Array<[number, number]> = [];
  const add = (v: unknown, w: number) => { if (typeof v === 'number') parts.push([Math.max(0, Math.min(1, v)), w]); };
  add(metrics.codePointRecall, 3); add(metrics.numericTokenRecall, 3); add(metrics.punctuationRecall, 2);
  add(metrics.glyphCoverage, 2); add(metrics.bboxIoU, 1);
  if (metrics.rawTextExactMatch === true) parts.push([1, 3]); else if (metrics.rawTextExactMatch === false) parts.push([0, 3]);
  if (!parts.length) return null;
  const w = parts.reduce((s, [, ww]) => s + ww, 0);
  return round4(parts.reduce((s, [v, ww]) => s + v * ww, 0) / w);
}

function codePointCounts(s: string): Map<number, number> { const m = new Map<number, number>(); for (const ch of s) { const c = ch.codePointAt(0)!; m.set(c, (m.get(c) ?? 0) + 1); } return m; }
function multisetRecall(need: Map<number, number>, have: Map<number, number>): number | null {
  let total = 0; let found = 0;
  for (const [k, n] of need) { total += n; found += Math.min(n, have.get(k) ?? 0); }
  return total ? round4(found / total) : null;
}
function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function numOrNull(v: unknown): number | null { return typeof v === 'number' && Number.isFinite(v) ? v : null; }

const E5_PUNCT: Array<[RegExp, string]> = [
  [/\u2013/, 'en-dash'], [/\u2014/, 'em-dash'], [/\u2212/, 'minus'], [/[\u2190\u2192\u2194]/, 'arrow'],
  [/\u00d7/, 'multiplication'], [/\u2022/, 'bullet'], [/\u00a0/, 'non-breaking-space'],
  [/\u202f/, 'narrow-no-break-space'], [/\u00b0/, 'degree'], [/\u00a7/, 'section-sign'],
  [/\u00b2/, 'superscript-two'], [/\u00b3/, 'superscript-three'], [/\u00b9/, 'superscript-one'],
];
function classifyPunct(text: string): Set<string> { const s = new Set<string>(); for (const [re, kind] of E5_PUNCT) if (re.test(text)) s.add(kind); return s; }
function punctRecall(source: SourcePunctuationTokenE5[], candKinds: Set<string>): number | null {
  const crit = source.filter((t) => t.critical || CRITICAL_KINDS.has(t.kind));
  if (!crit.length) return null;
  const found = crit.filter((t) => candKinds.has(t.kind)).length;
  return round4(found / crit.length);
}
function classifyNumeric(text: string): SourceNumericTokenLike[] {
  const out: SourceNumericTokenLike[] = [];
  const re = /[-+]?\d[\d,]*(?:\.\d+)?/g; let mm: RegExpExecArray | null;
  while ((mm = re.exec(text))) out.push({ raw: mm[0], normalized: mm[0].replace(/,/g, ''), kind: 'number' });
  return out;
}
function tokenCounts(tokens: SourceNumericTokenLike[]): Map<string, number> { const m = new Map<string, number>(); for (const t of tokens) { const k = numericKey(t); if (k) m.set(k, (m.get(k) ?? 0) + 1); } return m; }
/** Range tokens expand to their endpoint number keys so a source range matches a
 * candidate's plain numbers; the separator loss is caught by the range guard. */
function expandedNumericCounts(tokens: SourceNumericTokenLike[]): Map<string, number> {
  const m = new Map<string, number>();
  const bump = (k: string | null) => { if (k) m.set(k, (m.get(k) ?? 0) + 1); };
  for (const t of tokens) {
    if (t.kind === 'range') {
      if (t.rangeStart != null) bump(`num:${String(t.rangeStart).replace(/,/g, '')}`);
      if (t.rangeEnd != null) bump(`num:${String(t.rangeEnd).replace(/,/g, '')}`);
    } else bump(numericKey(t));
  }
  return m;
}
function countSourceLines(source: SourceTypographyRunV1): number | null {
  if (!source.rawText) return null;
  return source.rawText.split('\n').length;
}
function bboxIoU(a: SourceBBox | null, b: SourceBBox | null): number | null {
  if (!a || !b) return null;
  const ix = Math.max(a.x, b.x), iy = Math.max(a.y, b.y);
  const ix2 = Math.min(a.x + a.width, b.x + b.width), iy2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, ix2 - ix) * Math.max(0, iy2 - iy);
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? round4(inter / union) : null;
}

// ── Font resolution policy v2 (Phase 7/11) ───────────────────────────────────

export type FontResolutionState = 'exact' | 'embedded-subset' | 'metric-compatible' | 'source-crop' | 'unavailable';

export interface FontResolutionResultV2 {
  version: typeof FONT_RESOLUTION_POLICY_VERSION;
  sourceRunId: string; state: FontResolutionState;
  selectedFamily: string | null; selectedFontAssetId: string | null;
  metricScore: number | null; glyphCoverage: number | null; problems: string[];
}

export interface FontAssetLike {
  assetId: string; validationState: string; embeddingPolicy: string; glyphCoverage: number[];
  sourceFont?: { normalizedFamily?: string | null } | null;
}
export interface ApprovedFontCandidate {
  family: string;
  /** Measured metrics from the ACTUAL candidate font engine (null = unmeasured). */
  metrics?: { totalAdvanceRatio?: number | null; ascentDiff?: number | null; descentDiff?: number | null; weightDiff?: number | null; italicMatch?: boolean | null; lineCountMatch?: boolean | null } | null;
  coversCodePoints?: number[] | null;
}

function mapResolutionToIdentity(s: FontResolutionState): FontIdentityState {
  switch (s) { case 'exact': return 'exact'; case 'embedded-subset': return 'embedded-subset'; case 'metric-compatible': return 'metric-compatible'; case 'source-crop': return 'missing'; default: return 'missing'; }
}

/**
 * Deterministic font resolution. Precedence: exact embedded → exact approved →
 * complete embedded subset → measured metric-compatible → source crop →
 * unavailable. Family-name similarity ALONE never wins — a metric-compatible
 * substitute requires 100% glyph coverage + measured metrics within tolerance.
 */
export function resolveFontV2(
  source: SourceTypographyRunV1,
  opts: { embeddedAsset?: FontAssetLike | null; approvedExact?: string | null; approvedCandidates?: ApprovedFontCandidate[]; advanceTolerance?: number } = {},
): FontResolutionResultV2 {
  const problems: string[] = [];
  const required = source.codePoints.filter((c) => c > 32);
  const tol = opts.advanceTolerance ?? DEFAULT_ADVANCE_TOLERANCE;

  const emb = opts.embeddedAsset ?? null;
  if (emb && emb.validationState === 'valid' && emb.embeddingPolicy === 'private-job-only') {
    const cov = new Set(emb.glyphCoverage);
    const covered = required.every((c) => cov.has(c));
    const isExact = emb.sourceFont?.normalizedFamily != null && source.font.normalizedFamily != null
      && emb.sourceFont.normalizedFamily.toLowerCase() === source.font.normalizedFamily.toLowerCase();
    if (covered) {
      return result(source.id, isExact ? 'exact' : 'embedded-subset', emb.sourceFont?.normalizedFamily ?? source.font.normalizedFamily, emb.assetId, 1, 1, problems);
    }
    problems.push('subset_font_missing_required_glyph');
  } else if (emb && emb.validationState === 'policy_disallowed') {
    problems.push('font_asset_policy_disallowed');
  }

  if (opts.approvedExact) return result(source.id, 'exact', opts.approvedExact, null, 1, 1, problems);

  // Metric-compatible: measured candidates only.
  let best: { c: ApprovedFontCandidate; score: number } | null = null;
  for (const c of opts.approvedCandidates ?? []) {
    const cov = c.coversCodePoints ? required.every((cp) => c.coversCodePoints!.includes(cp)) : false;
    if (!cov) continue;
    const met = c.metrics ?? {};
    if (met.totalAdvanceRatio == null) continue;                 // must be MEASURED
    if (Math.abs(met.totalAdvanceRatio - 1) > tol) continue;     // advance within tolerance
    if (met.lineCountMatch === false) continue;                  // no line-count regression
    const score = round4(1 - Math.abs(met.totalAdvanceRatio - 1) - (met.weightDiff != null ? Math.min(0.3, met.weightDiff / 1000) : 0));
    if (!best || score > best.score) best = { c, score };
  }
  if (best) return result(source.id, 'metric-compatible', best.c.family, null, best.score, 1, problems);

  // No safe native font → source crop when a crop exists, else unavailable.
  if (source.sourceCrop?.path) return result(source.id, 'source-crop', null, null, null, null, problems);
  return result(source.id, 'unavailable', null, null, null, null, problems);
}

function result(sourceRunId: string, state: FontResolutionState, selectedFamily: string | null, selectedFontAssetId: string | null, metricScore: number | null, glyphCoverage: number | null, problems: string[]): FontResolutionResultV2 {
  return { version: FONT_RESOLUTION_POLICY_VERSION, sourceRunId, state, selectedFamily, selectedFontAssetId, metricScore, glyphCoverage, problems };
}

// ── Preservation plan + arbitration (Phase 21) ───────────────────────────────

export type TypographyRenderMode = 'verified-native-text' | 'source-text-crop' | 'containment-fallback' | 'blocked';

export interface TypographyPreservationRunPlanV1 {
  version: typeof TYPOGRAPHY_PRESERVATION_VERSION;
  sourceRunId: string; pageNumber: number; renderMode: TypographyRenderMode;
  candidateOverlayId: string | null; sourceCropPath: string | null;
  resolvedFontAssetId: string | null; fontResolutionState: FontResolutionState;
  suppressOverlayIds: string[]; fidelityState: string; fidelityScore: number | null;
  hardDefectCodes: string[]; manualReviewRequired: boolean; reason: string;
}

export function arbitrateTypographyPreservation(args: {
  source: SourceTypographyRunV1;
  report: TypographyFidelityReportV1 | null;
  resolution: FontResolutionResultV2 | null;
  sourceCropAvailable: boolean;
  pageRasterAvailable: boolean;
}): TypographyPreservationRunPlanV1 {
  const { source, report: rep, resolution, sourceCropAvailable, pageRasterAvailable } = args;
  const hardCodes = (rep?.hardDefects ?? []).map((d) => d.code);
  const resState = resolution?.state ?? 'unavailable';
  const canNative = rep != null && rep.state === 'verified' && hardCodes.length === 0
    && (resState === 'exact' || resState === 'embedded-subset' || resState === 'metric-compatible');
  let mode: TypographyRenderMode; let reason: string;
  if (canNative) { mode = 'verified-native-text'; reason = 'native_text_verified'; }
  else if (sourceCropAvailable) { mode = 'source-text-crop'; reason = 'native_unsafe_source_crop'; }
  else if (pageRasterAvailable) { mode = 'containment-fallback'; reason = 'no_crop_page_fallback'; }
  else { mode = 'blocked'; reason = 'no_crop_no_raster_blocked'; }
  return {
    version: TYPOGRAPHY_PRESERVATION_VERSION,
    sourceRunId: source.id, pageNumber: source.pageNumber, renderMode: mode,
    candidateOverlayId: rep?.candidateOverlayId ?? null,
    sourceCropPath: source.sourceCrop?.path ?? null,
    resolvedFontAssetId: resolution?.selectedFontAssetId ?? null,
    fontResolutionState: resState,
    suppressOverlayIds: [],
    fidelityState: rep?.state ?? 'unverifiable', fidelityScore: rep?.score ?? null,
    hardDefectCodes: hardCodes, manualReviewRequired: mode === 'blocked' || mode === 'source-text-crop', reason,
  };
}

// ── Text child suppression + E3/E4 precedence (Phase 22) ─────────────────────

export interface TextSuppressionOverlay { id: string; bbox?: { x: number; y: number; width: number; height: number } | null }
export interface CropRegion { bbox: SourceBBox }

function overlayInside(o: { x: number; y: number; width: number; height: number }, t: SourceBBox): boolean {
  const cx = o.x + o.width / 2, cy = o.y + o.height / 2;
  return cx >= t.x && cx <= t.x + t.width && cy >= t.y && cy <= t.y + t.height && o.width <= t.width * 1.5 + 1 && o.height <= t.height * 1.5 + 1;
}

export interface TextSuppressionResult { suppressedOverlayIds: string[]; keptOverlayIds: string[]; skippedRunIds: string[] }

/**
 * Resolve text-run suppression. An E5 source-text crop suppresses the native
 * overlay for that run; but E3 chart crops + E4 table crops OWN text inside them
 * — E5 must NOT render an additional text crop (or suppress) inside an already
 * rendered chart/table crop (deterministic precedence; each source pixel once).
 */
export function resolveTextSuppression(
  plans: TypographyPreservationRunPlanV1[],
  runBBoxes: Record<string, SourceBBox>,
  overlays: TextSuppressionOverlay[],
  ownership: { chartCrops?: CropRegion[]; tableCrops?: CropRegion[] } = {},
): TextSuppressionResult {
  const suppressed = new Set<string>();
  const skippedRunIds: string[] = [];
  const owningCrops = [...(ownership.chartCrops ?? []), ...(ownership.tableCrops ?? [])];
  for (const plan of plans) {
    if (plan.renderMode !== 'source-text-crop' && plan.renderMode !== 'verified-native-text') continue;
    const rb = runBBoxes[plan.sourceRunId];
    if (!rb) continue;
    // Precedence: if this run sits inside a chart/table crop, E3/E4 already own it.
    const insideOwned = owningCrops.some((c) => centreInside(rb, c.bbox));
    if (plan.renderMode === 'source-text-crop' && insideOwned) { skippedRunIds.push(plan.sourceRunId); continue; }
    if (plan.renderMode !== 'source-text-crop') continue;
    for (const ov of overlays) { if (ov.bbox && overlayInside(ov.bbox, rb)) suppressed.add(ov.id); }
  }
  return {
    suppressedOverlayIds: overlays.filter((o) => suppressed.has(o.id)).map((o) => o.id),
    keptOverlayIds: overlays.filter((o) => !suppressed.has(o.id)).map((o) => o.id),
    skippedRunIds,
  };
}
function centreInside(inner: SourceBBox, outer: SourceBBox): boolean {
  const cx = inner.x + inner.width / 2, cy = inner.y + inner.height / 2;
  return cx >= outer.x && cx <= outer.x + outer.width && cy >= outer.y && cy <= outer.y + outer.height;
}

// ── Document report + E0 handoff (Phase 33/34) ───────────────────────────────

export interface TypographyPreservationSummary {
  version: typeof TYPOGRAPHY_PRESERVATION_VERSION; ran: boolean; pageCount: number;
  typographyRunCount: number; verifiedNativeTextRunCount: number; sourceTextCropRunCount: number;
  containmentFallbackRunCount: number; blockedTypographyRunCount: number;
  fontResolutionStateCounts: Record<string, number>; typographyRenderModeCounts: Record<TypographyRenderMode, number>;
  manualReviewRunCount: number; problems: string[];
}

export function buildTypographyPreservationReport(
  perPage: Array<{ pageNumber: number | null; runs: TypographyPreservationRunPlanV1[] }>,
): TypographyPreservationSummary {
  const modeCounts: Record<TypographyRenderMode, number> = { 'verified-native-text': 0, 'source-text-crop': 0, 'containment-fallback': 0, blocked: 0 };
  const fontCounts: Record<string, number> = {};
  let runs = 0; let manual = 0; const problems: string[] = [];
  for (const page of perPage) for (const r of page.runs ?? []) {
    runs += 1; modeCounts[r.renderMode] += 1;
    fontCounts[r.fontResolutionState] = (fontCounts[r.fontResolutionState] ?? 0) + 1;
    if (r.manualReviewRequired) manual += 1;
    if (r.renderMode === 'blocked') problems.push(`page_${page.pageNumber}:typography_blocked:${r.sourceRunId}`);
  }
  return {
    version: TYPOGRAPHY_PRESERVATION_VERSION, ran: perPage.length > 0, pageCount: perPage.length,
    typographyRunCount: runs, verifiedNativeTextRunCount: modeCounts['verified-native-text'],
    sourceTextCropRunCount: modeCounts['source-text-crop'], containmentFallbackRunCount: modeCounts['containment-fallback'],
    blockedTypographyRunCount: modeCounts.blocked, fontResolutionStateCounts: fontCounts,
    typographyRenderModeCounts: modeCounts, manualReviewRunCount: manual, problems,
  };
}

export function attachTypographyPreservationSummary<T extends object>(report: T, typography: TypographyPreservationSummary): T & { typographyPreservation: TypographyPreservationSummary } {
  return { ...report, typographyPreservation: typography };
}

export type TypographyContainmentRequirement = 'permit_score_based' | 'protected_visual' | 'page_fallback' | 'manual_review';

/** Map a run's render mode to the E0 requirement. Invalid/absent → null (E0 is never weakened). */
export function typographyContainmentRequirement(mode: unknown): TypographyContainmentRequirement | null {
  switch (mode) {
    case 'verified-native-text': return 'permit_score_based';
    case 'source-text-crop': return 'protected_visual';
    case 'containment-fallback': return 'page_fallback';
    case 'blocked': return 'manual_review';
    default: return null;
  }
}

/** Defensive path check re-exported for consumers validating persisted font paths. */
export function isSafeFontPath(path: unknown): path is string { return isSafeArtifactPath(path); }

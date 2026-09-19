/**
 * E5 — Typography, Glyph, Unicode & Font Fidelity (canonical shared module) specs.
 *
 * Verifies deterministic IDs (byte-identical to the Python producers), the
 * critical punctuation + numeric-range integrity checks (the financial-safety
 * core), font-resolution-policy-v2, preservation arbitration, renderer text-run
 * suppression with E3/E4 precedence, the document report and the E0 handoff.
 */
import { describe, it, expect } from 'vitest';
import {
  typographyRunId,
  fontAssetId,
  evaluateTypographyFidelity,
  resolveFontV2,
  arbitrateTypographyPreservation,
  resolveTextSuppression,
  buildTypographyPreservationReport,
  typographyContainmentRequirement,
  TYPOGRAPHY_FIDELITY_REPORT_VERSION,
  FONT_RESOLUTION_POLICY_VERSION,
  TYPOGRAPHY_PRESERVATION_VERSION,
  type SourceTypographyRunV1,
  type CandidateTextRun,
  type TypographyPreservationRunPlanV1,
} from '../pdfImport/typographyFidelity.pure';
import type { SourceBBox } from '../pdfImport/sourceSceneGraphV2.pure';
import { resolvePageTypographyPreservation } from '../pdfImport/typographyPreservationIntegration';

const BBOX: SourceBBox = { x: 40, y: 100, width: 200, height: 16 };

function fontIdentity(over: Record<string, unknown> = {}) {
  return {
    version: 'source-font-identity-v1' as const, rawName: 'ABCDEF+Helvetica', normalizedFamily: 'Helvetica',
    postScriptName: 'ABCDEF+Helvetica', subsetPrefix: 'ABCDEF', isSubset: true, embedded: true, fontType: 'truetype',
    weightClass: 400, widthClass: 5, italic: false, oblique: null, monospace: false, serif: false, symbolic: false,
    variableAxes: null, sourceObjectRef: '7 0 R', assetId: null, problems: [], ...over,
  };
}

function run(text: string, over: Partial<SourceTypographyRunV1> = {}): SourceTypographyRunV1 {
  const punct: SourceTypographyRunV1['punctuationTokens'] = [];
  if (text.includes('–')) punct.push({ raw: '–', kind: 'en-dash', critical: true });
  if (text.includes('×')) punct.push({ raw: '×', kind: 'multiplication', critical: true });
  if (text.includes('−')) punct.push({ raw: '−', kind: 'minus', critical: true });
  if (text.includes('\u00a0')) punct.push({ raw: '\u00a0', kind: 'non-breaking-space', critical: true });
  const numeric: SourceTypographyRunV1['numericTokens'] = [];
  const rangeM = /(\d[\d,]*)\s*–\s*\$?(\d[\d,]*)/.exec(text);
  const consumed: Array<[number, number]> = [];
  if (rangeM) { consumed.push([rangeM.index, rangeM.index + rangeM[0].length]); numeric.push({ raw: rangeM[0], normalized: null, kind: 'range', rangeStart: rangeM[1].replace(/,/g, ''), rangeEnd: rangeM[2].replace(/,/g, '') }); }
  const numRe = /\d[\d,]*(?:\.\d+)?/g; let nm: RegExpExecArray | null;
  while ((nm = numRe.exec(text))) {
    if (consumed.some(([a, b]) => nm!.index >= a && nm!.index < b)) continue;
    numeric.push({ raw: nm[0], normalized: nm[0].replace(/,/g, ''), kind: 'number' });
  }
  return {
    version: 'typography-run-contract-v1', id: typographyRunId(1, BBOX, ['s1'], '7 0 R', 1),
    pageId: 'docling-page-1', pageNumber: 1, sourceRegionId: null, sourceSpanIds: ['s1'],
    rawText: text, normalizedNfc: text.normalize('NFC'), searchNormalized: text.replace(/[–—−]/g, '-'),
    codePoints: [...text].map((c) => c.codePointAt(0)!), glyphs: [], bbox: BBOX, baseline: null,
    font: fontIdentity(), fontSizePt: 11, colour: '#111111', opacity: null, lineHeightPt: 14.3,
    letterSpacingPt: null, wordSpacingPt: null, ascentPt: null, descentPt: null, writingMode: 'horizontal-ltr',
    language: null, punctuationTokens: punct, numericTokens: numeric, criticalContent: 'financial',
    sourceCrop: { path: 'job/pages/page-001/typography/s.png', sha256: 'a'.repeat(64), widthPx: 1, heightPx: 1, dpi: 300, paddingPt: 2 },
    unmappedGlyphCount: 0, complete: true, problems: [], ...over,
  };
}

function candidate(text: string, over: Partial<CandidateTextRun> = {}): CandidateTextRun {
  return { overlayId: 'ov1', text, fontFamily: 'Helvetica', fontWeightNumeric: 400, fontSizePt: 11, italic: false,
    colour: '#111111', backgroundColour: '#ffffff', bbox: BBOX, fontResolutionState: 'embedded-subset', measured: null, ...over };
}

// ── Cross-runtime parity ──────────────────────────────────────────────────────

describe('deterministic IDs — parity with the Python producers', () => {
  it('run ID matches source_typography.py', () => {
    expect(typographyRunId(1, BBOX, ['s1'], '7 0 R', 1)).toBe('strun-p0001-0001-b93b4410');
  });
  it('font asset ID matches font_assets.py', () => {
    expect(fontAssetId('7 0 R', 'a'.repeat(64), 'Helvetica')).toBe('fontasset-61e0a8e7');
  });
});

// ── Punctuation + numeric integrity (financial-safety core) ──────────────────

describe('critical punctuation + numeric integrity', () => {
  it('an exact range candidate verifies', () => {
    const rep = evaluateTypographyFidelity(run('10–15 years'), candidate('10–15 years'));
    expect(rep.state).toBe('verified');
    expect(rep.hardDefects).toEqual([]);
  });

  it('10–15 → 1015 (lost separator) is a hard defect', () => {
    const rep = evaluateTypographyFidelity(run('10–15 years'), candidate('1015 years'));
    const codes = rep.hardDefects.map((d) => d.code);
    expect(codes).toContain('range_separator_missing');
    expect(rep.state).toBe('rejected');
  });

  it('$910,000–$920,000 → $910,000$920,000 is a hard defect', () => {
    const rep = evaluateTypographyFidelity(run('$910,000–$920,000'), candidate('$910,000$920,000'));
    expect(rep.hardDefects.map((d) => d.code)).toContain('range_separator_missing');
  });

  it('8×8 → 8x8 changes the multiplication sign (hard defect)', () => {
    const rep = evaluateTypographyFidelity(run('8×8'), candidate('8x8'));
    expect(rep.hardDefects.map((d) => d.code)).toContain('multiplication_sign_changed');
  });

  it('–$25,000 → -$25,000 changes the minus sign (hard defect)', () => {
    const rep = evaluateTypographyFidelity(run('−$25,000'), candidate('-$25,000'));
    expect(rep.hardDefects.map((d) => d.code)).toContain('minus_sign_changed');
  });

  it('4.67% → 4.67 drops the percentage symbol (hard defect)', () => {
    const rep = evaluateTypographyFidelity(run('4.67%'), candidate('4.67'));
    expect(rep.hardDefects.map((d) => d.code)).toContain('percentage_symbol_missing');
  });

  it('a dropped currency symbol is a hard defect', () => {
    const rep = evaluateTypographyFidelity(run('$1,200,000'), candidate('1,200,000'));
    expect(rep.hardDefects.map((d) => d.code)).toContain('currency_symbol_missing');
  });

  it('a missing source numeric token is a hard defect', () => {
    const rep = evaluateTypographyFidelity(run('Total 1,200,000'), candidate('Total'));
    expect(rep.hardDefects.map((d) => d.code)).toContain('critical_numeric_token_missing');
  });

  it('an NBSP dropped from a financial figure is a hard defect', () => {
    const rep = evaluateTypographyFidelity(run('$1 000'), candidate('$1000'));
    expect(rep.hardDefects.map((d) => d.code)).toContain('nonbreaking_space_changed');
  });

  it('a high overall match cannot override a hard defect', () => {
    // Everything matches except the fused range → still rejected, score null.
    const rep = evaluateTypographyFidelity(run('10–15'), candidate('1015'));
    expect(rep.score).toBeNull();
    expect(rep.state).toBe('rejected');
  });
});

// ── Glyph coverage ────────────────────────────────────────────────────────────

describe('glyph coverage', () => {
  it('an unmapped source glyph blocks native and is unverifiable/rejected', () => {
    const rep = evaluateTypographyFidelity(run('Price GLYPH', { unmappedGlyphCount: 1 }), candidate('Price'));
    expect(rep.hardDefects.map((d) => d.code)).toContain('unmapped_source_glyph');
    expect(rep.metrics.glyphCoverage).toBe(0);
  });
});

// ── Measured geometry ─────────────────────────────────────────────────────────

describe('measured fit', () => {
  it('overflow is a hard defect', () => {
    const rep = evaluateTypographyFidelity(run('Body'), candidate('Body', { measured: { overflowWidthPt: 4 } }));
    expect(rep.hardDefects.map((d) => d.code)).toContain('text_overflow');
  });
  it('clipping is a hard defect', () => {
    const rep = evaluateTypographyFidelity(run('Body'), candidate('Body', { measured: { clippedGlyphCount: 2 } }));
    expect(rep.hardDefects.map((d) => d.code)).toContain('text_clipped');
  });
  it('fixed-layout line-count change is a hard defect', () => {
    const rep = evaluateTypographyFidelity(run('One line'), candidate('One line', { measured: { lineCount: 2 } }));
    expect(rep.hardDefects.map((d) => d.code)).toContain('source_line_count_changed');
  });
  it('export/preview parity failure is a hard defect', () => {
    const rep = evaluateTypographyFidelity(run('Body'), candidate('Body', { measured: { exportParityOk: false } }));
    expect(rep.hardDefects.map((d) => d.code)).toContain('renderer_parity_failed');
  });
  it('unreadable contrast is a hard defect', () => {
    const rep = evaluateTypographyFidelity(run('Body'), candidate('Body', { colour: '#222222', backgroundColour: '#333333' }));
    expect(rep.hardDefects.map((d) => d.code)).toContain('text_unreadable_contrast');
  });
});

// ── Font resolution v2 ────────────────────────────────────────────────────────

describe('resolveFontV2', () => {
  it('a valid complete embedded subset resolves to embedded-subset/exact', () => {
    const asset = { assetId: 'fontasset-x', validationState: 'valid', embeddingPolicy: 'private-job-only',
      glyphCoverage: [...'Helvetica'].map((c) => c.codePointAt(0)!), sourceFont: { normalizedFamily: 'Helvetica' } };
    const res = resolveFontV2(run('Helvetica'), { embeddedAsset: asset });
    expect(res.state).toBe('exact');
    expect(res.selectedFontAssetId).toBe('fontasset-x');
  });

  it('an incomplete subset is rejected for the run', () => {
    const asset = { assetId: 'fontasset-y', validationState: 'valid', embeddingPolicy: 'private-job-only',
      glyphCoverage: ['H'.codePointAt(0)!], sourceFont: { normalizedFamily: 'Helvetica' } };
    const res = resolveFontV2(run('Hello'), { embeddedAsset: asset });
    expect(res.problems).toContain('subset_font_missing_required_glyph');
    expect(res.state).toBe('source-crop'); // falls to crop (source has a crop)
  });

  it('family-name similarity ALONE cannot win — an unmeasured candidate is skipped', () => {
    const res = resolveFontV2(run('Hello'), { approvedCandidates: [{ family: 'ArialLike', coversCodePoints: [...'Hello'].map((c) => c.codePointAt(0)!), metrics: { totalAdvanceRatio: null } }] });
    expect(res.state).toBe('source-crop'); // no measured metric → not metric-compatible
  });

  it('a measured metric-compatible candidate within tolerance wins', () => {
    const res = resolveFontV2(run('Hello'), { approvedCandidates: [{ family: 'Metric', coversCodePoints: [...'Hello'].map((c) => c.codePointAt(0)!), metrics: { totalAdvanceRatio: 1.02, weightDiff: 0, lineCountMatch: true } }] });
    expect(res.state).toBe('metric-compatible');
    expect(res.selectedFamily).toBe('Metric');
  });

  it('a candidate outside advance tolerance is rejected', () => {
    const res = resolveFontV2(run('Hello'), { approvedCandidates: [{ family: 'Wide', coversCodePoints: [...'Hello'].map((c) => c.codePointAt(0)!), metrics: { totalAdvanceRatio: 1.5, lineCountMatch: true } }] });
    expect(res.state).toBe('source-crop');
  });

  it('no crop + no font → unavailable', () => {
    const res = resolveFontV2(run('Hello', { sourceCrop: null }), {});
    expect(res.state).toBe('unavailable');
  });
});

// ── Preservation arbitration ──────────────────────────────────────────────────

describe('arbitrateTypographyPreservation', () => {
  const good = run('Investment thesis');
  it('verified fidelity + resolved font → verified-native-text', () => {
    const rep = evaluateTypographyFidelity(good, candidate('Investment thesis', { fontResolutionState: 'exact' }));
    const plan = arbitrateTypographyPreservation({ source: good, report: rep, resolution: { version: FONT_RESOLUTION_POLICY_VERSION, sourceRunId: good.id, state: 'exact', selectedFamily: 'Helvetica', selectedFontAssetId: 'a', metricScore: 1, glyphCoverage: 1, problems: [] }, sourceCropAvailable: true, pageRasterAvailable: true });
    expect(plan.renderMode).toBe('verified-native-text');
  });
  it('rejected fidelity + crop → source-text-crop (manual review)', () => {
    const rep = evaluateTypographyFidelity(run('10–15'), candidate('1015'));
    const plan = arbitrateTypographyPreservation({ source: run('10–15'), report: rep, resolution: null, sourceCropAvailable: true, pageRasterAvailable: true });
    expect(plan.renderMode).toBe('source-text-crop');
    expect(plan.manualReviewRequired).toBe(true);
  });
  it('no crop → containment-fallback', () => {
    const rep = evaluateTypographyFidelity(run('10–15', { sourceCrop: null }), candidate('1015'));
    const plan = arbitrateTypographyPreservation({ source: run('10–15', { sourceCrop: null }), report: rep, resolution: null, sourceCropAvailable: false, pageRasterAvailable: true });
    expect(plan.renderMode).toBe('containment-fallback');
  });
  it('no crop + no raster → blocked', () => {
    const rep = evaluateTypographyFidelity(run('10–15', { sourceCrop: null }), candidate('1015'));
    const plan = arbitrateTypographyPreservation({ source: run('10–15', { sourceCrop: null }), report: rep, resolution: null, sourceCropAvailable: false, pageRasterAvailable: false });
    expect(plan.renderMode).toBe('blocked');
  });
});

// ── Suppression + E3/E4 precedence ────────────────────────────────────────────

function plan(runId: string, mode: TypographyRenderModeLocal): TypographyPreservationRunPlanV1 {
  return { version: TYPOGRAPHY_PRESERVATION_VERSION, sourceRunId: runId, pageNumber: 1, renderMode: mode,
    candidateOverlayId: null, sourceCropPath: 'j/r.png', resolvedFontAssetId: null, fontResolutionState: 'source-crop',
    suppressOverlayIds: [], fidelityState: 'rejected', fidelityScore: null, hardDefectCodes: [], manualReviewRequired: true, reason: 'x' };
}
type TypographyRenderModeLocal = TypographyPreservationRunPlanV1['renderMode'];

describe('resolveTextSuppression + E3/E4 precedence', () => {
  const runBBoxes = { r1: { x: 40, y: 100, width: 200, height: 16 } as SourceBBox };
  const overlays = [
    { id: 'ov-in', bbox: { x: 60, y: 103, width: 40, height: 10 } },
    { id: 'ov-out', bbox: { x: 500, y: 600, width: 40, height: 10 } },
  ];
  it('a source-text crop suppresses the overlapping native overlay', () => {
    const res = resolveTextSuppression([plan('r1', 'source-text-crop')], runBBoxes, overlays);
    expect(res.suppressedOverlayIds).toEqual(['ov-in']);
    expect(res.keptOverlayIds).toEqual(['ov-out']);
  });
  it('E5 defers when the run sits inside an E4 table crop (skipped, no suppression)', () => {
    const res = resolveTextSuppression([plan('r1', 'source-text-crop')], runBBoxes, overlays, { tableCrops: [{ bbox: { x: 0, y: 0, width: 595, height: 400 } }] });
    expect(res.skippedRunIds).toContain('r1');
    expect(res.suppressedOverlayIds).toEqual([]);
  });
  it('E5 defers when the run sits inside an E3 chart crop', () => {
    const res = resolveTextSuppression([plan('r1', 'source-text-crop')], runBBoxes, overlays, { chartCrops: [{ bbox: { x: 0, y: 0, width: 300, height: 300 } }] });
    expect(res.skippedRunIds).toContain('r1');
  });
});

// ── Document report + E0 handoff ──────────────────────────────────────────────

describe('report + E0 handoff', () => {
  it('aggregates render modes', () => {
    const report = buildTypographyPreservationReport([
      { pageNumber: 1, runs: [plan('r1', 'verified-native-text'), plan('r2', 'source-text-crop')] },
      { pageNumber: 2, runs: [plan('r3', 'blocked')] },
    ]);
    expect(report.typographyRunCount).toBe(3);
    expect(report.verifiedNativeTextRunCount).toBe(1);
    expect(report.sourceTextCropRunCount).toBe(1);
    expect(report.blockedTypographyRunCount).toBe(1);
    expect(report.problems.some((p) => p.includes('typography_blocked'))).toBe(true);
  });
  it('maps render mode → E0 requirement; invalid → null', () => {
    expect(typographyContainmentRequirement('verified-native-text')).toBe('permit_score_based');
    expect(typographyContainmentRequirement('source-text-crop')).toBe('protected_visual');
    expect(typographyContainmentRequirement('containment-fallback')).toBe('page_fallback');
    expect(typographyContainmentRequirement('blocked')).toBe('manual_review');
    expect(typographyContainmentRequirement('garbage')).toBeNull();
  });
});

// ── Template bridge ───────────────────────────────────────────────────────────

describe('resolvePageTypographyPreservation (template bridge)', () => {
  const page = { id: 'p1', blocks: [{ id: 'b', overlays: [
    { id: 'ov-in', type: 'text', x: 60, y: 103, width: 40, height: 10 },
    { id: 'ov-out', type: 'text', x: 500, y: 600, width: 40, height: 10 },
  ] }] } as unknown as import('../templateSchema').Page;

  it('hides the overlay behind a source-text crop and flags review', () => {
    const res = resolvePageTypographyPreservation(page, [plan('r1', 'source-text-crop')], { r1: { x: 40, y: 100, width: 200, height: 16 } });
    expect(res.suppression.suppressedOverlayIds).toEqual(['ov-in']);
    expect(res.manualReviewRequired).toBe(true);
  });
});

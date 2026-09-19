/**
 * table-candidate-contract-v1 · table-integrity-report-v1 · table-arbitration-v1 ·
 * table-preservation-v1 — PDF Extraction V3 · Package E4 (canonical shared pure module).
 *
 * The consumer half of E4: the immutable table contracts (candidate, integrity
 * report, arbitration, preservation plan), deterministic candidate/cell IDs that
 * agree byte-for-byte with the Python producer (`pdf-parse-service/table_candidates.py`),
 * defensive validators, the renderer-facing table child suppression resolver, the
 * mapper's source-derived native-header policy (which STOPS synthesizing
 * `Column N`), and the document-level preservation report.
 *
 * SOURCE FIDELITY AND CORRECT CELL ASSOCIATION OUTRANK EDITABILITY. The heavy
 * integrity + arbitration is computed by the sidecar producer and persisted; this
 * module validates + consumes it and never invents, moves or reassigns a value.
 * Pure + deterministic + JSON-safe: no signed URLs, DOM, network or secrets.
 */

import { fnv1a32, isSafeArtifactPath, type SourceBBox, type SourceRegionV2, type SourcePageSceneV2, type SourceSceneGraphV2 } from './sourceSceneGraphV2.pure.ts';

export const TABLE_CANDIDATE_CONTRACT_VERSION = 'table-candidate-contract-v1';
export const SOURCE_TABLE_EVIDENCE_VERSION = 'source-table-evidence-v1';
export const TABLE_INTEGRITY_REPORT_VERSION = 'table-integrity-report-v1';
export const TABLE_ARBITRATION_VERSION = 'table-arbitration-v1';
export const TABLE_PRESERVATION_VERSION = 'table-preservation-v1';

export type TableCandidateProvider =
  | 'docling-primary' | 'docling-accurate-cell-matching' | 'docling-accurate-no-cell-matching'
  | 'docling-fast' | 'pymupdf-grid' | 'legacy' | 'unknown';

export const PROVIDER_ABBREV: Record<TableCandidateProvider, string> = {
  'docling-primary': 'dpri', 'docling-accurate-cell-matching': 'dacm',
  'docling-accurate-no-cell-matching': 'danm', 'docling-fast': 'dfst',
  'pymupdf-grid': 'pgrid', legacy: 'lgcy', unknown: 'unkn',
};

export interface TableCandidateCellV1 {
  id: string;
  row: number; col: number; rowSpan: number; colSpan: number;
  columnHeader: boolean; rowHeader: boolean;
  text: string; normalizedText: string;
  numericTokens: unknown[]; punctuationTokens: unknown[];
  bbox: SourceBBox | null; confidence: number | null; providerReferences: string[];
}

export interface TableCandidateV1 {
  version: typeof TABLE_CANDIDATE_CONTRACT_VERSION;
  id: string; sourceRegionId: string; pageId: string; pageNumber: number;
  provider: TableCandidateProvider; providerVersion: string | null; providerReference: string | null;
  profile: {
    runtimeProfile: string | null; pipelineFamily: string | null;
    tableMode: 'fast' | 'accurate' | null; cellMatching: boolean | null;
    modelId: string | null; converterKey: string | null;
  };
  bbox: SourceBBox; numRows: number; numCols: number;
  headerRowCount: number; headerColumnCount: number;
  cells: TableCandidateCellV1[]; caption: string | null; sourceCropPath: string | null;
  confidence: number | null; extractionElapsedMs: number | null;
  complete: boolean; problems: string[];
}

export type TableIntegrityState = 'verified' | 'degraded' | 'rejected' | 'unverifiable';

export interface TableIntegrityDefectV1 { code: string; message: string; evidence: Record<string, unknown> }

export interface TableIntegrityReportV1 {
  version: typeof TABLE_INTEGRITY_REPORT_VERSION;
  sourceRegionId: string; candidateId: string | null;
  state: TableIntegrityState; score: number | null;
  hardDefects: TableIntegrityDefectV1[];
  metrics: Record<string, number | null>;
  problems: string[];
}

export type TableArbitrationState = 'native_verified' | 'source_crop' | 'containment_fallback' | 'blocked';

export interface TableArbitrationResultV1 {
  version: typeof TABLE_ARBITRATION_VERSION;
  sourceRegionId: string; state: TableArbitrationState;
  selectedCandidateId: string | null; selectedIntegrityReport: TableIntegrityReportV1 | null;
  rankedCandidateIds: string[]; rejectedCandidateIds: string[];
  sourceCropAvailable: boolean; reason: string; problems: string[];
}

export type TableRenderMode = 'verified-native-table' | 'table-source-crop' | 'containment-fallback' | 'blocked';

export interface TablePreservationRegionPlanV1 {
  version: typeof TABLE_PRESERVATION_VERSION;
  regionId: string; pageNumber: number | null;
  renderMode: TableRenderMode;
  selectedCandidateId: string | null; sourceCropPath: string | null;
  suppressRegionIds: string[]; suppressOverlayIds: string[];
  integrityState: string; integrityScore: number | null;
  hardDefectCodes: string[]; manualReviewRequired: boolean; reason: string;
  orphanSuppressedRegionIds?: string[];
}

// ── Deterministic IDs (mirror table_candidates.py) ───────────────────────────

function fmt2(value: number): string {
  let v = Math.round((value + Number.EPSILON) * 100) / 100;
  if (Object.is(v, -0) || v === 0) v = 0;
  return v.toFixed(2);
}
function canonicalBBoxKey(b: SourceBBox): string {
  return [b.x, b.y, b.width, b.height].map((n) => fmt2(Number(n) || 0)).join('|');
}
function normalizeNfc(s: string): string {
  return typeof s === 'string' ? s.normalize('NFC') : '';
}
function canonicalTopologyKey(
  numRows: number, numCols: number, headerRowCount: number, headerColCount: number,
  cells: Array<{ row: number; col: number; rowSpan?: number; colSpan?: number; columnHeader?: boolean; rowHeader?: boolean; text?: string }>,
): string {
  const parts = [String(numRows | 0), String(numCols | 0), String(headerRowCount | 0), String(headerColCount | 0)];
  for (const c of cells) {
    parts.push([
      String((c.row ?? 0) | 0), String((c.col ?? 0) | 0),
      String((c.rowSpan ?? 1) | 0), String((c.colSpan ?? 1) | 0),
      c.columnHeader ? 'H' : '-', c.rowHeader ? 'R' : '-',
      normalizeNfc(String(c.text ?? '')),
    ].join('|'));
  }
  return parts.join('␟');
}

export interface CandidateIdProfile { runtimeProfile?: string | null; tableMode?: string | null; cellMatching?: boolean | null; converterKey?: string | null; modelId?: string | null }

/** Deterministic candidate ID (byte-identical to the Python producer). */
export function candidateId(
  sourceRegionId: string, provider: TableCandidateProvider, profile: CandidateIdProfile,
  bbox: SourceBBox, numRows: number, numCols: number, headerRowCount: number, headerColCount: number,
  cells: Array<{ row: number; col: number; rowSpan?: number; colSpan?: number; columnHeader?: boolean; rowHeader?: boolean; text?: string }>,
): string {
  const abbrev = PROVIDER_ABBREV[provider] ?? 'unkn';
  const profileSig = [
    String(profile.runtimeProfile ?? ''), String(profile.tableMode ?? ''),
    profile.cellMatching ? 'cm1' : 'cm0', String(profile.converterKey ?? ''), String(profile.modelId ?? ''),
  ].join('|');
  const key = [
    String(sourceRegionId), provider, profileSig, canonicalBBoxKey(bbox),
    canonicalTopologyKey(numRows, numCols, headerRowCount, headerColCount, cells),
  ].join('␞');
  return `tblcand-${fnv1a32(String(sourceRegionId))}-${abbrev}-${fnv1a32(key)}`;
}

export function cellId(candidate: string, row: number, col: number, rowSpan: number, colSpan: number): string {
  return `tcell-${fnv1a32([candidate, String(row | 0), String(col | 0), String(rowSpan | 0), String(colSpan | 0)].join('|'))}`;
}

// ── Defensive validators ─────────────────────────────────────────────────────

function bboxOk(b: unknown): b is SourceBBox {
  const o = b as SourceBBox | undefined;
  const rec = o as unknown as Record<string, number>;
  return Boolean(o && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(rec[k]))
    && o.width > 0 && o.height > 0);
}

/** Validate a persisted candidate (defensive read of sidecar output). */
export function validateTableCandidate(candidate: unknown): string[] {
  const problems: string[] = [];
  if (!candidate || typeof candidate !== 'object') return ['candidate_not_object'];
  const c = candidate as TableCandidateV1;
  if (c.version !== TABLE_CANDIDATE_CONTRACT_VERSION) problems.push('candidate_bad_version');
  if (!bboxOk(c.bbox)) problems.push('candidate_bbox_non_finite');
  if ((c.numRows ?? -1) < 0 || (c.numCols ?? -1) < 0) problems.push('candidate_negative_dimensions');
  const seen = new Set<string>();
  for (const cell of c.cells ?? []) {
    if (seen.has(cell.id)) problems.push('candidate_duplicate_cell_id');
    seen.add(cell.id);
    if ((cell.rowSpan ?? 1) < 1 || (cell.colSpan ?? 1) < 1) problems.push('candidate_invalid_span');
    if ((cell.row ?? 0) < 0 || (cell.col ?? 0) < 0) problems.push('candidate_negative_cell_index');
  }
  if (c.sourceCropPath != null && !isSafeArtifactPath(c.sourceCropPath)) problems.push('candidate_crop_path_unsafe');
  return Array.from(new Set(problems)).sort();
}

export type TableArbitrationV3State = 'valid' | 'invalid' | 'absent';

export function validateTableArbitration(input: unknown): { ok: boolean; state: TableArbitrationV3State; result: TableArbitrationResultV1 | null; problems: string[] } {
  if (input == null) return { ok: false, state: 'absent', result: null, problems: ['arbitration_absent'] };
  if (typeof input !== 'object') return { ok: false, state: 'invalid', result: null, problems: ['arbitration_not_object'] };
  const a = input as TableArbitrationResultV1;
  const problems: string[] = [];
  if (a.version !== TABLE_ARBITRATION_VERSION) problems.push('arbitration_bad_version');
  if (!['native_verified', 'source_crop', 'containment_fallback', 'blocked'].includes(a.state)) problems.push('arbitration_bad_state');
  if (a.state === 'source_crop' && !a.sourceCropAvailable) problems.push('source_crop_without_crop');
  if (a.state === 'native_verified' && !a.selectedCandidateId) problems.push('native_without_candidate');
  const ok = problems.length === 0;
  return { ok, state: ok ? 'valid' : 'invalid', result: ok ? a : null, problems };
}

// ── Mapper native-header policy (Phase 11 — stop synthesizing `Column N`) ────

const GENERIC_HEADER_RE = /^\s*column\s*\d+\s*$/i;

export interface SourceHeaderPolicyInput {
  headerRows: number;
  numCols: number;
  /** The full row-major grid (header rows first). */
  rows: string[][];
  /** Optional per-column source width in pt (from source cell geometry). */
  columnWidths?: (number | null)[];
}

export interface NativeHeaderPolicy {
  showHeader: boolean;
  /** Column labels from SOURCE header text only — never a synthesized `Column N`. */
  columnLabels: string[];
  hasSourceHeaders: boolean;
  genericHeaderInSource: boolean;
  columnWidths: (number | null)[];
}

/**
 * Decide the native table header policy from the SOURCE topology. Fixes the
 * long-standing defect where the mapper synthesized `Column 1..N`:
 *   - source has header text → use it (blank label stays blank, never `Column N`);
 *   - source has no header row → `showHeader = false`, no labels;
 *   - the source header itself already reads `Column N` → surfaced as a risk flag
 *     (the arbitration/integrity layer vetoes native rendering when it matters).
 * Never invents a header to satisfy the renderer.
 */
export function deriveNativeHeaderPolicy(input: SourceHeaderPolicyInput): NativeHeaderPolicy {
  const numCols = Math.max(0, input.numCols | 0);
  const firstHeaderRow = input.headerRows > 0 ? (input.rows[0] ?? []) : [];
  const labels: string[] = [];
  let genericInSource = false;
  let anyMeaningful = false;
  for (let i = 0; i < numCols; i += 1) {
    const raw = (firstHeaderRow[i] ?? '').trim();
    if (raw && GENERIC_HEADER_RE.test(raw)) genericInSource = true;
    else if (raw) anyMeaningful = true;
    labels.push(raw); // may be '' — we never replace with `Column N`
  }
  const widths = Array.from({ length: numCols }, (_, i) => {
    const w = input.columnWidths?.[i];
    return typeof w === 'number' && Number.isFinite(w) && w > 0 ? w : null;
  });
  return {
    showHeader: input.headerRows > 0,
    columnLabels: labels,
    hasSourceHeaders: anyMeaningful,
    genericHeaderInSource: genericInSource,
    columnWidths: widths,
  };
}

// ── Renderer-facing table child suppression (Phase 17) ───────────────────────

export interface TableSuppressionOverlay {
  id: string;
  bbox?: { x: number; y: number; width: number; height: number } | null;
}

export interface TableSuppressionResult {
  suppressedOverlayIds: string[];
  byTable: Record<string, string[]>;
  keptOverlayIds: string[];
}

function overlayInsideTable(o: { x: number; y: number; width: number; height: number }, t: SourceBBox): boolean {
  const cx = o.x + o.width / 2;
  const cy = o.y + o.height / 2;
  const inside = cx >= t.x && cx <= t.x + t.width && cy >= t.y && cy <= t.y + t.height;
  if (!inside) return false;
  return o.width <= t.width * 1.5 + 1 && o.height <= t.height * 1.5 + 1;
}

/**
 * Which candidate overlays a rendered table crop (or verified native table)
 * suppresses to avoid duplicate rendering. Only `table-source-crop` and
 * `verified-native-table` modes suppress; a `containment-fallback`/`blocked`
 * table suppresses nothing (E0 owns the page). Adjacent independent overlays,
 * page headings and content beside the table are never suppressed.
 */
export function resolveTableSuppression(
  plans: TablePreservationRegionPlanV1[],
  tableBBoxes: Record<string, SourceBBox>,
  overlays: TableSuppressionOverlay[],
): TableSuppressionResult {
  const byTable: Record<string, string[]> = {};
  const suppressed = new Set<string>();
  for (const plan of plans) {
    if (plan.renderMode !== 'table-source-crop' && plan.renderMode !== 'verified-native-table') continue;
    const tb = tableBBoxes[plan.regionId];
    if (!tb) continue;
    for (const ov of overlays) {
      if (!ov.bbox) continue;
      if (overlayInsideTable(ov.bbox, tb)) {
        suppressed.add(ov.id);
        (byTable[plan.regionId] ??= []).push(ov.id);
      }
    }
  }
  return {
    suppressedOverlayIds: overlays.filter((o) => suppressed.has(o.id)).map((o) => o.id),
    byTable,
    keptOverlayIds: overlays.filter((o) => !suppressed.has(o.id)).map((o) => o.id),
  };
}

// ── Document-level preservation report (Phase 26) ────────────────────────────

export interface TablePreservationSummary {
  version: typeof TABLE_PRESERVATION_VERSION;
  ran: boolean;
  pageCount: number;
  tableRegionCount: number;
  nativeVerifiedTableCount: number;
  sourceCropTableCount: number;
  containmentFallbackTableCount: number;
  blockedTableCount: number;
  suppressedRegionCount: number;
  tableRenderModeCounts: Record<TableRenderMode, number>;
  manualReviewTableCount: number;
  problems: string[];
}

/** Aggregate persisted per-page table preservation plans into a document summary. */
export function buildTablePreservationReport(
  perPagePlans: Array<{ pageNumber: number | null; tables: TablePreservationRegionPlanV1[] }>,
): TablePreservationSummary {
  const counts: Record<TableRenderMode, number> = {
    'verified-native-table': 0, 'table-source-crop': 0, 'containment-fallback': 0, blocked: 0,
  };
  let tableRegions = 0;
  let suppressed = 0;
  let manualReview = 0;
  const problems: string[] = [];
  for (const page of perPagePlans) {
    for (const t of page.tables ?? []) {
      tableRegions += 1;
      counts[t.renderMode] += 1;
      suppressed += t.suppressRegionIds?.length ?? 0;
      if (t.manualReviewRequired) manualReview += 1;
      if (t.renderMode === 'blocked') problems.push(`page_${page.pageNumber}:table_blocked:${t.regionId}`);
    }
  }
  return {
    version: TABLE_PRESERVATION_VERSION,
    ran: perPagePlans.length > 0,
    pageCount: perPagePlans.length,
    tableRegionCount: tableRegions,
    nativeVerifiedTableCount: counts['verified-native-table'],
    sourceCropTableCount: counts['table-source-crop'],
    containmentFallbackTableCount: counts['containment-fallback'],
    blockedTableCount: counts.blocked,
    suppressedRegionCount: suppressed,
    tableRenderModeCounts: counts,
    manualReviewTableCount: manualReview,
    problems,
  };
}

export function attachTablePreservationSummary<T extends object>(
  report: T, table: TablePreservationSummary,
): T & { tablePreservation: TablePreservationSummary } {
  return { ...report, tablePreservation: table };
}

// ── E0 handoff (Phase 24) ────────────────────────────────────────────────────

export type TableContainmentRequirement = 'permit_score_based' | 'protected_visual' | 'page_fallback' | 'manual_review';

/**
 * Map a table arbitration state to what E0 containment should require for the
 * page. Invalid/absent evidence returns null (E0 behaviour is unchanged — E4
 * evidence may never WEAKEN E0). Never returns a value that relaxes E0.
 */
export function tableContainmentRequirement(arbitration: unknown): TableContainmentRequirement | null {
  const { ok, result } = validateTableArbitration(arbitration);
  if (!ok || !result) return null;
  switch (result.state) {
    case 'native_verified': return 'permit_score_based';
    case 'source_crop': return 'protected_visual';
    case 'containment_fallback': return 'page_fallback';
    case 'blocked': return 'manual_review';
    default: return null;
  }
}

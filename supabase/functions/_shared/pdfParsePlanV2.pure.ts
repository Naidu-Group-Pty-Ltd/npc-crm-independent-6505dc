/**
 * pdf-plan-contract-v2 — runtime-normalized dispatcher preflight contract.
 *
 * The Cloud Run sidecar `/plan` route returns a rich JSON body, but the edge
 * dispatcher historically cast it straight to a 4-field interface while reading
 * six undeclared fields. This module replaces that unchecked cast with a real
 * runtime validator so malformed / unknown plan output produces a structured,
 * audited fallback instead of silently routing on garbage.
 *
 * Pure and runtime-agnostic: no Deno/Node globals are touched at module load, so
 * this is importable by BOTH the Deno edge dispatcher AND a vitest spec.
 * Self-contained on purpose (zero imports).
 */

export const PDF_PLAN_CONTRACT_VERSION = 'pdf-plan-contract-v2' as const;

export type PlanMode = 'semantic' | 'hybrid' | 'pixel-perfect';
export type PlanLane =
  | 'fast_native'
  | 'accurate_table'
  | 'ocr_scanned'
  | 'design_heavy'
  | 'pixel_raster_only'
  | 'unplanned';

export type PlanComplexity = 'low' | 'medium' | 'high';

export interface PdfParsePlanV2 {
  contract_version: typeof PDF_PLAN_CONTRACT_VERSION;
  engine_version: string;
  file_type: 'pdf';
  page_count: number;
  byte_size: number;
  has_selectable_text: boolean;
  selectable_text_ratio: number;
  scanned_page_ratio: number;
  ocr_hint: boolean;
  estimated_complexity: PlanComplexity;
  table_likelihood: PlanComplexity;
  image_heavy: boolean;
  design_heavy: boolean;
  /** Canonical plan mode. Null when the sidecar did not recommend a mode. */
  recommended_mode: PlanMode | null;
  recommended_lane: PlanLane;
  /** Clamped to 1..50. Null when the sidecar did not recommend a chunk size. */
  recommended_chunk_size: number | null;
  requires_raster: boolean;
  requires_ocr: boolean;
  requires_picture_description: boolean;
  plan_ms: number;
}

export type PlanNormalizeResult =
  | { ok: true; plan: PdfParsePlanV2 }
  | { ok: false; reason: string; problems: string[] };

const VALID_LANES: ReadonlySet<string> = new Set<PlanLane>([
  'fast_native',
  'accurate_table',
  'ocr_scanned',
  'design_heavy',
  'pixel_raster_only',
  'unplanned',
]);

export const PLAN_CHUNK_SIZE_MIN = 1;
export const PLAN_CHUNK_SIZE_MAX = 50;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function coerceBool(v: unknown, fallback = false): boolean {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return fallback;
}

function coerceFiniteNumber(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function coerceComplexity(v: unknown, fallback: PlanComplexity = 'medium'): PlanComplexity {
  return v === 'low' || v === 'medium' || v === 'high' ? v : fallback;
}

/**
 * Normalize a raw `/plan` response into a validated PdfParsePlanV2, or return a
 * structured rejection so the caller can fall back to conservative routing.
 *
 * Invariants enforced (per Path-to-100 C1.1):
 *  - the payload must be an object with a positive `page_count`;
 *  - `recommended_chunk_size`, when present, is clamped to [1, 50];
 *  - `pixel_perfect` (underscore, DB form) is normalized to `pixel-perfect`
 *    (contract canonical) at this boundary only;
 *  - a PRESENT-but-unknown mode or lane is rejected (absent is allowed and
 *    defaults conservatively — null mode / 'unplanned' lane);
 *  - optional descriptive fields are coerced with safe defaults, never rejected.
 */
export function normalizePlanV2(raw: unknown): PlanNormalizeResult {
  const problems: string[] = [];

  if (!isObject(raw)) {
    return { ok: false, reason: 'plan_not_object', problems: ['plan payload is not an object'] };
  }

  const pageCount = coerceFiniteNumber(raw.page_count, NaN);
  if (!Number.isFinite(pageCount) || pageCount <= 0) {
    return { ok: false, reason: 'invalid_page_count', problems: [`page_count must be > 0 (got ${String(raw.page_count)})`] };
  }

  // Mode: absent => null (caller keeps its own mode); present-but-invalid => reject.
  let recommendedMode: PlanMode | null = null;
  if (raw.recommended_mode !== undefined && raw.recommended_mode !== null && raw.recommended_mode !== '') {
    const rawMode = String(raw.recommended_mode);
    const canonical = rawMode === 'pixel_perfect' ? 'pixel-perfect' : rawMode;
    if (canonical === 'semantic' || canonical === 'hybrid' || canonical === 'pixel-perfect') {
      recommendedMode = canonical;
    } else {
      return { ok: false, reason: 'unknown_mode', problems: [`unknown recommended_mode '${rawMode}'`] };
    }
  }

  // Lane: absent => 'unplanned'; present-but-invalid => reject.
  let recommendedLane: PlanLane = 'unplanned';
  if (raw.recommended_lane !== undefined && raw.recommended_lane !== null && raw.recommended_lane !== '') {
    const rawLane = String(raw.recommended_lane);
    if (VALID_LANES.has(rawLane)) {
      recommendedLane = rawLane as PlanLane;
    } else {
      return { ok: false, reason: 'unknown_lane', problems: [`unknown recommended_lane '${rawLane}'`] };
    }
  }

  // Chunk size: absent => null; present => clamp 1..50.
  let recommendedChunkSize: number | null = null;
  if (raw.recommended_chunk_size !== undefined && raw.recommended_chunk_size !== null) {
    const rawChunk = coerceFiniteNumber(raw.recommended_chunk_size, NaN);
    if (Number.isFinite(rawChunk) && rawChunk > 0) {
      recommendedChunkSize = Math.max(PLAN_CHUNK_SIZE_MIN, Math.min(PLAN_CHUNK_SIZE_MAX, Math.floor(rawChunk)));
    } else {
      problems.push(`ignored non-positive recommended_chunk_size '${String(raw.recommended_chunk_size)}'`);
    }
  }

  const plan: PdfParsePlanV2 = {
    contract_version: PDF_PLAN_CONTRACT_VERSION,
    engine_version: typeof raw.engine_version === 'string' ? raw.engine_version : 'unknown',
    file_type: 'pdf',
    page_count: Math.floor(pageCount),
    byte_size: Math.max(0, coerceFiniteNumber(raw.byte_size, 0)),
    has_selectable_text: coerceBool(raw.has_selectable_text, false),
    selectable_text_ratio: coerceFiniteNumber(raw.selectable_text_ratio, 0),
    scanned_page_ratio: coerceFiniteNumber(raw.scanned_page_ratio, 0),
    ocr_hint: coerceBool(raw.ocr_hint, false),
    estimated_complexity: coerceComplexity(raw.estimated_complexity),
    table_likelihood: coerceComplexity(raw.table_likelihood, 'low'),
    image_heavy: coerceBool(raw.image_heavy, false),
    design_heavy: coerceBool(raw.design_heavy, false),
    recommended_mode: recommendedMode,
    recommended_lane: recommendedLane,
    recommended_chunk_size: recommendedChunkSize,
    requires_raster: coerceBool(raw.requires_raster, false),
    requires_ocr: coerceBool(raw.requires_ocr, false),
    requires_picture_description: coerceBool(raw.requires_picture_description, false),
    plan_ms: Math.max(0, coerceFiniteNumber(raw.plan_ms, 0)),
  };

  return { ok: true, plan };
}

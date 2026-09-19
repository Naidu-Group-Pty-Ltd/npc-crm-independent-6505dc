/**
 * visual-source-expectations-v1 (Path-to-100 v2 · C3).
 *
 * The authoritative text/bounds expectations a scored template is compared
 * against MUST come from the immutable source (Docling), never from the
 * candidate CDIR being scored — otherwise a wrong-but-self-consistent
 * reconstruction scores ~100. This module packages source-derived expectations
 * into a bundle that threads through the quality gate, the orchestration and
 * the deterministic repair loop, and provides a subset loader for the
 * on-demand review path (fetch only the pages you need, never the whole doc).
 *
 * Pure and deterministic. `loadPerPageSourceExpectations` is async only because
 * it awaits an injected per-page fetcher.
 */
import type { SourceBoundsExpectation, SourceTextExpectation } from '../fidelity';
import type { DoclingExpectationsLike } from './diff';

export const VISUAL_SOURCE_EXPECTATIONS_VERSION = 'visual-source-expectations-v1';

export type VisualSourceExpectationSource =
  | 'docling-document'
  | 'per-page-docling'
  | 'legacy-import-manifest';

export interface VisualSourceExpectationBundle {
  version: typeof VISUAL_SOURCE_EXPECTATIONS_VERSION;
  source: VisualSourceExpectationSource;
  expectedText: SourceTextExpectation[];
  expectedBounds: SourceBoundsExpectation[];
  pageNumbers: number[];
  confidenceByPage?: Record<number, number | null>;
  problems: string[];
  /** true only when there is at least one expectation and no expected page is missing. */
  complete: boolean;
}

/** `full` = usable + complete; `partial` = usable but a page is missing; `image-only` = no source expectations. */
export type VisualQualityCoverage = 'full' | 'partial' | 'image-only';

/** Page id convention shared with `mapDoclingToPagePlan.pageId` / `buildDoclingExpectations`. */
export function pageNumberFromDoclingId(pageId: string | null | undefined): number | null {
  if (typeof pageId !== 'string') return null;
  const m = /docling-page-(\d+)/.exec(pageId);
  return m ? Number(m[1]) : null;
}

/** Overlay/CDIR layer id convention: `<blockId>-ov`. */
function isOverlayLayerId(layerId: string): boolean {
  return /-ov$/.test(layerId);
}

export function buildVisualSourceExpectationBundle(input: {
  source: VisualSourceExpectationSource;
  expectedText: SourceTextExpectation[];
  expectedBounds: SourceBoundsExpectation[];
  /** Pages the caller expects to be covered. Defaults to the pages that have expectations. */
  expectedPageNumbers?: number[];
  confidenceByPage?: Record<number, number | null>;
  extraProblems?: string[];
}): VisualSourceExpectationBundle {
  const problems = [...(input.extraProblems ?? [])];

  const covered = new Set<number>();
  for (const t of input.expectedText) {
    const n = pageNumberFromDoclingId(t.pageId);
    if (n) covered.add(n);
  }
  for (const b of input.expectedBounds) {
    const n = pageNumberFromDoclingId(b.pageId);
    if (n) covered.add(n);
  }

  const pageNumbers = [...covered].sort((a, b) => a - b);
  const expectedPages = input.expectedPageNumbers
    ? [...new Set(input.expectedPageNumbers.filter((n) => Number.isFinite(n) && n > 0))].sort((a, b) => a - b)
    : pageNumbers;

  const missing = expectedPages.filter((p) => !covered.has(p));
  for (const p of missing) problems.push(`source_expectations_missing_page_${p}`);

  const hasAny = input.expectedText.length > 0 || input.expectedBounds.length > 0;
  const complete = hasAny && missing.length === 0;

  return {
    version: VISUAL_SOURCE_EXPECTATIONS_VERSION,
    source: input.source,
    expectedText: input.expectedText,
    expectedBounds: input.expectedBounds,
    pageNumbers,
    ...(input.confidenceByPage ? { confidenceByPage: input.confidenceByPage } : {}),
    problems,
    complete,
  };
}

export function isSourceFidelityUsable(bundle: VisualSourceExpectationBundle | null | undefined): boolean {
  return Boolean(bundle && (bundle.expectedText.length > 0 || bundle.expectedBounds.length > 0));
}

export function resolveQualityCoverage(bundle: VisualSourceExpectationBundle | null | undefined): VisualQualityCoverage {
  if (!isSourceFidelityUsable(bundle)) return 'image-only';
  return bundle!.complete ? 'full' : 'partial';
}

/** Convert a source bundle into the `DoclingExpectationsLike` shape the scorer consumes. */
export function sourceExpectationBundleToExpectationsLike(
  bundle: VisualSourceExpectationBundle | null | undefined,
): DoclingExpectationsLike {
  if (!bundle) return { expectedText: [], expectedBounds: [] };
  return { expectedText: bundle.expectedText, expectedBounds: bundle.expectedBounds };
}

// ---------------------------------------------------------------------------
// C3.3 — subset lazy loader for the persisted / on-demand review path.
// ---------------------------------------------------------------------------

export interface PerPageSourceArtifactResult {
  pageNumber: number;
  expectedText?: SourceTextExpectation[];
  expectedBounds?: SourceBoundsExpectation[];
  confidence?: number | null;
  /** A per-page problem code (e.g. 'artifact_unreadable') the loader should record. */
  problem?: string | null;
}

export type PerPageSourceArtifactFetcher = (
  pageNumber: number,
) => Promise<PerPageSourceArtifactResult | null>;

/**
 * Build source expectations for ONLY the requested page-number subset by
 * fetching each page's signed per-page Docling/blocks artifact. Never fetches
 * an entire multi-page document to inspect one page. Validates that returned
 * page/layer ids follow the mapper convention and records missing/degraded
 * pages explicitly. The resulting bundle is `complete` only if every requested
 * page produced expectations.
 */
export async function loadPerPageSourceExpectations(input: {
  pageNumbers: number[];
  fetchPageArtifact: PerPageSourceArtifactFetcher;
  source?: VisualSourceExpectationSource;
}): Promise<VisualSourceExpectationBundle> {
  const requested = [...new Set(input.pageNumbers.filter((n) => Number.isFinite(n) && n > 0))].sort((a, b) => a - b);
  const expectedText: SourceTextExpectation[] = [];
  const expectedBounds: SourceBoundsExpectation[] = [];
  const confidenceByPage: Record<number, number | null> = {};
  const problems: string[] = [];

  for (const pageNumber of requested) {
    const pageId = `docling-page-${pageNumber}`;
    let res: PerPageSourceArtifactResult | null = null;
    try {
      res = await input.fetchPageArtifact(pageNumber);
    } catch {
      problems.push(`page_${pageNumber}_fetch_error`);
      continue;
    }
    if (!res) {
      problems.push(`page_${pageNumber}_artifact_missing`);
      continue;
    }
    if (res.problem) problems.push(`page_${pageNumber}_${res.problem}`);

    for (const t of res.expectedText ?? []) {
      if (t.pageId !== pageId) {
        problems.push(`page_${pageNumber}_text_pageid_mismatch`);
        continue;
      }
      expectedText.push(t);
    }
    for (const b of res.expectedBounds ?? []) {
      if (b.pageId !== pageId) {
        problems.push(`page_${pageNumber}_bounds_pageid_mismatch`);
        continue;
      }
      if (!isOverlayLayerId(b.layerId)) {
        problems.push(`page_${pageNumber}_layerid_convention:${b.layerId}`);
      }
      expectedBounds.push(b);
    }
    confidenceByPage[pageNumber] = res.confidence ?? null;
  }

  return buildVisualSourceExpectationBundle({
    source: input.source ?? 'per-page-docling',
    expectedText,
    expectedBounds,
    expectedPageNumbers: requested,
    confidenceByPage,
    extraProblems: problems,
  });
}

/**
 * visual-quality-batch-v1 (Path-to-100 v2 · C4).
 *
 * Removes the hard ">40 pages → skip the gate" behavior. Instead the document is
 * scored in bounded sequential batches (8–12 pages) so browser memory stays
 * bounded and EVERY page receives a verdict or is explicitly listed unscored.
 *
 * This module is the pure batching + aggregation engine: it plans batches,
 * drives an injected per-batch runner (which owns the browser-coupled capture),
 * applies each batch's repaired pages to the working template BEFORE the next
 * batch, and aggregates truthful coverage. Fail-open — a failed batch yields
 * `partial`/`none` coverage and manual review, never a silent pass and never a
 * bricked import.
 */
import type { ReportTemplate } from '../../templateSchema';
import type { CdirDocument } from '../cdir';
import type { VisualPageQualityReport } from './schema';
import {
  pageNumberFromDoclingId,
  type VisualSourceExpectationBundle,
} from './sourceExpectations';

export const VISUAL_QUALITY_BATCH_VERSION = 'visual-quality-batch-v1';

/** Default sequential batch size. Kept in the 8–12 range from the runbook. */
export const DEFAULT_VISUAL_QUALITY_BATCH_SIZE = 10;

export interface VisualQualityBatchContext {
  version: typeof VISUAL_QUALITY_BATCH_VERSION;
  documentPageCount: number;
  pageNumbers: number[];
  expectedBatchPageCount: number;
  batchIndex: number;
  batchCount: number;
}

export type BatchCoverage = 'complete' | 'partial' | 'none';

export interface VisualQualityBatchProblem {
  batchIndex: number;
  pageNumbers: number[];
  message: string;
}

export interface BatchedVisualQualitySummary {
  version: typeof VISUAL_QUALITY_BATCH_VERSION;
  coverage: BatchCoverage;
  documentPageCount: number;
  batchSize: number;
  batchesAttempted: number;
  batchesCompleted: number;
  pagesScored: number;
  pagesUnscored: number[];
  batchProblems: VisualQualityBatchProblem[];
}

export interface PlanVisualQualityBatchesResult {
  ok: boolean;
  batches: VisualQualityBatchContext[];
  problems: string[];
}

/**
 * Split page numbers into sequential batches. Rejects duplicate or invalid
 * (non-finite / non-positive) page numbers rather than silently reordering or
 * deduping — a truthful gate must not aggregate by array position.
 */
export function planVisualQualityBatches(
  pageNumbers: number[],
  batchSize: number = DEFAULT_VISUAL_QUALITY_BATCH_SIZE,
): PlanVisualQualityBatchesResult {
  const problems: string[] = [];
  const size = Math.max(1, Math.floor(batchSize) || DEFAULT_VISUAL_QUALITY_BATCH_SIZE);

  const invalid = pageNumbers.filter((n) => !Number.isFinite(n) || n <= 0 || Math.floor(n) !== n);
  if (invalid.length) problems.push(`invalid_page_numbers:${invalid.join(',')}`);

  const seen = new Set<number>();
  const duplicates = new Set<number>();
  for (const n of pageNumbers) {
    if (seen.has(n)) duplicates.add(n);
    seen.add(n);
  }
  if (duplicates.size) problems.push(`duplicate_page_numbers:${[...duplicates].sort((a, b) => a - b).join(',')}`);

  if (problems.length) return { ok: false, batches: [], problems };

  const ordered = [...pageNumbers].sort((a, b) => a - b);
  const documentPageCount = ordered.length;
  const batches: VisualQualityBatchContext[] = [];
  const chunks: number[][] = [];
  for (let i = 0; i < ordered.length; i += size) chunks.push(ordered.slice(i, i + size));

  chunks.forEach((pages, batchIndex) => {
    batches.push({
      version: VISUAL_QUALITY_BATCH_VERSION,
      documentPageCount,
      pageNumbers: pages,
      expectedBatchPageCount: pages.length,
      batchIndex,
      batchCount: chunks.length,
    });
  });

  return { ok: true, batches, problems: [] };
}

export interface VisualQualityBatchRunInput {
  batchContext: VisualQualityBatchContext;
  /** CDIR subset for this batch (only the batch's pages). */
  cdir: CdirDocument;
  /** Working template subset for this batch (carries prior batches' accepted repairs). */
  template: ReportTemplate;
  /** Source expectations subset for this batch, or null when unavailable. */
  sourceExpectations: VisualSourceExpectationBundle | null;
}

export interface VisualQualityBatchRunOutput {
  ok: boolean;
  /** Repaired template subset for this batch's pages. */
  template?: ReportTemplate | null;
  pageReports?: VisualPageQualityReport[];
  initialScore?: number | null;
  finalScore?: number | null;
  repairPassesApplied?: number;
  patchesApplied?: number;
  manualReviewRequired?: boolean;
  problems?: string[];
}

export type VisualQualityBatchRunner = (
  input: VisualQualityBatchRunInput,
) => Promise<VisualQualityBatchRunOutput>;

export interface RunBatchedVisualQualityOptions {
  template: ReportTemplate;
  cdir: CdirDocument;
  sourceExpectations?: VisualSourceExpectationBundle | null;
  batchSize?: number;
  runBatch: VisualQualityBatchRunner;
}

export interface RunBatchedVisualQualityResult {
  template: ReportTemplate;
  /** Aggregated per-page reports, ordered by page number (never by array position). */
  pageReports: VisualPageQualityReport[];
  finalScore: number | null;
  initialScore: number | null;
  scoreDelta: number | null;
  repairPassesApplied: number;
  patchesApplied: number;
  manualReviewRequired: boolean;
  batch: BatchedVisualQualitySummary;
}

function pageNumberForCdirPage(pageId: string, index: number): number {
  return pageNumberFromDoclingId(pageId) ?? index + 1;
}

function subsetCdir(cdir: CdirDocument, pageIds: Set<string>): CdirDocument {
  return { ...cdir, pages: cdir.pages.filter((p) => pageIds.has(p.id)) } as CdirDocument;
}

function mergeBatchTemplate(
  working: ReportTemplate,
  batchTemplate: ReportTemplate | null | undefined,
  pageIds: Set<string>,
): ReportTemplate {
  if (!batchTemplate) return working;
  const byId = new Map((batchTemplate.pages ?? []).map((p: { id: string }) => [p.id, p]));
  return {
    ...working,
    pages: (working.pages ?? []).map((p: { id: string }) =>
      pageIds.has(p.id) && byId.has(p.id) ? byId.get(p.id)! : p,
    ),
  } as ReportTemplate;
}

function subsetSourceExpectations(
  bundle: VisualSourceExpectationBundle | null | undefined,
  pageNumbers: number[],
): VisualSourceExpectationBundle | null {
  if (!bundle) return null;
  const want = new Set(pageNumbers);
  const inWant = (pageId: string) => {
    const n = pageNumberFromDoclingId(pageId);
    return n !== null && want.has(n);
  };
  return {
    ...bundle,
    expectedText: bundle.expectedText.filter((t) => inWant(t.pageId)),
    expectedBounds: bundle.expectedBounds.filter((b) => inWant(b.pageId)),
    pageNumbers: bundle.pageNumbers.filter((n) => want.has(n)),
  };
}

function mean(values: number[]): number | null {
  const finite = values.filter((v) => Number.isFinite(v));
  if (!finite.length) return null;
  return finite.reduce((sum, v) => sum + v, 0) / finite.length;
}

/**
 * Drive the sequential batches. Aggregates by stable page number, tracks
 * complete/partial/none coverage, and applies each batch's repaired pages to the
 * working template before the next batch runs.
 */
export async function runBatchedVisualQuality(
  options: RunBatchedVisualQualityOptions,
): Promise<RunBatchedVisualQualityResult> {
  const batchSize = options.batchSize ?? DEFAULT_VISUAL_QUALITY_BATCH_SIZE;
  const pageIdByNumber = new Map<number, string>();
  const pageNumbers = (options.cdir.pages ?? []).map((page, index) => {
    const n = pageNumberForCdirPage(page.id, index);
    pageIdByNumber.set(n, page.id);
    return n;
  });

  const documentPageCount = pageNumbers.length;
  const plan = planVisualQualityBatches(pageNumbers, batchSize);

  if (!plan.ok) {
    return {
      template: options.template,
      pageReports: [],
      finalScore: null,
      initialScore: null,
      scoreDelta: null,
      repairPassesApplied: 0,
      patchesApplied: 0,
      manualReviewRequired: true,
      batch: {
        version: VISUAL_QUALITY_BATCH_VERSION,
        coverage: 'none',
        documentPageCount,
        batchSize,
        batchesAttempted: 0,
        batchesCompleted: 0,
        pagesScored: 0,
        pagesUnscored: [...pageNumbers].sort((a, b) => a - b),
        batchProblems: [{ batchIndex: -1, pageNumbers: [], message: plan.problems.join('; ') }],
      },
    };
  }

  let workingTemplate = options.template;
  const scoredByPage = new Map<number, VisualPageQualityReport>();
  const batchProblems: VisualQualityBatchProblem[] = [];
  const initialScores: number[] = [];
  const finalScores: number[] = [];
  let batchesAttempted = 0;
  let batchesCompleted = 0;
  let repairPassesApplied = 0;
  let patchesApplied = 0;
  let anyManualReview = false;

  for (const batchContext of plan.batches) {
    batchesAttempted += 1;
    const pageIds = new Set(
      batchContext.pageNumbers.map((n) => pageIdByNumber.get(n)).filter((id): id is string => Boolean(id)),
    );

    let output: VisualQualityBatchRunOutput;
    try {
      output = await options.runBatch({
        batchContext,
        cdir: subsetCdir(options.cdir, pageIds),
        // Pass the FULL working template (accumulating prior batches' accepted
        // repairs) so later batches see earlier changes; scoring/capture are
        // limited to this batch via the subset CDIR + batch page numbers.
        template: workingTemplate,
        sourceExpectations: subsetSourceExpectations(options.sourceExpectations, batchContext.pageNumbers),
      });
    } catch (error) {
      batchProblems.push({
        batchIndex: batchContext.batchIndex,
        pageNumbers: batchContext.pageNumbers,
        message: `batch_error:${(error as Error)?.message ?? String(error)}`,
      });
      continue;
    }

    if (!output.ok) {
      batchProblems.push({
        batchIndex: batchContext.batchIndex,
        pageNumbers: batchContext.pageNumbers,
        message: (output.problems ?? ['batch_failed']).join('; '),
      });
      continue;
    }

    // Apply this batch's repaired pages to the working template BEFORE the next
    // batch, so later batches see accepted repairs. Preserve object identity when
    // there is a single batch covering the whole document.
    workingTemplate = plan.batches.length === 1
      ? (output.template ?? workingTemplate)
      : mergeBatchTemplate(workingTemplate, output.template, pageIds);

    for (const report of output.pageReports ?? []) {
      // Aggregate by stable page number — never by array position.
      if (Number.isFinite(report.pageNumber)) scoredByPage.set(report.pageNumber, report);
    }
    if (output.initialScore != null) initialScores.push(output.initialScore);
    if (output.finalScore != null) finalScores.push(output.finalScore);
    repairPassesApplied += output.repairPassesApplied ?? 0;
    patchesApplied += output.patchesApplied ?? 0;
    anyManualReview = anyManualReview || Boolean(output.manualReviewRequired);
    batchesCompleted += 1;
  }

  const pagesScored = scoredByPage.size;
  const pagesUnscored = pageNumbers.filter((n) => !scoredByPage.has(n)).sort((a, b) => a - b);
  const coverage: BatchCoverage = pagesScored === 0
    ? 'none'
    : pagesUnscored.length === 0
      ? 'complete'
      : 'partial';

  const pageReports = [...scoredByPage.values()].sort((a, b) => a.pageNumber - b.pageNumber);
  // Truthful document score = mean of the pages actually scored (existing
  // page-average policy). Unscored pages are surfaced separately, not counted 0.
  const finalScore = mean(pageReports.map((p) => p.overallScore));
  const initialScore = mean(initialScores);
  const scoreDelta = finalScore != null && initialScore != null ? finalScore - initialScore : null;

  return {
    template: workingTemplate,
    pageReports,
    finalScore,
    initialScore,
    scoreDelta,
    repairPassesApplied,
    patchesApplied,
    // Anything short of complete coverage cannot be an automatic pass.
    manualReviewRequired: anyManualReview || coverage !== 'complete',
    batch: {
      version: VISUAL_QUALITY_BATCH_VERSION,
      coverage,
      documentPageCount,
      batchSize,
      batchesAttempted,
      batchesCompleted,
      pagesScored,
      pagesUnscored,
      batchProblems,
    },
  };
}

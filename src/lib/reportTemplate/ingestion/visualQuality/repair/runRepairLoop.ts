/**
 * Phase 6 — Repair loop orchestrator.
 *
 * Walks every page whose `recommendedAction` indicates a fixable problem,
 * runs each registered solver, applies the resulting patch, and re-scores.
 * Accept-on-improvement: a patch is kept only if the re-scored page beats
 * its prior overall score. Otherwise the patch is rolled back and the
 * solver is recorded as having proposed-but-not-improved.
 *
 * Caps at 2 passes per import (Phase 2 contract) and a hard per-pass patch
 * limit to bound cost in the browser.
 *
 *   pass 1 → score → propose → apply → re-score → keep-or-rollback
 *   pass 2 → repeat for pages still flagged as 'repair'
 *
 * The orchestrator NEVER decides to fall back to hybrid/pixel — that's the
 * outer ingestion pipeline's call based on `finalReport.manualReviewRequired`
 * and per-page `recommendedAction`. We only own the surgical-fix budget.
 */
import type { CdirDocument } from '@/lib/reportTemplate/ingestion/cdir/schema';
import type {
  SourceBoundsExpectation,
  SourceTextExpectation,
} from '@/lib/reportTemplate/ingestion/fidelity';
import {
  runVisualDiff,
  type DoclingExpectationsLike,
  type RenderedPageRaster,
  type VisualDiffInput,
} from '../diff';
import type {
  VisualImportFinalMode,
  VisualImportQualityReport,
  VisualPageQualityReport,
} from '../schema';
import { applyPatch } from './applyPatch';
import { doclingRepairSolver } from './doclingSolver';
import type {
  RepairContext,
  RepairLoopResult,
  RepairPassReport,
  RepairSolver,
} from './repairTypes';

const MAX_PASSES = 2;
const MAX_PATCHES_PER_PASS = 25;

function bucketExpectations(exp: DoclingExpectationsLike): {
  expectedTextByPage: Map<string, string>;
  expectedBoundsByPage: Map<string, SourceBoundsExpectation[]>;
} {
  const expectedTextByPage = new Map<string, string>();
  for (const t of exp.expectedText as SourceTextExpectation[]) {
    if (t.pageId) expectedTextByPage.set(t.pageId, t.text);
  }
  const expectedBoundsByPage = new Map<string, SourceBoundsExpectation[]>();
  for (const b of exp.expectedBounds) {
    const bucket = expectedBoundsByPage.get(b.pageId) ?? [];
    bucket.push(b);
    expectedBoundsByPage.set(b.pageId, bucket);
  }
  return { expectedTextByPage, expectedBoundsByPage };
}

function needsRepair(page: VisualPageQualityReport): boolean {
  switch (page.recommendedAction) {
    case 'repair':
    case 'fallback_to_hybrid':
    case 'manual_review':
      return true;
    default:
      return false;
  }
}

export interface RunRepairLoopOptions {
  importId: string;
  templateId?: string | null;
  cdir: CdirDocument;
  expectations: DoclingExpectationsLike;
  renderedRasters: RenderedPageRaster[];
  sourcePdf?: Blob | ArrayBuffer | null;
  sourceRasters?: VisualDiffInput['sourceRasters'];
  finalMode: VisualImportFinalMode;
  /** Plug additional solvers (e.g. server-side AI) ahead of the deterministic one. */
  solvers?: RepairSolver[];
  /** Override pass cap (defaults to 2 per Phase 2 contract). */
  maxPasses?: number;
  /** Optional callback invoked at the end of every pass for observability. */
  onPass?: (pass: RepairPassReport) => void;
  /** Injectable scorer (tests / future server-side execution). Defaults to `runVisualDiff`. */
  runVisualDiffImpl?: (input: VisualDiffInput) => Promise<VisualImportQualityReport>;
}

/**
 * Run the repair loop end-to-end. Returns the (possibly patched) CDIR,
 * the final `VisualImportQualityReport`, and a per-pass diary so the UI
 * can show "what changed" without re-deriving it.
 */
export async function runRepairLoop(opts: RunRepairLoopOptions): Promise<RepairLoopResult> {
  const solvers: RepairSolver[] = [
    ...(opts.solvers ?? []),
    doclingRepairSolver,
  ];
  const maxPasses = Math.max(1, Math.min(MAX_PASSES, opts.maxPasses ?? MAX_PASSES));
  const score = opts.runVisualDiffImpl ?? runVisualDiff;

  // Initial scoring
  const diffBase = {
    importId: opts.importId,
    templateId: opts.templateId ?? null,
    expectations: opts.expectations,
    renderedRasters: opts.renderedRasters,
    sourcePdf: opts.sourcePdf ?? null,
    sourceRasters: opts.sourceRasters ?? null,
    finalMode: opts.finalMode,
  } satisfies Omit<VisualDiffInput, 'cdir' | 'repairPassesApplied'>;

  let currentCdir = opts.cdir;
  let report = await score({ ...diffBase, cdir: currentCdir, repairPassesApplied: 0 });

  const { expectedTextByPage, expectedBoundsByPage } = bucketExpectations(opts.expectations);
  const passes: RepairPassReport[] = [];
  let totalApplied = 0;

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const candidates = report.pages.filter(needsRepair);
    if (candidates.length === 0) break;

    const passReport: RepairPassReport = {
      passIndex: pass,
      patchesProposed: 0,
      patchesAccepted: 0,
      patchesRejected: 0,
      perPage: [],
    };

    let appliedThisPass = 0;
    for (const pageReport of candidates) {
      if (appliedThisPass >= MAX_PATCHES_PER_PASS) break;

      const ctx: RepairContext = {
        cdir: currentCdir,
        expectedTextByPage,
        expectedBoundsByPage,
      };

      let chosenPatch = null as ReturnType<RepairSolver['propose']>;
      let chosenSolver = '';
      for (const solver of solvers) {
        const patch = solver.propose(pageReport, ctx);
        if (patch && patch.ops.length > 0) {
          chosenPatch = patch;
          chosenSolver = solver.name;
          break;
        }
      }
      if (!chosenPatch) continue;
      passReport.patchesProposed += 1;

      // Try the patch and re-score JUST this page by re-running the harness
      // on the new CDIR. (Cheap: text/layout metrics are O(n); pixel metrics
      // are downscaled.) We then accept-or-rollback based on the page score.
      const { doc: trialCdir, opsApplied, opsRejected } = applyPatch(currentCdir, chosenPatch);
      if (opsApplied === 0) {
        passReport.patchesRejected += 1;
        passReport.perPage.push({
          pageId: pageReport.pageId,
          before: pageReport.overallScore,
          after: pageReport.overallScore,
          accepted: false,
          solver: chosenSolver,
          rationale: `${chosenPatch.rationale} (rejected ${opsRejected} op(s))`,
        });
        continue;
      }

      const trialReport = await score({
        ...diffBase,
        cdir: trialCdir,
        repairPassesApplied: pass + 1,
      });
      const after = trialReport.pages.find((p) => p.pageId === pageReport.pageId);
      const afterScore = after?.overallScore ?? pageReport.overallScore;

      if (afterScore > pageReport.overallScore + 0.001) {
        // Accept — promote trial to current
        currentCdir = trialCdir;
        report = trialReport;
        passReport.patchesAccepted += 1;
        appliedThisPass += 1;
        totalApplied += 1;
        passReport.perPage.push({
          pageId: pageReport.pageId,
          before: pageReport.overallScore,
          after: afterScore,
          accepted: true,
          solver: chosenSolver,
          rationale: chosenPatch.rationale,
        });
      } else {
        // Roll back
        passReport.patchesRejected += 1;
        passReport.perPage.push({
          pageId: pageReport.pageId,
          before: pageReport.overallScore,
          after: afterScore,
          accepted: false,
          solver: chosenSolver,
          rationale: `${chosenPatch.rationale} (no improvement)`,
        });
      }
    }

    passes.push(passReport);
    opts.onPass?.(passReport);
    if (passReport.patchesAccepted === 0) break; // nothing improved → no point retrying
  }

  // Final report should reflect total passes applied for the audit trail.
  const finalReport: VisualImportQualityReport = {
    ...report,
    repairPassesApplied: passes.filter((p) => p.patchesAccepted > 0).length,
  };

  return {
    cdir: currentCdir,
    finalReport,
    passes,
    totalApplied,
  };
}

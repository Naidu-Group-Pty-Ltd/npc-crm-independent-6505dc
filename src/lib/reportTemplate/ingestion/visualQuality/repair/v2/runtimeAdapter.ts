/**
 * E8 — candidate render-and-evaluate adapter (injectable).
 *
 * The cascade is pure and deterministic: it asks an injected adapter to RENDER a
 * candidate through the E6 final plan, CAPTURE the actual browser evidence +
 * raster, run E7, and return a V2 page report. The production/browser
 * implementation (browserRepairAdapter.ts) does the real render+capture+E7; unit
 * tests inject a deterministic adapter. No DOM handle, signed URL or ImageData
 * ever enters a persisted contract — the runtime result carries them transiently.
 */
import type { VisualPageQualityReportV2, RenderedPageEvidenceV1 } from '../../v2/contracts';
import type { RepairCandidateV1 } from './contracts';

export interface RepairRuntimeContextV1 {
  importId: string; templateId: string | null;
  pageId: string; pageNumber: number;
  /** runtime-only resolver: region id → ephemeral crop src (never persisted). */
  regionCropSrc?: (regionId: string) => string | null;
  /** runtime-only source page raster src (never persisted). */
  pageRasterSrc?: string | null;
  /** whether to run export evaluation for this candidate. */
  evaluateExport?: boolean;
}

export interface RepairCandidateRuntimeResultV1 {
  candidateId: string;
  pageReport: VisualPageQualityReportV2 | null;
  evidence: RenderedPageEvidenceV1 | null;
  renderPlanHash: string | null;
  renderPlanHashMatched: boolean;
  exportParityPassed: boolean | null;
  loadedAssetStates: Record<string, 'ready' | 'missing' | 'invalid'>;
  renderMs: number | null; captureMs: number | null;
  problems: string[];
}

export interface RenderAndEvaluateRepairCandidate {
  renderAndEvaluate(
    candidate: RepairCandidateV1,
    template: unknown,
    context: RepairRuntimeContextV1,
  ): Promise<RepairCandidateRuntimeResultV1>;
}

/**
 * Deterministic injectable adapter for unit tests: maps a candidate id to a
 * pre-baked runtime result (or derives one from a page report). Never touches
 * the DOM. Lets the cascade be tested end-to-end without a browser.
 */
export function createDeterministicAdapter(
  results: Record<string, Partial<RepairCandidateRuntimeResultV1> & { pageReport: VisualPageQualityReportV2 | null }>,
): RenderAndEvaluateRepairCandidate {
  return {
    async renderAndEvaluate(candidate) {
      const r = results[candidate.id];
      if (!r) {
        return {
          candidateId: candidate.id, pageReport: null, evidence: null, renderPlanHash: null,
          renderPlanHashMatched: false, exportParityPassed: null, loadedAssetStates: {},
          renderMs: 0, captureMs: 0, problems: ['no_deterministic_result_for_candidate'],
        };
      }
      return {
        candidateId: candidate.id,
        pageReport: r.pageReport,
        evidence: r.evidence ?? null,
        renderPlanHash: r.renderPlanHash ?? r.pageReport?.renderPlanHash ?? null,
        renderPlanHashMatched: r.renderPlanHashMatched ?? true,
        exportParityPassed: r.exportParityPassed ?? null,
        loadedAssetStates: r.loadedAssetStates ?? {},
        renderMs: r.renderMs ?? 0, captureMs: r.captureMs ?? 0,
        problems: r.problems ?? [],
      };
    },
  };
}

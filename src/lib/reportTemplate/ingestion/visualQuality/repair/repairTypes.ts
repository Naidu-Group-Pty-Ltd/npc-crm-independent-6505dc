/**
 * Phase 6 — Repair loop types.
 *
 * The loop is pluggable: any `RepairSolver` can propose `RepairPatch`es for
 * a page, and `applyPatch` deterministically mutates a (deep-cloned) CDIR
 * document. The orchestrator handles the cap, re-scoring, and acceptance
 * policy so we don't end up with a worse page after a "fix" than before.
 *
 * Patch ops are intentionally narrow — every op should be representable as
 * a JSON message that a future server-side AI solver can emit, and that the
 * applier can validate before mutating. No free-form replacement.
 */
import type { SourceBoundsExpectation } from '@/lib/reportTemplate/ingestion/fidelity';
import type { CdirDocument } from '@/lib/reportTemplate/ingestion/cdir/schema';
import type { VisualPageQualityReport, VisualImportQualityReport } from '../schema';

export type RepairOp =
  | {
      /** Replace the concatenated text of a CDIR text layer. */
      kind: 'replace_text';
      pageId: string;
      layerId: string;
      text: string;
    }
  | {
      /** Append a brand-new text layer to a page (used when text was dropped entirely). */
      kind: 'append_text_layer';
      pageId: string;
      layer: {
        id: string;
        bounds: { x: number; y: number; width: number; height: number };
        text: string;
        fontSize?: number;
        color?: string;
        align?: 'left' | 'center' | 'right' | 'justify';
      };
    }
  | {
      /** Snap a layer's bounds back to the expected source bounds. */
      kind: 'set_bounds';
      pageId: string;
      layerId: string;
      bounds: { x: number; y: number; width: number; height: number };
    };

export interface RepairPatch {
  pageId: string;
  ops: RepairOp[];
  /** Human-readable reason for diagnostics (not consumed by applyPatch). */
  rationale: string;
  /** Source of the patch — useful when multiple solvers run. */
  source: 'docling-deterministic' | 'ai' | 'manual';
}

export interface RepairContext {
  cdir: CdirDocument;
  expectedTextByPage: Map<string, string>;
  expectedBoundsByPage: Map<string, SourceBoundsExpectation[]>;
}

export interface RepairSolver {
  /** Stable identifier for diagnostics + memory dedupe. */
  name: string;
  /**
   * Propose at most one patch per page. Implementations should be pure
   * (no I/O) — the orchestrator handles persistence and re-scoring.
   */
  propose(page: VisualPageQualityReport, ctx: RepairContext): RepairPatch | null;
}

export interface RepairPassReport {
  passIndex: number;
  patchesProposed: number;
  patchesAccepted: number;
  patchesRejected: number;
  /** Per-page before/after scores for accepted patches. */
  perPage: Array<{
    pageId: string;
    before: number;
    after: number;
    accepted: boolean;
    solver: string;
    rationale: string;
  }>;
}

export interface RepairLoopResult {
  cdir: CdirDocument;
  finalReport: VisualImportQualityReport;
  passes: RepairPassReport[];
  /** Total patches actually applied across all passes. */
  totalApplied: number;
}

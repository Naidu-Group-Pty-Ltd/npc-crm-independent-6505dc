/**
 * Produce `RepairInputs.textFixes` from measured text defects.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `repairPassesApplied` was **0 on every one of 14 production imports**, and
 * the reason turned out to be structural rather than a tuning problem:
 *
 *   - The V2 repair cascade can already express the fix. `set-text-font-size`,
 *     `set-text-line-height`, `set-text-letter-spacing` and
 *     `set-text-white-space` are declared in `candidateGeneration.ts` and
 *     applied in `operationApply.ts`. Fully plumbed, end to end.
 *   - Nothing anywhere produced their input. `RepairInputs.textFixes` had no
 *     writer outside spec files, so the branch that consumes it was unreachable.
 *
 * So the loop that could fix constricted text was never handed anything to fix.
 * This module is that writer.
 *
 * EVERY FIX MUST CARRY REAL EVIDENCE
 * ----------------------------------
 * `RepairSourceEvidenceReferenceV1` is not decoration — it is what makes it
 * safe to let an automated loop mutate a client's document. A fix traceable to
 * a measured source fact can be reviewed and reversed; one that is not is an
 * unattributed edit. So evidence is a required argument here, and this module
 * NEVER synthesises one to make a fix eligible. If the caller cannot say where
 * a defect was measured, there is no fix.
 *
 * Pure and deterministic.
 */
import type { RepairSourceEvidenceReferenceV1 } from './contracts';
import type { RepairInputs, TextFix } from './candidateGeneration';
import {
  reconcileTextReflow,
  type ReflowInput,
} from '@/lib/reportTemplate/pdfImport/textReflowReconciliation.pure';

/** One overlay's measured overflow, plus where that measurement came from. */
export interface MeasuredTextDefect extends ReflowInput {
  overlayId: string;
  evidence: RepairSourceEvidenceReferenceV1;
  /** Current line height, so a spill can be resolved by tightening leading. */
  lineHeight?: number;
  /** True when the renderer wrapped a line the source did not. */
  lineCountRegression?: boolean;
  expectedTargetHash?: string | null;
}

export interface BuildRepairInputsResult {
  inputs: RepairInputs;
  /** Overlays whose overflow no bounded remedy can resolve. */
  unresolved: Array<{ overlayId: string; ratio: number; reason: string }>;
}

/**
 * Minimum leading a fix may tighten to.
 *
 * Below roughly this, lines begin to touch and the text stops being
 * comfortably readable — at which point the layout problem has been traded for
 * a legibility one, which is not a repair.
 */
export const MIN_LINE_HEIGHT = 1.05;

/**
 * Turn measured defects into evidence-backed text fixes.
 *
 * Remedy choice belongs to `reconcileTextReflow`; this module's job is to map
 * its decision onto the operation vocabulary the cascade already understands,
 * and to report honestly what it could not resolve. An overlay it gives up on
 * is surfaced in `unresolved` rather than dropped, because a page whose text
 * genuinely cannot fit should fall back to its source crop — and something has
 * to say so.
 */
export function buildRepairInputs(
  defects: readonly MeasuredTextDefect[],
): BuildRepairInputsResult {
  const textFixes: TextFix[] = [];
  const unresolved: BuildRepairInputsResult['unresolved'] = [];

  for (const defect of defects) {
    // No evidence, no fix. Not negotiable — see the header.
    if (!defect.evidence || !defect.evidence.kind || !defect.evidence.ref) continue;

    const decision = reconcileTextReflow(defect);

    // A line-count regression is a distinct defect from a width overrun: the
    // source was one line and the renderer made it two. `nowrap` addresses it
    // directly, and it composes with whatever width remedy also applies.
    const wantsNowrap = defect.lineCountRegression === true;

    if (decision.remedy === 'source-crop-recommended') {
      unresolved.push({
        overlayId: defect.overlayId,
        ratio: decision.ratio,
        reason: decision.reason,
      });
      // Still worth stopping the wrap even when the width cannot be fixed —
      // one long line reads better than two clipped ones.
      if (wantsNowrap) {
        textFixes.push({
          overlayId: defect.overlayId,
          whiteSpace: 'nowrap',
          evidence: defect.evidence,
          ...(defect.expectedTargetHash != null
            ? { expectedTargetHash: defect.expectedTargetHash } : {}),
        });
      }
      continue;
    }

    if (decision.remedy === 'none' && !wantsNowrap) continue;

    const fix: TextFix = {
      overlayId: defect.overlayId,
      evidence: defect.evidence,
      ...(defect.expectedTargetHash != null
        ? { expectedTargetHash: defect.expectedTargetHash } : {}),
    };

    if (decision.remedy === 'letter-spacing' && decision.letterSpacingPt != null) {
      fix.letterSpacing = decision.letterSpacingPt;
    } else if (decision.remedy === 'font-size' && decision.fontSizePt != null) {
      fix.fontSize = { before: defect.fontSizePt, after: decision.fontSizePt };
    }
    // 'grow-box' is a GEOMETRY change, not a text one — it belongs in
    // overlayBBoxFixes, which needs a source bbox this module is not given.
    // Emitting it here would silently drop it, so it is left to the caller.

    if (wantsNowrap) fix.whiteSpace = 'nowrap';

    // A fix that carries no actual change is noise in the candidate budget.
    const changes = fix.letterSpacing != null || fix.fontSize != null
      || fix.whiteSpace != null || fix.lineHeight != null;
    if (changes) textFixes.push(fix);
  }

  return {
    inputs: textFixes.length ? { textFixes } : {},
    unresolved,
  };
}

/**
 * Tighten leading to resolve a VERTICAL overflow.
 *
 * Separate from the width ladder because the two are independent: a box can be
 * wide enough and still too short. Bounded by `MIN_LINE_HEIGHT`, and returns
 * null rather than a value that would make lines touch.
 */
export function lineHeightFixFor(
  currentLineHeight: number,
  renderedHeightPt: number,
  boxHeightPt: number,
): number | null {
  if (!Number.isFinite(currentLineHeight) || currentLineHeight <= 0) return null;
  if (!Number.isFinite(renderedHeightPt) || renderedHeightPt <= 0) return null;
  if (!Number.isFinite(boxHeightPt) || boxHeightPt <= 0) return null;
  if (renderedHeightPt <= boxHeightPt) return null;

  const wanted = currentLineHeight * (boxHeightPt / renderedHeightPt);
  if (wanted < MIN_LINE_HEIGHT) return null;
  return Math.round(wanted * 1000) / 1000;
}

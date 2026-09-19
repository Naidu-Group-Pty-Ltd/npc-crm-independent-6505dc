/**
 * Run the V2 text evaluators alongside V1 and record where they disagree —
 * without letting V2 influence anything.
 *
 * WHY SHADOW RATHER THAN SWITCH
 * -----------------------------
 * V2 has never scored a real document. Its evaluators are correct and
 * unit-tested, but "correct on fixtures" and "calibrated against production"
 * are different claims, and 117 real imports are the only evidence that settles
 * the second. Promoting V2 to gate authority now would trade a gate we know is
 * blind to text overflow for one whose false-positive rate nobody has measured
 * — on a gate that can block finalization of a client's document.
 *
 * So V2 runs, its verdicts are recorded next to V1's, and it decides nothing.
 * When the comparison over the golden corpus shows V2 agreeing or demonstrably
 * better, the switch is a one-line change with evidence behind it.
 *
 * THE INVARIANT
 * -------------
 * This module returns a REPORT and never a template, a score, or a decision.
 * It has no way to affect the import even by mistake, which is what makes it
 * safe to run on production traffic from the first day.
 *
 * Pure and deterministic.
 */
import type { RenderedTextEvidenceV1 } from './contracts';

export const SHADOW_GATE_VERSION = 'quality-gate-v2-shadow-v1';

export interface ShadowPageInput {
  pageNumber: number;
  evidence: readonly RenderedTextEvidenceV1[];
  /** What V1 concluded for this page, so the two can be compared. */
  v1NeedsReview: boolean;
  v1Score?: number | null;
}

export interface ShadowPageVerdict {
  pageNumber: number;
  /** Overlays whose text is cut off by a clipping ancestor. */
  clippedCount: number;
  /** Overlays whose text spills outside its box. */
  overflowingCount: number;
  offPageCount: number;
  invisibleCount: number;
  measuredCount: number;
  /** V2's own conclusion: would it have flagged this page? */
  v2NeedsReview: boolean;
  v1NeedsReview: boolean;
  /**
   * How the two differ. `v2-only` is the interesting case — it is the defect
   * class V1 is structurally unable to see.
   */
  agreement: 'agree' | 'v2-only' | 'v1-only';
}

export interface ShadowGateReport {
  version: string;
  pages: ShadowPageVerdict[];
  totals: {
    pages: number;
    agree: number;
    v2Only: number;
    v1Only: number;
    clipped: number;
    overflowing: number;
  };
  /**
   * True while V2 is advisory. Present so a downstream consumer can never
   * mistake this report for a decision, however it is serialised.
   */
  advisoryOnly: true;
}

/**
 * A page is flagged by V2 when any text is cut off or spilling.
 *
 * Deliberately narrow: only the defect class this evidence actually measures.
 * Folding in contrast or occlusion would make the comparison against V1 a
 * comparison of two different questions, and the point of shadowing is to learn
 * one thing precisely rather than several things vaguely.
 */
function pageVerdict(input: ShadowPageInput): ShadowPageVerdict {
  let clippedCount = 0;
  let overflowingCount = 0;
  let offPageCount = 0;
  let invisibleCount = 0;

  for (const ev of input.evidence) {
    // Hidden-semantic layers are meant to be invisible; counting them would
    // manufacture defects out of correct behaviour.
    if (ev.hiddenSemantic) continue;
    if (!ev.visible) { invisibleCount += 1; continue; }
    if (ev.clipped) clippedCount += 1;
    if (ev.overflowing === true) overflowingCount += 1;
    if (ev.offPage) offPageCount += 1;
  }

  const v2NeedsReview = clippedCount > 0 || overflowingCount > 0 || offPageCount > 0;
  const agreement: ShadowPageVerdict['agreement'] =
    v2NeedsReview === input.v1NeedsReview ? 'agree'
      : v2NeedsReview ? 'v2-only' : 'v1-only';

  return {
    pageNumber: input.pageNumber,
    clippedCount,
    overflowingCount,
    offPageCount,
    invisibleCount,
    measuredCount: input.evidence.length,
    v2NeedsReview,
    v1NeedsReview: input.v1NeedsReview,
    agreement,
  };
}

/** Score every page in shadow. Never throws; never decides anything. */
export function runShadowGate(pages: readonly ShadowPageInput[]): ShadowGateReport {
  const verdicts = pages.map(pageVerdict);
  return {
    version: SHADOW_GATE_VERSION,
    pages: verdicts,
    totals: {
      pages: verdicts.length,
      agree: verdicts.filter((v) => v.agreement === 'agree').length,
      v2Only: verdicts.filter((v) => v.agreement === 'v2-only').length,
      v1Only: verdicts.filter((v) => v.agreement === 'v1-only').length,
      clipped: verdicts.reduce((a, v) => a + v.clippedCount, 0),
      overflowing: verdicts.reduce((a, v) => a + v.overflowingCount, 0),
    },
    advisoryOnly: true,
  };
}

/**
 * Is V2 ready to take authority?
 *
 * Not a gate on the import — a readiness check for the humans deciding whether
 * to promote it. V2 disagreeing is expected and is the whole point: it can see
 * a defect class V1 cannot. What would block promotion is V2 clearing pages V1
 * flagged (`v1Only`), because that means it is blind to something V1 catches,
 * and trading one blindness for another is not progress.
 */
export function shadowReadiness(report: ShadowGateReport): {
  ready: boolean;
  reason: string;
} {
  if (report.totals.pages === 0) {
    return { ready: false, reason: 'no_pages_scored' };
  }
  if (report.totals.v1Only > 0) {
    return {
      ready: false,
      reason: `v2_misses_${report.totals.v1Only}_pages_v1_flagged`,
    };
  }
  return {
    ready: true,
    reason: report.totals.v2Only > 0
      ? `v2_finds_${report.totals.v2Only}_pages_v1_cannot_see`
      : 'v2_agrees_with_v1_on_every_page',
  };
}

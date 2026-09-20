/**
 * What an invocation actually achieved, and whether the row may be touched.
 *
 * ## Why this exists
 *
 * `investment_reports` carries a `BEFORE UPDATE` trigger
 * (`update_investment_reports_updated_at` → `update_updated_at_column()`), so
 * **every** write stamps `updated_at`, whether or not the payload names it.
 * The server watchdog claims a stalled run on
 * `updated_at < now() - interval '2 minutes'` and the progress widget calls a
 * run stalled after three minutes without a new section.
 *
 * Both of those are staleness detectors, and both are defeated by a write that
 * carries no new information. On the 18 Annabelle Crescent run of 19 Sep 2026
 * the acquisition phase consumed the invocation, the first section was
 * deferred, and the budget hand-off wrote `status: 'processing'` anyway — which
 * refreshed `updated_at`, told the watchdog the run was healthy, and returned
 * HTTP 200 `success: true` to the caller. Twenty-one minutes and two retries
 * later the row still held zero sections and nothing anywhere had reported a
 * problem.
 *
 * The rule this module exists to enforce: **activity is not progress.**
 * Re-running the same research, or re-writing the same status, is work — it is
 * not advancement, and it must not look like advancement to anything that is
 * watching for a stall.
 *
 * ## Why this is not "just omit updated_at"
 *
 * It cannot be. The trigger stamps it regardless of the payload, so the only
 * way not to refresh the staleness clock is **not to write the row at all**.
 * That is why this returns a decision about writing rather than a payload
 * field, and why `DurableProgress` has to be computed before the write is
 * issued rather than inferred from it afterwards.
 *
 * Nothing here disables a watchdog or a safeguard. It restores them: once a
 * no-progress invocation stops refreshing the clock, `updated_at` ages
 * naturally, the watchdog claims the run, and `resume_attempts < 8` in
 * `claim_stalled_investment_reports` bounds the retries that were previously
 * unreachable.
 */

/** The durable things an invocation can bank. Each is independently sufficient. */
export interface RunAchievement {
  /** Sections written to `report_content` by THIS invocation. */
  sectionsWrittenThisRun: number;
  /**
   * Acquisition results newly persisted by this invocation — research that a
   * later invocation will not have to buy again. This is real progress even
   * though no prose exists yet, and it is the answer to "a long research phase
   * looks identical to a hang".
   */
  acquisitionFieldsBanked: number;
  /**
   * True when this invocation established the section plan for the first time
   * (`total_sections` was unknown and is now known). The widget cannot render
   * "of 15" without it, so it is information even though it is not content.
   */
  sectionPlanNewlyKnown: boolean;
}

export type DurableProgress =
  | { made: true; kind: 'sections'; sections: number }
  | { made: true; kind: 'acquisition'; fields: number }
  | { made: true; kind: 'plan' }
  | { made: false; kind: 'none' };

/**
 * Did this invocation advance the record?
 *
 * Ordered by how much a reader gets from it, so the strongest true statement is
 * the one reported.
 */
export function classifyProgress(achievement: RunAchievement): DurableProgress {
  if (achievement.sectionsWrittenThisRun > 0) {
    return { made: true, kind: 'sections', sections: achievement.sectionsWrittenThisRun };
  }
  if (achievement.acquisitionFieldsBanked > 0) {
    return { made: true, kind: 'acquisition', fields: achievement.acquisitionFieldsBanked };
  }
  if (achievement.sectionPlanNewlyKnown) {
    return { made: true, kind: 'plan' };
  }
  return { made: false, kind: 'none' };
}

/**
 * May this invocation write the report row?
 *
 * Only where something durable changed. A write with nothing new in it is the
 * defect this module exists to close: it refreshes `updated_at` through the
 * trigger and blinds every stall detector watching the row.
 */
export function mayTouchRow(progress: DurableProgress): boolean {
  return progress.made;
}

/** How the hand-off describes itself to its caller. */
export type HandoffOutcome =
  /** Work was banked and there is more to do. Resume normally. */
  | { state: 'progressed'; resumeRequired: true; durableProgress: true }
  /** Everything is written. */
  | { state: 'complete'; resumeRequired: false; durableProgress: true }
  /**
   * Nothing was banked. Explicit, actionable, and deliberately NOT `success`:
   * a caller that advances its section counter on `success` alone would skip a
   * section that was never written.
   */
  | {
      state: 'no_progress';
      resumeRequired: true;
      durableProgress: false;
      reason: NoProgressReason;
    };

export type NoProgressReason =
  /** The research phase used the invocation before a section could start. */
  | 'acquisition_exhausted_invocation'
  /** A section was attempted and every attempt failed. */
  | 'section_attempts_failed'
  /** No window remained for a model call when the loop was reached. */
  | 'no_section_window';

export function describeHandoff(
  progress: DurableProgress,
  isComplete: boolean,
  reason: NoProgressReason,
): HandoffOutcome {
  if (isComplete) return { state: 'complete', resumeRequired: false, durableProgress: true };
  if (progress.made) return { state: 'progressed', resumeRequired: true, durableProgress: true };
  return { state: 'no_progress', resumeRequired: true, durableProgress: false, reason };
}

/**
 * Whether a caller driving continuations may treat this response as having
 * completed the section it asked for.
 *
 * `useChunkedRegeneration` advanced its loop on `data.success` alone, and a
 * budget hand-off returns `success: true` — so a section that was deferred and
 * never written would have been stepped over and lost from the document. The
 * authority is the server's own section counter, never the success flag.
 */
export function sectionWasWritten(response: {
  success?: boolean;
  durableProgress?: boolean;
  sectionCompleted?: number;
}, sectionIndexRequested: number): boolean {
  if (!response?.success) return false;
  if (response.durableProgress === false) return false;
  return typeof response.sectionCompleted === 'number'
    && response.sectionCompleted > sectionIndexRequested;
}

import { useState, useCallback, useEffect, useRef } from 'react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import {
  createProgressToastId,
  settleProgressToast,
  showProgressToast,
} from '@/lib/progressToast';
import { sectionCountForTier, normaliseReportTier } from '@/lib/reports/compassSectionRegistry';
import {
  cancellationReason,
  cancelledReportId,
  DEFAULT_CANCELLATION_REASON,
  REPORT_GENERATION_CANCELLED_EVENT,
  REPORT_GENERATION_STARTED_EVENT,
  shouldMarkRunFailed,
  type ReportGenerationStartedDetail,
} from '@/lib/reports/generationSignals.pure';
import {
  claimGenerationDriver,
  driverHolderLabel,
  heartbeatGenerationDriver,
  newDriverIdentity,
  releaseGenerationDriver,
} from '@/lib/reports/generationDriver';
import { resolveGenerationEngine, type GenerationEngine } from '@/lib/reports/generationEngine.pure';
import { nextSectionIndex } from '@/lib/reports/investment/runProgress.pure';
import {
  isRepeatableFailure,
  readRunRow,
  settleRunOutcome,
  TRANSIENT_RETRY_DELAYS_MS,
  type RowReadResult,
} from '@/lib/reports/runRowRead.pure';
import type { ReportRunRow } from '@/lib/reports/investment/failureStamp.pure';

export type RegenerationPhase = 'idle' | 'generate' | 'condense' | 'qa' | 'done';

/** Re-exported so the existing importers keep their import path; the rule lives in the pure module. */
export type { GenerationEngine };

interface ChunkedRegenerationOptions {
  reportId: string;
  propertyAddress: string;
  generationEngine?: GenerationEngine;
  manualOverrides?: Record<string, any>;
  financialCalculations?: Record<string, any>;
  currentReportContent?: string;
  onProgress?: (section: number, total: number, phase: RegenerationPhase) => void;
  onComplete?: () => void;
  onError?: (error: string) => void;
}

interface RegenerationState {
  isRegenerating: boolean;
  currentSection: number;
  totalSections: number;
  phase: RegenerationPhase;
  tier: 'compass-40' | 'financial-analysis';
  error: string | null;
}

const MAX_RETRIES_PER_SECTION = 2;
const DEFAULT_TIER = 'compass-40' as const;

/** A status read is ~1.4s; a hung one must not hold the end of a run for a minute. */
const STATUS_READ_TIMEOUT_MS = 20000;
const PROGRESS_SELECT = 'status, current_version, last_completed_section, total_sections';

/** One status read of the row, for `readRunRow` to repeat through a blip. */
function readProgressRow(reportId: string) {
  return readRunRow<ReportRunRow & { current_version?: unknown }>(() =>
    invokeSecureFunction('get-investment-reports', {
      reportId,
      listOptions: { select: PROGRESS_SELECT },
    }, { timeoutMs: STATUS_READ_TIMEOUT_MS }),
  );
}

export function useChunkedRegeneration() {
  const [state, setState] = useState<RegenerationState>({
    isRegenerating: false,
    currentSection: 0,
    totalSections: sectionCountForTier(DEFAULT_TIER),
    phase: 'idle',
    tier: DEFAULT_TIER,
    error: null,
  });

  const abortRef = useRef(false);
  /** The report this instance is driving, so a Stop elsewhere aborts the right run. */
  const activeReportIdRef = useRef<string | null>(null);
  /** What the stop should record. Set by the signal; `abort()` alone carries none. */
  const abortReasonRef = useRef<string>(DEFAULT_CANCELLATION_REASON);

  /* The progress widget's Stop is the caller `abort()` never had. Several
     instances of this hook are mounted at once — every report card carries a
     Regenerate button — so the id is compared: a Stop on one report must not
     abort another card's regeneration. */
  useEffect(() => {
    const onCancelled = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      const id = cancelledReportId(detail);
      if (!id || id !== activeReportIdRef.current) return;
      abortReasonRef.current = cancellationReason(detail);
      abortRef.current = true;
    };
    window.addEventListener(REPORT_GENERATION_CANCELLED_EVENT, onCancelled);
    return () => window.removeEventListener(REPORT_GENERATION_CANCELLED_EVENT, onCancelled);
  }, []);

  const regenerate = useCallback(async (options: ChunkedRegenerationOptions) => {
    const {
      reportId,
      propertyAddress,
      generationEngine,
      manualOverrides = {},
      financialCalculations = {},
      onProgress,
      onComplete,
      onError,
    } = options;

    abortRef.current = false;
    abortReasonRef.current = DEFAULT_CANCELLATION_REASON;
    activeReportIdRef.current = reportId;

    /* A dismissible notice: sonner will not draw a close button on a loading
       toast, and this one lives for the whole run. */
    const toastId = createProgressToastId('report-generation');
    showProgressToast(toastId, 'Starting regeneration…', 'Preparing to regenerate report in chunks…');

    /* One driver per report, taken BEFORE anything is written.
     *
     * The progress widget pumps sections too, and on 20 Sep 2026 both pumps
     * drove 97 Poole Road at once: the production log shows one at
     * `last_completed_section=14, 134,392 chars` while the other was writing
     * section 8, and the finished document came out 14,247 characters SHORTER
     * than the one that had already completed. See `generationDriver.ts`.
     *
     * A refusal is not an error — the work is happening, just not here — so it
     * settles the notice as information and leaves the row alone. Writing
     * `failed` here would be this defect committed a third time. */
    const driver = newDriverIdentity('regenerate');
    const claim = claimGenerationDriver(reportId, driver);
    if (claim.ok === false) {
      settleProgressToast(
        toastId,
        'info',
        'Already generating',
        `This report is being generated by ${driverHolderLabel(claim.heldBy)}.`,
      );
      setState(prev => ({ ...prev, isRegenerating: false, phase: 'idle' }));
      activeReportIdRef.current = null;
      return;
    }

    /* What this run knows, for the failure path to consult.
     *
     * On 24 Sep 2026 60 Lawley Street finished — the generator answered
     * `isComplete` and wrote the row `completed` — and a three-second
     * platform 503 on the reads after it was taken as a run in an unknown
     * state and stamped the finished document failed. The catch below must
     * know what the server already said, and whether this run ever touched
     * the row at all. See `failureStamp.pure.ts`. */
    let serverReportedComplete = false;
    let wroteNothing = true;
    /** The run ended with a status nobody could read — not a known failure. */
    let statusUnknown = false;

    try {
      // Fetch current report state — include `report_tier` so we know the section count.
      // Repeated through a transient failure: a blip at kickoff used to abort
      // the run before it began.
      const kickoff = await readRunRow<Record<string, any>>(() =>
        invokeSecureFunction('get-investment-reports', {
          reportId,
          listOptions: {
            select: 'report_content, manual_overrides, financial_calculations, last_completed_section, status, current_version, property_address, report_scope, report_tier, generation_engine, total_sections'
          }
        }),
      );

      if (kickoff.kind === 'unreadable') {
        throw new Error(kickoff.error.message || 'Failed to fetch report');
      }

      const report = kickoff.kind === 'row' ? kickoff.row : undefined;
      const tier = normaliseReportTier(report?.report_tier);
      // Prefer the actual chunk count persisted by the edge function (so
      // legacy engine reports show the real number of chunks, not the
      // Compass-40 default of 17).
      const persistedTotal = Number(report?.total_sections) || 0;
      const totalSections = persistedTotal > 0 ? persistedTotal : sectionCountForTier(tier);
      const existingCompletedSection = Math.min(
        Math.max(Number(report?.last_completed_section) || 0, 0),
        totalSections,
      );
      const isInterruptedRun = ['processing', 'failed', 'pending'].includes(String(report?.status || '').toLowerCase());
      const hasPartialProgress = Boolean(report?.report_content) && existingCompletedSection > 0;
      const shouldResumeGeneration = isInterruptedRun && hasPartialProgress && existingCompletedSection < totalSections;
      const shouldResumePostProcessing = isInterruptedRun && hasPartialProgress && existingCompletedSection >= totalSections;

      setState({
        isRegenerating: true,
        currentSection: 0,
        totalSections,
        phase: 'generate',
        tier,
        error: null,
      });

      // Mark processing without destroying resume state. Reset to section 0 only
      // when there is no usable partial progress; otherwise continue from the
      // last successfully saved section.
      // Resolve the effective engine through the one rule that mirrors the
      // server's. It reads the report's OWN tier, not `tier` above:
      // `normaliseReportTier` collapses snapshot / briefing / strategic into
      // Compass for the section count, which is right for counting chunks and
      // wrong for choosing an engine — it would have regenerated 56 production
      // reports as Compass documents.
      const effectiveEngine: GenerationEngine =
        generationEngine ?? resolveGenerationEngine({
          reportTier: report?.report_tier,
          storedEngine: report?.generation_engine,
        });

      const startPayload: Record<string, any> = {
        status: 'processing',
        error_message: null,
        generation_engine: effectiveEngine,
      };
      if (!shouldResumeGeneration && !shouldResumePostProcessing) {
        startPayload.last_completed_section = 0;
      }

      // Retry on transient statement-timeouts
      // (Postgres 57014) and other 5xx blips. The first reset writes
      // status='processing' which fires the archive_report_version trigger;
      // under polling contention that single call can occasionally exceed the
      // DB statement timeout. Retrying keeps the regeneration alive.
      let resetOk = false;
      let resetErr: any = null;
      // From the first attempt on, the row may have been written — a write
      // whose answer was lost still landed — so the failure path treats it
      // as touched.
      wroteNothing = false;
      for (let attempt = 0; attempt < 3 && !resetOk; attempt++) {
        if (attempt > 0) {
          await new Promise((r) => setTimeout(r, 1500 * attempt));
        }
        const { error } = await invokeSecureFunction('manage-investment-reports', {
          action: 'update',
          reportId,
          data: startPayload,
        });
        if (!error) { resetOk = true; break; }
        resetErr = error;
        console.warn(`[ChunkedRegeneration] Reset attempt ${attempt + 1} failed:`, error.message || error);
      }
      if (!resetOk) {
        throw new Error(`Failed to start regeneration: ${resetErr?.message || 'unknown error'}`);
      }
      // Every section was already banked when this run began: what is left is
      // the finishing step, and the document is complete whatever a later
      // read manages to say about it.
      if (shouldResumePostProcessing) serverReportedComplete = true;

      // The row is now 'processing' server-side. Wake the floating progress
      // widget so the interactive surface — per-report progress, Stop, Pause,
      // auto-continue, ETA, history — is on screen for the whole run rather
      // than this hook's toast being the only feedback.
      // The instant travels with the signal: this is the only moment anything
      // knows when THIS run began, and the row cannot say (it is reused across
      // regenerations, so its `created_at` is the report's birthday).
      window.dispatchEvent(
        new CustomEvent<ReportGenerationStartedDetail>(REPORT_GENERATION_STARTED_EVENT, {
          detail: { reportId, startedAt: Date.now() },
        }),
      );

      const effectivePropertyAddress = propertyAddress || report?.property_address || '';
      const startSection = shouldResumeGeneration || shouldResumePostProcessing ? existingCompletedSection : 0;

      // ── Phase 1: Generate sections ────────────────────────────────────────
      let allSectionsComplete = false;
      /* Sections banked by this run. A local, never `state.currentSection`:
         `regenerate` is dependency-free by design, so `state` here is the value
         captured on first render and would report 0 for ever. */
      let sectionsDone = startSection;
      /* A bound on the whole run, not per section. Following the server's
         counter (below) means a restarted document is walked again from its
         first section — once, because the server restarts only on strictly
         better evidence — so the ordinary run plus one restart plus every
         retry fits well inside three passes. Past that something is wrong,
         and saying so beats calling for ever. */
      const maxCalls = totalSections * (MAX_RETRIES_PER_SECTION + 1) + 4;
      let callsMade = 0;
      for (let section = startSection; section < totalSections; section++) {
        if (abortRef.current) {
          console.log('[ChunkedRegeneration] Aborted by user');
          break;
        }

        /* Once a section, not on a timer: the claim then measures real
           progress, so a pump wedged inside one call lets its lease lapse and
           the report becomes recoverable instead of held for ever. */
        heartbeatGenerationDriver(reportId, driver);

        setState(prev => ({ ...prev, currentSection: section + 1, phase: 'generate' }));
        onProgress?.(section + 1, totalSections, 'generate');

        // Closing this notice only hides it — generation continues, and the
        // floating progress widget remains the place to stop a run.
        showProgressToast(
          toastId,
          `Generating section ${section + 1}/${totalSections}…`,
          tier === 'financial-analysis' ? 'Financial Analysis Report' : 'Compass-40 Report',
        );

        let sectionSuccess = false;
        let lastError = '';
        /* Where the server's counter says to go next, when that is not simply
           the section after this one. */
        let resumeAt: number | null = null;

        for (let retry = 0; retry < MAX_RETRIES_PER_SECTION && !sectionSuccess; retry++) {
          if (retry > 0) {
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
          callsMade += 1;
          if (callsMade > maxCalls) {
            throw new Error(
              `Report regeneration did not converge after ${maxCalls} calls — the record's own section counter is the place to look.`,
            );
          }

          const { data, error } = await invokeSecureFunction('generate-investment-report', {
            reportId,
            propertyAddress: effectivePropertyAddress,
            propertyDetails: {
              queryType: report?.report_scope || 'address',
              // The report's own tier, never the normalised one: the tier is the
              // data-minimisation boundary the server resolves the engine from,
              // so normalising it here rewrites a snapshot into a Compass report.
              reportTier: report?.report_tier ?? undefined,
              generationEngine: effectiveEngine,
              manualOverrides: manualOverrides || report?.manual_overrides || {},
              ...financialCalculations,
              ...(report?.financial_calculations || {}),
            },
            continueFrom: true,
            singleSection: true,
          }, { timeoutMs: 180000 });

          if (error) {
            lastError = error.message || 'Unknown error';
            console.error(`[ChunkedRegeneration] Section ${section + 1} error:`, lastError);
            continue;
          }

          if (data?.isComplete) {
            console.log('[ChunkedRegeneration] All sections complete');
            sectionSuccess = true;
            allSectionsComplete = true;
            serverReportedComplete = true;
            break;
          }

          // Advance on the SERVER'S section counter, never on `success` alone.
          //
          // A budget hand-off returns HTTP 200 `success: true` while having
          // written nothing — that is how it tells the caller "resume me", not
          // "the section is done". Treating it as done stepped the loop past a
          // section that was never generated, and the report would have shipped
          // with that section silently missing.
          //
          // And the counter can go DOWN: the server restarts the document when
          // a later invocation holds strictly more evidence than the sections
          // on the row were written from (`evidenceBasis.pure.ts`). This loop
          // then follows the row rather than its own count, which would read a
          // restart as "no progress", retry, throw, and stamp a healthy report
          // failed. `nextSectionIndex` is the one place both judgements are
          // made; see `runProgress.pure.ts`.
          const next = nextSectionIndex(data ?? {}, section);
          if (next !== null) {
            sectionSuccess = true;
            if (next !== section + 1) {
              console.warn(
                `[ChunkedRegeneration] Asked for section ${section + 1}; the record now stands at ${next}`
                + (data?.sectionsRestarted ? ' — restarted on a better evidence basis' : '')
                + '. Following the record.',
              );
              resumeAt = next;
            }
          } else if (data?.success) {
            // A healthy hand-off that banked nothing. Not a failure, and not
            // progress either: retry this SAME section rather than moving on.
            lastError = data?.noProgressReason
              ? `no durable progress (${data.noProgressReason})`
              : 'the invocation returned without writing this section';
            console.warn(
              `[ChunkedRegeneration] Section ${section + 1}: ${lastError} — retrying the same section`,
            );
          } else {
            lastError = data?.error || 'Section generation failed';
          }
        }

        if (!sectionSuccess) {
          throw new Error(`Failed to generate section ${section + 1}: ${lastError}`);
        }

        // Land the loop on the record's own counter: the increment below takes
        // it to `resumeAt`, the next section the server has not written.
        if (resumeAt !== null) section = resumeAt - 1;

        sectionsDone = allSectionsComplete ? totalSections : section + 1;

        // The edge function reports completion the moment the last section
        // lands. Without this the outer loop kept calling for section indices
        // that were already generated — every one of them a full round-trip
        // that skipped straight to finalisation and did the post-processing
        // again.
        if (allSectionsComplete) break;
      }

      // A stop is not a failure. Leaving it to fall through meant the final
      // check below found an incomplete report, threw 'Report regeneration
      // incomplete', and told the operator their own Stop had failed — then
      // wrote `status: 'failed'` a second time over the reason the widget had
      // already recorded ("Cancelled by <user>"). Say what happened and leave
      // the row as the surface that stopped it left it.
      if (abortRef.current) {
        console.log('[ChunkedRegeneration] Stopped by user');
        // Re-assert the stop, because this is the last writer by construction.
        // The section already in flight when Stop was pressed keeps running,
        // and on a budgeted hand-off it writes `status: 'processing'` as it
        // returns — landing after the stopping surface's write and undoing it,
        // so Stop reverted to "Processing" on the next poll. We only get here
        // once that call has resolved.
        //
        // Never on a run that finished: the last section can land in the same
        // beat as the Stop, and marking a completed report failed destroys it.
        // Contained: a re-assert that fails must not fall into the catch below
        // and report the operator's own Stop as a failed regeneration. The
        // stopping surface has already written the row; this only defends it.
        if (!allSectionsComplete) {
          try {
            await invokeSecureFunction('manage-investment-reports', {
              action: 'update',
              reportId,
              data: { status: 'failed', error_message: abortReasonRef.current },
            });
          } catch (e: any) {
            console.warn('[ChunkedRegeneration] Could not re-assert the stop:', e?.message);
          }
        }
        settleProgressToast(
          toastId,
          'info',
          'Generation stopped',
          `${effectivePropertyAddress || 'The report'} kept ${sectionsDone} of ${totalSections} sections and can be resumed.`,
        );
        setState(prev => ({ ...prev, isRegenerating: false, currentSection: sectionsDone, phase: 'idle' }));
        return;
      }

      // ── Phase 2: Condense + page-pressure trim ────────────────────────────
      setState(prev => ({ ...prev, phase: 'condense', currentSection: totalSections }));
      onProgress?.(totalSections, totalSections, 'condense');
      showProgressToast(toastId, 'Condensing report (word caps + page pressure)…');
      /* Condense and QA are part of the run, so the claim has to survive them:
         without this the lease could lapse mid-finalisation and the widget
         would start a second pump over the top of it. */
      heartbeatGenerationDriver(reportId, driver);

      /* Soft: the generator's finalisation has already written the document
         and its status, so a skipped condense leaves a complete report. But
         `invokeSecureFunction` RETURNS its failures rather than throwing
         them, so the catch that stood here was never reached, and a blip —
         the preflight 503 that 60 Lawley Street's run met on 24 Sep — was
         never tried again. A transient failure is repeated; a timeout is not,
         because a condense that ran for 180s is not a blip. */
      for (let attempt = 0; attempt <= TRANSIENT_RETRY_DELAYS_MS.length; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, TRANSIENT_RETRY_DELAYS_MS[attempt - 1]));
        const { error: condenseError } = await invokeSecureFunction(
          'condense-investment-report',
          { reportId, tier },
          { timeoutMs: 180000 },
        );
        if (!condenseError) break;
        const repeatable = isRepeatableFailure(condenseError);
        console.warn(
          `[ChunkedRegeneration] Condense step ${repeatable && attempt < TRANSIENT_RETRY_DELAYS_MS.length ? 'failed, retrying' : 'soft-failed'}:`,
          condenseError.message,
        );
        if (!repeatable) break;
      }

      // ── Phase 3: QA validation (server returns qaReport inside condense response;
      //              we surface the phase for UX even though the work happens
      //              inside the same edge call). ───────────────────────────────
      setState(prev => ({ ...prev, phase: 'qa' }));
      onProgress?.(totalSections, totalSections, 'qa');
      showProgressToast(toastId, 'Running QA checks…');

      // Final status check
      /* A read that FAILED is not a row that is absent.
       *
       * This destructured `{ data }` and dropped the error, so a failed read
       * compared `Number(undefined) >= 16` — `NaN`, false — and threw "the
       * record holds 0 of 16 sections" about a record it had never seen.
       * `readRunRow` repeats a transient failure and says which of three
       * things happened; `settleRunOutcome` lets the generator's own
       * `isComplete` stand where the row cannot be read. */
      const finalRead = await readProgressRow(reportId);

      /* Completion is the SERVER'S arithmetic, never this client's.
       *
       * `totalSections` above is resolved once at kickoff and falls back to the
       * registry when the row has not stated a total yet — which is every
       * regeneration, because the row is reused and the generator only stamps
       * `total_sections` on its first progressive save. So a client holding a
       * stale or merely different section count would declare a complete run
       * incomplete, throw, and stamp the row `failed`.
       *
       * That is not hypothetical: on 20 Sep 2026 the fallback said 15 (the raw
       * `COMPASS_40_SECTIONS` length) where the generator wrote 14 (the list
       * filtered on `includeInCompass`), and the 97 Poole Road regeneration
       * finished all fourteen sections, reached 100% in the progress widget,
       * and was recorded as a failure. `sectionCountForTier` is corrected at
       * the source; this is the guard that stops the NEXT section-list change
       * doing the same thing.
       *
       * The row's own `total_sections` wins wherever it is stated — the same
       * ordering `progress/selectors.pure.ts` already applies for display.
       * `settleRunOutcome` is where that ordering now lives. */
      const outcome = settleRunOutcome(finalRead, { serverReportedComplete, fallbackTotal: totalSections });

      if (outcome.kind === 'complete') {
        if (outcome.confirmed) {
          settleProgressToast(
            toastId,
            'success',
            'Report regenerated successfully',
            `Version ${outcome.currentVersion || 'new'} created`,
          );
        } else {
          // The generator said the document is complete; the read after it
          // could not be made. The report is done — say so, and say what is
          // not yet confirmed, rather than calling a finished run a failure.
          console.warn(
            '[ChunkedRegeneration] The run completed; its status could not be re-read afterwards:',
            finalRead.kind === 'unreadable' ? finalRead.error.message : finalRead.kind,
          );
          settleProgressToast(
            toastId,
            'success',
            'Report regenerated',
            'Every section was written. Its status could not be re-read just now and will refresh on its own.',
          );
        }

        setState(prev => ({
          ...prev,
          isRegenerating: false,
          currentSection: outcome.required,
          totalSections: outcome.required,
          phase: 'done',
        }));
        onComplete?.();
      } else if (outcome.kind === 'incomplete') {
        throw new Error(
          `Report regeneration incomplete — the record holds ${outcome.done} of ${outcome.required} sections.`,
        );
      } else {
        statusUnknown = outcome.reason === 'unreadable';
        throw new Error(
          outcome.reason === 'unreadable'
            ? `The report's status could not be read after the run (${outcome.error?.message || 'no answer'}), so whether it finished is not known.`
            : 'The report could not be found after the run.',
        );
      }

    } catch (error: any) {
      console.error('[ChunkedRegeneration] Error:', error);
      const errorMessage = error.message || 'Regeneration failed';

      setState(prev => ({ ...prev, isRegenerating: false, phase: 'idle', error: errorMessage }));

      settleProgressToast(
        toastId,
        'error',
        statusUnknown ? 'Regeneration status unknown' : 'Regeneration failed',
        errorMessage,
      );

      /* The stamp describes the ROW, never this caller's own run.
       *
       * This write used to be unconditional, and it is how a finished document
       * was presented as a failure twice in two days — the second time because
       * a second pump had already carried the same report to 14 of 14 while
       * this one was throwing. Ask the server what the row holds first, and
       * record the failure only where there is one. An unreadable row still
       * records it — a run that threw with its state unknown must not be left
       * looking healthy — unless the server already said the document is
       * complete, or this run never wrote to the row at all (24 Sep 2026,
       * 60 Lawley Street: a complete document stamped failed over a 3s 503).
       * `manage-investment-reports` enforces the same rule on its side. */
      const failedRead: RowReadResult<ReportRunRow> = wroteNothing
        ? { kind: 'unreadable', error: { message: 'Nothing was written; the row was not read.' } }
        : await readProgressRow(reportId);

      const recordFailure = failedRead.kind === 'absent'
        ? false
        : shouldMarkRunFailed(failedRead.kind === 'row' ? failedRead.row : null, {
            serverReportedComplete,
            wroteNothing,
          });

      if (recordFailure) {
        const { error: stampError } = await invokeSecureFunction('manage-investment-reports', {
          action: 'update',
          reportId,
          data: { status: 'failed' }
        });
        if (stampError) {
          console.warn('[ChunkedRegeneration] The failure was not recorded:', stampError.message);
        }
      } else {
        console.log(
          '[ChunkedRegeneration] Not recording a failure —',
          wroteNothing
            ? 'this run wrote nothing to the row.'
            : failedRead.kind === 'row'
              ? 'the record is complete.'
              : failedRead.kind === 'absent'
                ? 'the report no longer exists.'
                : 'the server already reported the document complete.',
        );
      }

      onError?.(errorMessage);
    } finally {
      // Stop answering cancellations for a run that is over — including on the
      // early return above, which `finally` still reaches.
      activeReportIdRef.current = null;
      // Hand the report back so the next driver — this tab's widget, another
      // tab, or the operator clicking Regenerate — can take it immediately
      // rather than waiting out the lease.
      releaseGenerationDriver(reportId, driver);
    }
  }, []);

  const abort = useCallback(() => {
    abortRef.current = true;
  }, []);

  return {
    ...state,
    regenerate,
    abort,
  };
}

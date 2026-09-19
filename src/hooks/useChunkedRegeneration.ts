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
} from '@/lib/reports/generationSignals.pure';
import { resolveGenerationEngine, type GenerationEngine } from '@/lib/reports/generationEngine.pure';

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

    try {
      // Fetch current report state — include `report_tier` so we know the section count.
      const { data: reportData, error: fetchError } = await invokeSecureFunction('get-investment-reports', {
        reportId,
        listOptions: {
          select: 'report_content, manual_overrides, financial_calculations, last_completed_section, status, current_version, property_address, report_scope, report_tier, generation_engine, total_sections'
        }
      });

      if (fetchError) {
        throw new Error(fetchError.message || 'Failed to fetch report');
      }

      const report = reportData?.report;
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

      // The row is now 'processing' server-side. Wake the floating progress
      // widget so the interactive surface — per-report progress, Stop, Pause,
      // auto-continue, ETA, history — is on screen for the whole run rather
      // than this hook's toast being the only feedback.
      window.dispatchEvent(new Event(REPORT_GENERATION_STARTED_EVENT));

      const effectivePropertyAddress = propertyAddress || report?.property_address || '';
      const startSection = shouldResumeGeneration || shouldResumePostProcessing ? existingCompletedSection : 0;

      // ── Phase 1: Generate sections ────────────────────────────────────────
      let allSectionsComplete = false;
      /* Sections banked by this run. A local, never `state.currentSection`:
         `regenerate` is dependency-free by design, so `state` here is the value
         captured on first render and would report 0 for ever. */
      let sectionsDone = startSection;
      for (let section = startSection; section < totalSections; section++) {
        if (abortRef.current) {
          console.log('[ChunkedRegeneration] Aborted by user');
          break;
        }

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

        for (let retry = 0; retry < MAX_RETRIES_PER_SECTION && !sectionSuccess; retry++) {
          if (retry > 0) {
            await new Promise(resolve => setTimeout(resolve, 2000));
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

          if (data?.success) {
            sectionSuccess = true;
            if (data.isComplete) {
              console.log('[ChunkedRegeneration] All sections complete');
              allSectionsComplete = true;
              break;
            }
          } else {
            lastError = data?.error || 'Section generation failed';
          }
        }

        if (!sectionSuccess) {
          throw new Error(`Failed to generate section ${section + 1}: ${lastError}`);
        }

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

      try {
        await invokeSecureFunction('condense-investment-report', { reportId, tier }, { timeoutMs: 180000 });
      } catch (e: any) {
        console.warn('[ChunkedRegeneration] Condense step soft-failed:', e?.message);
      }

      // ── Phase 3: QA validation (server returns qaReport inside condense response;
      //              we surface the phase for UX even though the work happens
      //              inside the same edge call). ───────────────────────────────
      setState(prev => ({ ...prev, phase: 'qa' }));
      onProgress?.(totalSections, totalSections, 'qa');
      showProgressToast(toastId, 'Running QA checks…');

      // Final status check
      const { data: finalData } = await invokeSecureFunction('get-investment-reports', {
        reportId,
        listOptions: { select: 'status, current_version, last_completed_section' }
      });

      const finalReport = finalData?.report;

      if (finalReport?.last_completed_section >= totalSections) {
        settleProgressToast(
          toastId,
          'success',
          'Report regenerated successfully',
          `Version ${finalReport.current_version || 'new'} created`,
        );

        setState(prev => ({
          ...prev,
          isRegenerating: false,
          currentSection: totalSections,
          phase: 'done',
        }));
        onComplete?.();
      } else {
        throw new Error('Report regeneration incomplete');
      }

    } catch (error: any) {
      console.error('[ChunkedRegeneration] Error:', error);
      const errorMessage = error.message || 'Regeneration failed';

      setState(prev => ({ ...prev, isRegenerating: false, phase: 'idle', error: errorMessage }));

      settleProgressToast(toastId, 'error', 'Regeneration failed', errorMessage);

      await invokeSecureFunction('manage-investment-reports', {
        action: 'update',
        reportId,
        data: { status: 'failed' }
      });

      onError?.(errorMessage);
    } finally {
      // Stop answering cancellations for a run that is over — including on the
      // early return above, which `finally` still reaches.
      activeReportIdRef.current = null;
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

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { invokeSecureFunction, isAuthExhausted } from '@/lib/secureInvoke';
import { nextPollDelayMs } from '@/lib/reports/progressPollCadence.pure';
import {
  REPORT_GENERATION_CANCELLED_EVENT,
  REPORT_GENERATION_STARTED_EVENT,
  type ReportGenerationCancelledDetail,
} from '@/lib/reports/generationSignals.pure';
import { useAuth } from '@/hooks/useAuth';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useIsMobile } from '@/hooks/use-mobile';
import { useGenerationHistory } from '@/hooks/useGenerationHistory';
import { UNFINISHED_REPORT_IS_FREE, describeTokenRelease } from '@/lib/billing/tokenHold.pure';
import {
  GenerationProgressHeader,
  GenerationProgressItem,
  GenerationProgressPill,
  GenerationHistoryList,
  BulkJobGroup,
  type AggregateCounts,
  type AutoContinueSettings,
  type ReportProgress,
} from './progress/parts';
import {
  toReportProgress,
  isResumable,
  estimateRemainingMs,
  aggregateProgress,
  groupByBulkJob,
  COMPLETED_RETENTION_MS,
  type ProgressRow,
} from './progress/selectors.pure';

/* ---------- Settings persistence ---------- */

interface RetryState {
  [reportId: string]: {
    attempts: number;
    lastAttempt: number;
    scheduledRetry?: NodeJS.Timeout;
    /** Wall-clock instant the pending retry will fire, so the row can count down
     *  instead of showing the configured delay as a frozen string. */
    retryAt?: number;
  };
}

type Corner = 'br' | 'bl' | 'tr' | 'tl';
const POSITION_KEY = 'report-progress-position-v1';
const COLLAPSED_KEY = 'report-progress-collapsed-v1';
/** How far back to look for in-flight work. Applied server-side, on
 *  `updated_at` — activity, never creation. Regenerating a report only moves
 *  `updated_at` (the table trigger stamps every update, the generator stamps
 *  every section), so a `created_at` window made every regeneration of a
 *  report older than a day invisible here: the widget rendered null and the
 *  only thing in the corner was the hook's passive toast. */
const ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000;
const DRAWER_SNAP_POINTS: (string | number)[] = [0.45, 0.92];

function getAutoContinueSettings(): AutoContinueSettings {
  try {
    const saved = readStorage('dashboard-settings');
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        enabled: parsed.autoContinueReports ?? true,
        maxRetries: parsed.autoContinueMaxRetries ?? 3,
        delaySeconds: parsed.autoContinueDelaySeconds ?? 15,
      };
    }
  } catch (e) {
    console.error('Failed to parse auto-continue settings:', e);
  }
  return { enabled: true, maxRetries: 3, delaySeconds: 15 };
}

function saveAutoContinueSettings(next: AutoContinueSettings) {
  try {
    const saved = readStorage('dashboard-settings');
    const parsed = saved ? JSON.parse(saved) : {};
    parsed.autoContinueReports = next.enabled;
    parsed.autoContinueMaxRetries = next.maxRetries;
    parsed.autoContinueDelaySeconds = next.delaySeconds;
    writeStorage('dashboard-settings', JSON.stringify(parsed));
  } catch (e) {
    console.error('Failed to save auto-continue settings:', e);
  }
}

/* Storage access is guarded everywhere: this component is mounted above
   <Routes> in App.tsx, so an unguarded localStorage throw (Safari private mode,
   storage disabled by policy, quota exceeded) during state initialisation would
   take down the entire application, not just the widget. */
function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — position/collapse simply won't persist */
  }
}

function getCorner(): Corner {
  const v = readStorage(POSITION_KEY) as Corner | null;
  return v && ['br', 'bl', 'tr', 'tl'].includes(v) ? v : 'br';
}
function getCollapsed(): boolean {
  return readStorage(COLLAPSED_KEY) === '1';
}

/* ---------- Public component ---------- */

export function ReportGenerationProgress() {
  const location = useLocation();
  const { user, loading } = useAuth();
  const isPortalRoute =
    location.pathname.startsWith('/client') ||
    location.pathname.startsWith('/portal') ||
    location.pathname.startsWith('/finance');

  if (isPortalRoute) return null;
  if (loading || !user) return null;

  return <ReportGenerationProgressInner />;
}

function ReportGenerationProgressInner() {
  const location = useLocation();
  const isGeneratedReportsRoute = location.pathname === '/generated-reports';
  const { user } = useAuth();
  const currentUserLabel = user?.username || 'unknown user';
  const [reports, setReports] = useState<ReportProgress[]>([]);
  const [isMinimized, setIsMinimized] = useState<boolean>(getCollapsed);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const [corner, setCorner] = useState<Corner>(getCorner);
  const [drawerSnap, setDrawerSnap] = useState<number | string | null>(0.45);
  const [autoContinueSettings, setAutoContinueSettings] =
    useState<AutoContinueSettings>(getAutoContinueSettings);

  const retryStateRef = useRef<RetryState>({});
  const autoRetryInProgressRef = useRef<Set<string>>(new Set());
  const isMobile = useIsMobile();
  const { entries: history, addEntry: addHistory, clear: clearHistory } = useGenerationHistory();

  /* `paused` is read inside long-running async loops and inside setTimeout
     callbacks, both of which capture it by closure. A generation pump can run
     for many minutes, so a captured `false` meant pausing did nothing to work
     already in flight. Mirror it into a ref and read that instead. */
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  /* Same treatment for settings. Previously every callback that read them took
     the whole object as a dependency, so dragging the retry-delay slider — which
     emits continuously — rebuilt the callback chain on each tick, tore down the
     polling interval and fired an immediate extra request each time. */
  const settingsRef = useRef(autoContinueSettings);
  useEffect(() => {
    settingsRef.current = autoContinueSettings;
  }, [autoContinueSettings]);

  /* Track section completion timestamps per report (for ETA + sparkline) */
  const sectionTimelineRef = useRef<Map<string, number[]>>(new Map());
  const lastSectionsRef = useRef<Map<string, number>>(new Map());
  const previousReportIdsRef = useRef<Set<string>>(new Set());
  const prevReportsRef = useRef<ReportProgress[]>([]);
  /* IDs cancelled by the user. Two jobs: skip finalizeJob so the 'cancelled'
     history entry survives, and — critically — stop auto-continue from
     resurrecting the report. Stopping a job leaves it `failed` with partial
     content, which is exactly the shape auto-continue looks for, so without
     this a stopped report restarted itself within `delaySeconds`. */
  const cancelledIdsRef = useRef<Set<string>>(new Set());
  /* Reports that finished while we were watching. Kept briefly so the user gets
     a visible "done" beat instead of the row just vanishing. */
  const completedAtRef = useRef<Map<string, number>>(new Map());
  const [completedRows, setCompletedRows] = useState<ReportProgress[]>([]);
  /* IDs the user dismissed locally — hide from the active list even while the
     server-side job continues. Persisted so a reload/re-poll doesn't resurrect them. */
  const DISMISSED_KEY = 'report-dismissed-ids';
  const dismissedIdsRef = useRef<Set<string>>(
    // Lazily initialised: `useRef(expr)` evaluates `expr` on every render, so the
    // previous inline IIFE re-read and re-parsed localStorage every 3s poll.
    (undefined as unknown as Set<string>),
  );
  if (dismissedIdsRef.current === undefined) {
    try {
      const raw = readStorage(DISMISSED_KEY);
      dismissedIdsRef.current = new Set<string>(raw ? JSON.parse(raw) : []);
    } catch {
      dismissedIdsRef.current = new Set<string>();
    }
  }
  const persistDismissed = () => {
    writeStorage(DISMISSED_KEY, JSON.stringify(Array.from(dismissedIdsRef.current)));
  };

  /* Persist collapsed + corner */
  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, isMinimized ? '1' : '0');
  }, [isMinimized]);
  useEffect(() => {
    if (!isGeneratedReportsRoute) {
      localStorage.setItem(POSITION_KEY, corner);
    }
  }, [corner, isGeneratedReportsRoute]);

  /* Sync auto-continue settings (cross-tab + periodic).
     IMPORTANT: only update state when values actually change, otherwise the
     new object identity invalidates downstream useCallbacks every 5s and the
     polling effect's cleanup cancels every scheduled auto-retry before its
     timer can fire. */
  useEffect(() => {
    const refresh = () => {
      const next = getAutoContinueSettings();
      setAutoContinueSettings((prev) =>
        prev.enabled === next.enabled &&
        prev.maxRetries === next.maxRetries &&
        prev.delaySeconds === next.delaySeconds
          ? prev
          : next
      );
    };
    const interval = setInterval(refresh, 5000);
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'dashboard-settings') refresh();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      clearInterval(interval);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  /* Load retry state on mount */
  useEffect(() => {
    try {
      const saved = localStorage.getItem('report-retry-state');
      if (saved) {
        const parsed = JSON.parse(saved);
        Object.keys(parsed).forEach((id) => {
          retryStateRef.current[id] = {
            attempts: parsed[id].attempts || 0,
            lastAttempt: parsed[id].lastAttempt || 0,
          };
        });
      }
    } catch (e) {
      console.error('Failed to load retry state:', e);
    }
  }, []);

  const saveRetryState = useCallback(() => {
    try {
      const toSave: Record<string, { attempts: number; lastAttempt: number }> = {};
      Object.entries(retryStateRef.current).forEach(([id, state]) => {
        toSave[id] = { attempts: state.attempts, lastAttempt: state.lastAttempt };
      });
      localStorage.setItem('report-retry-state', JSON.stringify(toSave));
    } catch (e) {
      console.error('Failed to save retry state:', e);
    }
  }, []);

  const handleContinueGeneration = useCallback(
    async (reportId: string, isAutoRetry = false) => {
      try {
        if (isAutoRetry && autoRetryInProgressRef.current.has(reportId)) return;
        if (isAutoRetry) autoRetryInProgressRef.current.add(reportId);

        setReports((prev) =>
          prev.map((r) =>
            r.id === reportId
              ? { ...r, status: 'processing', error_message: null, lastUpdated: new Date() }
              : r
          )
        );

        await invokeSecureFunction('manage-investment-reports', {
          action: 'update',
          reportId,
          data: {
            status: 'processing',
            error_message: null,
            updated_at: new Date().toISOString(),
          },
        });

        // Drive sections in a continuous loop instead of one-shot. The edge
        // function returns `{ success, isComplete }` after each single-section
        // call; we keep firing until complete, with bounded per-section
        // retries on transient errors. This is what makes auto-resume actually
        // converge instead of waiting 120s between each section.
        const MAX_SECTION_CALLS = 60; // hard upper bound
        const MAX_TRANSIENT_RETRIES = 4;
        const MAX_SECTION_FAILURES = 3;
        let consecutiveTransientErrors = 0;
        let consecutiveSectionFailures = 0;
        let done = false;

        for (let call = 0; call < MAX_SECTION_CALLS && !done; call++) {
          // Read the live value, not the one captured when this callback was
          // created: this loop can run for many minutes across up to 60 calls,
          // and a captured `paused` meant Pause never stopped work in flight.
          // `cancelled` covers the user pressing Stop mid-pump.
          if (pausedRef.current || cancelledIdsRef.current.has(reportId)) break;
          const { data, error } = await invokeSecureFunction(
            'generate-investment-report',
            { reportId, continueFrom: true, singleSection: true },
            { timeoutMs: 180000 }
          );

          if (error) {
            const msg = String(error.message || '');
            const isTransient =
              msg.includes('5') && (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('504'))
              || msg.includes('Failed to fetch')
              || msg.includes('NetworkError')
              || msg.includes('timeout')
              || msg.includes('aborted');
            if (isTransient && consecutiveTransientErrors < MAX_TRANSIENT_RETRIES) {
              consecutiveTransientErrors++;
              const backoff = Math.min(15000, 1500 * 2 ** (consecutiveTransientErrors - 1));
              console.warn(
                `[ReportGenerationProgress] Transient section error (#${consecutiveTransientErrors}), retrying in ${backoff}ms`,
                msg
              );
              await new Promise((r) => setTimeout(r, backoff));
              continue;
            }
            console.error('Error invoking generation:', error);
            setReports((prev) =>
              prev.map((r) =>
                r.id === reportId
                  ? { ...r, status: 'pending', error_message: msg || 'Failed to resume generation' }
                  : r
              )
            );
            break;
          }

          consecutiveTransientErrors = 0;

          if (data?.isComplete === true) {
            done = true;
            break;
          }

          // `success: false` means this section failed, NOT that the report is
          // finished. Treating it as done silently abandoned the report with
          // partial content and no terminal status. Retry the section a bounded
          // number of times, then stop and leave it for the server-side
          // watchdog rather than pretending it completed.
          if (data?.success === false) {
            if (consecutiveSectionFailures < MAX_SECTION_FAILURES) {
              consecutiveSectionFailures++;
              const backoff = Math.min(15000, 2000 * 2 ** (consecutiveSectionFailures - 1));
              console.warn(
                `[ReportGenerationProgress] Section failed (#${consecutiveSectionFailures}), retrying in ${backoff}ms`,
                data?.error
              );
              await new Promise((r) => setTimeout(r, backoff));
              continue;
            }
            setReports((prev) =>
              prev.map((r) =>
                r.id === reportId
                  ? { ...r, error_message: String(data?.error || 'Section generation failed') }
                  : r
              )
            );
            break;
          }

          // A budgeted hand-off (`resumeRequired`) is normal progress, not an
          // error: the edge function stopped short of its wall-clock ceiling
          // and expects to be called again. Keep pumping.
          consecutiveSectionFailures = 0;
          // small jitter to avoid hammering
          await new Promise((r) => setTimeout(r, 250 + Math.random() * 250));
        }
      } catch (error) {
        console.error('Error continuing generation:', error);
      } finally {
        if (isAutoRetry) autoRetryInProgressRef.current.delete(reportId);
      }
    },
    // Deliberately dependency-free: `paused` and `cancelled` are read through
    // refs above. A stable identity keeps the polling effect (which depends on
    // this transitively) from tearing down and re-running — and cancelling its
    // scheduled retries — every time a setting changes.
    []
  );

  const scheduleAutoRetry = useCallback(
    (report: ReportProgress) => {
      const { id } = report;
      const settings = settingsRef.current;
      if (!settings.enabled || pausedRef.current) return;
      // Stopping a job leaves it `failed` with partial content — precisely the
      // shape auto-continue hunts for. Without this guard, Stop was silently
      // undone within `delaySeconds` while the confirmation dialog had just
      // told the user it could not be undone.
      if (cancelledIdsRef.current.has(id)) return;
      if (!retryStateRef.current[id]) {
        retryStateRef.current[id] = { attempts: 0, lastAttempt: 0 };
      }
      const state = retryStateRef.current[id];
      if (state.attempts >= settings.maxRetries) return;
      if (state.scheduledRetry) return;

      const timeSinceLastAttempt = Date.now() - state.lastAttempt;
      const delayMs = settings.delaySeconds * 1000;

      const scheduleIn = timeSinceLastAttempt < delayMs ? delayMs - timeSinceLastAttempt : delayMs;
      state.retryAt = Date.now() + scheduleIn;
      state.scheduledRetry = setTimeout(() => {
        delete state.scheduledRetry;
        delete state.retryAt;
        // Re-check at fire time: the user may have paused or stopped during the
        // wait, and the timer captured neither.
        if (pausedRef.current || cancelledIdsRef.current.has(id)) return;
        state.attempts++;
        state.lastAttempt = Date.now();
        saveRetryState();
        handleContinueGeneration(id, true);
      }, scheduleIn);
    },
    [handleContinueGeneration, saveRetryState]
  );

  const cancelScheduledRetry = useCallback((reportId: string) => {
    const state = retryStateRef.current[reportId];
    if (state?.scheduledRetry) {
      clearTimeout(state.scheduledRetry);
      delete state.scheduledRetry;
    }
  }, []);

  const cleanupRetryState = useCallback(
    (activeReportIds: Set<string>) => {
      Object.keys(retryStateRef.current).forEach((id) => {
        if (!activeReportIds.has(id)) {
          cancelScheduledRetry(id);
          delete retryStateRef.current[id];
        }
      });
      saveRetryState();
    },
    [cancelScheduledRetry, saveRetryState]
  );

  /* Polling state */
  const authFailCountRef = useRef(0);
  const AUTH_FAIL_THRESHOLD = 3;
  const inFlightRef = useRef(false);
  /* A ticking clock in state. Elapsed-time and stalled readouts are derived from
     "now", and deriving them with a bare Date.now() during render made renders
     impure and froze every countdown whenever polling stopped. */
  const [nowTick, setNowTick] = useState(() => Date.now());
  const transientFailCountRef = useRef(0);
  const transientBackoffUntilRef = useRef(0);
  const visibleRef = useRef(typeof document !== 'undefined' ? !document.hidden : true);
  /* Adaptive cadence (see progressPollCadence.pure.ts): the 3s interval below
     is only the scheduler's tick; whether a tick actually asks the server is
     decided here. Two idle dashboards asked 13,679 times in a day, every
     answer empty, at ~1.2s of database time each. */
  const emptyPollsRef = useRef(0);
  const nextDueAtRef = useRef(0);

  useEffect(() => {
    const onVis = () => {
      visibleRef.current = !document.hidden;
      if (!document.hidden) {
        // The person just looked: answer now, whatever the idle backoff says.
        emptyPollsRef.current = 0;
        nextDueAtRef.current = 0;
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const fetchActiveReports = useCallback(async () => {
    if (pausedRef.current) return;
    if (!visibleRef.current) return;
    if (Date.now() < nextDueAtRef.current) return;
    // NOTE: deliberately NOT gated on hasActiveSession(). The staff session lives
    // in an HttpOnly cookie that JS cannot read; the tab-scoped access token it
    // checks is absent in any tab that did not perform the login itself (a new
    // tab, a restored session, or after an auth-version bump cleared it). Gating
    // here is what made this widget stop appearing entirely — the poll returned
    // on its first line forever, so `reports` stayed empty and the component
    // rendered null, silently. The same bug was already fixed once in
    // useTokenBalance.ts; only the global circuit breaker means "signed out".
    if (isAuthExhausted()) return;
    if (authFailCountRef.current >= AUTH_FAIL_THRESHOLD) return;
    if (Date.now() < transientBackoffUntilRef.current) return;
    // One request in flight at a time. The 3s interval used to fire regardless,
    // so a slow response could resolve after a fast one and overwrite it with
    // older data — flickering the list backwards and making the disappeared-row
    // diff fire finalizeJob twice, which produced duplicate "Report ready" toasts.
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    let response;
    try {
      response = await invokeSecureFunction('get-investment-reports', {
        listMode: true,
        // The library projection omits updated_at and the section counters, and
        // caller-supplied `select` is deliberately ignored by the edge function —
        // which is why every row used to arrive with an Invalid Date and 0%.
        projection: 'generationProgress',
        listOptions: {
          // `status` sits at the top level of listOptions; nesting it under
          // `filters` (as this did) meant no status filter was applied at all.
          status: ['pending', 'processing', 'failed'],
          // Activity window, not creation window — see ACTIVE_WINDOW_MS.
          updatedAfter: new Date(Date.now() - ACTIVE_WINDOW_MS).toISOString(),
          pageSize: 20,
        },
      });
    } finally {
      inFlightRef.current = false;
    }
    const { data, error } = response;

    if (error) {
      const isAuthError =
        error.message === 'Authentication required' || error.message?.includes('401');
      if (isAuthError) {
        authFailCountRef.current += 1;
        if (authFailCountRef.current >= AUTH_FAIL_THRESHOLD) {
          console.warn(
            '[ReportGenerationProgress] Stopped polling after repeated auth failures.'
          );
        }
        return;
      }
      const msg = String(error.message || '');
      const isTransient =
        msg.includes('503') ||
        msg.includes('502') ||
        msg.includes('504') ||
        msg.includes('500') ||
        msg.includes('Failed to fetch') ||
        msg.includes('NetworkError') ||
        msg.includes('temporarily unavailable');
      if (isTransient) {
        transientFailCountRef.current += 1;
        const backoffSeconds = Math.min(60, 5 * Math.pow(2, transientFailCountRef.current - 1));
        transientBackoffUntilRef.current = Date.now() + backoffSeconds * 1000;
        console.warn(
          `[ReportGenerationProgress] Transient error (attempt ${transientFailCountRef.current}). Backing off ${backoffSeconds}s.`,
          msg
        );
        return;
      }
      console.error('Error fetching active reports:', error);
      return;
    }

    authFailCountRef.current = 0;
    transientFailCountRef.current = 0;
    transientBackoffUntilRef.current = 0;

    const records: ProgressRow[] = data?.reports || [];
    const now = Date.now();

    // Pace the next ask by what this one found. Failure paths return above and
    // are paced by their own backoff refs; this paces success.
    emptyPollsRef.current = records.length > 0 ? 0 : emptyPollsRef.current + 1;
    nextDueAtRef.current = now + nextPollDelayMs(emptyPollsRef.current);

    // The 24h activity window is applied server-side (`updatedAfter`), so this
    // only has to drop what the user hid locally.
    const visibleRecords = records.filter((report) => !dismissedIdsRef.current.has(report.id));

    // Prune dismissed IDs the server no longer reports, so the set can't grow
    // unbounded. Only prune once the response is a complete view of the window —
    // pruning against a truncated page used to forget a dismissal whenever newer
    // jobs pushed that report off the end, resurrecting a row the user had hidden.
    if (dismissedIdsRef.current.size > 0 && records.length < 20) {
      const serverIds = new Set<string>(records.map((r) => r.id));
      let mutated = false;
      dismissedIdsRef.current.forEach((id) => {
        if (!serverIds.has(id)) {
          dismissedIdsRef.current.delete(id);
          mutated = true;
        }
      });
      if (mutated) persistDismissed();
    }

    const processedReports: ReportProgress[] = visibleRecords.map((report) =>
      toReportProgress(report, now),
    );

    /* Track section-completion timestamps for ETA + sparkline.
       Only record instants we actually observed a section land. Seeding one
       timestamp per already-complete section on the first poll (as this used to)
       wrote N identical values, which made the observed span zero and had a
       report at section 30 of 40 report "~0s left" indefinitely. */
    processedReports.forEach((r) => {
      const prevSections = lastSectionsRef.current.get(r.id);
      if (prevSections !== undefined && r.sectionsCompleted > prevSections) {
        const timeline = sectionTimelineRef.current.get(r.id) ?? [];
        // Replace rather than mutate: an in-place push keeps the array identity
        // stable, which would freeze any memoised consumer of the sparkline.
        sectionTimelineRef.current.set(r.id, [...timeline, now]);
      }
    });

    /* Detect completed/failed jobs that disappeared from the active list -> push to history + toast */
    const currentIds = new Set(processedReports.map((r) => r.id));
    const previous = prevReportsRef.current;
    const previousIds = previousReportIdsRef.current;
    if (previousIds.size > 0) {
      previous.forEach((prev) => {
        if (!currentIds.has(prev.id)) {
          // Disappeared from active list — fetch final status to know completed vs failed
          finalizeJob(prev);
        }
      });
    }
    previousReportIdsRef.current = currentIds;
    prevReportsRef.current = processedReports;

    setReports(processedReports);
    cleanupRetryState(currentIds);

    processedReports.forEach((report) => {
      // Reset retry attempts whenever progress moves forward — we only want
      // the maxRetries cap to bite when a report is genuinely stuck, not
      // when a long generation is steadily completing sections.
      const prevSections = lastSectionsRef.current.get(report.id) ?? -1;
      if (prevSections >= 0 && report.sectionsCompleted > prevSections) {
        const rs = retryStateRef.current[report.id];
        if (rs && rs.attempts > 0) {
          rs.attempts = 0;
          saveRetryState();
        }
      }

      // One shared definition of "needs a nudge", from the same pure helper the
      // header counts and the row badge use — so the header can no longer read
      // "1 Stalled" while the row reads "Processing", and a report can no longer
      // be auto-retried while "Retry all stalled" is still disabled.
      if (isResumable(report, now) && settingsRef.current.enabled && !pausedRef.current) {
        scheduleAutoRetry(report);
      }

      lastSectionsRef.current.set(report.id, report.sectionsCompleted);
    });
  }, [cleanupRetryState, saveRetryState, scheduleAutoRetry]);

  const finalizeJob = useCallback(
    async (prev: ReportProgress) => {
      try {
        if (cancelledIdsRef.current.has(prev.id)) {
          // User-cancelled jobs are already logged in history as 'cancelled'.
          cancelledIdsRef.current.delete(prev.id);
          return;
        }
        const { data } = await invokeSecureFunction('get-investment-reports', {
          reportId: prev.id,
          // Without an explicit projection a single-report fetch defaults to
          // `detail`, which carries the entire ~95KB report body — a lot of
          // bandwidth just to read a status field.
          projection: 'generationProgress',
        });
        const final = data?.report;
        if (!final) return;
        if (final.status === 'completed') {
          // Pin the finished row briefly so success is something the user sees
          // in place, rather than the row silently vanishing from the list.
          completedAtRef.current.set(prev.id, Date.now());
          setCompletedRows((rows) => [
            ...rows.filter((r) => r.id !== prev.id),
            { ...prev, status: 'completed', sectionsCompleted: prev.totalSections },
          ]);
          toast.success(`Report ready: ${final.property_address}`, {
            action: {
              label: 'Open',
              onClick: () => {
                window.location.href = `/investment-report/${final.id}`;
              },
            },
          });
          addHistory({
            id: final.id,
            property_address: final.property_address,
            status: 'completed',
            totalSections: prev.totalSections,
            sectionsCompleted: prev.totalSections,
            durationMs: Date.now() - prev.createdAt.getTime(),
            finishedAt: Date.now(),
          });
        } else if (final.status === 'failed') {
          // The release itself is reported by whoever marked the report
          // failed; this path only observed it, so it states the RULE rather
          // than a figure it cannot confirm. See `tokenHold.pure.ts`.
          toast.error(`Report failed: ${final.property_address}`, {
            description: UNFINISHED_REPORT_IS_FREE,
          });
          addHistory({
            id: final.id,
            property_address: final.property_address,
            status: 'failed',
            totalSections: prev.totalSections,
            sectionsCompleted: prev.sectionsCompleted,
            durationMs: Date.now() - prev.createdAt.getTime(),
            error_message: final.error_message,
            finishedAt: Date.now(),
          });
        }
      } catch (e) {
        console.error('Failed to finalize job:', e);
      } finally {
        sectionTimelineRef.current.delete(prev.id);
        lastSectionsRef.current.delete(prev.id);
      }
    },
    [addHistory]
  );

  useEffect(() => {
    fetchActiveReports();
    const interval = setInterval(fetchActiveReports, 3000);
    return () => {
      clearInterval(interval);
      // NOTE: do NOT cancel scheduled retries here. This effect re-runs
      // whenever fetchActiveReports identity changes, and cancelling pending
      // timers on every re-run would prevent auto-retry from ever firing.
      // (`fetchActiveReports` is now stable, so this is belt and braces.)
    };
  }, [fetchActiveReports]);

  /* A generation started in THIS tab is announced (the regeneration hook
     dispatches it once the row is in flight server-side), so the widget appears
     at once instead of up to 30s later on the idle backoff. Same principle as
     the visibility reset above: the person just acted, answer now. This
     component stays mounted while rendering null, so the listener is live even
     when nothing is on screen. */
  useEffect(() => {
    const onStarted = () => {
      emptyPollsRef.current = 0;
      nextDueAtRef.current = 0;
      fetchActiveReports();
    };
    window.addEventListener(REPORT_GENERATION_STARTED_EVENT, onStarted);
    return () => window.removeEventListener(REPORT_GENERATION_STARTED_EVENT, onStarted);
  }, [fetchActiveReports]);

  /* Retire completed rows once their success moment has passed. A 1s tick is
     enough for a 30s window and keeps the elapsed-time readouts moving even
     while polling is paused — the row used to freeze because nothing re-rendered. */
  useEffect(() => {
    const tick = setInterval(() => {
      const now = Date.now();
      let expired = false;
      completedAtRef.current.forEach((at, id) => {
        if (now - at > COMPLETED_RETENTION_MS) {
          completedAtRef.current.delete(id);
          expired = true;
        }
      });
      if (expired) {
        setCompletedRows((rows) => rows.filter((r) => completedAtRef.current.has(r.id)));
      }
      setNowTick(now);
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  /* True unmount cleanup: cancel any pending auto-retry timers exactly once. */
  useEffect(() => {
    return () => {
      Object.keys(retryStateRef.current).forEach((id) => {
        const s = retryStateRef.current[id];
        if (s?.scheduledRetry) {
          clearTimeout(s.scheduledRetry);
          delete s.scheduledRetry;
        }
      });
    };
  }, []);

  /* Collapse on Escape, but only while focus is inside the widget.
     This replaces a global ⌘/Ctrl+Shift+R listener that swallowed the browser's
     hard-reload shortcut on every page whenever a report happened to be running
     — including while the user was typing in the history search box, since it
     never checked the event target. Escape is the conventional "dismiss this
     surface" key and cannot collide with anything outside the widget. */
  const cardRef = useRef<HTMLDivElement | null>(null);
  const pillRef = useRef<HTMLButtonElement | null>(null);
  const onCardKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape' || isMinimized) return;
    e.stopPropagation();
    setIsMinimized(true);
    // Return focus to the control that replaces this one, rather than dropping
    // it on <body>.
    requestAnimationFrame(() => pillRef.current?.focus());
  };

  const handleManualContinue = (reportId: string) => {
    if (retryStateRef.current[reportId]) {
      retryStateRef.current[reportId].attempts = 0;
      saveRetryState();
    }
    cancelScheduledRetry(reportId);
    handleContinueGeneration(reportId, false);
  };

  const dismissReport = (reportId: string) => {
    const r = reports.find((x) => x.id === reportId);
    if (r) {
      addHistory({
        id: r.id,
        property_address: r.property_address,
        status: 'dismissed',
        totalSections: r.totalSections,
        sectionsCompleted: r.sectionsCompleted,
        durationMs: Date.now() - r.createdAt.getTime(),
        error_message: r.error_message,
        finishedAt: Date.now(),
      });
    }
    cancelScheduledRetry(reportId);
    dismissedIdsRef.current.add(reportId);
    persistDismissed();
    // Prevent the next poll from re-adding this row via prevReportsRef diffing
    // and stop finalizeJob from firing a completed/failed toast for a row the
    // user explicitly hid.
    previousReportIdsRef.current.delete(reportId);
    prevReportsRef.current = prevReportsRef.current.filter((x) => x.id !== reportId);
    setReports((prev) => prev.filter((x) => x.id !== reportId));
  };

  const killReport = useCallback(
    async (reportId: string, opts: { silent?: boolean } = {}) => {
      const r = reports.find((x) => x.id === reportId);
      const reason = `Cancelled by ${currentUserLabel}`;
      cancelScheduledRetry(reportId);
      cancelledIdsRef.current.add(reportId);
      // Stop the OTHER driver too. A regeneration started on this page is
      // pumped by useChunkedRegeneration, whose loop never reads the row — so
      // marking it failed below stopped nothing and its next section wrote the
      // row straight back to 'processing'. Fired before the write so the pump
      // stops at the earliest section boundary rather than one call later, and
      // it carries the reason because the hook re-asserts the stop once its
      // in-flight section has landed (it is the only party that knows when).
      window.dispatchEvent(
        new CustomEvent<ReportGenerationCancelledDetail>(REPORT_GENERATION_CANCELLED_EVENT, {
          detail: { reportId, reason },
        }),
      );
      // Reflect the cancellation in the active list immediately so the user
      // sees the status flip before the next polling cycle removes the row.
      setReports((prev) =>
        prev.map((x) =>
          x.id === reportId
            ? {
                ...x,
                status: 'failed',
                error_message: reason,
                lastUpdated: new Date(),
              }
            : x,
        ),
      );
      try {
        const { data, error } = await invokeSecureFunction<{ tokenRelease?: unknown }>(
          'manage-investment-reports',
          {
            action: 'update',
            reportId,
            data: {
              status: 'failed',
              error_message: reason,
              updated_at: new Date().toISOString(),
            },
          },
        );
        if (error) {
          toast.error(`Failed to stop generation: ${error.message || 'Unknown error'}`);
          return;
        }
        // `manage-investment-reports` releases (or refunds) the Mission Control
        // job for a run it marks failed, and returns what it released — a
        // figure nothing in the frontend had ever read. A balance that goes
        // 200 → 180 → 200 around a failed report reads as a charge and a
        // correction unless somebody says otherwise, which is what the
        // 19 Sep 2026 clone audit reported.
        const releaseNotice = describeTokenRelease(data?.tokenRelease);
        if (!opts.silent) {
          toast.success(
            r ? `Stopped "${r.property_address}" — marked as failed` : 'Generation stopped',
            releaseNotice ? { description: releaseNotice } : undefined,
          );
        }
        if (r) {
          addHistory({
            id: r.id,
            property_address: r.property_address,
            status: 'cancelled',
            totalSections: r.totalSections,
            sectionsCompleted: r.sectionsCompleted,
            durationMs: Date.now() - r.createdAt.getTime(),
            error_message: reason,
            finishedAt: Date.now(),
            cancelledBy: currentUserLabel,
          });
        }
      } catch (e: any) {
        toast.error(`Failed to stop generation: ${e?.message || 'Unknown error'}`);
      }
    },
    [reports, cancelScheduledRetry, addHistory, currentUserLabel],
  );

  const killReports = useCallback(
    (ids: string[]) => {
      // One summary toast, not one per report — stopping a batch of eight used
      // to stack nine toasts.
      ids.forEach((id) => killReport(id, { silent: ids.length > 1 }));
      if (ids.length > 1) {
        toast.success(`Stopping ${ids.length} reports…`);
      }
    },
    [killReport],
  );

  /* What the widget actually lists: in-flight work plus any report that just
     finished, held for its success moment. */
  const displayReports = useMemo(() => {
    const activeIds = new Set(reports.map((r) => r.id));
    return [...reports, ...completedRows.filter((r) => !activeIds.has(r.id))];
  }, [reports, completedRows]);

  const handleResumeAllStalled = () => {
    displayReports.forEach((r) => {
      if (isResumable(r, nowTick)) handleManualContinue(r.id);
    });
  };

  /* Aggregate counts — derived by the same pure helper the rows use, so the
     header can never contradict what is listed beneath it. */
  const counts: AggregateCounts = useMemo(() => {
    const agg = aggregateProgress(displayReports, nowTick);
    return {
      queued: agg.queued,
      processing: agg.generating,
      stalled: agg.stalled,
      failed: agg.failed,
      completed: agg.completed,
      total: agg.total,
      completedSections: agg.completedSections,
      totalSections: agg.totalSections,
    };
  }, [displayReports, nowTick]);

  /* ETA per report. Returns null rather than a confident zero — see
     estimateRemainingMs for why that distinction matters. */
  const etaForReport = useCallback(
    (r: ReportProgress): number | null =>
      estimateRemainingMs(r, sectionTimelineRef.current.get(r.id) ?? [], nowTick),
    [nowTick],
  );

  const aggregateEta = useMemo(() => {
    const etas = displayReports.map(etaForReport).filter((v): v is number => v !== null);
    if (etas.length === 0) return null;
    // Reports generate in parallel, so wall time is the slowest one.
    return Math.max(...etas);
  }, [displayReports, etaForReport]);

  /* Group reports by bulk_job_id */
  const { groups: bulkGroups, loose: looseReports } = useMemo(
    () => groupByBulkJob(displayReports),
    [displayReports],
  );

  const renderItem = (report: ReportProgress, mobile: boolean) => (
    <GenerationProgressItem
      key={report.id}
      report={report}
      etaMs={etaForReport(report)}
      retryState={retryStateRef.current[report.id]}
      autoContinueSettings={autoContinueSettings}
      sectionTimeline={sectionTimelineRef.current.get(report.id) ?? []}
      now={nowTick}
      paused={paused}
      onContinue={() => handleManualContinue(report.id)}
      onDismiss={() => dismissReport(report.id)}
      onKill={() => killReport(report.id)}
      isMobile={mobile}
    />
  );

  const renderReportList = (mobile: boolean) => (
    <>
      {bulkGroups.map((g) => (
        <BulkJobGroup
          key={g.jobId}
          group={g}
          etaForReport={etaForReport}
          onRetryAllFailed={(ids) => ids.forEach((id) => handleManualContinue(id))}
          onKillAll={(ids) => killReports(ids)}
        >
          {g.reports.map((r) => renderItem(r, mobile))}
        </BulkJobGroup>
      ))}
      {looseReports.map((r) => renderItem(r, mobile))}
    </>
  );

  /* Drag-to-reposition (desktop).
     Only the corner is committed, and only on release. Re-evaluating on every
     pointermove made the card flicker between corners whenever the pointer
     crossed the viewport midline, and it snapped out from under the cursor
     mid-gesture. `pointercancel` is handled too: without it, releasing outside
     the window leaked the move/up listeners permanently. */
  const onDragStart = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // Ignore drags that begin on a control inside the header.
    if ((e.target as HTMLElement).closest('button,[role="menuitem"],a,input')) return;

    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;

    const onMove = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - startX) > 24 || Math.abs(ev.clientY - startY) > 24) moved = true;
    };
    const finish = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      if (!moved) return;
      const left = ev.clientX < window.innerWidth / 2;
      const top = ev.clientY < window.innerHeight / 2;
      setCorner(`${top ? 't' : 'b'}${left ? 'l' : 'r'}` as Corner);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  }, []);

  /* Keyboard equivalent for repositioning. Dragging was pointer-only, which
     fails WCAG 2.1.1 and 2.5.7 outright — there was no way to move the widget
     without a mouse, and it sits fixed over the page on every route. */
  const moveToCorner = useCallback((next: Corner) => setCorner(next), []);

  /* Announce only what changed. */
  const [liveMessage, setLiveMessage] = useState('');
  const lastAnnouncedRef = useRef('');
  useEffect(() => {
    const parts: string[] = [];
    if (counts.completed > 0) parts.push(`${counts.completed} finished`);
    if (counts.failed > 0) parts.push(`${counts.failed} failed`);
    if (counts.stalled > 0) parts.push(`${counts.stalled} stalled`);
    if (counts.processing > 0) parts.push(`${counts.processing} generating`);
    const next = parts.length ? `Reports: ${parts.join(', ')}.` : '';
    if (next !== lastAnnouncedRef.current) {
      lastAnnouncedRef.current = next;
      setLiveMessage(next);
    }
  }, [counts.completed, counts.failed, counts.stalled, counts.processing]);

  /* Visibility logic — hide entirely when nothing to show */
  const hasAnything = displayReports.length > 0 || historyOpen;
  if (!hasAnything) return null;

  const cornerClass = (() => {
    if (isGeneratedReportsRoute) {
      return isMobile ? 'bottom-44 right-4' : 'bottom-24 right-6';
    }

    switch (corner) {
      case 'bl':
        return isMobile ? 'bottom-44 left-4' : 'bottom-24 left-6';
      case 'tr':
        return isMobile ? 'top-20 right-4' : 'top-20 right-6';
      case 'tl':
        return isMobile ? 'top-20 left-4' : 'top-20 left-6';
      case 'br':
      default:
        return isMobile ? 'bottom-44 right-4' : 'bottom-24 right-6';
    }
  })();

  /* Live region for screen readers.
     Announces transitions rather than the current state, so a 3s poll does not
     re-announce the same sentence twenty times a minute. The region element
     itself is always mounted (see the render branches) — a live region that
     mounts together with its first message is typically not announced at all,
     which is why the old one silently dropped the opening "Generating…". */
  const liveText = liveMessage;

  /* Mobile uses a Vaul drawer when expanded */
  if (isMobile) {
    return (
      <TooltipProvider delayDuration={200}>
        <span aria-live="polite" className="sr-only">
          {liveText}
        </span>
        <div className={cn('fixed z-50 transition-all duration-300', cornerClass)}>
          <GenerationProgressPill
            counts={counts}
            etaMs={aggregateEta}
            onClick={() => setIsMinimized(false)}
          />
        </div>
        <Drawer
          open={!isMinimized}
          onOpenChange={(o) => setIsMinimized(!o)}
          snapPoints={DRAWER_SNAP_POINTS}
          activeSnapPoint={drawerSnap}
          setActiveSnapPoint={(s) => setDrawerSnap((s as number | string | null) ?? 0.45)}
          dismissible
        >
          <DrawerContent className="max-h-[92vh]">
            <DrawerHeader className="p-0">
              <DrawerTitle className="sr-only">Report generation progress</DrawerTitle>
              <GenerationProgressHeader
                counts={counts}
                paused={paused}
                autoContinueSettings={autoContinueSettings}
                onTogglePaused={() => setPaused((p) => !p)}
                onResumeAllStalled={handleResumeAllStalled}
                onClearCompleted={() => clearHistory()}
                onToggleHistory={() => setHistoryOpen((o) => !o)}
                historyOpen={historyOpen}
                onToggleAutoContinue={(enabled) => {
                  const next = { ...autoContinueSettings, enabled };
                  setAutoContinueSettings(next);
                  saveAutoContinueSettings(next);
                }}
                onChangeDelay={(s) => {
                  const next = { ...autoContinueSettings, delaySeconds: s };
                  setAutoContinueSettings(next);
                  saveAutoContinueSettings(next);
                }}
                onMinimize={() => setIsMinimized(true)}
              />
            </DrawerHeader>
            <ScrollArea
              className={cn(
                'transition-[max-height]',
                drawerSnap === 0.45 ? 'max-h-[35vh]' : 'max-h-[78vh]',
              )}
            >
              {historyOpen ? (
                <GenerationHistoryList entries={history} onClear={clearHistory} />
              ) : (
                renderReportList(true)
              )}
            </ScrollArea>
          </DrawerContent>
        </Drawer>
      </TooltipProvider>
    );
  }

  /* Desktop floating card */
  return (
    <TooltipProvider delayDuration={200}>
      <span aria-live="polite" className="sr-only">
        {liveText}
      </span>
      <div className={cn('fixed z-50 transition-all duration-300', cornerClass)}>
        {isMinimized ? (
          <GenerationProgressPill
            ref={pillRef}
            counts={counts}
            etaMs={aggregateEta}
            onClick={() => setIsMinimized(false)}
          />
        ) : (
          // `.glass-raised` is the system class for a portalled overlay sitting
          // over arbitrary content. This was `bg-card/95 shadow-2xl ring-1
          // backdrop-blur` — the exact hand-rolled frosted surface glass.css
          // names as the anti-pattern in its own header, with primary emphasis
          // stacked three ways on a passive status widget.
          <div
            ref={cardRef}
            role="region"
            aria-label="Report generation progress"
            onKeyDown={onCardKeyDown}
            className="glass-raised w-80 overflow-hidden rounded-xl"
          >
            <GenerationProgressHeader
              counts={counts}
              paused={paused}
              autoContinueSettings={autoContinueSettings}
              onTogglePaused={() => setPaused((p) => !p)}
              onResumeAllStalled={handleResumeAllStalled}
              onClearCompleted={() => clearHistory()}
              onToggleHistory={() => setHistoryOpen((o) => !o)}
              historyOpen={historyOpen}
              onToggleAutoContinue={(enabled) => {
                const next = { ...autoContinueSettings, enabled };
                setAutoContinueSettings(next);
                saveAutoContinueSettings(next);
              }}
              onChangeDelay={(s) => {
                const next = { ...autoContinueSettings, delaySeconds: s };
                setAutoContinueSettings(next);
                saveAutoContinueSettings(next);
              }}
              onMinimize={() => setIsMinimized(true)}
              onDragStart={isGeneratedReportsRoute ? undefined : onDragStart}
              draggable={!isGeneratedReportsRoute}
              onMoveCorner={isGeneratedReportsRoute ? undefined : moveToCorner}
            />
            <div className="max-h-64 overflow-y-auto">
              {historyOpen ? (
                <GenerationHistoryList entries={history} onClear={clearHistory} />
              ) : displayReports.length === 0 ? (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  No active generations.
                </div>
              ) : (
                renderReportList(false)
              )}
            </div>
            {paused && (
              <div className="border-t border-border bg-warning/10 px-3 py-1.5 text-xs text-warning dark:text-warning">
                Polling paused • new updates will not appear until you resume
              </div>
            )}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

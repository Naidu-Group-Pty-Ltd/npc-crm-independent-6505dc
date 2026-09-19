/**
 * Two idle dashboards asked the server 13,679 times in one day.
 *
 * Every answer was `returnedCount: 0`, every ask cost ~1.2s of database time
 * — about 4.5 database-hours a day spent saying "nothing is generating" —
 * and the only 5xx the projection returned all day were these polls hitting
 * resource limits. The cadence now adapts; this pins the shape it adapts in,
 * and that the widget actually goes through it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ACTIVE_POLL_MS,
  IDLE_POLL_MAX_MS,
  nextPollDelayMs,
} from '../progressPollCadence.pure';
import {
  cancellationReason,
  cancelledReportId,
  DEFAULT_CANCELLATION_REASON,
  REPORT_GENERATION_CANCELLED_EVENT,
  REPORT_GENERATION_STARTED_EVENT,
} from '../generationSignals.pure';

const WIDGET = readFileSync(
  resolve(__dirname, '../../../components/reports/ReportGenerationProgress.tsx'),
  'utf8',
);

const REGEN_HOOK = readFileSync(
  resolve(__dirname, '../../../hooks/useChunkedRegeneration.ts'),
  'utf8',
);

describe('the cadence', () => {
  it('stays live while something is generating', () => {
    expect(nextPollDelayMs(0)).toBe(ACTIVE_POLL_MS);
    // A section lands roughly every 25 seconds; 3s keeps the bar moving.
    expect(ACTIVE_POLL_MS).toBe(3_000);
  });

  it('confirms a just-emptied list quickly before backing off', () => {
    for (const empties of [1, 2, 3]) {
      expect(nextPollDelayMs(empties), `${empties} empties`).toBe(ACTIVE_POLL_MS);
    }
    expect(nextPollDelayMs(4)).toBeGreaterThan(ACTIVE_POLL_MS);
  });

  it('never backs off past the ceiling, however long the idle run', () => {
    for (const empties of [6, 60, 6_000, Number.MAX_SAFE_INTEGER]) {
      expect(nextPollDelayMs(empties)).toBe(IDLE_POLL_MAX_MS);
    }
  });

  it('keeps discovery inside half a minute, because polling is the only discovery', () => {
    // Nothing announces a generation started in another tab or by the bulk
    // runner — the widget finds out only by asking. A generation runs for
    // minutes, so 30s late is invisible; 5 minutes late is a broken widget.
    expect(IDLE_POLL_MAX_MS).toBeLessThanOrEqual(30_000);
  });

  it('is monotonic — an emptier history never polls faster', () => {
    let last = 0;
    for (let empties = 0; empties <= 10; empties += 1) {
      const delay = nextPollDelayMs(empties);
      expect(delay).toBeGreaterThanOrEqual(last);
      last = delay;
    }
  });

  it('treats a nonsensical count as active rather than silent', () => {
    expect(nextPollDelayMs(Number.NaN)).toBe(ACTIVE_POLL_MS);
    expect(nextPollDelayMs(-5)).toBe(ACTIVE_POLL_MS);
  });
});

describe('the widget goes through it', () => {
  it('gates every tick on the due time and paces by emptiness', () => {
    expect(WIDGET).toMatch(/nextPollDelayMs\(/);
    expect(WIDGET).toContain('nextDueAtRef');
    expect(WIDGET).toContain('Date.now() < nextDueAtRef.current');
  });

  it('answers immediately when the tab becomes visible again', () => {
    // The person just looked; a 30s-stale answer reads as a broken widget.
    expect(WIDGET).toMatch(/if \(!document\.hidden\) \{[\s\S]{0,300}?nextDueAtRef\.current = 0/);
  });

  it('leaves the failure backoffs to their own refs', () => {
    // Transient errors and the auth breaker gate on failure; the cadence
    // paces success. Collapsing them is how a 500 comes to poll faster.
    expect(WIDGET).toContain('transientBackoffUntilRef');
    expect(WIDGET).toContain('authFailCountRef');
  });

  it('windows in-flight work by activity, never by creation', () => {
    // A regeneration moves `updated_at` (the table trigger stamps every
    // update, the generator stamps every section) and never `created_at`, so
    // a createdAfter window hid every regeneration of a report older than the
    // window: the widget rendered null and the only thing in the corner was
    // the regeneration hook's passive toast — progress with nothing to act on.
    expect(WIDGET).toContain('updatedAfter:');
    expect(WIDGET).not.toContain('createdAfter');
  });
});

describe('the two drivers of one report can see each other', () => {
  it('a start in this tab is announced rather than waited for', () => {
    // Polling is still the only discovery for another tab and the bulk
    // runner, but a start in THIS tab need not wait out the idle backoff.
    expect(REGEN_HOOK).toMatch(/dispatchEvent\(new Event\(REPORT_GENERATION_STARTED_EVENT/);
    expect(WIDGET).toMatch(/addEventListener\(REPORT_GENERATION_STARTED_EVENT/);
  });

  it("Stop reaches the hook's pump, which is what makes it a control", () => {
    // The widget's Stop marked the row `failed` and nothing else. The hook's
    // section loop never reads the row, so it kept calling the generator and
    // the next section wrote the row straight back to `processing`: Stop moved
    // a badge for one poll.
    expect(WIDGET).toMatch(/dispatchEvent\(\s*new CustomEvent<ReportGenerationCancelledDetail>\(\s*REPORT_GENERATION_CANCELLED_EVENT/);
    expect(REGEN_HOOK).toMatch(/addEventListener\(REPORT_GENERATION_CANCELLED_EVENT/);
    expect(REGEN_HOOK).toContain('abortRef.current = true');
  });

  it('a Stop aborts only the run it names', () => {
    // Every report card carries a Regenerate button, so several hook instances
    // are mounted at once: a detail-less "cancel whatever you are doing" would
    // have one card's Stop abort another card's regeneration.
    expect(REGEN_HOOK).toContain('activeReportIdRef');
    expect(REGEN_HOOK).toMatch(/id !== activeReportIdRef\.current/);
    expect(cancelledReportId({ reportId: 'abc' })).toBe('abc');
    for (const bad of [null, undefined, {}, { reportId: '' }, { reportId: 7 }, 'abc']) {
      expect(cancelledReportId(bad), JSON.stringify(bad) ?? 'undefined').toBeNull();
    }
  });

  it('the stop is re-asserted last, and never over a run that finished', () => {
    // The section already in flight when Stop is pressed keeps running, and on
    // a budgeted hand-off it writes `status: 'processing'` as it returns —
    // landing after the stopping surface's write and undoing it. The hook is
    // the only party that knows when that call has resolved. The completion
    // guard matters just as much: the last section can land in the same beat
    // as the Stop, and marking a completed report failed destroys it.
    expect(REGEN_HOOK).toMatch(/if \(!allSectionsComplete\) \{[\s\S]{0,400}?status: 'failed'/);
    expect(REGEN_HOOK).toContain('error_message: abortReasonRef.current');
  });

  it('a stop always records a reason, so it never reads as a break', () => {
    expect(cancellationReason({ reason: 'Cancelled by ana' })).toBe('Cancelled by ana');
    expect(cancellationReason({ reason: '  Cancelled by ana  ' })).toBe('Cancelled by ana');
    for (const bad of [null, undefined, {}, { reason: '' }, { reason: '   ' }, { reason: 3 }]) {
      expect(cancellationReason(bad), JSON.stringify(bad) ?? 'undefined').toBe(
        DEFAULT_CANCELLATION_REASON,
      );
    }
    expect(DEFAULT_CANCELLATION_REASON.trim().length).toBeGreaterThan(0);
  });

  it('a stop is reported as a stop, never as a failure', () => {
    // Falling through left the final check finding an incomplete report, so it
    // threw 'Report regeneration incomplete' and told the operator their own
    // Stop had failed — then wrote `status: 'failed'` over the reason the
    // widget had already recorded.
    // The stop is settled through `settleProgressToast(toastId, 'info', …)`
    // since the dismissable notices landed; the rule is the same — an info
    // toast, never an error — so both spellings are accepted.
    const STOP_TOAST = /(?:toast\.info\(|settleProgressToast\(\s*toastId,\s*'info',\s*)'Generation stopped'/;
    expect(REGEN_HOOK).toMatch(STOP_TOAST);
    const stop = REGEN_HOOK.search(STOP_TOAST);
    const finalCheck = REGEN_HOOK.indexOf('// Final status check');
    expect(finalCheck).toBeGreaterThan(stop);
    // It must RETURN before that check rather than fall into it.
    expect(REGEN_HOOK.slice(stop, finalCheck)).toContain('return;');
  });

  it('both names are spelled in exactly one module', () => {
    // A literal at each end is how two ends drift.
    expect(REPORT_GENERATION_STARTED_EVENT).toBe('report-generation-started');
    expect(REPORT_GENERATION_CANCELLED_EVENT).toBe('report-generation-cancelled');
    for (const source of [REGEN_HOOK, WIDGET]) {
      expect(source).not.toContain("'report-generation-started'");
      expect(source).not.toContain("'report-generation-cancelled'");
    }
  });
});

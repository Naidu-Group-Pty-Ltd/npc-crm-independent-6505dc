/**
 * A read that failed is not a failed report — 60 Lawley Street, 24 Sep 2026.
 *
 * The regeneration finished: the generator banked 16 of 16 sections and wrote
 * the row `completed` at 05:31:01.6Z. Three seconds later the Supabase edge
 * runtime answered four requests with HTTP 503
 * `SUPABASE_EDGE_RUNTIME_SERVICE_DEGRADED` in 6–81 ms, and two of them were
 * this browser's: the condense preflight, and the final status read. The hook
 * dropped the read's error, compared `NaN >= 16`, threw "the record holds 0 of
 * 16 sections", could not read the row in its catch either, and stamped the
 * finished report failed — which `manage-investment-reports` then refunded as a
 * failed run (16 jobs, 316 tokens). The widget said `Failed · 16/16 · 100%`.
 *
 * These are written against the incident: the hook is driven for real, with
 * the transport scripted to answer exactly as production did.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  refuseFailureStamp,
  rowHoldsCompleteDocument,
} from '@/lib/reports/investment/failureStamp.pure';
import { shouldMarkRunFailed } from '@/lib/reports/generationSignals.pure';
import {
  isRepeatableFailure,
  isTransientReadError,
  readRunRow,
  settleRunOutcome,
  TRANSIENT_RETRY_DELAYS_MS,
} from '@/lib/reports/runRowRead.pure';

type Invoke = { data: unknown; error: Record<string, unknown> | null };
type Script = Record<string, (body: Record<string, any>, nth: number) => Invoke>;

const calls: Array<{ fn: string; body: Record<string, any> }> = [];
let script: Script = {};
const settle = vi.fn();

vi.mock('@/lib/secureInvoke', () => ({
  invokeSecureFunction: async (fn: string, body: Record<string, any>) => {
    const nth = calls.filter((c) => c.fn === fn).length;
    calls.push({ fn, body });
    const answer = script[fn];
    if (!answer) throw new Error(`unscripted call to ${fn}`);
    return answer(body, nth);
  },
}));
vi.mock('@/lib/progressToast', () => ({
  createProgressToastId: () => 'toast',
  showProgressToast: () => {},
  settleProgressToast: (...args: unknown[]) => settle(...args),
}));

// Imported after the mocks so the hook picks them up.
const { useChunkedRegeneration } = await import('@/hooks/useChunkedRegeneration');

const REPORT_ID = '5d8bc97e-9305-49a4-bb3d-5cd2a7a0d82d';
const ADDRESS = '60 Lawley Street, Spalding WA 6530';

/** What the platform answered, in 6 ms, before any worker saw the request. */
const DEGRADED: Invoke = {
  data: { code: 'SUPABASE_EDGE_RUNTIME_SERVICE_DEGRADED' },
  error: { message: 'HTTP 503', status: 503 },
};
/** What `invokeSecureFunction` returns when the preflight itself is refused. */
const PREFLIGHT_REFUSED: Invoke = {
  data: null,
  error: { message: 'Network/CORS error calling condense-investment-report.', network: true, code: 'network_error', retryable: true },
};
const OK: Invoke = { data: { success: true }, error: null };

const isKickoffRead = (body: Record<string, any>) =>
  String(body?.listOptions?.select ?? '').includes('report_content');

function kickoffRow(overrides: Record<string, unknown> = {}) {
  return {
    report_content: '# Executive Verdict\n\nA complete document.',
    manual_overrides: {},
    financial_calculations: {},
    last_completed_section: 16,
    total_sections: 16,
    status: 'completed',
    current_version: 2,
    property_address: ADDRESS,
    report_scope: 'address',
    report_tier: 'compass',
    generation_engine: 'compass-40',
    ...overrides,
  };
}

/** Sixteen sections, the last answering `isComplete` — the run as it ran. */
function sixteenSections(_body: Record<string, any>, nth: number): Invoke {
  if (nth >= 15) return { data: { success: true, isComplete: true, sectionCompleted: 16 }, error: null };
  return { data: { success: true, sectionCompleted: nth + 1, sectionWrittenThisRun: true }, error: null };
}

const failureStamps = () =>
  calls.filter((c) => c.fn === 'manage-investment-reports' && c.body?.data?.status === 'failed');
const progressReads = () =>
  calls.filter((c) => c.fn === 'get-investment-reports' && !isKickoffRead(c.body));

async function run(overrides: { onComplete?: () => void; onError?: (e: string) => void } = {}) {
  const { result } = renderHook(() => useChunkedRegeneration());
  const onComplete = vi.fn(overrides.onComplete);
  const onError = vi.fn(overrides.onError);
  let finished = false;
  const pending = result.current
    .regenerate({ reportId: REPORT_ID, propertyAddress: ADDRESS, onComplete, onError })
    .finally(() => { finished = true; });
  for (let i = 0; i < 400 && !finished; i++) await vi.advanceTimersByTimeAsync(500);
  await pending;
  expect(finished).toBe(true);
  return { onComplete, onError };
}

beforeEach(() => {
  vi.useFakeTimers();
  calls.length = 0;
  settle.mockReset();
  try { localStorage.clear(); } catch { /* the driver claim falls back to a map */ }
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the incident, replayed through the real hook', () => {
  it('a finished run whose status reads all fail is reported finished, and nothing stamps it failed', async () => {
    script = {
      'get-investment-reports': (body) => (isKickoffRead(body) ? { data: { report: kickoffRow() }, error: null } : DEGRADED),
      'manage-investment-reports': () => OK,
      'generate-investment-report': sixteenSections,
      'condense-investment-report': () => PREFLIGHT_REFUSED,
    };

    const { onComplete, onError } = await run();

    expect(failureStamps()).toHaveLength(0);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(settle).toHaveBeenLastCalledWith(
      'toast', 'success', 'Report regenerated', expect.stringContaining('could not be re-read'),
    );
    // The read was asked again through the blip rather than concluded from once.
    expect(progressReads()).toHaveLength(TRANSIENT_RETRY_DELAYS_MS.length + 1);
    // And the soft condense step was tried again, boundedly.
    expect(calls.filter((c) => c.fn === 'condense-investment-report')).toHaveLength(TRANSIENT_RETRY_DELAYS_MS.length + 1);
  });

  it('a blip shorter than the retries resolves to the ordinary confirmed success', async () => {
    script = {
      'get-investment-reports': (body, nth) => {
        if (isKickoffRead(body)) return { data: { report: kickoffRow() }, error: null };
        // nth counts every get-investment-reports call; the kickoff was #0.
        return nth === 1
          ? DEGRADED
          : { data: { report: { status: 'completed', last_completed_section: 16, total_sections: 16, current_version: 3 } }, error: null };
      },
      'manage-investment-reports': () => OK,
      'generate-investment-report': sixteenSections,
      'condense-investment-report': () => OK,
    };

    const { onComplete } = await run();

    expect(failureStamps()).toHaveLength(0);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenLastCalledWith('toast', 'success', 'Report regenerated successfully', 'Version 3 created');
  });
});

describe('what must still be recorded as a failure', () => {
  it('a section that fails twice still stamps the row, because the row is short of its sections', async () => {
    script = {
      'get-investment-reports': (body) => (isKickoffRead(body)
        ? { data: { report: kickoffRow() }, error: null }
        : { data: { report: { status: 'processing', last_completed_section: 0, total_sections: 16 } }, error: null }),
      'manage-investment-reports': () => OK,
      'generate-investment-report': () => ({ data: null, error: { message: 'HTTP 500', status: 500 } }),
      'condense-investment-report': () => OK,
    };

    const { onComplete, onError } = await run();

    expect(onComplete).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('Failed to generate section 1'));
    expect(failureStamps()).toHaveLength(1);
  });

  it('a mid-run failure over a row nobody can read still fails VISIBLE — the server decides from the row', async () => {
    script = {
      'get-investment-reports': (body) => (isKickoffRead(body) ? { data: { report: kickoffRow() }, error: null } : DEGRADED),
      'manage-investment-reports': () => OK,
      'generate-investment-report': (body, nth) => (nth < 2
        ? sixteenSections(body, nth)
        : { data: null, error: { message: 'HTTP 500', status: 500 } }),
      'condense-investment-report': () => OK,
    };

    await run();

    expect(failureStamps()).toHaveLength(1);
  });
});

describe('a run that never touched the row leaves it alone', () => {
  it('a kickoff read that cannot be made writes nothing at all — no start, no stamp', async () => {
    script = {
      'get-investment-reports': () => DEGRADED,
      'manage-investment-reports': () => OK,
      'generate-investment-report': sixteenSections,
      'condense-investment-report': () => OK,
    };

    const { onError } = await run();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(calls.filter((c) => c.fn === 'manage-investment-reports')).toHaveLength(0);
    // The kickoff read itself was repeated through the blip before giving up.
    expect(calls.filter((c) => c.fn === 'get-investment-reports')).toHaveLength(TRANSIENT_RETRY_DELAYS_MS.length + 1);
  });
});

describe('the recovery for a complete report stamped failed', () => {
  it('Regenerate on a failed row with every section banked finishes it without writing a section', async () => {
    script = {
      'get-investment-reports': (body) => (isKickoffRead(body)
        ? { data: { report: kickoffRow({ status: 'failed' }) }, error: null }
        : { data: { report: { status: 'completed', last_completed_section: 16, total_sections: 16, current_version: 3 } }, error: null }),
      'manage-investment-reports': () => OK,
      'generate-investment-report': sixteenSections,
      'condense-investment-report': () => OK,
    };

    const { onComplete } = await run();

    expect(calls.filter((c) => c.fn === 'generate-investment-report')).toHaveLength(0);
    const start = calls.find((c) => c.fn === 'manage-investment-reports');
    expect(start?.body?.data?.status).toBe('processing');
    // The banked counter is kept: nothing asks the generator to start again.
    expect(start?.body?.data).not.toHaveProperty('last_completed_section');
    expect(calls.filter((c) => c.fn === 'condense-investment-report')).toHaveLength(1);
    expect(failureStamps()).toHaveLength(0);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

describe('the rule the browser asks and the server enforces', () => {
  it('reads a finished document from the status or from the counter the server stated', () => {
    expect(rowHoldsCompleteDocument({ status: 'completed', last_completed_section: 16, total_sections: 16 })).toBe(true);
    expect(rowHoldsCompleteDocument({ status: 'processing', last_completed_section: 16, total_sections: 16 })).toBe(true);
    expect(rowHoldsCompleteDocument({ status: 'failed', last_completed_section: 16, total_sections: 16 })).toBe(true);
    expect(rowHoldsCompleteDocument({ status: 'processing', last_completed_section: 8, total_sections: 16 })).toBe(false);
    // A total nobody stated is not a statement: only the status can say "done".
    expect(rowHoldsCompleteDocument({ status: 'processing', last_completed_section: 14, total_sections: null })).toBe(false);
    expect(rowHoldsCompleteDocument({ status: 'COMPLETED' })).toBe(true);
    expect(rowHoldsCompleteDocument(null)).toBe(false);
  });

  it('the server refuses a failure stamp over a finished document, and says so in words', () => {
    const refusal = refuseFailureStamp({ status: 'completed', last_completed_section: 16, total_sections: 16 });
    expect(refusal?.code).toBe('report_complete');
    expect(refusal?.message).toContain('all 16 of its sections are saved');
    expect(refusal?.message).toContain('Nothing was changed');
    expect(refuseFailureStamp({ status: 'completed' })?.message).toContain('recorded as completed');
    expect(refuseFailureStamp({ status: 'processing', last_completed_section: 8, total_sections: 16 })).toBeNull();
    expect(refuseFailureStamp(null)).toBeNull();
  });

  it('keeps every reading the 20 Sep rule already pinned', () => {
    expect(shouldMarkRunFailed({ status: 'completed', last_completed_section: 14, total_sections: 14 })).toBe(false);
    expect(shouldMarkRunFailed({ status: 'processing', last_completed_section: 14, total_sections: 14 })).toBe(false);
    expect(shouldMarkRunFailed({ status: 'processing', last_completed_section: 8, total_sections: 14 })).toBe(true);
    expect(shouldMarkRunFailed(null)).toBe(true);
  });

  it('an unreadable row does not overrule what the server already said', () => {
    expect(shouldMarkRunFailed(null, { serverReportedComplete: true })).toBe(false);
    expect(shouldMarkRunFailed(undefined, { serverReportedComplete: false })).toBe(true);
  });

  it('a readable row outranks the generator — a second pump can rewind a counter it reported complete', () => {
    expect(shouldMarkRunFailed(
      { status: 'processing', last_completed_section: 8, total_sections: 16 },
      { serverReportedComplete: true },
    )).toBe(true);
  });

  it('a run that wrote nothing stamps nothing, whatever the row reads', () => {
    expect(shouldMarkRunFailed({ status: 'processing', last_completed_section: 3, total_sections: 16 }, { wroteNothing: true })).toBe(false);
    expect(shouldMarkRunFailed(null, { wroteNothing: true })).toBe(false);
  });
});

describe('telling a failed read from an answer', () => {
  it('treats the platform not answering as transient, and an answer about the request as final', () => {
    for (const status of [500, 502, 503, 504, 429, 408]) {
      expect(isTransientReadError({ status }), String(status)).toBe(true);
    }
    for (const status of [400, 401, 403, 404, 409, 422]) {
      expect(isTransientReadError({ status }), String(status)).toBe(false);
    }
    expect(isTransientReadError({ network: true })).toBe(true);
    expect(isTransientReadError({ retryable: true, status: 400 })).toBe(true);
    expect(isTransientReadError(null)).toBe(false);
  });

  it('never repeats its own timeout — that wait is already spent', async () => {
    expect(isRepeatableFailure({ network: true, code: 'provider_timeout', retryable: true })).toBe(false);
    expect(isRepeatableFailure({ status: 503 })).toBe(true);
    let attempts = 0;
    const read = await readRunRow(async () => {
      attempts += 1;
      return { data: null, error: { network: true, code: 'provider_timeout', retryable: true, message: 'Request timed out.' } };
    }, { sleep: async () => {} });
    expect(read.kind).toBe('unreadable');
    expect(attempts).toBe(1);
  });

  it('asks again through a blip and returns the row the second answer carried', async () => {
    const slept: number[] = [];
    const answers: Invoke[] = [DEGRADED, { data: { report: { status: 'completed' } }, error: null }];
    const read = await readRunRow(async () => answers.shift()!, { sleep: async (ms) => { slept.push(ms); } });
    expect(read).toEqual({ kind: 'row', row: { status: 'completed' } });
    expect(slept).toEqual([TRANSIENT_RETRY_DELAYS_MS[0]]);
  });

  it('gives up as UNREADABLE, never as a row of zero, once every attempt has failed', async () => {
    const slept: number[] = [];
    const read = await readRunRow(async () => DEGRADED, { sleep: async (ms) => { slept.push(ms); } });
    expect(read.kind).toBe('unreadable');
    expect(slept).toEqual([...TRANSIENT_RETRY_DELAYS_MS]);
  });

  it('does not repeat an answer about the request', async () => {
    let attempts = 0;
    const read = await readRunRow(async () => {
      attempts += 1;
      return { data: null, error: { status: 404, message: 'not found' } };
    }, { sleep: async () => {} });
    expect(read.kind).toBe('unreadable');
    expect(attempts).toBe(1);
  });

  it('counts a thrown call as a network failure and a reportless answer as absent', async () => {
    let attempts = 0;
    const thrown = await readRunRow(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('Failed to fetch');
      return { data: { report: null }, error: null };
    }, { sleep: async () => {} });
    expect(thrown).toEqual({ kind: 'absent' });
    expect(attempts).toBe(2);
  });
});

describe('what a finished run amounts to', () => {
  it('is COMPLETE where the generator said so and the row could not be read — the Lawley case', () => {
    const outcome = settleRunOutcome(
      { kind: 'unreadable', error: { status: 503, message: 'HTTP 503' } },
      { serverReportedComplete: true, fallbackTotal: 16 },
    );
    expect(outcome).toMatchObject({ kind: 'complete', confirmed: false });
  });

  it('is UNKNOWN, never "0 of 16", where the row could not be read and nothing settles it', () => {
    const outcome = settleRunOutcome(
      { kind: 'unreadable', error: { status: 503 } },
      { serverReportedComplete: false, fallbackTotal: 16 },
    );
    expect(outcome).toMatchObject({ kind: 'unknown', reason: 'unreadable' });
  });

  it('reads the row whenever it can, and the row wins', () => {
    expect(settleRunOutcome(
      { kind: 'row', row: { status: 'processing', last_completed_section: 16, total_sections: 16, current_version: 4 } },
      { serverReportedComplete: false, fallbackTotal: 15 },
    )).toMatchObject({ kind: 'complete', confirmed: true, required: 16, currentVersion: 4 });
    expect(settleRunOutcome(
      { kind: 'row', row: { status: 'processing', last_completed_section: 8, total_sections: 16 } },
      { serverReportedComplete: true, fallbackTotal: 16 },
    )).toEqual({ kind: 'incomplete', done: 8, required: 16 });
  });

  it('uses the client total only where the row stated none', () => {
    expect(settleRunOutcome(
      { kind: 'row', row: { status: 'processing', last_completed_section: 14, total_sections: null } },
      { serverReportedComplete: false, fallbackTotal: 14 },
    )).toMatchObject({ kind: 'complete', confirmed: true, required: 14 });
    expect(settleRunOutcome(
      { kind: 'absent' },
      { serverReportedComplete: false, fallbackTotal: 14 },
    )).toEqual({ kind: 'unknown', reason: 'absent' });
  });
});

describe('the server enforces it where every browser build is covered', () => {
  const source = readFileSync(
    join(process.cwd(), 'supabase/functions/manage-investment-reports/index.ts'),
    'utf8',
  );

  it('reads the row and refuses before it writes or releases anything', () => {
    const refusal = source.indexOf('refuseFailureStamp(current)');
    const write = source.indexOf(".update({ ...data, updated_at: new Date().toISOString() })");
    const release = source.indexOf('releaseInvestmentReportRunTokens(\n');
    expect(refusal).toBeGreaterThan(0);
    expect(write).toBeGreaterThan(refusal);
    expect(release).toBeGreaterThan(refusal);
    expect(source).toContain("import { refuseFailureStamp } from '../_shared/reports/investment/failureStamp.pure.ts';");
  });

  it('answers 409 with the reason, and 503 — not a stamp — when it cannot read the row', () => {
    const guard = source.slice(source.indexOf("if (String(data.status || '').toLowerCase() === 'failed') {"));
    expect(guard).toContain('status: 409');
    expect(guard).toContain("code: 'row_unreadable'");
    expect(guard).toContain('status: 503');
  });

  it("the widget's Stop reads the refusal as 'already finished', never as a failed stop", () => {
    const widget = readFileSync(
      join(process.cwd(), 'src/components/reports/ReportGenerationProgress.tsx'),
      'utf8',
    );
    const refusal = widget.indexOf("error?.code === 'report_complete'");
    const genericError = widget.indexOf('Failed to stop generation: ${');
    expect(refusal).toBeGreaterThan(0);
    expect(genericError).toBeGreaterThan(refusal);
    // It was not cancelled, so the finished toast is not suppressed.
    expect(widget.slice(refusal, genericError)).toContain('cancelledIdsRef.current.delete(reportId)');
  });
});

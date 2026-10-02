/**
 * The work trace — what Aurixa did on the way to a reply, as it happens.
 *
 * The stream already says which tool starts and finishes; the old widget
 * showed one line, "Running get_upcoming_calendar…", and threw the history
 * away. Seeing the steps is what makes an agent feel like it is working for
 * you rather than thinking about you, so the steps are kept: a live list
 * while the reply is being prepared, folded into one line ("Worked for 6s ·
 * 3 steps") once it is done.
 *
 * Two rules keep it honest and short:
 * - **One step per thing a person would recognise.** The three tool-discovery
 *   meta calls are one step ("Choosing the right tools"), and the same tool
 *   run again straight away is the same step run twice, not two lines.
 * - **A step says what it did, never what it found.** The narration is
 *   derived from the tool's name alone (`narrateTool`).
 */
import { META_TOOLS, narrateTool, type ToolDomain } from './toolNarration.pure';

export interface TraceStep {
  key: string;
  tool: string;
  label: string;
  doneLabel: string;
  domain: ToolDomain;
  status: 'running' | 'done';
  /** How many calls this step folds together. */
  count: number;
  startedAt: number;
  endedAt?: number;
}

export interface WorkTrace {
  steps: TraceStep[];
  startedAt: number;
  endedAt?: number;
  stopped?: boolean;
}

export function startTrace(now: number): WorkTrace {
  return { steps: [], startedAt: now };
}

function stepKind(tool: string): string {
  return META_TOOLS.has(tool) ? '__meta__' : tool;
}

export function traceToolStart(trace: WorkTrace, tool: string, now: number): WorkTrace {
  const name = tool || '';
  const last = trace.steps[trace.steps.length - 1];
  if (last && stepKind(last.tool) === stepKind(name)) {
    const merged: TraceStep = { ...last, status: 'running', count: last.count + 1, endedAt: undefined };
    return { ...trace, steps: [...trace.steps.slice(0, -1), merged] };
  }
  const n = narrateTool(name);
  const step: TraceStep = {
    key: `${trace.steps.length}-${name}`,
    tool: name,
    label: n.active,
    doneLabel: n.done,
    domain: n.domain,
    status: 'running',
    count: 1,
    startedAt: now,
  };
  return { ...trace, steps: [...trace.steps, step] };
}

export function traceToolEnd(trace: WorkTrace, tool: string, now: number): WorkTrace {
  const kind = stepKind(tool || '');
  for (let i = trace.steps.length - 1; i >= 0; i -= 1) {
    const s = trace.steps[i];
    if (s.status === 'running' && stepKind(s.tool) === kind) {
      const steps = [...trace.steps];
      steps[i] = { ...s, status: 'done', endedAt: now };
      return { ...trace, steps };
    }
  }
  return trace;
}

/** Close the trace: any step still running is finished with the reply. */
export function finishTrace(trace: WorkTrace, now: number, stopped = false): WorkTrace {
  return {
    ...trace,
    endedAt: now,
    stopped,
    steps: trace.steps.map((s) => (s.status === 'running' ? { ...s, status: 'done' as const, endedAt: now } : s)),
  };
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${Math.max(1, s)}s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest ? `${m}m ${rest}s` : `${m}m`;
}

/** "Worked for 6s · 3 steps" — the folded line under a finished reply. */
export function traceSummary(trace: WorkTrace, now = Date.now()): string {
  const elapsed = (trace.endedAt ?? now) - trace.startedAt;
  const n = trace.steps.length;
  const verb = trace.stopped ? 'Stopped after' : 'Worked for';
  if (!n) return `${verb} ${formatDuration(elapsed)}`;
  return `${verb} ${formatDuration(elapsed)} · ${n} ${n === 1 ? 'step' : 'steps'}`;
}

/** Tool names the trace ran, in order — what the follow-up chips are chosen from. */
export function traceTools(trace: WorkTrace | null | undefined): string[] {
  return trace ? trace.steps.map((s) => s.tool) : [];
}

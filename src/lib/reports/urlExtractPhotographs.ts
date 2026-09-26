/**
 * Asking for a URL-extract report's photographs to be kept — and making sure
 * the ask is not lost.
 *
 * The extraction names the listing's own photographs on its job
 * (`photographs.candidates`, from `listingPagePhotographs.pure.ts`); nothing is
 * fetched until a report exists to keep them for. Once the report row is
 * created this asks `listing-images` to fetch, check and file them under it
 * (`op: 'capture_report'`), and the report's documents then carry them through
 * the same broker as a listing's.
 *
 * Nothing here bounds how long the photographs take to arrive. The server
 * answers as soon as it has written down what was asked, and does the work
 * after that, so a tab that closes or a request that times out costs nothing.
 * Two things can still go wrong, and each has its answer here:
 *
 *  - The ask itself never lands — a dropped connection, a platform error, a
 *    rate limit. `startPhotographCapture` sends it again, a bounded number of
 *    times, and only for a failure a second try can cure; a refusal is final.
 *  - The work lands and is left unfinished — a host that did not answer, time
 *    that ran out. The broker then reports the capture `pending`, and the next
 *    document drawn asks for the rest first (`photographResumeRequest`),
 *    waiting a bounded time, so it carries what the capture keeps.
 *
 * Neither ever costs the report: a report without photographs is the ordinary
 * state of every report before this, and every photo slot prints nothing when
 * empty.
 */

export interface UrlExtractPhotographSource {
  /** The scrape job the extraction ran as. */
  scrapeJobId?: string | null;
  /** How many photographs the job named. */
  photographCount?: number | null;
}

export interface PhotographCaptureRequest {
  op: 'capture_report';
  reportId: string;
  scrapeJobId: string;
}

export interface PhotographResumeRequest {
  op: 'capture_report';
  reportId: string;
  wait: true;
}

/** Where a report's capture stands, as the report broker states it. */
export type PhotographCaptureState = 'none' | 'complete' | 'running' | 'waiting' | 'pending';

export interface PhotographCaptureReading {
  state: PhotographCaptureState;
  /** The report the capture belongs to — a derived document's parent. */
  reportId: string;
}

/** The transport's error, as much of it as a retry decision needs. */
export interface CaptureTransportError {
  message?: string;
  status?: number;
  network?: boolean;
}

/** How long to wait before each further try at the start; two more tries, over about half a minute. */
export const CAPTURE_START_RETRY_DELAYS_MS: readonly number[] = [5_000, 20_000];

/**
 * How long a document waits for a resumed capture. The server bounds its own
 * attempt well inside this, and the transport's default is a minute.
 */
export const PHOTOGRAPH_RESUME_TIMEOUT_MS = 45_000;

const CAPTURE_STATES: readonly PhotographCaptureState[] = ['none', 'complete', 'running', 'waiting', 'pending'];

/**
 * How many pictures a finished extraction named, from its polled result: its
 * photographs and its floor plans, which one capture keeps. The count decides
 * only whether there is anything to ask for, so a listing whose page names a
 * plan and no photograph still has its plan kept.
 */
export function namedPhotographCount(scrapedResult: unknown): number {
  const named = (scrapedResult as { photographs?: { candidates?: unknown; floorPlans?: unknown } } | null)?.photographs;
  const count = (list: unknown) => (Array.isArray(list) ? list.length : 0);
  return count(named?.candidates) + count(named?.floorPlans);
}

/** The capture request for a new report, or null where there is nothing to keep. */
export function photographCaptureRequest(
  reportId: string | null | undefined,
  source: UrlExtractPhotographSource | null | undefined,
): PhotographCaptureRequest | null {
  const scrapeJobId = typeof source?.scrapeJobId === 'string' ? source.scrapeJobId.trim() : '';
  if (!reportId || !scrapeJobId) return null;
  if (!(Number(source?.photographCount) > 0)) return null;
  return { op: 'capture_report', reportId, scrapeJobId };
}

/**
 * Whether a failed start is worth sending again: the request did not arrive
 * or the server could not take it (a network failure, 429, a 5xx). A refusal —
 * not the author, not their extraction, a derived report — is an answer, and
 * sending it again would only be refused again.
 */
export function isRetryableCaptureFailure(error: CaptureTransportError | null | undefined): boolean {
  if (!error) return false;
  if (error.network === true) return true;
  const status = Number(error.status);
  return status === 429 || status >= 500;
}

/**
 * Sends the start, and again after each delay while the failure is one a
 * second try can cure. Never throws: a report without photographs is not a
 * failed report.
 */
export async function startPhotographCapture(
  invoke: (request: PhotographCaptureRequest) => Promise<{ error: CaptureTransportError | null }>,
  request: PhotographCaptureRequest,
  options: { delaysMs?: readonly number[]; sleep?: (ms: number) => Promise<void> } = {},
): Promise<{ ok: boolean; tries: number; error?: string }> {
  const delays = options.delaysMs ?? CAPTURE_START_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let tries = 0;
  let lastError: CaptureTransportError | null = null;
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    if (attempt > 0) await sleep(delays[attempt - 1]);
    tries += 1;
    try {
      const { error } = await invoke(request);
      if (!error) return { ok: true, tries };
      lastError = error;
    } catch (thrown) {
      lastError = { message: thrown instanceof Error ? thrown.message : String(thrown), network: true };
    }
    if (!isRetryableCaptureFailure(lastError)) break;
  }
  return { ok: false, tries, error: lastError?.message ?? 'The photograph request was not accepted.' };
}

/** The capture reading a broker answer carries, or null where it carries none. */
export function readPhotographCapture(response: unknown): PhotographCaptureReading | null {
  const reading = (response as { photographCapture?: unknown } | null)?.photographCapture as
    | { state?: unknown; reportId?: unknown }
    | undefined;
  if (!reading || typeof reading !== 'object') return null;
  const state = CAPTURE_STATES.find((known) => known === reading.state);
  const reportId = typeof reading.reportId === 'string' ? reading.reportId.trim() : '';
  return state && reportId ? { state, reportId } : null;
}

/**
 * The request that finishes a capture with work left over, before a document
 * is drawn — or null where there is nothing to finish, or where an attempt is
 * running or has only just been made.
 */
export function photographResumeRequest(
  reading: PhotographCaptureReading | null | undefined,
): PhotographResumeRequest | null {
  return reading?.state === 'pending' ? { op: 'capture_report', reportId: reading.reportId, wait: true } : null;
}

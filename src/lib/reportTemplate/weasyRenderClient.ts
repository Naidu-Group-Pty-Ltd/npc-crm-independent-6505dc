/**
 * weasyRenderClient — single client entry point for the `render-template-pdf`
 * edge function (HTML → WeasyPrint → storage URL).
 *
 * The editor previously had two hand-rolled copies of this fetch (live PDF
 * preview + "Render with WeasyPrint" export action); keep them in sync by
 * routing both through here.
 *
 * TRANSPORT: this goes through `invokeSecureFunction`, the same transport the
 * rest of the app uses, and must keep doing so.
 *
 * The hand-rolled `fetch` it replaces built its URL from
 * `import.meta.env.VITE_SUPABASE_PROJECT_ID` and its apikey from
 * `VITE_SUPABASE_PUBLISHABLE_KEY` — composing the target out of parts that are
 * free to disagree. The hosting build defines both, so it did work in
 * production, but a repo or CI build compiled this call site, and only this
 * call site, into a request to `https://undefined.supabase.co`. That is one
 * environment away from a dead render path, for no benefit.
 *
 * `invokeSecureFunction` takes the project URL and anon key from
 * `integrations/supabase/env.ts` like the rest of the app — one resolver, one
 * matched pair — then resolves the bearer, sends the HttpOnly session cookie,
 * refreshes-and-retries once on an auth failure, and normalises the error. Do
 * not reintroduce a bare `fetch` here.
 */
import { invokeSecureFunction, describeAuthError } from '@/lib/secureInvoke';
import { describeRenderFailure, readRenderFailure, type RenderFailureKind } from '@/lib/reports/renderFailure.pure';

/**
 * A failure the render service answered, as the edge function classified it
 * (`code`, `upstreamStatus`) — so the route can tell an engine that did not
 * answer from a document that could not be drawn, and the operator can be
 * told which. `message` is the operator's sentence.
 */
export class RenderServiceError extends Error {
  readonly kind: RenderFailureKind;
  readonly upstreamStatus: number | null;
  readonly retriable: boolean;
  constructor(kind: RenderFailureKind, upstreamStatus: number | null, message: string, retriable: boolean) {
    super(message);
    this.name = 'RenderServiceError';
    this.kind = kind;
    this.upstreamStatus = upstreamStatus;
    this.retriable = retriable;
  }
}

/** The typed failure off a function answer, or null when the answer was not a classified render failure. */
export function renderServiceErrorFrom(data: unknown, fallbackMessage?: string): RenderServiceError | null {
  const wire = readRenderFailure(data);
  if (!wire) return null;
  const message = wire.error || fallbackMessage || describeRenderFailure({ kind: wire.code, upstreamStatus: wire.upstreamStatus });
  return new RenderServiceError(wire.code, wire.upstreamStatus, message, wire.retriable);
}

/** A WeasyPrint render is minutes, not seconds, at print resolution. */
const RENDER_TIMEOUT_MS = 10 * 60_000;

export interface WeasyRenderRequest {
  html: string;
  fileName: string;
  templateId?: string;
  /**
   * `final` is the word the edge function checks (`payload.mode === 'final'`).
   * This used to be typed `'production'`, which the function has never
   * recognised — every "production" render was recorded as a preview, and
   * the client-readiness gate the function applies to a final document was
   * never reached from here.
   */
  mode?: 'preview' | 'final';
  /** Abort a superseded render (the editor supersedes previews as you type). */
  signal?: AbortSignal;
}

/** What a FINAL render is about, so the ledger and the gate can read it. */
export interface WeasyFinalRenderRequest extends WeasyRenderRequest {
  mode: 'final';
  /** The report the document is of — the function's client-readiness gate reads it. */
  reportId: string;
  /**
   * The format, in the adapters' vocabulary (`investment`, `portfolio`, …).
   * Read by the transport's render-coverage telemetry, which tags every
   * `render-template-pdf` call with the format it drew; without it the event
   * is filed under `unknown`, which is how the coverage figure came to be a
   * proxy in the first place.
   */
  reportType?: string | null;
  templateName?: string | null;
  pageCount?: number;
}

export interface WeasyRenderedDocument {
  blob: Blob;
  /** The path the function stored the PDF at, in the `investment-reports` bucket. */
  path: string | null;
  bytes: number;
  jobId: string | null;
}

/**
 * The FINAL client document: HTML in, the bytes and the stored path out.
 *
 * The function renders, stores the PDF and answers a signed URL plus the
 * storage path it wrote. The bytes are fetched back here so the caller holds
 * ONE document to hand to the person and ONE path to point a portal at —
 * without uploading the same bytes a second time.
 */
export async function renderFinalHtmlToPdf(
  req: WeasyFinalRenderRequest,
): Promise<WeasyRenderedDocument> {
  const { signal, ...body } = req;
  const { data, error } = await invokeSecureFunction<{
    url?: string; path?: string; bytes?: number; jobId?: string | null;
  }>('render-template-pdf', body, { timeoutMs: RENDER_TIMEOUT_MS, signal });
  if (error) {
    // The function classifies a failure the render service answered; it is
    // thrown typed so the caller can say which gate closed and why.
    const classified = renderServiceErrorFrom(data, error.message);
    if (classified) throw classified;
    throw new Error(describeAuthError(error.message) ?? error.message);
  }
  const url = data?.url;
  if (!url) throw new Error('WeasyPrint render returned no document URL');
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`The rendered document could not be fetched (HTTP ${res.status})`);
  const blob = await res.blob();
  if (!blob.size) throw new Error('The rendered document was empty');
  return { blob, path: data?.path ?? null, bytes: data?.bytes ?? blob.size, jobId: data?.jobId ?? null };
}

/** Renders HTML via the WeasyPrint edge function; resolves to the PDF URL. */
export async function renderHtmlToPdfUrl(
  { html, fileName, templateId, mode = 'preview', signal }: WeasyRenderRequest,
): Promise<string> {
  const { data, error } = await invokeSecureFunction<{ url?: string }>(
    'render-template-pdf',
    { html, fileName, templateId, mode },
    { timeoutMs: RENDER_TIMEOUT_MS, signal },
  );
  if (error) throw new Error(describeAuthError(error.message) ?? error.message);
  const url = data?.url;
  if (!url) throw new Error('WeasyPrint render returned no document URL');
  return url;
}

/** Sanitises a template name into a safe PDF file name. */
export function pdfFileNameFor(name: string, suffix = ''): string {
  return `${(name || 'template').replace(/[^a-z0-9]+/gi, '-')}${suffix}.pdf`;
}

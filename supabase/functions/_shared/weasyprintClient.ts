/**
 * The one place a report is turned into a PDF.
 *
 * `render-template-pdf` carried its own copy of this, and every new render path
 * would have carried another — each with its own idea of the timeout, of which
 * environment variable holds the token, and of what to do with a non-200. The
 * details below are not arbitrary and are worth having once:
 *
 *  - **Two variable names for the token.** Deployed environments have both
 *    `WEASYPRINT_SERVICE_TOKEN` and the older `WEASYPRINT_API_KEY`; a path that
 *    reads only one works in one project and 401s in another.
 *  - **Quotes are stripped.** A secret pasted into the dashboard with the quotes
 *    around it produces a bearer token that is silently wrong.
 *  - **No fallback.** When WeasyPrint is configured and fails, the caller must
 *    fail too. `render-investment-report-pdf` re-throws for this reason: a
 *    silent downgrade to a lesser renderer ships a client a document that does
 *    not look like the one that was approved.
 */
import { meteredFetch } from './meteredFetch.ts';
import {
  classifyServiceAnswer,
  describeRenderFailure,
  renderFailureIsRetriable,
  summariseServiceBody,
  type RenderFailureKind,
} from './renderFailure.pure.ts';

/**
 * A failure the render SERVICE answered (or failed to answer), classified.
 *
 * `kind` says what the status means, `upstreamStatus` is what the service
 * said, `summary` is one sentence out of its body — never the raw page —
 * and `message` is the operator's sentence. The edge functions answer with
 * these fields rather than a bare 500 so a caller can tell "the engine is
 * down" from "this document is bad" (QA-291SM, 15 Sep 2026).
 */
export class WeasyPrintServiceError extends Error {
  readonly kind: RenderFailureKind;
  readonly upstreamStatus: number | null;
  readonly summary: string;
  readonly retriable: boolean;
  constructor(kind: RenderFailureKind, upstreamStatus: number | null, summary: string) {
    super(describeRenderFailure({ kind, upstreamStatus, summary }));
    this.name = 'WeasyPrintServiceError';
    this.kind = kind;
    this.upstreamStatus = upstreamStatus;
    this.summary = summary;
    this.retriable = renderFailureIsRetriable(kind);
  }
}

/**
 * One more attempt, after this pause, when the service host did not serve
 * the request. The container scales to zero and has no startup probe, so
 * the first request after a quiet spell can meet Cloud Run's front-end 503
 * while the instance warms; a second failure a few seconds later is real.
 */
export const UNAVAILABLE_RETRY_DELAY_MS = 5_000;
const UNAVAILABLE_RETRY_ATTEMPTS = 1;

/**
 * What the file declares itself to be.
 *
 * `pdf/ua-1` is the default and every report route asks for it. The engine
 * takes **one** variant, so this is a choice rather than a stack, and it was
 * made against a validator rather than from the specification:
 *
 * | rendered as | PDF/UA-1 | PDF/A-2A | PDF/A-2B |
 * | --- | --- | --- | --- |
 * | `pdf/a-2b` (what shipped) | fail | fail | **pass** |
 * | `pdf/a-2a` | fail | **pass** | **pass** |
 * | `pdf/ua-1` | **pass** | fail | fail |
 *
 * The interesting row is the middle one. `pdf/a-2a` fails PDF/UA-1 on exactly
 * **one** rule and one check — clause 5, the PDF/UA identification schema in
 * the XMP. Everything structural passes: the tree, the heading levels, the
 * alternative text, the language. So these documents already satisfy both
 * standards' *content* rules and can only carry one standard's *declaration*.
 *
 * The declaration went to accessibility. A screen-reader user and a
 * procurement accessibility requirement both need the file to say so; nothing
 * asks these reports to be archival, and the substance of PDF/A survives the
 * switch anyway — fonts stay embedded 168 of 168, and the output intent the
 * A variant used to add for free is now asked for explicitly.
 *
 * `pdf-1.7` stays for cases that need features a conformance level forbids. It
 * is **this codebase's name, not the engine's** — see `PDF_NO_VARIANT`.
 */
export type PdfVariant = 'pdf/ua-1' | 'pdf/a-2b' | 'pdf/a-3b' | 'pdf-1.7';

export const PDF_VARIANTS: readonly PdfVariant[] = ['pdf/ua-1', 'pdf/a-2b', 'pdf/a-3b', 'pdf-1.7'];

/**
 * "Claim nothing" — and the one entry in `PdfVariant` the engine has never had.
 *
 * `weasyprint.pdf.VARIANTS` on the pinned engine holds eighteen names and
 * `pdf-1.7` is not among them; asking for it raises `KeyError: 'pdf-1.7'`
 * inside `Document._render`, which the service returns as a 500. The Export
 * Pipeline dialog has offered it as "PDF 1.7 (standard)" the whole time, and
 * `render-template-pdf` passes whatever the dialog sends straight through, so
 * that option has never produced a file.
 *
 * The engine's way of saying "no conformance level" is to be given no variant
 * at all, and its default version is already 1.7 — so this is translated to an
 * omitted `pdf_variant` rather than rejected. The name stays because it is
 * what the dialog shows a user and what is stored against saved pipelines.
 */
export const PDF_NO_VARIANT: PdfVariant = 'pdf-1.7';

/**
 * The colour space the file declares it was prepared for.
 *
 * `srgb` is a keyword the engine resolves to its own bundled `sRGB2014.icc`,
 * not a path — a path matches nothing and produces no intent at all. The
 * PDF/A variants set this themselves; `pdf/ua-1` does not, because
 * accessibility says nothing about colour, so it is asked for here or the
 * switch drops it from every report.
 */
export type PdfOutputIntent = 'srgb' | 'device-cmyk';

/** Coerce an untrusted string to a variant, defaulting rather than rejecting. */
export function toPdfVariant(value: unknown, fallback: PdfVariant = 'pdf/ua-1'): PdfVariant {
  const raw = typeof value === 'string' ? value.toLowerCase().trim() : '';
  return (PDF_VARIANTS as readonly string[]).includes(raw) ? raw as PdfVariant : fallback;
}

/**
 * Ten minutes.
 *
 * A forty-page report with inlined assets is minutes, not seconds, and a
 * timeout shorter than the work turns a slow render into a failed one.
 */
export const WEASYPRINT_TIMEOUT_MS = 600_000;

/** The service's own cap. Checked before the POST so the error names the cause. */
export const MAX_HTML_BYTES = 25 * 1024 * 1024;

export interface WeasyPrintOptions {
  variant?: PdfVariant;
  /** Defaults to `srgb`. See `PdfOutputIntent`. */
  outputIntent?: PdfOutputIntent;
  /** Tagged PDF. On by default — an untagged report is not navigable. */
  tagged?: boolean;
  optimizeImages?: boolean;
  timeoutMs?: number;
  /**
   * Refuse a document the engine could not render whole.
   *
   * Off for client-facing renders, and all nine production routes leave it
   * that way: a dropped `text-wrap` is cosmetic and a person waiting on a
   * report is not served by a 422.
   *
   * On in CI, where a dropped declaration is a design decision that did not
   * reach the page. It took a while to become true — this comment used to
   * claim CI and `engineCheck.mts` both set it and neither did, so the
   * setting was implemented, documented, tested in `test_app.py`, and never
   * once switched on by anything.
   *
   * Not in `engineCheck.mts`, and that is deliberate rather than an omission:
   * that script probes constructs precisely to find which ones the engine
   * drops, so warnings are its input. Refusing on one would make it refuse
   * every run.
   */
  strict?: boolean;
  /**
   * Where this file came from. See `DocumentProvenance`.
   *
   * Injected into the document's `<head>` and stamped into the PDF by the
   * engine. Omitted means the file says nothing about its origin, which is
   * what every report produced by this programme has said so far.
   */
  provenance?: DocumentProvenance;
}

/**
 * The row a PDF came from, carried inside the PDF.
 *
 * Nothing connected a delivered file back to the render that produced it. The
 * ledger has the row; the file a client forwards to their broker eighteen
 * months later has a name and a page count. When someone asks "which
 * assessment is this", the honest answer has been to search by date.
 *
 * These become entries in the PDF's document information dictionary, via the
 * engine's `custom_metadata`. Two things about that are worth knowing before
 * changing a key here, both measured against the pinned engine:
 *
 *  - the engine **lowercases the key and strips everything that is not a
 *    letter or a digit**, so `npc-render-id` arrives as `/npcrenderid`;
 *  - they land in the Info dictionary, not in the XMP packet. That is fine for
 *    PDF/UA — verified, 106 rules pass with these present — and would not be
 *    for PDF/A, which requires the two to agree.
 *
 * Nothing here is a secret and nothing here is new to the reader: the client's
 * name is already on the cover and the reference is already in the running
 * foot. Do not add anything that is not already printed on the page.
 */
export interface DocumentProvenance {
  /** The archetype id — `borrowing-capacity`, `market-intelligence`. */
  format: string;
  /** The ledger row this render is recorded against. */
  renderId?: string | null;
  /** The row the document was built from — an assessment, a report, a conversion. */
  sourceId?: string | null;
  /** ISO-8601, from the caller. This module does not read the clock. */
  renderedAt?: string | null;
}

/**
 * A key the engine will keep and a value that cannot escape the attribute.
 *
 * The values are ids this codebase generated and a format name out of a fixed
 * list, so this is a belt rather than a rescue — but the tags are injected
 * *after* `assertSafeRenderResources` has passed the document, so nothing else
 * is going to look at them.
 */
function metaTag(name: string, value: string): string {
  const key = name.toLowerCase().replace(/[^a-z0-9-]/g, '');
  const safe = value
    // Control characters, spelled with escapes rather than written
    // literally: a raw byte in a source file makes it binary to `grep`.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .slice(0, 200);
  return `<meta name="${key}" content="${safe}">`;
}

/**
 * Put the provenance into the document's head.
 *
 * Injected immediately after `<head>` rather than appended before `</head>`,
 * because a document whose head the caller assembled by hand may not have a
 * closing tag at all — HTML does not require one — while `<head>` is written
 * by `renderDocument` and is always there. A document with no `<head>` is
 * returned unchanged: a missing stamp is not worth failing a render over.
 */
export function withProvenance(html: string, provenance?: DocumentProvenance): string {
  if (!provenance) return html;
  const tags = [
    metaTag('npc-format', provenance.format),
    provenance.renderId ? metaTag('npc-render-id', provenance.renderId) : '',
    provenance.sourceId ? metaTag('npc-source-id', provenance.sourceId) : '',
    provenance.renderedAt ? metaTag('npc-rendered-at', provenance.renderedAt) : '',
  ].filter(Boolean).join('\n');
  return html.replace(/<head(\s[^>]*)?>/i, (match) => `${match}\n${tags}`);
}

/**
 * What the engine said while it was rendering.
 *
 * WeasyPrint does not fail on CSS it cannot implement — it logs a line and
 * renders the document without it. That log went to the container's stderr and
 * no caller ever saw it, which is how a stylesheet written against one version
 * and printed by another shipped a broken cover on every render for a day.
 *
 * `warnings` is empty for a document the engine rendered whole. Anything in it
 * is a declaration that did not reach the page.
 */
export interface WeasyPrintDiagnostics {
  pdf: Uint8Array;
  /** The engine's own page count, not inferred from the bytes. */
  pages: number | null;
  /** Declarations the engine dropped, verbatim. */
  warnings: string[];
  /** The version that actually rendered it. Pinned, and worth recording. */
  engine: string | null;
  /** Whether a structure tree was written. An untagged PDF is not navigable. */
  tagged: boolean | null;
  renderMs: number | null;
}

export interface WeasyPrintConfig {
  url: string;
  token: string;
}

/**
 * Read the service configuration, or explain what is missing.
 *
 * Separate from the call so a caller can fail fast with a message a human can
 * act on, rather than at the fetch.
 */
export function weasyPrintConfig(env: (key: string) => string | undefined): WeasyPrintConfig | null {
  const url = (env('WEASYPRINT_SERVICE_URL') || '').trim().replace(/\/$/, '');
  const token = (env('WEASYPRINT_SERVICE_TOKEN') || env('WEASYPRINT_API_KEY') || '')
    .trim()
    .replace(/^["']|["']$/g, '');
  return url && token ? { url, token } : null;
}

/** A header the service may not be new enough to send. */
function headerInt(res: Response, name: string): number | null {
  const raw = Number(res.headers.get(name));
  return Number.isFinite(raw) ? raw : null;
}

/**
 * The dropped declarations, or an empty list.
 *
 * JSON in a header, so it is parsed defensively: a proxy that truncates it, or
 * a service too old to send it, must degrade to "nothing reported" rather than
 * failing a render that otherwise succeeded.
 */
function readWarnings(res: Response): string[] {
  const raw = res.headers.get('X-WeasyPrint-Warnings');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((entry) => String(entry)) : [];
  } catch {
    return [];
  }
}

/**
 * Render HTML to PDF bytes, and hand back what the engine said about it.
 *
 * Throws on anything other than a 200 with a body, with the service's own
 * message included — a 500 that says only "render failed" costs an hour.
 */
export async function renderPdfWithDiagnostics(
  config: WeasyPrintConfig,
  html: string,
  options: WeasyPrintOptions = {},
): Promise<WeasyPrintDiagnostics> {
  const variant = options.variant ?? 'pdf/ua-1';
  const stamped = withProvenance(html, options.provenance);
  const bytes = new TextEncoder().encode(stamped).length;
  if (bytes > MAX_HTML_BYTES) {
    throw new Error(
      `document is ${bytes} bytes, over the ${MAX_HTML_BYTES}-byte render cap; `
      + 'the usual cause is an inlined asset that should have been rejected by policy',
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? WEASYPRINT_TIMEOUT_MS);
  try {
    // BILLING: the render container is our own Cloud Run compute and the cost
    // is real, so it is metered like any vendor. The host comes from env and
    // varies per deployment, so the credential is named explicitly rather than
    // inferred from the URL. One swap here covers all eleven render routes.
    const request = () => meteredFetch(`${config.url}/render`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.token}`,
        Accept: 'application/pdf',
      },
      body: JSON.stringify({
        html: stamped,
        // `null` rather than the name: the service treats a null variant as
        // "the engine's default", which is what `pdf-1.7` means. See
        // `PDF_NO_VARIANT`.
        pdf_variant: variant === PDF_NO_VARIANT ? null : variant,
        output_intent: options.outputIntent ?? 'srgb',
        tagged: options.tagged !== false,
        optimize_images: options.optimizeImages !== false,
        // Asked for unconditionally rather than only when there is provenance:
        // the option means "copy this document's own `<meta>` tags into the
        // file", and a document with none is unaffected. Making it conditional
        // would mean two shapes of request for one shape of document.
        custom_metadata: true,
        strict: options.strict === true,
      }),
      signal: controller.signal,
    }, { secretName: 'WEASYPRINT_SERVICE_TOKEN', feature: 'weasyprint/render' });

    // A host that did not serve the request (502/503/504, or no answer at
    // all) is asked once more after a pause; anything the service actually
    // SAID is final. The failure is thrown classified — kind, upstream
    // status, one sentence of its body — never as the raw page.
    let res: Response | null = null;
    let failure: WeasyPrintServiceError | null = null;
    for (let attempt = 0; attempt <= UNAVAILABLE_RETRY_ATTEMPTS; attempt += 1) {
      failure = null;
      try {
        res = await request();
      } catch (e) {
        if (controller.signal.aborted) throw e;
        res = null;
        failure = new WeasyPrintServiceError('engine_unavailable', null, summariseServiceBody(e instanceof Error ? e.message : String(e)));
      }
      if (res && res.ok) break;
      if (res) {
        const body = await res.text().catch(() => '');
        // The SHAPE of the answer decides, not the digit: Cloud Run's own
        // error page under a 500 is the engine not answering (15 Sep 2026 —
        // every request, including an unauthenticated GET /, met it), and
        // the engine's own JSON under the same status is a render failure.
        const kind = classifyServiceAnswer({
          status: res.status, body, engineHeader: res.headers.get('X-WeasyPrint-Version'),
        });
        failure = new WeasyPrintServiceError(kind, res.status, summariseServiceBody(body));
        res = null;
      }
      if (!failure || !failure.retriable || attempt === UNAVAILABLE_RETRY_ATTEMPTS) break;
      console.warn(`[weasyprintClient] ${failure.kind} (HTTP ${failure.upstreamStatus ?? 'none'}); retrying once in ${UNAVAILABLE_RETRY_DELAY_MS}ms`);
      await new Promise((resolve) => setTimeout(resolve, UNAVAILABLE_RETRY_DELAY_MS));
    }
    if (!res) throw failure ?? new WeasyPrintServiceError('engine_failed', null, 'no response');
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength === 0) throw new Error('WeasyPrint returned an empty body');
    const taggedHeader = res.headers.get('X-Pdf-Tagged');
    return {
      pdf: new Uint8Array(buffer),
      pages: headerInt(res, 'X-Pdf-Pages'),
      warnings: readWarnings(res),
      engine: res.headers.get('X-WeasyPrint-Version'),
      tagged: taggedHeader === null ? null : taggedHeader === '1',
      renderMs: headerInt(res, 'X-Render-Ms'),
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Render HTML to PDF bytes.
 *
 * The nine render routes want bytes and nothing else. `renderPdfWithDiagnostics`
 * is for a caller that wants to record what the engine dropped — the converter's
 * route, CI, and the engine check.
 */
export async function renderPdf(
  config: WeasyPrintConfig,
  html: string,
  options: WeasyPrintOptions = {},
): Promise<Uint8Array> {
  return (await renderPdfWithDiagnostics(config, html, options)).pdf;
}

/** Latin-1 decode. Keeps byte values intact; the tokens matched are ASCII. */
function asLatin1(bytes: Uint8Array): string {
  let text = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    text += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return text;
}

/** `/Type /Page` outside a `/Pages` node is one page. Stable across producers. */
function countPageTokens(text: string): number {
  return (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

/**
 * The number of pages in a PDF, or `null`.
 *
 * Counted from the bytes rather than asked of a library.
 *
 * **This returns `null` for every document WeasyPrint produces**, and did so
 * for every render in this programme until it was measured. WeasyPrint packs
 * its page objects into compressed object streams — the raw bytes hold
 * `/Type /ObjStm … /Filter /FlateDecode` and the `/Type /Page` token appears
 * nowhere outside them — so the scan finds zero matches and, by its own rule,
 * says it does not know. It was not wrong; it was blind. Use
 * `countPdfPagesAsync`, which inflates the streams first.
 *
 * Kept, un-deprecated, because it is correct and synchronous for an uncompressed
 * PDF and it is the first thing the async version tries.
 */
export function countPdfPages(pdf: Uint8Array): number | null {
  const matches = countPageTokens(asLatin1(pdf));
  return matches ? matches : null;
}

/**
 * `/Type /ObjStm` … `stream` … `endstream`, capturing the dictionary and the
 * payload separately.
 *
 * The dictionary is captured because it carries `/Length`, and `/Length` is the
 * only exact answer. Slicing at `endstream` overshoots by the end-of-line the
 * spec puts before the keyword — one byte here — and a deflate stream handed
 * one trailing byte fails with `failed to write whole buffer` rather than
 * inflating what it can. That single byte is why the first version of this
 * counted zero pages in a PDF whose object stream inflated perfectly under
 * `zlib.decompress`.
 */
const OBJ_STREAM = /\/Type\s*\/ObjStm([\s\S]{0,400}?)stream\r?\n([\s\S]*?)endstream/g;

/**
 * The number of pages, looking inside compressed object streams.
 *
 * Async because inflating needs `DecompressionStream`, which is a stream API.
 * That is the entire reason this is a second function rather than a fix to the
 * first: every caller records the count on a row it is already `await`ing a
 * write to, so the cost is nothing, but the signature change is not free.
 *
 * Still `null` on genuine failure — an encrypted PDF, a producer using a filter
 * other than Flate, a truncated file. A wrong page count is worse than an
 * absent one: the column exists so that a document which silently lost its
 * audit trail shows up as a count that moved, and a fabricated number defeats
 * exactly that.
 */
export async function countPdfPagesAsync(pdf: Uint8Array): Promise<number | null> {
  const raw = asLatin1(pdf);
  const direct = countPageTokens(raw);
  if (direct) return direct;

  let found = 0;
  for (const match of raw.matchAll(OBJ_STREAM)) {
    const declared = Number(/\/Length\s+(\d+)/.exec(match[1] ?? '')?.[1]);
    let payload = match[2];
    if (!payload) continue;
    payload = Number.isFinite(declared) && declared > 0 && declared <= payload.length
      ? payload.slice(0, declared)
      // No `/Length` — an indirect one, which is legal. Drop the end-of-line
      // the spec requires before `endstream` and hope the data does not end in
      // one itself.
      : payload.replace(/\r?\n$/, '');
    const bytes = new Uint8Array(payload.length);
    for (let i = 0; i < payload.length; i += 1) bytes[i] = payload.charCodeAt(i) & 0xff;
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
      const inflated = new Uint8Array(await new Response(stream).arrayBuffer());
      found += countPageTokens(asLatin1(inflated));
    } catch {
      // One unreadable stream is not a reason to abandon the others; a PDF
      // mixing filters still yields a count from the streams that did inflate.
      continue;
    }
  }
  return found || null;
}

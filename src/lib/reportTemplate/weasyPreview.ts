/**
 * weasyPreview — render a template to a PDF preview URL via the
 * `render-template-pdf` WeasyPrint edge function.
 *
 * This is the editor-side equivalent of the production renderer used by
 * `routeReportThroughTemplate`. The previous jsPDF preview (`pdfRenderer`)
 * could only ship Helvetica/Times/Courier; switching to WeasyPrint means the
 * in-editor preview matches the customer-facing export pixel-for-pixel
 * (Playfair Display, Google Fonts, custom CSS, etc.).
 *
 * Calls are cached in-memory by SHA-1 of the compiled HTML so re-rendering an
 * unchanged template returns the previous signed URL instantly.
 */
import { invokeSecureFunction, describeAuthError } from '@/lib/secureInvoke';
import { compileTemplateHtmlForPdf } from './compileTemplateForPdf';
import type { ReportTemplate } from './templateSchema';

export interface WeasyPreviewOptions {
  data?: Record<string, any>;
  customCss?: string;
  title?: string;
  fileName?: string;
  templateId?: string | null;
  templateName?: string | null;
  mode?: 'preview' | 'final';
  signal?: AbortSignal;
}

export interface WeasyPreviewResult {
  url: string;
  fileName: string;
  bytes?: number;
  cached: boolean;
}

const cache = new Map<string, { url: string; fileName: string; bytes?: number; expiresAt: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h (signed URL lives 24h, refresh well before)
const MAX_CACHE = 32;
/** A print-resolution render is minutes, not seconds. */
const RENDER_TIMEOUT_MS = 10 * 60_000;

async function sha1(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-1', bytes);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function purgeExpired() {
  const now = Date.now();
  for (const [k, v] of cache) {
    if (v.expiresAt < now) cache.delete(k);
  }
  while (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

/**
 * Compile the template to HTML, send to WeasyPrint, return a signed PDF URL.
 */
export async function renderTemplateViaWeasyPrint(
  template: ReportTemplate,
  opts: WeasyPreviewOptions = {},
): Promise<WeasyPreviewResult> {
  // One shared compile step: resolve the page rasters, then render. The
  // resolution uses reference mode, so WeasyPrint fetches the rasters itself
  // rather than receiving them base64-inlined — inlining is bounded by the
  // service's 25 MB MAX_HTML_BYTES, and an A4 page raster costs ~5.9 MB at
  // 200 DPI and ~13.3 MB at 300, so an inlined pixel-perfect export blows the
  // cap at roughly two pages while production imports average 18.5.
  // See compileTemplateForPdf.ts for what skipping the step cost.
  const { html } = await compileTemplateHtmlForPdf(template, {
    data: opts.data ?? {},
    title: opts.title ?? 'Template Preview',
    customCss: opts.customCss,
  });
  if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError');

  const fileName = (opts.fileName || 'template-preview.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = await sha1(`${opts.templateId ?? ''}::${opts.mode ?? 'preview'}::${html}`);
  purgeExpired();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return { url: hit.url, fileName: hit.fileName, bytes: hit.bytes, cached: true };
  }

  // Goes through `invokeSecureFunction` — the app's one transport — rather
  // than a hand-rolled fetch built on Vite env vars that only the hosting
  // build defines. See `weasyRenderClient.ts`; the shared transport carries
  // the cookie session and refreshes-and-retries once on an auth failure.
  const { data, error } = await invokeSecureFunction<{
    url?: string; fileName?: string; bytes?: number;
  }>(
    'render-template-pdf',
    {
      html,
      fileName,
      templateId: opts.templateId ?? null,
      templateName: opts.templateName ?? null,
      mode: opts.mode ?? 'preview',
    },
    { timeoutMs: RENDER_TIMEOUT_MS, signal: opts.signal },
  );
  if (error) throw new Error(describeAuthError(error.message) ?? error.message);
  if (!data?.url) throw new Error('WeasyPrint render returned no document URL');
  const result: WeasyPreviewResult = {
    url: String(data.url),
    fileName: String(data.fileName ?? fileName),
    bytes: typeof data.bytes === 'number' ? data.bytes : undefined,
    cached: false,
  };
  cache.set(key, { ...result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}

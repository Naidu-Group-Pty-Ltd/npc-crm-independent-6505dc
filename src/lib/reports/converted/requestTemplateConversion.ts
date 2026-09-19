/**
 * Talking to `convert-template-document`.
 *
 * ## The file goes up as bytes
 *
 * `fileToBase64` reads the upload in the browser and the base64 travels in the
 * request. There is no bucket in the middle, deliberately: an upload followed
 * by a conversion somebody abandons would be an orphaned object in a bucket
 * whose retention job is dry-run by design and never deletes anything.
 *
 * The cost is a size ceiling, checked here as well as on the route so a person
 * who picks a 40 MB scan is told immediately rather than after the upload.
 *
 * ## No fallback
 *
 * There is nothing to fall back to. The converter is new; the alternative to
 * the route answering is nothing happening, and it says so naming the function
 * that needs deploying.
 */
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { looksUndeployed } from '../undeployedRoute';
import {
  base64Bytes,
  type ConvertChaptersResponse,
  type ConvertExtractResponse,
  type ConvertListResponse,
  type ConvertProposeResponse,
  type ConvertRenderResponse,
  MAX_SOURCE_BYTES,
  sourceKindFor,
} from './route.pure';
import type { ConversionFidelity } from './enrich.pure';
import type { ReportArchetypeId } from '@/lib/reportDesign/structure.pure';

/** Shared so the converter page can invalidate the list after a render. */
export const RECENT_CONVERSIONS_QUERY_KEY = ['template-conversions', 'recent'] as const;

// The predicate is shared (`../undeployedRoute`). Every one of the nine
// formats carried its own copy and eight were stale in the same way: none
// could match the message the transport produces for an absent function,
// so the fallback each of them guards never fired for the case it exists
// for. See that module's header.

const UNDEPLOYED_MESSAGE =
  'The template converter is not available yet — convert-template-document has not been deployed.';

async function call<T>(body: Record<string, unknown>, timeoutMs: number): Promise<T> {
  const { data, error } = await invokeSecureFunction('convert-template-document', body, { timeoutMs });
  if (!error && data?.action) return data as T;
  if (looksUndeployed(error)) throw new Error(UNDEPLOYED_MESSAGE);
  throw new Error(error?.message || 'The converter did not answer');
}

/**
 * A file to base64, without the data-URI prefix.
 *
 * `FileReader` rather than `btoa(String.fromCharCode(...))`: spreading a
 * multi-megabyte `Uint8Array` into `fromCharCode` blows the argument limit and
 * throws on exactly the large files this needs to handle.
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The file could not be read'));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

/** Upload a template and get its sections back, with a proposed binding. */
export async function extractTemplate(
  file: File,
  format: ReportArchetypeId,
): Promise<ConvertExtractResponse> {
  if (!sourceKindFor(file.name)) {
    throw new Error(`"${file.name}" is not a supported source — upload a PDF, Markdown or text file`);
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error(
      `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB and the limit is `
      + `${MAX_SOURCE_BYTES / 1024 / 1024} MB`,
    );
  }

  const sourceBase64 = await fileToBase64(file);
  if (base64Bytes(sourceBase64) === 0) throw new Error(`"${file.name}" is empty`);

  // A scanned forty-page template goes through vision extraction. Generous
  // against the worst case rather than the median.
  return call<ConvertExtractResponse>(
    { action: 'extract', fileName: file.name, sourceBase64, format },
    300_000,
  );
}

/** Re-score the stored sections against a different report format. */
export function proposeTemplateBinding(
  conversionId: string,
  format: ReportArchetypeId,
): Promise<ConvertProposeResponse> {
  return call<ConvertProposeResponse>({ action: 'propose', conversionId, format }, 45_000);
}

/**
 * Earlier conversions, each with a freshly signed link.
 *
 * The only way back to a rendered PDF once the page has been reloaded: the
 * bucket is private and grants the browser no object access, so a URL has to be
 * signed server-side. Signing happens per listing rather than on demand,
 * because an expiry is a clock the browser cannot see.
 */
export function listConversions(limit = 10): Promise<ConvertListResponse> {
  return call<ConvertListResponse>({ action: 'list', limit }, 45_000);
}

/**
 * The chapters of a converted document and the prose in them.
 *
 * Asked for separately rather than returned by `render`, because it is only
 * wanted when somebody chooses to open the conversion as an editable template —
 * and a hundred kilobytes of prose on every render is a hundred kilobytes
 * nobody asked for.
 */
export function conversionChapters(conversionId: string): Promise<ConvertChaptersResponse> {
  return call<ConvertChaptersResponse>({ action: 'chapters', conversionId }, 45_000);
}

/** Render the confirmed binding. */
export function renderConvertedTemplate(args: {
  conversionId: string;
  format: ReportArchetypeId;
  binding: unknown;
  designSystemId: string | null;
  /** How much licence the design pass has. The route defaults it if absent. */
  fidelity?: ConversionFidelity;
  /**
   * Print it as a document rather than a draft — no caution block, no
   * `converted draft` on the cover, no `From "…"` deks. Absent means draft.
   */
  final?: boolean;
  /** Let the model compose the pages. See `composeHtml.pure.ts`. */
  compose?: boolean;
}): Promise<ConvertRenderResponse> {
  return call<ConvertRenderResponse>({ action: 'render', ...args }, 240_000);
}

export interface DeliveredConversion extends ConvertRenderResponse {
  blob: Blob;
}

/** Save a file the way a browser saves files. */
function saveToBrowser(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // On a delay: Safari cancels an in-flight download when the URL disappears
  // underneath it.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/**
 * Render and hand back the bytes.
 *
 * The blob comes back as well as being saved, because the converter screen
 * previews the draft in place — the whole point of the review step is looking
 * at the result before deciding the binding was right, and a PDF that landed in
 * a downloads folder is one somebody has to go and find.
 */
export async function deliverConvertedTemplate(
  args: Parameters<typeof renderConvertedTemplate>[0] & { save?: boolean },
): Promise<DeliveredConversion> {
  const result = await renderConvertedTemplate(args);

  const response = await fetch(result.url);
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  const blob = await response.blob();

  if (args.save) saveToBrowser(blob, result.fileName);

  return { ...result, blob };
}

/**
 * Save a remote file to disk from the browser.
 *
 * ## Why this is not a one-liner
 *
 * Two browser rules defeat the obvious approaches, and the WeasyPrint render
 * path hit both — so a render that had completed, uploaded and signed
 * correctly still gave the user no way to get the PDF.
 *
 * 1. **`window.open` needs user activation.** A render takes 40+ seconds; by
 *    the time the promise resolves the click that started it is long spent, so
 *    the browser blocks the popup — silently. The UI said "Export ready" and
 *    nothing happened.
 *
 * 2. **`<a download>` is ignored cross-origin.** The signed URL is served from
 *    `*.supabase.co`, a different origin from the app, and the `download`
 *    attribute only applies same-origin. The browser drops the attribute (and
 *    the filename with it) and navigates instead.
 *
 * Fetching the bytes and handing the browser a same-origin `blob:` URL escapes
 * both: no popup is opened, and the blob IS same-origin so `download` and the
 * filename are honoured. The signed URL carries its own token in the query
 * string, so the request is deliberately made WITHOUT credentials — the app's
 * session cookie has no business being sent to the storage host.
 */

/** How long the object URL stays alive after the click that consumes it. */
const OBJECT_URL_TTL_MS = 60_000;

export interface DownloadUrlOptions {
  /** Fetch implementation (tests inject one). */
  fetchImpl?: typeof fetch;
  /** Escape hatch used when the fetch route is unavailable. */
  openFallback?: (url: string) => Window | null;
}

/**
 * Download `url` and save it as `fileName`.
 *
 * Falls back to opening the URL in a new tab when the bytes cannot be fetched
 * (an opaque CORS response, say). If that is blocked too, throws — the caller
 * must tell the user rather than appear to have done something.
 */
export async function downloadUrlAsFile(
  url: string,
  fileName: string,
  options: DownloadUrlOptions = {},
): Promise<void> {
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const openTab = options.openFallback
    ?? ((target: string) => globalThis.window?.open(target, '_blank', 'noopener') ?? null);

  try {
    const response = await doFetch(url, { credentials: 'omit' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    saveBlob(blob, fileName);
    return;
  } catch (cause) {
    // The bytes could not be read. Opening the URL still gets the person to
    // their document, so try that before giving up.
    const opened = openTab(url);
    if (opened) return;
    throw new Error(
      `Could not download ${fileName}: ${(cause as Error)?.message ?? cause}. `
      + 'Opening it in a new tab was blocked — allow pop-ups for this site, or use the link in the render history.',
    );
  }
}

/** Hand a blob to the browser as a save-to-disk with the given filename. */
export function saveBlob(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  // Firefox only dispatches the click when the anchor is in the document.
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoking synchronously races the download in Safari; give it a window.
  setTimeout(() => URL.revokeObjectURL(objectUrl), OBJECT_URL_TTL_MS);
}

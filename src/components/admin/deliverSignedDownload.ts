/**
 * Deliver a short-lived signed storage URL as an actual file download.
 *
 * `window.open` looks correct and fails quietly: by the time a signed URL comes
 * back from an edge function the click that asked for it is no longer the
 * current user gesture, so Chrome's popup blocker drops the call and the success
 * toast tells the user a lie. Fetching the bytes and handing them to an anchor
 * needs no popup at all, and falls back to a same-tab navigation if the fetch
 * itself is refused.
 */
export async function deliverSignedDownload(signedUrl: string, fileNameHint?: string) {
  const suggestedName = fileNameHint
    || decodeURIComponent(signedUrl.split('download=')[1]?.split('&')[0] || '')
    || 'executed-agreement.pdf';

  let objectUrl: string | null = null;
  try {
    const res = await fetch(signedUrl, { credentials: 'omit' });
    if (!res.ok) throw new Error(`The stored copy could not be read (${res.status})`);
    objectUrl = URL.createObjectURL(await res.blob());
  } catch {
    objectUrl = null;
  }

  const anchor = document.createElement('a');
  anchor.href = objectUrl || signedUrl;
  anchor.download = suggestedName;
  anchor.rel = 'noopener noreferrer';
  if (!objectUrl) anchor.target = '_blank';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  if (objectUrl) {
    const created = objectUrl;
    setTimeout(() => URL.revokeObjectURL(created), 60_000);
  }
}

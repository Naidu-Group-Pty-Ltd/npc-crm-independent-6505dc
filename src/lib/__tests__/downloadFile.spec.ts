/**
 * Saving a rendered PDF, and the two browser rules that used to prevent it.
 *
 * The renders were completing, uploading and signing correctly — the ledger
 * shows 7.2 MB objects in storage with valid 24h signed URLs — and the user
 * still had no way to get the file, because every download path did one of:
 *
 *   - `window.open(signedUrl)` AFTER awaiting a 40-second render, which the
 *     browser blocks: user activation is long gone by then; or
 *   - `<a download href=signedUrl>` where the href is cross-origin
 *     (`*.supabase.co`), so the `download` attribute — and the filename — are
 *     ignored.
 *
 * Fetching the bytes and clicking a same-origin `blob:` anchor is subject to
 * neither. These tests hold that shape.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadUrlAsFile } from '../downloadFile';

const SIGNED = 'https://dduzbchuswwbefdunfct.supabase.co/storage/v1/object/sign/investment-reports/x.pdf?token=t';

/**
 * The response shape the helper consumes. A real `Response` cannot be built
 * around a jsdom `Blob` (undici wants `blob.stream()`), and faking the two
 * members used keeps the test about the download, not about the polyfill.
 */
const pdfResponse = (status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  blob: async () => new Blob(['%PDF-1.7']),
});

let created: HTMLAnchorElement[] = [];
let clicked: HTMLAnchorElement[] = [];
let revoked: string[] = [];

beforeEach(() => {
  created = [];
  clicked = [];
  revoked = [];
  vi.useFakeTimers();
  URL.createObjectURL = vi.fn(() => 'blob:https://app.local/abc') as never;
  URL.revokeObjectURL = vi.fn((u: string) => { revoked.push(u); }) as never;
  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string, ...rest: never[]) => {
    const el = realCreate(tag, ...rest);
    if (tag === 'a') {
      created.push(el as HTMLAnchorElement);
      (el as HTMLAnchorElement).click = () => { clicked.push(el as HTMLAnchorElement); };
    }
    return el;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('downloadUrlAsFile', () => {
  it('saves a same-origin blob with the requested filename — never opens a popup', async () => {
    const fetchImpl = vi.fn(async () => pdfResponse());
    const openFallback = vi.fn(() => null);

    await downloadUrlAsFile(SIGNED, 'BC-Snapshot-final.pdf', { fetchImpl: fetchImpl as never, openFallback });

    expect(openFallback, 'a popup would be blocked after a long render').not.toHaveBeenCalled();
    expect(clicked).toHaveLength(1);
    expect(clicked[0].getAttribute('href')).toMatch(/^blob:/);
    // The filename survives only because the href is now same-origin.
    expect(clicked[0].getAttribute('download')).toBe('BC-Snapshot-final.pdf');
    expect(clicked[0].isConnected, 'anchor is detached again after the click').toBe(false);
  });

  it('does not send the app session to the storage host', async () => {
    const fetchImpl = vi.fn(async () => pdfResponse());
    await downloadUrlAsFile(SIGNED, 'a.pdf', { fetchImpl: fetchImpl as never, openFallback: () => null });
    expect(fetchImpl).toHaveBeenCalledWith(SIGNED, { credentials: 'omit' });
  });

  it('releases the object URL, but not before the download can start', async () => {
    const fetchImpl = vi.fn(async () => pdfResponse());
    await downloadUrlAsFile(SIGNED, 'a.pdf', { fetchImpl: fetchImpl as never, openFallback: () => null });
    expect(revoked, 'revoking synchronously races the download').toHaveLength(0);
    vi.runAllTimers();
    expect(revoked).toEqual(['blob:https://app.local/abc']);
  });

  it('falls back to opening the URL when the bytes cannot be fetched', async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    const opened: string[] = [];
    const openFallback = vi.fn((u: string) => { opened.push(u); return {} as Window; });

    await downloadUrlAsFile(SIGNED, 'a.pdf', { fetchImpl: fetchImpl as never, openFallback });

    expect(opened).toEqual([SIGNED]);
    expect(clicked).toHaveLength(0);
  });

  it('treats a non-OK response as a failure rather than saving an error page', async () => {
    const fetchImpl = vi.fn(async () => pdfResponse(403));
    const openFallback = vi.fn(() => ({} as Window));
    await downloadUrlAsFile(SIGNED, 'a.pdf', { fetchImpl: fetchImpl as never, openFallback });
    expect(openFallback).toHaveBeenCalled();
    expect(clicked).toHaveLength(0);
  });

  it('throws something actionable when the fetch fails AND the popup is blocked', async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    await expect(
      downloadUrlAsFile(SIGNED, 'BC-Snapshot.pdf', { fetchImpl: fetchImpl as never, openFallback: () => null }),
    ).rejects.toThrow(/allow pop-ups|render history/i);
  });
});

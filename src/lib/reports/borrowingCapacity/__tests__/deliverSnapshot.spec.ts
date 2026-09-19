/**
 * Which renderer runs, and what reaches the browser.
 *
 * Two things are being pinned. The first is that **choosing the legacy layout
 * reaches the legacy generator and nothing else** — no request, no fallback
 * logic, no chance of quietly getting the server document instead. That is the
 * whole point of the variant: before it, the legacy path was reachable only
 * when the render function was undeployed, which meant deploying the function
 * would have retired a generator nobody decided to retire.
 *
 * The second is the delivery itself. Four call sites each had their own copy of
 * the anchor-and-revoke dance and two of them forgot the revoke; a signed URL
 * must be fetched rather than followed, so the file saves instead of opening in
 * a tab the client then has to find again.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeSecureFunction = vi.fn();
vi.mock('@/lib/secureInvoke', () => ({
  invokeSecureFunction: (...a: unknown[]) => invokeSecureFunction(...a),
}));

const { deliverSnapshot, snapshotBlob } = await import('../deliverSnapshot');

const REQUEST = { clientId: 'c-1', clientName: 'A. & J. Sample' };

/** What the in-browser generator returns. */
const legacyPdf = () => ({
  blob: new Blob(['%PDF-1.4 legacy'], { type: 'application/pdf' }),
  fileName: 'Borrowing_Capacity_Snapshot_A____J__Sample_2026-08-02.pdf',
});

let created: string[];
let revoked: string[];
let clicked: Array<{ href: string; download: string }>;

beforeEach(() => {
  invokeSecureFunction.mockReset();
  created = [];
  revoked = [];
  clicked = [];

  let n = 0;
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => {
      const url = `blob:made-${++n}`;
      created.push(url);
      return url;
    }),
    revokeObjectURL: vi.fn((url: string) => { revoked.push(url); }),
  });

  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    blob: async () => new Blob(['%PDF-1.7 server'], { type: 'application/pdf' }),
  })));

  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    const el = { href: '', download: '', click: vi.fn(), tagName: tag.toUpperCase() } as never;
    if (tag === 'a') {
      (el as { click: () => void }).click = () => {
        const a = el as unknown as { href: string; download: string };
        clicked.push({ href: a.href, download: a.download });
      };
    }
    return el;
  }) as never);
  vi.spyOn(document.body, 'appendChild').mockImplementation(((n: Node) => n) as never);
  vi.spyOn(document.body, 'removeChild').mockImplementation(((n: Node) => n) as never);
  vi.useFakeTimers();
});

const serverAnswer = (brandGaps: string[] = []) => ({
  data: {
    url: 'https://project.supabase.co/storage/v1/object/sign/client-files/x.pdf?token=t',
    fileName: 'Borrowing_Capacity_Snapshot_A____J__Sample_2026-08-02.pdf',
    bytes: 240_000,
    pageCount: 11,
    brandGaps,
  },
  error: null,
});

describe('choosing the legacy layout', () => {
  it('runs the in-browser generator and never asks the server', async () => {
    const legacy = vi.fn(async () => legacyPdf());

    const result = await deliverSnapshot({ variant: 'legacy', request: REQUEST, legacy });

    expect(legacy).toHaveBeenCalledTimes(1);
    expect(invokeSecureFunction).not.toHaveBeenCalled();
    expect(result.source).toBe('legacy');
    expect(result.brandGaps).toEqual([]);
  });

  it('saves the blob under the name the generator chose', async () => {
    await deliverSnapshot({ variant: 'legacy', request: REQUEST, legacy: async () => legacyPdf() });

    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe('Borrowing_Capacity_Snapshot_A____J__Sample_2026-08-02.pdf');
    expect(clicked[0].href).toBe(created[0]);
  });

  /** The leak two of the four call sites had. */
  it('revokes the object URL it made', async () => {
    await deliverSnapshot({ variant: 'legacy', request: REQUEST, legacy: async () => legacyPdf() });
    expect(revoked).toEqual([]);
    vi.advanceTimersByTime(1_100);
    expect(revoked).toEqual([created[0]]);
  });

  it('says so rather than saving nothing when the generator produces nothing', async () => {
    await expect(deliverSnapshot({
      variant: 'legacy', request: REQUEST, legacy: async () => undefined,
    })).rejects.toThrow(/produced no document/);
    expect(clicked).toHaveLength(0);
  });
});

describe('the server path', () => {
  it('fetches the signed URL and saves the bytes, rather than following the link', async () => {
    invokeSecureFunction.mockResolvedValue(serverAnswer());

    const result = await deliverSnapshot({
      variant: 'server', request: REQUEST, legacy: async () => legacyPdf(),
    });

    expect(fetch).toHaveBeenCalledWith(
      'https://project.supabase.co/storage/v1/object/sign/client-files/x.pdf?token=t',
    );
    // The anchor points at a blob we made, not at the signed URL.
    expect(clicked[0].href).toBe(created[0]);
    expect(result.source).toBe('server');
  });

  it('carries the brand gaps back so the caller can say them out loud', async () => {
    invokeSecureFunction.mockResolvedValue(serverAnswer(['no ABN — required on an Australian advisory document']));
    const result = await deliverSnapshot({
      variant: 'server', request: REQUEST, legacy: async () => legacyPdf(),
    });
    expect(result.brandGaps).toEqual(['no ABN — required on an Australian advisory document']);
  });

  it('surfaces a failed download rather than a silent no-op', async () => {
    invokeSecureFunction.mockResolvedValue(serverAnswer());
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, blob: async () => new Blob() })));

    await expect(deliverSnapshot({
      variant: 'server', request: REQUEST, legacy: async () => legacyPdf(),
    })).rejects.toThrow(/Download failed \(403\)/);
  });

  /**
   * The undeployed-function fallback still exists and is still narrow — see
   * `requestSnapshot.spec.ts`. What matters here is that when it fires, the
   * caller is told which renderer ran.
   */
  it('reports `legacy` when the route is not deployed', async () => {
    invokeSecureFunction.mockResolvedValue({ data: null, error: { message: 'Function not found' } });

    const result = await deliverSnapshot({
      variant: 'server', request: REQUEST, legacy: async () => legacyPdf(),
    });

    expect(result.source).toBe('legacy');
    expect(clicked).toHaveLength(1);
  });

  it('does not fall back on a real failure from a deployed route', async () => {
    const legacy = vi.fn(async () => legacyPdf());
    invokeSecureFunction.mockResolvedValue({
      data: null,
      error: { message: 'no borrowing capacity assessment for this client' },
    });

    await expect(deliverSnapshot({ variant: 'server', request: REQUEST, legacy }))
      .rejects.toThrow(/no borrowing capacity assessment/);
    expect(legacy).not.toHaveBeenCalled();
  });
});

describe('snapshotBlob — for the caller that uploads rather than downloads', () => {
  it('returns bytes and never touches the DOM', async () => {
    invokeSecureFunction.mockResolvedValue(serverAnswer());

    const result = await snapshotBlob({
      variant: 'server', request: REQUEST, legacy: async () => legacyPdf(),
    });

    expect(result.source).toBe('server');
    expect(result.blob).toBeInstanceOf(Blob);
    expect(clicked).toHaveLength(0);
  });

  it('hands back the legacy blob itself when the route is not deployed', async () => {
    invokeSecureFunction.mockResolvedValue({ data: null, error: { message: 'Failed to fetch' } });

    const result = await snapshotBlob({
      variant: 'server', request: REQUEST, legacy: async () => legacyPdf(),
    });

    expect(result.source).toBe('legacy');
    expect(await result.blob.text()).toContain('legacy');
    expect(clicked).toHaveLength(0);
  });

  it('runs only the generator when the legacy layout was chosen', async () => {
    const result = await snapshotBlob({
      variant: 'legacy', request: REQUEST, legacy: async () => legacyPdf(),
    });
    expect(invokeSecureFunction).not.toHaveBeenCalled();
    expect(result.source).toBe('legacy');
  });
});

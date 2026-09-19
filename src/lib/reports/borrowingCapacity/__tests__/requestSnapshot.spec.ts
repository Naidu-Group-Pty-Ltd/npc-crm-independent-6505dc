/**
 * Asking the server for the document.
 *
 * The interesting behaviour is the fallback, and specifically how narrow it is:
 * a route that is not deployed yet falls back to what shipped yesterday, and a
 * route that is deployed and failing does not. Getting that boundary wrong
 * would hide a broken render behind a document that looks fine.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeSecureFunction = vi.fn();
vi.mock('@/lib/secureInvoke', () => ({ invokeSecureFunction: (...a: unknown[]) => invokeSecureFunction(...a) }));

const { requestBorrowingCapacitySnapshot } = await import('../requestSnapshot');

const REQUEST = { clientId: 'c-1', clientName: 'A. & J. Sample' };
const legacy = vi.fn(async () => ({ url: 'blob:legacy', fileName: 'legacy.pdf', bytes: 1 }));

beforeEach(() => {
  invokeSecureFunction.mockReset();
  legacy.mockClear();
});

describe('the server path', () => {
  it('returns what the route produced', async () => {
    invokeSecureFunction.mockResolvedValue({
      data: {
        url: 'https://signed.example/report.pdf',
        fileName: 'Borrowing_Capacity_Snapshot_A____J__Sample_2026-08-01.pdf',
        bytes: 240_000,
        pageCount: 11,
        brandGaps: ['no ABN — required on an Australian advisory document'],
      },
      error: null,
    });

    const result = await requestBorrowingCapacitySnapshot(REQUEST, legacy);
    expect(result.source).toBe('server');
    expect(result.pageCount).toBe(11);
    expect(result.brandGaps).toHaveLength(1);
    expect(legacy).not.toHaveBeenCalled();
  });

  /** The client name is not sent: the server reads it from the `clients` row. */
  it('sends only what the server does not already know', async () => {
    invokeSecureFunction.mockResolvedValue({ data: { url: 'u', fileName: 'f' }, error: null });
    await requestBorrowingCapacitySnapshot({ ...REQUEST, scenarioPresets: [{ id: 's' }] });
    const [name, body] = invokeSecureFunction.mock.calls[0];
    expect(name).toBe('render-borrowing-capacity-pdf');
    expect(Object.keys(body as object).sort())
      .toEqual(['assessmentId', 'clientId', 'edition', 'scenarioPresets']);
  });
});

describe('the fallback', () => {
  it.each([
    ['a missing function', { status: 404, message: 'Requested function was not found' }],
    ['a function the gateway does not know', { message: 'Function not found' }],
    ['no network route to it', { message: 'Failed to send a request to the Edge Function' }],
  ])('uses the in-browser generator for %s, and says which it used', async (_label, error) => {
    invokeSecureFunction.mockResolvedValue({ data: null, error });
    const result = await requestBorrowingCapacitySnapshot(REQUEST, legacy);
    expect(result.source).toBe('legacy');
    expect(result.url).toBe('blob:legacy');
    expect(legacy).toHaveBeenCalledOnce();
  });

  /**
   * The boundary. A deployed function that fails is a real failure — falling
   * back on it would ship a client the old document and tell nobody the new
   * one broke.
   *
   * The last case is the one that decided how narrow the check is. The route
   * answers `404 not found` for a client the caller may not see, deliberately,
   * so it does not confirm whether that client exists. A rule that read "404
   * means not deployed" would hand that caller the legacy document for a client
   * they have no access to, generated in their own browser from data they were
   * refused. So a bare 404 is not enough: only a missing *function* counts.
   */
  it.each([
    ['a server error', { status: 500, message: 'WeasyPrint render failed (502)' }],
    ['no assessment', { status: 409, message: 'no borrowing capacity assessment for this client' }],
    ['a client the caller may not see', { status: 404, message: 'not found' }],
  ])('does not fall back on %s', async (_label, error) => {
    invokeSecureFunction.mockResolvedValue({ data: null, error });
    await expect(requestBorrowingCapacitySnapshot(REQUEST, legacy)).rejects.toThrow();
    expect(legacy).not.toHaveBeenCalled();
  });

  it('fails rather than silently producing nothing when there is no fallback', async () => {
    invokeSecureFunction.mockResolvedValue({ data: null, error: { message: 'Function not found' } });
    await expect(requestBorrowingCapacitySnapshot(REQUEST)).rejects.toThrow();
  });
});

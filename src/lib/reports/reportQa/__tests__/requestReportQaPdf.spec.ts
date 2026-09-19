/**
 * What the person who pressed "Typeset PDF (WeasyPrint)" is told.
 *
 * The route is deployed separately from the bundle that calls it, so "not
 * deployed here yet" is a live state rather than a hypothetical, and it is the
 * state this control was in for its whole life so far. What made that hard to
 * act on was the *message*: an absent function is a 404 from the Supabase
 * gateway rather than from the function, a gateway 404 carries no
 * `Access-Control-Allow-Origin`, so the browser refuses the response and the
 * caller sees `TypeError: Failed to fetch` — which `invokeSecureFunction`
 * rewrites into "Network/CORS error calling render-report-qa-pdf. Please check
 * the function deployment and auth/CORS configuration."
 *
 * `looksUndeployed` was matching on `failed to fetch`, a string that by then no
 * longer existed, so the one case it was written for fell through to the raw
 * network text and sent somebody looking at CORS configuration for a function
 * that had never been deployed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeSecureFunction = vi.fn();
vi.mock('@/lib/secureInvoke', () => ({ invokeSecureFunction }));

const { requestReportQaPdf } = await import('../requestReportQaPdf');

const UNDEPLOYED = /has not been deployed to this project/;

describe('requestReportQaPdf — the undeployed route', () => {
  beforeEach(() => invokeSecureFunction.mockReset());

  it('names the deployment when the call never reached a function', async () => {
    invokeSecureFunction.mockResolvedValue({
      data: null,
      error: {
        message: 'Network/CORS error calling render-report-qa-pdf. Please check the '
          + 'function deployment and auth/CORS configuration.',
        network: true,
        code: 'network_error',
        functionName: 'render-report-qa-pdf',
      },
    });

    await expect(requestReportQaPdf('conv-1', 'structured')).rejects.toThrow(UNDEPLOYED);
  });

  it('names the exports that still work', async () => {
    invokeSecureFunction.mockResolvedValue({
      data: null,
      error: { message: 'Failed to fetch', network: true, code: 'network_error' },
    });

    await expect(requestReportQaPdf('conv-1', 'transcript')).rejects.toThrow(/\.md \/ \.txt \/ \.csv \/ \.json/);
  });

  /**
   * A timed-out render is also a `network` failure and is the opposite of an
   * absent one — the route answered, slowly. The transcript subject runs to
   * twenty-nine pages through WeasyPrint, so this is not hypothetical either.
   */
  it('does not read a timeout as a missing function', async () => {
    invokeSecureFunction.mockResolvedValue({
      data: null,
      error: {
        message: 'Request timed out. Please try again.',
        network: true,
        code: 'provider_timeout',
      },
    });

    const failure = requestReportQaPdf('conv-1', 'transcript');
    await expect(failure).rejects.toThrow('Request timed out. Please try again.');
    await expect(failure).rejects.not.toThrow(UNDEPLOYED);
  });

  /**
   * The route answers 404 for a conversation that does not exist. Reading that
   * as "not deployed" would send someone to deploy a function that is already
   * there — which is why the check is not simply "the status was 404".
   */
  it('does not read the route’s own 404 as a missing function', async () => {
    invokeSecureFunction.mockResolvedValue({
      data: null,
      error: { message: 'Not found', status: 404, functionName: 'render-report-qa-pdf' },
    });

    await expect(requestReportQaPdf('conv-1', 'structured')).rejects.toThrow('Not found');
  });

  it('passes a successful render through', async () => {
    invokeSecureFunction.mockResolvedValue({
      data: {
        url: 'https://example.test/signed.pdf',
        fileName: 'Q_and_A.pdf',
        bytes: 2048,
        pageCount: 4,
        sections: ['Overview'],
        subject: 'structured',
        turnCount: 6,
        turnsShown: 6,
        truncated: false,
        generated: true,
        attachment: null,
      },
      error: null,
    });

    const result = await requestReportQaPdf('conv-1', 'structured', { generateIfMissing: true });

    expect(result.fileName).toBe('Q_and_A.pdf');
    expect(result.pageCount).toBe(4);
    expect(result.generated).toBe(true);
    expect(result.brandGaps).toEqual([]);
    expect(invokeSecureFunction).toHaveBeenCalledWith(
      'render-report-qa-pdf',
      expect.objectContaining({ conversationId: 'conv-1', subject: 'structured', generateIfMissing: true }),
      expect.objectContaining({ timeoutMs: 240_000 }),
    );
  });
});

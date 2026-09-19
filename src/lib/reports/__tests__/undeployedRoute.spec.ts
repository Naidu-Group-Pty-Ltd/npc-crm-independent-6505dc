/**
 * The predicate that decides whether a person gets a file or an error.
 *
 * ## The defect this guards against returning
 *
 * Three formats keep an in-browser generator behind their server route and
 * hand it in as `legacyFallback`. Whether it is ever called comes down to this
 * one predicate — and two of the three carried a copy that could not match the
 * message the transport actually produces when a function is absent.
 *
 * The mechanics are worth stating because they are not guessable from the call
 * site. A missing edge function is a 404 from the *gateway*, which carries no
 * `Access-Control-Allow-Origin`; the request is preflighted, so the browser
 * never surfaces the status or the body. `fetch` rejects, and
 * `invokeSecureFunction` rewrites the rejection into "Network/CORS error
 * calling …". Matching on `failed to fetch` therefore missed the only case the
 * fallback existed for, and the adviser got a red toast and no document from a
 * button that had a working generator sitting behind it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { looksUndeployed } from '../undeployedRoute';

/** Verbatim from `secureInvoke.ts` — the string it builds for a dead route. */
const TRANSPORT_NETWORK_ERROR = {
  message: 'Network/CORS error calling render-cash-flow-pdf. Please check the function '
    + 'deployment and auth/CORS configuration.',
  network: true,
  code: 'network_error',
};

describe('the undeployed-route predicate', () => {
  it('recognises the message the transport really produces', () => {
    // The whole defect in one assertion. Every substring arm the stale copies
    // carried returns false against this, which is why the fallback never ran.
    expect(looksUndeployed(TRANSPORT_NETWORK_ERROR)).toBe(true);
    const stale = ['function not found', 'requested function', 'does not exist',
      'failed to fetch', 'failed to send a request'];
    const lower = TRANSPORT_NETWORK_ERROR.message.toLowerCase();
    expect(stale.some((s) => lower.includes(s)),
      'a substring arm now matches — the network arm is no longer load-bearing').toBe(false);
  });

  it('recognises a transport failure whatever the browser called it', () => {
    // Chrome's wording is the one `invokeSecureFunction` rewrites. Firefox and
    // Safari reject with their own, which no substring arm ever matched — so
    // the `failed to fetch` arm was dead on every browser, not just some.
    for (const message of [
      'Failed to fetch',
      'NetworkError when attempting to fetch resource.',
      'Load failed',
    ]) {
      expect(looksUndeployed({ message, network: true, code: 'network_error' }),
        `${message} is not recognised`).toBe(true);
    }
  });

  it('does NOT treat a timeout as an absent function', () => {
    // A timeout is also `network: true`, and it means the opposite: the route
    // exists, answered slowly, and may well have finished. Handing over the
    // legacy document here would swap one document for a different one after a
    // successful render.
    expect(looksUndeployed({
      message: 'Request timed out. Please try again.',
      network: true,
      code: 'provider_timeout',
    })).toBe(false);
  });

  it('does NOT treat the route’s own 404 as an absent function', () => {
    // These routes answer 404 for a record the caller may not see, deliberately,
    // so they do not confirm whether it exists. Reading that as "not deployed"
    // would hand someone the legacy document for a record they cannot access.
    expect(looksUndeployed({ message: 'not found', status: 404 })).toBe(false);
    expect(looksUndeployed({ message: 'Forbidden', status: 403 })).toBe(false);
    expect(looksUndeployed(null)).toBe(false);
    expect(looksUndeployed(undefined)).toBe(false);
  });

  it('still recognises a function that says so in words', () => {
    for (const message of ['Function not found', 'Requested function was not found']) {
      expect(looksUndeployed({ message })).toBe(true);
    }
  });
});

describe('there is one copy of it', () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return p.endsWith('.ts') && !p.includes('__tests__') ? [p] : [];
  });

  it('no format hand-rolls the predicate', () => {
    // Two of the three copies were stale for months, in the same way, because
    // the fix was applied to one file rather than to the rule. A fourth copy
    // would go stale the same way.
    const offenders = walk(join(__dirname, '..'))
      .filter((f) => !f.endsWith('undeployedRoute.ts'))
      .filter((f) => /function\s+looksUndeployed/.test(readFileSync(f, 'utf8')));
    expect(offenders, 'declare it once, in undeployedRoute.ts').toEqual([]);
  });

  it('every format that asks the question uses it', () => {
    // Nine, not three. The audit found two stale copies; the repo-wide scan
    // above found six more, all identical, all missing the network arm.
    for (const rel of [
      'cashFlow/requestCashFlowPdf.ts',
      'borrowingCapacity/requestSnapshot.ts',
      'reportQa/requestReportQaPdf.ts',
      'cashFlowComparison/requestCashFlowComparisonPdf.ts',
      'clientDetails/requestClientDetailsPdf.ts',
      'converted/requestTemplateConversion.ts',
      'marketIntelligence/requestMarketIntelligencePdf.ts',
      'portfolio/requestPortfolioReview.ts',
      'propertyComparison/requestComparisonPdf.ts',
    ]) {
      const src = readFileSync(join(__dirname, '..', rel), 'utf8');
      expect(src, `${rel} no longer imports the shared predicate`)
        .toContain("from '../undeployedRoute'");
    }
  });
});

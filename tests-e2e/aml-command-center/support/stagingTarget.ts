import type { Page, Request } from '@playwright/test';

/**
 * Shared support for the AML browser journeys.
 *
 * Both specs run the SPA served locally (`vite --host 127.0.0.1 --port 8080`)
 * with `vite-staging-target.ts` active, so every Supabase literal in the bundle
 * points at the **non-production** preview branch. Nothing here may reference a
 * production host, and `assertNoProductionCalls` fails the test if the browser
 * makes one.
 */

/** The production project. Contacting it from these tests is a test failure. */
export const PRODUCTION_HOST = 'dduzbchuswwbefdunfct.supabase.co';

export const STAGING_REF = 'yncczbrmicjebjepfave';
export const STAGING_ORIGIN = `https://${STAGING_REF}.supabase.co`;

/** Synthetic fixtures seeded on the preview branch. No real customer data. */
export const SYNTHETIC = {
  linkedSessionToken: 'SYNTH-TOKEN-LINKED',
  noCaseSessionToken: 'SYNTH-TOKEN-NOCASE',
  revokedSessionToken: 'SYNTH-TOKEN-REVOKED',
  linkedUserId: '11111111-1111-4111-8111-111111111111',
  linkedClientId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  linkedEmail: 'synthetic.linked@example.test',
  noCaseUserId: '22222222-2222-4222-8222-222222222222',
  noCaseClientId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  noCaseEmail: 'synthetic.nocase@example.test',
  revokedUserId: '33333333-3333-4333-8333-333333333333',
  revokedClientId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  revokedEmail: 'synthetic.revoked@example.test',
  caseId: '99999999-9999-4999-8999-999999999999',
  caseReference: 'AML-STG-00001',
  crossClientCaseId: '88888888-8888-4888-8888-888888888888',
} as const;

/**
 * Browser options these specs need in this sandbox.
 *
 * Outbound HTTPS goes through the agent proxy, so Chromium must be told about
 * it or every staging call fails with ERR_CONNECTION_RESET; the locally served
 * SPA is bypassed. The proxy resets TLS 1.3 handshakes, hence the version cap.
 * Both are environment facts, not product behaviour — a normal checkout with
 * direct egress needs neither (PW_PROXY_SERVER unset leaves proxy undefined).
 */
export const BROWSER_USE = {
  proxy: process.env.PW_PROXY_SERVER || process.env.HTTPS_PROXY
    ? {
        server: (process.env.PW_PROXY_SERVER || process.env.HTTPS_PROXY)!,
        bypass: '127.0.0.1,localhost',
      }
    : undefined,
  launchOptions: {
    executablePath: process.env.PW_CHROMIUM_PATH || '/opt/pw-browsers/chromium',
    args: ['--ssl-version-max=tls1.2'],
  },
} as const;

/** The four viewports every surface is checked at. */
export const VIEWPORTS = [
  { name: 'mobile-360x800', width: 360, height: 800 },
  { name: 'tablet-768x1024', width: 768, height: 1024 },
  { name: 'laptop-1440x900', width: 1440, height: 900 },
  { name: 'desktop-1728x864', width: 1728, height: 864 },
] as const;

/**
 * Records every request the page makes and fails if any reaches production.
 * Call `check()` after the journey; it throws with the offending URLs.
 */
export function assertNoProductionCalls(page: Page) {
  const offenders: string[] = [];
  const seen = new Set<string>();
  page.on('request', (request: Request) => {
    const url = request.url();
    seen.add(new URL(url).host);
    if (url.includes(PRODUCTION_HOST)) offenders.push(url);
  });
  return {
    hosts: () => [...seen].sort(),
    check: () => {
      if (offenders.length) {
        throw new Error(
          `Production network calls detected (must be none):\n${offenders.join('\n')}`,
        );
      }
    },
  };
}

/**
 * Collects uncaught page errors and console errors. A rendered surface that
 * throws is a defect even when the visible output looks plausible, so the
 * specs assert this is empty rather than only eyeballing the screenshot.
 * Known-noisy platform chatter that is not the surface under test is filtered.
 */
const CONSOLE_NOISE = [
  'React Router Future Flag Warning',
  'Failed to load resource',
  'WebSocket connection to',
  'net::ERR_',
  'Subscription status',
  'realtime',
];

export function collectPageErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (CONSOLE_NOISE.some((n) => text.includes(n))) return;
    errors.push(`console.error: ${text}`);
  });
  return { errors, snapshot: () => [...errors] };
}

/**
 * Portal shell chrome only. **No portal session is fulfilled locally.**
 *
 * This used to fulfil `client-portal-verify` because that function was not
 * deployed on the branch — its session select embeds `clients:client_id`, and
 * the branch carried neither the `clients` table nor the foreign key PostgREST
 * needs to resolve the embed. Both are now materialised from the repository's
 * own DDL and the function is deployed, so the bootstrap is a real call to the
 * real backend: a live token returns `valid: true` with the client's name, and a
 * revoked one returns a real 401. Nothing about the session is faked any more.
 *
 * What remains here is unrelated portal widgets whose tables are absent from the
 * branch; they are answered empty so a 404 cascade cannot mask an AML assertion.
 * Nothing matching `aml-` is ever intercepted.
 */
export async function stubPortalShellSession(
  page: Page,
  _who: 'linked' | 'noCase' | 'revoked',
) {
  for (const fn of ['client-portal-notifications', 'client-portal-data', 'client-portal-dashboard']) {
    await page.route(`**/functions/v1/${fn}`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
    );
  }
}

export function tokenFor(who: 'linked' | 'noCase' | 'revoked'): string {
  return who === 'linked'
    ? SYNTHETIC.linkedSessionToken
    : who === 'noCase'
      ? SYNTHETIC.noCaseSessionToken
      : SYNTHETIC.revokedSessionToken;
}

/** Seeds the portal session token the SPA reads on boot. */
export async function seedPortalSession(page: Page, who: 'linked' | 'noCase' | 'revoked') {
  const token = tokenFor(who);
  await page.addInitScript((value) => {
    try { window.localStorage.setItem('portal_session_token', value); } catch { /* ignore */ }
    try { window.sessionStorage.setItem('portal_session_token', value); } catch { /* ignore */ }
  }, token);
}

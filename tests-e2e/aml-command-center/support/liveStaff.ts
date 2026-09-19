import type { Page, Request, Response } from '@playwright/test';
import { STAGING_ORIGIN, STAGING_REF } from './stagingTarget';

/**
 * Support for the **unfixtured** staff journey.
 *
 * `staffWorkspace.e2e.ts` stubs the `aml-*` boundary so it can drive states that
 * do not exist in staging data (a check stranded in `technical_failure`, a
 * four-up grid at 360px). That suite is a component-level check and says so.
 *
 * This file is the opposite and exists so the integration claim can be made
 * honestly: **nothing under `functions/v1/aml-*` is intercepted.** Every AML
 * request leaves the browser, reaches the real Edge Functions deployed on the
 * non-production branch, and is answered from real rows in that database.
 * `assertRealAmlTraffic` fails the test if that did not actually happen, so the
 * suite cannot silently degrade into a fixture run.
 *
 * ## What is still injected, and why that is not an AML fixture
 *
 * 1. **The staff session cookie.** `__Host-session_token` is minted by the
 *    login function against a bcrypt hash. The synthetic staff users carry an
 *    unusable placeholder hash on purpose — a real credential must not exist in
 *    a test fixture — so the cookie is injected instead of logged in for. The
 *    session it names is a real row in `public.user_sessions`, and every server
 *    call still verifies it: `custom-auth-verify-v2` resolves the user from it,
 *    `aml-access` resolves the roles from `aml.role_assignments`, and
 *    `aml-cases` refuses it outright if the row is missing, revoked or expired.
 *    Password login is therefore NOT covered here and is not claimed to be.
 *
 * 2. **Command Centre chrome** (notifications, mission-control, whitelabel…).
 *    Those functions are not deployed on the branch, and a 404 cascade trips
 *    the shell's auth circuit breaker and floods the console, which would mask
 *    the AML assertions. `stubShellChrome` refuses to stub anything matching
 *    `aml-`, so this list can never quietly grow to cover the surface
 *    under test.
 */

/** Synthetic staff identities seeded on the branch. No real person. */
export const STAFF = {
  mlro: {
    token: 'e2e-synthetic-staff-mlro',
    userId: 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1',
    username: 'synthetic.mlro',
    role: 'admin',
    amlRoles: ['mlro'],
    canWrite: true,
  },
  readonly: {
    token: 'e2e-synthetic-staff-readonly',
    userId: 'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2',
    username: 'synthetic.readonly',
    role: 'user',
    amlRoles: ['auditor'],
    canWrite: false,
  },
} as const;

export type StaffWho = keyof typeof STAFF;

/** Real rows on the branch, asserted against rather than stubbed. */
export const LIVE = {
  caseReference: 'AML-STG-00001',
  caseId: '99999999-9999-4999-8999-999999999999',
  secondCaseReference: 'AML-STG-00002',
} as const;

/**
 * Put the browser in the state a completed staff login leaves behind: the
 * `__Host-session_token` cookie on the Supabase origin, plus the client-side
 * session mirror the shell reads synchronously on first paint. The cookie is
 * the only part the server trusts.
 */
export async function installStaffSession(page: Page, who: StaffWho): Promise<void> {
  const staff = STAFF[who];

  await page.context().addCookies([
    {
      name: '__Host-session_token',
      value: staff.token,
      url: STAGING_ORIGIN, // host-only + path=/ , as the __Host- prefix requires
      httpOnly: true,
      secure: true,
      sameSite: 'None',
    },
  ]);

  await page.addInitScript(
    ({ userId, username, role }) => {
      try {
        sessionStorage.setItem('current_user', JSON.stringify({ id: userId, username, role }));
        localStorage.setItem('auth_version', '5');
      } catch {
        /* ignore */
      }
    },
    { userId: staff.userId, username: staff.username, role: staff.role },
  );
}

/** Chrome that is not the surface under test. Never AML. */
const SHELL_FUNCTIONS = [
  'notifications-feed-v2',
  'notifications-feed',
  'mission-control-balance',
  'mission-control-plan-change',
  'mission-control-feedback-prompt',
  'admin-user-management',
  'user-permissions',
  'get-whitelabel-settings',
  'get-investment-reports',
  'internal-messaging',
  'get-portal-client-data',
] as const;

export async function stubShellChrome(page: Page): Promise<void> {
  for (const fn of SHELL_FUNCTIONS) {
    if (fn.includes('aml')) {
      // A guard, not a formality: the whole point of this file is that no AML
      // endpoint is intercepted. If someone adds one here, fail loudly.
      throw new Error(`stubShellChrome refuses to stub an AML endpoint: ${fn}`);
    }
  }
  await page.route('**/functions/v1/notifications-feed-v2', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, notifications: [], unread_count: 0 }) }),
  );
  await page.route('**/functions/v1/admin-user-management', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, permissions: [] }) }),
  );
  for (const fn of SHELL_FUNCTIONS) {
    if (fn === 'notifications-feed-v2' || fn === 'admin-user-management') continue;
    await page.route(`**/functions/v1/${fn}`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
    );
  }
}

export interface AmlTraffic {
  /** Throws unless the named functions were really called and really answered. */
  check(expected: { function: string; status?: number }[]): void;
  seen(): { url: string; status: number }[];
}

/**
 * Record every response from the staging Edge Function boundary so the suite can
 * prove the AML calls were served by the deployed backend, not by a route
 * handler. A fulfilled route never produces a network response with a real
 * status from the staging host, so this cannot be satisfied by a fixture.
 */
export function assertRealAmlTraffic(page: Page): AmlTraffic {
  const responses: { url: string; status: number }[] = [];
  page.on('response', (response: Response) => {
    const url = response.url();
    if (url.includes(`${STAGING_REF}.supabase.co/functions/v1/`)) {
      responses.push({ url, status: response.status() });
    }
  });
  page.on('requestfailed', (request: Request) => {
    const url = request.url();
    if (url.includes('/functions/v1/aml-')) responses.push({ url, status: -1 });
  });

  return {
    seen: () => responses.slice(),
    check(expected) {
      const problems: string[] = [];
      for (const want of expected) {
        const hits = responses.filter((r) => r.url.includes(`/functions/v1/${want.function}`));
        if (hits.length === 0) {
          problems.push(
            `${want.function}: the browser never reached the deployed function. `
            + `Either the journey did not exercise it or something intercepted it — `
            + `in which case this is not an unfixtured run.`,
          );
          continue;
        }
        if (want.status !== undefined && !hits.some((h) => h.status === want.status)) {
          problems.push(
            `${want.function}: expected a real ${want.status} from the deployed function, saw ${hits.map((h) => h.status).join(', ')}`,
          );
        }
      }
      if (problems.length) {
        throw new Error(
          `Unfixtured AML traffic assertion failed:\n - ${problems.join('\n - ')}\n\n`
          + `Observed staging function responses:\n${responses.map((r) => `   ${r.status}  ${r.url}`).join('\n') || '   (none)'}`,
        );
      }
    },
  };
}

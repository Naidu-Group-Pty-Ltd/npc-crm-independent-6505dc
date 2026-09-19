import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import {
  BROWSER_USE,
  STAGING_REF,
  VIEWPORTS,
  assertNoProductionCalls,
  collectPageErrors,
} from './support/stagingTarget';
import {
  LIVE,
  STAFF,
  assertRealAmlTraffic,
  installStaffSession,
  stubShellChrome,
} from './support/liveStaff';

/**
 * Staff Command Centre journey with **no AML fixtures at all**.
 *
 * `staffWorkspace.e2e.ts` stubs the `aml-*` boundary so it can drive states that
 * staging data does not contain. This suite intercepts nothing under
 * `functions/v1/aml-*`: every AML call leaves the browser, is served by the real
 * Edge Functions deployed to the non-production branch, and is answered from
 * real rows. `assertRealAmlTraffic` fails the test if that did not happen, so
 * the suite cannot decay into a fixture run without going red.
 *
 * Deployed and exercised for real here: `custom-auth-verify-v2` (resolves the
 * staff user from the session cookie), `aml-access` (resolves AML roles from
 * `aml.role_assignments`), `aml-cases`, `aml-verification`, `aml-risk`.
 *
 * Not covered, and not claimed: password login. The synthetic staff users hold a
 * deliberately unusable password hash, so the session cookie is injected. The
 * session it names is a real row and every server call verifies it.
 *
 *   npx vite --mode staging --host 127.0.0.1 --port 8080 &
 *   AML_E2E=1 npx playwright test tests-e2e/aml-command-center/staffWorkspaceLive.e2e.ts
 */

/**
 * The SPA must be reached on `http://localhost:8080`, not `http://127.0.0.1:8080`.
 *
 * The deployed functions build their CORS allow-list with `createCorsHeaders`,
 * whose local entries are `http://localhost:5173` and `http://localhost:8080`.
 * `127.0.0.1` is not among them, so a browser on that origin has its bootstrap
 * response rejected and the portal falls back to the sign-in page. That was
 * invisible while `client-portal-verify` was fulfilled locally — removing the
 * stub is what surfaced it. Vite still binds 127.0.0.1; only the origin the
 * browser uses matters.
 */
const BASE = process.env.AML_E2E_BASE_URL || 'http://localhost:8080';
const SHOTS = process.env.AML_E2E_ARTIFACTS || 'test-results/aml-browser-evidence';

test.skip(!process.env.AML_E2E, 'set AML_E2E=1 with the local SPA served against the staging branch');
test.use(BROWSER_USE);
mkdirSync(SHOTS, { recursive: true });

async function shot(page: import('@playwright/test').Page, name: string) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

test('the AML case list is served by the deployed backend, not a fixture', async ({ page }) => {
  const net = assertNoProductionCalls(page);
  const aml = assertRealAmlTraffic(page);
  await stubShellChrome(page);
  await installStaffSession(page, 'mlro');

  await page.goto(`${BASE}/admin/aml/cases`);
  // The reference appears both in its own column and in the subject subtitle, so
  // match the row's navigation link — unique, and it proves the row is openable.
  await expect(page.getByRole('link', { name: new RegExp(`Open case ${LIVE.caseReference}`) }))
    .toBeVisible({ timeout: 30_000 });

  // The seeded branch holds two cases; both must come back from the real query.
  await expect(page.getByRole('link', { name: new RegExp(`Open case ${LIVE.secondCaseReference}`) }))
    .toBeVisible();

  // Proof of provenance: real 200s from the deployed functions.
  aml.check([
    { function: 'custom-auth-verify-v2', status: 200 },
    { function: 'aml-access', status: 200 },
    { function: 'aml-cases', status: 200 },
  ]);
  expect(await page.evaluate(() => (window as any).__SUPABASE_TARGET__?.ref)).toBe(STAGING_REF);
  net.check();
  await shot(page, 'live-staff-cases-list');
});

test('an MLRO opens a real case and the workspace renders its real state', async ({ page }) => {
  const net = assertNoProductionCalls(page);
  const aml = assertRealAmlTraffic(page);
  const errors = collectPageErrors(page);
  await stubShellChrome(page);
  await installStaffSession(page, 'mlro');

  await page.goto(`${BASE}/admin/aml/cases/${LIVE.caseId}`);
  await expect(page.getByText(LIVE.caseReference).first()).toBeVisible({ timeout: 30_000 });

  // Never the placeholder the workspace used to render for absent timestamps.
  await expect(page.getByText('Invalid Date')).toHaveCount(0);
  // Never the API status line the portal used to leak (DEF-B1's sibling).
  await expect(page.getByText('No AML onboarding case yet.')).toHaveCount(0);

  aml.check([{ function: 'aml-cases', status: 200 }]);
  net.check();

  // Two console errors on this branch are caused by a secret this session cannot
  // set, not by the code under test. There is no tool to write Edge Function
  // secrets here (no SUPABASE_ACCESS_TOKEN, no CLI), so JWT_SECRET /
  // SUPABASE_JWT_SECRET is unset and custom-auth-verify-v2 returns
  // `access_token: null, jwt_unavailable: true`. The shell says so itself in the
  // first message, and the second is downstream of it: aml-tenant is refused
  // because the browser holds no RLS token.
  //
  // They are allowed HERE and nowhere else, matched narrowly, so any other AML
  // console error still fails this test. Neither is evidence that aml-tenant
  // behaves correctly once the secret IS set — that remains unverified, and is
  // recorded as such rather than claimed as passing.
  const ENVIRONMENTAL = [
    'Signed in without an RLS access token',
    '{functionName: aml-tenant, status: 403',
  ];
  const unexplained = errors
    .snapshot()
    .filter((message) => !ENVIRONMENTAL.some((known) => message.includes(known)));
  expect(unexplained, 'console errors not attributable to the missing JWT_SECRET').toEqual([]);
  await shot(page, 'live-staff-case-workspace');
});

test('AML roles come from the database, so a read-only auditor gets no write controls', async ({ page }) => {
  const net = assertNoProductionCalls(page);
  const aml = assertRealAmlTraffic(page);
  await stubShellChrome(page);
  await installStaffSession(page, 'readonly');

  await page.goto(`${BASE}/admin/aml/cases/${LIVE.caseId}`);
  await expect(page.getByText(LIVE.caseReference).first()).toBeVisible({ timeout: 30_000 });

  // aml-access answered from aml.role_assignments: auditor ⇒ canWrite false.
  const access = aml.seen().filter((r) => r.url.includes('/aml-access'));
  expect(access.some((r) => r.status === 200)).toBe(true);

  // Whatever the workspace offers an auditor, it must not offer adjudication.
  for (const label of [/^Approve$/, /^Adjudicate/, /^Record decision/]) {
    await expect(page.getByRole('button', { name: label })).toHaveCount(0);
  }
  net.check();
  await shot(page, 'live-staff-readonly-no-write-controls');
});

test('a revoked staff session is refused by the real backend', async ({ page }) => {
  const aml = assertRealAmlTraffic(page);
  await stubShellChrome(page);
  await installStaffSession(page, 'mlro');
  // Replace the cookie with one that names no session row at all.
  await page.context().clearCookies();
  await page.context().addCookies([
    {
      name: '__Host-session_token',
      value: 'e2e-synthetic-staff-not-a-session',
      url: `https://${STAGING_REF}.supabase.co`,
      httpOnly: true,
      secure: true,
      sameSite: 'None',
    },
  ]);

  await page.goto(`${BASE}/admin/aml/cases`);
  // No real case may render for a session that does not exist.
  await expect(page.getByRole('link', { name: new RegExp(`Open case ${LIVE.caseReference}`) }))
    .toHaveCount(0, { timeout: 20_000 });

  // The refusal is served by the real backend. The shell resolves the staff
  // identity first, so an unknown cookie is rejected at custom-auth-verify-v2
  // and no AML call is ever issued — a stronger outcome than an AML 401, and the
  // reason this asserts on either rather than on aml-* alone.
  const seen = aml.seen();
  const authRefused = seen.some(
    (r) => r.url.includes('/custom-auth-verify-v2') && r.status !== 200,
  );
  const amlRefused = seen.some(
    (r) => r.url.includes('/functions/v1/aml-') && (r.status === 401 || r.status === 403),
  );
  const amlSucceeded = seen.some(
    (r) => r.url.includes('/functions/v1/aml-') && r.status === 200,
  );
  expect(amlSucceeded, 'an unknown session was served real AML data').toBe(false);
  expect(
    authRefused || amlRefused || seen.every((r) => !r.url.includes('/functions/v1/aml-')),
    `expected the backend to refuse an unknown session; saw ${JSON.stringify(seen)}`,
  ).toBe(true);
  await shot(page, 'live-staff-revoked-session-refused');
});

for (const viewport of VIEWPORTS) {
  test(`the live case workspace is usable and unclipped at ${viewport.name}`, async ({ page }) => {
    const net = assertNoProductionCalls(page);
    const aml = assertRealAmlTraffic(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await stubShellChrome(page);
    await installStaffSession(page, 'mlro');

    await page.goto(`${BASE}/admin/aml/cases/${LIVE.caseId}`);
    await expect(page.getByText(LIVE.caseReference).first()).toBeVisible({ timeout: 30_000 });

    // Nothing may overflow the viewport horizontally.
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `horizontal overflow at ${viewport.name}`).toBeLessThanOrEqual(1);

    // Every icon-only control keeps an accessible name at every width.
    const unnamed = await page.evaluate(() => {
      const out: string[] = [];
      document.querySelectorAll('button, a[role="button"]').forEach((el) => {
        const text = (el.textContent || '').trim();
        const label = el.getAttribute('aria-label') || el.getAttribute('title');
        if (!text && !label) out.push(el.outerHTML.slice(0, 90));
      });
      return out;
    });
    expect(unnamed, `unnamed controls at ${viewport.name}`).toEqual([]);

    aml.check([{ function: 'aml-cases', status: 200 }]);
    net.check();
    await shot(page, `live-staff-workspace-${viewport.name}`);
  });
}

test('this suite really is unfixtured: the AML boundary is never intercepted', async ({ page }) => {
  const aml = assertRealAmlTraffic(page);
  await stubShellChrome(page);
  await installStaffSession(page, 'mlro');
  await page.goto(`${BASE}/admin/aml/cases`);
  await expect(page.getByRole('link', { name: new RegExp(`Open case ${LIVE.caseReference}`) }))
    .toBeVisible({ timeout: 30_000 });

  // A fulfilled route produces no staging-host response, so an AML endpoint that
  // appears here with a real status cannot have been stubbed.
  const amlHits = aml.seen().filter((r) => r.url.includes('/functions/v1/aml-'));
  expect(amlHits.length, 'no AML call reached the deployed backend').toBeGreaterThan(0);
  expect(amlHits.every((r) => r.status > 0), 'an AML request failed at the network layer').toBe(true);
  expect(
    amlHits.filter((r) => r.status === 200).length,
    'no AML call was answered successfully by the deployed backend',
  ).toBeGreaterThan(0);
  expect(STAFF.mlro.canWrite).toBe(true);
});

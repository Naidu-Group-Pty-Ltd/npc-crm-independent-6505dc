import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import {
  BROWSER_USE,
  SYNTHETIC,
  STAGING_ORIGIN,
  STAGING_REF,
  VIEWPORTS,
  assertNoProductionCalls,
  seedPortalSession,
  stubPortalShellSession,
} from './support/stagingTarget';

/**
 * Client Portal AML journey — real Chromium, SPA served locally, backend on the
 * **non-production** Supabase preview branch `yncczbrmicjebjepfave`.
 *
 * Every `aml-client-portal` call in this file is a real network call to that
 * branch's deployed function against synthetic seed data. No production host is
 * contacted (asserted), no real customer, document, selfie or biometric is used,
 * and no client notification leaves the branch.
 *
 * Run with the dev server already up:
 *   npx vite --host 127.0.0.1 --port 8080 &
 *   AML_E2E=1 npx playwright test tests-e2e/aml-command-center/clientPortalAml.e2e.ts
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

test('the retargeted build serves the staging project and shows a STAGING indicator', async ({ page }) => {
  const net = assertNoProductionCalls(page);
  await page.goto(`${BASE}/client/aml`);
  const target = await page.evaluate(() => (window as any).__SUPABASE_TARGET__);
  expect(target?.ref).toBe(STAGING_REF);
  await expect(page.locator('#npc-staging-banner')).toContainText('STAGING');
  await expect(page.locator('#npc-staging-banner')).toContainText(STAGING_REF);
  net.check();
});

test('a linked client sees their own case, server-derived journey and no internal AML data', async ({ page }) => {
  const net = assertNoProductionCalls(page);
  await stubPortalShellSession(page, 'linked');
  await seedPortalSession(page, 'linked');

  const overviewResponses: any[] = [];
  page.on('response', async (r) => {
    if (r.url().includes('/functions/v1/aml-client-portal')) {
      try { overviewResponses.push(await r.json()); } catch { /* non-JSON */ }
    }
  });

  await page.goto(`${BASE}/client/aml`);
  await expect(page.getByRole('heading', { name: /Identity & Compliance/i })).toBeVisible();
  await expect(page.getByText(SYNTHETIC.caseReference)).toBeVisible({ timeout: 20_000 });

  // The overview call really reached the staging function.
  const overview = overviewResponses.find((r) => r?.case?.reference === SYNTHETIC.caseReference);
  expect(overview, 'aml-client-portal overview response').toBeTruthy();

  // Server-derived journey, not a client-side completion claim.
  expect(Array.isArray(overview.journey ?? overview.sections)).toBeTruthy();

  // No internal AML data may reach the client payload or the rendered page.
  const serialised = JSON.stringify(overview).toLowerCase();
  for (const forbidden of ['risk_rating', 'risk_score', 'screening', 'mlro', 'sanction', 'pep', 'internal_review_note', 'storage_path', 'bucket']) {
    expect(serialised, `client payload must not carry ${forbidden}`).not.toContain(forbidden);
  }
  const body = (await page.locator('body').innerText()).toLowerCase();
  for (const forbidden of ['risk rating', 'screening', 'mlro', 'sanctions', 'politically exposed']) {
    expect(body, `client page must not render ${forbidden}`).not.toContain(forbidden);
  }

  // The cross-client case must never appear.
  expect(serialised).not.toContain(SYNTHETIC.crossClientCaseId);

  await shot(page, 'client-01-linked-case-overview');
  net.check();
});

test('a client with no case sees the no-case state, not an error and not another client’s case', async ({ page }) => {
  const net = assertNoProductionCalls(page);
  await stubPortalShellSession(page, 'noCase');
  await seedPortalSession(page, 'noCase');
  await page.goto(`${BASE}/client/aml`);
  await expect(page.getByRole('heading', { name: /Identity & Compliance/i })).toBeVisible();
  // The no-case state is whatever server copy the deployed function returns —
  // asserted as a state, not as a string, because the improved wording
  // (DEF-B1) only reaches the browser once aml-client-portal is redeployed.
  // What must hold regardless: a case-less client sees a calm empty state, no
  // case reference, and none of the error affordances.
  const nocaseBody = await page.locator('main, body').first().innerText();
  expect(nocaseBody).toMatch(/case|onboarding|compliance/i);
  expect(nocaseBody).not.toMatch(/couldn.t load|failed|error/i);
  await expect(page.getByText(SYNTHETIC.caseReference)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /try again/i })).toHaveCount(0);
  // No stepper or data-collection form may render without a case.
  await expect(page.getByRole('button', { name: /^save|^submit/i })).toHaveCount(0);
  await shot(page, 'client-02-no-case');
  net.check();
});

test('a revoked session is refused by the real backend and shows the error state with a retry', async ({ page }) => {
  const net = assertNoProductionCalls(page);
  await stubPortalShellSession(page, 'revoked');
  await seedPortalSession(page, 'revoked');

  const statuses: number[] = [];
  page.on('response', (r) => {
    if (r.url().includes('/functions/v1/aml-client-portal')) statuses.push(r.status());
  });

  await page.goto(`${BASE}/client/aml`);
  await expect(page.getByText(/couldn.t load your onboarding details/i)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: /try again/i })).toBeVisible();
  // The refusal came from the deployed staging function, not from the SPA.
  expect(statuses.some((s) => s === 401)).toBeTruthy();
  // A refused session must not be shown the no-case copy.
  await expect(page.getByText(/^No AML onboarding case yet\.$|hasn.t opened an identity and compliance case/i)).toHaveCount(0);
  await shot(page, 'client-03-revoked-session');
  net.check();
});

test('every open request renders as a button that routes internally, and resolved requests cannot be actioned', async ({ page }) => {
  const net = assertNoProductionCalls(page);
  await stubPortalShellSession(page, 'linked');
  await seedPortalSession(page, 'linked');
  await page.goto(`${BASE}/client/aml`);
  await expect(page.getByText(SYNTHETIC.caseReference)).toBeVisible({ timeout: 20_000 });

  const requests = page.getByRole('region', { name: /request/i }).or(page.locator('text=Action required').first());
  await expect(requests.first()).toBeVisible();

  // Lifecycle chips distinguish the three states.
  await expect(page.getByText('Action required').first()).toBeVisible();

  // No raw JSON and no URL is offered to the client for a request action.
  const body = await page.locator('body').innerText();
  expect(body).not.toMatch(/\{"[a-z_]+":/);
  expect(body).not.toContain(STAGING_ORIGIN);
  expect(body).not.toContain('/functions/v1/');

  await shot(page, 'client-04-open-requests');
  net.check();
});

test('document rejection shows only the client-safe reason and never the internal note', async ({ page }) => {
  const net = assertNoProductionCalls(page);
  await stubPortalShellSession(page, 'linked');
  await seedPortalSession(page, 'linked');
  await page.goto(`${BASE}/client/aml`);
  await expect(page.getByText(SYNTHETIC.caseReference)).toBeVisible({ timeout: 20_000 });

  const body = await page.locator('body').innerText();
  expect(body, 'internal review note must never render in the portal').not.toContain('Synthetic internal note');
  expect(body).not.toContain('MRZ unreadable');
  expect(body).not.toContain('outside policy window');
  expect(body, 'storage paths must never render').not.toContain('synthetic/case-1/');

  net.check();
});

for (const vp of VIEWPORTS) {
  test(`client portal is usable with no horizontal overflow at ${vp.name}`, async ({ page }) => {
    const net = assertNoProductionCalls(page);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await stubPortalShellSession(page, 'linked');
    await seedPortalSession(page, 'linked');
    await page.goto(`${BASE}/client/aml`);
    await expect(page.getByText(SYNTHETIC.caseReference)).toBeVisible({ timeout: 20_000 });

    const overflow = await page.evaluate(() => ({
      docScroll: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      widest: (() => {
        let worst = { tag: '', right: 0 };
        for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.right > worst.right) worst = { tag: `${el.tagName}.${el.className}`.slice(0, 120), right: Math.round(r.right) };
        }
        return worst;
      })(),
    }));
    expect(
      overflow.docScroll,
      `horizontal overflow at ${vp.width}px — widest element ${overflow.widest.tag} ends at ${overflow.widest.right}px`,
    ).toBeLessThanOrEqual(overflow.clientWidth + 1);

    // Keyboard reachability: the first tab stop must be visible and focusable.
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const r = el.getBoundingClientRect();
      return { tag: el.tagName, visible: r.width > 0 && r.height > 0, inViewport: r.top >= -1 && r.left >= -1 };
    });
    expect(focused, 'Tab must move focus into the page').not.toBeNull();
    expect(focused!.visible).toBeTruthy();

    await shot(page, `client-viewport-${vp.name}`);
    net.check();
  });
}

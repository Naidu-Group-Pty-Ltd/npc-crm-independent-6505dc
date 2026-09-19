import { test, expect, chromium, type Page } from '@playwright/test';

/**
 * Real-browser AML tab journey against the dashboard's own Supabase project.
 *
 * ## Why this is opt-in
 *
 * Nothing here is mocked: every AML response must come from the deployed edge
 * functions. That makes the spec useless — worse than useless, because it
 * would go green while proving nothing — in any environment whose browser
 * cannot reach `*.supabase.co`.
 *
 * The build sandbox is exactly such an environment. Its egress proxy
 * allowlists hosts for the renderer process: `api.github.com` resolves from
 * in-page `fetch`, `dduzbchuswwbefdunfct.supabase.co` and `example.com` do
 * not. Playwright's Node-side `page.request` reaches Supabase fine (it uses
 * the proxy env), but the renderer cannot, so the app redirects to `/auth`
 * with `ERR_CONNECTION_RESET` before any AML route loads.
 *
 * Routing the browser's calls back through Node would make this pass, and
 * would be a lie: the thing under test is the browser's own path to the
 * backend. So the spec runs only when explicitly opted in, and asserts that
 * it actually reached the AML endpoints — it cannot pass vacuously.
 *
 *   AML_E2E_LIVE=1 npx playwright test tests-e2e/aml-tab --project=chromium
 *
 * Requires: dev server on :8080, and the synthetic fixtures
 * (case SYN-AML-E2E-001 + `*@example.invalid` users and sessions).
 */

const LIVE = process.env.AML_E2E_LIVE === '1';
const APP = 'http://localhost:8080';
const PROJECT = 'dduzbchuswwbefdunfct';
const MLRO_TOKEN = 'syn-staff-mlro-e2e-token-0001';
const CASE_REF = 'SYN-AML-E2E-001';

const isAml = (u: string) =>
  /\/functions\/v1\/(aml-|authenticated-data|client-portal-verify)/.test(u);

test.describe('AML tab — real browser, real backend', () => {
  test.skip(!LIVE, 'needs AML_E2E_LIVE=1 and a browser that can reach *.supabase.co');
  test.setTimeout(180_000);

  test('staff workspace loads and reaches the AML backend', async () => {
    const browser = await chromium.launch({
      proxy: process.env.HTTPS_PROXY
        ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1,::1' }
        : undefined,
    });
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    await ctx.addCookies([{
      name: '__Host-session_token', value: MLRO_TOKEN,
      domain: `${PROJECT}.supabase.co`, path: '/',
      secure: true, httpOnly: true, sameSite: 'None',
    }]);
    const page: Page = await ctx.newPage();

    const errors: string[] = [];
    const amlSeen = new Map<string, number>();

    page.on('response', (r) => {
      const u = r.url();
      if (!isAml(u)) return;
      amlSeen.set(u.split('/functions/v1/')[1]?.split('?')[0] ?? u, r.status());
      if (r.status() === 404) errors.push(`AML 404: ${u}`);
      if (r.status() >= 500) errors.push(`AML ${r.status()} (boot?): ${u}`);
    });
    page.on('console', (m) => {
      if (m.type() === 'error' && /aml|verification|authenticated-data/i.test(m.text())) {
        errors.push(`console: ${m.text().slice(0, 200)}`);
      }
    });
    // Any call to a different Supabase project is a hard failure.
    page.on('request', (req) => {
      const u = req.url();
      if (u.includes('.supabase.co') && !u.includes(PROJECT)) errors.push(`WRONG PROJECT: ${u}`);
    });

    for (const vp of [{ width: 1440, height: 900 }, { width: 360, height: 800 }]) {
      await page.setViewportSize(vp);
      await page.goto(`${APP}/admin/aml/cases`, { waitUntil: 'load' });
      await page.waitForTimeout(8000);
      await page.screenshot({ path: `test-results/aml-cases-${vp.width}.png`, fullPage: true });
    }

    // The spec must not be able to pass without having actually talked to the
    // AML backend — a green run over zero requests is the failure mode this
    // whole file exists to avoid.
    expect(amlSeen.size, 'no AML endpoint was contacted — the browser never reached the backend')
      .toBeGreaterThan(0);
    expect(page.url(), 'redirected to sign-in: the session did not survive').not.toContain('/auth');

    const body = await page.locator('body').innerText();
    expect(body, 'synthetic case missing from the case list').toContain(CASE_REF);
    expect(errors, `guard failures:\n${errors.join('\n')}`).toEqual([]);

    await browser.close();
  });
});

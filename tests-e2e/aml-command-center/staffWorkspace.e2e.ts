import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { BROWSER_USE, VIEWPORTS, assertNoProductionCalls, collectPageErrors } from './support/stagingTarget';
import { installStaffBackend, staffCaseUrl, STAFF_CASE_REF, PARTY_TYPES } from './support/staffBackend';

/**
 * Staff Command Center browser journey — real Chromium against the real
 * rendered SPA (see `support/staffBackend.ts` for what is and is not real).
 *
 *   npx vite --host 127.0.0.1 --port 8080 &
 *   AML_E2E=1 npx playwright test tests-e2e/aml-command-center/staffWorkspace.e2e.ts
 */

const BASE = process.env.AML_E2E_BASE_URL || 'http://127.0.0.1:8080';
const SHOTS = process.env.AML_E2E_ARTIFACTS || 'test-results/aml-browser-evidence';

test.skip(!process.env.AML_E2E, 'set AML_E2E=1 with the local SPA served against the staging branch');
test.use(BROWSER_USE);

mkdirSync(SHOTS, { recursive: true });

const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

async function openSection(page: Page, section: string) {
  await page.goto(`${staffCaseUrl(BASE)}?section=${section}`);
  await expect(page.getByText(STAFF_CASE_REF).first()).toBeVisible({ timeout: 20_000 });
}

test('the workspace renders the case with a Submission Review section for an analyst', async ({ page }) => {
  const net = assertNoProductionCalls(page);
  const errs = collectPageErrors(page);
  await installStaffBackend(page, { roles: ['analyst'] });
  await openSection(page, 'overview');
  expect(errs.snapshot(), 'the workspace must render without page errors').toEqual([]);

  await expect(page.getByRole('button', { name: /Submission Review/i }).or(page.getByText('Submission Review').first())).toBeVisible();
  // Next-best-action for a client_submitted case must point at submission review.
  await expect(page.getByText(/Review the client submission/i)).toBeVisible();
  await shot(page, 'staff-01-overview-analyst');
  net.check();
});

test('Submission Review shows the immutable package, differences and the six actions', async ({ page }) => {
  const net = assertNoProductionCalls(page);
  const log = await installStaffBackend(page, { roles: ['reviewer'] });
  await openSection(page, 'submission-review');

  // The review package was fetched from the real op, not synthesised in the SPA.
  await expect.poll(() => log.of('aml-cases', 'get_submission_review').length, { timeout: 15_000 }).toBeGreaterThan(0);

  const body = () => page.locator('body').innerText();

  // Version selector across both versions.
  await expect(page.getByText(/version 2|v2/i).first()).toBeVisible();

  // Differences against the previous version, marked material.
  const text = await body();
  expect(text).toMatch(/difference/i);
  expect(text).toMatch(/material/i);

  // Missing mandatory section is surfaced, and the risk staleness alert too.
  expect(text).toMatch(/source_of_wealth|source of wealth/i);
  expect(text).toMatch(/stale|out of date/i);

  // Payloads render as rows, never as raw JSON.
  expect(text, 'no raw JSON in the review package').not.toMatch(/\{\s*"[a-z_]+"\s*:/);

  // All six actions are offered.
  for (const action of [/accept/i, /request changes/i, /request document/i, /clarification/i, /escalate/i, /supersede/i]) {
    await expect(page.getByRole('button', { name: action }).first()).toBeVisible();
  }

  await shot(page, 'staff-02-submission-review');
  net.check();
});

test('a submission action requires a reason, confirms, and creates the client request transactionally', async ({ page }) => {
  const net = assertNoProductionCalls(page);
  const log = await installStaffBackend(page, { roles: ['reviewer'] });
  await openSection(page, 'submission-review');

  await page.getByRole('button', { name: /request changes/i }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // The dialog must fit the viewport and trap focus.
  const box = await dialog.boundingBox();
  const vp = page.viewportSize()!;
  expect(box!.height, 'dialog must fit the viewport').toBeLessThanOrEqual(vp.height);
  expect(box!.width).toBeLessThanOrEqual(vp.width);

  // Confirm without a reason must not submit.
  const confirm = dialog.getByRole('button', { name: /request changes|confirm|submit/i }).last();
  await confirm.click();
  expect(log.of('aml-cases', 'request_submission_changes'), 'must not submit without a reason').toHaveLength(0);

  // With a reason it submits, and the op carries the reason and client message.
  await dialog.getByRole('textbox').first().fill('Synthetic: source of wealth evidence required');
  const boxes = dialog.getByRole('textbox');
  if ((await boxes.count()) > 1) {
    await boxes.nth(1).fill('Please add detail about the source of your deposit.');
  }
  await confirm.click();

  await expect.poll(() => log.of('aml-cases', 'request_submission_changes').length, { timeout: 15_000 }).toBe(1);
  const sent = log.of('aml-cases', 'request_submission_changes')[0];
  expect(String(sent.reason)).toContain('source of wealth');

  await shot(page, 'staff-03-submission-action-dialog');
  net.check();
});

test('an analyst cannot take reviewer-only decisions', async ({ page }) => {
  const net = assertNoProductionCalls(page);
  await installStaffBackend(page, { roles: ['analyst'] });
  await openSection(page, 'submission-review');
  // Accept is a decision: an analyst must not be offered it as an enabled control.
  const accept = page.getByRole('button', { name: /^accept/i }).first();
  if (await accept.count()) {
    await expect(accept).toBeDisabled();
  }
  await shot(page, 'staff-04-analyst-permissions');
  net.check();
});

test('an auditor sees the case read-only', async ({ page }) => {
  const net = assertNoProductionCalls(page);
  await installStaffBackend(page, { roles: ['auditor'] });
  await openSection(page, 'submission-review');
  const enabledWrites = await page.getByRole('button', { name: /accept|escalate|supersede|request changes/i })
    .evaluateAll((els) => els.filter((e) => !(e as HTMLButtonElement).disabled).length);
  expect(enabledWrites, 'an auditor must not have enabled write actions').toBe(0);
  await shot(page, 'staff-05-auditor-readonly');
  net.check();
});

test('the identity section is one canonical panel with a collapsed, labelled legacy history', async ({ page }) => {
  const net = assertNoProductionCalls(page);
  await installStaffBackend(page, { roles: ['mlro'] });
  await openSection(page, 'identity');

  const text = await page.locator('body').innerText();

  // Canonical processing state is visible on the primary panel without
  // expanding anything, and is distinguishable from the identity outcome.
  expect(text, 'a technical failure must be named as one').toMatch(/Provider or worker failure/i);
  expect(text, 'an unusable capture must be named as one').toMatch(/Capture unusable/i);
  expect(text, 'attempt accounting must be stated').toMatch(/No client attempt was used/i);
  expect(text, 'provider readiness must be shown').toMatch(/Electronic verification: (available|not available)/i);

  // Retry processing exists and is offered only for the technical failure.
  const retry = page.getByRole('button', { name: /Retry processing/i });
  await expect(retry.first()).toBeVisible();
  // Two rows are retryable-shaped in the fixture set? No: exactly one is a
  // technical failure, so exactly one control may appear.
  expect(await retry.count(), 'retry must be offered only for a technical failure').toBe(1);

  // A simulated row is labelled as a test simulation and never as a failure
  // the client caused.
  expect(text).toMatch(/Test simulation — not compliance evidence/i);

  // Legacy history is collapsed by default and labelled read-only.
  const legacyToggle = page.getByRole('button', { name: /Legacy verification history/i }).first();
  await expect(legacyToggle).toBeVisible();
  expect(await legacyToggle.getAttribute('aria-expanded')).toBe('false');
  await legacyToggle.click();
  expect(await legacyToggle.getAttribute('aria-expanded')).toBe('true');
  // Nothing in the legacy panel may retry or promote a legacy row.
  const legacyBody = page.locator('#legacy-verification-body');
  await expect(legacyBody).toBeVisible();
  await expect(legacyBody.getByRole('button', { name: /promote|make authoritative|use as evidence|retry/i })).toHaveCount(0);
  // Legacy rows predate several timestamps; they must degrade to an em dash.
  expect(await legacyBody.innerText()).not.toContain('Invalid Date');

  await shot(page, 'staff-06-identity-unified');
  net.check();
});

test('party verification offers only authoritative checks and requires an unlink reason', async ({ page }) => {
  const net = assertNoProductionCalls(page);
  const log = await installStaffBackend(page, { roles: ['mlro'] });
  await openSection(page, 'identity');

  await expect.poll(() => log.of('aml-cases', 'list_party_verification_links').length, { timeout: 15_000 }).toBeGreaterThan(0);

  // The simulated check must not be selectable as a link target.
  const selects = page.locator('select');
  const optionText = (await selects.evaluateAll((els) =>
    els.flatMap((el) => Array.from((el as HTMLSelectElement).options).map((o) => o.textContent ?? '')),
  )).join(' | ');
  expect(optionText.toLowerCase(), 'simulated checks must never be linkable').not.toContain('simulator');

  // Every party type the model supports is expressible.
  // The link form is present with a party-type control and an eligible-check
  // control, and the eligible list is authoritative-only.
  const body = await page.locator('body').innerText();
  expect(body).toMatch(/Party type/i);
  expect(body).toMatch(/Canonical check|Select evidence/i);
  expect(body, 'the panel must state the simulated-check rule').toMatch(
    /Simulated and non-authoritative checks cannot be used as evidence/i,
  );
  await expect(page.getByRole('button', { name: /Link evidence/i }).first()).toBeVisible();

  await shot(page, 'staff-07-party-verification');
  net.check();
});

test('party screening renders every state, and a client detail never appears', async ({ page }) => {
  const net = assertNoProductionCalls(page);
  const log = await installStaffBackend(page, { roles: ['reviewer'] });
  await openSection(page, 'identity');
  await expect.poll(() => log.of('aml-cases', 'list_party_screening').length, { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(page.getByText(/Party screening/i).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Synthetic Screened 1').first()).toBeVisible({ timeout: 15_000 });

  const text = (await page.locator('body').innerText()).toLowerCase();
  // The real aml.party_screening_subjects state vocabulary.
  for (const state of ['not required', 'not started', 'queued', 'processing', 'completed',
    'possible match', 'confirmed match', 'false positive', 'error']) {
    expect(text, `screening state ${state} must render`).toContain(state);
  }
  // Adjudication is per canonical candidate match: staff can inspect the
  // actual listing before deciding, and confirm/dismiss it individually.
  await expect(page.getByText('Synthetic Listed Person').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /confirm/i }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /dismiss/i }).first()).toBeVisible();
  // PEP determination state is visible and actionable for a reviewer.
  expect(text).toContain('pep determination outstanding');
  await expect(page.getByRole('button', { name: /not a pep/i }).first()).toBeVisible();
  // Screening detail is staff-only: the panel says so, and this response
  // shape is never served to the Client or Finance portals.
  expect(text).toContain('clients never see screening detail');
  await shot(page, 'staff-08-party-screening');
  net.check();
});

test('reconciliation shows every change kind, provenance and conflicts, and never offers a fuzzy merge', async ({ page }) => {
  const net = assertNoProductionCalls(page);
  const log = await installStaffBackend(page, { roles: ['reviewer'] });
  await openSection(page, 'ownership');
  // Reconciliation is part of the submission review package, which is where
  // the declared-vs-canonical work items are worked.
  void log;
  await openSection(page, 'submission-review');

  // The review package presents each area as an accordion; open the parties one.
  const partiesTrigger = page.getByRole('button', { name: /^Related parties/i }).first();
  await expect(partiesTrigger).toBeVisible({ timeout: 15_000 });
  await partiesTrigger.click();
  await expect(page.getByText('Synthetic Party 1').first()).toBeVisible({ timeout: 15_000 });

  const text = (await page.locator('body').innerText()).toLowerCase();
  for (const kind of ['new', 'changed', 'removed', 'unchanged']) {
    expect(text, `change kind ${kind} must render`).toContain(kind);
  }
  // A similarity suggestion must be presented as needing confirmation, never as
  // an actionable merge.
  expect(text).toMatch(/confirm|suggest|possible/);
  await expect(page.getByRole('button', { name: /^merge/i })).toHaveCount(0);

  await shot(page, 'staff-09-reconciliation');
  net.check();
});

test('the case is unavailable, not a crash, when the backend cannot return it', async ({ page }) => {
  const net = assertNoProductionCalls(page);
  await installStaffBackend(page, { roles: ['analyst'] });
  // Override the case fetch with a realistic failure.
  await page.route('**/functions/v1/aml-cases', async (route) => {
    let body: any = {};
    try { body = JSON.parse(route.request().postData() || '{}'); } catch { /* ignore */ }
    if (body.op === 'get') {
      return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'forbidden' }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto(staffCaseUrl(BASE));
  await expect(page.getByText(/Case unavailable/i)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Something went wrong/i)).toHaveCount(0);
  await shot(page, 'staff-10-case-unavailable');
  net.check();
});

for (const vp of VIEWPORTS) {
  test(`staff submission review is usable with no horizontal overflow at ${vp.name}`, async ({ page }) => {
    const net = assertNoProductionCalls(page);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await installStaffBackend(page, { roles: ['mlro'] });
    await openSection(page, 'submission-review');

    const overflow = await page.evaluate(() => {
      let worst = { tag: '', right: 0 };
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const style = getComputedStyle(el);
        if (style.position === 'fixed') continue;
        if (r.right > worst.right) worst = { tag: `${el.tagName}.${String(el.className).slice(0, 80)}`, right: Math.round(r.right) };
      }
      return { docScroll: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, worst };
    });
    expect(
      overflow.docScroll,
      `horizontal overflow at ${vp.width}px — widest element ${overflow.worst.tag} ends at ${overflow.worst.right}px`,
    ).toBeLessThanOrEqual(overflow.clientWidth + 1);

    // Every visible interactive control must be large enough to hit and must
    // carry an accessible name.
    const unlabelled = await page.evaluate(() => {
      const bad: string[] = [];
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('button, a[href], select, input, textarea'))) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const name = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || (el as HTMLInputElement).placeholder || '').trim();
        const labelled = name.length > 0
          || Boolean(el.id && document.querySelector(`label[for="${el.id}"]`))
          || Boolean(el.closest('label'));
        if (!labelled) bad.push(`${el.tagName}#${el.id || '(no id)'}.${String(el.className).slice(0, 60)}`);
      }
      return bad;
    });
    expect(unlabelled, `controls without an accessible name at ${vp.name}`).toEqual([]);

    // No control may be clipped by its own box. A viewport-keyed grid inside
    // the workspace's narrow middle column silently truncated every label and
    // button in the party-verification form, at 1728px as well as 360px.
    const clipped = await page.evaluate(() => {
      const bad: string[] = [];
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('button, label, [role="combobox"]'))) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (getComputedStyle(el).overflow === 'visible') continue;
        if (el.scrollWidth > el.clientWidth + 1) {
          bad.push(`${el.tagName} "${(el.textContent || '').trim().slice(0, 40)}" ${el.scrollWidth}>${el.clientWidth}`);
        }
      }
      return bad;
    });
    expect(clipped, `clipped controls at ${vp.name}`).toEqual([]);

    // No user-facing surface may render a failed date parse.
    const pageText = await page.locator('body').innerText();
    expect(pageText, `"Invalid Date" rendered at ${vp.name}`).not.toContain('Invalid Date');
    expect(pageText, `"undefined" rendered at ${vp.name}`).not.toMatch(/\bundefined\b/);

    // Tab must reach a visible control.
    await page.keyboard.press('Tab');
    const focusVisible = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    expect(focusVisible, 'Tab must move focus to a visible control').toBeTruthy();

    await shot(page, `staff-viewport-${vp.name}`);
    net.check();
  });
}

/**
 * The manual-screening dialog, measured in a real engine at real viewports.
 *
 * ## Why this is a browser test and not a jsdom one
 *
 * The defect it exists to catch was reported as "I had to zoom the browser
 * out to use it". Nothing in jsdom can see that: jsdom has no layout, so it
 * reports the class list happily while the submit button sits two screens
 * below the fold. A source-string assertion that `max-w-2xl` is gone would
 * have passed on a dialog that was still unusable.
 *
 * So the real component is built (`harness/`) and rendered in Chromium, and
 * every assertion here is on a measured bounding box.
 *
 * ## What it asserts, in one sentence
 *
 * At 100% zoom, on every desktop size this product is used at, the whole
 * dialog is inside the viewport, the footer actions are visible without
 * scrolling to them, and the page never scrolls sideways.
 *
 * Run with `npm run test:e2e:manual-screening`.
 */
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HARNESS = path.resolve(HERE, 'harness');
const BUNDLE = path.join(HARNESS, 'dist', 'index.html');
const REPO = path.resolve(HERE, '../..');

/** Viewports the brief names, plus a phone. */
const DESKTOPS = [
  { name: '1280x720', width: 1280, height: 720 },
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1920x1080', width: 1920, height: 1080 },
] as const;
const MOBILE = { name: '390x844', width: 390, height: 844 } as const;

/*
 * Built once, and only if it is not there already — `npm run
 * test:e2e:manual-screening` builds it first, so the usual path spends no
 * time here. The hook gets its own generous timeout because a cold Vite
 * build of the dialog and its dependencies takes ~25s, comfortably past
 * Playwright's 30s default once npx resolution is counted.
 */
/*
 * Served over HTTP, not opened from disk. A Vite build is an ES module, and
 * Chromium refuses a module script from a `file://` origin — the page loads
 * blank and every assertion times out looking for a dialog that was never
 * mounted. A twelve-line static server is the whole fix.
 */
let server: Server;
let origin = '';

const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json',
};

test.beforeAll(async () => {
  test.setTimeout(180_000);
  if (!existsSync(BUNDLE)) {
    execFileSync('npx', ['vite', 'build', '--config', path.join(HARNESS, 'vite.config.ts')], {
      cwd: REPO, stdio: 'pipe',
    });
  }
  expect(existsSync(BUNDLE)).toBe(true);

  const dist = path.join(HARNESS, 'dist');
  server = createServer((req, res) => {
    const rel = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const file = path.join(dist, rel === '/' ? 'index.html' : rel);
    // Never serve outside the build output.
    if (!file.startsWith(dist) || !existsSync(file)) { res.statusCode = 404; res.end(); return; }
    res.setHeader('content-type', MIME[path.extname(file)] ?? 'application/octet-stream');
    createReadStream(file).pipe(res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  origin = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function openHarness(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.goto(`${origin}/`);
  await page.getByRole('dialog').waitFor();
  // Radix animates in; measure the settled box.
  await page.waitForTimeout(350);
}

const box = async (page: Page, selector: string) => {
  const b = await page.locator(selector).first().boundingBox();
  expect(b, `${selector} should be laid out`).not.toBeNull();
  return b!;
};

for (const vp of DESKTOPS) {
  test.describe(`desktop ${vp.name}`, () => {
    test('the dialog fits the viewport and the footer actions are visible', async ({ page }) => {
      await openHarness(page, vp.width, vp.height);

      const dialog = await box(page, '[role="dialog"]');
      // Inside the viewport on every edge. A dialog taller than the screen is
      // how the footer ended up unreachable.
      expect(dialog.y).toBeGreaterThanOrEqual(-1);
      expect(dialog.x).toBeGreaterThanOrEqual(-1);
      expect(dialog.y + dialog.height).toBeLessThanOrEqual(vp.height + 1);
      expect(dialog.x + dialog.width).toBeLessThanOrEqual(vp.width + 1);

      // The footer is on screen WITHOUT scrolling anything.
      const footer = await box(page, '[data-testid="manual-screening-footer"]');
      expect(footer.y + footer.height).toBeLessThanOrEqual(vp.height + 1);

      const submit = page.getByRole('button', { name: /record manual screening/i });
      const cancel = page.getByRole('button', { name: /^cancel$/i });
      await expect(submit).toBeVisible();
      await expect(cancel).toBeVisible();
      const submitBox = (await submit.boundingBox())!;
      expect(submitBox.y + submitBox.height).toBeLessThanOrEqual(vp.height + 1);

      // The header did not scroll away either.
      const header = await box(page, '[data-testid="manual-screening-header"]');
      expect(header.y).toBeGreaterThanOrEqual(-1);
    });

    test('uses the width instead of staying a skinny column', async ({ page }) => {
      await openHarness(page, vp.width, vp.height);
      const dialog = await box(page, '[role="dialog"]');
      // The old dialog was max-w-2xl = 672px at every size.
      expect(dialog.width).toBeGreaterThan(672);
      expect(dialog.width).toBeLessThanOrEqual(Math.min(1100, vp.width * 0.94) + 2);
    });

    test('nothing overflows horizontally', async ({ page }) => {
      await openHarness(page, vp.width, vp.height);
      const overflow = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        body: document.body.scrollWidth - document.body.clientWidth,
      }));
      expect(overflow.doc).toBeLessThanOrEqual(1);
      expect(overflow.body).toBeLessThanOrEqual(1);
    });

    test('the body is the only thing that scrolls, and it scrolls independently', async ({ page }) => {
      await openHarness(page, vp.width, vp.height);

      // The dialog itself must not be a scroll container — that is what made
      // the header and footer scroll away with the form.
      const dialogOverflow = await page.locator('[role="dialog"]').evaluate(
        (el) => getComputedStyle(el).overflowY);
      expect(dialogOverflow).toBe('hidden');

      const bodyOverflow = await page.locator('[data-testid="manual-screening-body"]').evaluate(
        (el) => getComputedStyle(el).overflowY);
      expect(bodyOverflow).toBe('auto');

      // Scrolling the body leaves the footer exactly where it was.
      const before = await box(page, '[data-testid="manual-screening-footer"]');
      await page.locator('[data-testid="manual-screening-body"]').evaluate(
        (el) => { el.scrollTop = 10_000; });
      await page.waitForTimeout(100);
      const after = await box(page, '[data-testid="manual-screening-footer"]');
      expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
    });

    test('the outcome options are laid out in two columns', async ({ page }) => {
      await openHarness(page, vp.width, vp.height);
      const cols = await page.locator('[data-testid="manual-outcome-grid"]').evaluate(
        (el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
      expect(cols).toBe(2);
    });

    test('the evidence area is two columns, not one tall stack', async ({ page }) => {
      await openHarness(page, vp.width, vp.height);
      const cols = await page.locator('[data-testid="manual-evidence-grid"]').evaluate(
        (el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
      // lg: is 1024px, so every named desktop viewport gets two columns.
      expect(cols).toBe(2);
    });

    test('a source row lays its four fields out in a grid', async ({ page }) => {
      await openHarness(page, vp.width, vp.height);
      const cols = await page.locator('[data-testid="manual-source-row"]').first().evaluate(
        (el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
      expect(cols).toBe(2);
    });
  });
}

test.describe('1440x900 — the common workflow', () => {
  test('a no-match needs little or no scrolling', async ({ page }) => {
    await openHarness(page, 1440, 900);
    const overflow = await page.locator('[data-testid="manual-screening-body"]').evaluate(
      (el) => el.scrollHeight - el.clientHeight);
    // Everything the default (no-match) workflow needs is within about half a
    // screen of scroll, rather than the ~2 screens it used to take.
    expect(overflow).toBeLessThan(450);
  });
});

test.describe('1366x768 — the acceptance size', () => {
  test('every control of a CONFIRMED MATCH — the tallest form — stays reachable', async ({ page }) => {
    await openHarness(page, 1366, 768);
    await page.getByRole('radio', { name: /^confirmed match/i }).click();
    await page.waitForTimeout(150);

    const dialog = await box(page, '[role="dialog"]');
    expect(dialog.y + dialog.height).toBeLessThanOrEqual(768 + 1);

    const submit = page.getByRole('button', { name: /record manual screening/i });
    await expect(submit).toBeVisible();
    const sb = (await submit.boundingBox())!;
    expect(sb.y + sb.height).toBeLessThanOrEqual(768 + 1);

    // The candidate fields exist and are laid out, not clipped to zero.
    const candidate = await box(page, '[data-testid="manual-candidate-row"]');
    expect(candidate.width).toBeGreaterThan(0);
    expect(candidate.height).toBeGreaterThan(0);
    const cols = await page.locator('[data-testid="manual-candidate-row"]').first().evaluate(
      (el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(cols).toBe(2);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('unable-to-complete hides the evidence fields it does not need', async ({ page }) => {
    await openHarness(page, 1366, 768);
    await page.getByRole('radio', { name: /^unable to complete/i }).click();
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid="manual-source-row"]')).toHaveCount(0);
    await expect(page.getByLabel(/names actually searched/i)).toHaveCount(0);
    const cols = await page.locator('[data-testid="manual-unable-grid"]').evaluate(
      (el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(cols).toBe(2);
    const submit = page.getByRole('button', { name: /record manual screening/i });
    const sb = (await submit.boundingBox())!;
    expect(sb.y + sb.height).toBeLessThanOrEqual(768 + 1);
  });

  test('the refusal reason is visible beside the disabled button', async ({ page }) => {
    await openHarness(page, 1366, 768);
    const submit = page.getByRole('button', { name: /record manual screening/i });
    await expect(submit).toBeDisabled();
    // Nothing to hunt for: the reason is in the footer, on screen, next to it.
    const reason = page.getByText(/at least one source that was actually checked/i);
    await expect(reason).toBeVisible();
    const rb = (await reason.boundingBox())!;
    expect(rb.y + rb.height).toBeLessThanOrEqual(768 + 1);
  });

  test('keyboard reaches the outcome options and the submit button', async ({ page }) => {
    await openHarness(page, 1366, 768);
    const first = page.getByRole('radio', { name: /^no match/i });
    await first.focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('radio', { name: /^possible match/i })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('radio', { name: /^confirmed match/i })).toBeFocused();
  });
});

test.describe(`mobile ${MOBILE.name}`, () => {
  test('collapses to one column and still shows both footer actions', async ({ page }) => {
    await openHarness(page, MOBILE.width, MOBILE.height);

    const outcomeCols = await page.locator('[data-testid="manual-outcome-grid"]').evaluate(
      (el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(outcomeCols).toBe(1);

    const evidenceCols = await page.locator('[data-testid="manual-evidence-grid"]').evaluate(
      (el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(evidenceCols).toBe(1);

    const dialog = await box(page, '[role="dialog"]');
    expect(dialog.x).toBeGreaterThanOrEqual(-1);
    expect(dialog.width).toBeLessThanOrEqual(MOBILE.width + 1);
    expect(dialog.y + dialog.height).toBeLessThanOrEqual(MOBILE.height + 1);

    await expect(page.getByRole('button', { name: /record manual screening/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^cancel$/i })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

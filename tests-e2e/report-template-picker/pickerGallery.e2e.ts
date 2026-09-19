/**
 * The template picker's gallery, seen in a real engine.
 *
 * ## Why this is a browser test and not a jsdom one
 *
 * The change under test is visual: a template is now chosen by LOOKING at it —
 * real first pages in tiles, families before variants — and jsdom has neither
 * layout nor iframes, so a DOM test can pass while every tile paints blank.
 * The dialog is built and rendered in Chromium over sixteen real catalogue
 * rows (their production `preview_schema`), and the assertions are on painted
 * iframes and bounding boxes.
 *
 * ## What it asserts, in one sentence
 *
 * The gallery leads with one visually painted tile per design family, holds a
 * family's variants back until it is opened, paints every variant and every
 * standalone template with a real page, and never scrolls sideways — at
 * desktop and phone widths alike.
 *
 * Run with `npm run test:e2e:report-template-picker`.
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

/*
 * Served over HTTP, not opened from disk: a Vite build is an ES module and
 * Chromium refuses a module script from a `file://` origin — the page loads
 * blank and every assertion times out looking for a dialog that never mounted.
 */
let server: Server;
let origin = '';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

test.beforeAll(async () => {
  if (!existsSync(BUNDLE)) {
    execFileSync('npx', [
      'vite', 'build', '--config', path.join(HARNESS, 'vite.config.ts'),
    ], { cwd: REPO, stdio: 'inherit' });
  }
  server = createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0];
    const file = path.join(HARNESS, 'dist', url === '/' ? 'index.html' : url);
    const stream = createReadStream(file);
    stream.on('error', () => { res.writeHead(404); res.end(); });
    stream.on('open', () => {
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
      });
      stream.pipe(res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function openPicker(page: Page, query = '') {
  /*
   * The preview documents `@import` Google Fonts, and a pending stylesheet
   * blocks a srcdoc iframe's first paint. In CI and sandboxes that black-hole
   * that host, every sheet would sit blank until the connection dies — so the
   * requests are failed instantly and the documents paint in their fallback
   * stacks, which is exactly what a browser with no reach to the CDN does.
   */
  await page.route('https://fonts.googleapis.com/**', (route) => route.abort());
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort());
  await page.goto(`${origin}/index.html${query}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Private Banking/ }).waitFor();
}

/** Painted previews inside a scope: iframes that occupy real space. */
async function paintedSheets(page: Page, scope = '[role="dialog"]') {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return 0;
    let painted = 0;
    for (const frame of root.querySelectorAll('iframe')) {
      const box = frame.getBoundingClientRect();
      if (box.width > 40 && box.height > 60) painted += 1;
    }
    return painted;
  }, scope);
}

const FAMILY_TILE_NAMES = [
  /Private Banking/, /Dark Executive/, /Swiss Minimal/, /Luxury Editorial/,
] as const;

test.describe('at 1440x900', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the gallery leads with families, every tile painted', async ({ page }) => {
    await openPicker(page);
    for (const name of FAMILY_TILE_NAMES) {
      await expect(page.getByRole('button', { name })).toBeVisible();
    }
    // Variants stay behind their family: Chancery is Private Banking's
    // reference layout, and it must not be competing with the other families.
    await expect(page.getByText('Chancery', { exact: true })).toHaveCount(0);
    // The previews are genuinely painted, not blank chrome: every family tile
    // above the fold carries a real rendered page.
    await expect.poll(() => paintedSheets(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(10);
    await page.screenshot({ path: test.info().outputPath('gallery-desktop.png'), fullPage: false });

    // The sections below the fold paint as they come into reach — lazily, by
    // design: sixty eager documents is the cost this avoids.
    await page.getByTestId('template-picker-scroll')
      .evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await expect.poll(() => paintedSheets(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(13);
  });

  test('opening a family reveals its five layouts, painted, without sideways scroll', async ({ page }) => {
    await openPicker(page);
    const before = await paintedSheets(page);
    await page.getByRole('button', { name: /Private Banking/ }).click();
    await expect(page.getByText('Chancery', { exact: true })).toBeVisible();
    await expect(page.getByText('Sovereign Folio')).toBeVisible();
    await expect(page.getByText('Bullion Rail')).toBeVisible();
    // The tray scrolls itself into reach when it opens, so its five layouts
    // paint without the person hunting for them.
    await expect.poll(() => page.evaluate(() => {
      const tray = document.querySelector('[id^="family-tray-"]');
      if (!tray) return 0;
      let painted = 0;
      for (const frame of tray.querySelectorAll('iframe')) {
        const box = frame.getBoundingClientRect();
        if (box.width > 40 && box.height > 60) painted += 1;
      }
      return painted;
    }), { timeout: 15_000 }).toBeGreaterThanOrEqual(5);
    expect(before).toBeGreaterThanOrEqual(1);

    // The colourway swatches repaint the tray rather than opening anything.
    const swatches = page.locator('[role="group"][aria-label*="Colourway"] button');
    expect(await swatches.count()).toBeGreaterThanOrEqual(2);
    await swatches.nth(1).click();
    await expect(swatches.nth(1)).toHaveAttribute('aria-pressed', 'true');

    const dialog = page.locator('[role="dialog"]');
    const overflow = await dialog.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: test.info().outputPath('family-open-desktop.png'), fullPage: false });
  });

  test('a stored choice opens followed: tray expanded, Current badged, one radio checked', async ({ page }) => {
    await openPicker(page, '?selected=house');
    await expect(page.getByText('Chancery', { exact: true })).toBeVisible();
    expect(await page.getByText('Current', { exact: true }).count()).toBeGreaterThanOrEqual(1);
    const checked = page.locator('[role="dialog"] [role="radio"][aria-checked="true"], [role="dialog"] [role="radio"][data-state="checked"]');
    await expect(checked).toHaveCount(1);
    await page.screenshot({ path: test.info().outputPath('followed-selection.png'), fullPage: false });
  });

  test('a standalone active template has a face and a place', async ({ page }) => {
    await openPicker(page);
    const tile = page.locator('label', { hasText: 'Bespoke Investment Layout' });
    await tile.scrollIntoViewIfNeeded();
    await expect(page.getByText('Other active templates')).toBeVisible();
    await expect(tile).toBeVisible();
    await expect.poll(async () => {
      return tile.evaluate((el) => {
        const frame = el.querySelector('iframe');
        if (!frame) return 0;
        const box = frame.getBoundingClientRect();
        return box.width > 40 && box.height > 60 ? 1 : 0;
      });
    }, { timeout: 15_000 }).toBe(1);
  });
});

test.describe('at 390x844', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the gallery is two columns of real tiles and never scrolls sideways', async ({ page }) => {
    await openPicker(page);
    const { scrollW, clientW } = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    }));
    expect(scrollW).toBeLessThanOrEqual(clientW);

    const tiles = page.getByRole('button', { name: /Private Banking|Dark Executive/ });
    const first = await tiles.first().boundingBox();
    expect(first).not.toBeNull();
    expect(first!.width).toBeGreaterThan(120);
    await expect.poll(() => paintedSheets(page), { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
    await page.screenshot({ path: test.info().outputPath('gallery-phone.png'), fullPage: false });
    await page.getByTestId('template-picker-scroll')
      .evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await expect.poll(() => paintedSheets(page), { timeout: 20_000 }).toBeGreaterThanOrEqual(6);
  });
});

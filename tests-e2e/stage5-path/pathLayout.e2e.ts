/**
 * Stage 5's path, measured in a real engine at real viewports.
 *
 * ## Why this is a browser test and not a jsdom one
 *
 * The complaint was visual: the stage was "fragmented", with no clear route
 * through it. jsdom has no layout, so a DOM test can assert every step is
 * present while the one thing to do sits below the fold behind four panels
 * that say it differently. These assertions are on bounding boxes.
 *
 * ## What it asserts, in one sentence
 *
 * At 100% zoom, on every size this product is used at, the step the server
 * is asking for is visible with its button, exactly one step is open, the
 * settled steps stay one line each, and the page never scrolls sideways.
 *
 * Run with `npm run test:e2e:stage5-path`.
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

const VIEWPORTS = [
  { name: '1280x720', width: 1280, height: 720 },
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '390x844', width: 390, height: 844 },
] as const;

/*
 * Served over HTTP, not opened from disk: a Vite build is an ES module and
 * Chromium refuses a module script from a `file://` origin — the page loads
 * blank and every assertion times out looking for a card that never mounted.
 */
let server: Server;
let origin = '';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
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

async function openPath(page: Page, which = 'production') {
  await page.goto(`${origin}/index.html?case=${which}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('ol > li');
}

for (const vp of VIEWPORTS) {
  test.describe(`at ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('the page never scrolls sideways', async ({ page }) => {
      await openPath(page);
      const { scrollW, clientW } = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
      }));
      expect(scrollW).toBeLessThanOrEqual(clientW);
    });

    test('exactly one step is open, and it is the one being asked for', async ({ page }) => {
      await openPath(page);
      const expanded = page.locator('button[aria-expanded="true"]');
      await expect(expanded).toHaveCount(1);
      await expect(expanded).toContainText(/PEP determination/i);
      await expect(expanded).toContainText('Do this now');
    });

    test('the act is offered once, with a real button', async ({ page }) => {
      await openPath(page);
      const cta = page.getByRole('button', { name: 'Record PEP determination' });
      await expect(cta).toHaveCount(1);
      const box = await cta.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThan(80);
      expect(box!.height).toBeGreaterThanOrEqual(28);
    });

    test('a settled step stays one line of reading, not a panel', async ({ page }) => {
      await openPath(page);
      // The sanctions step is `not required` here: closed, and short.
      const collapsed = page.locator('ol > li', {
        hasText: 'Screen for targeted financial sanctions',
      });
      const box = await collapsed.boundingBox();
      expect(box).not.toBeNull();
      /*
       * Two lines of text plus padding on a desktop; the same words wrap
       * further on a phone, which is the layout working rather than failing.
       * What must hold everywhere is that a settled step is a fraction of the
       * open one — that is what makes the path readable at a glance.
       */
      expect(box!.height).toBeLessThan(vp.width < 640 ? 220 : 140);
      const openStep = page.locator('ol > li', { has: page.locator('button[aria-expanded="true"]') });
      const openBox = await openStep.boundingBox();
      expect(box!.height).toBeLessThan(openBox!.height / 2);
    });
  });
}

test.describe('the whole path is readable without hunting', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('every step is on one screen at a desktop size', async ({ page }) => {
    await openPath(page);
    const card = page.locator('ol').first();
    const box = await card.boundingBox();
    expect(box).not.toBeNull();
    /*
     * The five steps, the open one included, inside a 900px-tall viewport.
     * Measured at 763px. The threshold is a regression guard rather than a
     * design target: a step list that grows past a screen has stopped being
     * a path and gone back to being the wall this replaced — which is what
     * happened when the open step carried its obligation/method/outcome grid
     * expanded (it measured over 820px).
     */
    expect(box!.height).toBeLessThan(800);
  });

  test('a candidate is never announced as a finding', async ({ page }) => {
    await openPath(page, 'adjudicate');
    await expect(page.getByText(/1 candidate awaiting adjudication/i)).toBeVisible();
    await expect(page.getByText(/a screening finding is recorded/i)).toHaveCount(0);
  });
});

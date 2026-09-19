import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PLATFORM_APPLE_TOUCH_ICON,
  PLATFORM_FAVICON,
  appleTouchIconFor,
  faviconFor,
} from '../platformBrand';

const indexHtml = readFileSync(join(__dirname, '..', '..', '..', 'index.html'), 'utf8');

describe('an unbranded clone still shows whose platform it is', () => {
  it('falls back to the Aurixa mark when nothing is configured', () => {
    for (const empty of [null, undefined, '', '   ']) {
      expect(faviconFor(empty)).toBe(PLATFORM_FAVICON);
    }
  });

  it('uses the tenant mark when there is one', () => {
    expect(faviconFor('https://cdn.example.com/logo.png')).toBe(
      'https://cdn.example.com/logo.png',
    );
  });

  it('never returns null — an unbranded clone is an Aurixa deployment', () => {
    // The defect this replaces was an early `return`, which left the previous
    // tenant's mark on the tab after their favicon was cleared.
    expect(faviconFor(null)).toBeTruthy();
    expect(appleTouchIconFor(null)).toBeTruthy();
  });
});

describe('the static declaration and the runtime default agree', () => {
  it('index.html declares the same icon the provider falls back to', () => {
    // They are painted at different moments — the static link before
    // hydration, the provider after — so a mismatch is a visible flicker from
    // one mark to another on every load of an unbranded clone.
    expect(indexHtml).toContain(`href="${PLATFORM_FAVICON}"`);
  });

  it('index.html declares the same apple-touch tile', () => {
    expect(indexHtml).toContain(`href="${PLATFORM_APPLE_TOUCH_ICON}"`);
  });

  it('every platform slot is an Aurixa asset, not a scaffold leftover', () => {
    // Asserted for BOTH slots, because asserting it for one is how the other
    // came to hold `/icons/apple-touch-icon.png` — the NPC email-signature
    // banner, carrying a named director and their personal mobile number — as
    // the home-screen tile of every clone with no brand of its own.
    for (const slot of [PLATFORM_FAVICON, PLATFORM_APPLE_TOUCH_ICON]) {
      expect(slot).toMatch(/^\/brand\/aurixa-/);
    }
    expect(indexHtml).not.toMatch(/rel="icon"[^>]*href="\/favicon\.ico"/);
  });

  it('the favicon is a file that exists', () => {
    // An unresolved icon path is not a visible error anywhere: the browser
    // asks once, gets a 404 and draws its blank-page glyph, which is exactly
    // what having no favicon at all looks like.
    const onDisk = join(__dirname, '..', '..', '..', 'public', PLATFORM_FAVICON);
    expect(existsSync(onDisk)).toBe(true);
  });

  it('the favicon slot is not shared with any other job', () => {
    // `aurixa-notification-*` serves the apple-touch tile, the desktop
    // notification icon and the og:image card. Pointing the favicon at the
    // same file is how replacing the tab icon silently changes a clone's push
    // notifications and its link previews.
    const alerts = readFileSync(
      join(__dirname, '..', '..', 'lib', 'desktopMessageAlerts.ts'),
      'utf8',
    );
    const notificationIcon = /AURIXA_NOTIFICATION_ICON\s*=\s*'([^']+)'/.exec(alerts)?.[1];
    expect(notificationIcon).toBeTruthy();
    expect(PLATFORM_FAVICON).not.toBe(notificationIcon);
    expect(PLATFORM_FAVICON).not.toBe(PLATFORM_APPLE_TOUCH_ICON);
  });

  it('no platform slot points into the tenant icon set', () => {
    // `public/icons/` is this deployment's own PWA artwork. Whatever it holds
    // is one tenant's identity, so it can never be what an UNBRANDED clone
    // falls back to.
    for (const slot of [PLATFORM_FAVICON, PLATFORM_APPLE_TOUCH_ICON]) {
      expect(slot).not.toMatch(/^\/icons\//);
    }
  });
});

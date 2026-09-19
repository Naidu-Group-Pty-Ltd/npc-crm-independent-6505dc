/**
 * Contract tests for internal-message desktop alerts.
 *
 * The behaviours pinned here are the ones that are invisible in a single-tab
 * manual test and expensive in production:
 *
 * 1. DUPLICATE SUPPRESSION IS CROSS-TAB AND CROSS-RELOAD.
 *    Every dashboard tab polls `internal-messaging` independently. An in-memory
 *    "already alerted" map therefore fires once per tab, and again after every
 *    reload. The claim ledger is persisted and shared, so a message notifies
 *    exactly once — while a genuinely newer message in the same thread still
 *    claims and still notifies.
 *
 * 2. BACKLOG IS SEEDED, NOT REPLAYED.
 *    Signing in with ten unread threads must not throw ten OS notifications.
 *
 * 3. THE CLICK ROUTE SURVIVES A CLOSED DASHBOARD.
 *    The service worker reaches an open tab by postMessage (preserving the page
 *    the user was on) and cold-starts one via `?internalThread=` otherwise.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { join } from 'node:path';

import {
  AURIXA_NOTIFICATION_BADGE,
  AURIXA_NOTIFICATION_ICON,
  INTERNAL_NOTIFICATION_KIND,
  INTERNAL_THREAD_DEEPLINK_PARAM,
  SW_OPEN_THREAD_MESSAGE,
  buildAlertCopy,
  getNotificationBadge,
  getNotificationIcon,
  setBrandNotificationIcon,
  claimMessageAlert,
  consumeInternalThreadDeepLink,
  desktopAlertsEnabled,
  hasClaimedMessageAlert,
  internalNotificationTag,
  isDesktopAlertPromptSnoozed,
  messageSoundEnabled,
  resetMessageAlertClaims,
  seedMessageAlert,
  setDesktopAlertsEnabled,
  setMessageSoundEnabled,
  shouldOfferDesktopAlerts,
  snoozeDesktopAlertPrompt,
} from '@/lib/desktopMessageAlerts';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const THREAD = '11111111-2222-3333-4444-555555555555';
const T1 = '2026-08-03T09:00:00.000Z';
const T2 = '2026-08-03T09:05:00.000Z';

beforeEach(() => {
  localStorage.clear();
  resetMessageAlertClaims();
  setBrandNotificationIcon(null);
});

describe('duplicate-notification prevention', () => {
  it('lets exactly one caller claim a given message', () => {
    expect(claimMessageAlert(THREAD, T1)).toBe(true);
    // A second tab polling the same message must not alert again.
    expect(claimMessageAlert(THREAD, T1)).toBe(false);
    expect(claimMessageAlert(THREAD, T1)).toBe(false);
  });

  it('still alerts on a genuinely newer message in the same thread', () => {
    expect(claimMessageAlert(THREAD, T1)).toBe(true);
    expect(claimMessageAlert(THREAD, T2)).toBe(true);
    // ...but never re-alerts on the older one arriving out of order.
    expect(claimMessageAlert(THREAD, T1)).toBe(false);
  });

  it('persists claims so a reload does not replay the notification', () => {
    expect(claimMessageAlert(THREAD, T1)).toBe(true);
    // Simulate a fresh page load: the module's in-memory mirror is dropped and
    // rebuilt from localStorage exactly as it is on boot.
    window.dispatchEvent(new StorageEvent('storage', { key: 'aurixa.internalMessages.alertClaims' }));
    expect(hasClaimedMessageAlert(THREAD, T1)).toBe(true);
    expect(claimMessageAlert(THREAD, T1)).toBe(false);
  });

  it('seeds a backlog as already-seen without alerting', () => {
    seedMessageAlert(THREAD, T1);
    expect(claimMessageAlert(THREAD, T1)).toBe(false);
    // A message that arrives after the seed is still new.
    expect(claimMessageAlert(THREAD, T2)).toBe(true);
  });

  it('tracks threads independently', () => {
    expect(claimMessageAlert('thread-a', T1)).toBe(true);
    expect(claimMessageAlert('thread-b', T1)).toBe(true);
  });

  it('ignores empty identifiers rather than poisoning the ledger', () => {
    expect(claimMessageAlert('', T1)).toBe(false);
    expect(claimMessageAlert(THREAD, '')).toBe(false);
  });
});

describe('notification copy', () => {
  it('names the sender and previews the message for a direct message', () => {
    const { heading, body } = buildAlertCopy({
      thread_id: THREAD,
      title: 'Priya Naidu',
      sender: 'Priya Naidu',
      body: 'Can you look at the Kellyville valuation before 3pm?',
      kind: 'direct',
    });
    expect(heading).toBe('Priya Naidu');
    expect(body).toBe('Can you look at the Kellyville valuation before 3pm?');
  });

  it('names both the sender and the room for a group message', () => {
    const { heading } = buildAlertCopy({
      thread_id: THREAD,
      title: 'Acquisitions',
      sender: 'Priya Naidu',
      body: 'Settlement moved',
      kind: 'group',
    });
    expect(heading).toBe('Priya Naidu in Acquisitions');
  });

  it('flags urgent messages in the heading', () => {
    const { heading } = buildAlertCopy({
      thread_id: THREAD,
      title: 'Priya Naidu',
      sender: 'Priya Naidu',
      body: 'Call me',
      kind: 'direct',
      priority: 'urgent',
    });
    expect(heading.startsWith('🔴 Urgent · ')).toBe(true);
  });

  it('describes an attachment-only message instead of showing an empty bubble', () => {
    const { body } = buildAlertCopy({
      thread_id: THREAD,
      title: 'Priya Naidu',
      sender: 'Priya Naidu',
      body: '   ',
      kind: 'direct',
      hasAttachments: true,
    });
    expect(body).toBe('Sent an attachment');
  });

  it('truncates long previews and collapses newlines', () => {
    const { body } = buildAlertCopy({
      thread_id: THREAD,
      title: 'Priya Naidu',
      sender: 'Priya Naidu',
      body: `line one\nline two ${'x'.repeat(400)}`,
      kind: 'direct',
    });
    expect(body).not.toContain('\n');
    expect(body.length).toBeLessThanOrEqual(180);
    expect(body.endsWith('…')).toBe(true);
  });
});

describe('preferences and the opt-in invitation', () => {
  it('defaults both alerts and sound to on', () => {
    expect(desktopAlertsEnabled()).toBe(true);
    expect(messageSoundEnabled()).toBe(true);
  });

  it('round-trips the opt-outs independently', () => {
    setDesktopAlertsEnabled(false);
    expect(desktopAlertsEnabled()).toBe(false);
    expect(messageSoundEnabled()).toBe(true);

    setMessageSoundEnabled(false);
    setDesktopAlertsEnabled(true);
    expect(desktopAlertsEnabled()).toBe(true);
    expect(messageSoundEnabled()).toBe(false);
  });

  it('goes quiet for a week when the invitation is ignored', () => {
    expect(isDesktopAlertPromptSnoozed()).toBe(false);
    snoozeDesktopAlertPrompt();
    expect(isDesktopAlertPromptSnoozed()).toBe(true);
    expect(shouldOfferDesktopAlerts()).toBe(false);
  });

  it('never offers the invitation to someone who switched alerts off', () => {
    setDesktopAlertsEnabled(false);
    expect(shouldOfferDesktopAlerts()).toBe(false);
  });
});

describe('deep linking back to a conversation', () => {
  it('reads the thread id and strips it from the address bar', () => {
    const replaceState = vi.spyOn(window.history, 'replaceState');
    window.history.replaceState({}, '', `/dashboard?${INTERNAL_THREAD_DEEPLINK_PARAM}=${THREAD}&tab=x`);

    expect(consumeInternalThreadDeepLink()).toBe(THREAD);
    expect(window.location.search).not.toContain(INTERNAL_THREAD_DEEPLINK_PARAM);
    // Unrelated params survive — the deep link must not eat existing state.
    expect(window.location.search).toContain('tab=x');
    // A second read finds nothing, so a re-render cannot re-open the thread.
    expect(consumeInternalThreadDeepLink()).toBeNull();
    replaceState.mockRestore();
  });

  it('returns null when no deep link is present', () => {
    window.history.replaceState({}, '', '/dashboard');
    expect(consumeInternalThreadDeepLink()).toBeNull();
  });
});

describe('service worker click routing', () => {
  const sw = read('public/sw-push.js');

  it('recognises internal message notifications', () => {
    expect(sw).toContain(`const INTERNAL_MESSAGE_KIND = '${INTERNAL_NOTIFICATION_KIND}'`);
    expect(sw).toContain(`const OPEN_INTERNAL_THREAD_MESSAGE = '${SW_OPEN_THREAD_MESSAGE}'`);
  });

  it('reaches an open dashboard by postMessage rather than navigating it', () => {
    const handler = sw.slice(sw.indexOf('async function openInternalThread'));
    expect(handler).toContain('client.focus()');
    expect(handler).toContain('client.postMessage(');
    // Navigating an open tab would discard whatever the user was working on.
    expect(handler.slice(0, handler.indexOf('openWindow'))).not.toContain('client.navigate');
  });

  it('cold-starts a deep-linked window when no dashboard is open', () => {
    expect(sw).toContain(`'/?${INTERNAL_THREAD_DEEPLINK_PARAM}=' + encodeURIComponent`);
  });

  it('treats the Dismiss action as an acknowledgement, opening nothing', () => {
    expect(sw).toContain("if (event.action === 'dismiss') return;");
  });

  it('leaves the existing Web Push click behaviour intact', () => {
    expect(sw).toContain("await client.navigate(targetUrl)");
    expect(sw).toContain('await self.clients.openWindow(targetUrl)');
  });
});

describe('notification branding', () => {
  it('falls back to the Aurixa Systems mark when no white-label logo is set', () => {
    expect(getNotificationIcon()).toBe(`${window.location.origin}${AURIXA_NOTIFICATION_ICON}`);
    expect(AURIXA_NOTIFICATION_ICON).not.toContain('favicon.ico');
  });

  it('uses the white-label logo when branding provides one', () => {
    setBrandNotificationIcon('https://cdn.example.com/tenant-mark.png');
    expect(getNotificationIcon()).toBe('https://cdn.example.com/tenant-mark.png');
  });

  it('resolves the default to an absolute URL, not a bare path', () => {
    // A service worker resolves a relative icon against its own scope, not the
    // page. A 404 icon is a silently unbranded notification.
    expect(getNotificationIcon().startsWith('http')).toBe(true);
    expect(getNotificationBadge().startsWith('http')).toBe(true);
  });

  it('reverts to Aurixa when the white-label logo is removed', () => {
    setBrandNotificationIcon('https://cdn.example.com/tenant-mark.png');
    setBrandNotificationIcon(null);
    expect(getNotificationIcon()).toContain(AURIXA_NOTIFICATION_ICON);
  });

  it('treats an empty or whitespace logo as no logo', () => {
    setBrandNotificationIcon('   ');
    expect(getNotificationIcon()).toContain(AURIXA_NOTIFICATION_ICON);
  });

  it('refuses the stock scaffold icon even if branding hands it over', () => {
    // The stock mark is the one thing that must never reach a notification.
    setBrandNotificationIcon('/favicon.ico');
    expect(getNotificationIcon()).toContain(AURIXA_NOTIFICATION_ICON);
  });

  it('keeps the monochrome Aurixa glyph in the badge slot', () => {
    // Android discards badge colour and keeps only alpha, so a client's
    // full-colour logo would render as a grey block.
    setBrandNotificationIcon('https://cdn.example.com/tenant-mark.png');
    expect(getNotificationBadge()).toContain(AURIXA_NOTIFICATION_BADGE);
  });

  it('ships the default artwork the fallbacks point at', () => {
    for (const asset of [AURIXA_NOTIFICATION_ICON, AURIXA_NOTIFICATION_BADGE]) {
      expect(existsSync(join(REPO_ROOT, 'public', asset))).toBe(true);
    }
  });

  it('leaves no stock-icon reference on any notification path', () => {
    for (const file of [
      'src/lib/desktopMessageAlerts.ts',
      'src/hooks/useEmailNotifications.tsx',
      'public/sw-push.js',
    ]) {
      const source = read(file);
      // The only permitted mentions are the constant that names it in order to
      // refuse it, and the comments explaining why.
      const offending = source
        .split('\n')
        .filter((line) => line.includes('favicon.ico'))
        .filter((line) => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*'))
        .filter((line) => !line.includes('STOCK_FAVICON ='));
      expect(offending).toEqual([]);
    }
  });

  it('publishes the tenant mark from BrandProvider so alerts follow branding', () => {
    const provider = read('src/branding/BrandProvider.tsx');
    expect(provider).toContain("setBrandNotificationIcon(getBrandAssetSrc(settings, 'favicon'))");
  });

  it('declares an explicit favicon so the browser never guesses the stock one', () => {
    // What this pins is that a favicon IS declared and is a platform asset —
    // not WHICH one. `platformBrand.ts` owns that, and the two slots are
    // deliberately different files: a notification icon must carry artwork
    // into all four corners (see the corner-artefact suite below, which exists
    // because a rounded-tile screenshot once put white corners on every
    // alert), while a tab icon wants alpha so it composites onto a light or a
    // dark tab strip. Pinning one filename here made the tab icon and the
    // notification icon impossible to separate.
    const html = read('index.html');
    expect(html).toMatch(/rel="icon"[^>]*href="\/brand\/aurixa-[^"]+\.png"/);
    expect(html).not.toContain('content="/favicon.ico"');
  });

  it('keeps the stock icon out of the PWA manifest', () => {
    expect(read('public/manifest.json')).not.toContain('favicon.ico');
  });
});

describe('the stock icon is gone from disk, not just unreferenced', () => {
  /**
   * sha256 of the scaffold's stock heart as it shipped: a 73x74 PNG that was
   * simply named `.ico`. Redirecting every *reference* away from
   * `/favicon.ico` still leaves that file being served at that URL, reachable
   * through a cached manifest, a platform-injected tag, or Chromium's own
   * fallback when a notification icon fails to load. It is pinned here so it
   * can never return by a dependency bump or a scaffold regeneration.
   */
  const STOCK_HEART_SHA256 =
    '29a40d56580a5366083461297773dbf146ec043d1156f432f5472cb3487f506b';

  const favicon = readFileSync(join(REPO_ROOT, 'public', 'favicon.ico'));

  it('no longer serves the stock heart at /favicon.ico', () => {
    expect(createHash('sha256').update(favicon).digest('hex')).not.toBe(STOCK_HEART_SHA256);
  });

  it('serves a real multi-size ICO rather than a PNG wearing an .ico name', () => {
    // The stock file was a bare PNG: `89 50 4E 47`. A genuine ICO opens with
    // reserved=0, type=1, then the image count.
    expect(favicon.readUInt16LE(0)).toBe(0);
    expect(favicon.readUInt16LE(2)).toBe(1);
    expect(favicon.readUInt16LE(4)).toBeGreaterThanOrEqual(4);
  });

  it('covers the sizes a browser actually asks for', () => {
    const count = favicon.readUInt16LE(4);
    const sizes = Array.from({ length: count }, (_, i) => {
      const width = favicon.readUInt8(6 + i * 16);
      return width === 0 ? 256 : width;
    });
    for (const required of [16, 32, 48]) expect(sizes).toContain(required);
  });

  it('generates the favicon from the brand source, so it cannot drift', () => {
    const script = read('scripts/brand/build-aurixa-icons.mjs');
    expect(script).toContain("'favicon.ico'");
    expect(script).toContain('buildIco');
  });

  /**
   * Every repo-side check here passed for days while production still served
   * the heart, because the site had simply never been republished — a state no
   * repository test can observe. The deploy verifier probes the live site
   * instead; it only works if it recognises the same stock file this suite
   * does, so the two constants are pinned together.
   */
  it('shares its stock-icon fingerprint with the deploy verifier', () => {
    const verifier = read('scripts/brand/verify-deployed-branding.mjs');
    expect(verifier).toContain(STOCK_HEART_SHA256);
  });

  it('has the deploy verifier wired to an npm script', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts['verify:branding']).toContain('verify-deployed-branding.mjs');
  });

  it('checks the surfaces that actually reveal a stale deploy', () => {
    const verifier = read('scripts/brand/verify-deployed-branding.mjs');
    // A stale build betrays itself three ways: the old favicon, missing brand
    // assets, and a service worker still falling back to the stock icon.
    expect(verifier).toContain('/favicon.ico');
    expect(verifier).toContain(AURIXA_NOTIFICATION_ICON);
    expect(verifier).toContain('/sw-push.js');
  });

  /**
   * "Is the heart gone and is something branded served?" was true of a
   * deployment two builds behind, so the verifier passed while production
   * showed the previous artwork. Presence is not freshness: only the bytes are.
   */
  it('compares served bytes against the committed file, not just presence', () => {
    const verifier = read('scripts/brand/verify-deployed-branding.mjs');
    expect(verifier).toContain('const TRACKED_ASSETS');
    expect(verifier).toContain('matches the committed file');
    expect(verifier).toContain('an OLDER BUILD is live');
  });

  it('tracks every shipped artwork surface, including the imported master', () => {
    const verifier = read('scripts/brand/verify-deployed-branding.mjs');
    for (const asset of [
      AURIXA_NOTIFICATION_ICON,
      AURIXA_NOTIFICATION_BADGE,
      '/brand/aurixa-notification-512.png',
      '/brand/aurixa-source.jpg',
    ]) {
      expect(verifier).toContain(asset);
    }
  });

  it('treats an imported master as optional so a vector-only checkout passes', () => {
    const verifier = read('scripts/brand/verify-deployed-branding.mjs');
    expect(verifier).toContain('optional: true');
    expect(verifier).toContain('if (!asset.optional)');
  });
});

/**
 * The bundled mark is a vector reconstruction. Replacing it with the official
 * export must not mean hand-editing six binaries and hoping they stay in step —
 * one command takes the real file and re-derives every surface from it.
 */
describe('supplying the official brand artwork', () => {
  const script = read('scripts/brand/build-aurixa-icons.mjs');

  it('accepts a local path or a URL as the master', () => {
    expect(script).toContain("argv.indexOf('--import')");
    // A URL matters: the logo usually arrives in the public branding bucket
    // rather than on the machine running the build.
    expect(script).toContain('await fetch(from');
  });

  it('rejects anything that is not an image the browser can draw', () => {
    expect(script).toContain('function sniffImage');
    for (const magic of ['89504e47', 'ffd8ff', '52494646']) {
      expect(script).toContain(magic);
    }
  });

  it('keeps exactly one master so the next run cannot pick the wrong one', () => {
    expect(script).toContain('const stale = join(BRAND_DIR, `${SOURCE_STEM}.${ext}`)');
    expect(script).toContain('rmSync(stale)');
  });

  it('prefers an imported master over the vector for full-colour surfaces', () => {
    expect(script).toContain('if (importedSource && !transparent)');
    expect(script).toContain('renderSource(browser, importedSource, size)');
  });

  it('never lets an imported logo become the monochrome badge', () => {
    // Android keeps only the badge's alpha, so a full-colour logo returns as a
    // grey block. `transparent` marks the badge, and it always uses the glyph.
    const renderFn = script.slice(script.indexOf('async function render(browser'));
    expect(renderFn).toContain('!transparent');
    expect(renderFn).toContain('renderSvg(');
  });

  it('contains the source rather than cropping it', () => {
    // A wide or square export must survive without having its edges cut off.
    expect(script).toContain('object-fit:contain');
  });

  it('can be put back to the bundled vector', () => {
    expect(script).toContain("argv.includes('--reset')");
  });

  /**
   * Brand artwork arrives as a lockup — symbol, wordmark, backdrop. Contain-
   * fitting a 3:2 lockup into a 48px notification icon yields a letterboxed
   * strip with an illegible wordmark, so the symbol is cropped out. The
   * rectangle is recorded rather than guessed at render time, which is what
   * makes the result reproducible and reviewable.
   */
  it('records the crop rectangle instead of re-deriving it each run', () => {
    expect(script).toContain("argv.indexOf('--crop')");
    expect(script).toContain('aurixa-source.crop.json');
    expect(script).toContain('function readStoredCrop');
  });

  it('rejects a malformed crop rather than silently rendering the whole lockup', () => {
    expect(script).toContain('--crop expects four non-negative numbers');
    expect(script).toContain('--crop width and height must be positive');
  });

  it('places the crop from the image natural size, not a CSS percentage', () => {
    // A percentage resolves against the tile, which scaled the artwork wrongly
    // and left the wordmark showing through the bottom of the icon.
    expect(script).toContain('img.naturalWidth * k');
  });

  it('drops a stale crop when the source or the vector is swapped back in', () => {
    // A crop measured against one image is meaningless against another.
    expect(script).toContain('if (existsSync(CROP_FILE)) rmSync(CROP_FILE);');
  });

  it('ships the imported master and its crop so a checkout regenerates identically', () => {
    const brandDir = join(REPO_ROOT, 'public', 'brand');
    const sources = ['aurixa-source.png', 'aurixa-source.jpg', 'aurixa-source.jpeg',
      'aurixa-source.webp', 'aurixa-source.svg'].filter((f) => existsSync(join(brandDir, f)));
    // Either the vector is in play (no master) or exactly one master exists —
    // never two, or the next run could pick the wrong one.
    expect(sources.length).toBeLessThanOrEqual(1);
    if (sources.length === 1 && existsSync(join(brandDir, 'aurixa-source.crop.json'))) {
      const crop = JSON.parse(readFileSync(join(brandDir, 'aurixa-source.crop.json'), 'utf8'));
      for (const key of ['x', 'y', 'w', 'h']) expect(typeof crop[key]).toBe('number');
      expect(crop.w).toBeGreaterThan(0);
      expect(crop.h).toBeGreaterThan(0);
    }
  });

  it('is reachable as an npm script', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts['brand:import']).toContain('--import');
  });
});

/**
 * Minimal PNG reader: enough to sample corner pixels of the 8-bit RGB/RGBA
 * icons this repo generates. Worth the ~40 lines — the white-corner bug was
 * invisible to every source-level check and only existed in the pixels.
 */
function readPngPixels(absolutePath: string) {
  const file = readFileSync(absolutePath);
  let offset = 8;
  let width = 0;
  let height = 0;
  let colourType = 0;
  const idat: Buffer[] = [];

  while (offset < file.length) {
    const length = file.readUInt32BE(offset);
    const type = file.subarray(offset + 4, offset + 8).toString('ascii');
    const data = file.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colourType = data.readUInt8(9);
    } else if (type === 'IDAT') {
      idat.push(data);
    }
    offset += 12 + length;
  }

  const channels = colourType === 6 ? 4 : colourType === 2 ? 3 : 0;
  if (!channels) throw new Error(`Unsupported PNG colour type ${colourType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rows: Buffer[] = [];
  let previous = Buffer.alloc(stride);
  let cursor = 0;

  for (let y = 0; y < height; y++) {
    const filter = raw[cursor++];
    const line = Buffer.from(raw.subarray(cursor, cursor + stride));
    cursor += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0;
      const b = previous[x];
      const c = x >= channels ? previous[x - channels] : 0;
      if (filter === 1) line[x] = (line[x] + a) & 0xff;
      else if (filter === 2) line[x] = (line[x] + b) & 0xff;
      else if (filter === 3) line[x] = (line[x] + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        line[x] = (line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
    }
    rows.push(line);
    previous = line;
  }

  return {
    width,
    height,
    channels,
    pixel(x: number, y: number) {
      const row = rows[y];
      const at = x * channels;
      return {
        r: row[at],
        g: row[at + 1],
        b: row[at + 2],
        a: channels === 4 ? row[at + 3] : 255,
      };
    },
  };
}

/**
 * Icons were rendered on a rounded tile and screenshotted opaquely, so the area
 * outside the curve came out solid white — four white corners on every
 * notification. Artwork now runs edge to edge and platforms apply their own
 * masking.
 */
describe('the notification icon has no corner artefacts', () => {
  for (const asset of ['aurixa-notification-192.png', 'aurixa-notification-512.png']) {
    it(`${asset} carries artwork into all four corners`, () => {
      const png = readPngPixels(join(REPO_ROOT, 'public', 'brand', asset));
      const corners = [
        ['top-left', 1, 1],
        ['top-right', png.width - 2, 1],
        ['bottom-left', 1, png.height - 2],
        ['bottom-right', png.width - 2, png.height - 2],
      ] as const;

      for (const [name, x, y] of corners) {
        const { r, g, b, a } = png.pixel(x, y);
        // Not white: that was the artefact.
        expect(`${name}:${r},${g},${b}`).not.toMatch(/:2[45][0-9],2[45][0-9],2[45][0-9]$/);
        expect(r > 235 && g > 235 && b > 235).toBe(false);
        // Not a transparent hole either — the tile is filled to its edges.
        expect(a).toBeGreaterThan(200);
      }
    });
  }

  it('renders the tile square, letting the OS mask it', () => {
    const script = read('scripts/brand/build-aurixa-icons.mjs');
    expect(script).not.toContain('border-radius:${radius}px');
    // And never paints an opaque backdrop behind the artwork.
    expect(script).toContain('omitBackground: true');
    expect(script).not.toContain('omitBackground: !!transparent');
  });

  it('keeps the vector fallback square too, so both look alike', () => {
    for (const svg of ['aurixa-mark.svg', 'aurixa-mark-compact.svg']) {
      const source = read(`public/brand/${svg}`);
      expect(source).not.toMatch(/<rect width="512" height="512" rx="\d+"/);
    }
  });
});

describe('platform wiring', () => {
  it('mounts the alert surface on every dashboard route, mobile and desktop', () => {
    const layout = read('src/components/layout/DashboardLayout.tsx');
    expect(layout.match(/<InternalMessageToasts \/>/g)?.length).toBe(2);
  });

  it('exposes a durable way to turn alerts on or off', () => {
    const settings = read('src/pages/Settings.tsx');
    expect(settings).toContain('<DesktopMessageAlertsToggle />');
  });

  it('tags one notification per conversation so messages collapse, not stack', () => {
    expect(internalNotificationTag(THREAD)).toBe(`aurixa-internal-${THREAD}`);
  });

  it('keeps the in-app fallback for every non-OS outcome', () => {
    const toasts = read('src/components/agent/InternalMessageToasts.tsx');
    // Focused tab = the chip already told them; anything else owes a fallback.
    expect(toasts).toContain("if (outcome === 'suppressed-focused') return;");
    expect(toasts).toContain('missedRef.current.set(');
    expect(toasts).toContain('setTabUnreadBadge(totalUnread');
  });
});

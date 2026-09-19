/**
 * Verify that a DEPLOYED site is serving THIS checkout's branded artwork — not
 * merely *some* branded artwork.
 *
 * Why this exists, and why it grew: the branding work was merged to `main` and
 * the stock scaffold heart kept appearing in production for days. Every
 * repo-side check was green throughout, because the repository was right; the
 * site had simply never been republished. These HTTP probes caught that.
 *
 * Then they gave a FALSE GREEN. Once the artwork was replaced with the official
 * logo, the deployment still served the previous generation — right shape, wrong
 * build — and every check passed, because each only asked "is the heart gone and
 * is something branded being served?" Both were true. The verifier could not
 * tell "published" from "published two builds ago", which is the same blind spot
 * in a new costume.
 *
 * So it now compares the served BYTES against the committed ones. Identical or
 * it is not this build.
 *
 *   1. `/favicon.ico` is not the stock heart, and is a real ICO.
 *   2. Every committed brand asset is served with an identical sha256.
 *   3. `/sw-push.js` carries the branded default, not `/favicon.ico`.
 *
 * Usage:
 *   npm run verify:branding                        # uses DEPLOY_URL
 *   npm run verify:branding -- https://example.com
 *
 * Run it from an up-to-date checkout: it compares against your working tree, so
 * a stale checkout reports a mismatch it caused itself.
 */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

/**
 * Committed assets that must reach production byte-for-byte. `optional` covers
 * files that only exist once an official master has been imported.
 */
const TRACKED_ASSETS = [
  { url: '/brand/aurixa-notification-192.png', file: 'public/brand/aurixa-notification-192.png' },
  { url: '/brand/aurixa-notification-512.png', file: 'public/brand/aurixa-notification-512.png' },
  { url: '/brand/aurixa-badge-96.png', file: 'public/brand/aurixa-badge-96.png' },
  { url: '/favicon.ico', file: 'public/favicon.ico' },
  { url: '/brand/aurixa-source.jpg', file: 'public/brand/aurixa-source.jpg', optional: true },
  { url: '/brand/aurixa-source.png', file: 'public/brand/aurixa-source.png', optional: true },
];

/**
 * sha256 of the scaffold's stock heart as it shipped: a 73x74 PNG named `.ico`.
 * Pinned identically in `desktopMessageAlertsContract.test.ts` — if you change
 * one, change both.
 */
const STOCK_HEART_SHA256 =
  '29a40d56580a5366083461297773dbf146ec043d1156f432f5472cb3487f506b';

const BRANDED_ICON = '/brand/aurixa-notification-192.png';
const BRANDED_BADGE = '/brand/aurixa-badge-96.png';

const target = (process.argv[2] || process.env.DEPLOY_URL || '').replace(/\/+$/, '');
if (!target) {
  console.error('Usage: npm run verify:branding -- https://your-site.example');
  console.error('   or: DEPLOY_URL=https://your-site.example npm run verify:branding');
  process.exit(2);
}

// Some edges refuse requests without a browser-shaped User-Agent.
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Cache-Control': 'no-cache',
};

async function fetchPath(path) {
  try {
    const response = await fetch(`${target}${path}`, { headers: HEADERS, redirect: 'follow' });
    const buffer = Buffer.from(await response.arrayBuffer());
    return { ok: response.ok, status: response.status, buffer };
  } catch (error) {
    return { ok: false, status: 0, buffer: Buffer.alloc(0), error };
  }
}

const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}\n      ${detail}`);
};

console.log(`Verifying deployed branding at ${target}\n`);

// 1. The stock heart must not be served.
{
  const { ok, status, buffer } = await fetchPath('/favicon.ico');
  if (!ok) {
    record('favicon.ico is reachable', false, `HTTP ${status}`);
  } else {
    const digest = createHash('sha256').update(buffer).digest('hex');
    const isHeart = digest === STOCK_HEART_SHA256;
    // A genuine ICO opens reserved=0, type=1. The stock file was a bare PNG.
    const isIco = buffer.length > 6 && buffer.readUInt16LE(0) === 0 && buffer.readUInt16LE(2) === 1;
    record(
      'favicon.ico is not the stock heart',
      !isHeart,
      isHeart
        ? `serving the stock heart (sha256 ${digest.slice(0, 16)}…, ${buffer.length}b)`
        : `sha256 ${digest.slice(0, 16)}…, ${buffer.length}b`,
    );
    record(
      'favicon.ico is a real multi-size ICO',
      isIco,
      isIco
        ? `${buffer.readUInt16LE(4)} sub-images`
        : `header ${buffer.subarray(0, 4).toString('hex')} — not an ICO container`,
    );
  }
}

// 2. Every committed asset must be served, byte for byte.
//    A served-but-different asset is the failure mode that used to pass: the
//    deployment carries branded artwork, just not the artwork in this checkout.
let staleBuild = false;
for (const asset of TRACKED_ASSETS) {
  const localPath = join(ROOT, asset.file);
  if (!existsSync(localPath)) {
    // Optional assets simply are not part of this checkout.
    if (!asset.optional) record(`${asset.file} exists in the checkout`, false, 'missing locally');
    continue;
  }

  const expected = readFileSync(localPath);
  const { ok, status, buffer } = await fetchPath(asset.url);

  if (!ok) {
    staleBuild = true;
    record(
      `${asset.url} is served`,
      false,
      `HTTP ${status} — the deployment predates this asset entirely`,
    );
    continue;
  }

  const servedDigest = sha256(buffer);
  const expectedDigest = sha256(expected);
  const match = servedDigest === expectedDigest;
  if (!match) staleBuild = true;
  record(
    `${asset.url} matches the committed file`,
    match,
    match
      ? `sha256 ${servedDigest.slice(0, 12)}…, ${buffer.length}b`
      : `served ${servedDigest.slice(0, 12)}… (${buffer.length}b) but this checkout has ` +
        `${expectedDigest.slice(0, 12)}… (${expected.length}b) — an OLDER BUILD is live`,
  );
}

// 3. The service worker's fallback must be branded.
{
  const { ok, status, buffer } = await fetchPath('/sw-push.js');
  const source = buffer.toString('utf8');
  const stockFallback = source.includes("data.icon || '/favicon.ico'");
  const brandedFallback = source.includes('DEFAULT_NOTIFICATION_ICON');
  record(
    'sw-push.js falls back to branded artwork',
    ok && brandedFallback && !stockFallback,
    !ok
      ? `HTTP ${status}`
      : stockFallback
        ? "still falls back to '/favicon.ico' — this build predates the fix"
        : brandedFallback
          ? 'branded default present'
          : 'unrecognised service worker',
  );
}

const failed = results.filter((r) => !r.pass);
console.log('');
if (!failed.length) {
  console.log(
    `All ${results.length} checks passed — the deployment is serving exactly this checkout's artwork.`,
  );
  process.exit(0);
}

console.error(`${failed.length} of ${results.length} checks failed.`);
if (staleBuild) {
  console.error(
    '\nAn OLDER BUILD is live. The repository can be entirely correct while this\n' +
      'fails — it means the site has not been rebuilt and republished since the\n' +
      'change merged. Publish the current `main`, then re-run this command.\n' +
      '\nIf you are running from a checkout that is behind `main`, pull first: this\n' +
      'compares against your working tree.',
  );
}
console.error(
  '\nBrowsers cache favicons and service workers aggressively, so a hard reload\n' +
    '(or a fresh profile) may be needed before a human sees a change that IS live.',
);
process.exit(1);

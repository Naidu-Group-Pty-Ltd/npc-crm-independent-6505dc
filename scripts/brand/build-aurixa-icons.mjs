/**
 * Rasterise the Aurixa Systems mark into every raster surface the app serves.
 *
 * Why PNG and not the SVG directly: Chromium does not reliably decode SVG for
 * `Notification.icon` / `badge`, and Android's status-bar badge needs a real
 * alpha channel. The SVGs in `public/brand/` stay the source of truth — run
 * `npm run brand:icons` after editing one.
 *
 * SUPPLYING THE OFFICIAL ARTWORK
 * The bundled SVG is a vector reconstruction. To replace it with the real
 * exported logo, hand this script the file — local path or any URL, including a
 * Supabase public `branding-assets` URL:
 *
 *   npm run brand:icons -- --import ./aurixa-systems-logo.png
 *   npm run brand:icons -- --import https://…/branding-assets/…/logo.png
 *
 * It is stored as `public/brand/aurixa-source.<ext>` and, from then on, every
 * derived asset — notification icon, favicon.ico, all sizes — is rendered from
 * it instead of the SVG. `--import --reset` goes back to the vector.
 *
 * A source image is centred on the brand tile with `object-fit: contain`, so a
 * transparent export, a square export and a wide export all come out legible at
 * the ~48px a notification actually renders.
 *
 * `public/favicon.ico` is generated here too, and that is deliberate. Redirecting
 * every *reference* away from the stock scaffold icon still leaves the stock icon
 * being served at `/favicon.ico` — reachable through a cached manifest, a
 * platform-injected tag, or Chromium's own fallback when a notification icon
 * fails to load. Owning the file closes that off.
 *
 * Usage:
 *   npm run brand:icons            # regenerate
 *   npm run brand:icons -- --check # fail if the committed output is stale
 */
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const BRAND_DIR = join(ROOT, 'public', 'brand');
const PUBLIC_DIR = join(ROOT, 'public');

const FULL = 'aurixa-mark.svg';
/** Rings and speculars turn to noise below ~48px; the compact mark drops them. */
const COMPACT = 'aurixa-mark-compact.svg';

/** Standalone PNGs. `transparent` keeps the alpha for badge glyphs. */
const PNG_TARGETS = [
  { svg: FULL, out: 'aurixa-notification-192.png', size: 192, transparent: false },
  { svg: FULL, out: 'aurixa-notification-512.png', size: 512, transparent: false },
  { svg: 'aurixa-badge.svg', out: 'aurixa-badge-96.png', size: 96, transparent: true },
];

/** Sub-images packed into favicon.ico, smallest first. */
const ICO_SIZES = [
  { svg: COMPACT, size: 16 },
  { svg: COMPACT, size: 32 },
  { svg: FULL, size: 48 },
  { svg: FULL, size: 64 },
  { svg: FULL, size: 128 },
  { svg: FULL, size: 256 },
];

const argv = process.argv.slice(2);
const check = argv.includes('--check');
const resetToVector = argv.includes('--reset');
const importIndex = argv.indexOf('--import');
const importFrom = importIndex >= 0 ? argv[importIndex + 1] : null;

/**
 * Optional `--crop x,y,w,h` in source pixels.
 *
 * Brand artwork usually arrives as a full lockup — symbol, wordmark, backdrop.
 * At the ~48px a notification renders, contain-fitting a 3:2 lockup gives a
 * letterboxed strip with an illegible wordmark. Icons want the symbol, so the
 * crop is recorded explicitly here rather than guessed at render time, which
 * keeps it reproducible and reviewable.
 */
const cropIndex = argv.indexOf('--crop');
const cropArg = cropIndex >= 0 ? argv[cropIndex + 1] : null;
const CROP_FILE = join(BRAND_DIR, 'aurixa-source.crop.json');

function parseCrop(value) {
  const parts = String(value).split(',').map((n) => Number(n.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0)) {
    throw new Error('--crop expects four non-negative numbers: x,y,w,h');
  }
  const [x, y, w, h] = parts;
  if (w <= 0 || h <= 0) throw new Error('--crop width and height must be positive');
  return { x, y, w, h };
}

function readStoredCrop() {
  if (!existsSync(CROP_FILE)) return null;
  try {
    return JSON.parse(readFileSync(CROP_FILE, 'utf8'));
  } catch {
    return null;
  }
}

/** Raster master, when one has been imported. Preferred over the SVG. */
const SOURCE_STEM = 'aurixa-source';
const SOURCE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'svg'];

function findImportedSource() {
  for (const ext of SOURCE_EXTENSIONS) {
    const candidate = join(BRAND_DIR, `${SOURCE_STEM}.${ext}`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const MIME_BY_MAGIC = [
  { magic: '89504e47', ext: 'png', mime: 'image/png' },
  { magic: 'ffd8ff', ext: 'jpg', mime: 'image/jpeg' },
  { magic: '52494646', ext: 'webp', mime: 'image/webp' },
];

function sniffImage(buffer) {
  const head = buffer.subarray(0, 4).toString('hex');
  for (const entry of MIME_BY_MAGIC) {
    if (head.startsWith(entry.magic)) return entry;
  }
  if (buffer.subarray(0, 512).toString('utf8').includes('<svg')) {
    return { ext: 'svg', mime: 'image/svg+xml' };
  }
  return null;
}

async function importSource(from) {
  let buffer;
  if (/^https?:\/\//i.test(from)) {
    const response = await fetch(from, { headers: { 'User-Agent': 'brand-icons/1.0' } });
    if (!response.ok) throw new Error(`Could not fetch ${from} — HTTP ${response.status}`);
    buffer = Buffer.from(await response.arrayBuffer());
  } else {
    buffer = readFileSync(from);
  }

  const kind = sniffImage(buffer);
  if (!kind) {
    throw new Error(
      'That file is not a PNG, JPEG, WebP or SVG. Export the logo as one of those and try again.',
    );
  }

  // Exactly one source may exist, or the next run would not know which won.
  for (const ext of SOURCE_EXTENSIONS) {
    const stale = join(BRAND_DIR, `${SOURCE_STEM}.${ext}`);
    if (existsSync(stale)) rmSync(stale);
  }

  if (existsSync(CROP_FILE)) rmSync(CROP_FILE);

  const target = join(BRAND_DIR, `${SOURCE_STEM}.${kind.ext}`);
  writeFileSync(target, buffer);
  console.log(`imported ${from}\n      -> public/brand/${SOURCE_STEM}.${kind.ext} (${buffer.length} bytes)`);
  return target;
}

/**
 * Pack PNGs into an ICO container. Every browser in support has read
 * PNG-compressed ICO entries for over a decade, so no BMP encoding is needed.
 */
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  const directory = Buffer.alloc(16 * entries.length);
  let offset = header.length + directory.length;

  entries.forEach((entry, i) => {
    const at = i * 16;
    // 256 is stored as 0 — the field is a single byte.
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, at);
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, at + 1);
    directory.writeUInt8(0, at + 2); // palette size (0 = truecolour)
    directory.writeUInt8(0, at + 3); // reserved
    directory.writeUInt16LE(1, at + 4); // colour planes
    directory.writeUInt16LE(32, at + 6); // bits per pixel
    directory.writeUInt32LE(entry.buffer.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += entry.buffer.length;
  });

  return Buffer.concat([header, directory, ...entries.map((e) => e.buffer)]);
}

/**
 * The obsidian field an imported logo is centred on. Mirrors the SVG's own
 * backdrop so a swapped-in source still matches the rest of the set, and gives
 * a transparent export something to sit against in a light notification shade.
 */
const TILE_BACKGROUND =
  'radial-gradient(circle at 50% 40%, #14315B 0%, #0B1F3C 42%, #050D1B 100%)';

async function renderSource(browser, sourcePath, size) {
  const buffer = readFileSync(sourcePath);
  const kind = sniffImage(buffer) ?? { mime: 'image/png' };
  const dataUri = `data:${kind.mime};base64,${buffer.toString('base64')}`;
  const crop = readStoredCrop();
  const page = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  });

  /**
   * Icons are rendered EDGE TO EDGE, with no corner radius.
   *
   * Rounding them here baked the shape into the bitmap, and because a
   * screenshot is opaque by default the area outside the curve came out solid
   * white — four white corners on every notification. Platforms already mask
   * icons to their own shape (Windows squares them, Android may circle them),
   * so the artwork stays square and lets the OS decide. `omitBackground` below
   * is the belt to that braces: nothing outside the artwork can be opaque.
   */
  const body = crop
    // A recorded crop already isolates a square symbol on its own backdrop, so
    // it fills the frame. Placement is computed from the image's NATURAL size
    // once it has decoded — a CSS percentage would resolve against the tile.
    ? `<style>
         html,body{margin:0;padding:0;background:transparent}
         .tile{width:${size}px;height:${size}px;
               background:${TILE_BACKGROUND};overflow:hidden;position:relative}
         img{position:absolute;display:block;transform-origin:0 0}
       </style>
       <div class="tile"><img src="${dataUri}"></div>`
    // No crop: contain the whole artwork so nothing is cut off.
    : `<style>
         html,body{margin:0;padding:0;background:transparent}
         .tile{width:${size}px;height:${size}px;
               background:${TILE_BACKGROUND};
               display:flex;align-items:center;justify-content:center;overflow:hidden}
         img{width:82%;height:82%;object-fit:contain;display:block}
       </style>
       <div class="tile"><img src="${dataUri}"></div>`;

  await page.setContent(`<!doctype html><meta charset="utf-8">${body}`, { waitUntil: 'load' });
  await page.waitForFunction(() => {
    const img = document.querySelector('img');
    return !!img && img.complete && img.naturalWidth > 0;
  }, undefined, { timeout: 15000 });

  if (crop) {
    // Scale so the crop's width maps exactly onto the tile, then shift the
    // crop's origin to the tile's origin.
    await page.evaluate(({ crop: c, size: s }) => {
      const img = document.querySelector('img');
      const k = s / c.w;
      img.style.width = `${img.naturalWidth * k}px`;
      img.style.height = 'auto';
      img.style.left = `${-c.x * k}px`;
      img.style.top = `${-c.y * k}px`;
    }, { crop, size });
  }

  const shot = await page.screenshot({ omitBackground: true });
  await page.close();
  return shot;
}

async function renderSvg(browser, svgName, size, transparent) {
  const svg = readFileSync(join(BRAND_DIR, svgName), 'utf8');
  const page = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<!doctype html><meta charset="utf-8">
     <style>
       html,body{margin:0;padding:0;background:transparent}
       svg{display:block;width:${size}px;height:${size}px}
     </style>
     ${svg}`,
    { waitUntil: 'load' },
  );
  // Always omit the backdrop: the SVG paints its own field, and anything
  // outside it must be transparent rather than white.
  const buffer = await page.screenshot({ omitBackground: true });
  await page.close();
  return buffer;
}

/**
 * An imported master wins for every full-colour surface. The badge glyph never
 * uses it: Android keeps only the alpha channel there, so a full-colour logo
 * returns as a grey block — see `aurixa-badge.svg`.
 */
async function render(browser, svgName, size, transparent) {
  if (importedSource && !transparent) {
    return renderSource(browser, importedSource, size);
  }
  return renderSvg(browser, svgName, size, transparent);
}

/**
 * CI images often ship one Chromium build while the pinned Playwright wants
 * another, so try an explicit binary, then the managed one.
 */
async function launch() {
  const candidates = [process.env.CHROMIUM_EXECUTABLE_PATH, undefined];
  let lastError;
  for (const executablePath of candidates) {
    try {
      return await chromium.launch(executablePath ? { executablePath } : {});
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/**
 * Resolved before anything renders: `render()` consults it to decide whether a
 * surface comes from the imported master or the bundled vector.
 */
let importedSource = findImportedSource();

if (resetToVector) {
  for (const ext of SOURCE_EXTENSIONS) {
    const stale = join(BRAND_DIR, `${SOURCE_STEM}.${ext}`);
    if (existsSync(stale)) {
      rmSync(stale);
      console.log(`removed public/brand/${SOURCE_STEM}.${ext}`);
    }
  }
  if (existsSync(CROP_FILE)) {
    rmSync(CROP_FILE);
    console.log('removed public/brand/aurixa-source.crop.json');
  }
  importedSource = null;
}

if (importFrom) {
  if (check) {
    console.error('--import cannot be combined with --check.');
    process.exit(2);
  }
  try {
    importedSource = await importSource(importFrom);
  } catch (error) {
    console.error(String(error?.message ?? error));
    process.exit(1);
  }
}

if (cropArg) {
  if (!importedSource) {
    console.error('--crop needs an imported source. Run with --import first.');
    process.exit(2);
  }
  try {
    const crop = parseCrop(cropArg);
    writeFileSync(CROP_FILE, `${JSON.stringify(crop, null, 2)}\n`);
    console.log(`crop:   ${crop.w}x${crop.h} at (${crop.x}, ${crop.y}) of the source`);
  } catch (error) {
    console.error(String(error?.message ?? error));
    process.exit(2);
  }
}

console.log(
  importedSource
    ? `source: imported master (${importedSource.split('/').pop()})`
    : 'source: bundled vector (aurixa-mark.svg) — supply the official export with --import',
);

let browser;
try {
  browser = await launch();
} catch (error) {
  // Freshness checking is advisory: an agent without a browser should not turn
  // a green pipeline red over artwork nobody touched.
  const hint =
    'No usable Chromium. Set CHROMIUM_EXECUTABLE_PATH or run: npx playwright install chromium';
  if (check) {
    console.warn(`skip  icon freshness check — ${hint}`);
    process.exit(0);
  }
  console.error(`${hint}\n${error?.message ?? error}`);
  process.exit(1);
}

let stale = 0;

function emit(absolutePath, label, buffer) {
  const current = existsSync(absolutePath) ? readFileSync(absolutePath) : null;
  if (current && current.equals(buffer)) {
    console.log(`ok    ${label}`);
    return;
  }
  if (check) {
    stale += 1;
    console.error(`stale ${label} — run: npm run brand:icons`);
    return;
  }
  writeFileSync(absolutePath, buffer);
  console.log(`wrote ${label} (${buffer.length} bytes)`);
}

try {
  mkdirSync(BRAND_DIR, { recursive: true });

  for (const target of PNG_TARGETS) {
    const buffer = await render(browser, target.svg, target.size, target.transparent);
    emit(join(BRAND_DIR, target.out), target.out, buffer);
  }

  const icoEntries = [];
  for (const entry of ICO_SIZES) {
    icoEntries.push({ size: entry.size, buffer: await render(browser, entry.svg, entry.size) });
  }
  emit(join(PUBLIC_DIR, 'favicon.ico'), 'favicon.ico', buildIco(icoEntries));
} finally {
  await browser.close();
}

if (stale) process.exit(1);

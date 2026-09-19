/**
 * Seed `Listing Images` in Airtable by scraping each listing's own source page.
 *
 * This is the manual counterpart of the `listing-enrichment` sweep, for the
 * situation where the edge functions cannot be deployed but the marketplace
 * needs photographs now. It was run on 2026-08-04 over the newest 320 records:
 * 232 pages reachable, 80 records seeded after junk filtering (tracking pixels,
 * agent headshots, homepage furniture, award badges, and index pages that mix
 * photographs of different properties).
 *
 * Why writing to Airtable is the whole trick: `Listing Images` is a
 * multipleAttachments field, so Airtable downloads and re-hosts the bytes
 * itself the moment a URL lands in it — link rot solved by the system of
 * record. The cache sync mirrors the attachments within its next 10-minute
 * walk, the client sends them to the deployed `listing-images` `op:'resolve'`
 * as harvest candidates, and photographs appear with no function deploy at all.
 *
 * Usage:
 *   node scripts/listings/seed-listing-images.mjs worklist.json out.json
 * where worklist.json is [{id, src, web}] (Airtable record id, Source Web Link,
 * Web Link). Writing `out.json` to Airtable needs an API token and is done
 * separately — this script only fetches and filters.
 *
 * Extraction is the repo's own `listingScrape.pure.ts`, bundled on the fly, so
 * the manual path and the deployed sweep can never disagree about what counts
 * as a property photograph.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-images-'));
const entry = path.join(tmp, 'entry.ts');
fs.writeFileSync(entry, [
  `export { scrapeListingPage } from '${repo}/supabase/functions/_shared/listingScrape.pure.ts';`,
  `export { isBlockedHost } from '${repo}/supabase/functions/_shared/listingUrlPolicy.pure.ts';`,
].join('\n'));
execSync(`npx esbuild ${entry} --bundle --format=cjs --platform=node --outfile=${tmp}/lib.cjs`, { stdio: 'inherit' });
// CJS bundle + ESM import interop is unreliable for named exports; require()
// sees the exports object directly and always works.
import { createRequire } from 'node:module';
const { scrapeListingPage, isBlockedHost } = createRequire(import.meta.url)(path.join(tmp, 'lib.cjs'));

const [, , worklistPath, outPath] = process.argv;
const work = JSON.parse(fs.readFileSync(worklistPath, 'utf8'));

const MAX_HOPS = 5;
const TIMEOUT_MS = 12_000;
const CONCURRENCY = 8;
const MAX_IMAGES = 12;
/** An identical URL on more than this many listings is branding, not property. */
const CROSS_LISTING_CAP = 4;
/** Junk that survives even a property-CDN allowlist. */
const JUNK = /empty\.gif|spacer|1x1|pixel|\/profile_image\/|\/images\/home\/|placeholder|no[-_]?image|unsplash|award|newsletter|office.?template|team-members|memberphotos|logo|banner/i;
/** URL shapes observed to carry actual listing photography. */
const PROPERTY = /propertyphotos\.vaultre|googleusercontent\.com\/d\/|agentboxcdn.*?\/lt\/|agentboxcrm.*?\/lt-|rexsoftware\.com\/.*\/listings\/|peakcentral\.edge|\/active_storage\/|wp-content\/uploads|\/upload-data\/images\/|\/images\/properties\/|arosoftware.*\/listings\/|cdn\.idashboard|dynamics\.net\/s3\/rw-propertyimages/i;

function guarded(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (isBlockedHost(u.hostname)) return null;
  if (/^[0-9.]+$/.test(u.hostname) || u.hostname.includes(':')) return null;
  return u.toString();
}

async function follow(raw) {
  let current = guarded(raw);
  for (let hop = 0; hop <= MAX_HOPS && current; hop++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(current, { redirect: 'manual', signal: ctrl.signal, headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36', accept: 'text/html,*/*' } });
    } finally { clearTimeout(t); }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return { error: 'redirect_no_location' };
      current = guarded(new URL(loc, current).toString());
      if (!current) return { error: 'redirect_blocked' };
      continue;
    }
    if (!res.ok) return { error: `http_${res.status}` };
    if (!(res.headers.get('content-type') || '').includes('html')) return { error: 'not_html' };
    const html = await res.text();
    if (html.length > 3_000_000) return { error: 'too_large' };
    return { html, finalUrl: current };
  }
  return { error: 'too_many_hops' };
}

/** Photographs of several different listings on one page = an index, not our property. */
function looksLikeIndex(urls) {
  const tokens = new Set();
  for (const u of urls) for (const m of u.matchAll(/\/1P(\d+)\/|\/listings\/(\d+)\/|-H(\d{6,})-/g)) tokens.add(m[1] ?? m[2] ?? m[3]);
  return tokens.size > 1;
}

const results = {};
const seen = new Map();
const meta = { fetched: 0, resolved: 0, withImages: 0, errors: {} };
let i = 0;
async function worker() {
  while (i < work.length) {
    const w = work[i++];
    meta.fetched++;
    let out;
    try { out = await follow(w.src || w.web); }
    catch (e) { out = { error: e?.name === 'AbortError' ? 'timeout' : String(e?.message ?? e).slice(0, 60) }; }
    if (out.error) { meta.errors[out.error] = (meta.errors[out.error] ?? 0) + 1; continue; }
    meta.resolved++;
    const decoded = (u) => u.replaceAll('&amp;', '&');
    const urls = (scrapeListingPage(out.html, out.finalUrl).imageUrls ?? [])
      .map(decoded)
      .filter((u) => PROPERTY.test(u) && !JUNK.test(u))
      .slice(0, MAX_IMAGES);
    if (urls.length === 0 || looksLikeIndex(urls)) continue;
    results[w.id] = urls;
    meta.withImages++;
    for (const u of urls) seen.set(u, (seen.get(u) ?? 0) + 1);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

for (const [id, urls] of Object.entries(results)) {
  const kept = urls.filter((u) => (seen.get(u) ?? 0) <= CROSS_LISTING_CAP);
  if (kept.length === 0) { delete results[id]; meta.withImages--; }
  else results[id] = kept;
}

fs.writeFileSync(outPath, JSON.stringify(results, null, 1));
console.log(JSON.stringify(meta, null, 2));

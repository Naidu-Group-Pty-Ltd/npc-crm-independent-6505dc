/**
 * Find photographs for listings that arrived with no source link at all.
 *
 * `seed-listing-images.mjs` follows the link a record already carries. 384 of
 * the 1,441 records carry none — they were parsed out of an email body, so the
 * marketplace knows the address and the price and has no idea what the house
 * looks like. This script is the second pass for those, and it runs **only
 * after** the link-following pass has taken everything it can, because a
 * record's own link is always better evidence than anything found by searching.
 *
 * ## Why the agency's own site, and not a portal
 *
 * realestate.com.au answers 429 to a plain fetch (Kasada) and 403 through a
 * rendering reader; domain.com.au answers 403. Both also restrict re-use of
 * listing imagery in their terms. The agency that emailed us the listing
 * publishes the same photographs on its own site, is happy to be linked, and —
 * measured here — is reachable. So the route is: identify the agency, read its
 * for-sale index, and match by address.
 *
 * ## Why matching is the hard part
 *
 * Searching for a property you have no link to means you can find the wrong
 * one. A wrong photograph on a marketplace card is worse than a grey box: it is
 * a claim about a specific house at a specific price. `addressMatch.pure.ts`
 * therefore refuses anything short of street number + street name + suburb, and
 * this script never falls back to a looser rule when strict matching finds
 * nothing. Records simply stay unmatched.
 *
 * Usage:
 *   node scripts/listings/source-listing-images-externally.mjs targets.json out.json
 *
 * `targets.json` is [{id, addr, sub, st, agency, indexUrls: [...]}]. Discovery
 * of `indexUrls` is deliberately manual: an agency index is found once, by a
 * person, and reused for every listing that agency sent us.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'source-images-'));
fs.writeFileSync(path.join(tmp, 'entry.ts'), [
  `export { scrapeListingPage } from '${repo}/supabase/functions/_shared/listingScrape.pure.ts';`,
  `export { isBlockedHost } from '${repo}/supabase/functions/_shared/listingUrlPolicy.pure.ts';`,
  `export { isSameProperty } from '${repo}/supabase/functions/_shared/addressMatch.pure.ts';`,
].join('\n'));
execSync(`npx esbuild ${path.join(tmp, 'entry.ts')} --bundle --format=cjs --platform=node --outfile=${tmp}/lib.cjs`, { stdio: 'inherit' });
const { scrapeListingPage, isBlockedHost, isSameProperty } = createRequire(import.meta.url)(path.join(tmp, 'lib.cjs'));

const [, , targetsPath, outPath] = process.argv;
const targets = JSON.parse(fs.readFileSync(targetsPath, 'utf8'));

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const TIMEOUT_MS = 20_000;
const MAX_INDEX_PAGES = 12;
const MAX_IMAGES = 8;
/** Politeness: agency sites are small, and this is their bandwidth. */
const DELAY_MS = 350;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function guarded(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (isBlockedHost(u.hostname)) return null;
  if (/^[0-9.]+$/.test(u.hostname) || u.hostname.includes(':')) return null;
  return u.toString();
}

async function get(url) {
  const safe = guarded(url);
  if (!safe) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(safe, { redirect: 'follow', signal: ctrl.signal, headers: { 'user-agent': UA, accept: 'text/html,*/*' } });
    if (!res.ok) return null;
    if (!(res.headers.get('content-type') || '').includes('html')) return null;
    const html = await res.text();
    return html.length > 4_000_000 ? null : { html, finalUrl: res.url || safe };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** The address a listing page claims, from the metadata agents actually fill in. */
function pageAddress(html) {
  const pick = (re) => {
    const m = html.match(re);
    return m ? m[1].replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").trim() : null;
  };
  return (
    pick(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i) ||
    pick(/<title[^>]*>([^<]+)</i) ||
    pick(/<h1[^>]*>([^<]+)</i)
  );
}

/** Every same-host link from an index page that looks like a property. */
function propertyLinks(html, baseUrl) {
  const host = new URL(baseUrl).hostname.replace(/^www\./, '');
  const out = new Set();
  for (const m of html.matchAll(/href="([^"]+)"/g)) {
    let u;
    try { u = new URL(m[1].replace(/&amp;/g, '&'), baseUrl); } catch { continue; }
    if (u.hostname.replace(/^www\./, '') !== host) continue;
    // Property pages are either a numeric id or a /property/-style path. Index,
    // search and pagination URLs are excluded so the crawl cannot walk sideways.
    if (/\/\d{5,}\/?$/.test(u.pathname) || /\/(property|listing|properties)\/[^/]+\/?$/.test(u.pathname)) {
      u.hash = '';
      out.add(u.toString());
    }
  }
  return [...out];
}

const results = {};
const meta = { agencies: 0, indexPages: 0, propertyPages: 0, matched: 0, unmatched: 0, byAgency: {} };

// One crawl per agency, shared by all of that agency's records.
const byAgency = new Map();
for (const t of targets) {
  const key = (t.agency || 'unknown') + '|' + (t.indexUrls || []).join(',');
  if (!byAgency.has(key)) byAgency.set(key, []);
  byAgency.get(key).push(t);
}

for (const [key, group] of byAgency) {
  const indexUrls = group[0].indexUrls || [];
  if (indexUrls.length === 0) continue;
  meta.agencies++;
  const label = group[0].agency || 'unknown';
  const seenPages = new Set();

  // 1. Collect property URLs from every index page given.
  const candidates = new Set();
  for (const base of indexUrls.slice(0, MAX_INDEX_PAGES)) {
    const page = await get(base);
    meta.indexPages++;
    if (!page) continue;
    for (const u of propertyLinks(page.html, page.finalUrl)) candidates.add(u);
    await sleep(DELAY_MS);
  }

  // 2. Read each property page once, keep address + photographs.
  const pages = [];
  for (const url of candidates) {
    if (seenPages.has(url)) continue;
    seenPages.add(url);
    const page = await get(url);
    meta.propertyPages++;
    await sleep(DELAY_MS);
    if (!page) continue;
    const address = pageAddress(page.html);
    if (!address) continue;
    const images = (scrapeListingPage(page.html, page.finalUrl).imageUrls || [])
      .map((u) => u.replace(/&amp;/g, '&'))
      .slice(0, MAX_IMAGES);
    if (images.length === 0) continue;
    pages.push({ url: page.finalUrl, address, images });
  }

  // 3. Strict match. A record with two candidate pages is left unmatched —
  //    ambiguity here means we do not actually know which house it is.
  let matched = 0;
  for (const t of group) {
    const hits = pages.filter((p) => isSameProperty({ address: t.addr, suburb: t.sub }, { address: p.address }));
    if (hits.length === 1) {
      results[t.id] = { images: hits[0].images, source: hits[0].url, matchedAddress: hits[0].address };
      matched++;
      meta.matched++;
    } else {
      meta.unmatched++;
    }
  }
  meta.byAgency[label] = { records: group.length, pages: pages.length, matched };
  console.error(`${label}: ${pages.length} pages, ${matched}/${group.length} matched`);
}

fs.writeFileSync(outPath, JSON.stringify(results, null, 1));
console.log(JSON.stringify(meta, null, 2));

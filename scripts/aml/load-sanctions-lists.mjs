#!/usr/bin/env node
/**
 * Load the official sanctions lists into `aml.sanctions_entries`.
 *
 * Sources are the PUBLISHERS' own files, not an aggregator:
 *   - DFAT Consolidated List — the legally operative Australian source
 *   - UN Consolidated List
 *   - OFAC SDN
 *
 * OpenSanctions is deliberately not used. Its aggregated data is CC-BY-NC and
 * we are a commercial user; the engine is free, the list is not.
 *
 * Names are normalised at write time with the SAME function the screening
 * query uses, so indexing and querying can never drift apart. Parsing lives in
 * `sanctionsParsers.mjs` so it can be unit-tested; this file is I/O only.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/aml/load-sanctions-lists.mjs [options]
 *
 * Options:
 *   --list un,ofac,dfat   Lists to load (default: un,ofac,dfat)
 *   --dfat-file <path>    Read DFAT from a local .xlsx or .csv instead of
 *                         downloading. Use when the site is unreachable.
 *   --dfat-url <url>      Download DFAT from an explicit URL, skipping
 *                         link discovery.
 *   --dry-run             Parse and report; write nothing.
 *   --no-prune            Keep entries that have vanished from the source.
 *   --force-prune         Prune even when the list shrank implausibly.
 *
 * Exit code is non-zero if ANY list failed, so a scheduler can alert on it. A
 * stale sanctions list is a live compliance failure, not a warning.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  parseOfac, parseUn, parseDfatCsv, parseDfatWorkbook,
  findSpreadsheetLink, withNormalisedNames,
} from './sanctionsParsers.mjs';

const SOURCES = {
  un: {
    url: 'https://scsanctions.un.org/resources/xml/en/consolidated.xml',
    label: 'UN Consolidated List',
  },
  ofac: {
    url: 'https://www.treasury.gov/ofac/downloads/sdn.csv',
    label: 'OFAC SDN',
  },
  dfat: {
    // The landing page, not the file: DFAT renames the spreadsheet when it
    // republishes, so the download link is discovered from here.
    url: 'https://www.dfat.gov.au/international-relations/security/sanctions/consolidated-list',
    // The published file's own stable address, tried FIRST.
    //
    // Discovery-from-the-landing-page is the more general mechanism and it is
    // kept, but it is also the more fragile one: the landing page sits behind
    // a WAF that answers 403 — and, from some networks, simply resets the
    // connection — while `/sites/default/files/` serves the spreadsheet
    // normally. Measured on 2026-08-18: the page could not be fetched at all,
    // and this URL returned the current 1.3 MB workbook. A refresh that fails
    // because the human-readable wrapper is unavailable is a list going stale
    // for no reason.
    fileUrl: 'https://www.dfat.gov.au/sites/default/files/Australian_Sanctions_Consolidated_List.xlsx',
    label: 'DFAT Consolidated List (Australia)',
  },
};

const UA = 'Mozilla/5.0 (compatible; npc-aml-sanctions-loader/1.1)';

/**
 * A shrunken list is far more likely to be a truncated download than a mass
 * delisting. Below this ratio we load the new data but refuse to delete the
 * old, and exit non-zero so a person looks at it.
 */
const PRUNE_SHRINK_FLOOR = 0.5;

function arg(name, argv) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
}

/**
 * Fetch a published file, falling back to `curl` when the CDN refuses this
 * runtime's HTTP client.
 *
 * DFAT sits behind a WAF that fingerprints the TLS handshake, and Node's
 * `fetch` (undici) is on the wrong side of it. Measured on 2026-08-18 from
 * one host, one IP, one User-Agent, against the same URL:
 *
 *     curl              -> 200, 1,299,680 bytes
 *     node fetch        -> 403, every header combination tried
 *
 * Adding browser headers does not help, because the headers are not what is
 * being judged. Nothing here evades authentication or a robots directive —
 * the file is published for exactly this purpose, and the loader identifies
 * itself in `User-Agent` either way. It is a client-compatibility fallback,
 * and without it the daily refresh cannot fetch the list at all.
 *
 * `fetch` is still tried first, so nothing changes for the sources that work.
 */
async function fetchBuffer(url) {
  let status = 0;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    status = res.status;
  } catch (err) {
    status = 0;
    console.log(`  fetch failed (${err.message}); trying curl`);
  }
  if (status && status !== 403 && status !== 503) {
    throw new Error(`${url} returned ${status}`);
  }
  const curl = spawnSync('curl', [
    '-sS', '-L', '--max-time', '120', '--fail', '-A', UA, url,
  ], { maxBuffer: 256 * 1024 * 1024, encoding: 'buffer' });
  if (curl.error) {
    throw new Error(
      `${url} returned ${status || 'a transport error'} and curl is unavailable ` +
      `(${curl.error.message})`,
    );
  }
  if (curl.status !== 0) {
    throw new Error(
      `${url} returned ${status || 'a transport error'}; curl also failed ` +
      `(exit ${curl.status}: ${String(curl.stderr ?? '').trim().slice(0, 200)})`,
    );
  }
  console.log(`  fetched via curl (${curl.stdout.length} bytes) after HTTP ${status}`);
  return Buffer.from(curl.stdout);
}

/**
 * Resolve the DFAT spreadsheet: explicit file, explicit URL, or discovery from
 * the published landing page.
 */
async function loadDfat({ file, url }) {
  if (file) {
    const buf = readFileSync(file);
    const entries = /\.csv$/i.test(file)
      ? parseDfatCsv(buf.toString('utf8'))
      : parseDfatWorkbook(buf);
    return { entries, buf, resolvedUrl: `file://${file}` };
  }

  let target = url;
  if (!target && SOURCES.dfat.fileUrl) {
    // The published file's own address first. A HEAD would be cheaper but
    // DFAT's CDN does not answer one reliably, so this is a real GET whose
    // failure simply falls through to discovery.
    try {
      const buf = await fetchBuffer(SOURCES.dfat.fileUrl);
      console.log(`  direct: ${SOURCES.dfat.fileUrl} (${buf.length} bytes)`);
      return { entries: parseDfatWorkbook(buf), buf, resolvedUrl: SOURCES.dfat.fileUrl };
    } catch (err) {
      console.log(`  direct URL unusable (${err.message}); falling back to page discovery`);
    }
  }
  if (!target) {
    const page = await fetch(SOURCES.dfat.url, { headers: { 'User-Agent': UA } });
    if (!page.ok) throw new Error(`DFAT page returned ${page.status}`);
    target = findSpreadsheetLink(await page.text(), SOURCES.dfat.url);
    if (!target) {
      throw new Error(
        'no .xlsx/.csv link found on the DFAT consolidated-list page. ' +
        'DFAT may have changed the page; pass --dfat-url <url> or download the ' +
        'file and pass --dfat-file <path>.',
      );
    }
    console.log(`  discovered: ${target}`);
  }

  const buf = await fetchBuffer(target);
  const entries = /\.csv(\?|$)/i.test(target)
    ? parseDfatCsv(buf.toString('utf8'))
    : parseDfatWorkbook(buf);
  return { entries, buf, resolvedUrl: target };
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const prune = !argv.includes('--no-prune');
  const forcePrune = argv.includes('--force-prune');
  const lists = argv.includes('--list')
    ? (arg('--list', argv) ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    : ['un', 'ofac', 'dfat'];
  // --dfat-csv is the pre-1.1 spelling, kept so existing runbooks keep working.
  const dfatFile = arg('--dfat-file', argv) ?? arg('--dfat-csv', argv);
  const dfatUrl = arg('--dfat-url', argv);

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!dryRun && (!url || !key)) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (or pass --dry-run).');
    process.exit(1);
  }
  const admin = dryRun ? null : createClient(url, key);

  for (const list of lists) {
    const source = SOURCES[list];
    if (!source) { console.error(`unknown list: ${list}`); process.exitCode = 1; continue; }

    console.log(`\n=== ${list} — ${source.label}`);
    let sync = null;
    if (admin) {
      const { data } = await admin.schema('aml').from('sanctions_list_syncs')
        .insert({ list_code: list, source_url: source.url, status: 'pending' })
        .select('id').single();
      sync = data;
    }

    try {
      let parsed, payload, resolvedUrl = source.url;

      if (list === 'dfat') {
        const r = await loadDfat({ file: dfatFile, url: dfatUrl });
        parsed = r.entries; payload = r.buf; resolvedUrl = r.resolvedUrl;
      } else {
        payload = await fetchBuffer(source.url);
        const text = payload.toString('utf8');
        parsed = list === 'ofac' ? parseOfac(text) : parseUn(text);
      }

      const sha = createHash('sha256').update(payload).digest('hex');
      if (parsed.length === 0) throw new Error('parser produced 0 entries — refusing to publish an empty list');

      const rows = parsed
        .map((e) => withNormalisedNames(e, list, sync?.id))
        .filter((r) => r.normalised_names.length > 0);

      console.log(`  parsed ${parsed.length}, usable ${rows.length}, sha256 ${sha.slice(0, 16)}…`);
      if (dryRun) {
        console.log('  dry run — not written');
        console.log('  sample:', JSON.stringify(rows[0], null, 2).slice(0, 800));
        continue;
      }

      const { count: before } = await admin.schema('aml').from('sanctions_entries')
        .select('id', { count: 'exact', head: true }).eq('list_code', list);

      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        const { error } = await admin.schema('aml').from('sanctions_entries')
          .upsert(chunk, { onConflict: 'list_code,external_id' });
        if (error) throw error;
        process.stdout.write(`\r  upserted ${Math.min(i + 500, rows.length)}/${rows.length}`);
      }
      console.log('');

      // Delisted parties must stop matching. Anything still carrying an older
      // sync_id was not in this download.
      let pruned = 0;
      if (prune) {
        const shrankTooFar = (before ?? 0) > 0 && rows.length < (before ?? 0) * PRUNE_SHRINK_FLOOR;
        if (shrankTooFar && !forcePrune) {
          console.warn(
            `  ! ${list} went from ${before} to ${rows.length} entries. That is more likely a ` +
            'truncated download than a mass delisting, so nothing was deleted. ' +
            'Re-run with --force-prune if the shrink is real.',
          );
          process.exitCode = 1;
        } else {
          // `neq` alone would never match a NULL sync_id — SQL inequality
          // against NULL is NULL, not true — so any row that predates sync
          // tracking would match forever and never be prunable.
          //
          // `sync_id` MUST be in the returning projection. On a MUTATION,
          // PostgREST resolves the columns named inside a logical `or=(…)`
          // against the RETURNING projection rather than against the table,
          // so `.or('sync_id…').select('id')` answers
          //
          //     42703  column sanctions_entries.sync_id does not exist
          //
          // on a table that plainly has the column — the identical filter on
          // a GET succeeds, and the same `.neq` outside an `or()` succeeds.
          // Measured against production on 2026-08-19, after 3,846 DFAT
          // entries had already been written by the upserts above.
          //
          // This is not cosmetic. The catch below records the whole load as
          // FAILED, and the screening provider fails closed on a required
          // list whose latest attempt failed — so every future refresh would
          // have gone red at the last step and left screening refusing to
          // run, with a complete and current list sitting in the table.
          const { data: removed, error: pruneErr } = await admin.schema('aml').from('sanctions_entries')
            .delete().eq('list_code', list)
            .or(`sync_id.is.null,sync_id.neq.${sync.id}`).select('id, sync_id');
          if (pruneErr) throw pruneErr;
          pruned = (removed ?? []).length;
          if (pruned) console.log(`  pruned ${pruned} entr${pruned === 1 ? 'y' : 'ies'} no longer on the list`);
        }
      }

      await admin.schema('aml').from('sanctions_list_syncs').update({
        status: 'succeeded', entry_count: rows.length,
        payload_sha256: sha, source_url: resolvedUrl,
        completed_at: new Date().toISOString(),
      }).eq('id', sync.id);
      console.log(`  ✓ ${list} loaded (${rows.length} entries, ${pruned} pruned)`);
    } catch (e) {
      console.error(`  ✗ ${list} failed: ${e.message}`);
      if (admin && sync) {
        await admin.schema('aml').from('sanctions_list_syncs').update({
          status: 'failed', error_detail: String(e.message).slice(0, 1000),
          completed_at: new Date().toISOString(),
        }).eq('id', sync.id);
      }
      process.exitCode = 1;
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

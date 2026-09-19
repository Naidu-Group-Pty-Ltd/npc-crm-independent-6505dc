#!/usr/bin/env node
/**
 * Load the public office-holder index into `aml.pep_officeholders`.
 *
 * This is the SECOND register this platform loads, and it is not the same
 * kind of thing as the first. A sanctions list is authoritative and a match
 * against it is an outcome; this index is partial by construction, and a
 * search of it produces a CANDIDATE or nothing. Nothing here can clear
 * anybody, and the read path is written so that a caller cannot render "0
 * candidates" without also rendering what the index does and does not cover.
 *
 * Sources are public and unlicensed. OpenSanctions' PEP dataset is
 * deliberately not used for the same reason its sanctions data is not: the
 * aggregation is CC-BY-NC and we are a commercial user.
 *
 * Every hard-won rule from `load-sanctions-lists.mjs` is repeated here on
 * purpose, because each one cost a production incident:
 *
 *   - refuse to publish a source that parsed to ZERO entries;
 *   - a shrink is a truncated download until a person says otherwise;
 *   - the prune's `or()` must name `sync_id` in the RETURNING projection,
 *     or PostgREST answers 42703 and the whole load records as failed;
 *   - node 22 or later, because `createClient` builds a RealtimeClient that
 *     demands a native WebSocket.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/aml/load-pep-officeholders.mjs [options]
 *
 * Options:
 *   --source wikidata_au_public_office   Sources to load (default: all)
 *   --file <path>       Read the SPARQL JSON from disk instead of querying.
 *                       Use when the endpoint is unreachable — an official
 *                       site answering 403 to a scripted client is the norm
 *                       here, not the exception.
 *   --dry-run           Parse and report; write nothing.
 *   --no-prune          Keep entries that have vanished from the source.
 *   --force-prune       Prune even when the source shrank implausibly.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  APH_REGISTERS, WIKIDATA_AU_OFFICES_QUERY, accumulateWikidataOfficeholders,
  buildWikidataOfficeholderQuery, officeholderEntries, parseAphRegister,
  withNormalisedNames,
} from './pepOfficeholderParsers.mjs';
import { parseCsv } from './sanctionsParsers.mjs';
/*
 * The SAME module the endpoint renders coverage from. Measured by the load
 * and read back from the load — a coverage sentence nobody measures is a
 * claim nobody can check, which is the defect this whole file was rewritten
 * for once already.
 */
import { summariseRuleCoverage } from '../../supabase/functions/_shared/aml/pepRuleCoverage.pure.ts';

/*
 * Two sources, and they are not the same KIND of source.
 *
 * `aph_commonwealth_parliament` is Tier A: the register Parliament itself
 * publishes. Every row in it is authoritative and current, and it holds
 * nobody who left office — not one former member.
 *
 * `wikidata_au_public_office` is Tier C: collaboratively edited, far broader,
 * and the only reachable source that carries FORMER holders, which is the
 * gap AUSTRAC is most explicit about.
 *
 * Neither replaces the other, and the narrower one being the more
 * authoritative is the point: a Tier A hit is a strong lead, a Tier C hit is
 * a lead to check, and an absence from both is still not an answer.
 */
const SOURCES = {
  aph_commonwealth_parliament: {
    label: 'Senators and members of the Australian Parliament (aph.gov.au)',
    load: loadAphRegisters,
  },
  wikidata_au_public_office: {
    label: 'Australian public office holders (Wikidata)',
    endpoint: 'https://query.wikidata.org/sparql',
    load: loadWikidata,
    /** `--file` reads this source's own payload shape and no other's. */
    fromFile: (payload) => officeholderEntries(
      accumulateWikidataOfficeholders(JSON.parse(payload.toString('utf8')))),
  },
};

/*
 * Offices per query.
 *
 * Not a tuning knob so much as a hard constraint. The endpoint's own ceiling
 * is 60 seconds, and it does not fail cleanly when it hits one: 60 offices
 * answered HTTP 200 with 8.5 MB of JSON cut off mid-value and no error
 * anywhere in the body. 20 offices is 198 KB in about 2.5 seconds, which
 * leaves the ceiling a wide margin.
 */
const OFFICES_PER_QUERY = 20;

/* Wikidata throttles. 429 and 5xx are both retried, and both are transient. */
const MAX_ATTEMPTS = 5;

/* A shrunken index is far more likely to be a truncated or throttled
   response than a mass exit from public life. */
const PRUNE_SHRINK_FLOOR = 0.5;

/* Wikidata asks for a descriptive agent with a contact route, and throttles
   anonymous generic ones. */
const UA = 'npc-aml-pep-officeholder-index/1.0 (AML/CTF compliance; admin@npcservices.com.au)';

function arg(name, argv) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One SPARQL request, with backoff.
 *
 * The truncation check is the important line. This endpoint answers **200
 * with a body cut off mid-value** when it exceeds its own time limit — no
 * error field, no marker, nothing to test but the parse. A response that is
 * not valid JSON is therefore treated as a TRUNCATED DOWNLOAD by name, not
 * as a malformed source, because that is what it is and because the
 * distinction is what tells the next person which lever to pull.
 */
async function runSparql(endpoint, query) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let res;
    try {
      res = await fetch(`${endpoint}?query=${encodeURIComponent(query)}`, {
        headers: { Accept: 'application/sparql-results+json', 'User-Agent': UA },
        signal: AbortSignal.timeout(3 * 60 * 1000),
      });
    } catch (e) {
      lastError = e;
      await sleep(2000 * attempt);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (res.status === 429 || res.status >= 500) {
      lastError = new Error(`${endpoint} answered ${res.status}`);
      // Honour Retry-After when the server states one; otherwise back off.
      const stated = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(stated) && stated > 0
        ? Math.min(stated, 120) * 1000
        : 3000 * attempt);
      continue;
    }
    if (!res.ok) throw new Error(`${endpoint} answered ${res.status}`);
    try {
      return { json: JSON.parse(buf.toString('utf8')), buf };
    } catch {
      lastError = new Error(
        `${endpoint} answered 200 with a truncated body (${buf.length} bytes) — the `
        + 'endpoint cuts the response at its own time limit without reporting an error',
      );
      await sleep(3000 * attempt);
    }
  }
  throw lastError ?? new Error('the SPARQL endpoint could not be read');
}

const chunk = (xs, n) => {
  const out = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

/**
 * Every Australian public office holder, in batches of offices.
 *
 * Batched because one query for all of them cannot finish inside the
 * endpoint's limit, and a query that does not finish comes back looking like
 * a smaller answer rather than like a failure. The accumulator is threaded
 * through every batch so a person who holds offices in several of them ends
 * up as one row rather than as whichever batch wrote last.
 */
async function loadWikidata(source, log) {
  const officeRes = await runSparql(source.endpoint, WIKIDATA_AU_OFFICES_QUERY);
  const offices = (officeRes.json?.results?.bindings ?? [])
    .map((b) => String(b?.pos?.value ?? '').split('/').pop())
    .filter((q) => /^Q\d+$/.test(q));
  if (offices.length === 0) {
    throw new Error('the office list came back empty — refusing to publish an empty index');
  }
  log(`  ${offices.length} offices to read`);

  const batches = chunk(offices, OFFICES_PER_QUERY);
  const acc = new Map();
  const hashes = [];
  for (const [i, batch] of batches.entries()) {
    const res = await runSparql(source.endpoint, buildWikidataOfficeholderQuery(batch));
    accumulateWikidataOfficeholders(res.json, acc);
    hashes.push(createHash('sha256').update(res.buf).digest('hex'));
    process.stdout.write(`\r  batch ${i + 1}/${batches.length}, ${acc.size} people`);
    // Polite: the endpoint is a shared public service and it throttles.
    if (i < batches.length - 1) await sleep(1500);
  }
  console.log('');

  return {
    entries: officeholderEntries(acc),
    officeCount: offices.length,
    // One digest over the batch digests: the payload is many responses, and
    // a single fingerprint over all of them is what makes a re-run
    // comparable to the last one.
    payloadSha: createHash('sha256').update(hashes.join('')).digest('hex'),
  };
}

/**
 * The two Parliament register files.
 *
 * Plain HTTP GETs of two published CSVs — no API, no key, no pagination.
 * The only thing worth guarding is the failure this repository has had
 * twice: a download that comes back SHORT reads exactly like a chamber that
 * shrank. `expectAtLeast` is a floor, not a target, and falling through it
 * fails the load rather than publishing a thinner register.
 */
async function loadAphRegisters(_source, log) {
  const entries = [];
  const hashes = [];
  for (const register of APH_REGISTERS) {
    const res = await fetch(register.url, {
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: 'text/csv,*/*' },
      signal: AbortSignal.timeout(2 * 60 * 1000),
    });
    if (!res.ok) throw new Error(`${register.label}: ${register.url} answered ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());

    /*
     * Sniff before parsing. The link Parliament labels `Members_List.csv`
     * answers 200 with 184 KB beginning `%PDF-1.7`, and a CSV parser fed a
     * PDF does not throw — it returns rows of gibberish, and the loader
     * would write them.
     */
    const head = buf.subarray(0, 5).toString('latin1');
    if (head.startsWith('%PDF-')) {
      throw new Error(`${register.label}: ${register.url} served a PDF, not a CSV`);
    }

    const parsed = parseAphRegister(buf.toString('utf8'), register, parseCsv);
    if (parsed.length < register.expectAtLeast) {
      throw new Error(
        `${register.label}: ${parsed.length} rows, fewer than the ${register.expectAtLeast} `
        + 'a complete file holds — that is a truncated download, not a smaller chamber',
      );
    }
    log(`  ${register.label}: ${parsed.length} from ${buf.length} bytes`);
    entries.push(...parsed);
    hashes.push(createHash('sha256').update(buf).digest('hex'));
    await sleep(500);
  }

  const offices = new Set();
  for (const e of entries) for (const p of e.source_detail.positions) offices.add(p.title);

  return {
    entries,
    officeCount: offices.size,
    payloadSha: createHash('sha256').update(hashes.join('')).digest('hex'),
    /*
     * The file publishes no control date of its own — no "current as at"
     * anywhere in it — so the download date is the only currency statement
     * that can honestly be made about it.
     */
    sourceAsAt: new Date().toISOString().slice(0, 10),
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const prune = !argv.includes('--no-prune');
  const forcePrune = argv.includes('--force-prune');
  const file = arg('--file', argv);
  const sources = argv.includes('--source')
    ? (arg('--source', argv) ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    : Object.keys(SOURCES);

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!dryRun && (!url || !key)) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (or pass --dry-run).');
    process.exit(1);
  }
  const admin = dryRun ? null : createClient(url, key);

  for (const code of sources) {
    const source = SOURCES[code];
    if (!source) { console.error(`unknown source: ${code}`); process.exitCode = 1; continue; }

    console.log(`\n=== ${code} — ${source.label}`);
    let sync = null;
    if (admin) {
      const { data, error } = await admin.schema('aml').from('pep_officeholder_syncs')
        .insert({ source_code: code, status: 'running' }).select('id').single();
      if (error) { console.error(`  ✗ could not open a sync row: ${error.message}`); process.exitCode = 1; continue; }
      sync = data;
    }

    try {
      let parsed, officeCount = null, sha, sourceAsAt = null;
      if (file) {
        // A payload on disk belongs to ONE source. Reading it as another
        // source's shape is how a file gets loaded under the wrong code.
        if (!source.fromFile) {
          throw new Error(`--file is not supported for ${code}; it reads live registers`);
        }
        const payload = readFileSync(file);
        console.log(`  read ${file} (${payload.length} bytes)`);
        parsed = source.fromFile(payload);
        sha = createHash('sha256').update(payload).digest('hex');
      } else {
        const r = await source.load(source, (m) => console.log(m));
        parsed = r.entries; officeCount = r.officeCount; sha = r.payloadSha;
        sourceAsAt = r.sourceAsAt ?? null;
      }

      if (parsed.length === 0) {
        // The sanctions rule, and it applies here for a different reason:
        // an empty index is not "nobody is an office holder", it is a
        // download that failed, and a search against it returns the same
        // zero rows a real search would.
        throw new Error('parser produced 0 entries — refusing to publish an empty index');
      }

      const rows = parsed
        .map((e) => withNormalisedNames(e, code, sync?.id))
        .filter((r) => r.normalised_names.length > 0);

      /*
       * Count EVERY office a row records, not just the one it leads with.
       *
       * `position_title` is the office shown on the candidate — the current
       * one, else the most recent — so counting those answers "how many
       * different offices do people lead with", which is not a coverage
       * number. On the first corrected load it read 371 while 676 offices
       * were actually represented. Understating is the safer direction, but
       * a number that does not mean what it says is the same defect as the
       * one this file was just rewritten for.
       */
      const offices = new Set();
      for (const r of rows) {
        for (const p of r.source_detail?.positions ?? []) {
          if (p?.title) offices.add(p.title);
        }
        if (r.position_title) offices.add(r.position_title);
      }
      /*
       * Which AML/CTF Rule categories this load actually reaches.
       *
       * "10,558 people across 676 offices" is a number about a database. The
       * question an operator has is whether the thing that just returned
       * nothing had ever looked at judges, or ambassadors, or the Chief of
       * Navy — so coverage is measured against the obligation and stored
       * beside the load.
       */
      const ruleCoverage = summariseRuleCoverage(offices);
      const evidenced = ruleCoverage.categories.filter((c) => !c.notEvidenced);

      console.log(`  parsed ${parsed.length}, searchable ${rows.length}, `
        + `${offices.size} distinct offices, sha256 ${sha.slice(0, 16)}…`);
      console.log(`  rule categories evidenced: ${evidenced.length}/`
        + `${ruleCoverage.categories.length}`
        + ` (${evidenced.map((c) => `${c.code} ${c.officeCount}`).join(', ') || 'none'})`);
      if (ruleCoverage.unclassifiedCount) {
        // Disclosed, never hidden: this is what makes every count a FLOOR.
        console.log(`  ${ruleCoverage.unclassifiedCount} office titles matched no `
          + `category, e.g. ${ruleCoverage.unclassifiedSamples.slice(0, 3).join('; ')}`);
      }
      if (dryRun) {
        console.log('  dry run — not written');
        console.log('  sample:', JSON.stringify(rows[0], null, 2).slice(0, 800));
        continue;
      }

      const { count: before } = await admin.schema('aml').from('pep_officeholders')
        .select('id', { count: 'exact', head: true }).eq('source_code', code);

      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        const { error } = await admin.schema('aml').from('pep_officeholders')
          .upsert(chunk, { onConflict: 'source_code,external_id' });
        if (error) throw error;
        process.stdout.write(`\r  upserted ${Math.min(i + 500, rows.length)}/${rows.length}`);
      }
      console.log('');

      let pruned = 0;
      if (prune) {
        const shrankTooFar = (before ?? 0) > 0 && rows.length < (before ?? 0) * PRUNE_SHRINK_FLOOR;
        if (shrankTooFar && !forcePrune) {
          console.warn(
            `  ! ${code} went from ${before} to ${rows.length} entries. That is more likely a ` +
            'truncated response than a real change, so nothing was deleted. ' +
            'Re-run with --force-prune if the shrink is real.',
          );
          process.exitCode = 1;
        } else {
          // `sync_id` MUST be named in the projection. On a MUTATION,
          // PostgREST resolves the columns inside a logical `or=(…)` against
          // the RETURNING projection rather than the table, and answers
          // `42703 column … does not exist` for a column the table plainly
          // has. On the sanctions loader that failed EVERY load it was part
          // of, and the failure recorded as a failed sync, which fails the
          // provider closed. Same filter, same fix, same reason.
          const { data: removed, error: pruneErr } = await admin.schema('aml')
            .from('pep_officeholders').delete().eq('source_code', code)
            .or(`sync_id.is.null,sync_id.neq.${sync.id}`).select('id, sync_id');
          if (pruneErr) throw pruneErr;
          pruned = (removed ?? []).length;
          if (pruned) console.log(`  pruned ${pruned} entr${pruned === 1 ? 'y' : 'ies'} no longer in the source`);
        }
      }

      await admin.schema('aml').from('pep_officeholder_syncs').update({
        status: 'succeeded', entry_count: rows.length, removed_count: pruned,
        payload_sha256: sha,
        // The source's own currency. Wikidata is edited continuously, so the
        // query date IS its as-at — unlike a published file, whose control
        // date can be years older than the day it was downloaded.
        source_as_at: sourceAsAt ?? new Date().toISOString().slice(0, 10),
        completed_at: new Date().toISOString(),
        /*
         * What the load actually reached, recorded beside it. The coverage
         * an operator is shown is derived from THIS rather than from a
         * sentence somebody typed once — the first version of this loader
         * wrote 1,254 people across two offices while the product claimed
         * on screen to cover ministers, judges and every state.
         */
        detail: {
          office_count: officeCount,
          distinct_offices: offices.size,
          sample_offices: [...offices].slice(0, 12),
          /*
           * Stored so the screen renders a MEASUREMENT rather than a
           * sentence. The categories with nothing are stored too — a gap
           * that is not recorded is a gap nobody can be told about.
           */
          rule_categories: ruleCoverage.categories,
          unclassified_offices: ruleCoverage.unclassifiedCount,
          unclassified_samples: ruleCoverage.unclassifiedSamples,
        },
      }).eq('id', sync.id);
      console.log(`  ✓ ${code} loaded (${rows.length} entries, ${pruned} pruned)`);
    } catch (e) {
      console.error(`  ✗ ${code} failed: ${e.message}`);
      if (admin && sync) {
        await admin.schema('aml').from('pep_officeholder_syncs').update({
          status: 'failed', error_message: String(e.message).slice(0, 1000),
          completed_at: new Date().toISOString(),
        }).eq('id', sync.id);
      }
      process.exitCode = 1;
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

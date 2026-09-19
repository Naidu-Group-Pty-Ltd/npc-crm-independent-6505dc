#!/usr/bin/env node
/**
 * The PEP source reachability spike.
 *
 * ── Why this exists ───────────────────────────────────────────────────
 * A list of "authoritative machine-readable government datasets" is a
 * hypothesis until something downloads one. Building twenty bespoke adapters
 * against sources nobody has fetched is how a programme discovers, in week
 * three, that half of them answer 403 to anything without a browser.
 *
 * This fetches every candidate once and reports what actually came back. It
 * is a MEASURING instrument, not a loader: it writes nothing to the database
 * and it is not on any schedule.
 *
 * ── The two things it does that a status code cannot ──────────────────
 *
 * 1. IT SNIFFS THE BYTES. `Members_List.csv` answers HTTP 200 with 184 KB
 *    and a body beginning `%PDF-1.7`. The extension says CSV, the header can
 *    say anything, and the content is a PDF. Any check that trusts the URL
 *    or the `Content-Type` would have recorded that source as working, and
 *    an adapter would have been written against it.
 *
 * 2. IT NAMES A BLOCK PAGE AS A BLOCK. A WAF answers 200 with HTML saying
 *    "Access Denied" as readily as it answers 403. A run that counts that as
 *    a success is measuring nothing.
 *
 * ── Why it runs in CI ─────────────────────────────────────────────────
 * The egress that matters is the one ingestion will use. DFAT's list answers
 * 403 to this repository's dev environment and downloads perfectly from a
 * GitHub Actions runner — the sanctions loader pulls 3,846 entries from one
 * on a schedule. So the same script runs in both places and the COMPARISON
 * is the finding.
 *
 * That is what the controls are for. If the known-good source fails, the run
 * measured the network and every other line in it is uninterpretable.
 *
 *   node scripts/aml/pep-source-spike.mjs [--json out.json] [--timeout 60]
 */
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import { CANDIDATE_SOURCES, CONTROLS, RULE_CATEGORIES } from './pepSourceCatalogue.mjs';

/*
 * A real browser's User-Agent.
 *
 * Not a trick: these are public documents a person may download, and the
 * question under test is whether a scheduled job can retrieve what a person
 * can. Recording the UA in the report matters more than which one it is — a
 * source that only serves browsers is a source whose terms should be read
 * before anything is built on it, and the report says so per row.
 */
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** Magic bytes. The only honest answer to "what did we actually get". */
export function sniff(buf) {
  if (!buf || buf.length === 0) return 'empty';
  const head = buf.subarray(0, 512);
  const text = head.toString('latin1');
  if (text.startsWith('%PDF-')) return 'pdf';
  if (head[0] === 0x50 && head[1] === 0x4b) return 'zip/xlsx/docx';
  if (text.startsWith('\x1f\x8b')) return 'gzip';
  const trimmed = text.replace(/^﻿/, '').trimStart();
  if (/^<\?xml/i.test(trimmed)) return 'xml';
  if (/^<!doctype html|^<html/i.test(trimmed)) return 'html';
  if (/^[[{]/.test(trimmed)) return 'json';
  if (/^</.test(trimmed)) return 'xml-or-html';
  // A CSV has separators on its first line and no markup.
  const firstLine = trimmed.split(/\r?\n/)[0] ?? '';
  if (firstLine.includes(',') || firstLine.includes('\t')) return 'csv-like';
  return 'text';
}

/**
 * Whether an HTML body is a refusal wearing a 200.
 *
 * Deliberately a list of the phrases these pages actually use rather than a
 * clever heuristic: a false "blocked" reading would retire a source that
 * works, which is the more expensive mistake here.
 */
const BLOCK_MARKERS = [
  'access denied', 'request rejected', 'blocked by waf', 'page blocked',
  'incapsula', 'cloudflare', 'attention required', 'forbidden',
  'unusual traffic', 'bot detection', 'are you a human', 'captcha',
];
const NOT_FOUND_MARKERS = ['page not found', '404 - not found', 'requested page could not be found'];

export function classifyBody(buf, format) {
  if (format !== 'html') return null;
  const text = buf.subarray(0, 20000).toString('utf8').toLowerCase();
  for (const m of BLOCK_MARKERS) if (text.includes(m)) return `block page ("${m}")`;
  for (const m of NOT_FOUND_MARKERS) if (text.includes(m)) return `not found ("${m}")`;
  return null;
}

/** A rough record count, so "it downloaded" can be told from "it has data". */
function estimateRecords(buf, format) {
  try {
    if (format === 'csv-like' || format === 'text') {
      const lines = buf.toString('utf8').split(/\r?\n/).filter((l) => l.trim());
      return Math.max(0, lines.length - 1);
    }
    if (format === 'json') {
      const j = JSON.parse(buf.toString('utf8'));
      if (Array.isArray(j)) return j.length;
      if (j?.result?.results) return j.result.results.length;
      if (j?.results?.bindings) return j.results.bindings.length;
      return null;
    }
    if (format === 'xml') {
      // Count the most frequent repeated element — a decent proxy for rows.
      const tags = buf.toString('utf8').match(/<([A-Za-z_][\w.-]*)[\s>]/g) ?? [];
      const counts = new Map();
      for (const t of tags) {
        const name = t.slice(1).replace(/[\s>]$/, '');
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      return top ? top[1] : null;
    }
  } catch { /* a count is a nicety; never fail the probe for it */ }
  return null;
}

/**
 * Does what came back satisfy what was expected?
 *
 * `expect` is what a human wrote in the catalogue; `format` is what the bytes
 * are. They are different vocabularies and they have to be reconciled in ONE
 * place, because the alternative is what this function replaces: two inline
 * special cases, which silently answered "no" to every expectation nobody had
 * thought to add.
 *
 * That cost a real reading. The DFAT control downloaded 1,299,680 bytes of a
 * genuine spreadsheet and was reported as a FAILED CONTROL, because an OOXML
 * file is a zip container and sniffs as `zip/xlsx/docx` while the catalogue
 * says `xlsx`. The run's own header then told a reader the network was
 * suspect and every candidate line was uninterpretable — about a run in which
 * the control had worked perfectly.
 *
 * So the rule here is: a sniff is a FAMILY, an expectation is a MEMBER, and
 * membership is declared rather than inferred. An expectation this table does
 * not know is only satisfied by an exact match, which fails loudly on the
 * source rather than quietly on every source.
 */
export const FORMAT_SATISFIED_BY = {
  csv: ['csv-like', 'text'],
  // OOXML is a zip. Nothing can tell an .xlsx from a .docx by its first two
  // bytes, and this probe deliberately does not open the container.
  xlsx: ['zip/xlsx/docx'],
  docx: ['zip/xlsx/docx'],
  zip: ['zip/xlsx/docx'],
  html: ['xml-or-html'],
  xml: ['xml-or-html'],
  json: [],
  pdf: [],
  text: ['csv-like'],
};

export function formatSatisfies(expect, format) {
  if (!expect) return true;               // nothing was claimed; nothing to contradict
  if (expect === format) return true;
  return (FORMAT_SATISFIED_BY[expect] ?? []).includes(format);
}

async function probe(source, timeoutMs) {
  const started = Date.now();
  const row = {
    key: source.key,
    label: source.label,
    tier: source.tier ?? 'control',
    category: source.category ?? 'control',
    authority: source.authority ?? null,
    url: source.url,
    expect: source.expect ?? null,
    note: source.note ?? null,
  };
  try {
    const res = await fetch(source.url, {
      redirect: 'follow',
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: '*/*',
        'Accept-Language': 'en-AU,en;q=0.9',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const format = sniff(buf);
    const bodyIssue = classifyBody(buf, format);
    row.status = res.status;
    row.contentType = res.headers.get('content-type');
    row.bytes = buf.length;
    row.format = format;
    row.records = estimateRecords(buf, format);
    row.sha256 = buf.length ? createHash('sha256').update(buf).digest('hex').slice(0, 16) : null;
    row.bodyIssue = bodyIssue;
    row.ms = Date.now() - started;

    /*
     * The verdict. `usable` is deliberately strict: a source is usable when
     * it answered 2xx, is not a block page, and the BYTES are the shape an
     * adapter could parse. Anything else is a lead for a person, not a
     * dataset to build on.
     */
    if (!res.ok) row.verdict = 'refused';
    else if (bodyIssue) row.verdict = 'blocked';
    else if (format === 'empty') row.verdict = 'empty';
    else if (!formatSatisfies(source.expect, format)) row.verdict = 'wrong-format';
    else row.verdict = 'usable';
  } catch (e) {
    row.status = 0;
    row.bytes = 0;
    row.format = null;
    row.ms = Date.now() - started;
    row.error = String(e?.message ?? e).slice(0, 200);
    row.verdict = 'unreachable';
  }
  return row;
}

const VERDICT_MARK = {
  usable: 'OK  ',
  'wrong-format': 'FMT ',
  blocked: 'WAF ',
  refused: 'HTTP',
  unreachable: 'NET ',
  empty: 'MT  ',
};

async function main() {
  const argv = process.argv.slice(2);
  const at = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const timeoutMs = Math.max(5, Number(at('--timeout') ?? 60)) * 1000;
  const outPath = at('--json');

  const environment = process.env.GITHUB_ACTIONS === 'true'
    ? `github-actions/${process.env.RUNNER_OS ?? 'unknown'}`
    : 'local-or-dev-container';

  console.log(`\nPEP source reachability spike`);
  console.log(`environment : ${environment}`);
  console.log(`timeout     : ${timeoutMs / 1000}s per source`);
  console.log(`sources     : ${CONTROLS.length} controls + ${CANDIDATE_SOURCES.length} candidates\n`);

  const rows = [];
  for (const s of [...CONTROLS, ...CANDIDATE_SOURCES]) {
    const r = await probe(s, timeoutMs);
    rows.push(r);
    const mark = VERDICT_MARK[r.verdict] ?? '??  ';
    const detail = r.verdict === 'unreachable'
      ? r.error
      : `${r.status} ${r.format ?? '-'} ${r.bytes}B`
        + (r.records != null ? ` ~${r.records} rec` : '')
        + (r.bodyIssue ? ` · ${r.bodyIssue}` : '');
    console.log(`${mark} ${r.key.padEnd(34)} ${detail}`);
    // Polite: these are public services and several share a host.
    await new Promise((res) => setTimeout(res, 750));
  }

  /* ── Is this run interpretable at all? ─────────────────────────────── */
  const controls = rows.filter((r) => r.key.startsWith('control_'));
  const controlsOk = controls.filter((r) => r.verdict === 'usable').length;
  const candidates = rows.filter((r) => !r.key.startsWith('control_'));

  console.log('\n── Controls ──────────────────────────────────────────────');
  for (const c of controls) {
    /*
     * A failing control must say WHAT came back. A bare `FAIL` is how a
     * successful 1.3 MB download came to be read as a network fault: the
     * verdict was wrong, and the line carried nothing a reader could use to
     * notice that.
     */
    const why = c.verdict === 'usable' ? '' : `  (${c.verdict}: `
      + (c.verdict === 'unreachable'
        ? c.error
        : `${c.status} ${c.format ?? '-'} ${c.bytes}B`
          + (c.expect ? `, expected ${c.expect}` : '')
          + (c.bodyIssue ? `, ${c.bodyIssue}` : ''))
      + ')';
    console.log(`  ${c.verdict === 'usable' ? 'PASS' : 'FAIL'}  ${c.label}${why}`);
  }
  if (controlsOk === 0) {
    console.log('\n  !! EVERY CONTROL FAILED. This run measured the network, not the');
    console.log('     sources. Do not draw conclusions about any candidate from it.\n');
  } else if (controlsOk < controls.length) {
    console.log(`\n  ~~ ${controls.length - controlsOk} of ${controls.length} controls failed. The run is interpretable,`);
    console.log('     but read the failing control above before trusting a NET or WAF line.\n');
  }

  console.log('\n── Candidates by verdict ─────────────────────────────────');
  for (const v of ['usable', 'wrong-format', 'blocked', 'refused', 'unreachable', 'empty']) {
    const inV = candidates.filter((r) => r.verdict === v);
    if (!inV.length) continue;
    console.log(`\n  ${v.toUpperCase()} (${inV.length})`);
    for (const r of inV) console.log(`    · ${r.label}`);
  }

  /* Coverage against the Rules, which is the question that actually matters. */
  console.log('\n── Rule categories with at least one usable source ────────');
  for (const cat of RULE_CATEGORIES) {
    const inCat = candidates.filter((r) => r.category === cat);
    if (!inCat.length) continue;
    const ok = inCat.filter((r) => r.verdict === 'usable').length;
    console.log(`  ${ok > 0 ? 'YES' : 'NO '}  ${cat.padEnd(34)} ${ok}/${inCat.length} usable`);
  }

  const report = {
    environment,
    generated_at: new Date().toISOString(),
    controls_passed: controlsOk,
    controls_total: controls.length,
    interpretable: controlsOk > 0,
    rows,
  };
  if (outPath) {
    writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\nreport written to ${outPath}`);
  }

  console.log(
    `\n${candidates.filter((r) => r.verdict === 'usable').length}`
    + `/${candidates.length} candidates usable from ${environment}\n`);

  /*
   * A spike REPORTS. It never fails the build: an unreachable government
   * website is the finding, not a broken repository, and a red run would
   * train people to ignore it.
   */
}

/*
 * Run only when invoked. The verdict rules are exported so a test can hold
 * them — importing this module must never fetch twenty government websites.
 */
const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main().catch((e) => { console.error(e); process.exit(1); });

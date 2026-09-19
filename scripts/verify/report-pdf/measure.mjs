#!/usr/bin/env node
/**
 * Measure a client PDF as a DOCUMENT -- from its drawn bytes and its pixels,
 * never from the template that produced it.
 *
 *   node scripts/verify/report-pdf/measure.mjs <file.pdf> [--json out.json] [--label A]
 *
 * Reports, and fails on, the things that make a report unsendable and that no
 * page count, byte count or unit test can see:
 *
 *   ILLEGIBLE   text drawn with no contrast against its own ground -- the
 *               defect that put the executive dashboard's headline figures in
 *               dark-brown-on-dark-brown; measured from a 150-dpi raster under
 *               every text run (range < 24/255 = invisible)
 *   OFF-PAGE    a text run whose box leaves the page
 *   OVERLAP     two different runs whose boxes genuinely intersect on one line
 *   MOJIBAKE    replacement characters, control bytes, or an encoding-failed
 *               glyph sequence in the drawn text
 *   BLANK       a page with no body text at all
 *   SPARSE      a HOLE: a blank band larger than 45% of the body with
 *               drawn content BELOW it. A band that runs to the foot is a
 *               short page, counted and named, never an issue.
 *   FONTS       every font unembedded (base-14 substitution) -- the document
 *               does not carry its own typefaces
 *   TOKEN       a client-facing sentinel (N/A, Unavailable, TBD, null,
 *               undefined, NaN, [object Object], a raw {{binding}})
 *
 * Also reported, not failed: page count, headers/footers per page, page
 * numbering, embedded font list, per-page blank bands.
 *
 * This is the VISUAL CHECK of the mandatory loop, run after every change on
 * the real document. Thresholds are deliberately generous; anything this
 * flags is real.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const opt = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
if (!file) { console.error('usage: measure.mjs <file.pdf> [--json out] [--label L]'); process.exit(2); }
const LABEL = opt('label') ?? path.basename(file);

const pdfjs = await import(path.join(ROOT, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs'));
const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), useSystemFonts: false, verbosity: 0 }).promise;

// -- raster (grey PGM), one per page ------------------------------------------
const DPI = 150; const SCALE = DPI / 72;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-pdf-'));
execSync(`pdftoppm -r ${DPI} -gray "${file}" "${tmp}/p"`, { stdio: 'pipe' });
const pgmFiles = fs.readdirSync(tmp).filter((f) => f.endsWith('.pgm')).sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
function pgm(f) {
  const buf = fs.readFileSync(f); let i = 0; let n = 0; const hdr = [];
  while (n < 4 && i < buf.length) {
    while (i < buf.length && /\s/.test(String.fromCharCode(buf[i]))) i++;
    if (String.fromCharCode(buf[i]) === '#') { while (buf[i] !== 10) i++; continue; }
    const s = i; while (i < buf.length && !/\s/.test(String.fromCharCode(buf[i]))) i++;
    hdr.push(buf.slice(s, i).toString()); n++;
  }
  i++; return { w: +hdr[1], h: +hdr[2], px: buf.subarray(i) };
}

// -- fonts --------------------------------------------------------------------
const fontsOut = execSync(`pdffonts "${file}"`, { encoding: 'utf8' });
const fonts = fontsOut.split('\n').slice(2).filter(Boolean).map((l) => {
  const m = l.match(/^(\S+)\s+(.+?)\s+(\S+)\s+(yes|no)\s+(yes|no)\s+(yes|no)/);
  return m ? { name: m[1], embedded: m[4] === 'yes' } : { name: l.trim().split(/\s+/)[0], embedded: /\byes\b/.test(l) };
});
const embeddedCount = fonts.filter((f) => f.embedded).length;

// Sentinel words are matched as whole tokens: "NA" must not match the "NA" in
// "NAIDU", and "null" must not match "nullify".
// A sentinel is a bare value where a figure should be. The ungraded verdict
// the projection publishes on purpose — "Not available — insufficient
// verified evidence", a headline with its explanation — is a reading, not a
// token, and is the one form exempted here.
// The owner's rule (14 Sep 2026): neither "N/A" nor "unavailable" ever reaches
// a client document, in any case or spelling. The first pattern is the
// case-sensitive technical vocabulary (a token is one exact spelling), the
// second the placeholder family in any case — and nothing is exempt any more:
// the designed ungraded reading this used to admit ("Not available — …") is no
// longer published by the projection.
//
// `not assessed` was in the second family and is NOT any more (18 Sep 2026,
// S5/S6 §5). Two things made it a false alarm rather than a finding. It is a
// SANCTIONED VALUE: `PLANNING_CONTROLS_IN_THE_REPORT.md` §9 made `Not assessed`
// the risk register's level for an absence that may not be rated — "never Low,
// Minimal, Limited, Negligible or Favourable" — so a detector that flags it
// flags the correct answer. And it is ordinary English: measured on the
// Financial fork of 48 Redfern Street, the single occurrence in 22 pages was
// the Investor Suitability Profile's own sentence, *"Whether a particular
// investor meets those requirements is not assessed here — no personal
// financial circumstances are supplied to this report"*, which is a
// disclosure a client is entitled to and reads as one.
//
// The rest of the family stays: "N/A" and "unavailable" are the owner's own
// rule and neither is a value this product may publish. A false caveat teaches
// people to dismiss the warning, which is the same rule the template-fit
// notice answers to.
// Two families, and they answer to different rules.
//
// ALWAYS: `NA`, `TBD`, `null`, `undefined`, `NaN`, `[object Object]` and an
// unresolved `{{…}}` are never legitimate prose. Anywhere they appear is a
// defect.
//
// ONLY IN A SHORT RUN: "not available" and "not provided" are placeholders
// when they occupy a VALUE SLOT and ordinary English when they sit in a
// sentence. Measured in the S6 acceptance run, 18 Sep 2026, on real pages:
//
//   ⚠ Exact facility distances not provided                            (39 ch)  ← a defect
//   Authoritative postcode-level demographic information was not
//   available for this analysis, so no …                               (95 ch)  ← prose
//   … (SEIFA) and workforce composition figures were not available
//   at the subject property's postal area                              (97 ch)  ← prose
//
// The first is a strip cell reporting our own gap as a finding about the
// house; `stripOwnGapCells` removes it. The other two are sentences that name
// what was missing and why, which the repository's own rule protects — *prose
// is never regex-scrubbed, on read or on write* — so flagging them is a false
// caveat, and a false caveat teaches people to dismiss the warning.
//
// 60 characters sits with real margin either side of the measured cases: a
// placeholder label ("N/A", "Not available", "Not provided") is under 20, and
// a sentence carrying a subject, a verb and a subordinate clause is over 90.
//
// `VERIFY-EDIT` is a marker this repository's own journey harness types into a
// report to prove the edit path persists. It reached all five documents that
// were put forward for acceptance, because the run that proved the edit was
// also the run that finalised the PDF. The harness now resets the fixture
// between the two; this line is the check that would have caught it either
// way, and it is deliberately anywhere-matching and case-sensitive — a
// document that carries it is test scaffolding, whatever length the line is.
const SENTINELS_ANYWHERE = [
  /(?<![A-Za-z])(NA|TBD|TBC|null|undefined|NaN|\[object Object\])(?![A-Za-z])|\{\{[^}]{1,80}\}\}/,
  /\[VERIFY-EDIT\b/,
];
const SENTINELS_IN_A_VALUE_SLOT = [
  /(?<![A-Za-z])(n\/a|not available|unavailable|not provided|data unavailable|no data available)(?![A-Za-z])/i,
];
const VALUE_SLOT_MAX_CHARS = 60;
const findSentinel = (text) => {
  for (const re of SENTINELS_ANYWHERE) { const m = text.match(re); if (m) return m[0]; }
  if (text.trim().length > VALUE_SLOT_MAX_CHARS) return null;
  for (const re of SENTINELS_IN_A_VALUE_SLOT) { const m = text.match(re); if (m) return m[0]; }
  return null;
};
// U+FFFD, C0 control bytes other than tab/newline, and UTF-8 read as Latin-1
// (a capital A-tilde followed by a Latin-1 supplement byte, or the a-circumflex
// + euro pair that every UTF-8 punctuation mark becomes).
const MOJIBAKE = /[\uFFFD\x00-\x08\x0b\x0c\x0e-\x1f]|\u00C3[\u0080-\u00BF]|\u00E2\u20AC/;

const pages = []; const issues = [];
for (let n = 1; n <= doc.numPages; n++) {
  const page = await doc.getPage(n);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const img = pgm(path.join(tmp, pgmFiles[n - 1]));
  const items = [];
  for (const it of tc.items) {
    const s = String(it.str ?? ''); if (!s.trim()) continue;
    const tr = it.transform; const h = Math.abs(it.height || tr[3] || 10); const w = it.width ?? 0;
    // A rotated run (an axis title set along the y axis) reports its advance
    // along the rotated baseline, so a horizontal box built from it covers
    // the ground beside the glyphs, never the glyphs: sampled at 150 dpi the
    // real box under "EQUITY" spans 21–155 while the horizontal box read as
    // blank, and the same box paired it with a tick label it never touched.
    // Its legibility and overlap are not measured; its presence still is.
    const rotated = Math.abs(tr[1]) > 0.01 || Math.abs(tr[2]) > 0.01;
    items.push({ s, x: tr[4], yTop: vp.height - tr[5] - h, w, h, rotated });
  }
  const text = items.map((i) => i.s).join(' ');
  const bodyItems = items.filter((i) => i.yTop > vp.height * 0.07 && i.yTop < vp.height * 0.93);

  // legibility: raster range under each run
  let illegible = 0; const illegibleSamples = [];
  for (const t of items) {
    if (t.w < 2 || t.h < 2 || t.rotated) continue;
    const x0 = Math.max(0, Math.floor(t.x * SCALE)), x1 = Math.min(img.w - 1, Math.ceil((t.x + t.w) * SCALE));
    const y0 = Math.max(0, Math.floor(t.yTop * SCALE)), y1 = Math.min(img.h - 1, Math.ceil((t.yTop + t.h * 1.25) * SCALE));
    if (x1 <= x0 || y1 <= y0) continue;
    let mn = 255, mx = 0;
    for (let y = y0; y <= y1; y++) { const row = y * img.w; for (let x = x0; x <= x1; x++) { const v = img.px[row + x]; if (v < mn) mn = v; if (v > mx) mx = v; } }
    if (mx - mn < 24) { illegible++; if (illegibleSamples.length < 3) illegibleSamples.push(t.s.trim().slice(0, 40)); }
  }
  // off-page + overlap
  const offPage = items.filter((t) => t.x < -1 || t.yTop < -1 || t.x + t.w > vp.width + 1 || t.yTop + t.h > vp.height + 1);
  let overlaps = 0; const overlapSamples = [];
  for (let a = 0; a < items.length; a++) for (let b = a + 1; b < items.length; b++) {
    const A = items[a], B = items[b];
    if (A.rotated || B.rotated) continue;
    if (Math.abs(A.yTop - B.yTop) > Math.max(A.h, B.h) * 1.2) continue;
    const ox = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x);
    const oy = Math.min(A.yTop + A.h, B.yTop + B.h) - Math.max(A.yTop, B.yTop);
    if (ox > 1.5 && oy > Math.min(A.h, B.h) * 0.35 && A.s.trim() !== B.s.trim()) { overlaps++; if (overlapSamples.length < 2) overlapSamples.push(`${A.s.trim().slice(0, 20)} <-> ${B.s.trim().slice(0, 20)}`); }
  }
  // blank bands in the body, measured against the page's OWN ground.
  //
  // "Ink" is any pixel that differs from the dominant luminance of the page,
  // not any pixel darker than white: a template with an obsidian ground would
  // otherwise read as fully inked on every row, and its empty pages would
  // vanish from this measure.
  const top = Math.round(img.h * 0.07), bot = Math.round(img.h * 0.93);
  const hist = new Uint32Array(256);
  for (let y = top; y < bot; y++) { const row = y * img.w; for (let x = 0; x < img.w; x++) hist[img.px[row + x]]++; }
  let ground = 0; for (let v = 1; v < 256; v++) if (hist[v] > hist[ground]) ground = v;
  //
  // Where the band ENDS decides what it is. A hole has ink on BOTH sides —
  // that is `closeDroppedBlocks`'s own definition of the fault it repairs,
  // and the thing a reader sees as a broken page. A band that runs to the
  // foot of the body is not a hole: the page simply ended, which is what a
  // contents list, a four-tile dashboard and a last content page all look
  // like. Measured 18 Sep 2026 on the 48 Redfern Street forks, all three of
  // the flagged bands were trailing and all three pages were correct — the
  // Financial's Verdict band carrying $555,000 / $445 / 4.17% / −$467, the
  // Due Diligence contents, and its Due Diligence Actions + Disclaimer.
  // A trailing band is still reported, as a short page, because a document
  // of short pages is a real observation; it is not an issue, because a
  // false caveat teaches people to dismiss the warning.
  let best = 0, bestEnd = top, run = 0, inkedRows = 0;
  for (let y = top; y < bot; y++) {
    let ink = 0; const row = y * img.w;
    for (let x = 0; x < img.w; x++) if (Math.abs(img.px[row + x] - ground) > 40) ink++;
    if (ink > img.w * 0.004) { inkedRows++; run = 0; } else { run++; if (run > best) { best = run; bestEnd = y; } }
  }
  const bodyRows = bot - top;
  const largestBandPct = +((best / bodyRows) * 100).toFixed(1);
  // Within two scan rows of the body's foot — the band ran out of page.
  const bandTrailing = bestEnd >= bot - 2;
  const blankPct = +(((bodyRows - inkedRows) / bodyRows) * 100).toFixed(1);
  const header = items.filter((i) => i.yTop < vp.height * 0.08).map((i) => i.s).join(' ').trim();
  const footer = items.filter((i) => i.yTop > vp.height * 0.92).map((i) => i.s).join(' ').trim();
  const pageNo = (footer.match(/Page\s*(\d+)\s*of\s*(\d+)/i) ?? header.match(/Page\s*(\d+)\s*of\s*(\d+)/i));
  const sentinel = findSentinel(text);
  const moji = MOJIBAKE.test(text);
  const p = {
    page: n, ground, chars: text.replace(/\s+/g, '').length, bodyChars: bodyItems.map((i) => i.s).join('').replace(/\s+/g, '').length,
    illegible, illegibleSamples, offPage: offPage.length, offPageSamples: offPage.slice(0, 2).map((t) => t.s.trim().slice(0, 30)),
    overlaps, overlapSamples, largestBandPct, bandTrailing, blankPct, hasHeader: header.length > 0, hasFooter: footer.length > 0,
    pageNo: pageNo ? { n: +pageNo[1], of: +pageNo[2] } : null, sentinel, mojibake: moji,
    firstText: bodyItems.slice(0, 6).map((i) => i.s.trim()).join(' ').slice(0, 70),
  };
  pages.push(p);
  if (illegible) issues.push({ page: n, kind: 'ILLEGIBLE', detail: `${illegible} run(s): ${illegibleSamples.join(' | ')}` });
  if (offPage.length) issues.push({ page: n, kind: 'OFF-PAGE', detail: p.offPageSamples.join(' | ') });
  if (overlaps) issues.push({ page: n, kind: 'OVERLAP', detail: overlapSamples.join(' | ') });
  if (moji) issues.push({ page: n, kind: 'MOJIBAKE', detail: JSON.stringify((text.match(MOJIBAKE)?.[0] ?? '')) });
  if (p.bodyChars === 0) issues.push({ page: n, kind: 'BLANK', detail: 'no body text' });
  else if (largestBandPct >= 45 && !bandTrailing) issues.push({ page: n, kind: 'SPARSE', detail: `largest empty band ${largestBandPct}% of body, with content below it` });
  if (sentinel) issues.push({ page: n, kind: 'TOKEN', detail: sentinel });
}
fs.rmSync(tmp, { recursive: true, force: true });
if (embeddedCount === 0 && fonts.length) issues.push({ page: 0, kind: 'FONTS', detail: `0 of ${fonts.length} fonts embedded` });

const numbering = pages.filter((p) => p.pageNo);
const numberingOk = numbering.every((p) => p.pageNo.n === p.page && p.pageNo.of === doc.numPages);
const summary = {
  label: LABEL, file: path.resolve(file), bytes: fs.statSync(file).size, pages: doc.numPages,
  fonts: { total: fonts.length, embedded: embeddedCount, names: fonts.map((f) => `${f.name}${f.embedded ? '' : ' (unembedded)'}`) },
  numbering: { drawnOn: numbering.length, correct: numberingOk },
  headers: pages.filter((p) => p.hasHeader).length, footers: pages.filter((p) => p.hasFooter).length,
  meanLargestBandPct: +(pages.reduce((s, p) => s + p.largestBandPct, 0) / pages.length).toFixed(1),
  sparsePages: pages.filter((p) => p.largestBandPct >= 45 && !p.bandTrailing).map((p) => p.page),
  shortPages: pages.filter((p) => p.largestBandPct >= 45 && p.bandTrailing).map((p) => p.page),
  issues, pagesDetail: pages,
  result: issues.length === 0 ? 'VISUAL -- PASS' : 'VISUAL -- FAIL',
};
if (opt('json')) fs.writeFileSync(opt('json'), JSON.stringify(summary, null, 2));

console.log(`\n=== ${LABEL} -- ${doc.numPages} pages, ${(summary.bytes / 1024).toFixed(0)} KB ===`);
console.log(`  fonts: ${embeddedCount}/${fonts.length} embedded   headers ${summary.headers}/${doc.numPages}   footers ${summary.footers}/${doc.numPages}   numbering ${numbering.length} drawn, ${numberingOk ? 'correct' : 'WRONG'}`);
console.log(`  mean largest empty band ${summary.meanLargestBandPct}%   holes (>=45%, content below): ${summary.sparsePages.length ? summary.sparsePages.join(',') : 'none'}   short pages: ${summary.shortPages.length ? summary.shortPages.join(',') : 'none'}`);
if (issues.length) {
  console.log(`  ${issues.length} issue(s):`);
  for (const i of issues) console.log(`    p${String(i.page).padStart(2)}  ${i.kind.padEnd(9)} ${i.detail}`);
} else console.log('  no issues');
console.log(`\n${summary.result}\n`);
process.exit(issues.length ? 1 : 0);

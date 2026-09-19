/**
 * Render every format as PDF/UA-1 and put it through a validator.
 *
 * ```
 *   npx tsx scripts/reports/validateUa.mts [--only <format>[,<format>]] [--keep <dir>]
 * ```
 *
 * A conformance claim that fails validation is worse than no claim: it tells a
 * procurement officer, a screen-reader user and an accessibility auditor that
 * the document is navigable, and none of them will find out otherwise until
 * they try. So the validator comes first and the claim second.
 *
 * The first run of this said `FAIL … ua1` on a document the repo had been
 * tagging as accessible for months. One rule, three checks: **heading level 2
 * is skipped in a descending sequence**. Six of the ten formats emitted an
 * `h1` chapter title and then an `h3`, because each had grown its own
 * `const h3 = …` helper for "a subhead" — while the design system's actual
 * subhead, `h2` at 17pt, went unused in every one of them.
 *
 * ## What this checks and what it cannot
 *
 * veraPDF is a *machine* checker. It proves the structure tree exists, the
 * levels descend, every figure carries alternative text, the language is
 * declared, and the metadata claims what the file is. It cannot tell you
 * whether the alt text is any good. That half is a person's job and is not
 * automatable; what this stops is shipping a claim that is false on its face.
 *
 * ## Getting the validator
 *
 * veraPDF is a Java tool and is not a dependency of this repo. Point
 * `VERAPDF` at the binary, or install it to `/opt/verapdf/verapdf`, which is
 * where the render container puts it. Without one this script says so and
 * exits non-zero rather than passing quietly — a validator that is not there
 * is not a validator that agrees with you.
 *
 * veraPDF's own distribution is not reachable from every egress — measured
 * 17 Sep 2026, `software.verapdf.org` answers 403 through the proxy here
 * while Maven Central answers 200, and veraPDF publishes its validation model
 * there. `scripts/reports/verapdf/get.sh` resolves it and compiles a front
 * end speaking this same command line; see that directory's README. It is the
 * official engine with a local wrapper, not a re-implementation of any check.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '../..');
const HTML_DIR = join(REPO, 'reports/html');

/** Same ten as `renderAll.mts`, by archetype id. */
const FORMATS = [
  'borrowing-capacity',
  'cash-flow-projection',
  'cash-flow-comparison',
  'client-details',
  'investment-compass',
  'market-intelligence',
  'portfolio-performance',
  'property-comparison',
  'report-qa',
  'converted',
];

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const only = flag('only')?.split(',').map((s) => s.trim()).filter(Boolean);
const wanted = only ? FORMATS.filter((f) => only.includes(f)) : FORMATS;

const VERAPDF = process.env.VERAPDF ?? '/opt/verapdf/verapdf';
if (!existsSync(VERAPDF)) {
  console.error(`no validator at ${VERAPDF}.`);
  console.error('Set VERAPDF, or install veraPDF there — the render container does.');
  console.error('Where veraPDF\'s own downloads are unreachable, run');
  console.error('  scripts/reports/verapdf/get.sh');
  console.error('which builds one from the validation model on Maven Central.');
  console.error('A claim nothing checked is the thing this script exists to prevent.');
  process.exit(2);
}

const workDir = flag('keep') ?? join(REPO, 'reports/ua');
mkdirSync(workDir, { recursive: true });

interface Finding {
  clause: string;
  test: string;
  failed: number;
  description: string;
  contexts: string[];
}

/**
 * The failures, out of veraPDF's machine-readable report.
 *
 * The text report says `FAIL <file> ua1` and nothing else, which is true and
 * useless. The MRR carries the clause, the check count and the structure-tree
 * path of every failure, and the path is the only part that tells you which
 * heading in which chapter.
 */
function validate(pdf: string): Finding[] {
  let xml: string;
  try {
    xml = execFileSync(VERAPDF, ['-f', 'ua1', '--format', 'mrr', pdf], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      // veraPDF exits non-zero when the file is non-conformant, which is the
      // ordinary case here rather than an error.
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (err) {
    xml = String((err as { stdout?: string }).stdout ?? '');
    if (!xml) throw err;
  }

  const out: Finding[] = [];
  for (const m of xml.matchAll(/<rule [^>]*status="failed"[\s\S]*?<\/rule>/g)) {
    const block = m[0];
    const attr = (name: string) => new RegExp(`${name}="([^"]*)"`).exec(block)?.[1] ?? '?';
    const description = /<description>([\s\S]*?)<\/description>/.exec(block)?.[1] ?? '';
    const contexts = [...block.matchAll(/<context>([\s\S]*?)<\/context>/g)]
      .map((c) => c[1])
      // The tail of the path is the node; the root is the same on every one.
      .map((c) => c.split('/').slice(-2).join('/'))
      .slice(0, 4);
    out.push({
      clause: attr('clause'),
      test: attr('testNumber'),
      failed: Number(attr('failedChecks')) || 0,
      description: description.replace(/\s+/g, ' ').trim(),
      contexts,
    });
  }
  return out;
}

/**
 * The one fact about the file that is not in the validator's report.
 *
 * An outline entry is a dictionary carrying both `/Title` and `/Parent`. Both
 * halves matter: the document Info dictionary also has a `/Title` and is not an
 * entry, and the outline root has a `/Parent`-less `/Count` and is not one
 * either. Counting `/Count` occurrences instead — which this did first —
 * over-reported every document by exactly two, the root and the page tree, and
 * printed 46 for an Investment report with 44 bookmarks in it.
 *
 * Only correct on an uncompressed PDF, which is why this script renders with
 * `--uncompressed-pdf` rather than reusing `reports/pdf/`.
 */
function outlineEntries(pdf: string): number {
  const bytes = readFileSync(pdf).toString('latin1');
  if (!bytes.includes('/Outlines')) return 0;
  const dicts = bytes.match(/<<[^<>]*(?:<<[^<>]*>>[^<>]*)*>>/g) ?? [];
  return dicts.filter((d) => d.includes('/Title') && d.includes('/Parent')).length;
}

const rows: Array<{ id: string; findings: Finding[]; pages: number }> = [];
const missing: string[] = [];

for (const id of wanted) {
  const html = join(HTML_DIR, `${id}.html`);
  if (!existsSync(html)) {
    missing.push(id);
    continue;
  }
  const pdf = join(workDir, `${id}.pdf`);
  // `pdf/ua-1` is the claim under test. Rendered here rather than reusing
  // `reports/pdf/` because that directory is written without a variant.
  const said = execFileSync('python3', [
    '-m', 'weasyprint', '--pdf-variant', 'pdf/ua-1', '--uncompressed-pdf', html, pdf,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (said.trim()) {
    console.error(`  ${id}: engine said —`);
    for (const line of said.trim().split('\n').slice(0, 6)) console.error(`    ${line}`);
  }
  const pages = (readFileSync(pdf).toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  rows.push({ id, findings: validate(pdf), pages });
}

const NAME_W = Math.max(8, ...rows.map((r) => r.id.length));
const pad = (s: string, n: number) => s.padEnd(n);
const num = (s: string, n: number) => s.padStart(n);

console.log(`\n${pad('format', NAME_W)}  ${num('pp', 3)}  ${num('outline', 7)}  verdict`);
console.log('─'.repeat(NAME_W + 34));
for (const r of rows) {
  const failed = r.findings.reduce((n, f) => n + f.failed, 0);
  const verdict = r.findings.length
    ? `FAIL — ${r.findings.length} rule${r.findings.length === 1 ? '' : 's'}, ${failed} check${failed === 1 ? '' : 's'}`
    : 'PDF/UA-1';
  console.log(
    `${pad(r.id, NAME_W)}  ${num(String(r.pages), 3)}  `
    + `${num(String(outlineEntries(join(workDir, `${r.id}.pdf`))), 7)}  ${verdict}`,
  );
}

for (const r of rows) {
  if (!r.findings.length) continue;
  console.log(`\n── ${r.id} ${'─'.repeat(Math.max(0, 58 - r.id.length))}`);
  for (const f of r.findings) {
    console.log(`  ${f.clause} test ${f.test} · ${f.failed} check${f.failed === 1 ? '' : 's'}`);
    console.log(`    ${f.description.slice(0, 200)}`);
    for (const c of f.contexts) console.log(`      at ${c}`);
  }
}

if (missing.length) {
  console.log(`\n⚠ no HTML artefact for: ${missing.join(', ')} — run renderAll.mts first`);
}

const clean = rows.every((r) => !r.findings.length) && !missing.length;
console.log(
  `\n${rows.length} document${rows.length === 1 ? '' : 's'} · files under ${workDir}`
  + (clean ? '\nEvery one validates as PDF/UA-1.' : ''),
);
process.exit(clean ? 0 : 1);

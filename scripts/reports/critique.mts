/**
 * Render a report, look at it, and say what is wrong with it.
 *
 * ```
 *   npx tsx scripts/reports/critique.mts <file.html|file.pdf> [--claimed 10] [--keep <dir>]
 * ```
 *
 * The loop this automates is the one that found every real defect in this
 * programme: render, rasterise, *look*, fix. `critique.pure.ts` holds the rules
 * and `measure_pages.py` holds the pixels; this is the seam between them, plus
 * the WeasyPrint call when it is handed HTML.
 *
 * It prints the findings and exits non-zero when any of them is `high`, so it
 * works as a gate. It also leaves the page images on disk — that matters more
 * than the exit code, because the mechanical rules are a floor rather than a
 * standard, and the `report-critic` agent's job starts where they stop.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  critiquePasses,
  describeCritique,
  judgeDocument,
  type DocumentMeasurement,
} from '../../supabase/functions/_shared/reports/critique.pure.ts';

const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith('--'));
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

if (!input || !existsSync(input)) {
  console.error('usage: critique.mts <file.html|file.pdf> [--claimed <n>] [--keep <dir>]');
  process.exit(2);
}

const workDir = flag('keep') ?? mkdtempSync(join(tmpdir(), 'critique-'));
mkdirSync(workDir, { recursive: true });

/** WeasyPrint, when the input is HTML. A PDF is taken as given. */
const pdf = input.endsWith('.pdf') ? resolve(input) : join(workDir, 'render.pdf');
if (!input.endsWith('.pdf')) {
  // Warnings on stderr are the point — "Ignored `box-shadow`" is a finding in
  // its own right, and silencing it is how an effect goes missing unnoticed.
  const out = execFileSync('weasyprint', [resolve(input), pdf], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (out.trim()) console.error(out.trim());
}

const claimed = flag('claimed');
const measured = execFileSync('python3', [
  resolve('scripts/reports/measure_pages.py'), pdf,
  '--dpi', '72',
  '--images', join(workDir, 'pages'),
  ...(claimed ? ['--claimed', claimed] : []),
], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const doc = JSON.parse(measured) as DocumentMeasurement & {
  pages: Array<{ page: number; image?: string; inkCoverage: number; lines: string[] }>;
};
const findings = judgeDocument(doc);

console.log(`${doc.pages.length} pages · images in ${join(workDir, 'pages')}`);
for (const p of doc.pages) {
  console.log(`  p${String(p.page).padStart(2)} ink=${p.inkCoverage.toFixed(3)} lines=${String(p.lines.length).padStart(3)}`);
}

if (!findings.length) {
  console.log('\nNo mechanical findings. Look at the pages anyway — this rubric is a floor.');
} else {
  console.log(`\n${findings.length} finding${findings.length === 1 ? '' : 's'}:`);
  console.log(describeCritique(findings));
}

process.exit(critiquePasses(findings) ? 0 : 1);

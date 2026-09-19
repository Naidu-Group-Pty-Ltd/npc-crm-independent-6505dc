/**
 * The identified S5 artefact set — what each of the ten documents IS.
 *
 *   npx tsx scripts/reports/s5Manifest.mts
 *
 * A page count on its own identifies nothing: the same report, from the same
 * record, through the same template, drew 24 pages before one pagination fix
 * and 21 after it, with no word changed. So every document here is stamped
 * with what produced it — the candidate commit, the assessment and evidence
 * versions it was built from, the template it was bound into, and the sha256
 * of the file itself. An artefact that cannot be matched to a row of this
 * table is superseded by construction.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { PLANNING_ANSWER_VERSION } from '../../supabase/functions/_shared/planning/planningAnswerVersion.pure';
import { INVESTMENT_COMPASS_TEMPLATES } from '../template-library/investmentCompass/templates';

const REPO = resolve(import.meta.dirname, '../..');
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: REPO, encoding: 'utf8' }).trim();
/**
 * The commit that last changed something these documents are DRAWN from.
 *
 * `HEAD` moves when a doc is written, and a documentation commit cannot alter
 * a rendered PDF — so identifying the set by `HEAD` alone would make every
 * artefact look superseded the moment its own manifest was recorded. The
 * code-state commit is the one that actually identifies the set, and it holds
 * still across the commits that describe it.
 */
const codeCommit = execFileSync('git', [
  'log', '-1', '--format=%H %ad', '--date=short', '--',
  'src', 'supabase', 'scripts/template-library', 'scripts/reports',
], { cwd: REPO, encoding: 'utf8' }).trim();

const template = INVESTMENT_COMPASS_TEMPLATES.find(
  (t) => String((t as never as { slug?: string }).slug ?? '').includes('-pb-01-'),
)! as never as { name: string; slug: string; schema: unknown };
const templateHash = sha(JSON.stringify(template.schema)).slice(0, 16);

const SUBJECTS = ['annabelle', 'pallas'] as const;
const KINDS = ['compass', 'financial', 'strategic', 'briefing', 'snapshot'] as const;
const LABEL: Record<string, string> = {
  compass: 'Investment Compass', financial: 'Financial Analysis',
  strategic: 'Due Diligence', briefing: 'Executive Briefing', snapshot: 'Snapshot',
};

console.log(`# S5 identified artefact set\n`);
console.log(`Candidate commit  ${commit}${dirty ? '  (WORKING TREE DIRTY — not a candidate)' : ''}`);
console.log(`Code state        ${codeCommit}`);
console.log(`Template          ${template.name} · ${template.slug} · schema sha256 ${templateHash}`);
console.log(`Planning answer   ${PLANNING_ANSWER_VERSION}`);
console.log(`Print contract    WeasyPrint 69.0 · pdf/ua-1 · tagged · srgb · optimize_images\n`);

for (const s of SUBJECTS) {
  const row = JSON.parse(readFileSync(resolve(REPO, `reports/fixtures/${s}-row.json`), 'utf8'));
  const v2 = row.investment_score?.v2 ?? {};
  console.log(`## ${row.property_address}`);
  console.log(`  assessment row      ${row.id}`);
  console.log(`  updated_at          ${row.updated_at}`);
  console.log(`  calculation_version ${row.calculation_version ?? '(none)'}`);
  console.log(`  scoring             v${v2.activation?.methodologyVersion ?? '?'} · `
    + `${v2.activation?.reference ?? '?'} · grade ${v2.grade ?? '—'} · score ${v2.score ?? '—'}`);
  console.log(`  parent content      ${String(row.report_content ?? '').length} chars, `
    + `sha256 ${sha(String(row.report_content ?? '')).slice(0, 16)}`);
  console.log('');
  console.log('  | report | pages | bytes | file sha256 |');
  console.log('  | --- | ---: | ---: | --- |');
  for (const k of KINDS) {
    const p = resolve(REPO, `reports/pdf/s5-${s}-${k}.pdf`);
    let pages = '—', bytes = '—', hash = 'NOT PRESENT';
    try {
      const buf = readFileSync(p);
      bytes = String(statSync(p).size);
      hash = sha(buf).slice(0, 32);
      pages = execFileSync('pdfinfo', [p], { encoding: 'utf8' }).match(/^Pages:\s+(\d+)/m)?.[1] ?? '—';
    } catch { /* reported as absent */ }
    console.log(`  | ${LABEL[k]} | ${pages} | ${bytes} | \`${hash}\` |`);
  }
  console.log('');
}

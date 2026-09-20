/**
 * The read-path preservation check.
 *
 * Run it at two revisions over the same stored rows and diff the two files
 * with `read-path-preservation-diff.mjs`. It answers the question the
 * acceptance standard asks of any change to how a report is READ: does a
 * verified fact, an accepted financial input, a material finding or a user
 * edit survive?
 *
 *   npx tsx scripts/verify/read-path-preservation.mts \
 *     .verify/fixtures audit-output/tmp/preserve-head.json
 *
 *   # in a worktree at the merge base, with the same fixtures:
 *   npx tsx scripts/verify/read-path-preservation.mts \
 *     /path/to/.verify/fixtures /path/to/preserve-base.json
 *
 *   node scripts/verify/read-path-preservation-diff.mjs
 *
 * Nothing here writes to a report row, so the STORED bytes are trivially
 * unchanged on both sides; what this measures is what a reader is shown.
 *
 * Modules a branch CREATED do not exist at its base, so every import is
 * optional and its absence is recorded rather than thrown — which is what
 * lets one file run at both revisions.
 *
 * Measured 19 Sep 2026, branch `claude/reporting-engine-audit-4850hs`
 * (601bae591) against its merge base 6d2a9c987, over 105 stored rows:
 * prose byte-identical on 105 of 105, 831 unsupported directives removed,
 * 104 loan structure sentences derived where the base carried none, and no
 * other difference in any field.
 */
import { readdirSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';

const root = process.argv[4] ?? '../../supabase/functions/_shared';
const opt = async (path: string) => { try { return await import(path); } catch { return null; } };
const engine = await opt(`${root}/reports/investment/financialEngine.pure.ts`);
const chart = await opt(`${root}/reports/investment/chartEvidence.pure.ts`);
const projection = await opt(`${root}/reportBindingProjection.pure.ts`);

const dir = process.argv[2] ?? '.verify/fixtures';
const out = process.argv[3]!;
const rows: any[] = [];
for (const d of readdirSync(dir)) {
  const p = `${dir}/${d}/report.json`;
  if (!existsSync(p)) continue;
  try { rows.push(JSON.parse(readFileSync(p, 'utf8'))); } catch { /* skip */ }
}
rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const DIRECTIVE = /\{\{\s*[a-zA-Z_]+\s*:[^}]*\}\}/g;
const record: any[] = [];
for (const r of rows) {
  const content = String(r.report_content ?? '');
  let fin: any = null;
  try { fin = engine?.reconcileStoredFinancials(r.financial_calculations).fin ?? null; } catch { /* absent */ }

  // What a reader is SHOWN: the document after every read-path rule this
  // revision has. At the base there is no evidence contract, so the document
  // is itself.
  let shown = content;
  let findings = 0;
  if (chart?.enforceChartEvidence && chart?.readEvidenceInventory) {
    try {
      const e = chart.enforceChartEvidence(content, chart.readEvidenceInventory(r));
      shown = e.markdown; findings = e.findings.length;
    } catch { /* keep the document */ }
  }
  /*
   * PROSE is the sentences a client reads. A `{{…}}` directive is a figure,
   * and so is a `::: stat …  :::` fence — a label, a unit and a value, which
   * is a summary-strip card rather than a sentence. Every other `:::` kind
   * (pull quote, sidenote, divider, quote page) wraps prose and its content
   * stays in, so a change to one would still show here.
   */
  const proseLinesOf = (md: string): string[] => {
    const kept: string[] = [];
    let inStat = false;
    for (const raw of md.split('\n')) {
      const t = raw.trim();
      if (!inStat && /^:::\s*stat\b/i.test(t)) { inStat = true; continue; }
      if (inStat) { if (t === ':::') inStat = false; continue; }
      if (!t || t.startsWith('{{')) continue;
      kept.push(raw);
    }
    return kept;
  };
  const prose = proseLinesOf(shown).join('\n');
  let proj: any = null;
  try { proj = projection?.projectInvestmentReport(r, {} as any) ?? null; } catch { /* absent */ }

  record.push({
    id: String(r.id).slice(0, 8),
    tier: r.report_tier ?? null,
    proseLines: prose ? prose.split('\n').length : 0,
    proseHash: hash(prose),
    directives: [...shown.matchAll(DIRECTIVE)].length,
    findings,
    loan: fin?.loanDetails ? {
      monthlyPayment: fin.loanDetails.monthlyPayment ?? null,
      annualPayment: fin.loanDetails.annualPayment ?? null,
      totalInterest: fin.loanDetails.totalInterest ?? null,
      interestRate: fin.loanDetails.interestRate ?? null,
      loanAmount: fin.loanDetails.loanAmount ?? null,
      loanType: fin.loanDetails.loanType ?? null,
      structure: fin.loanDetails.structure ?? null,
    } : null,
    capitalGrowth: fin?.assumptions?.capitalGrowth ?? null,
    cpiGrowth: fin?.assumptions?.cpiGrowth ?? null,
    occupancyWeeks: fin?.assumptions?.occupancyWeeks ?? null,
    keyMetrics: fin?.keyMetrics ?? null,
    initialCosts: fin?.initialCosts ?? null,
    projectionsY1: fin?.projections?.moderate?.[0] ?? null,
    projectionsY10: fin?.projections?.moderate?.[9] ?? null,
    projFinancials: proj?.financials ?? null,
  });
}
mkdirSync(out.replace(/\/[^/]+$/, ''), { recursive: true });
writeFileSync(out, JSON.stringify(record, null, 1));
console.log(`wrote ${record.length} rows to ${out} (engine=${Boolean(engine)} chart=${Boolean(chart)} projection=${Boolean(projection)})`);

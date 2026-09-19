/**
 * What survived the fork, read back out of the isolated database.
 *
 * The delivery instruction: "Annabelle's accepted override and the other
 * protected fixture inputs must survive generation, fork, condensation,
 * editing, saving and export as applicable." This is the fork leg, measured
 * on the PERSISTED child rows rather than on the objects in memory — the
 * distinction that matters, because a value can be correct in the composer
 * and lost by the write.
 *
 * Every field below is named because something downstream depends on it:
 * `purchasePrice` is the accepted modelling input (§3B); `capitalGrowth` is
 * the accepted CGR override the market-evidence block must not displace (§4);
 * the loan triple is the ledger's; `lvr` is `healFinanceIdentity`'s arbiter.
 */
import { execFileSync } from 'node:child_process';

const PG = ['-h', '127.0.0.1', '-p', '55432', '-U', 's5', '-d', 's5'];
const q = (sql: string) => execFileSync('psql', [...PG, '-Atc', sql],
  { encoding: 'utf8', maxBuffer: 1 << 28 }).trim();

/** (label, JSON path into the row) — the protected inputs. */
const PROTECTED: Array<[string, string]> = [
  ['manual_overrides.purchasePrice', "manual_overrides->>'purchasePrice'"],
  ['manual_overrides.propertyValue', "manual_overrides->>'propertyValue'"],
  ['manual_overrides.capitalGrowth (CGR)', "manual_overrides->>'capitalGrowth'"],
  ['manual_overrides.loanAmount', "manual_overrides->>'loanAmount'"],
  ['manual_overrides.loanType', "manual_overrides->>'loanType'"],
  ['manual_overrides.interestRate', "manual_overrides->>'interestRate'"],
  ['manual_overrides.weeklyRent', "manual_overrides->>'weeklyRent'"],
  ['manual_overrides.occupancyRate', "manual_overrides->>'occupancyRate'"],
  ['manual_overrides.strataFees (explicit 0?)', "manual_overrides->>'strataFees'"],
  ['fin.initialCosts.propertyValue', "financial_calculations->'initialCosts'->>'propertyValue'"],
  ['fin.loanDetails.loanAmount', "financial_calculations->'loanDetails'->>'loanAmount'"],
  ['fin.keyMetrics.lvr', "financial_calculations->'keyMetrics'->>'lvr'"],
  ['fin.keyMetrics.grossRentalYield', "financial_calculations->'keyMetrics'->>'grossRentalYield'"],
  ['fin.income.weeklyRent', "financial_calculations->'income'->>'weeklyRent'"],
  ['fin.annualCosts.totalAnnual', "financial_calculations->'annualCosts'->>'totalAnnual'"],
  ['fin.projections.moderate[9].propertyValue', "financial_calculations->'projections'->'moderate'->9->>'propertyValue'"],
];

const FAMILIES = [
  { key: 'annabelle', parent: '9bd41c05-7f9b-41e8-819a-a029f4121369' },
  { key: 'pallas', parent: '3a4a3d9b-4d2d-4296-9e39-3fab0c2ae753' },
];

let failures = 0;
for (const fam of FAMILIES) {
  const kids = q(`select id||'|'||report_variant from public.investment_reports `
    + `where derived_from_report_id='${fam.parent}' order by report_variant`).split('\n').filter(Boolean);
  console.log(`\n${'='.repeat(74)}\n${fam.key.toUpperCase()}  parent ${fam.parent}`);
  console.log(`children persisted: ${kids.map((k) => k.split('|')[1]).join(', ')}`);
  console.log(`\n${'field'.padEnd(42)} ${'parent'.padEnd(13)} ${kids.map((k) => k.split('|')[1].padEnd(13)).join('')}`);
  for (const [label, path] of PROTECTED) {
    const parentVal = q(`select coalesce(${path},'<null>') from public.investment_reports where id='${fam.parent}'`);
    const kidVals = kids.map((k) =>
      q(`select coalesce(${path},'<null>') from public.investment_reports where id='${k.split('|')[0]}'`));
    const same = kidVals.every((v) => v === parentVal);
    if (!same) failures += 1;
    console.log(`${(same ? '  ' : '✗ ') + label.padEnd(40)} ${parentVal.padEnd(13)} `
      + kidVals.map((v) => v.padEnd(13)).join(''));
  }
  // The linkage both engines read (subReportFamily.pure.ts).
  const linkage = q(`select count(*) from public.investment_reports `
    + `where derived_from_report_id='${fam.parent}' and parent_report_id='${fam.parent}'`);
  console.log(`\n  both linkage columns written on ${linkage} of ${kids.length} children`);
  if (Number(linkage) !== kids.length) failures += 1;
}

console.log(`\n${'='.repeat(74)}`);
console.log(failures === 0
  ? 'PASS — every protected input is byte-identical on every persisted child.'
  : `FAIL — ${failures} protected input(s) changed across the fork.`);
process.exit(failures === 0 ? 0 : 1);

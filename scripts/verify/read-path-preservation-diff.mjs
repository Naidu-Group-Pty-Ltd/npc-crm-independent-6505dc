/**
 * Diff two `read-path-preservation.mts` captures. See that file's header.
 *
 *   node scripts/verify/read-path-preservation-diff.mjs [base.json] [head.json]
 */
import { readFileSync } from 'node:fs';
const base = JSON.parse(readFileSync(process.argv[2] ?? 'audit-output/tmp/preserve-base.json', 'utf8'));
const head = JSON.parse(readFileSync(process.argv[3] ?? 'audit-output/tmp/preserve-head.json', 'utf8'));
const byId = new Map(base.map((r) => [r.id, r]));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const buckets = new Map();
const note = (k, id) => { if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(id); };
let proseSame = 0, directivesDropped = 0, structureAdded = 0;

for (const h of head) {
  const b = byId.get(h.id);
  if (!b) { note('MISSING AT BASE', h.id); continue; }

  // ── the prose a client reads ────────────────────────────────────────────
  if (h.proseHash === b.proseHash && h.proseLines === b.proseLines) proseSame += 1;
  else note('PROSE CHANGED', h.id);

  // ── the directives ──────────────────────────────────────────────────────
  if (h.directives < b.directives) directivesDropped += b.directives - h.directives;
  else if (h.directives > b.directives) note('DIRECTIVES ADDED', h.id);

  // ── every financial field the standard names ────────────────────────────
  for (const k of ['capitalGrowth', 'cpiGrowth', 'occupancyWeeks', 'keyMetrics',
                   'initialCosts', 'projectionsY1', 'projectionsY10', 'projFinancials']) {
    if (!eq(h[k], b[k])) note(`CHANGED: ${k}`, h.id);
  }

  // ── the loan block, field by field ──────────────────────────────────────
  if (h.loan || b.loan) {
    if (!h.loan || !b.loan) { note('LOAN APPEARED/VANISHED', h.id); continue; }
    for (const k of Object.keys(h.loan)) {
      if (eq(h.loan[k], b.loan[k])) continue;
      if (k === 'structure' && b.loan[k] === null && typeof h.loan[k] === 'string') { structureAdded += 1; continue; }
      note(`CHANGED: loan.${k}`, h.id);
    }
  }
}

console.log(`rows compared: ${head.length}`);
console.log(`prose byte-identical: ${proseSame} of ${head.length}`);
console.log(`directives removed by the evidence contract: ${directivesDropped}`);
console.log(`loan structure sentences DERIVED (base had none): ${structureAdded}`);
console.log(`\nunexpected differences: ${buckets.size === 0 ? 'NONE' : ''}`);
for (const [k, ids] of [...buckets].sort()) console.log(`  ${String(ids.length).padStart(3)} × ${k}  e.g. ${ids.slice(0, 4).join(', ')}`);
process.exit(buckets.size === 0 ? 0 : 1);

/**
 * Macro scan — every template in the library, checked for display defects.
 *
 * The measurement lives in `macroScan.pure.ts`; this is the part that knows
 * which templates exist. It walks the same 543 the seed builder writes, as one
 * set rather than per-format, so a defect class present in both authoring
 * systems is reported once.
 *
 * `npm run templates:macro-scan`.
 */
import { scanTemplate, type Finding } from './macroScan.pure';
import { SEED_TEMPLATES } from './templates';
import { INVESTMENT_COMPASS_TEMPLATES } from './investmentCompass/templates';
import { BORROWING_CAPACITY_TEMPLATES } from './investmentCompass/borrowingCapacity';
import { PORTFOLIO_TEMPLATES } from './investmentCompass/portfolio';
import { COMPARISON_TEMPLATES } from './investmentCompass/comparison';
import { CASH_FLOW_COMPASS_TEMPLATES } from './investmentCompass/cashFlow';
import { CLIENT_DETAILS_TEMPLATES } from './investmentCompass/clientDetails';
import { CASH_FLOW_COMPARISON_TEMPLATES } from './investmentCompass/cashFlowComparison';
import { REPORT_QA_TEMPLATES } from './investmentCompass/reportQa';
import { COMMERCIAL_CAPACITY_TEMPLATES } from './investmentCompass/commercialCapacity';
import { MARKET_INTELLIGENCE_TEMPLATES } from './investmentCompass/marketIntelligence';

// ─────────────────────────────────────────────────────────────────────────────

const GROUPS: Array<[string, any[]]> = [
  ['voice (seeded)', SEED_TEMPLATES as any[]],
  ['investment_compass', INVESTMENT_COMPASS_TEMPLATES as any[]],
  ['borrowing_capacity', BORROWING_CAPACITY_TEMPLATES as any[]],
  ['portfolio', PORTFOLIO_TEMPLATES as any[]],
  ['comparison', COMPARISON_TEMPLATES as any[]],
  ['cash_flow', CASH_FLOW_COMPASS_TEMPLATES as any[]],
  ['client_details', CLIENT_DETAILS_TEMPLATES as any[]],
  ['cash_flow_comparison', CASH_FLOW_COMPARISON_TEMPLATES as any[]],
  ['qa', REPORT_QA_TEMPLATES as any[]],
  ['commercial_capacity', COMMERCIAL_CAPACITY_TEMPLATES as any[]],
  ['market_intelligence', MARKET_INTELLIGENCE_TEMPLATES as any[]],
];

const findings: Finding[] = [];
let total = 0;
let pageTotal = 0;
for (const [label, list] of GROUPS) {
  for (const t of list) {
    scanTemplate(t, label, findings);
    total += 1;
    pageTotal += (t.schema?.pages ?? []).length;
  }
}

console.log(`\nMacro scan — ${total} templates, ${pageTotal} pages\n`);

const byKind = new Map<string, Finding[]>();
for (const f of findings) {
  if (!byKind.has(f.kind)) byKind.set(f.kind, []);
  byKind.get(f.kind)!.push(f);
}

if (findings.length === 0) {
  console.log('  No display defects found.\n');
} else {
  for (const [kind, list] of [...byKind].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`${kind}: ${list.length}`);
    // Group by report type, then show a couple of concrete instances. A defect
    // in a family master is almost always in all fifty of that format, so the
    // instance count matters more than the list.
    const byType = new Map<string, Finding[]>();
    for (const f of list) {
      if (!byType.has(f.reportType)) byType.set(f.reportType, []);
      byType.get(f.reportType)!.push(f);
    }
    for (const [type, tl] of [...byType].sort((a, b) => b[1].length - a[1].length)) {
      const pages = new Map<string, Finding[]>();
      for (const f of tl) {
        const k = `${f.page} :: ${f.detail}`;
        if (!pages.has(k)) pages.set(k, []);
        pages.get(k)!.push(f);
      }
      console.log(`   ${type}: ${tl.length} across ${pages.size} distinct site(s)`);
      for (const [k, pl] of [...pages].sort((a, b) => b[1].length - a[1].length).slice(0, 6)) {
        console.log(`      ×${pl.length}  ${k}`);
        console.log(`             e.g. ${pl[0].template}`);
      }
      if (pages.size > 6) console.log(`      … ${pages.size - 6} more site(s)`);
    }
    console.log('');
  }
}

console.log(`Total findings: ${findings.length}\n`);

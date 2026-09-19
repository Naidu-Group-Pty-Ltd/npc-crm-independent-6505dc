import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * RS-5c.1 — a chosen template is drawn by the pinned engine on every format.
 *
 * `routeReportThroughTemplate` defaults to the browser's jsPDF unless a caller
 * names the final renderer, and only the Investment delivery did. Measured
 * 14 Sep 2026: all nine other formats' deliver modules asked for a templated
 * document without naming a renderer, so choosing a template on any of them
 * DOWNGRADED the document — jsPDF embeds no fonts and cannot draw text on a
 * filled panel — while the format's own route was WeasyPrint. This scans the
 * source: every ask for a templated document in a delivery path names the
 * final renderer. A preview surface is not a delivery path and is not listed.
 */
const ROOT = resolve(__dirname, '../../../..');
const DELIVERY_MODULES = [
  'src/lib/reports/investment/deliverInvestmentPdf.ts',
  'src/lib/reports/borrowingCapacity/deliverSnapshot.ts',
  'src/lib/reports/portfolio/deliverPortfolioReview.ts',
  'src/lib/reports/propertyComparison/deliverComparisonPdf.ts',
  'src/lib/reports/clientDetails/deliverClientDetailsPdf.ts',
  'src/lib/reports/reportQa/deliverReportQaPdf.ts',
  'src/lib/reports/marketIntelligence/deliverMarketIntelligencePdf.ts',
  'src/hooks/useCapacityReport.ts',
  'src/components/reports/CashFlowAnalysisModal.tsx',
];

/** Every `tryTemplateDocument(` call in a source, with its full argument list. */
function templateAsks(source: string): string[] {
  const asks: string[] = [];
  let from = 0;
  for (;;) {
    const at = source.indexOf('tryTemplateDocument(', from);
    if (at < 0) break;
    let depth = 0;
    let end = at + 'tryTemplateDocument'.length;
    for (; end < source.length; end += 1) {
      const ch = source[end];
      if (ch === '(') depth += 1;
      else if (ch === ')') { depth -= 1; if (depth === 0) break; }
    }
    asks.push(source.slice(at, end + 1));
    from = end + 1;
  }
  return asks;
}

describe('a chosen template is drawn by the final renderer on every format', () => {
  it('every delivery path names the final renderer when it asks for a templated document', () => {
    for (const rel of DELIVERY_MODULES) {
      const source = readFileSync(resolve(ROOT, rel), 'utf8');
      const asks = templateAsks(source);
      expect(asks.length, `${rel} asks for a templated document`).toBeGreaterThan(0);
      for (const ask of asks) {
        expect(ask, `${rel}\n${ask}`).toMatch(/renderer:\s*'weasyprint'/);
        expect(ask, `${rel}\n${ask}`).not.toMatch(/renderer:\s*'browser'/);
      }
    }
  });

  it('nothing outside a delivery path asks for the final renderer by name', () => {
    // The final renderer is a deliberate act of delivery; a preview surface,
    // a picker or a builder never names it. Listed by exclusion so a new
    // caller has to be a delivery module or fail here.
    const { execSync } = require('node:child_process') as typeof import('node:child_process');
    const hits = execSync(
      "grep -rln \"renderer: 'weasyprint'\" src --include=*.ts --include=*.tsx | grep -v '__tests__' | grep -v '\\.spec\\.' || true",
      { cwd: ROOT, encoding: 'utf8' },
    ).split('\n').map((s) => s.trim()).filter(Boolean).sort();
    const allowed = [...DELIVERY_MODULES, 'src/lib/reportTemplate/routeReportThroughTemplate.ts'].sort();
    for (const hit of hits) expect(allowed, hit).toContain(hit);
  });
});

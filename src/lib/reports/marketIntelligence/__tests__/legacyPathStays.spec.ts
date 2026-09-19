/**
 * The legacy generator stays reachable — as the named choice, not the default.
 *
 * The migration added the typeset path beside the jsPDF one; the
 * legacy-consolidation phase then made the typeset document the primary road
 * on both call sites and demoted the jsPDF layout to an explicit
 * "legacy layout" choice, drawn only when picked. Both halves are pinned:
 * `MarketIntelligencePDFGenerator.ts` is still a shipping browser-side jsPDF
 * class reachable from both call sites (somebody's workflow depends on the
 * exact document it produces), and nothing draws it silently any more.
 *
 * Every assertion here was checked by breaking what it guards — an assertion
 * that has never failed is a claim, not a test. Two Client Details assertions
 * and three Report Q&A ones passed while their subject was broken.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = resolve(__dirname, '../../../../..');
const read = (p: string) => readFileSync(resolve(REPO, p), 'utf8');

/** Comments stripped, because these files' prose names what they replace. */
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const LEGACY = 'src/components/marketing/MarketIntelligencePDFGenerator.ts';
const EXPORT_BUTTON = 'src/components/marketing/MarketIntelligenceExportButton.tsx';
const HISTORY_MODAL = 'src/components/marketing/MarketIntelligenceHistoryModal.tsx';
const NEW_BUTTON = 'src/components/marketing/MarketIntelligenceDownloadButton.tsx';

describe('the legacy generator', () => {
  it('still exists and still uses jsPDF', () => {
    const source = code(LEGACY);
    expect(source).toMatch(/from ['"]jspdf['"]/);
    expect(source).toContain('generateMarketIntelligencePDF');
  });

  it('is still driven from both call sites', () => {
    for (const caller of [EXPORT_BUTTON, HISTORY_MODAL]) {
      expect(code(caller), `${caller} no longer calls the legacy generator`)
        .toContain('generateMarketIntelligencePDF');
    }
  });

  it('is a named choice on both call sites, drawn only when picked', () => {
    // The export panel labels it; the history modal titles its icon.
    expect(read(EXPORT_BUTTON)).toContain('Download (legacy layout)');
    expect(read(HISTORY_MODAL)).toContain('Download (legacy layout)');
  });

  it('is never drawn as a side effect of generating', () => {
    // Generating used to build and auto-save the legacy PDF, which made the
    // browser engine the default road nobody picked. The generate handler now
    // stops at the row; the legacy draw lives in its own handler.
    const source = code(EXPORT_BUTTON);
    const handler = /const handleGenerate = async \([\s\S]*?\n {2}\};/.exec(source)?.[0] ?? '';
    expect(handler, 'handleGenerate not found').not.toBe('');
    expect(handler).not.toContain('generateMarketIntelligencePDF(');
  });

  it('still drives the History modal\'s re-download itself', () => {
    // Scoped to the handler, not the file. The modal calls the legacy twice —
    // once for the re-download and once for the flatten button — so a
    // file-wide match passes with the re-download gutted, which is exactly what
    // it did when that mutation was tried.
    const source = code(HISTORY_MODAL);
    const handler = /const handleRedownload = async \([\s\S]*?\n {2}\};/.exec(source)?.[0] ?? '';
    expect(handler, 'handleRedownload not found').not.toBe('');
    expect(handler).toMatch(/await generateMarketIntelligencePDF\(/);
  });
});

describe('the new control is offered beside it', () => {
  it('is mounted on both call sites', () => {
    for (const caller of [EXPORT_BUTTON, HISTORY_MODAL]) {
      expect(code(caller), `${caller} does not mount the typeset control`)
        .toContain('<MarketIntelligenceDownloadButton');
    }
  });

  it('never falls back to the legacy generator', () => {
    // The two produce different documents, so substituting one for the other
    // would send somebody something nobody chose.
    const request = code('src/lib/reports/marketIntelligence/requestMarketIntelligencePdf.ts');
    expect(request).not.toContain('generateMarketIntelligencePDF');
    expect(request).not.toContain('MarketIntelligencePDFGenerator');
  });

  it('says what still works when the route is not deployed', () => {
    const request = read('src/lib/reports/marketIntelligence/requestMarketIntelligencePdf.ts');
    expect(request).toMatch(/render-market-intelligence-pdf has not been\s+\+?\s*'?deployed/);
    expect(request).toMatch(/Download PDF button/);
  });
});

describe('the new path draws no PDF in the browser', () => {
  it('imports neither jsPDF nor pdf-lib anywhere', () => {
    for (const file of [
      NEW_BUTTON,
      'src/lib/reports/marketIntelligence/requestMarketIntelligencePdf.ts',
      'src/lib/reports/marketIntelligence/deliverMarketIntelligencePdf.ts',
    ]) {
      const source = code(file);
      for (const library of ['jspdf', 'jsPDF', 'pdf-lib', 'html2canvas', 'PDFDocument']) {
        expect(source, `${file} references ${library}`).not.toContain(library);
      }
    }
  });

  it('hands back a Blob, so the bytes can go somewhere other than a disk', () => {
    // Asserted on the returned shape, not on a substring. The Client Details
    // twin's `toContain('blob: Blob')` was satisfied by an unrelated function
    // two definitions away and passed while the thing it named was missing.
    const source = read('src/lib/reports/marketIntelligence/deliverMarketIntelligencePdf.ts');
    const iface = /export interface DeliveredMarketIntelligence \{([\s\S]*?)\n\}/.exec(source)?.[1] ?? '';
    expect(iface).toMatch(/\bblob:\s*Blob\b/);
    const returned = /return \{([\s\S]*?)\n {2}\};/.exec(source)?.[1] ?? '';
    expect(returned).toMatch(/\bblob,/);
  });
});

describe('the correlation block now reaches the row', () => {
  it('is sent to the generator, not only to the browser renderer', () => {
    // The panel has always had it and only ever handed it to the in-browser
    // generator, so it never reached `report_data` and every re-download from
    // the History modal silently dropped the section.
    const source = code(EXPORT_BUTTON);
    expect(source).toMatch(/correlation_data:\s*correlationData/);
  });

  it('is persisted by the generator when it arrives', () => {
    const source = code('supabase/functions/generate-market-intelligence-report/index.ts');
    expect(source).toContain('correlation_data');
    expect(source).toMatch(/\.\.\.\(correlationData \? \{ correlationData \} : \{\}\)/);
  });
});

describe('the render route', () => {
  const route = code('supabase/functions/render-market-intelligence-pdf/index.ts');

  it('gates on the marketing module and refuses service-role', () => {
    expect(route).toContain("'marketing_analytics'");
    expect(route).toContain("auth.userId === 'service_role'");
  });

  it('checks the query error before the data', () => {
    // The defect that 404'd a Borrowing Capacity render and cost a full
    // debugging cycle: a failed query returning nothing is not an empty record.
    const errorAt = route.indexOf('reportRes.error');
    const dataAt = route.indexOf('!reportRes.data');
    expect(errorAt).toBeGreaterThan(-1);
    expect(dataAt).toBeGreaterThan(errorAt);
  });

  it('runs the resource policy before the WeasyPrint call', () => {
    expect(route.indexOf('assertSafeRenderResources'))
      .toBeLessThan(route.indexOf('await renderPdf('));
  });

  it('writes pdf_storage_path only after the upload succeeded', () => {
    expect(route.indexOf('storage.from(STORAGE_BUCKET).upload'))
      .toBeLessThan(route.indexOf('pdf_storage_path: path'));
  });

  it('upserts, because the path is stable and names the current PDF', () => {
    expect(route).toMatch(/upsert:\s*true/);
  });

  it('leaves a ledger row on failure', () => {
    expect(route).toContain("status: 'failed'");
    expect(route).toContain('market_intelligence_renders');
  });

  it('has no fallback to the browser generator', () => {
    expect(route).not.toContain('generateMarketIntelligencePDF');
  });
});

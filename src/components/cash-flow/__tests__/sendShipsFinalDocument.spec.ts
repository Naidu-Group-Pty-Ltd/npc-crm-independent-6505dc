/**
 * RS-5c.2 — "Send to Client" ships the FINAL Cash Flow document.
 *
 * Measured 14 Sep 2026: the Cash Flow analysis had two documents behind two
 * controls. "Generate PDF" asked the chosen template and then the format's own
 * WeasyPrint route; "Send to Client" ran the in-browser jsPDF generator with
 * its own three chart switches and uploaded THAT to `investment-reports`. So
 * the file a client opened in their portal was never the document the adviser
 * had generated and reviewed — and it was a jsPDF (no embedded fonts, no text
 * on filled panels) while the download was the typeset one.
 *
 * The rule now: one producer, both exits. Generate saves the document and
 * remembers where the renderer stored it; Send points the portal at that
 * object when the projection is unchanged, or produces it once and points at
 * it. Nothing here is a second copy, and nothing here can differ from the
 * download. These are source-level pins because the modal is 6,000 lines of
 * React that no unit harness mounts.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const stripComments = (source: string) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const modal = stripComments(read('src/components/reports/CashFlowAnalysisModal.tsx'));
const sendDialog = stripComments(read('src/components/reports/SendToClientModal.tsx'));

/** The body of one `useCallback` const, from its declaration to its dependency list. */
function callbackBody(source: string, name: string): string {
  const start = source.indexOf(`const ${name} = useCallback(`);
  expect(start, `${name} is declared`).toBeGreaterThan(-1);
  const end = source.indexOf('\n  }, [', start);
  expect(end, `${name} closes with a dependency list`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('one producer for the final Cash Flow document', () => {
  it('describes the reviewed projection once, and keys the document on it', () => {
    const describe_ = callbackBody(modal, 'describeReviewedProjection');
    expect(describe_).toContain('toWireProjection(');
    expect(describe_).toContain('matchStoredScenario(');
    // The template choice is read ONCE and travels with the key, so the
    // document filed under a key was rendered under the choice the key names.
    expect(describe_).toContain("selectedTemplateFor('cashflow')");
    // While the report type is held on its own pages the choice is worn as its
    // design, which is a different document from the template's pages — so
    // the key names which of the two it is.
    expect(describe_).toMatch(/const selectedTemplateId = held \? null : chosen;/);
    expect(describe_).toMatch(/const designTemplateId = held \? chosen : null;/);
    expect(describe_).toMatch(/cashFlowFinalKey\(\{\s*wire,\s*scenario:\s*storedScenario,\s*selectedTemplateId,\s*designTemplateId\s*\}\)/);
  });

  it('asks the template and the route in exactly one place', () => {
    expect(modal.match(/tryTemplateDocument\(/g)?.length).toBe(1);
    expect(modal.match(/requestCashFlowPdf\(/g)?.length).toBe(1);
    const produce = callbackBody(modal, 'produceFinalCashFlowDocument');
    expect(produce).toContain('tryTemplateDocument(');
    expect(produce).toContain('requestCashFlowPdf(');
    // The same reading the key was built on is handed down, never re-read.
    expect(produce).toMatch(/renderer:\s*'weasyprint',\s*selectedTemplateId,/);
    // Every branch answers where the bytes already are.
    expect(produce).toMatch(/storagePath:\s*templated\.storagePath/);
    expect(produce).toMatch(/storagePath:\s*result\.storagePath/);
    expect(produce).toMatch(/source:\s*'legacy'[\s\S]{0,200}storagePath:\s*null/);
  });

  it('the download saves what the producer made and remembers where it is stored', () => {
    const download = callbackBody(modal, 'exportServerCashFlowPDF');
    expect(download).toContain('produceFinalCashFlowDocument(');
    expect(download).toContain('saveTemplateDocument({ blob: doc.blob, fileName: doc.fileName })');
    expect(download).toMatch(/setFinalCashFlowDocument\(\{ key: doc\.key, storagePath: doc\.storagePath/);
    // No private copy of the chain: the download does not ask the template
    // or the route itself, and never runs the legacy generator directly.
    expect(download).not.toContain('tryTemplateDocument(');
    expect(download).not.toContain('requestCashFlowPdf(');
    expect(download).not.toContain('exportSingleReportPDF(');
  });

  it('the send reuses the remembered document while the projection is unchanged', () => {
    const send = callbackBody(modal, 'generateAndUploadCashFlowPDF');
    expect(send).toContain('describeReviewedProjection()');
    expect(send).toMatch(/finalCashFlowDocument\.key === reviewed\.key[\s\S]{0,80}return finalCashFlowDocument\.storagePath/);
  });

  it('the send points the portal at the stored object and uploads only what nothing stored', () => {
    const send = callbackBody(modal, 'generateAndUploadCashFlowPDF');
    expect(send).toContain('produceFinalCashFlowDocument(');
    // A stored document is pointed at — returned before any upload.
    const pointAt = send.indexOf('if (doc.storagePath) {');
    const upload = send.indexOf('secureStorageUpload(');
    expect(pointAt).toBeGreaterThan(-1);
    expect(upload).toBeGreaterThan(pointAt);
    // The legacy generator is never run by the send itself.
    expect(send).not.toContain('exportSingleReportPDF(');
    // The deployment-gap upload keeps the binding that fixed audit item 14.
    expect(send).toContain('resourceId: report.id');
  });

  it('the modal mounts the send dialog on that producer and lets it decide reuse', () => {
    const mount = /<SendToClientModal[\s\S]*?\/>/.exec(modal)?.[0] ?? '';
    expect(mount).not.toBe('');
    expect(mount).toMatch(/storagePath=\{null\}/);
    expect(mount).toMatch(/onGeneratePDF=\{generateAndUploadCashFlowPDF\}/);
  });
});

describe('the send dialog carries no switch the final document cannot honour', () => {
  it('has no chart options of its own', () => {
    for (const gone of ['CashFlowChartOptions', 'chartOptions', 'isCashflow', 'includeCharts']) {
      expect(sendDialog, `${gone} survives in SendToClientModal`).not.toContain(gone);
    }
    expect(sendDialog).toMatch(/onGeneratePDF\?:\s*\(\)\s*=>\s*Promise<string \| null>/);
    expect(sendDialog).toContain('await onGeneratePDF()');
  });

  it('says the document is produced or reused, never that it is generated anew', () => {
    expect(sendDialog).toMatch(/produced when you send/);
    expect(sendDialog).toMatch(/reused when it has already been/);
    expect(sendDialog).not.toContain('automatically generated and uploaded');
  });
});

describe('the route answers where it stored the bytes', () => {
  it('render-cash-flow-pdf returns the path beside the signed url', () => {
    const route = read('supabase/functions/render-cash-flow-pdf/index.ts');
    expect(route).toMatch(/url: signed\.signedUrl,\s*path,\s*fileName,/);
    const contract = read('supabase/functions/_shared/reports/cashFlow/route.pure.ts');
    expect(contract).toMatch(/export interface CashFlowRenderResponse \{[\s\S]*?path: string;/);
  });

  it('and the client carries it as storagePath, null for the legacy generator', () => {
    const request = stripComments(read('src/lib/reports/cashFlow/requestCashFlowPdf.ts'));
    expect(request).toMatch(/storagePath:\s*typeof data\.path === 'string' && data\.path \? data\.path : null/);
    expect(request).toMatch(/storagePath:\s*null,\s*source:\s*'legacy'/);
  });
});

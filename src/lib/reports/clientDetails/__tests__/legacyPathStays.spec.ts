/**
 * The legacy client details path stays reachable — demoted, named, and last.
 *
 * The stakes are higher here than for any format before it. This document is
 * the one the business actually *sends*: it puts a file in a mortgage
 * broker's portal, and breaking that is a failure outside the building. The
 * legacy-consolidation phase made the typeset control the toolbar's one
 * primary document control and moved the two raster buttons to the end with
 * their layout named — hidden behind the unified delivery, never deleted,
 * because the raster document carries capabilities the typeset one does not
 * (the owner-occupied toggle, the borrowing-capacity appendix) and a
 * partner's workflow may depend on the exact document.
 *
 * Two claims, asserted structurally on source, because that is the property that
 * matters and a behavioural test of one button says nothing about a 2,705-line
 * generator with three destinations:
 *
 *   1. `FormaraPDFGenerator` is still there, still rasterises with html2canvas
 *      into jsPDF, and all three of its destinations still work.
 *   2. The new path is genuinely additional — it draws no PDF of its own, reads
 *      nothing from the browser, and returns a Blob so it can reach the same two
 *      places the legacy reaches.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = resolve(__dirname, '../../../../..');
const read = (path: string) => readFileSync(resolve(REPO, path), 'utf8');

/** Source with its comments removed, for assertions about what the code does. */
const code = (path: string) =>
  read(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const GENERATOR = 'src/components/clients/FormaraPDFGenerator.tsx';
const MODAL = 'src/components/clients/ClientDetailsModal.tsx';
const ROUTE = 'supabase/functions/render-client-details-pdf/index.ts';
const CONTROL = 'src/components/clients/ClientDetailsDownloadButton.tsx';

describe('the legacy generator still exists', () => {
  const source = read(GENERATOR);

  it('is still exported and still builds its own HTML', () => {
    expect(source).toContain('export function FormaraPDFGenerator');
    expect(source).toContain('function generateHTMLContent');
  });

  /**
   * The raster step is the defect this migration exists to remove — and it is
   * also what makes the legacy document what it is. Asserting it stays is
   * asserting the old document still exists, not endorsing it.
   */
  it('still rasterises into jsPDF', () => {
    expect(source).toContain("from 'html2canvas'");
    expect(source).toContain("from 'jspdf'");
    expect(source).toContain('new jsPDF(');
  });

  it('keeps all three destinations', () => {
    expect(source).toContain('const handleDownload');
    expect(source).toContain('const handleEmailSend');
    expect(source).toContain('const handleQuickSend');
    expect(source).toContain("invokeSecureFunction('share-report-with-finance'");
  });

  /** The optional borrowing-capacity pages. Not carried into the new document. */
  it('keeps its borrowing-capacity toggle', () => {
    expect(source).toContain('includeBorrowingCapacity');
    expect(source).toContain('drawBorrowingCapacitySections');
  });

  it('is still mounted twice on the client toolbar', () => {
    expect((read(MODAL).match(/<FormaraPDFGenerator/g) ?? [])).toHaveLength(2);
  });

  /**
   * The legacy-consolidation decision, pinned: the typeset control leads the
   * toolbar and the two raster buttons follow it, demoted and with their
   * layout named — hidden behind the unified delivery, never deleted. Order
   * is asserted on source position because that is the property that
   * changed; the mounts themselves are counted above.
   */
  it('follows the unified control, demoted and named as the legacy layout', () => {
    const modal = read(MODAL);
    const unifiedAt = modal.indexOf('<ClientDetailsDownloadButton');
    const firstLegacyAt = modal.indexOf('<FormaraPDFGenerator');
    expect(unifiedAt).toBeGreaterThan(-1);
    expect(firstLegacyAt).toBeGreaterThan(unifiedAt);
    expect(modal).toContain('Send to Finance (legacy layout)');
    expect(modal).toContain("'Download (legacy layout)'");
  });

  it('still reaches the email composer through the modal', () => {
    const modal = read(MODAL);
    expect(modal).toContain('const handlePdfEmailClick');
    expect(modal).toContain('onEmailClick={handlePdfEmailClick}');
  });

  /** Untouched by this migration, and named so a refactor notices. */
  it.each([
    'src/components/clients/ExportFormaraButton.tsx',
    'src/components/clients/ClientFormaraUpload.tsx',
    'src/components/clients/ClientFormaraForms.tsx',
  ])('%s is untouched', (path) => {
    expect(read(path).length).toBeGreaterThan(0);
  });
});

describe('the new path is additional, not a replacement', () => {
  const NEW_MODULES = [
    'src/lib/reports/clientDetails/requestClientDetailsPdf.ts',
    'src/lib/reports/clientDetails/deliverClientDetailsPdf.ts',
    CONTROL,
  ];

  /**
   * Comments stripped: each of these files explains in prose *why* it does not
   * rasterise anything, and a whole-file search would be satisfied by the
   * explanation rather than by the absence.
   */
  it.each(NEW_MODULES)('%s draws no PDF of its own', (path) => {
    const source = code(path);
    expect(source).not.toContain('html2canvas');
    expect(source).not.toContain('jspdf');
    expect(source).not.toContain('jsPDF');
    expect(source).not.toContain('FormaraPDFGenerator');
  });

  it('sends one id, not the client record', () => {
    const request = code('src/lib/reports/clientDetails/requestClientDetailsPdf.ts');
    expect(request).toContain("invokeSecureFunction('render-client-details-pdf'");
    // Anything more than the id and a cosmetic edition would mean the document
    // depends on what a screen happened to have fetched.
    for (const leaked of ['properties', 'liabilities', 'expenses', 'employment']) {
      expect(request, `the request carries ${leaked}`).not.toContain(leaked);
    }
  });

  it('fails with a message naming the buttons that work, rather than falling back', () => {
    const request = read('src/lib/reports/clientDetails/requestClientDetailsPdf.ts');
    expect(request).toContain('looksUndeployed');
    expect(request).toContain('Send to Finance buttons still work');
    expect(request).not.toMatch(/legacyFallback/);
  });

  /** No model is involved anywhere in this format. */
  it('is not metered', () => {
    expect(code(ROUTE)).not.toContain('withReportMetering');
  });

  /** The route reads the record and writes only its own ledger. */
  it('never writes to any client table', () => {
    const source = code(ROUTE);
    for (const table of ['clients', 'client_properties', 'client_liabilities', 'client_expenses']) {
      expect(source).not.toMatch(
        new RegExp(`from\\('${table}'\\)[\\s\\S]{0,160}\\.(update|insert|upsert|delete)\\(`),
      );
    }
    expect(source).toContain("from('client_details_renders')");
  });
});

describe('the route gates on the module its tables belong to', () => {
  const source = code(ROUTE);

  /**
   * `client_management`, not `reports`. Every table this reads is mapped to
   * `client_management` in `TABLE_TO_MODULE_MAP`; gating on `reports` would let
   * someone read a client record through a report route when they cannot read it
   * directly.
   */
  it('requires client_management rather than reports', () => {
    // The argument itself, not merely the string somewhere in the file — an
    // earlier version of this assertion matched a whole formatted call and would
    // have passed on any reformatting.
    const call = /requireModulePermission\(([\s\S]*?)\);/.exec(source)?.[1] ?? '';
    expect(call, 'the route does not gate on a module at all').toBeTruthy();
    expect(call).toContain("'client_management'");
    expect(call).not.toContain("'reports'");
  });

  it('also gates on the row itself', () => {
    // The call, not the identifier. `toContain('canAccessClient')` is satisfied
    // by the import line alone — found by replacing the call and watching this
    // pass. The same trap the Property Comparison's contract records.
    expect(source).toMatch(/const allowed = await canAccessClient\(/);
    expect(source).toMatch(/if \(!allowed\) return json\(/);
  });

  it('refuses the service-role identity', () => {
    expect(source).toContain("auth.userId === 'service_role'");
  });

  /** Nine reads, and the error checked before the data on every one. */
  it('checks every read for an error before using its data', () => {
    for (const table of [
      'clients', 'client_properties', 'client_employment', 'client_income',
      'client_income_sources', 'client_assets', 'client_liabilities',
      'client_expenses', 'client_address_history',
    ]) {
      expect(source, `${table} is not read`).toContain(`from('${table}')`);
    }
    expect(source).toContain('if (res.error) throw new Error');
  });
});

describe('the control reaches the same places the legacy does', () => {
  const control = read(CONTROL);

  /**
   * The point of the migration. A download is the least important of the three:
   * this document is read by a broker more often than by anyone here, and until
   * now they received pictures.
   */
  it('offers all three destinations', () => {
    expect(control).toContain("run('download')");
    expect(control).toContain("run('email')");
    // The finance destination now carries the partner the picker returned; it
    // used to carry whichever contact row `is_default` ordering produced.
    expect(control).toContain("run('finance', recipient)");
    expect(control).toContain("invokeSecureFunction('share-report-with-finance'");
  });

  /** Both email paths take a Blob, so `deliver` has to hand one back. */
  it('gets the bytes, not only a saved file', () => {
    const deliver = read('src/lib/reports/clientDetails/deliverClientDetailsPdf.ts');
    // The *returned* shape. `toContain('blob: Blob')` also matches
    // `saveToBrowser(blob: Blob, …)` two functions away — found by deleting the
    // interface field and watching this pass.
    expect(deliver).toMatch(/interface DeliveredClientDetails \{[\s\S]*?\bblob: Blob;[\s\S]*?\}/);
    expect(deliver).toMatch(/return \{[\s\S]*?\bblob,[\s\S]*?\};/);
    expect(deliver).toContain('save?: boolean');
    expect(control).toContain('result.blob');
  });

  it('is mounted on the client toolbar', () => {
    expect(read(MODAL)).toContain('<ClientDetailsDownloadButton');
    expect(read(MODAL)).toContain('onAttachToEmail={handlePdfEmailClick}');
  });

  /**
   * The email destination still says why it is unavailable from a screen that
   * cannot attach. The finance destination no longer can: it is always
   * offerable, because who receives it is now asked rather than defaulted — so
   * the sentence that named the Settings screen moved to the picker, which is
   * where somebody reads it with the empty list in front of them.
   */
  it('says why an unavailable destination is unavailable', () => {
    expect(control).toContain('Not available from this screen');
    const picker = read('src/components/clients/FinanceRecipientPicker.tsx');
    expect(picker).toContain('Settings → Finance Agent Contacts');
  });
});

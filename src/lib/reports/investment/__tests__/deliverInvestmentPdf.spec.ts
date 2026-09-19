/**
 * The investment delivery chain: template first, the browser's own renderer
 * behind it, one implementation for every surface. Behavioural, with the
 * engines mocked — what is pinned is the ORDER, what publish stores, and the
 * rule that one finalisation is one render.
 *
 * RC-3.1 replaced the second engine. It was `render-investment-report-pdf`,
 * which composed HTML and handed it to WeasyPrint on Cloud Run; it is
 * `generateInvestmentPdfBlob` now, the pdf-lib implementation that has drawn
 * almost every Investment PDF this product has delivered. RS-2 then brought the
 * print engine back for the FIRST presentation only: a chosen template is drawn
 * by WeasyPrint through `render-template-pdf`, which stores the document and
 * answers its path. The contract around both — template wins, something always
 * draws, the result names its engine, one stored copy — is what these pin.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/secureInvoke', () => ({ invokeSecureFunction: vi.fn() }));
vi.mock('@/lib/reportTemplate/templateDocument', () => ({
  tryTemplateDocument: vi.fn(),
  saveTemplateDocument: vi.fn(),
  selectedTemplateFor: vi.fn(),
}));
vi.mock('@/lib/reports/investment/investmentPdfDocument', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '@/lib/reports/investment/investmentPdfDocument',
  );
  return { ...actual, generateInvestmentPdfBlob: vi.fn() };
});
vi.mock('@/lib/reports/investment/investmentPdfSource', () => ({
  loadInvestmentReportForPdf: vi.fn(),
  projectRowForPdf: vi.fn(() => ({ report: { id: 'r-1' }, reportTier: 'compass' })),
}));
vi.mock('@/hooks/useSecureStorage', () => ({ secureStorageUpload: vi.fn() }));

import { invokeSecureFunction } from '@/lib/secureInvoke';
import {
  saveTemplateDocument,
  selectedTemplateFor,
  tryTemplateDocument,
} from '@/lib/reportTemplate/templateDocument';
import {
  generateInvestmentPdfBlob,
  BROWSER_PDF_RENDERER,
} from '@/lib/reports/investment/investmentPdfDocument';
// Three renderers, three identities: telemetry has to answer WHICH one
// produced these exact bytes, and one name for all answers ends that.
import {
  BROWSER_PRESENTATION_RENDERER,
  WEASYPRINT_FINAL_RENDERER,
} from '@/lib/reportTemplate/routeReportThroughTemplate';
import { loadInvestmentReportForPdf } from '@/lib/reports/investment/investmentPdfSource';
import { secureStorageUpload } from '@/hooks/useSecureStorage';
import {
  deliverInvestmentPdf,
  forgetFinalisedInvestmentDocuments,
  produceInvestmentDocument,
  publishInvestmentPdf,
} from '@/lib/reports/investment/deliverInvestmentPdf';

const invoke = vi.mocked(invokeSecureFunction);
const tryTemplate = vi.mocked(tryTemplateDocument);
const selectTemplate = vi.mocked(selectedTemplateFor);
const draw = vi.mocked(generateInvestmentPdfBlob);
const loadRow = vi.mocked(loadInvestmentReportForPdf);
const upload = vi.mocked(secureStorageUpload);
const save = vi.mocked(saveTemplateDocument);

const pdfBlob = (content = '%PDF-1.7 test') => new Blob([content], { type: 'application/pdf' });

/** A template document the print engine drew and stored. */
const finalDoc = (over: Partial<{ blob: Blob; fileName: string; storagePath: string | null }> = {}) => ({
  blob: pdfBlob(),
  fileName: 'doc.pdf',
  templateId: 't-1',
  renderer: WEASYPRINT_FINAL_RENDERER,
  storagePath: 'template-builder/2026-09-14/0f1e-doc.pdf',
  degradedFrom: null,
  ...over,
});

/** The chosen template drawn in this tab because the print engine did not answer. */
const standInDoc = () => ({
  ...finalDoc({ storagePath: null }),
  renderer: BROWSER_PRESENTATION_RENDERER,
  degradedFrom: {
    renderer: WEASYPRINT_FINAL_RENDERER,
    refusal: 'engine_unavailable' as const,
    detail: 'The print engine did not answer (HTTP 500 from the render service).',
  },
});

const standardDrawing = () => ({
  blob: pdfBlob(), fileName: 'r-1_Cowra_NSW_1.pdf',
  suburb: 'Cowra', state: 'NSW', renderer: BROWSER_PDF_RENDERER,
});

beforeEach(() => {
  vi.resetAllMocks();
  // Every remembered finalisation belongs to the test that made it.
  forgetFinalisedInvestmentDocuments();
  selectTemplate.mockResolvedValue(null);
  /*
   * The record is read ONCE, before a presentation is chosen, because the
   * client-readiness gate and the two content rules both apply above that
   * choice. Every test here therefore needs a row — a template-path test that
   * supplied none used to pass by never reading one.
   */
  loadRow.mockResolvedValue({
    id: 'r-1',
    report_content: '# 1. Summary\n\nThe property was purchased for $700,000.\n',
    validation_flags: [],
  } as never);
});

describe('produceInvestmentDocument', () => {
  it('the chosen/ranked template wins, drawn by the print engine, and nothing else is drawn', async () => {
    tryTemplate.mockResolvedValue(finalDoc());

    const doc = await produceInvestmentDocument('r-1', { variant: 'briefing' });

    expect(doc.engine).toBe(WEASYPRINT_FINAL_RENDERER);
    expect(doc.templateId).toBe('t-1');
    expect(doc.storagePath).toBe('template-builder/2026-09-14/0f1e-doc.pdf');
    // The route is handed the report's presented content — the record's own
    // Markdown with the operator's content rules already applied — so the
    // template draws the same sections the standard presentation would. It
    // is asked for the FINAL renderer, and handed the template choice this
    // module already read, so the memo below and the route agree on it.
    expect(tryTemplate).toHaveBeenCalledWith('investment', 'r-1', {
      variant: 'briefing',
      payload: { reportContent: expect.stringContaining('$700,000'), includeScoring: true, includeSources: true },
      renderer: 'weasyprint',
      selectedTemplateId: null,
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(draw).not.toHaveBeenCalled();
  });

  it('hands the route the template the person chose, read once', async () => {
    selectTemplate.mockResolvedValue('tpl-chosen');
    tryTemplate.mockResolvedValue(finalDoc());

    await produceInvestmentDocument('r-1');

    expect(selectTemplate).toHaveBeenCalledTimes(1);
    expect(selectTemplate).toHaveBeenCalledWith('investment');
    expect(tryTemplate.mock.calls[0][2]).toMatchObject({ selectedTemplateId: 'tpl-chosen' });
  });

  it('names the browser renderer when a template was drawn in this tab', async () => {
    // The route answers with the renderer that actually drew the bytes; this
    // module repeats it rather than assuming the print engine.
    tryTemplate.mockResolvedValue(finalDoc({ storagePath: null }) as never);
    tryTemplate.mockResolvedValueOnce({
      ...finalDoc({ storagePath: null }), renderer: BROWSER_PRESENTATION_RENDERER,
    });

    const doc = await produceInvestmentDocument('r-1');

    expect(doc.engine).toBe(BROWSER_PRESENTATION_RENDERER);
    expect(doc.storagePath).toBeNull();
  });

  it('delivers a stand-in for the print engine but never remembers it as the finalisation', async () => {
    // 15 Sep 2026: the engine answered Cloud Run's 500 page for five hours.
    // The chosen template drawn in this tab is delivered — it is the document
    // the person needs — and the NEXT request asks the engine again rather
    // than handing back the stand-in for the rest of the session.
    tryTemplate.mockResolvedValue(standInDoc());

    const first = await produceInvestmentDocument('r-1');
    const second = await produceInvestmentDocument('r-1');

    expect(first.engine).toBe(BROWSER_PRESENTATION_RENDERER);
    expect(first.storagePath).toBeNull();
    expect(second.engine).toBe(BROWSER_PRESENTATION_RENDERER);
    expect(tryTemplate).toHaveBeenCalledTimes(2);
    expect(draw).not.toHaveBeenCalled();
  });

  it('remembers a template document the browser drew on purpose (a preview request), as before', async () => {
    tryTemplate.mockResolvedValue({ ...finalDoc({ storagePath: null }), renderer: BROWSER_PRESENTATION_RENDERER });

    await produceInvestmentDocument('r-1');
    await produceInvestmentDocument('r-1');

    expect(tryTemplate).toHaveBeenCalledTimes(1);
  });

  it('draws the standard document in the browser when no template applies', async () => {
    tryTemplate.mockResolvedValue(null);
    draw.mockResolvedValue(standardDrawing());

    const doc = await produceInvestmentDocument('r-1');

    expect(doc.engine).toBe(BROWSER_PDF_RENDERER);
    expect(doc.templateId).toBeNull();
    expect(doc.storagePath).toBeNull();
    expect(doc.fileName).toBe('r-1_Cowra_NSW_1.pdf');
    // The row is read through the broker, and the drawing happens here — no
    // render route is invoked at all.
    expect(loadRow).toHaveBeenCalledWith('r-1');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('a report that cannot be read is an error, not an empty document', async () => {
    tryTemplate.mockResolvedValue(null);
    loadRow.mockRejectedValue(new Error('The report could not be read.'));

    await expect(produceInvestmentDocument('r-1')).rejects.toThrow(/could not be read/i);
    expect(draw).not.toHaveBeenCalled();
  });

  it('an empty drawing is a failure, not a document', async () => {
    tryTemplate.mockResolvedValue(null);
    loadRow.mockResolvedValue({ id: 'r-1' } as any);
    draw.mockResolvedValue({
      blob: new Blob([], { type: 'application/pdf' }), fileName: 'x.pdf',
      suburb: '', state: '', renderer: BROWSER_PDF_RENDERER,
    });

    await expect(produceInvestmentDocument('r-1')).rejects.toThrow(/empty/i);
  });

  it('refuses to run without a report id', async () => {
    await expect(produceInvestmentDocument('')).rejects.toThrow(/report is required/i);
    expect(tryTemplate).not.toHaveBeenCalled();
  });
});

/**
 * ONE FINALISATION → ONE PDF.
 *
 * A final render costs money and time, and it is asked for by a deliberate
 * act — never by an edit, a preview or a page load. Two protections keep one
 * act to one render, and both are pinned here rather than trusted.
 */
describe('one finalisation is one render', () => {
  it('a second ask for the same document reuses it rather than drawing again', async () => {
    tryTemplate.mockResolvedValue(finalDoc());

    const first = await produceInvestmentDocument('r-1');
    const second = await produceInvestmentDocument('r-1');

    expect(second).toBe(first);
    expect(tryTemplate).toHaveBeenCalledTimes(1);
  });

  it('the standard document is remembered the same way', async () => {
    tryTemplate.mockResolvedValue(null);
    draw.mockResolvedValue(standardDrawing());

    await produceInvestmentDocument('r-1');
    await produceInvestmentDocument('r-1');

    expect(draw).toHaveBeenCalledTimes(1);
  });

  it('an edit to the report moves the key, so the next ask draws the edited record', async () => {
    tryTemplate.mockResolvedValue(finalDoc());
    await produceInvestmentDocument('r-1');

    loadRow.mockResolvedValue({
      id: 'r-1',
      report_content: '# 1. Summary\n\nThe property was purchased for $710,000.\n',
      validation_flags: [],
    } as never);
    await produceInvestmentDocument('r-1');

    expect(tryTemplate).toHaveBeenCalledTimes(2);
  });

  it('a different template choice moves the key', async () => {
    tryTemplate.mockResolvedValue(finalDoc());
    await produceInvestmentDocument('r-1');

    selectTemplate.mockResolvedValue('tpl-other');
    await produceInvestmentDocument('r-1');

    expect(tryTemplate).toHaveBeenCalledTimes(2);
    expect(tryTemplate.mock.calls[1][2]).toMatchObject({ selectedTemplateId: 'tpl-other' });
  });

  it('a different control moves the key', async () => {
    tryTemplate.mockResolvedValue(finalDoc());
    await produceInvestmentDocument('r-1', { includeSources: true });
    await produceInvestmentDocument('r-1', { includeSources: false });

    expect(tryTemplate).toHaveBeenCalledTimes(2);
  });

  it('publishing does not move the key — `pdf_url` is the one column a publish writes', async () => {
    tryTemplate.mockResolvedValue(finalDoc());
    await produceInvestmentDocument('r-1');

    loadRow.mockResolvedValue({
      id: 'r-1',
      report_content: '# 1. Summary\n\nThe property was purchased for $700,000.\n',
      validation_flags: [],
      pdf_url: 'template-builder/2026-09-14/0f1e-doc.pdf',
    } as never);
    await produceInvestmentDocument('r-1');

    expect(tryTemplate).toHaveBeenCalledTimes(1);
  });

  it('two asks in flight at once share one production', async () => {
    // A double-click, a re-rendered button, two surfaces asking together.
    let release!: (doc: ReturnType<typeof finalDoc>) => void;
    tryTemplate.mockReturnValue(new Promise((resolve) => { release = resolve; }));

    const a = produceInvestmentDocument('r-1');
    const b = produceInvestmentDocument('r-1');
    release(finalDoc());
    const [docA, docB] = await Promise.all([a, b]);

    expect(docA).toBe(docB);
    expect(tryTemplate).toHaveBeenCalledTimes(1);
  });

  it('a failed production is not remembered — the next ask tries again', async () => {
    tryTemplate.mockResolvedValue(null);
    draw.mockRejectedValueOnce(new Error('engine hiccup'));
    draw.mockResolvedValue(standardDrawing());

    await expect(produceInvestmentDocument('r-1')).rejects.toThrow('engine hiccup');
    const doc = await produceInvestmentDocument('r-1');

    expect(doc.engine).toBe(BROWSER_PDF_RENDERER);
    expect(draw).toHaveBeenCalledTimes(2);
  });
});

describe('deliverInvestmentPdf', () => {
  it('produces and saves the same bytes', async () => {
    const blob = pdfBlob();
    tryTemplate.mockResolvedValue(finalDoc({ blob }));

    await deliverInvestmentPdf('r-1');

    expect(save).toHaveBeenCalledWith(expect.objectContaining({ blob, fileName: 'doc.pdf' }));
  });
});

describe('publishInvestmentPdf', () => {
  it('points the record at the document the engine already stored — no second upload', async () => {
    tryTemplate.mockResolvedValue(finalDoc({ fileName: 'My Doc (v2).pdf' }));
    invoke.mockResolvedValue({ data: { success: true }, error: null } as any);

    const published = await publishInvestmentPdf('r-1');

    expect(published).toMatchObject({
      path: 'template-builder/2026-09-14/0f1e-doc.pdf',
      engine: WEASYPRINT_FINAL_RENDERER,
      templateId: 't-1',
    });
    // The bytes are already in the bucket, under the path the function
    // answered. Uploading them again would make a second copy of the same
    // document, and the second copy is the one that can differ.
    expect(upload).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith('manage-investment-reports', expect.objectContaining({
      action: 'update',
      reportId: 'r-1',
      data: { pdf_url: 'template-builder/2026-09-14/0f1e-doc.pdf' },
    }));
  });

  it('Send after Download reuses the finalised document: one render, one stored path', async () => {
    tryTemplate.mockResolvedValue(finalDoc());
    invoke.mockResolvedValue({ data: { success: true }, error: null } as any);

    await deliverInvestmentPdf('r-1');
    const published = await publishInvestmentPdf('r-1');

    expect(tryTemplate).toHaveBeenCalledTimes(1);
    expect(upload).not.toHaveBeenCalled();
    expect(published.path).toBe('template-builder/2026-09-14/0f1e-doc.pdf');
  });

  it('uploads a template document the browser drew — there is no stored copy to reuse', async () => {
    tryTemplate.mockResolvedValue({
      ...finalDoc({ fileName: 'My Doc (v2).pdf', storagePath: null }),
      renderer: BROWSER_PRESENTATION_RENDERER,
    });
    upload.mockResolvedValue({ success: true, path: 'stored/My-Doc-v2.pdf' } as any);
    invoke.mockResolvedValue({ data: { success: true }, error: null } as any);

    const published = await publishInvestmentPdf('r-1');

    expect(published).toMatchObject({ path: 'stored/My-Doc-v2.pdf', engine: BROWSER_PRESENTATION_RENDERER, templateId: 't-1' });
    expect(upload).toHaveBeenCalledWith(
      'investment-reports',
      expect.stringContaining('r-1_'),
      expect.any(Blob),
      expect.objectContaining({ contentType: 'application/pdf', upsert: true, resourceId: 'r-1' }),
    );
    expect(invoke).toHaveBeenCalledWith('manage-investment-reports', expect.objectContaining({
      action: 'update',
      reportId: 'r-1',
      data: { pdf_url: 'stored/My-Doc-v2.pdf' },
    }));
  });

  it('uploads a standard document too — there is no persisted path to reuse', async () => {
    // The shortcut this replaces read `pdf_url` back, because the server route
    // had already written it. Nothing writes a render behind our back now, so
    // reading it back could only return whichever render happened to run last.
    tryTemplate.mockResolvedValue(null);
    loadRow.mockResolvedValue({ id: 'r-1' } as any);
    draw.mockResolvedValue(standardDrawing());
    upload.mockResolvedValue({ success: true, path: 'r-1_123_r-1_Cowra_NSW_1.pdf' } as any);
    invoke.mockResolvedValue({ data: { success: true }, error: null } as any);

    const published = await publishInvestmentPdf('r-1');

    expect(published).toMatchObject({
      path: 'r-1_123_r-1_Cowra_NSW_1.pdf', engine: BROWSER_PDF_RENDERER,
    });
    expect(upload).toHaveBeenCalled();
    // One write, through the one broker every client write uses.
    expect(invoke).toHaveBeenCalledWith('manage-investment-reports', expect.objectContaining({
      action: 'update',
      reportId: 'r-1',
      data: { pdf_url: 'r-1_123_r-1_Cowra_NSW_1.pdf' },
    }));
  });

  it('a failed upload is an error the caller hears about', async () => {
    tryTemplate.mockResolvedValue(null);
    draw.mockResolvedValue(standardDrawing());
    upload.mockResolvedValue({ success: false, error: 'bucket said no' } as any);

    await expect(publishInvestmentPdf('r-1')).rejects.toThrow('bucket said no');
  });

  it('bookkeeping failure never fails a published document', async () => {
    tryTemplate.mockResolvedValue(finalDoc({ storagePath: 'p.pdf' }));
    invoke.mockRejectedValue(new Error('broker down'));

    const published = await publishInvestmentPdf('r-1');
    expect(published.path).toBe('p.pdf');
  });
});

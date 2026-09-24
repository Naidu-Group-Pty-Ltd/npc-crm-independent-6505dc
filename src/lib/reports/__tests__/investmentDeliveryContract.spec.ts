import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * ONE delivery contract for the Investment report.
 *
 * Every user-facing PDF action asks `produceInvestmentDocument`, and it does
 * four things in one order that cannot be rearranged: read the record, refuse
 * a report that is not client-ready, apply the operator's five controls, then
 * choose a presentation. The order is the contract — a control applied after
 * the presentation is chosen reaches one presentation and not the other, which
 * is precisely how the panel came to have two buttons honouring different
 * halves of the same five switches.
 */

const h = vi.hoisted(() => ({
  row: {} as Record<string, unknown>,
  templateResult: null as {
    blob: Blob; fileName: string; templateId: string; renderer: string; storagePath: string | null;
  } | null,
  templateCalls: [] as Array<[string, string, Record<string, unknown> | undefined]>,
  standardCalls: [] as Array<Record<string, unknown>>,
  heroCalls: [] as string[],
  heroResult: [] as Array<{ sectionKey: string; bytes: Uint8Array; format: 'png' | 'jpeg' }>,
}));

vi.mock('@/lib/reports/investment/investmentPdfSource', () => ({
  loadInvestmentReportForPdf: async () => h.row,
  projectRowForPdf: (row: Record<string, unknown>) => ({
    report: { id: 'r1', address: '12 Example St', content: String(row.report_content ?? '') },
    reportTier: 'compass',
  }),
}));

vi.mock('@/lib/reportTemplate/templateDocument', () => ({
  saveTemplateDocument: () => {},
  selectedTemplateFor: async () => null,
  tryTemplateDocument: async (
    reportType: string, reportId: string, opts?: Record<string, unknown>,
  ) => {
    h.templateCalls.push([reportType, reportId, opts]);
    return h.templateResult;
  },
}));

vi.mock('@/lib/reports/investment/investmentPdfDocument', () => ({
  BROWSER_PDF_RENDERER: 'browser_pdf_lib',
  generateInvestmentPdfBlob: async (args: Record<string, unknown>) => {
    h.standardCalls.push(args);
    return {
      blob: new Blob(['%PDF-1.7 standard'], { type: 'application/pdf' }),
      fileName: 'standard.pdf',
      suburb: 'Cowra',
      state: 'NSW',
      renderer: 'browser_pdf_lib',
    };
  },
}));

vi.mock('@/lib/reports/investment/investmentHeroImages', () => ({
  loadInvestmentHeroImages: async (reportId: string) => {
    h.heroCalls.push(reportId);
    return h.heroResult;
  },
}));

vi.mock('@/lib/secureInvoke', () => ({ invokeSecureFunction: async () => ({ data: null, error: null }) }));
vi.mock('@/hooks/useSecureStorage', () => ({ secureStorageUpload: async () => ({ success: true, path: 'p' }) }));

import {
  forgetFinalisedInvestmentDocuments,
  produceInvestmentDocument,
} from '../investment/deliverInvestmentPdf';
import { ReportNotClientReadyError } from '../investment/clientReadiness';

const CONTENT = [
  '# 1. Summary',
  'Purchased for $700,000 at $650 per week.',
  '{{bars: Transport 80}}',
  '{{margin: Trend | spark=1,2,3}}',
  '## 33. Data Sources',
  'ABS Census 2021.',
  '## 34. Investment Scoring',
  'Scored 72.',
].join('\n\n');

beforeEach(() => {
  // A finalisation is remembered per report; every test here starts unremembered.
  forgetFinalisedInvestmentDocuments();
  h.row = { id: 'r1', report_content: CONTENT, validation_flags: [] };
  h.templateResult = null;
  h.templateCalls = [];
  h.standardCalls = [];
  h.heroCalls = [];
  h.heroResult = [];
});

const contentSentToTemplate = () =>
  String((h.templateCalls[0]?.[2]?.payload as { reportContent?: string } | undefined)?.reportContent ?? '');

const contentSentToStandard = () =>
  String((h.standardCalls[0]?.report as { content?: string } | undefined)?.content ?? '');

describe('the readiness gate is above the presentation', () => {
  /**
   * A client-readiness defect is a REPORT defect, not a presentation defect,
   * so no presentation choice can get past it — and it is refused rather than
   * fallen back from, because there is no layout in which the claim becomes
   * true.
   */
  it('refuses a blocked report before a presentation is chosen', async () => {
    h.row = {
      id: 'r1',
      report_content: CONTENT,
      validation_flags: [{
        type: 'governed_authority',
        value: { blocking: true, category: 'demographics' },
      }],
    };
    h.templateResult = {
      blob: new Blob(['x']), fileName: 't.pdf', templateId: 'tpl-1',
      renderer: 'weasyprint_final', storagePath: 'template-builder/2026-09-14/x.pdf',
    };

    await expect(produceInvestmentDocument('r1')).rejects.toBeInstanceOf(ReportNotClientReadyError);
    // Neither presentation was even asked.
    expect(h.templateCalls).toEqual([]);
    expect(h.standardCalls).toEqual([]);
  });

  it('produces the document when nothing is blocking', async () => {
    const doc = await produceInvestmentDocument('r1');
    expect(doc.blob.size).toBeGreaterThan(0);
    expect(doc.engine).toBe('browser_pdf_lib');
  });
});

describe('the content rules reach BOTH presentations', () => {
  it('sends the same filtered content to the template route and the standard renderer', async () => {
    await produceInvestmentDocument('r1', { includeSources: false, includeScoring: false });
    const templated = contentSentToTemplate();
    const standard = contentSentToStandard();

    expect(templated).not.toContain('Data Sources');
    expect(templated).not.toContain('Investment Scoring');
    expect(standard).not.toContain('Data Sources');
    expect(standard).not.toContain('Investment Scoring');
    // The SAME string, not two filterings that happen to agree.
    expect(templated).toBe(standard);
  });

  it('leaves every figure in the sections it keeps', async () => {
    await produceInvestmentDocument('r1', { includeSources: false, includeScoring: false });
    expect(contentSentToStandard()).toContain('$700,000');
    expect(contentSentToStandard()).toContain('$650');
  });

  it("sends the SAME audience's body to both presentations", async () => {
    h.row = {
      ...h.row,
      location_intelligence: {
        schools: { topSchools: [{ name: 'Cowra Public School', distance: 0.6 }] },
        lifestyle: { nearestShopping: 'Woolworths Cowra', nearestPark: 'Apex Park' },
      },
    };
    await produceInvestmentDocument('r1', { audience: 'both' });
    expect(contentSentToTemplate()).toContain("Living Here: An Owner-Occupier's View");
    expect(contentSentToTemplate()).toContain('Cowra Public School, 600 m');
    expect(contentSentToTemplate()).toBe(contentSentToStandard());
  });

  it('sends the record’s own content when nothing is switched off', async () => {
    await produceInvestmentDocument('r1');
    expect(contentSentToStandard()).toBe(CONTENT);
    expect(contentSentToTemplate()).toBe(CONTENT);
  });
});

describe('the presentation rules', () => {
  it('removes chart directives from both presentations when charts are off', async () => {
    await produceInvestmentDocument('r1', { includeCharts: false });
    expect(contentSentToTemplate()).not.toContain('{{bars:');
    expect(contentSentToStandard()).not.toContain('{{bars:');
    // A sparkline is a different control.
    expect(contentSentToStandard()).toContain('spark=1,2,3');
  });

  it('removes narrative sparklines when sparklines are off', async () => {
    await produceInvestmentDocument('r1', { includeSparklines: false });
    expect(contentSentToStandard()).not.toContain('spark=1,2,3');
    expect(contentSentToStandard()).toContain('{{bars:');
  });

  it('passes every control to the standard renderer, resolved', async () => {
    await produceInvestmentDocument('r1', { includeCharts: false, includeSparklines: false });
    expect(h.standardCalls[0]?.presentation).toEqual({
      includeSources: true,
      includeScoring: true,
      includeCharts: false,
      includeHeroImages: false,
      includeSparklines: false,
      // Unset is the investor's document, which is every document before
      // the audience existed.
      audience: 'investor',
    });
  });

  /** Nothing is fetched for imagery nobody asked for. */
  it('reads hero imagery only when the control is on', async () => {
    await produceInvestmentDocument('r1', { includeHeroImages: false });
    expect(h.heroCalls).toEqual([]);
    expect(h.standardCalls[0]?.heroImages).toEqual([]);

    h.standardCalls = [];
    h.heroResult = [{ sectionKey: 'Location', bytes: new Uint8Array([1]), format: 'png' }];
    await produceInvestmentDocument('r1', { includeHeroImages: true });
    expect(h.heroCalls).toEqual(['r1']);
    expect(h.standardCalls[0]?.heroImages).toHaveLength(1);
  });
});

describe('the presentation that is chosen', () => {
  it('is the selected template when the route produces one', async () => {
    h.templateResult = {
      blob: new Blob(['%PDF-1.7 templated'], { type: 'application/pdf' }),
      fileName: 'templated.pdf',
      templateId: 'tpl-1',
      renderer: 'weasyprint_final',
      storagePath: 'template-builder/2026-09-14/templated.pdf',
    };
    const doc = await produceInvestmentDocument('r1');
    // Drawn by the print engine, from the same final payload, and already
    // stored where the portal reads.
    expect(doc.engine).toBe('weasyprint_final');
    expect(doc.templateId).toBe('tpl-1');
    expect(doc.storagePath).toBe('template-builder/2026-09-14/templated.pdf');
    expect(h.standardCalls).toEqual([]);
    // The route was asked for the FINAL renderer — never the browser preview.
    expect(h.templateCalls[0][2]).toMatchObject({ renderer: 'weasyprint' });
  });

  /**
   * A template the renderer cannot draw whole, an adapter that declined, no
   * active template: every one of them falls back to the standard
   * presentation drawn from the SAME final payload. The report is not
   * regenerated and no edit is lost — only the layout differs.
   */
  it('is the standard one when the route produces none, from the same payload', async () => {
    h.templateResult = null;
    const doc = await produceInvestmentDocument('r1', { includeSources: false });
    expect(doc.engine).toBe('browser_pdf_lib');
    expect(doc.templateId).toBeNull();
    expect(contentSentToStandard()).toBe(contentSentToTemplate());
  });
});

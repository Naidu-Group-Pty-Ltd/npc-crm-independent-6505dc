/**
 * Every migrated format asks for an activated template before rendering its
 * own way — and each one's exception holds.
 *
 * For a year the adapters could turn nine formats' stored records into
 * templated PDFs and exactly one surface could ask for one: `PremiumPdfButton`,
 * for Compass investment reports. The other formats' fifty masters each could
 * be designed, seeded, previewed and activated without a single button in the
 * product ever rendering one. These are the calls that close that, asserted at
 * the `deliver*` layer because that is where every surface for a format meets:
 * the download, the email attachment, the blob a broker portal uploads.
 *
 * The exceptions matter as much as the wiring, because each one is a document
 * somebody explicitly asked for and must still get:
 *
 *  - Borrowing Capacity's `variant: 'legacy'` is a person choosing the layout
 *    they know, and a request with no `assessmentId` names no stored record.
 *  - Portfolio's `stored` variant is a request for one particular file, and
 *    `includeReview: false` asks for a document the adapter cannot make.
 *  - Market Intelligence's `persist` used to gate the template, to protect
 *    `pdf_storage_path` for the scheduled email — and the button defaults it
 *    on, so the choice was inert on the control that matters. The template
 *    is drawn for every call now and the untouched stored copy is SAID
 *    (RS-5c.4); the column stays the flowing route's alone.
 *  - Commercial Capacity's `refreshAnalysis` is a request to re-run the model.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  calls: [] as Array<{ reportType: string; reportId: string; variant?: string | null }>,
  document: null as {
    blob: Blob; fileName: string; templateId: string; renderer?: string; storagePath?: string | null;
  } | null,
  flowing: [] as string[],
}));

vi.mock('@/lib/reportTemplate/templateDocument', () => ({
  tryTemplateDocument: async (
    reportType: string, reportId: string | null | undefined,
    opts?: { variant?: string | null },
  ) => {
    if (!reportId) return null;
    h.calls.push({ reportType, reportId, variant: opts?.variant ?? null });
    return h.document;
  },
  saveTemplateDocument: () => {},
}));

// Each format's own route, stubbed so "did it fall through?" is observable.
vi.mock('@/lib/reports/clientDetails/requestClientDetailsPdf', () => ({
  requestClientDetailsPdf: async () => {
    h.flowing.push('client_details');
    return {
      url: 'https://cdn/flowing.pdf', fileName: 'flowing.pdf', pageCount: 3,
      brandGaps: ['logo'], sections: ['Contacts'], propertyCount: 1,
    };
  },
}));
vi.mock('@/lib/reports/reportQa/requestReportQaPdf', () => ({
  requestReportQaPdf: async () => {
    h.flowing.push('qa');
    return {
      url: 'https://cdn/flowing.pdf', fileName: 'flowing.pdf', pageCount: 2, brandGaps: [],
      sections: [], subject: 'transcript', turnCount: 9, turnsShown: 9, truncated: false,
      generated: false, attachment: null,
    };
  },
}));
vi.mock('@/lib/reports/marketIntelligence/requestMarketIntelligencePdf', () => ({
  requestMarketIntelligencePdf: async () => {
    h.flowing.push('market_intelligence');
    return {
      url: 'https://cdn/flowing.pdf', fileName: 'flowing.pdf', pageCount: 20, brandGaps: [],
      sections: [], dropped: [], emptyLayers: [], reportPeriod: 'March 2026',
      audienceSegment: 'investor', persisted: true, storagePath: 'marketing-reports/x.pdf',
    };
  },
}));
vi.mock('@/lib/reports/propertyComparison/requestComparisonPdf', () => ({
  requestComparisonPdf: async () => {
    h.flowing.push('comparison');
    return {
      url: 'https://cdn/flowing.pdf', fileName: 'flowing.pdf', brandGaps: [],
      recordComplete: false, missingSections: ['Market timing'],
    };
  },
}));
vi.mock('@/lib/reports/portfolio/requestPortfolioReview', () => ({
  requestPortfolioReview: async () => {
    h.flowing.push('portfolio');
    return {
      url: 'https://cdn/flowing.pdf', fileName: 'flowing.pdf', brandGaps: [],
      reviewIncluded: true, storagePath: 'portfolio-reports/c-1/typeset/2026-09-14/x-flowing.pdf',
    };
  },
}));
vi.mock('@/lib/reports/borrowingCapacity/requestSnapshot', () => ({
  requestBorrowingCapacitySnapshot: async () => {
    h.flowing.push('borrowing_capacity');
    return {
      url: 'https://cdn/flowing.pdf', fileName: 'flowing.pdf', bytes: 10, pageCount: 1,
      brandGaps: [], source: 'server', storagePath: 'borrowing-capacity/c-1/2026-09-14/x-flowing.pdf',
    };
  },
}));

import { deliverClientDetailsPdf } from '../clientDetails/deliverClientDetailsPdf';
import { deliverReportQaPdf } from '../reportQa/deliverReportQaPdf';
import { deliverMarketIntelligencePdf } from '../marketIntelligence/deliverMarketIntelligencePdf';
import { deliverComparisonPdf, comparisonPdfBlob } from '../propertyComparison/deliverComparisonPdf';
import { deliverPortfolioReview, portfolioReviewBlob } from '../portfolio/deliverPortfolioReview';
import { deliverSnapshot, snapshotBlob } from '../borrowingCapacity/deliverSnapshot';

const TEMPLATED = () => ({
  blob: new Blob(['%PDF templated'], { type: 'application/pdf' }),
  fileName: 'templated.pdf',
  templateId: 'tpl-1',
  renderer: 'weasyprint_final',
  // Where `render-template-pdf` stored the final document.
  storagePath: 'template-builder/2026-09-14/abc-templated.pdf',
});

/** The in-browser generator the Snapshot paths take as an argument. */
const legacy = async () => ({ blob: new Blob(['legacy']), fileName: 'legacy.pdf' });

beforeEach(() => {
  h.calls = [];
  h.flowing = [];
  h.document = TEMPLATED();
  vi.stubGlobal('fetch', async () => ({
    ok: true,
    blob: async () => new Blob(['%PDF flowing'], { type: 'application/pdf' }),
  }) as unknown as Response);
  // jsdom has no object-URL implementation.
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: () => 'blob:x',
    revokeObjectURL: () => {},
  }));
});

describe('each format asks for an activated template first', () => {
  it('client details', async () => {
    const out = await deliverClientDetailsPdf('client-1', { save: false });
    expect(h.calls).toEqual([{ reportType: 'client_details', reportId: 'client-1', variant: null }]);
    expect(out.templated).toBe(true);
    expect(out.fileName).toBe('templated.pdf');
    // The diagnostics describe the flowing render; they are not claimed here.
    expect(out.sections).toEqual([]);
    expect(h.flowing).toEqual([]);
  });

  it('report q&a, carrying the subject as the variant', async () => {
    const out = await deliverReportQaPdf('conv-1', 'answer', { save: false });
    // The subject is the variant: without it every templated export would be a
    // transcript, whichever of the three documents was asked for.
    expect(h.calls).toEqual([{ reportType: 'qa', reportId: 'conv-1', variant: 'answer' }]);
    expect(out.templated).toBe(true);
    expect(out.subject).toBe('answer');
    expect(h.flowing).toEqual([]);
  });

  it('market intelligence, carrying the audience as the variant', async () => {
    const out = await deliverMarketIntelligencePdf('mi-1', {
      save: false, persist: false, audience: 'investor',
    });
    expect(h.calls).toEqual([
      { reportType: 'market_intelligence', reportId: 'mi-1', variant: 'investor' },
    ]);
    expect(out.templated).toBe(true);
    expect(out.persisted).toBe(false);
    expect(h.flowing).toEqual([]);
  });

  it('comparison, on the download and the blob alike', async () => {
    await deliverComparisonPdf({ comparisonId: 'cmp-1' });
    await comparisonPdfBlob({ comparisonId: 'cmp-1' });
    expect(h.calls.map((c) => c.reportType)).toEqual(['comparison', 'comparison']);
    expect(h.flowing).toEqual([]);
  });

  it('portfolio, on the download and the blob alike', async () => {
    const out = await deliverPortfolioReview({ variant: 'server', request: { reportId: 'pf-1' } });
    await portfolioReviewBlob({ variant: 'server', request: { reportId: 'pf-1' } });
    expect(h.calls.map((c) => c.reportType)).toEqual(['portfolio', 'portfolio']);
    expect(out.templated).toBe(true);
    // The adapter performs the review join, so the document has one in it.
    expect(out.reviewIncluded).toBe(true);
    expect(h.flowing).toEqual([]);
  });

  it('borrowing capacity, on the download and the blob alike', async () => {
    const request = { clientId: 'c-1', clientName: 'Ada', assessmentId: 'bc-1' };
    const out = await deliverSnapshot({ variant: 'server', request, legacy });
    await snapshotBlob({ variant: 'server', request, legacy });
    expect(h.calls.map((c) => c.reportId)).toEqual(['bc-1', 'bc-1']);
    expect(out.templated).toBe(true);
    // Still the typeset source: that field answers "typeset or in-browser?".
    expect(out.source).toBe('server');
    expect(h.flowing).toEqual([]);
  });

  it('the blob paths say where the final renderer stored the bytes (RS-5c.3)', async () => {
    // The portal publish points at this object rather than uploading a copy.
    const pf = await portfolioReviewBlob({ variant: 'server', request: { reportId: 'pf-1' } });
    const bc = await snapshotBlob({
      variant: 'server', request: { clientId: 'c-1', clientName: 'Ada', assessmentId: 'bc-1' }, legacy,
    });
    expect(pf.storagePath).toBe('template-builder/2026-09-14/abc-templated.pdf');
    expect(bc.storagePath).toBe('template-builder/2026-09-14/abc-templated.pdf');
  });
});

describe('and falls through to its own route when there is no template', () => {
  beforeEach(() => { h.document = null; });

  it('every format', async () => {
    await deliverClientDetailsPdf('client-1', { save: false });
    await deliverReportQaPdf('conv-1', 'transcript', { save: false });
    await deliverMarketIntelligencePdf('mi-1', { save: false, persist: false });
    await deliverComparisonPdf({ comparisonId: 'cmp-1' });
    await deliverPortfolioReview({ variant: 'server', request: { reportId: 'pf-1' } });
    await deliverSnapshot({
      variant: 'server', request: { clientId: 'c', clientName: 'A', assessmentId: 'bc-1' }, legacy,
    });
    expect(h.flowing).toEqual([
      'client_details', 'qa', 'market_intelligence', 'comparison', 'portfolio',
      'borrowing_capacity',
    ]);
  });

  it('and the flowing render keeps its own diagnostics', async () => {
    const out = await deliverComparisonPdf({ comparisonId: 'cmp-1' });
    expect(out.templated).toBeUndefined();
    expect(out.recordComplete).toBe(false);
    expect(out.missingSections).toEqual(['Market timing']);
  });

  it('and the blob paths carry where the route stored the bytes (RS-5c.3)', async () => {
    const pf = await portfolioReviewBlob({ variant: 'server', request: { reportId: 'pf-1' } });
    const bc = await snapshotBlob({
      variant: 'server', request: { clientId: 'c-1', clientName: 'Ada', assessmentId: 'bc-1' }, legacy,
    });
    expect(pf.storagePath).toBe('portfolio-reports/c-1/typeset/2026-09-14/x-flowing.pdf');
    expect(bc.storagePath).toBe('borrowing-capacity/c-1/2026-09-14/x-flowing.pdf');
  });
});

describe('the exceptions, each a document somebody asked for by name', () => {
  it('never overrides the chosen legacy Snapshot layout', async () => {
    const out = await deliverSnapshot({
      variant: 'legacy',
      request: { clientId: 'c-1', clientName: 'Ada', assessmentId: 'bc-1' },
      legacy,
    });
    expect(h.calls).toEqual([]);
    expect(out.source).toBe('legacy');
  });

  it('does not route a Snapshot request that names no assessment', async () => {
    // `assessmentId` is optional — omit it for the most recent — and resolving
    // "most recent" is the render route's job, not an adapter's.
    await deliverSnapshot({
      variant: 'server', request: { clientId: 'c-1', clientName: 'Ada' }, legacy,
    });
    expect(h.calls).toEqual([]);
    expect(h.flowing).toEqual(['borrowing_capacity']);
  });

  it('does not substitute a template for a stored portfolio PDF', async () => {
    // `stored` is a request for one particular file that already exists.
    await expect(deliverPortfolioReview({
      variant: 'stored', request: { reportId: 'pf-1' }, storedPath: null,
    })).rejects.toThrow();
    expect(h.calls).toEqual([]);
  });

  it('does not route a portfolio review the caller asked to leave out', async () => {
    // The adapter always joins the newest completed review, so it cannot
    // produce the analysis-alone document.
    await deliverPortfolioReview({
      variant: 'server', request: { reportId: 'pf-1', includeReview: false },
    });
    expect(h.calls).toEqual([]);
    expect(h.flowing).toEqual(['portfolio']);
  });

  it('routes the persisting market intelligence call too, and says the stored copy was not fed', async () => {
    // The button defaults `persist` on, so gating the template on it left
    // the choice inert on the one control that matters (RS-5c.4). The
    // template is drawn; `pdf_storage_path` stays the flowing route's alone,
    // and both facts are answered so the button can say them.
    const out = await deliverMarketIntelligencePdf('mi-1', { save: false });
    expect(h.calls).toEqual([{ reportType: 'market_intelligence', reportId: 'mi-1', variant: null }]);
    expect(h.flowing).toEqual([]);
    expect(out.templated).toBe(true);
    expect(out.persisted).toBe(false);
    expect(out.persistRequested).toBe(true);
    expect(out.storagePath).toBeNull();
    expect(out.templatePath).toBe('template-builder/2026-09-14/abc-templated.pdf');
  });

  it('feeds the scheduled email through the flowing route when there is no template', async () => {
    h.document = null;
    const out = await deliverMarketIntelligencePdf('mi-1', { save: false });
    expect(h.flowing).toEqual(['market_intelligence']);
    expect(out.persisted).toBe(true);
    expect(out.storagePath).toBe('marketing-reports/x.pdf');
  });
});

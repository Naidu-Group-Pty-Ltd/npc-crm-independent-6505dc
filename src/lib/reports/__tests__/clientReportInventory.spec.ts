import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildClientReportInventory,
  matchesReportSearch,
  publishableReports,
  publishedFileIndex,
  publishVerdict,
  storedFileKey,
  PORTAL_REPORT_TYPE,
  type UnifiedReport,
} from '../clientReportInventory.pure';

const fmt = (iso: string) => iso.slice(0, 10);

const EMPTY = {
  reportFiles: [], investmentReports: [], portfolioReports: [],
  bcAssessments: [], portalReports: [],
};

const report = (over: Partial<UnifiedReport> = {}): UnifiedReport => ({
  id: 'r1', type: 'portfolio', name: 'Portfolio Analysis - 19 Aug 2026',
  generatedAt: '2026-08-19T09:00:00.000Z', status: 'completed',
  fileUrl: 'portfolio/abc.pdf', source: 'portfolio_report', ...over,
});

describe('the client report inventory', () => {
  it('merges all five sources', () => {
    const reports = buildClientReportInventory({
      reportFiles: [
        { id: 'f1', is_formara_form: true, file_name: 'Client Detail Form', uploaded_at: '2026-08-01T00:00:00Z', file_path: 'a.pdf' },
        { id: 'f2', report_type: 'property', file_name: 'Property Report', uploaded_at: '2026-08-02T00:00:00Z', file_path: 'b.pdf' },
      ],
      investmentReports: [{ id: 'i1', property_address: '1 Test St', status: 'completed', created_at: '2026-08-03T00:00:00Z', pdf_url: 'c.pdf' }],
      portfolioReports: [{ id: 'p1', created_at: '2026-08-04T00:00:00Z', pdf_file_path: 'd.pdf' }],
      bcAssessments: [{ id: 'b1', created_at: '2026-08-05T00:00:00Z', borrowing_capacity: 750000, serviceability_band: 'Strong' }],
      portalReports: [{ id: 'x1', report_title: 'Already sent', published_at: '2026-08-06T00:00:00Z', storage_path: 'e.pdf' }],
    }, fmt);

    expect(reports.map((r) => r.source)).toEqual([
      'file', 'file', 'investment_report', 'portfolio_report', 'borrowing_assessment', 'portal_report',
    ]);
  });

  it('a portfolio file with report_type portfolio is not listed twice', () => {
    // It is carried by `portfolio_analysis_reports`, and the file row for it
    // would otherwise appear beside it as a second entry.
    const reports = buildClientReportInventory({
      ...EMPTY,
      reportFiles: [{ id: 'f1', report_type: 'portfolio', file_name: 'x', uploaded_at: '2026-08-01T00:00:00Z' }],
    }, fmt);
    expect(reports).toEqual([]);
  });
});

describe('whether a report can go to the portal', () => {
  it('a stored file is ready, and publishing points at the same object', () => {
    const v = publishVerdict(report(), new Map());
    expect(v.readiness).toBe('ready');
    expect(v.storagePath).toBe('portfolio/abc.pdf');
  });

  it('a borrowing capacity assessment renders on publish and says so first', () => {
    const v = publishVerdict(report({ source: 'borrowing_assessment', type: 'borrowing', fileUrl: null }), new Map());
    expect(v.readiness).toBe('on_publish');
    expect(v.reason).toMatch(/when you publish/i);
  });

  it('a portfolio analysis with no file renders on publish (audit item 6)', () => {
    // Half the stored analyses have no PDF — every browser upload failed 403
    // until secure-storage learned the binding — and declaring them
    // unavailable was the "No PDF available to send" dead end. The typeset
    // review renders from `report_data` server-side, so publishing renders
    // one, the same shape the borrowing row above has always had.
    const v = publishVerdict(report({ fileUrl: null }), new Map());
    expect(v.readiness).toBe('on_publish');
    expect(v.reason).toMatch(/when you publish/i);
  });

  it('a portfolio row that is not completed still refuses', () => {
    expect(publishVerdict(report({ fileUrl: null, status: 'pending' }), new Map()).readiness)
      .toBe('unavailable');
    expect(publishVerdict(report({ fileUrl: null, status: 'failed' }), new Map()).readiness)
      .toBe('unavailable');
  });

  it('the publish act renders the portfolio review through the waiting contract', () => {
    // `portfolioReviewBlob` was left in `deliverPortfolioReview.ts` for
    // exactly this caller; the act must go through it rather than grow a
    // second renderer, and must never write `pdf_file_path` — that column is
    // the legacy generator's file, and substituting a document from a
    // renderer the person did not choose is that module's own never.
    const src = readFileSync(
      resolve(__dirname, '../publishReportToPortal.ts'),
      'utf8',
    );
    // The CALL, not the word — a comment naming the contract must not satisfy
    // a guard about using it.
    expect(src).toMatch(/portfolioReviewBlob\(/);
    expect(src).not.toContain('pdf_file_path');
  });

  it('a report still generating is not offered', () => {
    expect(publishVerdict(report({ source: 'investment_report', fileUrl: null, status: 'pending' }), new Map()).readiness)
      .toBe('unavailable');
  });

  it('a report that failed to generate is not offered', () => {
    expect(publishVerdict(report({ source: 'investment_report', fileUrl: null, status: 'failed' }), new Map()).readiness)
      .toBe('unavailable');
  });

  it('refuses a reference this deployment cannot sign', () => {
    // The failure mode this guards: a portal row that looks healthy in every
    // register here and 404s on the client's click.
    const v = publishVerdict(report({ fileUrl: 'https://example.com/somewhere/else.pdf' }), new Map());
    expect(v.readiness).toBe('unavailable');
    expect(v.reason).toMatch(/cannot serve/i);
  });

  it('accepts a Supabase URL, because the key inside it is addressable', () => {
    const v = publishVerdict(
      report({ fileUrl: 'https://x.supabase.co/storage/v1/object/public/investment-reports/gen/a.pdf' }),
      new Map(),
    );
    expect(v.readiness).toBe('ready');
    expect(v.bucket).toBe('investment-reports');
    expect(v.storagePath).toBe('gen/a.pdf');
  });

  it('a report already on the portal is said, never refused', () => {
    const published = publishedFileIndex([{ storage_path: 'portfolio/abc.pdf', published_at: '2026-08-20T00:00:00Z' }]);
    const v = publishVerdict(report(), published);
    expect(v.alreadyPublished).toBe(true);
    expect(v.publishedAt).toBe('2026-08-20T00:00:00Z');
    // Still publishable — re-issuing after a correction is legitimate and the
    // operator is the one who knows.
    expect(v.readiness).toBe('ready');
  });

  it('reports the FIRST time the client got it, not the latest', () => {
    // Publishing again is legitimate, so the same file can appear twice. What
    // "already shared" means to an operator is when the client first saw it.
    const index = publishedFileIndex([
      { storage_path: 'gen/a.pdf', published_at: '2026-08-20T00:00:00Z' },
      { storage_path: 'gen/a.pdf', published_at: '2026-08-02T00:00:00Z' },
      { storage_path: 'gen/a.pdf', published_at: '2026-08-25T00:00:00Z' },
    ]);
    expect(index.get(storedFileKey('gen/a.pdf')!)).toBe('2026-08-02T00:00:00Z');
  });

  it('a row with no date still records that the file was shared', () => {
    const index = publishedFileIndex([
      { storage_path: 'gen/a.pdf' },
      { storage_path: 'gen/a.pdf', published_at: '2026-08-20T00:00:00Z' },
    ]);
    const key = storedFileKey('gen/a.pdf')!;
    expect(index.has(key)).toBe(true);
    expect(index.get(key)).toBe('2026-08-20T00:00:00Z');
  });

  it('recognises the same file however the two writers spelled it', () => {
    // The whole point of comparing the PARSED reference: one generator writes
    // a bare key, another writes a signed URL, and string equality would call
    // those two different documents.
    const asKey = storedFileKey('gen/a.pdf');
    const asUrl = storedFileKey('https://x.supabase.co/storage/v1/object/sign/client-files/gen/a.pdf?token=zz');
    expect(asKey).not.toBeNull();
    expect(asUrl).not.toBeNull();
    expect(storedFileKey('{"path":"gen/a.pdf","fullPath":"client-files/gen/a.pdf"}')).toBe(asUrl);
  });

  it('a report already on the portal is never offered as a source', () => {
    const list = publishableReports([report({ source: 'portal_report', type: 'published' })], new Map());
    expect(list).toEqual([]);
  });

  it('offers newest first and drops what cannot be published', () => {
    const list = publishableReports([
      report({ id: 'old', generatedAt: '2026-01-01T00:00:00Z' }),
      report({ id: 'new', generatedAt: '2026-08-19T00:00:00Z' }),
      report({ id: 'broken', fileUrl: null, source: 'investment_report', status: 'failed' }),
    ], new Map());
    expect(list.map((x) => x.report.id)).toEqual(['new', 'old']);
  });
});

describe('finding a report in the picker', () => {
  it('every word must match, and they may match different fields', () => {
    const r = report({ name: 'Investment Report - 14 Yillowra St', type: 'investment', propertyAddress: '14 Yillowra St' });
    expect(matchesReportSearch(r, 'investment yillowra')).toBe(true);
    expect(matchesReportSearch(r, 'investment nowhere')).toBe(false);
    expect(matchesReportSearch(r, '   ')).toBe(true);
  });
});

describe('one implementation, not two', () => {
  const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8');

  it('every portal report type the picker can choose is one the tab renders', () => {
    const tab = read('../../../components/clients/ClientSentReportsTab.tsx');
    for (const value of new Set(Object.values(PORTAL_REPORT_TYPE))) {
      expect(tab, `${value} has no label in reportTypeConfig`).toContain(`${value}:`);
    }
  });

  it('neither surface builds the report list or the publish itself', () => {
    for (const rel of [
      '../../../components/clients/ClientReportsTab.tsx',
      '../../../components/clients/ClientSentReportsTab.tsx',
    ]) {
      const src = read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      // Publishing writes one row through one module. A second `create` against
      // this table is a second implementation of the same act.
      expect(src).not.toContain("table: 'client_portal_reports',\n        clientId,\n        data: {\n          report_title: report.name");
      expect(src).toContain('publishReportToPortal');
    }
  });

  it('the Reports tab reads the shared inventory rather than its own queries', () => {
    const src = read('../../../components/clients/ClientReportsTab.tsx');
    expect(src).toContain('useClientReportInventory');
    // The five queries moved into the hook; leaving one behind is how the two
    // tabs come to disagree about what exists. An INVALIDATION of the same key
    // is not a second query and stays — the delete on this tab has to reach
    // the hook's cache.
    expect(src).not.toMatch(/useQuery\(\{[\s\S]{0,200}?queryKey: \['portfolio-analysis-reports'/);
    expect(src).not.toMatch(/useQuery\(\{[\s\S]{0,400}?table: 'borrowing_capacity_assessments'/);
    expect(src).not.toMatch(/useQuery\(\{[\s\S]{0,400}?table: 'client_portal_reports'/);
  });
});

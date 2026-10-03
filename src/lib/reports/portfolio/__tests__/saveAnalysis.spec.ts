/**
 * The analysis dialog saves what it generated, in the template that was chosen.
 *
 * The owner's report (1 Oct 2026): a client's Portfolio Analysis came out in the
 * legacy layout whichever template was chosen, because the dialog's only button
 * drew it in the browser with pdf-lib. The typeset route reads a SAVED row, so
 * the export saves the row first, renders it, and records the rendered document
 * as the saved report's file. These pin that sequence and every place it can
 * stop, because what each stop leaves behind is what the person is told.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  invoke: [] as Array<{ fn: string; body: Record<string, unknown> }>,
  answer: (_fn: string, _body: Record<string, unknown>) =>
    ({ data: { success: true, result: { id: 'pf-new' } }, error: null }) as { data: unknown; error: unknown },
}));

vi.mock('@/lib/secureInvoke', () => ({
  invokeSecureFunction: async (fn: string, body: Record<string, unknown>) => {
    h.invoke.push({ fn, body });
    return h.answer(fn, body);
  },
}));
// The real delivery module is never reached from here: the sequence takes it
// as a dependency, and the wire helpers below only touch `invokeSecureFunction`.
vi.mock('../deliverPortfolioReview', () => ({ deliverPortfolioReview: vi.fn() }));

import {
  asSentence,
  exportAnalysisInTemplate,
  portfolioAnalysisRow,
  portfolioFileIndexEntry,
  recordAnalysisFile,
  saveAnalysisRow,
  type SavedPortfolioAnalysis,
  type TemplateExportDeps,
} from '../saveAnalysis';
import type { DeliveredPortfolioReview } from '../deliverPortfolioReview';

const CLIENT = '0f6a3f0e-2f4b-4c39-9a51-6f3f1b2c9d11';

/** The analysis as `generate-portfolio-analysis` answers it, trimmed to what the row reads. */
const ANALYSIS = {
  clientName: 'Masline Nyawo',
  portfolioMetrics: {
    totalValue: 1_650_000,
    totalEquity: 512_000,
    netMonthlyCashflow: -420,
    totalProperties: 3,
    averageLVR: 69,
    averageYield: 4.1,
  },
  analysis: {
    executiveSummary: { healthScore: 78, overallHealth: 'Good' },
    personalizedNarrative: { openingStatement: 'Dear Masline,', portfolioJourney: 'Three holdings.' },
  },
  propertyAnalyses: [{ propertyNumber: 1, address: '1 Weipa Street' }],
  generatedAt: '2026-10-01T14:20:00.000Z',
};

const TYPESET_PATH = `portfolio-reports/${CLIENT}/typeset/2026-10-01/1b2c-Portfolio-Performance-Review-Masline-Nyawo-1-Oct-2026.pdf`;

const delivered = (over: Partial<DeliveredPortfolioReview> = {}): DeliveredPortfolioReview => ({
  source: 'server',
  fileName: 'Portfolio Performance Review - Masline Nyawo - 1 Oct 2026.pdf',
  brandGaps: [],
  reviewIncluded: false,
  storagePath: TYPESET_PATH,
  storageBucket: 'client-files',
  bytes: 412_334,
  ...over,
});

/** A fake wire that records the order things happened in. */
function wire(over: Partial<TemplateExportDeps> = {}) {
  const calls: string[] = [];
  const deps: TemplateExportDeps = {
    saveRow: vi.fn(async (_c, _a, path) => { calls.push(`save:${path}`); return 'pf-new'; }),
    render: vi.fn(async (input) => { calls.push(`render:${input.request.reportId}`); return delivered(); }),
    recordFile: vi.fn(async (_c, id, path) => { calls.push(`record:${id}:${path}`); return { error: null }; }),
    indexFile: vi.fn(async (_c, entry) => { calls.push(`index:${entry.filePath}`); return { error: null }; }),
    ...over,
  };
  return { deps, calls };
}

beforeEach(() => {
  h.invoke = [];
  h.answer = () => ({ data: { success: true, result: { id: 'pf-new' } }, error: null });
});

describe('the first export saves, renders, then records', () => {
  it('in that order, and nothing else', async () => {
    const { deps, calls } = wire();
    const out = await exportAnalysisInTemplate({ clientId: CLIENT, analysis: ANALYSIS, saved: null }, deps);

    expect(calls).toEqual([
      'save:null',
      'render:pf-new',
      `record:pf-new:${TYPESET_PATH}`,
      `index:${TYPESET_PATH}`,
    ]);
    expect(out.failure).toBeNull();
    expect(out.recorded).toBe(true);
    expect(out.saved).toEqual({ reportId: 'pf-new', filePath: TYPESET_PATH, renderer: 'template' });
  });

  it('saves the row with no file: the file it records is the one the route stores', async () => {
    const { deps } = wire();
    await exportAnalysisInTemplate({ clientId: CLIENT, analysis: ANALYSIS, saved: null }, deps);
    expect(deps.saveRow).toHaveBeenCalledWith(CLIENT, ANALYSIS, null);
  });

  it('asks for the analysis alone: the review is a separate assessment nobody asked for here', async () => {
    const { deps } = wire();
    await exportAnalysisInTemplate({ clientId: CLIENT, analysis: ANALYSIS, saved: null }, deps);
    expect(deps.render).toHaveBeenCalledWith({
      variant: 'server',
      request: { reportId: 'pf-new', includeReview: false },
    });
  });

  it('lists the typeset file among the client documents under its readable name', async () => {
    const { deps } = wire();
    await exportAnalysisInTemplate({ clientId: CLIENT, analysis: ANALYSIS, saved: null }, deps);
    expect(deps.indexFile).toHaveBeenCalledWith(CLIENT, {
      fileName: 'Portfolio Performance Review - Masline Nyawo - 1 Oct 2026.pdf',
      filePath: TYPESET_PATH,
      bytes: 412_334,
    });
  });
});

describe('one analysis is one row', () => {
  it('a second export renders the saved row again and saves nothing new', async () => {
    const { deps, calls } = wire();
    const saved: SavedPortfolioAnalysis = { reportId: 'pf-1', filePath: TYPESET_PATH, renderer: 'template' };
    const out = await exportAnalysisInTemplate({ clientId: CLIENT, analysis: ANALYSIS, saved }, deps);

    expect(deps.saveRow).not.toHaveBeenCalled();
    expect(calls[0]).toBe('render:pf-1');
    expect(out.saved?.reportId).toBe('pf-1');
  });

  it('an analysis the legacy layout saved first is re-recorded in the chosen template', async () => {
    const { deps } = wire();
    const saved: SavedPortfolioAnalysis = {
      reportId: 'pf-1', filePath: `portfolio-reports/${CLIENT}/Portfolio_Analysis_Masline_Nyawo_x.pdf`, renderer: 'legacy',
    };
    const out = await exportAnalysisInTemplate({ clientId: CLIENT, analysis: ANALYSIS, saved }, deps);
    expect(deps.recordFile).toHaveBeenCalledWith(CLIENT, 'pf-1', TYPESET_PATH);
    expect(out.saved).toEqual({ reportId: 'pf-1', filePath: TYPESET_PATH, renderer: 'template' });
  });
});

describe('every stop says what it left behind', () => {
  it('a row that could not be saved: nothing rendered, nothing saved', async () => {
    const { deps } = wire({ saveRow: vi.fn(async () => { throw new Error('permission denied'); }) });
    const out = await exportAnalysisInTemplate({ clientId: CLIENT, analysis: ANALYSIS, saved: null }, deps);
    expect(out.saved).toBeNull();
    expect(out.delivered).toBeNull();
    expect(out.failure).toEqual({ stage: 'save', message: 'permission denied' });
    expect(deps.render).not.toHaveBeenCalled();
  });

  it('a render that failed: the analysis stays saved with no file, and nothing is recorded', async () => {
    const { deps } = wire({ render: vi.fn(async () => { throw new Error('The renderer did not answer (503)'); }) });
    const out = await exportAnalysisInTemplate({ clientId: CLIENT, analysis: ANALYSIS, saved: null }, deps);
    expect(out.saved).toEqual({ reportId: 'pf-new', filePath: null, renderer: null });
    expect(out.failure).toEqual({ stage: 'render', message: 'The renderer did not answer (503)' });
    expect(deps.recordFile).not.toHaveBeenCalled();
    expect(deps.indexFile).not.toHaveBeenCalled();
  });

  it('a retry after a failed render reuses the row the failure left', async () => {
    const failing = wire({ render: vi.fn(async () => { throw new Error('503'); }) });
    const first = await exportAnalysisInTemplate({ clientId: CLIENT, analysis: ANALYSIS, saved: null }, failing.deps);

    const { deps } = wire();
    const second = await exportAnalysisInTemplate({ clientId: CLIENT, analysis: ANALYSIS, saved: first.saved }, deps);
    expect(deps.saveRow).not.toHaveBeenCalled();
    expect(second.saved).toEqual({ reportId: 'pf-new', filePath: TYPESET_PATH, renderer: 'template' });
  });

  it('a file that could not be recorded: downloaded, saved, and the report keeps what it had', async () => {
    const { deps } = wire({ recordFile: vi.fn(async () => ({ error: 'network' })) });
    const saved: SavedPortfolioAnalysis = { reportId: 'pf-1', filePath: null, renderer: null };
    const out = await exportAnalysisInTemplate({ clientId: CLIENT, analysis: ANALYSIS, saved }, deps);
    expect(out.delivered?.fileName).toContain('Portfolio Performance Review');
    expect(out.recorded).toBe(false);
    expect(out.saved).toEqual(saved);
    expect(out.failure).toEqual({ stage: 'record', message: 'network' });
    expect(deps.indexFile).not.toHaveBeenCalled();
  });

  it('a listing that failed is reported beside a recorded file, never instead of it', async () => {
    const { deps } = wire({ indexFile: vi.fn(async () => ({ error: 'conflict' })) });
    const out = await exportAnalysisInTemplate({ clientId: CLIENT, analysis: ANALYSIS, saved: null }, deps);
    expect(out.recorded).toBe(true);
    expect(out.failure).toBeNull();
    expect(out.indexError).toBe('conflict');
  });
});

describe('only a client-files object becomes the saved file', () => {
  // The publish operation signs `pdf_file_path` in `client-files` and nothing
  // else, so recording any other object would leave a report "Send Portfolio to
  // Client" cannot send.
  it('a templated final in investment-reports is downloaded but not recorded', async () => {
    const { deps } = wire({
      render: vi.fn(async () => delivered({
        storagePath: 'template-builder/2026-10-01/x.pdf', storageBucket: 'investment-reports', templated: true,
      })),
    });
    const out = await exportAnalysisInTemplate({ clientId: CLIENT, analysis: ANALYSIS, saved: null }, deps);
    expect(deps.recordFile).not.toHaveBeenCalled();
    expect(out.recorded).toBe(false);
    expect(out.failure?.stage).toBe('record');
  });

  it('a route that names no path is downloaded but not recorded', async () => {
    const { deps } = wire({ render: vi.fn(async () => delivered({ storagePath: null, storageBucket: null })) });
    const out = await exportAnalysisInTemplate({ clientId: CLIENT, analysis: ANALYSIS, saved: null }, deps);
    expect(deps.recordFile).not.toHaveBeenCalled();
    expect(out.failure).toEqual({ stage: 'record', message: 'The renderer did not say where it stored the PDF' });
  });
});

describe('the row both exports write', () => {
  it('is the generator row, column for column', () => {
    // Written out as the legacy generator's literal was, so a drift between
    // the two exports' rows is a failing test rather than two summaries.
    expect(portfolioAnalysisRow(ANALYSIS, CLIENT, 'portfolio-reports/c/x.pdf')).toEqual({
      client_id: CLIENT,
      client_name: 'Masline Nyawo',
      health_score: 78,
      overall_health: 'Good',
      portfolio_value: 1_650_000,
      total_equity: 512_000,
      net_monthly_cashflow: -420,
      total_properties: 3,
      average_lvr: 69,
      average_yield: 4.1,
      report_data: ANALYSIS,
      pdf_file_path: 'portfolio-reports/c/x.pdf',
      status: 'completed',
    });
  });

  it('stores the analysis exactly as it arrived', () => {
    const row = portfolioAnalysisRow(ANALYSIS, CLIENT, null);
    expect(row.report_data).toBe(ANALYSIS);
    expect(row.pdf_file_path).toBeNull();
  });

  it('keeps the generator\'s reading of an absent summary figure', () => {
    const row = portfolioAnalysisRow({ clientName: 'A', portfolioMetrics: null, analysis: null }, CLIENT, null);
    expect(row.health_score).toBeNull();
    expect(row.portfolio_value).toBeNull();
  });

  it('lists a file the way the generator always has', () => {
    expect(portfolioFileIndexEntry({
      fileName: 'f.pdf', filePath: 'p/f.pdf', bytes: 10, savedAt: new Date('2026-10-01T03:00:00Z'),
    })).toEqual({
      category: 'report',
      file_name: 'f.pdf',
      file_path: 'p/f.pdf',
      file_type: 'application/pdf',
      file_size: 10,
      description: `Portfolio Performance Analysis - ${new Date('2026-10-01T03:00:00Z').toLocaleDateString('en-AU')}`,
      report_type: 'portfolio',
    });
  });
});

describe('the wire helpers', () => {
  it('saves through manage-client-data and answers the new id', async () => {
    const id = await saveAnalysisRow(CLIENT, ANALYSIS, null);
    expect(id).toBe('pf-new');
    expect(h.invoke).toEqual([{
      fn: 'manage-client-data',
      body: {
        operation: 'create',
        table: 'portfolio_analysis_reports',
        clientId: CLIENT,
        data: portfolioAnalysisRow(ANALYSIS, CLIENT, null),
      },
    }]);
  });

  it('refuses to call a row saved when no id came back', async () => {
    h.answer = () => ({ data: { success: true, result: null }, error: null });
    await expect(saveAnalysisRow(CLIENT, ANALYSIS, null)).rejects.toThrow(/no record came back/);
  });

  it('carries the server\'s reason when the row was refused', async () => {
    h.answer = () => ({ data: null, error: { message: 'You are not authorized to manage this client' } });
    await expect(saveAnalysisRow(CLIENT, ANALYSIS, null)).rejects.toThrow('You are not authorized to manage this client');
  });

  it('records the file by updating the one row, inside the client', async () => {
    const out = await recordAnalysisFile(CLIENT, 'pf-1', TYPESET_PATH);
    expect(out).toEqual({ error: null });
    expect(h.invoke).toEqual([{
      fn: 'manage-client-data',
      body: {
        operation: 'update',
        table: 'portfolio_analysis_reports',
        clientId: CLIENT,
        recordId: 'pf-1',
        data: { pdf_file_path: TYPESET_PATH },
      },
    }]);
  });

  it('writes one stop at the end of a message, never two', () => {
    expect(asSentence('permission denied')).toBe('permission denied.');
    expect(asSentence('Failed to fetch.')).toBe('Failed to fetch.');
    expect(asSentence('  trailing  ')).toBe('trailing.');
  });
});

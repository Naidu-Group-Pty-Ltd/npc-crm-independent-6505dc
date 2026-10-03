/**
 * The Portfolio Analysis dialog: choose a template, then export in it.
 *
 * The owner's report (1 Oct 2026): a client's Portfolio Analysis came out in
 * the legacy layout. The dialog that shows a finished analysis had one button,
 * "Download & Save PDF", which drew it in the browser with pdf-lib and never
 * read the template choice. Now "Choose template" sits beside "Export PDF",
 * Export PDF saves the analysis and draws it through the typeset route in the
 * choice, and the legacy layout is a named item in the menu beside it.
 *
 * This renders the REAL dialog with the network boundary stood in: the model
 * call, the row writes and the render route are fakes, the component and its
 * wiring are not.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FIXTURE_CLIENT_ID, portfolioAnalysisResponse } from './fixtures/portfolioAnalysisResponse';

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  deliver: vi.fn(),
  notify: vi.fn(),
  activity: vi.fn(),
  renderEvent: vi.fn(),
  settings: vi.fn(),
  upload: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock('@/lib/secureInvoke', () => ({ invokeSecureFunction: h.invoke }));
vi.mock('@/lib/reports/portfolio/deliverPortfolioReview', () => ({ deliverPortfolioReview: h.deliver }));
vi.mock('@/lib/preflightTokens', () => ({ runPreflight: async () => true }));
vi.mock('@/contexts/NotificationsContext', () => ({ useNotifications: () => ({ addNotification: h.notify }) }));
vi.mock('@/branding/BrandProvider', () => ({ useBrand: () => ({ settings: { brandColor: null } }) }));
vi.mock('@/hooks/useActivityLogger', () => ({ logActivityDirect: h.activity }));
vi.mock('@/lib/reports/renderEvent', () => ({ logReportRenderEvent: h.renderEvent }));
vi.mock('@/hooks/useGlobalReportSettings', () => ({ fetchGlobalReportSettings: h.settings }));
vi.mock('@/hooks/useSecureStorage', () => ({ secureStorageUpload: h.upload }));
vi.mock('@/components/billing/TokenCostEstimate', () => ({ TokenCostEstimate: () => null }));
vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/lib/reportTemplate/templateSelection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reportTemplate/templateSelection')>();
  return {
    ...actual,
    fetchActiveReportTemplates: async () => ([{
      id: 'tpl-pf', name: 'Atelier — Midnight', report_type: 'portfolio', engine: 'weasyprint', is_active: true,
    }]),
    fetchTemplateSelections: async () => ([{ id: 'sel-1', report_type: 'portfolio', template_id: 'tpl-pf' }]),
  };
});

import { PortfolioAnalysisPDFGenerator } from '../PortfolioAnalysisPDFGenerator';

const TYPESET_PATH = `portfolio-reports/${FIXTURE_CLIENT_ID}/typeset/2026-10-01/9a1b-Portfolio-Performance-Review-Avery-Sample-1-Oct-2026.pdf`;
const delivered = () => ({
  source: 'server',
  fileName: 'Portfolio Performance Review - Avery Sample - 1 Oct 2026.pdf',
  brandGaps: [],
  reviewIncluded: false,
  storagePath: TYPESET_PATH,
  storageBucket: 'client-files',
  bytes: 398_112,
});

let rows = 0;
const onComplete = vi.fn();

/** Every manage-client-data write, in order, as `operation table`. */
const writes = () => h.invoke.mock.calls
  .filter(([fn]) => fn === 'manage-client-data')
  .map(([, body]) => body as Record<string, any>);

const open = async () => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PortfolioAnalysisPDFGenerator
        clientId={FIXTURE_CLIENT_ID}
        clientName="Avery Sample"
        onComplete={onComplete}
      />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: /Portfolio Analysis/ }));
  return screen.findByRole('dialog');
};

/** Radix opens a dropdown on `pointerdown`; a real pointer fires both. */
const press = (el: Element) => {
  fireEvent.pointerDown(el, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  fireEvent.click(el);
};

/**
 * Two clicks that both land before React renders the first one's busy state —
 * a fast double-click. Inside one `act` nothing re-renders between them, so
 * both reach the handler the last render drew, which still reads "not busy".
 */
const clickTwiceBeforeRender = (first: HTMLElement, second: HTMLElement = first) => {
  act(() => {
    first.click();
    second.click();
  });
};

/** Long enough for an export the guard failed to stop to have written something. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

beforeEach(() => {
  cleanup();
  rows = 0;
  for (const fn of [h.invoke, h.deliver, h.notify, h.activity, h.renderEvent, h.settings, h.upload, onComplete]) fn.mockReset();
  Object.values(h.toast).forEach((fn) => fn.mockReset());
  h.invoke.mockImplementation(async (fn: string, body: Record<string, any>) => {
    if (fn === 'generate-portfolio-analysis') return { data: portfolioAnalysisResponse, error: null };
    if (fn === 'manage-client-data' && body.operation === 'create' && body.table === 'portfolio_analysis_reports') {
      rows += 1;
      return { data: { success: true, result: { id: `pf-${rows}` } }, error: null };
    }
    return { data: { success: true, result: {} }, error: null };
  });
  h.deliver.mockResolvedValue(delivered());
  // The legacy layout's first read. Refusing it stops the in-browser draw
  // before pdf-lib does anything jsdom cannot, and says the legacy path ran.
  h.settings.mockRejectedValue(new Error('legacy layout reached'));
});

describe('the dialog that shows a finished analysis', () => {
  it('offers Choose template beside Export PDF, and no Download & Save', async () => {
    const dialog = await open();
    expect(within(dialog).getByRole('button', { name: /^Choose template/ })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: /^Export PDF$/ })).toBeTruthy();
    expect(within(dialog).queryByText(/Download & Save PDF/)).toBeNull();
  });

  it('says which template Export PDF will use', async () => {
    const dialog = await open();
    expect(await within(dialog).findByText(/Template: Atelier — Midnight/)).toBeTruthy();
    expect(within(dialog).getByText(/Export PDF saves the analysis to Reports/)).toBeTruthy();
  });

  it('is named by its title alone, with the actions beside it', async () => {
    // The button used to sit inside the title, so the dialog's accessible name
    // read "Portfolio Performance Analysis Download & Save PDF".
    await open();
    expect(screen.getByRole('dialog', { name: 'Portfolio Performance Analysis' })).toBeTruthy();
  });
});

describe('Export PDF', () => {
  it('saves the analysis, draws it in the chosen template, and records that file', async () => {
    const dialog = await open();
    fireEvent.click(within(dialog).getByRole('button', { name: /^Export PDF$/ }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));

    // The typeset route, for the row just saved, with the analysis alone.
    expect(h.deliver).toHaveBeenCalledWith({
      variant: 'server',
      request: { reportId: 'pf-1', includeReview: false },
    });

    const [save, record, index] = writes();
    expect(save).toMatchObject({ operation: 'create', table: 'portfolio_analysis_reports', clientId: FIXTURE_CLIENT_ID });
    expect(save.data.pdf_file_path).toBeNull();
    // The analysis is stored exactly as it was generated.
    expect(save.data.report_data).toEqual(portfolioAnalysisResponse);
    expect(record).toMatchObject({
      operation: 'update', table: 'portfolio_analysis_reports', recordId: 'pf-1',
      data: { pdf_file_path: TYPESET_PATH },
    });
    expect(index).toMatchObject({
      operation: 'create', table: 'client_files',
      data: { file_path: TYPESET_PATH, report_type: 'portfolio', file_size: 398_112 },
    });

    expect(h.settings).not.toHaveBeenCalled();
    expect(h.upload).not.toHaveBeenCalled();
    expect(h.toast.success).toHaveBeenCalledWith('Portfolio Analysis saved to Reports', {
      description: 'Exported in Atelier — Midnight.',
    });
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Portfolio Report Ready' }));
    expect(await within(dialog).findByText(/Saved to Reports with its PDF in your chosen template/)).toBeTruthy();
  });

  it('a second export draws the same saved row again and saves no second copy', async () => {
    const dialog = await open();
    const exportButton = within(dialog).getByRole('button', { name: /^Export PDF$/ });
    fireEvent.click(exportButton);
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    fireEvent.click(exportButton);
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(2));

    const saves = writes().filter((w) => w.operation === 'create' && w.table === 'portfolio_analysis_reports');
    expect(saves).toHaveLength(1);
    expect(h.deliver).toHaveBeenCalledTimes(2);
    expect(h.deliver.mock.calls.map(([input]) => input.request.reportId)).toEqual(['pf-1', 'pf-1']);
  });

  it('a double-click saves one report, not two', async () => {
    const dialog = await open();
    clickTwiceBeforeRender(within(dialog).getByRole('button', { name: /^Export PDF$/ }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    await settle();

    const saves = writes().filter((w) => w.operation === 'create' && w.table === 'portfolio_analysis_reports');
    expect(saves).toHaveLength(1);
    expect(h.deliver).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('a render that fails says the analysis is saved, and a retry reuses it', async () => {
    h.deliver.mockRejectedValueOnce(new Error('The renderer did not answer (503)'));
    const dialog = await open();
    const exportButton = within(dialog).getByRole('button', { name: /^Export PDF$/ });
    fireEvent.click(exportButton);

    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith(
      'The analysis is saved to Reports, but its PDF could not be produced',
      expect.objectContaining({
        description: expect.stringContaining('choose Export PDF (legacy layout) from the menu'),
      }),
    ));
    // Never a fallback the person did not choose.
    expect(h.settings).not.toHaveBeenCalled();
    expect(await within(dialog).findByText(/Saved to Reports without a PDF yet/)).toBeTruthy();

    fireEvent.click(exportButton);
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    const saves = writes().filter((w) => w.operation === 'create' && w.table === 'portfolio_analysis_reports');
    expect(saves).toHaveLength(1);
    expect(writes().find((w) => w.operation === 'update')).toMatchObject({ recordId: 'pf-1' });
  });

  it('a new analysis is a new report', async () => {
    const dialog = await open();
    fireEvent.click(within(dialog).getByRole('button', { name: /^Export PDF$/ }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));

    // Generate again from the client's own button, then export.
    fireEvent.click(screen.getAllByRole('button', { name: /Portfolio Analysis/, hidden: true })
      .find((b) => !dialog.contains(b))!);
    await waitFor(() => expect(
      h.invoke.mock.calls.filter(([fn]) => fn === 'generate-portfolio-analysis'),
    ).toHaveLength(2));
    const again = await screen.findByRole('dialog');
    await waitFor(() => expect(within(again).getByText(/Export PDF saves the analysis to Reports/)).toBeTruthy());
    fireEvent.click(within(again).getByRole('button', { name: /^Export PDF$/ }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(2));

    const saves = writes().filter((w) => w.operation === 'create' && w.table === 'portfolio_analysis_reports');
    expect(saves).toHaveLength(2);
    expect(h.deliver.mock.calls.map(([input]) => input.request.reportId)).toEqual(['pf-1', 'pf-2']);
  });
});

describe('the legacy layout', () => {
  it('is offered by name in the menu beside Export PDF', async () => {
    const dialog = await open();
    press(within(dialog).getByRole('button', { name: 'Other ways to export this analysis' }));
    expect(await screen.findByText('Export PDF (legacy layout)')).toBeTruthy();
    expect(screen.getByText(/The previous design, drawn in your browser/)).toBeTruthy();
  });

  it('runs the in-browser generator, not the typeset route', async () => {
    const dialog = await open();
    press(within(dialog).getByRole('button', { name: 'Other ways to export this analysis' }));
    fireEvent.click(await screen.findByText('Export PDF (legacy layout)'));
    await waitFor(() => expect(h.settings).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Failed to generate PDF: legacy layout reached'));
    expect(h.deliver).not.toHaveBeenCalled();
  });

  it('a double-click on it draws it once', async () => {
    // Radix flushes a menu item's click synchronously, so its busy state turns
    // the second away before the claim is consulted; this pins the outcome
    // whichever of the two does it.
    const dialog = await open();
    press(within(dialog).getByRole('button', { name: 'Other ways to export this analysis' }));
    clickTwiceBeforeRender(await screen.findByText('Export PDF (legacy layout)'));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Failed to generate PDF: legacy layout reached'));
    await settle();
    expect(h.settings).toHaveBeenCalledTimes(1);
  });

  it('cannot start while Export PDF is still running, so the two never save two rows', async () => {
    // One claim covers both exports, because both can save the analysis.
    const dialog = await open();
    const exportButton = within(dialog).getByRole('button', { name: /^Export PDF$/ });
    press(within(dialog).getByRole('button', { name: 'Other ways to export this analysis' }));
    clickTwiceBeforeRender(exportButton, await screen.findByText('Export PDF (legacy layout)'));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    await settle();

    expect(h.settings).not.toHaveBeenCalled();
    expect(writes().filter((w) => w.operation === 'create' && w.table === 'portfolio_analysis_reports')).toHaveLength(1);
  });

  it('says it downloads only once the analysis is saved in the chosen template', async () => {
    const dialog = await open();
    fireEvent.click(within(dialog).getByRole('button', { name: /^Export PDF$/ }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    press(within(dialog).getByRole('button', { name: 'Other ways to export this analysis' }));
    expect(await screen.findByText(/downloads only, the saved PDF stays/)).toBeTruthy();
  });
});

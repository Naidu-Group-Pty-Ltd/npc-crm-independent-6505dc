/**
 * The floating generation-progress widget, on the case that was reported.
 *
 * An operator regenerated a report created two days earlier. The corner of the
 * screen showed a bare sonner toast — "Generating section 8/12… Compass-40
 * Report" — with nothing to press: no per-report progress, no Stop, no Pause,
 * no auto-continue, no ETA, no history. The interactive widget had not been
 * removed or unmounted; it rendered null.
 *
 * `fetchActiveReports` windowed the poll with `createdAfter: now - 24h`.
 * Regenerating a report moves `updated_at` and never `created_at` — the table
 * trigger stamps every update and the generator stamps every section — so a
 * report older than the window was filtered out server-side however hard it was
 * working. `reports` stayed empty, `hasAnything` was false, the component
 * returned null, and the hook's toast was the whole of the feedback.
 *
 * These render the real component against a stubbed transport, because the
 * fault was in what it asked for rather than in what it drew, and no test that
 * stops at the pure selectors can see that.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  REPORT_GENERATION_CANCELLED_EVENT,
  cancellationReason,
  cancelledReportId,
} from '@/lib/reports/generationSignals.pure';

const invokeSecureFunction = vi.fn();

vi.mock('@/lib/secureInvoke', () => ({
  invokeSecureFunction: (...args: unknown[]) => invokeSecureFunction(...args),
  isAuthExhausted: () => false,
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { username: 'ana' }, loading: false }),
}));

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/generated-reports' }),
  useNavigate: () => vi.fn(),
}));

vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));

vi.mock('@/hooks/useGenerationHistory', () => ({
  useGenerationHistory: () => ({ entries: [], addEntry: vi.fn(), clear: vi.fn() }),
}));

import { ReportGenerationProgress } from '../ReportGenerationProgress';

const REPORT_ID = '11111111-2222-4333-8444-555555555555';
const DAY_MS = 24 * 60 * 60 * 1000;

/** The reported row: created two days ago, being regenerated right now. */
function regeneratingRow() {
  const now = Date.now();
  return {
    id: REPORT_ID,
    property_address: '48 Redfern Street, Cowra NSW 2794',
    status: 'processing',
    error_message: null,
    created_at: new Date(now - 2 * DAY_MS).toISOString(),
    updated_at: new Date(now - 5_000).toISOString(),
    last_completed_section: 8,
    total_sections: 12,
    bulk_job_id: null,
    report_tier: 'compass',
    generation_engine: 'compass-40',
  };
}

/** The last listOptions the widget sent to `get-investment-reports`. */
function lastListOptions(): Record<string, unknown> | undefined {
  const call = invokeSecureFunction.mock.calls
    .filter(([fn, payload]) => fn === 'get-investment-reports' && (payload as any)?.listMode)
    .pop();
  return (call?.[1] as any)?.listOptions;
}

beforeEach(() => {
  invokeSecureFunction.mockReset();
  localStorage.clear();
  invokeSecureFunction.mockImplementation(async (fn: string, payload: any) => {
    if (fn === 'get-investment-reports' && payload?.listMode) {
      // Apply the window the way `get-investment-reports` does, so these are a
      // regression test rather than a description: under the old
      // `createdAfter` the two-day-old row is filtered out server-side and the
      // widget renders null — which is the reported defect, reproduced.
      const options = payload.listOptions ?? {};
      const rows = [regeneratingRow()].filter((row) => {
        if (options.createdAfter && Date.parse(row.created_at) < Date.parse(options.createdAfter)) {
          return false;
        }
        if (options.updatedAfter && Date.parse(row.updated_at) < Date.parse(options.updatedAfter)) {
          return false;
        }
        return true;
      });
      return { data: { reports: rows }, error: null };
    }
    return { data: { success: true }, error: null };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the widget is there for a regeneration of an older report', () => {
  it('windows the poll by activity, never by creation', async () => {
    render(<ReportGenerationProgress />);
    await waitFor(() => expect(lastListOptions()).toBeDefined());

    const options = lastListOptions()!;
    // The whole fault: `created_at` is two days old and never moves again.
    expect(options).not.toHaveProperty('createdAfter');
    expect(typeof options.updatedAfter).toBe('string');
    expect(Date.parse(options.updatedAfter as string)).toBeGreaterThan(Date.now() - DAY_MS - 60_000);
    expect(Date.parse(options.updatedAfter as string)).toBeLessThanOrEqual(Date.now());
    // A row two days old must sit inside that window on its activity alone.
    expect(Date.parse(regeneratingRow().updated_at)).toBeGreaterThan(
      Date.parse(options.updatedAfter as string),
    );
  });

  it('draws the report and its live progress, not just a toast', async () => {
    render(<ReportGenerationProgress />);
    expect(await screen.findByText('48 Redfern Street, Cowra NSW 2794')).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'Report generation progress' }),
    ).toBeInTheDocument();
  });

  it('offers the acts that make it a control surface rather than a read-out', async () => {
    render(<ReportGenerationProgress />);
    await screen.findByText('48 Redfern Street, Cowra NSW 2794');

    // The functionality the operator said they had lost.
    expect(
      screen.getByRole('button', { name: /Stop generating 48 Redfern Street/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Hide 48 Redfern Street/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generation options' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Toggle history' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Minimize' })).toBeInTheDocument();
  });
});

describe('Stop reaches the other driver', () => {
  it('names the report and carries the reason, so the pump can abort its own run', async () => {
    const seen: CustomEvent[] = [];
    const listener = (e: Event) => seen.push(e as CustomEvent);
    window.addEventListener(REPORT_GENERATION_CANCELLED_EVENT, listener);

    try {
      render(<ReportGenerationProgress />);
      await screen.findByText('48 Redfern Street, Cowra NSW 2794');

      fireEvent.click(screen.getByRole('button', { name: /Stop generating 48 Redfern Street/ }));
      // Stopping is confirmed — it cannot be undone.
      fireEvent.click(await screen.findByRole('button', { name: 'Stop generation' }));

      await waitFor(() => expect(seen).toHaveLength(1));
      expect(cancelledReportId(seen[0].detail)).toBe(REPORT_ID);
      // The reason travels because the hook re-asserts the stop once its
      // in-flight section lands, and a row reading `failed` with no reason is
      // indistinguishable from one that broke.
      expect(cancellationReason(seen[0].detail)).toBe('Cancelled by ana');
    } finally {
      window.removeEventListener(REPORT_GENERATION_CANCELLED_EVENT, listener);
    }
  });
});


describe('a research phase and a hang must not read alike', () => {
  /**
   * The reported line was `Section 1 of 15 · 0/15 · 0% · 21m 2s elapsed`. The
   * run had genuinely banked nothing — but the widget had been drawing those
   * exact words since the first second, because `totalSections` falls back to
   * the tier registry when the server has stated none. `total_sections` is
   * written by the first progressive save, which is also the first moment any
   * prose exists, so its absence is a real signal and not a second guess.
   *
   * This renders the real component, because the fault is in what it DRAWS.
   */
  const RESEARCHING_ID = '99999999-8888-4777-8666-555555555555';

  function researchingRow() {
    const now = Date.now();
    return {
      id: RESEARCHING_ID,
      property_address: '18 Annabelle Crescent, Kellyville NSW 2155',
      status: 'processing',
      error_message: null,
      created_at: new Date(now - 40_000).toISOString(),
      updated_at: new Date(now - 5_000).toISOString(),
      // What the record holds during acquisition: no plan, no prose.
      last_completed_section: 0,
      total_sections: null,
      bulk_job_id: null,
      report_tier: 'compass',
      generation_engine: 'compass-40',
    };
  }

  function serveResearchingRow() {
    invokeSecureFunction.mockImplementation(async (fn: string, payload: any) => {
      if (fn === 'get-investment-reports' && payload?.listMode) {
        return { data: { reports: [researchingRow()] }, error: null };
      }
      return { data: { success: true }, error: null };
    });
  }

  it('says what the run is doing instead of inventing a section count', async () => {
    serveResearchingRow();
    render(<ReportGenerationProgress />);
    await screen.findByText('18 Annabelle Crescent, Kellyville NSW 2155');

    expect(await screen.findByText('Researching the property')).toBeInTheDocument();
    // The count the server has not stated is not printed as though it had.
    expect(screen.queryByText(/Section 1 of/)).not.toBeInTheDocument();
    // Exact, because the aggregate header above legitimately draws a bar and
    // needs a denominator to draw an arc with — this is about the ROW's own
    // counts line, which is what a reader reads as the report's own progress.
    expect(screen.queryByText('0/15 sections')).not.toBeInTheDocument();
    expect(screen.getByText(/No sections written yet/)).toBeInTheDocument();
  });

  it('prints the section count the moment the record states one', async () => {
    invokeSecureFunction.mockImplementation(async (fn: string, payload: any) => {
      if (fn === 'get-investment-reports' && payload?.listMode) {
        return {
          data: {
            reports: [{ ...researchingRow(), last_completed_section: 1, total_sections: 15 }],
          },
          error: null,
        };
      }
      return { data: { success: true }, error: null };
    });
    render(<ReportGenerationProgress />);
    await screen.findByText('18 Annabelle Crescent, Kellyville NSW 2155');

    expect(await screen.findByText('Section 2 of 15')).toBeInTheDocument();
    expect(screen.queryByText('Researching the property')).not.toBeInTheDocument();
  });
});

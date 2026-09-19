/**
 * The workspace page, wired.
 *
 * What matters here is the orchestration the pure modules cannot cover: that
 * arriving with no parameters offers a choice rather than minting a record,
 * that a legacy property link creates an analysis around that property, that
 * the stages are one navigation model, and that Generate is gated by the same
 * readiness the server enforces rather than by a second opinion.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const create = vi.fn();
const runCalculation = vi.fn();
const clientWorkspace = vi.fn();
const generate = vi.fn();
const update = vi.fn();
const saveNow = vi.fn();
const reload = vi.fn();

let assessment: Record<string, unknown> | null = null;

vi.mock('@/hooks/useCiAssessments', () => ({
  ciAssessmentApi: {
    create: (...args: unknown[]) => create(...args),
    runCalculation: (...args: unknown[]) => runCalculation(...args),
    clientWorkspace: (...args: unknown[]) => clientWorkspace(...args),
    complete: vi.fn(),
    searchClients: vi.fn().mockResolvedValue({ data: [], error: null }),
  },
  useCiAssessment: () => ({
    record: assessment,
    payload: assessment ? (assessment.payload as Record<string, unknown>) : null,
    loading: false,
    error: null,
    saveState: 'saved',
    lastSavedAt: null,
    update, saveNow, saveTitle: vi.fn(), reload,
  }),
  useCiAssessments: () => ({ rows: [], loading: false, refresh: vi.fn(), metrics: {} }),
}));
vi.mock('@/hooks/useCapacityReport', () => ({
  useCapacityReport: () => ({ generatingId: null, generate }),
}));
vi.mock('@/hooks/usePermissions', () => ({ usePermissions: () => ({ isSuperadmin: true }) }));
vi.mock('@/hooks/useModulePermissions', () => ({ useModulePermissions: () => ({ canEdit: true }) }));
const emptyList = { data: [], error: null };
const noProperty = { data: null, error: null };
vi.mock('@/hooks/useCommercialProperties', () => ({
  commercialApi: {
    listProperties: vi.fn().mockResolvedValue(emptyList),
    getProperty: vi.fn().mockResolvedValue(noProperty),
    updateProperty: vi.fn().mockResolvedValue(noProperty),
  },
}));
vi.mock('@/hooks/useIndustrialProperties', () => ({
  industrialApi: {
    listProperties: vi.fn().mockResolvedValue(emptyList),
    getProperty: vi.fn().mockResolvedValue(noProperty),
    updateProperty: vi.fn().mockResolvedValue(noProperty),
  },
}));
vi.mock('@/utils/commercial/clientPortfolioRepository', () => ({
  fetchClientProfile: vi.fn().mockResolvedValue({
    clientId: 'c1', clientName: 'Client', residentialAssets: [], commercialAssets: [],
    industrialAssets: [], liabilities: {}, existingLoans: {}, businessFinancials: {},
  }),
}));

const { default: CommercialIndustrialWorkspace } = await import('../CommercialIndustrialWorkspace');
const { emptyAssessmentPayload } = await import('@/lib/ciAssessment/types');

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    reference: 'CI-202608-AAAA',
    title: 'Untitled analysis',
    status: 'data_entry',
    segment: 'commercial',
    payload: emptyAssessmentPayload('commercial_investment'),
    client_id: null,
    current_calculation_id: null,
    maximum_indicative_loan: null,
    requested_loan: null,
    proposed_lvr: null,
    proposed_dscr: null,
    version: 1,
    archived_at: null,
    ...overrides,
  };
}

function renderAt(path: string) {
  // The template selector is a real query-backed component: it reads which
  // template is activated for this format. Rendering it for real is the point
  // — a stubbed selector would not prove the stage uses the platform's own.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <CommercialIndustrialWorkspace />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  assessment = null;
  create.mockReset().mockResolvedValue({ data: { id: 'a1' }, error: null });
  clientWorkspace.mockReset().mockResolvedValue({ data: { client: null, renders: [] }, error: null });
  generate.mockReset().mockResolvedValue(undefined);
  update.mockReset();
  saveNow.mockReset().mockResolvedValue(undefined);
  reload.mockReset().mockResolvedValue(undefined);
});

afterEach(cleanup);

describe('arriving at the workspace', () => {
  it('offers a choice rather than creating a record nobody asked for', async () => {
    renderAt('/calculators');
    expect(await screen.findByRole('heading', { name: /commercial & industrial analysis/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new analysis/i })).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('creates an analysis around a legacy property deep link', async () => {
    // `/calculators?domain=industrial&propertyId=…` has existed for a long
    // time; it must not dead-end.
    renderAt('/calculators?domain=industrial&propertyId=p1');
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({
      segment: 'industrial',
      assessmentType: 'industrial_investment',
    })));
  });

  it('starts one on request', async () => {
    renderAt('/calculators');
    fireEvent.click(await screen.findByRole('button', { name: /new analysis/i }));
    await waitFor(() => expect(create).toHaveBeenCalled());
  });
});

describe('an open analysis', () => {
  it('is one navigation model, from context to report', async () => {
    assessment = record();
    renderAt('/calculators?workspace=a1');

    const nav = await screen.findByRole('navigation', { name: /analysis stages/i });
    const stages = ['Context', 'Property', 'Income & lease', 'Ownership & portfolio',
      'Lending', 'Valuation', 'Forecast', 'Results', 'Report'];
    for (const label of stages) {
      // The step number is aria-hidden, so the accessible name is the label.
      expect(within(nav).getByRole('button', { name: label })).toBeInTheDocument();
    }
    // And exactly one place to run the calculation.
    expect(screen.getAllByRole('button', { name: /run calculation/i })).toHaveLength(1);
  });

  it('shows the analysis, the reference and the save state in one header', async () => {
    assessment = record({ title: '11 Example Street — acquisition' });
    renderAt('/calculators?workspace=a1');

    expect(await screen.findByRole('heading', { name: /11 example street — acquisition/i })).toBeInTheDocument();
    expect(screen.getAllByText(/CI-202608-AAAA/).length).toBeGreaterThan(0);
    expect(screen.getByText(/no client linked/i)).toBeInTheDocument();
    expect(screen.getByText('Saved')).toBeInTheDocument();
  });

  it('says the figures are live until a calculation is saved', async () => {
    assessment = record();
    renderAt('/calculators?workspace=a1');
    expect(await screen.findByText(/live working figures/i)).toBeInTheDocument();
  });

  it('marks a saved calculation out of date once the inputs move', async () => {
    const payload = emptyAssessmentPayload('commercial_investment');
    payload.loan.requestedLoan = 3_000_000;
    assessment = record({
      payload,
      current_calculation_id: 'run-1',
      // The run stored a different requested loan: the working data has moved.
      requested_loan: 2_000_000,
      status: 'completed',
    });
    renderAt('/calculators?workspace=a1');

    expect(await screen.findByText(/out of date/i)).toBeInTheDocument();
    expect(screen.getByText(/still states the earlier figures/i)).toBeInTheDocument();
  });
});

describe('the report stage', () => {
  it('refuses to generate without a saved calculation, and says why', async () => {
    assessment = record();
    renderAt('/calculators?workspace=a1&stage=report');

    const button = await screen.findByRole('button', { name: /generate report/i });
    expect(button).toBeDisabled();
    expect(screen.getByText(/no saved calculation/i)).toBeInTheDocument();
  });

  it('generates through the platform report path once the analysis is complete', async () => {
    assessment = record({ status: 'completed', current_calculation_id: 'run-1' });
    renderAt('/calculators?workspace=a1&stage=report');

    const button = await screen.findByRole('button', { name: /generate report/i });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    // The same hook the assessments list and the client tab use — not a second
    // renderer, and not a JSON download.
    await waitFor(() => expect(generate).toHaveBeenCalledWith('a1'));
  });

  it('names the template the document will use', async () => {
    assessment = record({ status: 'completed', current_calculation_id: 'run-1' });
    renderAt('/calculators?workspace=a1&stage=report');
    expect(await screen.findByText(/report template/i)).toBeInTheDocument();
  });

  it('says where the document is filed', async () => {
    assessment = record({ status: 'completed', current_calculation_id: 'run-1' });
    renderAt('/calculators?workspace=a1&stage=report');
    expect(await screen.findByText(/where the document is filed/i)).toBeInTheDocument();
    expect(screen.getByText(/link a client on this stage/i)).toBeInTheDocument();
  });
});

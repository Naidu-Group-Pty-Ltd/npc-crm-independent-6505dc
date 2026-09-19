/**
 * The client profile's Commercial / Industrial tab.
 *
 * What matters here: the tab shows the client's record whole (assessments,
 * reports, calculation history), offers Generate report under the same
 * completed-only rule as everywhere else, and is honest in its two empty
 * states — "nothing linked" is guidance, an error is an error with a retry.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const clientWorkspace = vi.fn();
const generate = vi.fn();

vi.mock('@/hooks/useCiAssessments', () => ({
  ciAssessmentApi: { clientWorkspace: (...args: unknown[]) => clientWorkspace(...args) },
}));
vi.mock('@/hooks/useCapacityReport', () => ({
  useCapacityReport: () => ({ generatingId: null, generate }),
}));
const navigate = vi.fn();
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual<typeof import('react-router-dom')>('react-router-dom')),
  useNavigate: () => navigate,
}));

const { ClientCommercialIndustrialTab } = await import('../ClientCommercialIndustrialTab');

const CLIENT_ID = 'c1a2b3c4-d5e6-4f70-8123-456789abcdef';

const WORKSPACE = {
  assessments: [
    {
      id: 'a-linked', user_id: 'u1', reference: 'CI-202608-AAAA', title: 'Foundry Link acquisition',
      status: 'linked', segment: 'industrial', assessment_type: 'industrial_investment',
      requested_loan: 4_095_000, maximum_indicative_loan: 3_055_219,
      proposed_lvr: 0.7, proposed_dscr: 0.93, outcome: 'outside_current_assumptions',
      binding_constraint: 'Debt service coverage ratio', current_calculation_id: 'run-1',
      linked_at: '2026-08-05T01:00:00.000Z', created_at: '2026-08-01T00:00:00.000Z',
      updated_at: '2026-08-05T01:00:00.000Z', archived_at: null,
    },
    {
      id: 'a-draft', user_id: 'u1', reference: 'CI-202608-BBBB', title: 'Retail strata draft',
      status: 'data_entry', segment: 'commercial', assessment_type: 'commercial_investment',
      requested_loan: null, maximum_indicative_loan: null, proposed_lvr: null, proposed_dscr: null,
      outcome: null, binding_constraint: null, current_calculation_id: null,
      linked_at: null, created_at: '2026-08-02T00:00:00.000Z',
      updated_at: '2026-08-02T00:00:00.000Z', archived_at: null,
    },
  ],
  runs: [{
    id: 'run-1', assessment_id: 'a-linked', scenario_key: 'base',
    outcome: 'outside_current_assumptions', binding_constraint: 'Debt service coverage ratio',
    maximum_indicative_loan: 3_055_219, engine_version: '1.0.0', policy_version: '1.0.0',
    created_at: '2026-08-05T00:30:00.000Z',
  }],
  renders: [{
    id: 'render-1', assessment_id: 'a-linked', status: 'succeeded',
    file_name: 'Commercial_Capacity_Report_CI_202608_AAAA_2026-08-05.pdf',
    page_count: 17, bytes: 84_000, has_analysis: true, analysis_note: null,
    created_at: '2026-08-05T01:10:00.000Z',
  }],
  links: [{ id: 'link-1', assessment_id: 'a-linked', linked_at: '2026-08-05T01:00:00.000Z', unlinked_at: null, applied_changes: [] }],
  uploads: [
    {
      assessmentId: 'a-linked', name: 'Intake pack workbook', source: 'document_import',
      fields: 218, capturedAt: '2026-08-04T22:00:57.000Z',
    },
    {
      assessmentId: 'a-linked', name: 'Contract of sale.pdf', source: 'document_import',
      fields: 3, capturedAt: '2026-08-04T22:30:00.000Z',
    },
  ],
};

beforeEach(() => {
  clientWorkspace.mockReset().mockResolvedValue({ data: WORKSPACE, error: null });
  generate.mockReset().mockResolvedValue(undefined);
  navigate.mockReset();
});

afterEach(cleanup);

function renderTab() {
  // The card header now carries the template chooser for this format, so the
  // tab reads the selection through react-query. Retries off: a failed read in
  // a test should surface immediately rather than be retried three times.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ClientCommercialIndustrialTab clientId={CLIENT_ID} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('the client Commercial / Industrial tab', () => {
  it('loads the client workspace and shows the record whole', async () => {
    renderTab();

    expect((await screen.findAllByText('Foundry Link acquisition')).length).toBeGreaterThan(0);
    expect(clientWorkspace).toHaveBeenCalledWith(CLIENT_ID);

    // Assessments, reports and calculation history all on one tab.
    expect(screen.getByText(/Linked assessments \(2\)/)).toBeInTheDocument();
    expect(screen.getByText(/Capacity reports \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/Commercial_Capacity_Report_CI_202608_AAAA_2026-08-05\.pdf/)).toBeInTheDocument();
    expect(screen.getByText(/v1\.0\.0 \/ 1\.0\.0/)).toBeInTheDocument();
  });

  it('offers Generate report only on a reportable assessment', async () => {
    renderTab();
    await screen.findAllByText('Foundry Link acquisition');

    // The linked assessment gets the action; the draft does not — absent, not
    // disabled, the same presentation rule as the assessments list.
    expect(screen.getByRole('button', { name: /generate the capacity report for foundry link acquisition/i }))
      .toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /generate the capacity report for retail strata draft/i }))
      .toBeNull();
  });

  it('generates and then reloads, so the reports table shows the new render', async () => {
    renderTab();
    await screen.findAllByText('Foundry Link acquisition');

    fireEvent.click(screen.getByRole('button', { name: /generate the capacity report for foundry link acquisition/i }));

    await waitFor(() => expect(generate).toHaveBeenCalledWith('a-linked'));
    // One load on mount, one after the render completes.
    await waitFor(() => expect(clientWorkspace).toHaveBeenCalledTimes(2));
  });

  it('says what to do when nothing is linked yet', async () => {
    clientWorkspace.mockResolvedValue({
      data: { assessments: [], runs: [], renders: [], links: [] },
      error: null,
    });
    renderTab();

    expect(await screen.findByText(/no commercial & industrial assessments linked/i)).toBeInTheDocument();
    // Guidance, not a dead end: it names where linking happens and offers the way there.
    expect(screen.getByText(/final step of the assessment workspace/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open commercial \/ industrial/i })).toBeInTheDocument();
  });

  it('shows what was read into the assessments, and where it came from', async () => {
    renderTab();
    await screen.findAllByText('Foundry Link acquisition');

    expect(screen.getByText(/uploaded information \(2\)/i)).toBeInTheDocument();
    expect(screen.getByText('Intake pack workbook')).toBeInTheDocument();
    expect(screen.getByText('Contract of sale.pdf')).toBeInTheDocument();
    expect(screen.getByText('218')).toBeInTheDocument();
    // And it does not imply a download that does not exist: the pack is read
    // in the browser and only its values are kept.
    expect(screen.getByText(/read in the browser and are not\s+stored/i)).toBeInTheDocument();
  });

  it('says plainly when nothing has been imported', async () => {
    clientWorkspace.mockResolvedValue({ data: { ...WORKSPACE, uploads: [] }, error: null });
    renderTab();
    await screen.findAllByText('Foundry Link acquisition');
    expect(screen.getByText(/nothing has been imported into these assessments/i)).toBeInTheDocument();
  });

  it('names the assessment that belongs to this client but was never linked', async () => {
    // The reported symptom: a client created from an assessment minutes
    // earlier, and a tab that said "No Commercial & Industrial assessments
    // linked" — true, and useless.
    clientWorkspace.mockResolvedValue({
      data: {
        assessments: [], runs: [], renders: [], links: [], uploads: [],
        candidates: [{
          id: 'a-unlinked', reference: 'CI-202608-TS6PK', title: 'Test',
          status: 'completed', segment: 'commercial',
          requested_loan: 4_095_000, maximum_indicative_loan: 3_055_219,
          updated_at: '2026-08-05T18:04:55.000Z',
        }],
      },
      error: null,
    });
    renderTab();

    expect(await screen.findByText(/not linked yet \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText('Test')).toBeInTheDocument();
    expect(screen.getByText(/CI-202608-TS6PK/)).toBeInTheDocument();
    // And an action, on the step where linking actually happens.
    fireEvent.click(screen.getByRole('button', { name: /link this assessment/i }));
    expect(navigate).toHaveBeenCalledWith('/commercial/assessments/a-unlinked?step=link');
  });

  it('shows the prompt above the linked records when there are both', async () => {
    clientWorkspace.mockResolvedValue({
      data: {
        ...WORKSPACE,
        candidates: [{
          id: 'a-unlinked', reference: 'CI-202608-ZZZZ', title: 'Second site',
          status: 'completed', segment: 'industrial',
          requested_loan: null, maximum_indicative_loan: null,
          updated_at: '2026-08-05T18:04:55.000Z',
        }],
      },
      error: null,
    });
    renderTab();

    const prompt = await screen.findByText(/not linked yet \(1\)/i);
    const linked = screen.getByText(/linked assessments \(2\)/i);
    expect(prompt.compareDocumentPosition(linked) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows an error as an error, with a retry', async () => {
    clientWorkspace
      .mockResolvedValueOnce({ data: null, error: 'Client not found' })
      .mockResolvedValueOnce({ data: WORKSPACE, error: null });
    renderTab();

    expect(await screen.findByText('Client not found')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect((await screen.findAllByText('Foundry Link acquisition')).length).toBeGreaterThan(0);
  });
});

describe('the tab registration', () => {
  it('is in the client workspace registry, after Borrowing Capacity', async () => {
    const { CLIENT_TABS } = await import('../clientWorkspaceRegistry');
    const values = CLIENT_TABS.map((tab) => tab.value);
    const index = values.indexOf('commercial-industrial');

    expect(index).toBeGreaterThan(-1);
    expect(values[index - 1]).toBe('borrowing');
    expect(CLIENT_TABS[index].capability).toBe('client.commercial_industrial');
  });

  it('is gated by the same entitlement as the module itself', async () => {
    const { CAPABILITY_DEFINITIONS } = await import('@/lib/entitlements/registry');
    const definition = CAPABILITY_DEFINITIONS.find((d) => d.key === 'client.commercial_industrial');
    const module = CAPABILITY_DEFINITIONS.find((d) => d.key === 'module.commercial_industrial');

    // The tab must never appear in a workspace whose plan cannot open what it
    // links to.
    expect(definition?.addonSlugs).toEqual(module?.addonSlugs);
    expect(definition?.includedInPlans).toEqual(module?.includedInPlans);
  });
});

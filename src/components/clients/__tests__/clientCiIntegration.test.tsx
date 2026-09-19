/**
 * The join between a Commercial & Industrial assessment and its client.
 *
 * Three things were missing once an assessment was linked, and each one made
 * the link look like it had not happened:
 *
 *  - nothing in the module could reach the client. "Open client" led to the
 *    client *list*, which is a search box, not this client's file.
 *  - the client's Overview — the page anyone opens first — said nothing about
 *    a $4m industrial purchase sitting one tab away.
 *  - the C&I tab listed calculations and reports but not what had been
 *    imported into them, so the intake pack's work was invisible.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { clientCommercialIndustrialPath, CLIENT_CI_TAB } from '@/lib/ciAssessment/clientRoute';

const clientWorkspace = vi.fn();
vi.mock('@/hooks/useCiAssessments', () => ({
  ciAssessmentApi: { clientWorkspace: (...args: unknown[]) => clientWorkspace(...args) },
}));

const { ClientCommercialIndustrialSnapshot } = await import('../ClientCommercialIndustrialSnapshot');

const CLIENT_ID = 'c1a2b3c4-d5e6-4f70-8123-456789abcdef';

const ASSESSMENT = {
  id: 'a-linked', user_id: 'u1', reference: 'CI-202608-TS6PK', title: 'Foundry Link acquisition',
  status: 'linked', segment: 'industrial', assessment_type: 'industrial_investment',
  requested_loan: 4_095_000, maximum_indicative_loan: 3_055_219,
  proposed_lvr: 0.7, proposed_dscr: 0.93, outcome: 'outside_current_assumptions',
  binding_constraint: 'Debt service coverage ratio', current_calculation_id: 'run-1',
  linked_at: '2026-08-05T01:00:00.000Z', created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-05T01:00:00.000Z', archived_at: null,
};

beforeEach(() => {
  clientWorkspace.mockReset().mockResolvedValue({
    data: {
      client: {
        id: CLIENT_ID, primary_first_name: 'Olivia', primary_surname: 'Bennett',
        primary_email: 'olivia@example.test', primary_mobile: null,
      },
      assessments: [ASSESSMENT],
      runs: [],
      renders: [{
        id: 'r1', assessment_id: 'a-linked', status: 'succeeded', file_name: 'report.pdf',
        page_count: 20, bytes: 90_000, has_analysis: true, analysis_note: null,
        created_at: '2026-08-05T02:00:00.000Z',
      }],
      links: [],
      uploads: [],
    },
    error: null,
  });
});

afterEach(cleanup);

describe('where a client’s Commercial / Industrial file lives', () => {
  it('is that client, on that tab — never the client list', () => {
    const path = clientCommercialIndustrialPath(CLIENT_ID);
    expect(path).toContain(`clientId=${CLIENT_ID}`);
    expect(path).toContain(`tab=${CLIENT_CI_TAB}`);
    // The Command Centre's deep-link effect reads exactly these two params.
    expect(path.startsWith('/clients?')).toBe(true);
  });

  it('escapes what it is given rather than trusting it', () => {
    expect(clientCommercialIndustrialPath('a b&c=d')).toContain('clientId=a%20b%26c%3Dd');
  });
});

describe('the Overview snapshot', () => {
  it('says where the client is up to, with the figures', async () => {
    render(<ClientCommercialIndustrialSnapshot clientId={CLIENT_ID} onOpenTab={() => {}} />);

    expect(await screen.findByText('Foundry Link acquisition')).toBeInTheDocument();
    expect(screen.getByText('CI-202608-TS6PK')).toBeInTheDocument();
    expect(screen.getByText('$4,095,000')).toBeInTheDocument();
    expect(screen.getByText('$3,055,219')).toBeInTheDocument();
    expect(screen.getByText(/bound by debt service coverage ratio/i)).toBeInTheDocument();
    expect(screen.getByText(/1 capacity report generated/i)).toBeInTheDocument();
  });

  it('opens the tab holding the detail rather than duplicating it', async () => {
    const onOpenTab = vi.fn();
    render(<ClientCommercialIndustrialSnapshot clientId={CLIENT_ID} onOpenTab={onOpenTab} />);
    (await screen.findByRole('button', { name: /view all/i })).click();
    expect(onOpenTab).toHaveBeenCalled();
  });

  it('renders nothing at all for a client with no assessments', async () => {
    clientWorkspace.mockResolvedValue({ data: { assessments: [], runs: [], renders: [], links: [] }, error: null });
    const { container } = render(<ClientCommercialIndustrialSnapshot clientId={CLIENT_ID} onOpenTab={() => {}} />);
    await waitFor(() => expect(clientWorkspace).toHaveBeenCalled());
    // An Overview that shows an empty state for every unused module is a page
    // of empty states.
    expect(container).toBeEmptyDOMElement();
  });

  it('stays silent when the module cannot be read', async () => {
    clientWorkspace.mockResolvedValue({ data: null, error: 'Assessment request failed' });
    const { container } = render(<ClientCommercialIndustrialSnapshot clientId={CLIENT_ID} onOpenTab={() => {}} />);
    await waitFor(() => expect(clientWorkspace).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});

describe('the Overview snapshot, before anything is linked', () => {
  it('says an assessment is waiting rather than showing nothing', async () => {
    clientWorkspace.mockResolvedValue({
      data: {
        assessments: [], runs: [], renders: [], links: [], uploads: [],
        candidates: [{
          id: 'a-unlinked', reference: 'CI-202608-TS6PK', title: 'Test',
          status: 'completed', segment: 'commercial',
          requested_loan: null, maximum_indicative_loan: null,
          updated_at: '2026-08-05T18:04:55.000Z',
        }],
      },
      error: null,
    });
    render(<ClientCommercialIndustrialSnapshot clientId={CLIENT_ID} onOpenTab={() => {}} />);

    expect(await screen.findByText(/started for this client but not linked yet/i)).toBeInTheDocument();
  });
});

describe('the linked step', () => {
  it('names the client and offers their file, not the client list', async () => {
    vi.resetModules();
    vi.doMock('@/hooks/useCiAssessments', () => ({
      ciAssessmentApi: {
        clientWorkspace: (...args: unknown[]) => clientWorkspace(...args),
        searchClients: vi.fn().mockResolvedValue({ data: [], error: null }),
        linkClient: vi.fn(),
        unlinkClient: vi.fn(),
        createClient: vi.fn(),
      },
    }));
    vi.doMock('@/utils/commercial/clientPortfolioRepository', () => ({
      fetchClientProfile: vi.fn().mockResolvedValue({ client: null, properties: [], liabilities: [] }),
    }));
    const { StepClientLink } = await import('@/components/commercial/assessment/StepClientLink');
    const { baseAssessment } = await import('@/lib/ciAssessment/__tests__/fixtures');

    render(
      <MemoryRouter>
        <StepClientLink
          assessmentId="4f2c9a1e-8b7d-4c3a-9e51-2d6f8a0b1c34"
          payload={baseAssessment()}
          linkedClientId={CLIENT_ID}
          onLinked={() => {}}
          canLink
          canUpdateClient
        />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/this assessment is linked to olivia bennett/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open client/i })).toBeInTheDocument();
    // Unlinking stays available beside it — the panel gained an action, it did
    // not replace one.
    expect(screen.getByRole('button', { name: /unlink from client/i })).toBeInTheDocument();
    vi.doUnmock('@/utils/commercial/clientPortfolioRepository');
  });
});

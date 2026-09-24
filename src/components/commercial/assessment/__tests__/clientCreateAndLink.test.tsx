/**
 * Creating a client from the Save & link step, and what feeds the form.
 *
 * The rule under test: nothing reaches the client record the user did not see
 * on screen. The prefill is a *suggestion* drawn from the assessment; the
 * record is created from the form's state at the moment of submission, and the
 * new client then flows into the exact reconciliation-and-link path an
 * existing client takes. One path, not two — a client created here must not
 * skip the reconciliation an existing client would get.
 *
 * The identity confirmation is the single exception, and it is a considered
 * one: a client created from this form cannot be the wrong record, and leaving
 * that step in the way left users two unexplained clicks short of a link — a
 * client created out of the workflow with no assessment attached to it, which
 * is exactly what was reported. Reconciliation still runs, and linking still
 * takes an explicit action and its own dialog.
 *
 * Since the September 2026 audit, three more rules:
 *
 *  - **Both names, before the server is asked.** `clients` stores both as NOT
 *    NULL; a single name used to be accepted and then fail as a 500.
 *  - **A duplicate is offered, not merely refused.** Possible matches are shown
 *    as the name is typed, and an email already on file comes back as that
 *    client — where the adviser may reach them — with "Use this client".
 *  - **The client the assessment was prepared for is waiting.** Named when the
 *    assessment was started, or created from its intake step: the adviser does
 *    not search for somebody they already chose.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { baseAssessment } from '@/lib/ciAssessment/__tests__/fixtures';
import type { AssessmentPayload } from '@/lib/ciAssessment/types';

const searchClients = vi.fn();
const createClient = vi.fn();
const intendedClient = vi.fn();
const toast = vi.fn();

vi.mock('@/hooks/useCiAssessments', () => ({
  ciAssessmentApi: {
    searchClients: (...args: unknown[]) => searchClients(...args),
    linkClient: vi.fn(),
    unlinkClient: vi.fn(),
    clientWorkspace: vi.fn().mockResolvedValue({ data: null, error: null }),
  },
}));
vi.mock('@/lib/ciAssessment/assessmentManagement', () => ({
  createClient: (...args: unknown[]) => createClient(...args),
  searchClients: (...args: unknown[]) => searchClients(...args),
  intendedClient: (...args: unknown[]) => intendedClient(...args),
}));
vi.mock('@/hooks/use-toast', () => ({ toast: (...args: unknown[]) => toast(...args) }));
const fetchClientProfile = vi.fn();
vi.mock('@/utils/commercial/clientPortfolioRepository', () => ({
  fetchClientProfile: (...args: unknown[]) => fetchClientProfile(...args),
}));

const { StepClientLink } = await import('../StepClientLink');
const { prefillFromAssessment } = await import('../clientPrefill');

const ASSESSMENT_ID = '4f2c9a1e-8b7d-4c3a-9e51-2d6f8a0b1c34';

const NEW_CLIENT = {
  id: 'c1a2b3c4-d5e6-4f70-8123-456789abcdef',
  primary_first_name: 'Marcus',
  primary_surname: 'Chen',
  primary_email: 'marcus@example.test',
  primary_mobile: '0400 000 000',
  updated_at: '2026-08-05T00:00:00.000Z',
};

const EXISTING_CLIENT = {
  id: 'e1a2b3c4-d5e6-4f70-8123-456789abcdef',
  primary_first_name: 'Marcus',
  primary_surname: 'Chen',
  primary_email: 'marcus.chen@example.test',
  primary_mobile: '0411 111 111',
  updated_at: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  // The shape `reconcileAssessmentWithClient` reads: a brand-new client with
  // nothing on file, which is exactly what creating one here produces.
  fetchClientProfile.mockReset().mockResolvedValue({
    clientId: NEW_CLIENT.id,
    clientName: 'Marcus Chen',
    residentialAssets: [],
    commercialAssets: [],
    industrialAssets: [],
    liabilities: {},
    existingLoans: {},
    businessFinancials: {},
  });
  searchClients.mockReset().mockResolvedValue({ data: [], error: null });
  createClient.mockReset().mockResolvedValue({ data: NEW_CLIENT, error: null, existingClient: null });
  intendedClient.mockReset().mockResolvedValue({ data: null, error: null });
  toast.mockReset();
});

afterEach(cleanup);

function renderStep(payload: AssessmentPayload = baseAssessment()) {
  return render(
    <MemoryRouter>
      <StepClientLink
        assessmentId={ASSESSMENT_ID}
        payload={payload}
        linkedClientId={null}
        onLinked={() => {}}
        canLink
        canUpdateClient
      />
    </MemoryRouter>,
  );
}

async function openCreateForm() {
  fireEvent.click(await screen.findByRole('button', { name: /create a new client instead/i }));
}

function typeName(first: string, surname: string) {
  fireEvent.change(screen.getByLabelText('First name'), { target: { value: first } });
  fireEvent.change(screen.getByLabelText('Surname'), { target: { value: surname } });
}

describe('prefillFromAssessment', () => {
  it('prefers the first named director — a person, not a company', () => {
    const payload = baseAssessment();
    payload.ownership.entities[0].directors = 'Marcus Chen; Priya Nair';
    expect(prefillFromAssessment(payload)).toEqual({ firstName: 'Marcus', surname: 'Chen' });
  });

  it('falls back to the entity name when no director is recorded', () => {
    const payload = baseAssessment();
    payload.ownership.entities[0].directors = '';
    payload.ownership.entities[0].entityName = 'Asteron Industrial Holdings Pty Ltd';
    // Wrong-but-visible beats empty: the adviser sees it in the form and
    // corrects it, rather than leaving the workflow to create the client.
    expect(prefillFromAssessment(payload).surname).toContain('Industrial');
  });

  it('returns empties for an assessment with no ownership data', () => {
    const payload = baseAssessment();
    payload.ownership.entities = [];
    expect(prefillFromAssessment(payload)).toEqual({ firstName: '', surname: '' });
  });
});

describe('creating a client from the linking step', () => {
  it('offers creation beside the search, not instead of it', async () => {
    renderStep();
    expect(await screen.findByRole('button', { name: /create a new client instead/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/search your clients/i)).toBeInTheDocument();
  });

  it('puts creating beside the search rather than under the results', async () => {
    // A book of any size pushed this button under a long scrolling list of
    // clients — below where the person who could not find their client had
    // already stopped reading. Searching and creating answer the same
    // question, so they are offered together, above the results.
    renderStep();
    const create = await screen.findByRole('button', { name: /create a new client instead/i });
    const search = screen.getByLabelText(/search your clients/i);
    const results = await screen.findByText(/type at least two characters/i);

    expect(search.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(create.compareDocumentPosition(results) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('creates from the form state and hands the client to the normal flow', async () => {
    renderStep();
    await openCreateForm();

    typeName('Marcus', 'Chen');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'marcus@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: /^create client$/i }));

    await waitFor(() => expect(createClient).toHaveBeenCalledWith({
      firstName: 'Marcus',
      surname: 'Chen',
      email: 'marcus@example.test',
      mobile: undefined,
      // The audit trail records that this client came out of a finance workflow.
      assessmentId: ASSESSMENT_ID,
    }));

    // The new client lands on the reconciliation, with the link action for
    // that named client — creation does not skip reconciliation, and it does
    // not link anything by itself.
    expect(await screen.findByText(/reconcile against the client record/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /link to marcus chen/i })).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('reconciles the new client against what is on file, as it would an existing one', async () => {
    renderStep();
    await openCreateForm();
    typeName('Marcus', 'Chen');
    fireEvent.click(screen.getByRole('button', { name: /^create client$/i }));

    // The same portfolio read a searched-for client gets — a new client simply
    // has nothing on file, which the reconciliation states rather than skips.
    await waitFor(() => expect(fetchClientProfile).toHaveBeenCalledWith(NEW_CLIENT.id));
  });

  it('asks for both names before the server is asked — the table stores both', async () => {
    renderStep();
    await openCreateForm();
    typeName('Marcus', '  ');
    fireEvent.click(screen.getByRole('button', { name: /^create client$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/first name and a surname are both required/i);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('says in its own words why the server refused, and keeps the form open', async () => {
    createClient.mockResolvedValue({
      data: null,
      error: 'A client with this email address is already in the client book, but not one assigned to you.',
      code: 'DUPLICATE_EMAIL_UNREACHABLE',
      existingClient: null,
    });
    renderStep();
    await openCreateForm();
    typeName('Marcus', 'Chen');
    fireEvent.click(screen.getByRole('button', { name: /^create client$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/not one assigned to you/i);
    expect(screen.getByLabelText('First name')).toBeInTheDocument();
  });

  it('offers the existing record when the email is already on file', async () => {
    createClient.mockResolvedValue({
      data: null,
      error: 'A client with this email address already exists. Use their existing record instead.',
      code: 'DUPLICATE_EMAIL',
      existingClient: EXISTING_CLIENT,
    });
    renderStep();
    await openCreateForm();
    typeName('Marcus', 'Chen');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'marcus.chen@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: /^create client$/i }));

    expect(await screen.findByText(/already in your client book/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /use this client/i }));

    // An existing record is confirmed like any search result — it could be
    // somebody else with the same address on file.
    expect(await screen.findByText(/confirm this is the right client/i)).toBeInTheDocument();
    expect(screen.getByText('marcus.chen@example.test')).toBeInTheDocument();
    expect(fetchClientProfile).not.toHaveBeenCalled();
  });

  it('shows a possible match by name before a duplicate is created', async () => {
    searchClients.mockResolvedValue({ data: [EXISTING_CLIENT], error: null });
    renderStep();
    await openCreateForm();
    typeName('Marcus', 'Chen');

    expect(await screen.findByText(/possibly already in your client book/i, {}, { timeout: 2000 })).toBeInTheDocument();
    expect(searchClients).toHaveBeenCalledWith('Marcus Chen');
    // Still possible — a namesake is not the same person — but said plainly.
    expect(screen.getByRole('button', { name: /create a new client anyway/i })).toBeInTheDocument();
  });

  it('prefills the form from the assessment ownership data', async () => {
    const payload = baseAssessment();
    payload.ownership.entities[0].directors = 'Priya Nair';
    renderStep(payload);
    await openCreateForm();

    expect((screen.getByLabelText('First name') as HTMLInputElement).value).toBe('Priya');
    expect((screen.getByLabelText('Surname') as HTMLInputElement).value).toBe('Nair');
  });
});

describe('the client the assessment was prepared for', () => {
  it('is waiting on the final step when chosen at the start — and still confirmed', async () => {
    intendedClient.mockResolvedValue({
      data: { clientId: EXISTING_CLIENT.id, source: 'intended', recordedAt: '', client: EXISTING_CLIENT },
      error: null,
    });
    renderStep();

    expect(await screen.findByText(/was started for marcus chen/i)).toBeInTheDocument();
    expect(screen.getByText(/confirm this is the right client/i)).toBeInTheDocument();
    expect(intendedClient).toHaveBeenCalledWith(ASSESSMENT_ID);
  });

  it('goes straight to reconciliation when the client was created from this assessment', async () => {
    intendedClient.mockResolvedValue({
      data: { clientId: NEW_CLIENT.id, source: 'created', recordedAt: '', client: NEW_CLIENT },
      error: null,
    });
    renderStep();

    await waitFor(() => expect(fetchClientProfile).toHaveBeenCalledWith(NEW_CLIENT.id));
    expect(await screen.findByRole('button', { name: /link to marcus chen/i })).toBeInTheDocument();
    expect(screen.getByText(/was created from this assessment/i)).toBeInTheDocument();
  });
});

describe('what the reconciliation claims', () => {
  it('never says it writes to the client record — nothing applies the choices', async () => {
    // `link_client` stores the decision set and touches no client table; the
    // screen used to say the items were "recorded against the client record".
    renderStep();
    await openCreateForm();
    typeName('Marcus', 'Chen');
    fireEvent.click(screen.getByRole('button', { name: /^create client$/i }));

    expect(await screen.findByText(/nothing on the client record is changed automatically/i)).toBeInTheDocument();
    expect(screen.queryByText(/recorded against the client record/i)).toBeNull();
  });
});

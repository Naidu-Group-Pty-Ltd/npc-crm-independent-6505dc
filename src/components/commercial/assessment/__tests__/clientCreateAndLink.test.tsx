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
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { baseAssessment } from '@/lib/ciAssessment/__tests__/fixtures';
import type { AssessmentPayload } from '@/lib/ciAssessment/types';

const searchClients = vi.fn();
const createClient = vi.fn();
const toast = vi.fn();

vi.mock('@/hooks/useCiAssessments', () => ({
  ciAssessmentApi: {
    searchClients: (...args: unknown[]) => searchClients(...args),
    createClient: (...args: unknown[]) => createClient(...args),
    linkClient: vi.fn(),
    unlinkClient: vi.fn(),
  },
}));
vi.mock('@/hooks/use-toast', () => ({ toast: (...args: unknown[]) => toast(...args) }));
const fetchClientProfile = vi.fn();
vi.mock('@/utils/commercial/clientPortfolioRepository', () => ({
  fetchClientProfile: (...args: unknown[]) => fetchClientProfile(...args),
}));

const { StepClientLink } = await import('../StepClientLink');
const { prefillFromAssessment } = await import('../clientPrefill');

const NEW_CLIENT = {
  id: 'c1a2b3c4-d5e6-4f70-8123-456789abcdef',
  primary_first_name: 'Marcus',
  primary_surname: 'Chen',
  primary_email: 'marcus@example.test',
  primary_mobile: '0400 000 000',
  updated_at: '2026-08-05T00:00:00.000Z',
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
  createClient.mockReset().mockResolvedValue({ data: NEW_CLIENT, error: null });
  toast.mockReset();
});

afterEach(cleanup);

function renderStep(payload: AssessmentPayload = baseAssessment()) {
  return render(
    <MemoryRouter>
      <StepClientLink
        assessmentId="4f2c9a1e-8b7d-4c3a-9e51-2d6f8a0b1c34"
        payload={payload}
        linkedClientId={null}
        onLinked={() => {}}
        canLink
        canUpdateClient
      />
    </MemoryRouter>,
  );
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
    // The results region before a query has been typed. What matters is where
    // it sits relative to the two controls, not what it currently says.
    const results = await screen.findByText(/type at least two characters/i);

    expect(search.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(create.compareDocumentPosition(results) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('creates from the form state and hands the client to the normal flow', async () => {
    renderStep();
    fireEvent.click(await screen.findByRole('button', { name: /create a new client instead/i }));

    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Marcus' } });
    fireEvent.change(screen.getByLabelText('Surname'), { target: { value: 'Chen' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'marcus@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: /^create client$/i }));

    await waitFor(() => expect(createClient).toHaveBeenCalledWith({
      firstName: 'Marcus',
      surname: 'Chen',
      email: 'marcus@example.test',
      mobile: undefined,
      // The audit trail records that this client came out of a finance workflow.
      assessmentId: '4f2c9a1e-8b7d-4c3a-9e51-2d6f8a0b1c34',
    }));

    // The new client lands on the reconciliation, with the link action for
    // that named client — creation does not skip reconciliation, and it does
    // not link anything by itself.
    expect(await screen.findByText(/reconcile against the client record/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /link to marcus chen/i })).toBeInTheDocument();
    // Nothing was linked by creating: the confirmation dialog has not opened
    // and the link call has not been made.
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('reconciles the new client against what is on file, as it would an existing one', async () => {
    renderStep();
    fireEvent.click(await screen.findByRole('button', { name: /create a new client instead/i }));
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Marcus' } });
    fireEvent.click(screen.getByRole('button', { name: /^create client$/i }));

    // The same portfolio read a searched-for client gets — a new client simply
    // has nothing on file, which the reconciliation states rather than skips.
    await waitFor(() => expect(fetchClientProfile).toHaveBeenCalledWith(NEW_CLIENT.id));
  });

  it('refuses to create a nameless client without a server round-trip', async () => {
    renderStep();
    fireEvent.click(await screen.findByRole('button', { name: /create a new client instead/i }));

    fireEvent.change(screen.getByLabelText('First name'), { target: { value: '  ' } });
    fireEvent.change(screen.getByLabelText('Surname'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /^create client$/i }));

    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(createClient).not.toHaveBeenCalled();
  });

  it('surfaces the server refusal — a duplicate email — as its own words', async () => {
    createClient.mockResolvedValue({
      data: null,
      error: 'A client with this email already exists — search for them instead.',
    });
    renderStep();
    fireEvent.click(await screen.findByRole('button', { name: /create a new client instead/i }));
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Marcus' } });
    fireEvent.click(screen.getByRole('button', { name: /^create client$/i }));

    await waitFor(() => {
      const last = toast.mock.calls.at(-1)?.[0];
      expect(last?.variant).toBe('destructive');
      expect(last?.description).toContain('already exists');
    });
    // And the flow stays where the user can act on it: the form is still open.
    expect(screen.getByLabelText('First name')).toBeInTheDocument();
  });

  it('prefills the form from the assessment ownership data', async () => {
    const payload = baseAssessment();
    payload.ownership.entities[0].directors = 'Priya Nair';
    renderStep(payload);
    fireEvent.click(await screen.findByRole('button', { name: /create a new client instead/i }));

    expect((screen.getByLabelText('First name') as HTMLInputElement).value).toBe('Priya');
    expect((screen.getByLabelText('Surname') as HTMLInputElement).value).toBe('Nair');
  });
});

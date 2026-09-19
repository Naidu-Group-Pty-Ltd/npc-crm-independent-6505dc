/**
 * The Passport workspace — presentation states and the dark-launch contract.
 *
 * Resolved-path rendering only. The flag-off contract — with the flag off the
 * workspace renders NOTHING, so the AML module behaves exactly as it did before
 * the Passport existed — is pinned on `passportSurfaceState` in
 * loadState.test.ts, for the reason recorded beside the mocks below.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPassportView, type PassportViewInput } from '@/lib/aml/passport';
import { PassportWorkspace } from './PassportWorkspace';

const getPassportView = vi.fn();

vi.mock('@/hooks/useAmlAccess', () => ({
  useAmlAccess: () => ({
    roles: new Set(['mlro']), isMlro: true, canWrite: true,
    flagEnabled: true, loading: false, capabilities: new Set(['aml.view']),
  }),
}));

vi.mock('@/lib/aml/amlRelianceApi', () => ({
  amlRelianceApi: { getPassportView: (...a: unknown[]) => getPassportView(...a) },
}));

// Heavy children are stubbed: this suite asserts the shell, not its children.
//
// The flag-off and error branches are NOT asserted here. A mocked rejection
// inside this component graph is mis-attributed as an unhandled error by the
// runner even when demonstrably caught (the same quirk PortalPassport hit), so
// those two branches are pinned directly on `passportSurfaceState` in
// loadState.test.ts instead — where they can be asserted exhaustively.
vi.mock('../PassportControls', () => ({ PassportControls: () => <div data-testid="controls" /> }));
vi.mock('./PassportBooklet', () => ({ PassportBooklet: () => <div data-testid="booklet" /> }));

function commandView() {
  const input: PassportViewInput = {
    issuer_org: 'Test Org',
    officer_label: 'P. Naidu · MLRO',
    case: {
      id: 'c1', case_reference: 'AML-2026-0001', subject_display_name: 'Meridian Coast Holdings',
      subject_type: 'entity', status: 'cleared', case_stage: 'cleared',
      service_gate_status: 'approved', opened_at: '2026-08-01T00:00:00Z', closed_at: null,
    },
    attestations: [{ version: 1, issued_at: '2026-08-05T00:00:00Z', superseded_at: null, payload_sha256: 'a'.repeat(64), schema_version: 2 }],
    material_inputs_current: true,
    open_refresh_obligations: 0,
    personal_details: { full_name: 'Daniel Okafor', occupation: 'Director' },
    entity_details: null,
    documents: [],
    transactions: [],
    screening: { subjects: [], pep_result: null, pep_determined_at: null, list_freshness: {} },
    funding: { sof: [], sow: [], edd: [] },
    partners: [],
    events: [],
    client_requests: [],
    stamp_input: {
      issuer_org: 'Test Org',
      attestations: [{ version: 1, issued_at: '2026-08-05T00:00:00Z', superseded_at: null }],
      consents: [{ id: 'c', kind: 'privacy', accepted_at: '2026-08-01T00:00:00Z' }],
      verification_checks: [], documents: [], screening_subjects: [], owners: [],
      source_of_funds: [], source_of_wealth: [], edd_cases: [], grants: [],
      assessments: [], refresh_obligations: [], transactions: [],
    },
  };
  return buildPassportView('command', input);
}

beforeEach(() => getPassportView.mockReset());

describe('PassportWorkspace', () => {


  it('renders the identity strip from the projection', async () => {
    getPassportView.mockResolvedValue({ passport: commandView() });
    render(<PassportWorkspace caseId="c1" />);
    expect(await screen.findByRole('heading', { name: 'Meridian Coast Holdings' })).toBeInTheDocument();
    expect(screen.getByText('AUX-AML-2026-0001-V1')).toBeInTheDocument();
  });

  it('shows the customer’s own passport cover in the record, not a placeholder', async () => {
    // The record shows the document. This is the same `BookletCover` the
    // booklet opens on, scaled — so what a reader sees on the record and what
    // they see when they open it cannot disagree.
    getPassportView.mockResolvedValue({ passport: commandView() });
    const { container } = render(<PassportWorkspace caseId="c1" />);
    await screen.findByRole('heading', { name: 'Meridian Coast Holdings' });

    const cover = container.querySelector('.passport-cover-thumb');
    expect(cover).not.toBeNull();
    expect(cover!.querySelector('img')).toHaveAttribute('src', '/brand/aurixa-emblem.png');
    // Drawn from this customer's projection rather than fixed artwork.
    expect(cover).toHaveTextContent('Meridian Coast Holdings');
    // The placeholder it replaced.
    expect(container).not.toHaveTextContent('AUX·AML');
    // The control overlays the artwork rather than wrapping it: a <button>
    // may not contain the <section> of headings the board is.
    expect(cover!.querySelector('button')).toBeNull();
  });

  it('keeps “View digital passport” working from the cover and the button', async () => {
    getPassportView.mockResolvedValue({ passport: commandView() });
    render(<PassportWorkspace caseId="c1" />);
    await screen.findByRole('heading', { name: 'Meridian Coast Holdings' });
    expect(screen.queryByTestId('booklet')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'View the digital passport' }));
    expect(await screen.findByTestId('booklet')).toBeInTheDocument();
  });

  it('opens on the journey and navigates by the page rail', async () => {
    getPassportView.mockResolvedValue({ passport: commandView() });
    render(<PassportWorkspace caseId="c1" />);
    // 00 is the design's entry point — the journey the Passport is built from.
    expect(await screen.findByRole('heading', { name: 'AML/CTF Journey' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Verification/ }));
    expect(await screen.findByRole('heading', { name: 'Verification' })).toBeInTheDocument();
  });

  it('lists every design page in the rail, numbered as the design numbers them', async () => {
    getPassportView.mockResolvedValue({ passport: commandView() });
    render(<PassportWorkspace caseId="c1" />);
    await screen.findByRole('heading', { name: 'AML/CTF Journey' });
    const rail = screen.getByRole('navigation', { name: /passport pages/i });
    for (const n of ['00', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11']) {
      expect(rail).toHaveTextContent(n);
    }
  });
});

/**
 * Client Passport booklet — presentation states.
 *
 * The load-bearing assertions: flag-off shows only the quiet return path
 * (no passport content), a client view renders from the projection alone,
 * and nothing on any page names screening/funding/partner internals.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPassportView, type PassportViewInput } from '@/lib/aml/passport';
import PortalPassport from './PortalPassport';

const getPassport = vi.fn();
vi.mock('@/lib/aml/amlPortalApi', () => ({
  amlPortalApi: {
    getPassport: (...args: unknown[]) => getPassport(...args),
  },
}));

function clientView() {
  const input: PassportViewInput = {
    issuer_org: 'Naidu Property Consulting Services',
    officer_label: null,
    case: {
      id: 'c1', case_reference: 'AML-2026-0002', subject_display_name: 'Jordan Client',
      subject_type: 'individual', status: 'cleared', case_stage: 'cleared',
      service_gate_status: 'approved', opened_at: '2026-08-01T00:00:00Z', closed_at: null,
    },
    attestations: [{ version: 1, issued_at: '2026-08-05T00:00:00Z', superseded_at: null, payload_sha256: 'c'.repeat(64), schema_version: 2 }],
    material_inputs_current: true,
    open_refresh_obligations: 0,
    personal_details: { full_name: 'Jordan Client', occupation: 'Engineer' },
    entity_details: null,
    documents: [
      { id: 'd1', requirement_label: 'Primary photo ID', requirement_code: 'primary_id', required: true, status: 'accepted', created_at: '2026-08-02T00:00:00Z', version_number: 1 },
    ],
    transactions: [
      { id: 't1', kind: 'purchase', status: 'under_contract', property_address: '1 Example St', contract_date: '2026-07-28', settlement_date: null, purchase_price: 900000 },
    ],
    client_requests: [],
    stamp_input: {
      issuer_org: 'Naidu Property Consulting Services',
      attestations: [{ version: 1, issued_at: '2026-08-05T00:00:00Z', superseded_at: null }],
      consents: [{ id: 'cn1', kind: 'privacy', accepted_at: '2026-08-01T09:00:00Z' }],
      verification_checks: [
        { id: 'v1', party_label: 'Jordan Client', check_type: 'electronic_idv', status: 'passed', completed_at: '2026-08-02T10:00:00Z' },
      ],
      documents: [{ status: 'accepted', reviewed_at: '2026-08-03T00:00:00Z' }],
      screening_subjects: [], owners: [], source_of_funds: [], source_of_wealth: [], edd_cases: [],
      grants: [], assessments: [], refresh_obligations: [], transactions: [],
    },
  };
  return buildPassportView('client', input);
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/client/aml/passport']}>
      <PortalPassport />
    </MemoryRouter>,
  );
}

beforeEach(() => getPassport.mockReset());

describe('PortalPassport', () => {

  it('no case yet: reassuring copy, never an error', async () => {
    getPassport.mockResolvedValue({ passport: null });
    renderPage();
    expect(await screen.findByText(/once your adviser opens/i)).toBeInTheDocument();
  });

  it('renders the cover from the projection: holder, credential, state, issuer', async () => {
    getPassport.mockResolvedValue({ passport: clientView() });
    renderPage();
    expect(await screen.findByText('Jordan Client')).toBeInTheDocument();
    expect(screen.getAllByText('AUX-AML-2026-0002-V1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Issued · Current').length).toBeGreaterThan(0);
    expect(screen.getByText(/SHA-256 EVIDENCE FINGERPRINT/)).toBeInTheDocument();
  });

  it('never renders screening, funding or partner-internal vocabulary', async () => {
    getPassport.mockResolvedValue({ passport: clientView() });
    const { container } = renderPage();
    await screen.findByText('Jordan Client');
    expect(container.textContent).not.toMatch(/risk|sanction|PEP|MLRO|funding review/i);
  });

  it('pages navigate: identity page shows the allow-listed fields', async () => {
    getPassport.mockResolvedValue({ passport: clientView() });
    renderPage();
    await screen.findByText('Jordan Client');
    // Navigation is by numbered page chip; the accessible name carries the
    // leaf title, which is how a screen-reader user finds a page too.
    screen.getByRole('button', { name: /Identity Information/ }).click();
    expect(await screen.findByText('Engineer')).toBeInTheDocument();
  });

  // Flag-off (server rejection) semantics and the branch they drive are both
  // pinned in src/components/aml/passport/loadState.test.ts — see that file's
  // header for why a rejection inside this page's full graph cannot be
  // asserted here.
});

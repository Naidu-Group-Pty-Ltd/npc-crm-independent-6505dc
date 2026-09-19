/**
 * Partner Distribution — the Command Centre surface.
 *
 * These tests pin the behaviour that makes the guided path safe: that the
 * button an operator can press is the button the server would honour, that a
 * partner the server blocked cannot be selected into a share, that a bulk
 * share reports every partner on its own, and that a disabled feature says so
 * rather than looking like a compliance failure.
 *
 * The disclosure rules themselves are tested where they are decided — in
 * `passportDistribution.test.ts` (engine) and
 * `distributionPresentation.test.ts` (translation). Nothing here re-asserts
 * them, because nothing here implements them.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PartnerDistribution } from './PartnerDistribution';
import type { ReadinessView } from '@/lib/aml/passport/distributionPresentation.pure';

const getPassportDistributionReadiness = vi.fn();
const sharePassportToPartner = vi.fn();
const sharePassportToPartners = vi.fn();

vi.mock('@/lib/aml/amlRelianceApi', () => ({
  amlRelianceApi: {
    getPassportDistributionReadiness: (...a: unknown[]) => getPassportDistributionReadiness(...a),
    sharePassportToPartner: (...a: unknown[]) => sharePassportToPartner(...a),
    sharePassportToPartners: (...a: unknown[]) => sharePassportToPartners(...a),
  },
}));

function partner(over: Partial<ReadinessView> = {}): ReadinessView {
  return {
    partner: {
      org_id: 'org-finance', org_name: 'GT Financial Services', portal_type: 'finance',
      relationship_role: 'finance_broker', purpose: 'mortgage', classification_status: 'classified',
    },
    legal_route: 'reliance',
    passport: {
      attestation_id: 'att-1', version: 4, payload_sha256: 'ab'.repeat(32),
      issued_at: '2026-08-01T00:00:00Z', state_code: 'current',
    },
    state: 'READY',
    ready: true,
    blockers: [],
    messages: [],
    reliance_code: null,
    evidence: {
      available: ['IDENTITY_KYC_AVAILABLE', 'VERIFICATION_DATA_AVAILABLE'],
      unavailable: [],
      delivery: 'available_now',
    },
    next_actions: [],
    ...over,
  };
}

function response(partners: ReadinessView[], enabled = true) {
  return {
    enabled,
    passport: {
      attestation_id: 'att-1', version: 4, payload_sha256: 'ab'.repeat(32),
      issued_at: '2026-08-01T00:00:00Z',
      state: { code: 'current', label: 'Current', tone: 'ok' },
    },
    partners,
    summary: {
      total: partners.length,
      ready: partners.filter((p) => p.ready && p.state !== 'ALREADY_CURRENT').length,
      already_current: partners.filter((p) => p.state === 'ALREADY_CURRENT').length,
      blocked: partners.filter((p) => !p.ready).length,
    },
  };
}

beforeEach(() => {
  getPassportDistributionReadiness.mockReset();
  sharePassportToPartner.mockReset();
  sharePassportToPartners.mockReset();
});

describe('who may see the surface', () => {
  it('tells a non-MLRO that distribution is an MLRO decision, and fetches nothing', async () => {
    render(<PartnerDistribution caseId="c1" isMlro={false} />);
    expect(await screen.findByText(/MLRO decision/i)).toBeInTheDocument();
    expect(getPassportDistributionReadiness).not.toHaveBeenCalled();
  });
});

describe('feature-off behaviour is stated, not hidden', () => {
  it('says distribution is not enabled and points at the existing surface', async () => {
    getPassportDistributionReadiness.mockResolvedValue(response([partner()], false));
    render(<PartnerDistribution caseId="c1" isMlro />);
    // An operator who simply saw nothing would conclude the partner is
    // ineligible — a different and wrong conclusion.
    expect(await screen.findByText(/not enabled for this environment/i)).toBeInTheDocument();
    expect(screen.getByText(/Compliance Sharing/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Link & Share/i })).not.toBeInTheDocument();
  });
});

describe('a partner card shows the server’s answer', () => {
  it('offers the share action for a ready reliance partner', async () => {
    getPassportDistributionReadiness.mockResolvedValue(response([partner()]));
    render(<PartnerDistribution caseId="c1" isMlro />);

    expect(await screen.findByText('GT Financial Services')).toBeInTheDocument();
    // The portal sits beside the relationship role in one line.
    expect(screen.getByText(/Finance Portal/)).toBeInTheDocument();
    expect(screen.getAllByText('Section 37A reliance').length).toBeGreaterThan(0);

    const action = screen.getByRole('button', { name: /Link & Share Passport/i });
    expect(action).toBeEnabled();
  });

  it('disables the action and lists what is outstanding when the server says not ready', async () => {
    getPassportDistributionReadiness.mockResolvedValue(response([partner({
      ready: false,
      state: 'ACTION_REQUIRED',
      blockers: ['CDD_ARRANGEMENT_REQUIRED'],
      messages: ['No active written CDD arrangement covers this partner.'],
    })]));
    render(<PartnerDistribution caseId="c1" isMlro />);

    const action = await screen.findByRole('button', { name: /Resolve outstanding items/i });
    expect(action).toBeDisabled();
    // Named twice on purpose: once on the checklist row it fails, once in the
    // outstanding list with the server's sentence beside it.
    expect(screen.getAllByText('CDD arrangement required')).toHaveLength(2);
    expect(screen.getByText(/No active written CDD arrangement/)).toBeInTheDocument();
  });

  it('does not offer to re-share a partner that already holds the current version', async () => {
    getPassportDistributionReadiness.mockResolvedValue(response([partner({ state: 'ALREADY_CURRENT' })]));
    render(<PartnerDistribution caseId="c1" isMlro />);
    const action = await screen.findByRole('button', { name: /Already shared/i });
    expect(action).toBeDisabled();
  });

  it('shows an information-only partner its own route and action, never reliance', async () => {
    getPassportDistributionReadiness.mockResolvedValue(response([partner({
      partner: { ...partner().partner, org_id: 'org-builder', org_name: 'XYZ Developments', portal_type: 'builder' },
      legal_route: 'information_share_only',
    })]));
    render(<PartnerDistribution caseId="c1" isMlro />);

    expect(await screen.findByText('XYZ Developments')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Share authorised Passport information/i })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /Link & Share Passport/i })).not.toBeInTheDocument();
    expect(screen.getByText(/no statutory reliance/i)).toBeInTheDocument();
  });
});

describe('the matrix compares partners without homogenising them', () => {
  it('renders one column per partner and keeps their routes distinct', async () => {
    getPassportDistributionReadiness.mockResolvedValue(response([
      partner(),
      partner({
        partner: { ...partner().partner, org_id: 'org-builder', org_name: 'XYZ Developments', portal_type: 'builder' },
        legal_route: 'information_share_only',
        evidence: { available: ['IDENTITY_KYC_AVAILABLE'], unavailable: [], delivery: 'available_now' },
      }),
    ]));
    render(<PartnerDistribution caseId="c1" isMlro />);

    const table = await screen.findByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'GT Financial Services' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'XYZ Developments' })).toBeInTheDocument();

    const routeRow = within(table).getByRole('rowheader', { name: 'Legal route' }).closest('tr')!;
    expect(within(routeRow).getByText('Section 37A reliance')).toBeInTheDocument();
    expect(within(routeRow).getByText('Information sharing only')).toBeInTheDocument();
  });

  it('describes a class outside a partner’s scope as not authorised, never as absent', async () => {
    getPassportDistributionReadiness.mockResolvedValue(response([
      partner(),
      partner({
        partner: { ...partner().partner, org_id: 'org-builder', org_name: 'XYZ Developments', portal_type: 'builder' },
        legal_route: 'information_share_only',
        evidence: { available: ['IDENTITY_KYC_AVAILABLE'], unavailable: [], delivery: 'available_now' },
      }),
    ]));
    render(<PartnerDistribution caseId="c1" isMlro />);

    const table = await screen.findByRole('table');
    const row = within(table).getByRole('rowheader', { name: 'Ownership & control' }).closest('tr')!;
    expect(within(row).getAllByText('Not authorised').length).toBeGreaterThan(0);
    expect(within(row).queryByText(/does not exist|no record/i)).not.toBeInTheDocument();
  });
});

describe('the guided workflow', () => {
  async function openDialogWithTwoPartners() {
    getPassportDistributionReadiness.mockResolvedValue(response([
      partner(),
      partner({
        partner: { ...partner().partner, org_id: 'org-legal', org_name: 'ABC Legal', portal_type: 'solicitor' },
      }),
    ]));
    render(<PartnerDistribution caseId="c1" isMlro />);
    fireEvent.click(await screen.findByRole('button', { name: /Share with all eligible partners/i }));
    return screen.findByRole('dialog');
  }

  it('starts by confirming the exact version and fingerprint being shared', async () => {
    const dialog = await openDialogWithTwoPartners();
    expect(within(dialog).getByText('v4')).toBeInTheDocument();
    // The fingerprint is shown truncated and upper-cased — enough to compare
    // against what the partner sees, never the full payload hash.
    expect(within(dialog).getByText('ABABABABABABABAB')).toBeInTheDocument();
    expect(within(dialog).getByText(/pinned to this exact version/i)).toBeInTheDocument();
  });

  it('cannot select a partner the server blocked', async () => {
    getPassportDistributionReadiness.mockResolvedValue(response([
      partner(),
      partner({
        partner: { ...partner().partner, org_id: 'org-legal', org_name: 'ABC Legal', portal_type: 'solicitor' },
        ready: false, state: 'ACTION_REQUIRED', blockers: ['PORTAL_MEMBERSHIP_REQUIRED'],
        messages: ['This organisation has no active portal membership.'],
      }),
    ]));
    render(<PartnerDistribution caseId="c1" isMlro />);
    fireEvent.click(await screen.findByRole('button', { name: /Share with all eligible partners/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));

    const boxes = within(dialog).getAllByRole('checkbox');
    expect(boxes).toHaveLength(2);
    const blocked = boxes.find((b) => (b as HTMLInputElement).disabled);
    expect(blocked).toBeTruthy();
    expect(within(dialog).getByText('Portal not connected')).toBeInTheDocument();
  });

  it('states plainly when section 37A reliance is unavailable and what is missing', async () => {
    getPassportDistributionReadiness.mockResolvedValue(response([partner({
      legal_route: 'information_share_only',
    })]));
    render(<PartnerDistribution caseId="c1" isMlro />);
    fireEvent.click(await screen.findByRole('button', { name: /Share authorised Passport information/i }));
    const dialog = await screen.findByRole('dialog');

    // Step through to the legal route step.
    for (let i = 0; i < 3; i++) {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    }
    expect(within(dialog).getByText(/Section 37A reliance is not available/i)).toBeInTheDocument();
    // And it must not have quietly promoted the partner to a reliance route.
    expect(within(dialog).queryByText('Section 37A reliance available')).not.toBeInTheDocument();
  });

  it('reports every partner individually after a bulk share', async () => {
    sharePassportToPartners.mockResolvedValue({
      passport: { attestation_id: 'att-1', version: 4 },
      outcomes: [
        { partner_org_id: 'org-finance', state: 'CURRENTLY_SHARED', shared: true, grant_id: 'g1', access_token: 'tok-1' },
        { partner_org_id: 'org-legal', state: 'ACTION_REQUIRED', shared: false, code: 'grant_write_failed' },
      ],
      summary: { total: 2, shared: 1, already_current: 0, blocked: 1 },
    });
    const dialog = await openDialogWithTwoPartners();
    for (let i = 0; i < 5; i++) {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    }
    fireEvent.click(within(dialog).getByRole('button', { name: /Share with 2 partners/i }));

    await waitFor(() => expect(within(dialog).getByText('Shared — section 37A reliance')).toBeInTheDocument());
    // One partner failing must never report the other as successful.
    expect(within(dialog).getByText('Failed')).toBeInTheDocument();
    expect(within(dialog).getByText(/1 shared/)).toBeInTheDocument();
  });

  it('shows a newly issued partner token once, and says it cannot be shown again', async () => {
    sharePassportToPartners.mockResolvedValue({
      passport: { attestation_id: 'att-1', version: 4 },
      outcomes: [
        { partner_org_id: 'org-finance', state: 'CURRENTLY_SHARED', shared: true, grant_id: 'g1', access_token: 'tok-abc' },
        { partner_org_id: 'org-legal', state: 'ALREADY_CURRENT', shared: false },
      ],
      summary: { total: 2, shared: 1, already_current: 1, blocked: 0 },
    });
    const dialog = await openDialogWithTwoPartners();
    for (let i = 0; i < 5; i++) {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    }
    fireEvent.click(within(dialog).getByRole('button', { name: /Share with 2 partners/i }));

    await waitFor(() => expect(within(dialog).getByText('tok-abc')).toBeInTheDocument());
    expect(within(dialog).getByText(/cannot be shown again/i)).toBeInTheDocument();
    expect(within(dialog).getByText('Already current')).toBeInTheDocument();
  });

  it('sends only the case and the chosen organisations — never a claim about them', async () => {
    const dialog = await openDialogWithTwoPartners();
    sharePassportToPartners.mockResolvedValue({
      passport: { attestation_id: 'att-1', version: 4 },
      outcomes: [], summary: { total: 0, shared: 0, already_current: 0, blocked: 0 },
    });
    for (let i = 0; i < 5; i++) {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    }
    fireEvent.click(within(dialog).getByRole('button', { name: /Share with 2 partners/i }));

    await waitFor(() => expect(sharePassportToPartners).toHaveBeenCalled());
    const args = sharePassportToPartners.mock.calls[0];
    expect(args[0]).toBe('c1');
    expect(args[1]).toEqual(['org-finance', 'org-legal']);
    // No eligibility, route, version or consent assertion travels with it.
    expect(JSON.stringify(args)).not.toMatch(/eligible|section_37a|legal_route|attestation_id|consent/i);
  });
});

describe('empty and failure states are honest', () => {
  it('explains that a free-text firm is deliberately not turned into a partner', async () => {
    getPassportDistributionReadiness.mockResolvedValue(response([]));
    render(<PartnerDistribution caseId="c1" isMlro />);
    // Said in the summary line and again in the empty state.
    expect((await screen.findAllByText(/No partner organisations are linked to this matter yet/i)).length)
      .toBeGreaterThan(0);
    expect(screen.getByText(/free text/i)).toBeInTheDocument();
  });

  it('offers a retry rather than an invented answer when readiness cannot be checked', async () => {
    getPassportDistributionReadiness.mockRejectedValue(new Error('network'));
    render(<PartnerDistribution caseId="c1" isMlro />);
    expect(await screen.findByText(/could not be checked/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try again/i })).toBeInTheDocument();
  });
});

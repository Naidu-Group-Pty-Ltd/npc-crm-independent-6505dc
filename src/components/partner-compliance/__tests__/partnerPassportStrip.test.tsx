/**
 * Partner Passport strip — presentation of what the workspace DTO already
 * discloses, and nothing else.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PartnerPassportStrip } from '../PartnerPassportStrip';
import { financePortalAdapter } from '../adapters';
import type { PartnerWorkspaceDto } from '../../../../supabase/functions/_shared/aml/partnerWorkspace';

function dto(over: Partial<PartnerWorkspaceDto> = {}): PartnerWorkspaceDto {
  return {
    workspace_version: 1,
    responsibility_notice: 'You remain responsible.',
    partner: { organisation_legal_name: 'GT Financial Services', classification_status: 'classified' },
    origin: { organisation_label: 'Naidu Property Consulting Services' },
    link: {
      id: 'l1', relationship_role: 'lender', legal_route: 'reliance', state: 'active',
      portal_type: 'finance', linked_at: '2026-08-01T00:00:00Z',
      purchase_file_id: null, legal_matter_id: null,
    } as PartnerWorkspaceDto['link'],
    attestation: {
      schema_version: 2, version: 3, sha256: 'a'.repeat(64),
      issued_at: '2026-08-12T00:00:00Z', state: 'current',
    },
    attestation_state: 'current',
    procedures: null,
    limitations: [],
    record_availability: [],
    determination: {
      status: 'satisfied', decided_at: '2026-08-13T00:00:00Z',
      based_on_attestation_sha256: 'a'.repeat(64), refresh_required: false,
    },
    determination_history_count: 1,
    open_requests: [],
    deliveries: [],
    tasks: [],
    next_action: { code: 'none', label: 'Nothing outstanding' },
    ...over,
  };
}

describe('PartnerPassportStrip', () => {
  it('renders nothing before an attestation is shared', () => {
    const { container } = render(
      <PartnerPassportStrip workspace={dto({ attestation: null, attestation_state: 'unavailable' })} adapter={financePortalAdapter} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows issuer, version, fingerprint, state and the partner decision stamp', () => {
    render(<PartnerPassportStrip workspace={dto()} adapter={financePortalAdapter} />);
    expect(screen.getByText(/Issued by Naidu Property Consulting Services/)).toBeInTheDocument();
    expect(screen.getByText('v3')).toBeInTheDocument();
    expect(screen.getByText('Current')).toBeInTheDocument();
    expect(screen.getByText('FINANCE RELIANCE ACCEPTED')).toBeInTheDocument();
    // The partner's stamp speaks for the PARTNER.
    expect(screen.getByText('GT Financial Services')).toBeInTheDocument();
  });

  it('warns when the recorded decision responds to an earlier version', () => {
    render(
      <PartnerPassportStrip
        workspace={dto({
          determination: {
            status: 'satisfied', decided_at: '2026-08-10T00:00:00Z',
            based_on_attestation_sha256: 'b'.repeat(64), refresh_required: true,
          },
        })}
        adapter={financePortalAdapter}
      />,
    );
    expect(screen.getByText(/responds to an earlier version/)).toBeInTheDocument();
  });

  it('never invents a stamp: no decision, no seal', () => {
    render(
      <PartnerPassportStrip
        workspace={dto({ determination: null })}
        adapter={financePortalAdapter}
      />,
    );
    expect(screen.queryByText(/RELIANCE ACCEPTED/)).not.toBeInTheDocument();
  });
});

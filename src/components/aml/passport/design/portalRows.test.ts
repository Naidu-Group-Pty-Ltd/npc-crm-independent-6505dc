/**
 * The connected-portals strip is derived, never declared.
 *
 * The design's prototype lists five portals whether or not they hold anything.
 * In production a row must mean a grant exists — a strip that showed "Finance
 * Portal" for a case never shared with a financier would assert a disclosure
 * that never happened.
 */
import { describe, expect, it } from 'vitest';
import { buildPassportView, type PassportViewInput } from '@/lib/aml/passport';
import { derivePortalRows } from './portalRows';

const NOW = '2026-08-13T10:00:00Z';

function view(over: Partial<PassportViewInput> = {}) {
  const input: PassportViewInput = {
    issuer_org: 'Naidu Property Consulting Services',
    officer_label: 'P. Naidu',
    case: {
      id: 'c1', case_reference: 'AML-2026-1184', subject_display_name: 'Meridian',
      subject_type: 'entity', status: 'cleared', case_stage: 'cleared',
      service_gate_status: 'approved', opened_at: NOW, closed_at: null,
    },
    attestations: [{ version: 1, issued_at: NOW, superseded_at: null, payload_sha256: 'a'.repeat(64), schema_version: 2 }],
    material_inputs_current: true,
    open_refresh_obligations: 0,
    personal_details: null, entity_details: null,
    documents: [], transactions: [], screening: null, funding: null,
    partners: [], events: [], client_requests: [],
    stamp_input: {
      issuer_org: 'Naidu Property Consulting Services',
      attestations: [{ version: 1, issued_at: NOW, superseded_at: null }],
      consents: [], verification_checks: [], documents: [], screening_subjects: [], owners: [],
      source_of_funds: [], source_of_wealth: [], edd_cases: [], grants: [],
      assessments: [], refresh_obligations: [], transactions: [],
    },
    ...over,
  };
  return buildPassportView('command', input);
}

describe('derivePortalRows', () => {
  it('always names the issuing authority and the client', () => {
    const rows = derivePortalRows(view());
    expect(rows.map((r) => r.label)).toEqual(['Command Centre', 'Client Portal']);
    expect(rows[0].role).toBe('Issuer');
  });

  it('does NOT invent partner portals that hold no grant', () => {
    const labels = derivePortalRows(view()).map((r) => r.label);
    expect(labels).not.toContain('Finance Portal');
    expect(labels).not.toContain('Solicitor Portal');
  });

  it('adds a row per real grant, and marks a revoked one', () => {
    const rows = derivePortalRows(view({
      partners: [
        { org_name: 'GT Financial', org_type: 'finance', portal_type: 'finance', link_state: 'active',
          legal_route: 'reliance', grant_created_at: NOW, grant_expires_at: null, grant_revoked_at: null,
          attestation_version: 1, last_viewed_at: NOW, assessment_status: 'satisfied',
          assessment_decided_at: NOW, assessor_name: 'G. Turnbull' },
        { org_name: 'Harlow & Vance', org_type: 'solicitor', portal_type: 'solicitor', link_state: 'active',
          legal_route: 'reliance', grant_created_at: NOW, grant_expires_at: null, grant_revoked_at: NOW,
          attestation_version: 1, last_viewed_at: null, assessment_status: null,
          assessment_decided_at: null, assessor_name: null },
      ],
    }));
    const finance = rows.find((r) => r.label === 'Finance Portal');
    expect(finance?.state).toBe('Reliance accepted');
    expect(finance?.tone).toBe('ok');

    const solicitor = rows.find((r) => r.label === 'Solicitor Portal');
    expect(solicitor?.state).toBe('Revoked');
    expect(solicitor?.tone).toBe('bad');
  });

  it('says the client Passport does not exist before a version is issued', () => {
    const rows = derivePortalRows(view({ attestations: [] }));
    const client = rows.find((r) => r.label === 'Client Portal');
    expect(client?.state).toBe('Not issued');
    expect(client?.tone).toBe('na');
  });
});

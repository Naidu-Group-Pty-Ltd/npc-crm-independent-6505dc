/**
 * Passport state derivation — the single lifecycle authority.
 *
 * These tests pin the precedence order. The state is pure derivation over
 * existing records; if any assertion here needs "loosening" to make a UI
 * behave, the UI is wrong, not the derivation.
 */
import { describe, expect, it } from 'vitest';
import {
  derivePassportState,
  versionRegisterState,
  type PassportAttestationFact,
  type PassportStateInput,
} from './index';

const att = (
  version: number,
  issued: string,
  superseded: string | null = null,
): PassportAttestationFact => ({
  version,
  issued_at: issued,
  superseded_at: superseded,
  payload_sha256: 'a'.repeat(64),
  schema_version: 2,
});

const base: PassportStateInput = {
  attestations: [],
  service_gate_status: null,
  case_status: 'kyc_in_progress',
  material_inputs_current: null,
  open_refresh_obligations: 0,
};

describe('derivePassportState', () => {
  it('is NOT_ISSUED while the journey is still building the record', () => {
    const s = derivePassportState({ ...base, service_gate_status: 'cdd_incomplete' });
    expect(s.code).toBe('not_issued');
    expect(s.current_version).toBeNull();
    expect(s.latest_version).toBe(0);
  });

  it('becomes READY_FOR_ISSUANCE only from an explicitly approved gate', () => {
    expect(derivePassportState({ ...base, service_gate_status: 'approved' }).code)
      .toBe('ready_for_issuance');
    expect(derivePassportState({ ...base, service_gate_status: 'approved_with_controls' }).code)
      .toBe('ready_for_issuance');
    // under_review is not readiness — readiness never derives from raw status.
    expect(derivePassportState({ ...base, service_gate_status: 'under_review' }).code)
      .toBe('not_issued');
  });

  it('is ISSUED_CURRENT with a current attestation and an approved gate', () => {
    const s = derivePassportState({
      ...base,
      attestations: [att(1, '2026-08-01T00:00:00Z')],
      service_gate_status: 'approved',
    });
    expect(s.code).toBe('issued_current');
    expect(s.current_version).toBe(1);
    expect(s.label).toBe('Issued · Current');
  });

  it('drops to REFRESH_REQUIRED when material inputs changed', () => {
    const s = derivePassportState({
      ...base,
      attestations: [att(1, '2026-08-01T00:00:00Z')],
      service_gate_status: 'approved',
      material_inputs_current: false,
    });
    expect(s.code).toBe('refresh_required');
    expect(s.reasons).toContain('material_inputs_changed');
  });

  it('drops to REFRESH_REQUIRED on an open refresh obligation', () => {
    const s = derivePassportState({
      ...base,
      attestations: [att(1, '2026-08-01T00:00:00Z')],
      service_gate_status: 'approved',
      open_refresh_obligations: 1,
    });
    expect(s.code).toBe('refresh_required');
  });

  it('a gate that regressed below approved never leaves the Passport claiming Current', () => {
    const s = derivePassportState({
      ...base,
      attestations: [att(1, '2026-08-01T00:00:00Z')],
      service_gate_status: 'under_review',
    });
    expect(s.code).toBe('refresh_required');
    expect(s.reasons).toContain('service_gate_regressed');
  });

  it('v1 attestations (material inputs not assessable) never force a caution state', () => {
    const s = derivePassportState({
      ...base,
      attestations: [att(1, '2026-08-01T00:00:00Z')],
      service_gate_status: 'approved',
      material_inputs_current: null,
    });
    expect(s.code).toBe('issued_current');
  });

  it('is SUPERSEDED between a material change and the successor issue', () => {
    const s = derivePassportState({
      ...base,
      attestations: [att(1, '2026-08-01T00:00:00Z', '2026-08-10T00:00:00Z')],
      service_gate_status: 'approved',
    });
    expect(s.code).toBe('superseded');
    expect(s.current_version).toBeNull();
    expect(s.latest_version).toBe(1);
  });

  it('SUSPENDED derives from a locked gate and beats every other state', () => {
    const s = derivePassportState({
      ...base,
      attestations: [att(1, '2026-08-01T00:00:00Z')],
      service_gate_status: 'locked',
      material_inputs_current: false,
    });
    expect(s.code).toBe('suspended');
    expect(s.tone).toBe('destructive');
  });

  it('REVOKED derives from a terminated gate and beats suspension inputs', () => {
    const s = derivePassportState({
      ...base,
      attestations: [att(1, '2026-08-01T00:00:00Z')],
      service_gate_status: 'terminated',
    });
    expect(s.code).toBe('revoked');
  });

  it('a closed case with an issued record is COMPLETED_RETAINED, never deleted', () => {
    const s = derivePassportState({
      ...base,
      attestations: [att(1, '2026-08-01T00:00:00Z')],
      case_status: 'closed',
      service_gate_status: 'approved',
    });
    expect(s.code).toBe('completed_retained');
  });

  it('supersession chain reports the newest unsuperseded version as current', () => {
    const s = derivePassportState({
      ...base,
      attestations: [
        att(1, '2026-08-01T00:00:00Z', '2026-08-05T00:00:00Z'),
        att(2, '2026-08-05T00:00:00Z', '2026-08-12T00:00:00Z'),
        att(3, '2026-08-12T00:00:00Z'),
      ],
      service_gate_status: 'approved',
    });
    expect(s.code).toBe('issued_current');
    expect(s.current_version).toBe(3);
    expect(s.latest_version).toBe(3);
  });

  it('every state carries a label and a tone — status is never colour-only', () => {
    const codes: Array<Partial<PassportStateInput>> = [
      {},
      { service_gate_status: 'approved' },
      { attestations: [att(1, '2026-08-01T00:00:00Z')], service_gate_status: 'approved' },
      { attestations: [att(1, '2026-08-01T00:00:00Z', '2026-08-02T00:00:00Z')] },
      { service_gate_status: 'locked' },
      { service_gate_status: 'terminated' },
      { attestations: [att(1, '2026-08-01T00:00:00Z')], case_status: 'closed' },
    ];
    for (const patch of codes) {
      const s = derivePassportState({ ...base, ...patch });
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.tone.length).toBeGreaterThan(0);
    }
  });
});

describe('versionRegisterState', () => {
  const all = [
    att(1, '2026-08-01T00:00:00Z', '2026-08-05T00:00:00Z'),
    att(2, '2026-08-05T00:00:00Z', '2026-08-12T00:00:00Z'),
    att(3, '2026-08-12T00:00:00Z'),
  ];
  it('labels the first superseded version as the initial issue', () => {
    expect(versionRegisterState(all[0], all)).toBe('initial_issue');
    expect(versionRegisterState(all[1], all)).toBe('superseded');
    expect(versionRegisterState(all[2], all)).toBe('current');
  });
});

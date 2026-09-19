/**
 * The IDV binding — the seam the identity-verification workflow will land on.
 *
 * These assertions are the contract that makes the later integration additive.
 * Do not relax them to accommodate a new provider signal: declare the signal in
 * `passportIdv.pure.ts` instead, which is the whole point of the module.
 */
import { describe, expect, it } from 'vitest';
import { IDV_COMPONENTS, classifyIdvCheck, summariseIdv } from './index';

describe('classifyIdvCheck', () => {
  it('maps the check types the AML engine actually writes', () => {
    expect(classifyIdvCheck('electronic_idv')?.code).toBe('electronic_idv');
    expect(classifyIdvCheck('ocr_anti_tamper')?.code).toBe('document_authenticity');
    expect(classifyIdvCheck('face_match')?.code).toBe('face_match');
    expect(classifyIdvCheck('liveness_video')?.code).toBe('liveness');
    expect(classifyIdvCheck('  Electronic_IDV  ')?.code).toBe('electronic_idv');
  });

  it('returns null for an unknown type rather than guessing a bucket', () => {
    // Showing a check under the wrong component tells an operator a control was
    // performed that was not. Null is the honest answer.
    expect(classifyIdvCheck('some_future_provider_signal')).toBeNull();
    expect(classifyIdvCheck(null)).toBeNull();
    expect(classifyIdvCheck('')).toBeNull();
  });
});

describe('summariseIdv', () => {
  it('reports components with no record as not performed, never as absent', () => {
    const s = summariseIdv([]);
    expect(s.components).toHaveLength(Object.keys(IDV_COMPONENTS).length);
    expect(s.components.every((c) => c.outcome === 'not_performed')).toBe(true);
    expect(s.complete).toBe(false);
  });

  it('a single failed attempt fails the component even when a later one passed', () => {
    const s = summariseIdv([
      { check_type: 'face_match', status: 'failed', completed_at: '2026-08-01T00:00:00Z' },
      { check_type: 'face_match', status: 'passed', completed_at: '2026-08-02T00:00:00Z' },
    ]);
    const face = s.components.find((c) => c.component.code === 'face_match');
    expect(face?.outcome).toBe('failed');
  });

  it('counts unmapped checks instead of hiding them', () => {
    const s = summariseIdv([
      { check_type: 'electronic_idv', status: 'passed', completed_at: null },
      { check_type: 'not_a_known_check', status: 'passed', completed_at: null },
    ]);
    expect(s.unmapped).toBe(1);
    expect(s.performed).toBe(1);
  });

  it('is complete only when every attempted component passed', () => {
    expect(
      summariseIdv([
        { check_type: 'electronic_idv', status: 'passed', completed_at: null },
        { check_type: 'ocr_anti_tamper', status: 'passed', completed_at: null },
      ]).complete,
    ).toBe(true);

    expect(
      summariseIdv([
        { check_type: 'electronic_idv', status: 'passed', completed_at: null },
        { check_type: 'liveness', status: 'pending', completed_at: null },
      ]).complete,
    ).toBe(false);
  });

  it('carries no score, measurement or provider payload — by construction', () => {
    const json = JSON.stringify(
      summariseIdv([{ check_type: 'face_match', status: 'passed', completed_at: null }]),
    );
    expect(json).not.toMatch(/score|confidence|similarity|payload|provider|image|media/i);
  });

  it('marks the biometric components as non-disclosable', () => {
    // Presence and pass/fail may cross a disclosure boundary; the measurement
    // behind them may not. §32 default-deny.
    expect(IDV_COMPONENTS.face_match.disclosable).toBe(false);
    expect(IDV_COMPONENTS.liveness.disclosable).toBe(false);
    expect(IDV_COMPONENTS.electronic_idv.disclosable).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { resolveRequestStep, type IdvAvailability } from './portalRequestRoute';

/**
 * The reported defect, as behaviour: a client with an identity-verification
 * request and no available provider was shown "Step 2 — take a photo of
 * yourself" while the server refused submission. These exercise the resolver
 * directly — no source-string matching.
 */

const idv = (target: string | null | undefined) => ({
  action_code: 'complete_identity_verification',
  action_target: target === undefined ? undefined : { target_step: target },
});

describe('identity-verification request routing', () => {
  it('never opens the capture step when the target is manual upload', () => {
    for (const a of ['available', 'temporarily_unavailable', 'manual_verification_required', null] as const) {
      const r = resolveRequestStep(idv('upload_document'), a as IdvAvailability | null);
      expect(r.step, `availability=${a}`).toBe('documents');
      expect(r.step).not.toBe('verify');
    }
  });

  it('opens capture only when the request asked for it and a provider is available', () => {
    expect(resolveRequestStep(idv('identity_verification'), 'available').step).toBe('verify');
  });

  it('falls back to manual upload when the provider is no longer available', () => {
    // The screenshot case: request created for capture, provider since gone.
    for (const a of ['temporarily_unavailable', 'manual_verification_required'] as const) {
      const r = resolveRequestStep(idv('identity_verification'), a);
      expect(r.step).toBe('documents');
      expect(r.manualFallback, 'the client must be told why').toBe(true);
    }
  });

  it('falls back safely when the target is missing or unreadable', () => {
    // Older requests predate action_target entirely.
    for (const t of [undefined, null, '', 'nonsense']) {
      const r = resolveRequestStep(idv(t as any), null);
      expect(r.step, `target=${String(t)}`).toBe('documents');
    }
  });

  it('ignores a URL-shaped target rather than following it', () => {
    for (const evil of [
      'https://evil.example/steal',
      '//evil.example',
      'javascript:alert(1)',
      '../../admin',
    ]) {
      const r = resolveRequestStep(idv(evil), 'available');
      expect(r.step, `target=${evil}`).toBe('documents');
      expect(r.label).not.toContain(evil);
    }
  });

  it('does not announce a fallback when manual was the intended route', () => {
    // Requests created as manual are not a downgrade — no apology needed.
    expect(resolveRequestStep(idv('upload_document'), null).manualFallback).toBe(false);
  });

  it('leaves every other action code on its own step', () => {
    expect(resolveRequestStep({ action_code: 'upload_document' }, null).step).toBe('documents');
    expect(resolveRequestStep({ action_code: 'review_consent' }, null).step).toBe('consent');
    expect(resolveRequestStep({ action_code: 'review_and_submit' }, null).step).toBe('review');
  });

  it('treats an unknown action code as a plain response, never a route', () => {
    const r = resolveRequestStep({ action_code: 'not_a_real_code' }, 'available');
    expect(r.step).toBe('respond');
  });
});

/**
 * E9 — governed extraction provider ensemble shared-contract specs.
 *
 * Verifies the versioned contracts, the fail-closed default policy, the safe-error
 * vocabulary, the persisted-shape validators (signed URL / raw buffer / version /
 * non-finite), and CROSS-RUNTIME identity parity: the TS `providerConfiguration
 * Identity` / `providerRequestId` produce byte-identical hashes to the Python
 * sidecar producer for ASCII inputs.
 */
import { describe, it, expect } from 'vitest';
import {
  EXTRACTION_PROVIDER_ADAPTER_VERSION, EXTRACTION_PROVIDER_REQUEST_VERSION, EXTRACTION_PROVIDER_RESULT_VERSION,
  PROVIDER_CAPABILITY_MANIFEST_VERSION, EXTRACTION_PROVIDER_POLICY_VERSION, PROVIDER_EVIDENCE_BUNDLE_VERSION,
  PROVIDER_ARBITRATION_VERSION, PROVIDER_ATTEMPT_AUDIT_VERSION, PROVIDER_REGISTRY_VERSION,
  PROVIDER_IDS, REMOTE_PROVIDER_IDS, VLM_PROVIDER_IDS, PROVIDER_SAFE_ERROR_CODES,
  fnv1a32, providerConfigurationIdentity, providerRequestId,
  defaultLocalProviderPolicy, isRemoteProviderPermitted, validateProviderPersistedShape, isSignedUrl,
} from '../pdfImport/extractionProviders.pure';

describe('E9 provider contract versions', () => {
  it('version constants are exact', () => {
    expect(EXTRACTION_PROVIDER_ADAPTER_VERSION).toBe('extraction-provider-adapter-v1');
    expect(EXTRACTION_PROVIDER_REQUEST_VERSION).toBe('extraction-provider-request-v1');
    expect(EXTRACTION_PROVIDER_RESULT_VERSION).toBe('extraction-provider-result-v1');
    expect(PROVIDER_CAPABILITY_MANIFEST_VERSION).toBe('provider-capability-manifest-v1');
    expect(EXTRACTION_PROVIDER_POLICY_VERSION).toBe('extraction-provider-policy-v1');
    expect(PROVIDER_EVIDENCE_BUNDLE_VERSION).toBe('provider-evidence-bundle-v1');
    expect(PROVIDER_ARBITRATION_VERSION).toBe('provider-arbitration-v1');
    expect(PROVIDER_ATTEMPT_AUDIT_VERSION).toBe('provider-attempt-audit-v1');
    expect(PROVIDER_REGISTRY_VERSION).toBe('provider-registry-v1');
  });
  it('provider allowlist + remote/vlm sets', () => {
    expect(PROVIDER_IDS).toContain('pymupdf-exact');
    expect(REMOTE_PROVIDER_IDS.has('google-document-ai-layout')).toBe(true);
    expect(VLM_PROVIDER_IDS.has('docling-vlm')).toBe(true);
    expect(PROVIDER_SAFE_ERROR_CODES).toContain('provider_remote_not_approved');
  });
});

describe('fail-closed default policy', () => {
  const policy = defaultLocalProviderPolicy();
  it('remote + vlm disabled, zero remote limits', () => {
    expect(policy.remoteProvidersEnabled).toBe(false);
    expect(policy.remoteVlmEnabled).toBe(false);
    expect(policy.maxRemotePagesPerJob).toBe(0);
    expect(policy.approvedRemoteLocations).toEqual([]);
  });
  it('a remote/vlm provider is never permitted by default; a local one is', () => {
    expect(isRemoteProviderPermitted(policy, 'google-document-ai-layout', { remoteApproved: true, trustedLocation: 'australia-southeast1' })).toBe(false);
    expect(isRemoteProviderPermitted(policy, 'docling-vlm', { remoteApproved: true, trustedLocation: null })).toBe(false);
    expect(isRemoteProviderPermitted(policy, 'pymupdf-exact', { remoteApproved: false, trustedLocation: null })).toBe(true);
  });
  it('remote enabled still needs approval + trusted location', () => {
    const p = { ...policy, enabledProviders: [...policy.enabledProviders, 'google-document-ai-layout' as const], remoteProvidersEnabled: true, approvedRemoteLocations: ['australia-southeast1'] };
    expect(isRemoteProviderPermitted(p, 'google-document-ai-layout', { remoteApproved: false, trustedLocation: 'australia-southeast1' })).toBe(false);
    expect(isRemoteProviderPermitted(p, 'google-document-ai-layout', { remoteApproved: true, trustedLocation: 'us-central1' })).toBe(false);
    expect(isRemoteProviderPermitted(p, 'google-document-ai-layout', { remoteApproved: true, trustedLocation: 'australia-southeast1' })).toBe(true);
  });
});

describe('persisted-shape validators', () => {
  it('rejects wrong version, signed URL and raw buffer', () => {
    expect(validateProviderPersistedShape({ version: 'wrong' }, 'provider-evidence-bundle-v1')).toContain('provider_invalid_response');
    expect(validateProviderPersistedShape({ version: 'provider-evidence-bundle-v1', payloadRef: 'https://signed/x' }, 'provider-evidence-bundle-v1')).toContain('signed_url_persisted');
    expect(validateProviderPersistedShape({ version: 'provider-evidence-bundle-v1', buf: new Uint8Array([1]) }, 'provider-evidence-bundle-v1')).toContain('raw_payload_persisted');
    expect(isSignedUrl('https://x/y')).toBe(true);
    expect(isSignedUrl('job/1/x.png')).toBe(false);
    // durablePath is allowed.
    expect(validateProviderPersistedShape({ version: 'provider-evidence-bundle-v1', durablePath: 'job/1/x.json' }, 'provider-evidence-bundle-v1')).toEqual([]);
  });
});

describe('cross-runtime identity parity (matches the Python sidecar producer)', () => {
  it('fnv1a32 matches the shared algorithm', () => {
    // Python fnv1a32("abc") — verified separately.
    expect(fnv1a32('abc')).toBe('1a47e90b');
  });
  it('providerConfigurationIdentity is byte-identical to Python', () => {
    const cfg = providerConfigurationIdentity({
      providerId: 'pymupdf-exact', adapterVersion: 'extraction-provider-adapter-v1', enginePackageVersion: '1.24.0',
      modelPreset: 'fast-native', processorType: null, processorVersion: null, trustedLocation: null,
      ocrOptions: {}, tableOptions: {}, chartOptions: {}, vlmPreset: null, privacyPolicyVersion: 'v1',
    });
    expect(cfg).toBe('pcfg-c3d88d82'); // Python-produced
  });
  it('providerRequestId is byte-identical to Python', () => {
    const rid = providerRequestId({
      sourceSha256: 'a'.repeat(64), providerId: 'pymupdf-exact', configurationIdentity: 'pcfg-c3d88d82',
      purpose: 'primary-extraction', pageStart: 1, pageEnd: 3, regionIds: ['r2', 'r1'], regionBBoxes: [],
      requestedCapabilities: ['nativeText', 'layout'], optionsHash: 'popt-6ed230cc', policyHash: 'ppol-abc',
    });
    expect(rid).toBe('preq-7f616706'); // Python-produced
  });
});

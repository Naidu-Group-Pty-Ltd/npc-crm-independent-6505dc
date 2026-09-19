import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Which IDV providers the Command Centre reports as ready.
 *
 * The staff readiness card used to decide this for itself, with a literal:
 *
 *     const wired = key === "selfhosted";
 *
 * That was true when there was exactly one adapter. Once a hosted provider was
 * added it stopped being true and nothing said so — a correctly configured,
 * active hosted provider reported "adapter not wired" on the card, and the
 * "Ask client to verify" request told the customer to upload a document and
 * that no selfie was needed, while the portal was in fact offering them a live
 * camera flow. Staff and customer were reading two different systems.
 *
 * The registry is now the single answer to "is this wired", and these pin it.
 */

const env: Record<string, string> = {};
beforeEach(() => {
  for (const k of Object.keys(env)) delete env[k];
  Object.assign(env, { AML_ENVIRONMENT: 'production' });
  (globalThis as any).Deno = { env: { get: (k: string) => env[k] } };
  vi.resetModules();
});
afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as any).Deno;
});

const readiness = async (key: string | null | undefined, resolved?: unknown) => {
  const m = await import('../../../supabase/functions/_shared/aml/providers/index.ts');
  return m.idvAdapterReadiness(key, resolved as any);
};

/** Both hosted secrets plus a workflow — the production shape. */
const hostedSecrets = () => Object.assign(env, {
  DIDIT_API_KEY: 'test-key-not-a-real-credential',
  DIDIT_WEBHOOK_SECRET: 'test-secret-not-a-real-credential',
  DIDIT_WORKFLOW_ID: '00000000-0000-0000-0000-000000000000',
});

/** Both self-hosted service secrets. */
const captureSecrets = () => Object.assign(env, {
  AML_VERIFICATION_SERVICE_URL: 'https://verify.example.internal',
  AML_VERIFICATION_SERVICE_TOKEN: 'service-token',
});

describe('IDV adapter readiness', () => {
  it('reports an active hosted provider as wired', async () => {
    hostedSecrets();
    expect(await readiness('didit')).toEqual({
      wired: true, configured: true, flow: 'hosted_session',
    });
  });

  it('still reports the self-hosted capture provider as wired', async () => {
    captureSecrets();
    // The regression that matters most: the fallback NPC owns must not have
    // been traded away for the new one.
    expect(await readiness('selfhosted')).toEqual({
      wired: true, configured: true, flow: 'capture',
    });
  });

  it('separates "wired" from "configured" for both flows', async () => {
    // No secrets at all. Both adapters exist in the registry either way — what
    // is missing is credentials, and the card must be able to say which of the
    // two problems it has. Collapsing them is how a missing secret got
    // reported to staff as a missing adapter.
    expect(await readiness('didit')).toEqual({
      wired: true, configured: false, flow: 'hosted_session',
    });
    expect(await readiness('selfhosted')).toEqual({
      wired: true, configured: false, flow: 'capture',
    });
  });

  it('a hosted provider missing any one of its three settings is not configured', async () => {
    for (const missing of ['DIDIT_API_KEY', 'DIDIT_WEBHOOK_SECRET', 'DIDIT_WORKFLOW_ID']) {
      hostedSecrets();
      delete env[missing];
      vi.resetModules();
      const r = await readiness('didit');
      expect(r.configured, `without ${missing}`).toBe(false);
      // Still wired — the distinction is the whole point of two booleans.
      expect(r.wired, `without ${missing}`).toBe(true);
    }
  });

  it('the workflow id may come from tenant config instead of the environment', async () => {
    Object.assign(env, {
      DIDIT_API_KEY: 'test-key-not-a-real-credential',
      DIDIT_WEBHOOK_SECRET: 'test-secret-not-a-real-credential',
    });
    const r = await readiness('didit', {
      providerKey: 'didit', mode: 'live',
      config: { workflow_id: '11111111-1111-1111-1111-111111111111' },
    });
    expect(r.configured).toBe(true);
  });

  it('an unknown or absent key is neither wired nor hosted', async () => {
    for (const key of [null, undefined, '', 'simulator', 'frankie', 'trulioo']) {
      const r = await readiness(key);
      expect(r.wired, String(key)).toBe(false);
      // Unknown keys read as capture: a flow token is not a licence to run
      // one, and `capture` is the flow that requires the customer to do
      // nothing new if it turns out to be wrong.
      expect(r.flow, String(key)).toBe('capture');
    }
  });

  it('is case-insensitive about the provider key', async () => {
    hostedSecrets();
    captureSecrets();
    expect((await readiness('DIDIT')).flow).toBe('hosted_session');
    expect((await readiness('SelfHosted')).wired).toBe(true);
  });

  it('never returns a credential, only whether one is present', async () => {
    hostedSecrets();
    const r = await readiness('didit');
    // The result crosses into a staff HTTP response. Three booleans and a
    // two-word flow token is all it may ever be.
    expect(Object.keys(r).sort()).toEqual(['configured', 'flow', 'wired']);
    expect(JSON.stringify(r)).not.toContain('test-key-not-a-real-credential');
    expect(JSON.stringify(r)).not.toContain('test-secret-not-a-real-credential');
  });
});

describe('the readiness endpoint reports the flow to staff', () => {
  const source = () => import('node:fs').then(
    (fs) => fs.readFileSync('supabase/functions/aml-verification/index.ts', 'utf8'));

  it('asks the registry rather than deciding for itself', async () => {
    const src = await source();
    expect(src).toContain('idvAdapterReadiness');
    // The literal that caused this. If it comes back, so does the defect.
    expect(src).not.toMatch(/wired\s*=\s*key\s*===\s*["']selfhosted["']/);
  });

  it('publishes the flow so the card can say what the customer will be asked to do', async () => {
    const src = await source();
    expect(src).toContain('idv_flow');
  });

  it('reports secret presence for whichever flow is active, not one fixed pair', async () => {
    const src = await source();
    const block = src.slice(src.indexOf('idvAdapterReadiness('), src.indexOf('idv_flow'));
    // A hosted provider's readiness has nothing to do with the self-hosted
    // service's URL and token, and reporting those as its missing settings
    // sent an operator to check the wrong thing.
    expect(block).toContain('DIDIT_API_KEY');
    expect(block).toContain('AML_VERIFICATION_SERVICE_URL');
  });
});

describe('what the Command Centre asks the customer to do', () => {
  const section = () => import('node:fs').then(
    (fs) => fs.readFileSync('src/components/aml/VerificationSection.tsx', 'utf8'));

  it('reads the flow from readiness rather than assuming capture', async () => {
    const src = await section();
    expect(src).toContain('idv_flow === "hosted_session"');
  });

  it('never tells a hosted client to upload a document and skip the selfie', async () => {
    const src = await section();
    const request = src.slice(
      src.indexOf('const requestVerification'), src.indexOf('const electronic', src.indexOf('const requestVerification')) + 2000);

    // Three distinct messages, and the "no selfie needed" one is reachable
    // only when electronic verification is off entirely.
    const noSelfie = 'You do not need to take a selfie.';
    expect(src).toContain(noSelfie);
    const branch = src.slice(src.indexOf('electronic && hosted'), src.indexOf(noSelfie));
    // The hosted branch is decided before the fallback copy is reached.
    expect(branch).toContain('electronic && hosted');
    expect(branch).not.toContain(noSelfie);
    void request;
  });

  it('tells a hosted client they will complete it on their own device', async () => {
    const src = await section();
    const from = src.indexOf('electronic && hosted');
    const hostedCopy = src.slice(from, src.indexOf(': electronic', from));
    expect(hostedCopy.length).toBeGreaterThan(0);
    expect(hostedCopy).toMatch(/on your own device/i);
    // And never promises them an upload step that the provider owns.
    expect(hostedCopy).not.toMatch(/upload/i);
  });
});

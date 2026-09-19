import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Readiness must be evidence, not inference.
 *
 * It used to be computed from secret presence alone and said so in its own
 * note: "not a claim that any provider call has been made". Two secrets
 * pointing at a dead container reported `ready_live` — staff saw a ready
 * provider, and clients were offered a camera whose capture could never be
 * examined. Collecting a face with no purpose that can be served is exactly
 * what APP 3 forbids.
 */

const env: Record<string, string> = {};
beforeEach(() => {
  for (const k of Object.keys(env)) delete env[k];
  Object.assign(env, {
    AML_ENVIRONMENT: 'production',
    AML_VERIFICATION_SERVICE_URL: 'https://verify.example.internal',
    AML_VERIFICATION_SERVICE_TOKEN: 'service-token',
  });
  (globalThis as any).Deno = { env: { get: (k: string) => env[k] } };
  vi.resetModules();
});
afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as any).Deno;
});

const probe = async () => {
  const m = await import('../../../supabase/functions/_shared/aml/providers/index.ts');
  return m.checkSelfHostedIdvHealth();
};

const healthz = (body: unknown, status = 200) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

describe('self-hosted service health probe', () => {
  it('is healthy only when the service answers ok', async () => {
    healthz({ status: 'ok', models: { yunet: true, sface: true }, token_configured: true });
    const h = await probe();
    expect(h).toEqual({ reachable: true, status: 'ok', detail: null });
  });

  it('is not healthy when a model is unusable, even though /healthz returns 200', async () => {
    // The Git LFS pointer case: the container is up and answering.
    healthz({ status: 'degraded', models: { yunet: false, sface: true }, token_configured: true });
    const h = await probe();
    expect(h.status).not.toBe('ok');
    expect(h.detail).toContain('yunet');
  });

  it('is not healthy when the service has no token configured', async () => {
    healthz({ status: 'degraded', models: { yunet: true, sface: true }, token_configured: false });
    expect((await probe()).detail).toBe('service_token_not_configured');
  });

  it('reports unreachable when the service does not answer', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('error sending request for url (https://verify.example.internal/healthz)'));
    const h = await probe();
    expect(h.reachable).toBe(false);
    expect(h.detail).toBe('healthz_unreachable');
  });

  it('reports a timeout without hanging the readiness screen', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      const err = new Error('aborted'); err.name = 'TimeoutError';
      return Promise.reject(err);
    });
    expect((await probe()).detail).toBe('healthz_timeout');
  });

  it('never leaks the service URL or token in the reason', async () => {
    // This value reaches the staff readiness card and the logs.
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('connect ECONNREFUSED https://verify.example.internal service-token'));
    const h = await probe();
    const serialised = JSON.stringify(h);
    expect(serialised).not.toContain('verify.example.internal');
    expect(serialised).not.toContain('service-token');
  });

  it('says the URL is unset rather than probing nothing', async () => {
    delete env.AML_VERIFICATION_SERVICE_URL;
    const spy = vi.spyOn(globalThis, 'fetch');
    expect((await probe()).detail).toBe('service_url_not_set');
    expect(spy).not.toHaveBeenCalled();
  });

  it('treats a non-200 /healthz as unhealthy but reachable', async () => {
    healthz({}, 503);
    const h = await probe();
    expect(h.reachable).toBe(true);
    expect(h.detail).toBe('healthz_http_503');
  });

  it('sends no Authorization header — /healthz is unauthenticated by design', async () => {
    const spy = healthz({ status: 'ok', models: { yunet: true, sface: true } });
    await probe();
    const init = spy.mock.calls[0][1] as RequestInit | undefined;
    expect(init?.method).toBe('GET');
    expect(JSON.stringify(init?.headers ?? {})).not.toMatch(/authorization/i);
  });
});

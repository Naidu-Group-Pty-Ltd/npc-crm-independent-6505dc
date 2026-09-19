/**
 * Obtaining the credential, including the federated one.
 *
 * The behaviour worth pinning here is all about failure and concurrency, not
 * the happy path: one exchange however many callers, a refresh that fails
 * serving the token it already holds, and a route that never federates past a
 * key. Each of those, got wrong, produces something that works in a test and
 * breaks a report generation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env: Record<string, string | undefined> = {};

const MC = 'https://mc.example';
const WORKSPACE = 'wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ';

const GRANT = {
  assertion: 'header.payload.signature',
  organization_id: '00000000-0000-0000-0000-000000000000',
  service_account_id: 'svac_01ABCDEFabcdef0123456789XY',
  federation_rule_id: 'fdrl_01ABCDEFabcdef0123456789XY',
  workspace_id: WORKSPACE,
};

function federatedEnv() {
  Object.assign(env, {
    MISSION_CONTROL_URL: MC,
    MISSION_CONTROL_CLONE_API_KEY: 'clone-key',
    ANTHROPIC_WORKSPACE_ID: WORKSPACE,
  });
}

function json(body: unknown, init?: { status?: number; headers?: Record<string, string> }) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
}

beforeEach(() => {
  for (const k of Object.keys(env)) delete env[k];
  (globalThis as any).Deno = { env: { get: (k: string) => env[k] } };
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  // Belt and braces: two tests below travel in time, and a failure part-way
  // through one of them would otherwise leak a mocked clock into the next.
  vi.useRealTimers();
  delete (globalThis as any).Deno;
});

async function load() {
  const m = await import('../../../supabase/functions/_shared/anthropicCredential.ts');
  m.resetAnthropicCredentialCache();
  return m;
}

describe('a key present is always used', () => {
  it('returns it without reaching the network', async () => {
    env.ANTHROPIC_API_KEY = 'sk-ant-api-x';
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { resolveAnthropicCredential } = await load();

    const result = await resolveAnthropicCredential();
    expect(result.ok && result.via).toBe('api_key');
    expect(result.ok && result.credential.kind).toBe('api_key');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  /*
   * The rule that protects a tenant who supplied their own credential: it
   * arrives under this same name, and federating past it would put Aurixa back
   * on the hook for calls they believe are theirs.
   */
  it('never federates past it, however complete the federation config is', async () => {
    federatedEnv();
    env.ANTHROPIC_API_KEY = 'sk-ant-api-tenant';
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { resolveAnthropicCredential } = await load();

    const result = await resolveAnthropicCredential();
    expect(result.ok && result.via).toBe('api_key');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('carries the workspace id so the call is attributed', async () => {
    env.ANTHROPIC_API_KEY = 'sk-ant-api-x';
    env.ANTHROPIC_WORKSPACE_ID = WORKSPACE;
    const { resolveAnthropicCredential } = await load();
    const result = await resolveAnthropicCredential();
    expect(result.ok && result.credential.workspaceId).toBe(WORKSPACE);
  });
});

describe('an unconfigured deployment', () => {
  it('says so rather than throwing', async () => {
    const { resolveAnthropicCredential } = await load();
    const result = await resolveAnthropicCredential();
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.end).toBe('unconfigured');
    expect(result.ok === false && result.why).toContain('ANTHROPIC_API_KEY');
  });

  it('reports configuration without reaching the network', async () => {
    federatedEnv();
    const { anthropicConfigured } = await load();
    expect(anthropicConfigured()).toBe(true);
  });
});

describe('the federated exchange', () => {
  it('asks Mission Control for an identity, then Anthropic for a token', async () => {
    federatedEnv();
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init: any) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith(MC)) {
        expect(init.headers['x-clone-api-key']).toBe('clone-key');
        expect(JSON.parse(init.body).workspace_id).toBe(WORKSPACE);
        return json(GRANT);
      }
      const body = JSON.parse(init.body);
      // Exactly the five fields Anthropic's jwt-bearer grant documents.
      expect(body.grant_type).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
      expect(body.assertion).toBe(GRANT.assertion);
      expect(body.federation_rule_id).toBe(GRANT.federation_rule_id);
      expect(body.organization_id).toBe(GRANT.organization_id);
      expect(body.service_account_id).toBe(GRANT.service_account_id);
      expect(body.workspace_id).toBe(WORKSPACE);
      return json({ access_token: 'sk-ant-oat01-y', expires_in: 3600 });
    });

    const { resolveAnthropicCredential } = await load();
    const result = await resolveAnthropicCredential();

    expect(result.ok && result.via).toBe('federated');
    expect(result.ok && result.credential.kind).toBe('access_token');
    expect(result.ok && result.credential.value).toBe('sk-ant-oat01-y');
    expect(result.ok && result.credential.workspaceId).toBe(WORKSPACE);
    expect(calls[0]).toBe(`${MC}/api/public/anthropic/identity`);
    expect(calls[1]).toBe('https://api.anthropic.com/v1/oauth/token');
  });

  it('reuses the token rather than exchanging per call', async () => {
    federatedEnv();
    let exchanges = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
      if (String(input).startsWith(MC)) return json(GRANT);
      exchanges += 1;
      return json({ access_token: `token-${exchanges}`, expires_in: 3600 });
    });

    const { resolveAnthropicCredential } = await load();
    await resolveAnthropicCredential();
    await resolveAnthropicCredential();
    await resolveAnthropicCredential();
    expect(exchanges).toBe(1);
  });

  /*
   * The one that matters most. A report generation fans out — seventeen
   * sections, four enrichment chapters — and an assertion carrying a `jti` is
   * accepted exactly ONCE. Without the single-flight guard every exchange
   * after the first is refused `jti_reused`, and a whole batch fails on what
   * is really a success.
   */
  it('runs one exchange for concurrent callers, because a jti is single-use', async () => {
    federatedEnv();
    let exchanges = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
      if (String(input).startsWith(MC)) return json(GRANT);
      exchanges += 1;
      if (exchanges > 1) return json({ error: 'jti_reused' }, { status: 400 });
      await new Promise((r) => setTimeout(r, 5));
      return json({ access_token: 'sk-ant-oat01-y', expires_in: 3600 });
    });

    const { resolveAnthropicCredential } = await load();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => resolveAnthropicCredential()),
    );

    expect(exchanges).toBe(1);
    for (const r of results) expect(r.ok).toBe(true);
  });

  /*
   * Anthropic bounds a minted token at twice the assertion's remaining life,
   * so it is routinely SHORTER than the rule configures. A cache that believed
   * the configured lifetime would serve an expired token.
   */
  it('trusts the answer’s own expiry, not a configured one', async () => {
    federatedEnv();
    let exchanges = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
      if (String(input).startsWith(MC)) return json(GRANT);
      exchanges += 1;
      // 130s: past the advisory window (120s) almost immediately.
      return json({ access_token: `token-${exchanges}`, expires_in: 130 });
    });

    const { resolveAnthropicCredential } = await load();
    await resolveAnthropicCredential();
    vi.setSystemTime(new Date(Date.now() + 20_000));
    await resolveAnthropicCredential();
    expect(exchanges).toBe(2);
    vi.useRealTimers();
  });
});

describe('failures name the end that failed', () => {
  it('separates Mission Control refusing from Anthropic refusing', async () => {
    federatedEnv();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
      if (String(input).startsWith(MC)) {
        return json({ error: 'not_federated' }, {
          status: 403,
          headers: { 'x-mission-control-refusal': 'not_federated' },
        });
      }
      return json({});
    });

    const { resolveAnthropicCredential } = await load();
    const result = await resolveAnthropicCredential();
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.end).toBe('mission_control');
    // Read from the header, never guessed from the body: both ends answer with
    // similar JSON and send an operator to opposite remedies.
    expect(result.ok === false && result.why).toContain('not_federated');
  });

  it('names Anthropic when the vendor refuses the exchange', async () => {
    federatedEnv();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
      if (String(input).startsWith(MC)) return json(GRANT);
      return json({ error: 'invalid_grant' }, { status: 401 });
    });

    const { resolveAnthropicCredential } = await load();
    const result = await resolveAnthropicCredential();
    expect(result.ok === false && result.end).toBe('anthropic');
  });

  it('refuses an incomplete identity rather than exchanging half of one', async () => {
    federatedEnv();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
      if (String(input).startsWith(MC)) {
        return json({ assertion: 'x', workspace_id: WORKSPACE });
      }
      throw new Error('should not have reached Anthropic');
    });

    const { resolveAnthropicCredential } = await load();
    const result = await resolveAnthropicCredential();
    expect(result.ok === false && result.end).toBe('mission_control');
    expect(result.ok === false && result.why).toContain('incomplete');
  });

  /*
   * The two-tier refresh. Inside the advisory window a failed exchange serves
   * the cached token, which is still valid — taking inference down for a
   * momentary token-endpoint failure is far worse than the alternative.
   */
  it('serves the cached token when an advisory refresh fails', async () => {
    federatedEnv();
    let exchanges = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
      if (String(input).startsWith(MC)) {
        if (exchanges >= 1) return json({ error: 'down' }, { status: 503 });
        return json(GRANT);
      }
      exchanges += 1;
      return json({ access_token: 'sk-ant-oat01-first', expires_in: 200 });
    });

    const { resolveAnthropicCredential } = await load();
    const first = await resolveAnthropicCredential();
    expect(first.ok && first.credential.value).toBe('sk-ant-oat01-first');

    // 100s in: inside the advisory window (expiry - 120s), outside the
    // mandatory one (expiry - 30s).
    vi.setSystemTime(new Date(Date.now() + 100_000));
    const second = await resolveAnthropicCredential();
    expect(second.ok).toBe(true);
    expect(second.ok && second.credential.value).toBe('sk-ant-oat01-first');
    vi.useRealTimers();
  });
});

/*
 * The reach probe.
 *
 * Two properties carry it, and both are the kind that a test which only
 * checked the happy path would miss: it must never hand a credential value to
 * whoever asked, and it must never be able to disturb the inference path it
 * reports on. A diagnostic that breaks the thing it measures is worse than no
 * diagnostic.
 */
describe('describeAnthropicReach', () => {
  it('reports an unconfigured deployment without calling anything', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { describeAnthropicReach } = await load();

    const { reach } = await describeAnthropicReach();
    expect(reach.route).toBe('unconfigured');
    expect(reach.ok).toBe(false);
    expect(reach.end).toBe('unconfigured');
    expect(reach.modelCount).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('proves a key route with the model list, which costs no tokens', async () => {
    env.ANTHROPIC_API_KEY = 'sk-ant-api-x';
    env.ANTHROPIC_WORKSPACE_ID = WORKSPACE;
    const urls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init: any) => {
      urls.push(String(input));
      expect(init.headers['x-api-key']).toBe('sk-ant-api-x');
      expect(init.headers['anthropic-workspace-id']).toBe(WORKSPACE);
      return json({ data: [{ id: 'claude-a' }, { id: 'claude-b' }] });
    });

    const { describeAnthropicReach } = await load();
    const { reach } = await describeAnthropicReach();

    expect(reach.ok).toBe(true);
    expect(reach.route).toBe('api_key');
    expect(reach.credentialKind).toBe('api_key');
    expect(reach.modelCount).toBe(2);
    expect(reach.workspaceId).toBe(WORKSPACE);
    // Metadata, never a message: proving a credential can complete a model
    // call would bill the tenant on every click.
    expect(urls).toEqual(['https://api.anthropic.com/v1/models']);
  });

  /*
   * The one that matters most. A reach reading travels to Mission Control and
   * onto an operator's screen, so anything it carries is as good as published.
   */
  it('never carries the credential value, on success or on failure', async () => {
    federatedEnv();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
      if (String(input).startsWith(MC)) return json(GRANT);
      if (String(input).includes('/oauth/token')) {
        return json({ access_token: 'sk-ant-oat01-secret', expires_in: 3600 });
      }
      return json({ data: [{ id: 'claude-a' }] });
    });

    const { describeAnthropicReach } = await load();
    const { reach } = await describeAnthropicReach({ freshCredential: true });

    expect(reach.ok).toBe(true);
    expect(reach.credentialKind).toBe('access_token');
    expect(JSON.stringify(reach)).not.toContain('sk-ant-oat01-secret');
    expect(JSON.stringify(reach)).not.toContain('clone-key');
  });

  /*
   * A diagnostic must not be able to break inference. `freshCredential` runs
   * its own exchange, and banking that token would hand the next report a
   * credential obtained for a different purpose — and let a probe that ran
   * first mask a chain that had already broken.
   */
  it('does not bank its own token, so the next caller still exchanges', async () => {
    federatedEnv();
    let exchanges = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
      if (String(input).startsWith(MC)) return json(GRANT);
      if (String(input).includes('/oauth/token')) {
        exchanges += 1;
        return json({ access_token: `token-${exchanges}`, expires_in: 3600 });
      }
      return json({ data: [] });
    });

    const { describeAnthropicReach, resolveAnthropicCredential } = await load();
    await describeAnthropicReach({ freshCredential: true });
    expect(exchanges).toBe(1);

    const after = await resolveAnthropicCredential();
    expect(exchanges).toBe(2);
    expect(after.ok && after.credential.value).toBe('token-2');
  });

  /*
   * And the converse: without `freshCredential` it must NOT clear what is
   * already held, because the catalog sweep runs on that path.
   */
  it('leaves a cached token in place when it is not asked for a fresh one', async () => {
    federatedEnv();
    let exchanges = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
      if (String(input).startsWith(MC)) return json(GRANT);
      if (String(input).includes('/oauth/token')) {
        exchanges += 1;
        return json({ access_token: `token-${exchanges}`, expires_in: 3600 });
      }
      return json({ data: [] });
    });

    const { describeAnthropicReach, resolveAnthropicCredential } = await load();
    await resolveAnthropicCredential();
    await describeAnthropicReach();
    expect(exchanges).toBe(1);
  });

  it('names Mission Control when the identity is refused, not the vendor', async () => {
    federatedEnv();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
      if (String(input).startsWith(MC)) {
        return json({ error: 'not_federated' }, {
          status: 403,
          headers: { 'x-mission-control-refusal': 'not_federated' },
        });
      }
      throw new Error('should not have reached Anthropic');
    });

    const { describeAnthropicReach } = await load();
    const { reach } = await describeAnthropicReach({ freshCredential: true });
    expect(reach.ok).toBe(false);
    expect(reach.end).toBe('mission_control');
    expect(reach.route).toBe('federated');
  });

  /*
   * A workspace the credential may not act in is a configuration fault with
   * its own remedy. Read as a generic vendor failure it looks like an outage
   * to wait out, which is the wrong thing for anybody to do.
   */
  it('separates a workspace fault from a vendor one', async () => {
    env.ANTHROPIC_API_KEY = 'sk-ant-api-x';
    env.ANTHROPIC_WORKSPACE_ID = WORKSPACE;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      json({ error: { message: 'workspace not found' } }, { status: 404 })
    );

    const { describeAnthropicReach } = await load();
    const { reach } = await describeAnthropicReach();
    expect(reach.ok).toBe(false);
    expect(reach.end).toBe('workspace');
    expect(reach.why).toContain(WORKSPACE);
  });

  it('reports a route that resolved and was then refused as still configured', async () => {
    env.ANTHROPIC_API_KEY = 'sk-ant-api-x';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      json({ error: 'unauthorized' }, { status: 401 })
    );

    const { describeAnthropicReach } = await load();
    const { reach } = await describeAnthropicReach();
    // `route` is what the environment says and `ok` is what happened. An
    // operator told "no key" would go and set one that is already there.
    expect(reach.route).toBe('api_key');
    expect(reach.ok).toBe(false);
    expect(reach.end).toBe('anthropic');
  });
});

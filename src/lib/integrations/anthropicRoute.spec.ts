/**
 * The Anthropic route: one module decides, and no function names the vendor.
 *
 * This is the Airtable rule (`airtableListingsRoute.pure.ts`, asserted over
 * five pipeline functions) applied to the model vendor. It exists because the
 * class it prevents has already been paid for twice in this repository: a
 * credential read inline at eight call sites drifts, and a capability decided
 * from `!!Deno.env.get(...)` at module load silently changes which vendor
 * serves a feature.
 *
 * Two of these tests are source-level scans rather than behaviour. That is
 * deliberate and matches `turnstileIdentity.spec.ts`: the property being
 * protected is "there is exactly one place that knows this", which no amount
 * of exercising a function can establish.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  ANTHROPIC_MESSAGES_URL,
  ANTHROPIC_MODELS_URL,
  ANTHROPIC_TOKEN_URL,
  ANTHROPIC_WORKSPACE_HEADER,
  type AnthropicCredential,
  anthropicJsonHeaders,
  anthropicRequestHeaders,
  anthropicWorkspaceIdRefusal,
  describeAnthropicFailure,
  readWorkspaceId,
  resolveAnthropicRoute,
} from '../../../supabase/functions/_shared/anthropicRoute.pure';

const FUNCTIONS_DIR = join(process.cwd(), 'supabase', 'functions');

/**
 * Who may name the host.
 *
 * `anthropicRoute.pure.ts` is the decision. `intelligence.pure.ts` is the
 * Workflow Playground CATALOG, where the URL is a `request` descriptor the
 * executor reads — data about an operation rather than a call — and its auth
 * is declared as `secret: 'ANTHROPIC_API_KEY'`, the tenant's own key from the
 * Integrations page. A federated token is not a secret NAME, so that
 * descriptor cannot carry one, and a Playground step running on the tenant's
 * credential is spending the tenant's money either way. It is deliberately out
 * of the seam; the test below holds it to being a declaration.
 */
const MAY_NAME_THE_HOST = new Set(['anthropicRoute.pure.ts', 'intelligence.pure.ts']);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

const SOURCES = walk(FUNCTIONS_DIR).map((path) => ({
  path,
  name: path.split('/').pop()!,
  text: readFileSync(path, 'utf8'),
}));

/** Lines that are code rather than prose, so a header may discuss what it forbids. */
function codeLines(text: string): string[] {
  return text.split('\n').filter((line) => {
    const t = line.trim();
    return t !== '' && !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
  });
}

describe('no edge function names api.anthropic.com itself', () => {
  it('leaves the host to one module', () => {
    const offenders = SOURCES
      .filter((f) => !MAY_NAME_THE_HOST.has(f.name))
      .filter((f) => codeLines(f.text).some((l) => l.includes('api.anthropic.com')))
      .map((f) => f.path.replace(`${process.cwd()}/`, ''));

    expect(offenders).toEqual([]);
  });

  it('keeps the workflow catalog a declaration rather than a call site', () => {
    const catalog = SOURCES.find((f) => f.name === 'intelligence.pure.ts');
    expect(catalog, 'the workflow intelligence catalog should exist').toBeTruthy();
    // A pure catalog module that grew a fetch would be a second, unguarded way
    // to reach the vendor — which is the whole thing this seam prevents.
    expect(codeLines(catalog!.text).some((l) => /\bfetch\s*\(/.test(l))).toBe(false);
  });

  it('names all three endpoints in that one module', () => {
    expect(ANTHROPIC_MESSAGES_URL).toBe('https://api.anthropic.com/v1/messages');
    expect(ANTHROPIC_MODELS_URL).toBe('https://api.anthropic.com/v1/models');
    expect(ANTHROPIC_TOKEN_URL).toBe('https://api.anthropic.com/v1/oauth/token');
  });
});

describe('the credential is never decided at module load', () => {
  /*
   * The exact expression this forbids shipped twice — in `designBrief.ts` and
   * in `template-design-agent`, where it gated the whole Claude PDF path. Both
   * resolve `false` on a deployment that federates, and the feature changes
   * vendor with nothing reporting it.
   */
  it('never derives a capability from a module-scope env read', () => {
    const pattern = /^\s*const\s+\w+\s*=\s*!!?\s*(ANTHROPIC_\w+|Deno\.env\.get\(\s*['"]ANTHROPIC_API_KEY['"]\s*\))/;
    const offenders = SOURCES
      .filter((f) => codeLines(f.text).some((l) => pattern.test(l)))
      .map((f) => f.path.replace(`${process.cwd()}/`, ''));

    expect(offenders).toEqual([]);
  });

  it('leaves reading ANTHROPIC_API_KEY to the credential module', () => {
    const allowed = new Set(['anthropicCredential.ts']);
    const offenders = SOURCES
      .filter((f) => !allowed.has(f.name))
      .filter((f) => codeLines(f.text).some((l) => /Deno\.env\.get\(\s*['"]ANTHROPIC_API_KEY['"]/.test(l)))
      .map((f) => f.path.replace(`${process.cwd()}/`, ''));

    /*
     * `check-integration-secrets` and `integrationSecrets` name the STRING as
     * configuration they report on, which is a different act from spending it.
     * Anything else reading it is a call site that escaped the seam.
     */
    expect(offenders).toEqual([]);
  });
});

describe('resolveAnthropicRoute', () => {
  const base = {
    apiKey: null,
    workspaceId: null,
    missionControlUrl: null,
    cloneApiKey: null,
  };

  it('uses a key whenever one is present', () => {
    expect(resolveAnthropicRoute({ ...base, apiKey: 'sk-ant-api-x' })).toEqual({
      via: 'api_key',
      apiKey: 'sk-ant-api-x',
      workspaceId: null,
    });
  });

  it('carries the workspace id alongside the key', () => {
    const route = resolveAnthropicRoute({
      ...base,
      apiKey: 'sk-ant-api-x',
      workspaceId: 'wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ',
    });
    expect(route).toMatchObject({ via: 'api_key', workspaceId: 'wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ' });
  });

  /*
   * The rule that protects a tenant who supplied their own credential. Their
   * key arrives under this same name; federating past it would put Aurixa back
   * on the hook for calls they believe they are paying for.
   */
  it('never federates past a key, however complete the federation config is', () => {
    const route = resolveAnthropicRoute({
      apiKey: 'sk-ant-api-tenant',
      workspaceId: 'wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ',
      missionControlUrl: 'https://mc.example',
      cloneApiKey: 'clone-key',
    });
    expect(route.via).toBe('api_key');
  });

  it('federates only with all three of Mission Control, a clone key and a workspace', () => {
    expect(
      resolveAnthropicRoute({
        ...base,
        workspaceId: 'wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ',
        missionControlUrl: 'https://mc.example/',
        cloneApiKey: 'clone-key',
      }),
    ).toEqual({
      via: 'federated',
      missionControlUrl: 'https://mc.example',
      cloneApiKey: 'clone-key',
      workspaceId: 'wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ',
    });
  });

  it('says which half is missing when it can reach Mission Control but has no workspace', () => {
    const route = resolveAnthropicRoute({
      ...base,
      missionControlUrl: 'https://mc.example',
      cloneApiKey: 'clone-key',
    });
    expect(route.via).toBe('unconfigured');
    expect(route.via === 'unconfigured' && route.why).toContain('ANTHROPIC_WORKSPACE_ID');
  });

  it('is unconfigured, not broken, with nothing set', () => {
    const route = resolveAnthropicRoute(base);
    expect(route.via).toBe('unconfigured');
    expect(route.via === 'unconfigured' && route.why).toContain('ANTHROPIC_API_KEY');
  });

  it('treats whitespace as absent', () => {
    expect(resolveAnthropicRoute({ ...base, apiKey: '   ' }).via).toBe('unconfigured');
  });
});

describe('readWorkspaceId', () => {
  it('accepts a real workspace id', () => {
    expect(readWorkspaceId('wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ')).toBe('wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ');
  });

  it('refuses anything that is not one, rather than putting it in a header', () => {
    expect(readWorkspaceId('Default')).toBeNull();
    expect(readWorkspaceId('wrkspc_')).toBeNull();
    expect(readWorkspaceId('proj_01JwQvzr7rXLA5AGx3H')).toBeNull();
  });

  it('says nothing about an absent id and explains a malformed one', () => {
    expect(anthropicWorkspaceIdRefusal(null)).toBeNull();
    expect(anthropicWorkspaceIdRefusal('wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ')).toBeNull();
    expect(anthropicWorkspaceIdRefusal('Default')).toContain('wrkspc_');
  });

  /*
   * A malformed id must not take Anthropic down. It is configuration written
   * by another system, and the deployment should still reach the vendor
   * exactly as it did before the id existed.
   */
  it('does not make a malformed id unconfigure the deployment', () => {
    const route = resolveAnthropicRoute({
      apiKey: 'sk-ant-api-x',
      workspaceId: 'not-a-workspace',
      missionControlUrl: null,
      cloneApiKey: null,
    });
    expect(route).toEqual({ via: 'api_key', apiKey: 'sk-ant-api-x', workspaceId: null });
  });
});

describe('anthropicRequestHeaders', () => {
  const key: AnthropicCredential = { kind: 'api_key', value: 'sk-ant-api-x', workspaceId: null };
  const token: AnthropicCredential = {
    kind: 'access_token',
    value: 'sk-ant-oat01-y',
    workspaceId: 'wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ',
  };

  /*
   * These two are not interchangeable. A federated token sent as `x-api-key`
   * is a 401 that reads exactly like a bad key.
   */
  it('sends a static key as x-api-key and a federated token as a bearer', () => {
    expect(anthropicRequestHeaders(key)['x-api-key']).toBe('sk-ant-api-x');
    expect(anthropicRequestHeaders(key).authorization).toBeUndefined();

    expect(anthropicRequestHeaders(token).authorization).toBe('Bearer sk-ant-oat01-y');
    expect(anthropicRequestHeaders(token)['x-api-key']).toBeUndefined();
  });

  it('omits the workspace header when there is no id to send', () => {
    expect(ANTHROPIC_WORKSPACE_HEADER in anthropicRequestHeaders(key)).toBe(false);
  });

  it('sends the workspace header when there is one', () => {
    expect(anthropicRequestHeaders(token)[ANTHROPIC_WORKSPACE_HEADER])
      .toBe('wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ');
  });

  it('always carries the API version', () => {
    expect(anthropicRequestHeaders(key)['anthropic-version']).toBe('2023-06-01');
  });

  it('adds the JSON content type only on the JSON helper', () => {
    expect(anthropicRequestHeaders(key)['content-type']).toBeUndefined();
    expect(anthropicJsonHeaders(key)['content-type']).toBe('application/json');
  });
});

describe('describeAnthropicFailure', () => {
  const workspaceId = 'wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ';

  /*
   * Anthropic answers 404 identically whether the workspace does not exist or
   * the credential simply may not act in it — and both are configuration on
   * our side. Read as a generic vendor failure it looks like an outage and
   * somebody waits for it to clear.
   */
  it('names a workspace 404 as configuration rather than an outage', () => {
    const failure = describeAnthropicFailure({
      status: 404,
      body: '{"error":{"message":"Workspace `wrkspc_x` not found."}}',
      workspaceId,
    });
    expect(failure.end).toBe('workspace');
    expect(failure.message).toContain('configuration fault rather than an outage');
  });

  it('names a rejected workspace header', () => {
    const failure = describeAnthropicFailure({
      status: 400,
      body: 'anthropic-workspace-id header must be a valid workspace ID.',
      workspaceId,
    });
    expect(failure.end).toBe('workspace');
  });

  it('leaves an ordinary vendor refusal as the vendor’s', () => {
    const failure = describeAnthropicFailure({ status: 429, body: 'rate limited', workspaceId });
    expect(failure.end).toBe('anthropic');
    expect(failure.message).toContain('429');
  });

  it('does not read a 404 as a workspace fault when no workspace was named', () => {
    const failure = describeAnthropicFailure({
      status: 404,
      body: 'workspace missing',
      workspaceId: null,
    });
    expect(failure.end).toBe('anthropic');
  });
});

/*
 * The reach probe's answer leaves this deployment.
 *
 * Mission Control asks for it over the webhook and renders it on an operator's
 * screen, so whatever the handler returns is effectively published. The
 * behaviour test beside this one proves the value is absent from a real
 * reading; this proves the handler cannot start returning one by accident,
 * which is the edit somebody makes while debugging and does not undo.
 */
describe('the self-test answer carries no credential', () => {
  const handler = readFileSync(
    join(FUNCTIONS_DIR, "mission-control-webhook", "index.ts"),
    'utf8',
  );

  it('answers the probe with the reach and nothing else', () => {
    const block = /anthropic\.selftest[\s\S]*?\n {2}}\n/.exec(handler)?.[0] ?? '';
    expect(block).toContain('describeAnthropicReach');
    expect(block).toContain('reach');
    // `credential` is the field on a CredentialResult that holds the value.
    expect(block).not.toContain('credential');
    expect(block).not.toContain('resolveAnthropicCredential');
  });

  it('asks for a fresh chain rather than whatever is cached', () => {
    // A cached token outlives the chain that minted it by up to an hour, so a
    // probe that accepted one answers green for an hour after federation
    // broke — which is the stale reading it exists to replace.
    expect(handler).toContain('freshCredential: true');
  });
});

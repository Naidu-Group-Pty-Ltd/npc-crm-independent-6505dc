import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INTEGRATIONS, getSupabaseSecretName } from './registry';
import { ALLOWED_INTEGRATION_SECRETS } from '../../../supabase/functions/_shared/integrationSecrets';
import {
  DEPLOYMENT_IDENTITY_PREFIXES,
  DEPLOYMENT_IDENTITY_SECRETS,
  deploymentIdentityRefusal,
} from '../../../supabase/functions/_shared/deploymentIdentitySecrets.pure';
import {
  describeSecretWriteFailure,
  integrationSecretBrokerUrl,
  ownProjectRefFromUrl,
  looksLikeManagementToken,
  resolveIntegrationSecretRoute,
} from '../../../supabase/functions/_shared/integrationSecretRoute.pure';

const FUNCTIONS = resolve(__dirname, '../../../supabase/functions');
const read = (rel: string) => readFileSync(resolve(FUNCTIONS, rel), 'utf8');

const PRIME_REF = 'dduzbchuswwbefdunfct';
const CLONE_REF = 'umrtusxohxjxzodxorim';

describe('a key typed on the page reaches the runtime', () => {
  it('GoHighLevel offers the two fields the runtime reads, under the names it reads', () => {
    // The whole of the first integration to be tested end to end. The page
    // collects GHL_*; `SUPABASE_SECRET_ALIASES` maps them onto GOHIGHLEVEL_*;
    // `_shared/ghl-account.ts` reads GOHIGHLEVEL_* out of the environment. A
    // break anywhere along that chain is invisible — an unmapped name is
    // written to the environment under a spelling nothing looks for.
    const card = INTEGRATIONS.find((i) => i.id === 'gohighlevel');
    expect(card, 'the GoHighLevel card must exist').toBeDefined();

    const byName = Object.fromEntries(
      card!.fields.map((f) => [getSupabaseSecretName(f.key), f]),
    );
    expect(Object.keys(byName).sort()).toEqual(['GOHIGHLEVEL_API_KEY', 'GOHIGHLEVEL_LOCATION_ID']);
    expect(byName.GOHIGHLEVEL_API_KEY.type).toBe('password');
    expect(byName.GOHIGHLEVEL_LOCATION_ID.label).toMatch(/location id/i);

    // Both are on the allow-list the write endpoint checks...
    for (const name of Object.keys(byName)) {
      expect(ALLOWED_INTEGRATION_SECRETS.has(name), `${name} must be writable`).toBe(true);
      expect(deploymentIdentityRefusal(name), `${name} must not be refused`).toBeNull();
    }
    // ...and both are what the runtime actually asks the environment for.
    const runtime = read('_shared/ghl-account.ts');
    expect(runtime).toContain("Deno.env.get('GOHIGHLEVEL_API_KEY')");
    expect(runtime).toContain("Deno.env.get('GOHIGHLEVEL_LOCATION_ID')");
  });

  it('Save performs the whole act, and there is no second button', () => {
    // The defect: two buttons for one act, and the one an operator presses
    // wrote a row the product's runtime never reads. `saveIntegration` now
    // applies to the runtime FIRST and records the workflow row second.
    const page = readFileSync(resolve(__dirname, '../../pages/Integrations.tsx'), 'utf8');
    expect(page).toContain('applyToRuntime');
    expect(page).not.toContain('syncToSupabase');

    const apply = page.indexOf('const runtime = await applyToRuntime(integration)');
    const row = page.indexOf("table: 'integration_configs'", apply);
    expect(apply, 'saveIntegration must apply to the runtime').toBeGreaterThan(-1);
    expect(row, 'the workflow row is written after the runtime, not before').toBeGreaterThan(apply);
  });

  it('the workflow engine still has the store it reads', () => {
    // `integration_configs` is not dead. It is exactly one consumer's store —
    // a Workflow Playground step resolving the credentials it names — which is
    // why Save writes both and not only the environment.
    expect(read('_shared/workflow/stepExecutor.ts')).toContain(
      "from('integration_configs').select('key_name, key_value')",
    );
  });
});

describe('what the page may never write', () => {
  it('refuses the names that decide who a deployment is', () => {
    for (const name of [
      'SUPABASE_ACCESS_TOKEN',
      'SB_MANAGEMENT_ACCESS_TOKEN',
      'SUPABASE_SERVICE_ROLE_KEY',
      'MISSION_CONTROL_URL',
      'MISSION_CONTROL_CLONE_API_KEY',
      'TURNSTILE_SECRET_KEY',
      'GITHUB_TOKEN',
      'STRIPE_SECRET_KEY',
      'INTERNAL_FUNCTION_SECRET',
    ]) {
      expect(deploymentIdentityRefusal(name), `${name} must be refused`).not.toBeNull();
    }
  });

  it('is the control rather than defence in depth, because the allow-list carries eleven of them', () => {
    // The allow-list is GENERATED from this registry, so a credential field on
    // any new card becomes writable. Eleven deployment-identity names are
    // already on it, and every one becomes tenant-settable the moment the
    // brokered write opens. Measured 10 Sep 2026.
    const reachable = [...DEPLOYMENT_IDENTITY_SECRETS].filter((n) =>
      ALLOWED_INTEGRATION_SECRETS.has(n),
    );
    expect(reachable.length).toBeGreaterThanOrEqual(11);
    for (const name of reachable) {
      expect(deploymentIdentityRefusal(name)).not.toBeNull();
    }
  });

  it('permits an ordinary vendor key, including one that supersedes ours', () => {
    // Superseding is the POINT: a workspace that brings its own OpenAI key
    // must be able to, and the platform must then stop being charged for it.
    for (const name of [
      'GOHIGHLEVEL_API_KEY',
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'RESEND_API_KEY',
      'DOMAIN_API_KEY',
    ]) {
      expect(deploymentIdentityRefusal(name), `${name} must be writable`).toBeNull();
    }
  });

  it('refuses the whole internal signing family by prefix', () => {
    expect(DEPLOYMENT_IDENTITY_PREFIXES).toContain('INTERNAL_');
    expect(deploymentIdentityRefusal('INTERNAL_ANYTHING')).not.toBeNull();
  });

  it('the endpoint refuses before the allow-list, in the operator’s terms', () => {
    const fn = read('update-integration-secret/index.ts');
    const identity = fn.indexOf('deploymentIdentityRefusal(secret.name)');
    const allowlist = fn.indexOf('ALLOWED_SECRETS.has(secret.name)');
    expect(identity).toBeGreaterThan(-1);
    expect(allowlist).toBeGreaterThan(identity);
    // "Not in allowlist" reads as a typo. This is a rule, and it names what IS
    // permitted so the message is not a dead end.
    expect(deploymentIdentityRefusal('MISSION_CONTROL_URL')).toMatch(/vendor keys on this page/i);
  });
});

describe('where the write goes', () => {
  const direct = {
    managementToken: 'sbp_live',
    managementTokenSource: 'SB_MANAGEMENT_ACCESS_TOKEN' as const,
    supabaseUrl: `https://${PRIME_REF}.supabase.co`,
    missionControlUrl: 'https://mission-control.aurixasystems.com.au',
    cloneApiKey: 'ak_live',
  };

  it('a deployment holding a management token writes its own project', () => {
    const r = resolveIntegrationSecretRoute(direct);
    expect(r.via).toBe('direct');
    if (r.via !== 'direct') return;
    expect(r.projectRef).toBe(PRIME_REF);
    expect(r.tokenSource).toBe('SB_MANAGEMENT_ACCESS_TOKEN');
    expect(r.secret).toBe('sbp_live');
  });

  it('a clone brokers, and its route names no project at all', () => {
    const r = resolveIntegrationSecretRoute({ ...direct, managementToken: null });
    expect(r.via).toBe('broker');
    if (r.via !== 'broker') return;
    // Structural, not a convention: there is no projectRef field on the
    // brokered branch, so nothing can put one into a brokered request even by
    // mistake. Mission Control derives it from the key it was presented.
    expect('projectRef' in r).toBe(false);
    expect(r.headers['x-clone-api-key']).toBe('ak_live');
    expect(integrationSecretBrokerUrl(r)).toBe(
      'https://mission-control.aurixasystems.com.au/api/public/integrations/secrets',
    );
  });

  it('trims a path off MISSION_CONTROL_URL and says it did', () => {
    // Measured 8 Sep 2026 on the listings broker: `…/api` composed
    // `…/api/api/public/…`, which Mission Control answers 404 with none of its
    // own headers on — indistinguishable from the vendor's own 404. Trimmed
    // rather than refused, and reported rather than silent.
    const r = resolveIntegrationSecretRoute({
      ...direct,
      managementToken: null,
      missionControlUrl: 'https://mission-control.aurixasystems.com.au/api/',
    });
    expect(r.via).toBe('broker');
    if (r.via !== 'broker') return;
    expect(r.trimmedPath).toBe('/api');
    expect(integrationSecretBrokerUrl(r)).toBe(
      'https://mission-control.aurixasystems.com.au/api/public/integrations/secrets',
    );
  });

  it('a management token with no readable project is unconfigured, never brokered', () => {
    // Brokering it would write this operator's key onto whichever project the
    // Mission Control key resolves to, which may not be the one they are
    // looking at.
    const r = resolveIntegrationSecretRoute({ ...direct, supabaseUrl: 'not a url' });
    expect(r.via).toBe('unconfigured');
    if (r.via !== 'unconfigured') return;
    expect(r.why).toContain('SUPABASE_URL');
  });

  it('says what a deployment with neither is missing, and does not ask for a management token first', () => {
    const r = resolveIntegrationSecretRoute({
      managementToken: null,
      supabaseUrl: `https://${CLONE_REF}.supabase.co`,
      missionControlUrl: null,
      cloneApiKey: null,
    });
    expect(r.via).toBe('unconfigured');
    if (r.via !== 'unconfigured') return;
    // The ordinary arrangement is named FIRST. A clone told to go and fetch a
    // Supabase personal access token is being sent after the one credential
    // that must never sit on its project.
    expect(r.why.indexOf('MISSION_CONTROL_URL')).toBeLessThan(
      r.why.indexOf('SB_MANAGEMENT_ACCESS_TOKEN'),
    );
  });

  it('says the broker serves provisioned workspaces, so the prime is not sent to it', () => {
    // Naming the broker first is not the same as naming it for everyone, and
    // the message used to read as though it were. Mission Control refuses a
    // prime-scoped key 403 `not_a_clone_key` and refuses the prime's own
    // project as a target, so an operator who followed this advice on the
    // prime traded an honest 400 for a 403 that looks configured.
    const r = resolveIntegrationSecretRoute({
      managementToken: null,
      supabaseUrl: `https://${CLONE_REF}.supabase.co`,
      missionControlUrl: null,
      cloneApiKey: null,
    });
    expect(r.via).toBe('unconfigured');
    if (r.via !== 'unconfigured') return;
    // Both routes are named, and the broker's audience is stated rather than
    // implied. The assertions are on the CLAIM, not on the wording around it.
    expect(r.why).toContain('MISSION_CONTROL_CLONE_API_KEY');
    expect(r.why).toContain('SB_MANAGEMENT_ACCESS_TOKEN');
    expect(r.why.toLowerCase()).toContain('provisioned');
    expect(r.why.toLowerCase()).toContain('prime');
  });

  it('reads a project ref only from a real project URL', () => {
    expect(ownProjectRefFromUrl(`https://${CLONE_REF}.supabase.co`)).toBe(CLONE_REF);
    expect(ownProjectRefFromUrl('https://short.supabase.co')).toBeNull();
    expect(ownProjectRefFromUrl('http://localhost:54321')).toBeNull();
    expect(ownProjectRefFromUrl(null)).toBeNull();
  });
});

/**
 * Measured on the live clone `plisdzywzleljorrphxv`, 12 Sep 2026.
 *
 * `SB_MANAGEMENT_ACCESS_TOKEN` was SET to a value that is not a Supabase
 * personal access token: the Management API answered
 * `401 {"message":"JWT could not be decoded"}`. The route is chosen on
 * PRESENCE, so that dead value took `direct` and disabled a Mission Control
 * broker that was answering 200 at the same moment — and the page told a
 * tenant to rotate a Supabase ACCOUNT token, which is the one credential the
 * whole brokered arrangement exists to keep off their project.
 */
describe('presence is not capability', () => {
  const cloneWithDeadToken = {
    managementToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.not-a-pat',
    managementTokenSource: 'SB_MANAGEMENT_ACCESS_TOKEN' as const,
    supabaseUrl: `https://${PRIME_REF}.supabase.co`,
    missionControlUrl: 'https://mission-control.aurixasystems.com.au',
    cloneApiKey: 'ak_live',
  };

  it('knows a token from a string that is merely set', () => {
    expect(looksLikeManagementToken('sbp_live')).toBe(true);
    expect(looksLikeManagementToken('  sbp_live  ')).toBe(true);
    for (const notAToken of [
      '',
      '   ',
      null,
      undefined,
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.not-a-pat',
      'REPLACE_ME',
      'sbp_',
    ]) {
      expect(looksLikeManagementToken(notAToken), String(notAToken)).toBe(false);
    }
  });

  it('brokers past a value that cannot be a management token', () => {
    const r = resolveIntegrationSecretRoute(cloneWithDeadToken);
    expect(r.via).toBe('broker');
    if (r.via !== 'broker') return;
    expect(r.headers['x-clone-api-key']).toBe('ak_live');
  });

  it('reports the discarded value rather than swallowing it', () => {
    // A value under that name on a tenant's project is a setting somebody
    // made. Brokering past it silently leaves it there for the next reader.
    const r = resolveIntegrationSecretRoute(cloneWithDeadToken);
    if (r.via !== 'broker') return;
    expect(r.unusableManagementToken).toContain('SB_MANAGEMENT_ACCESS_TOKEN');
    expect(r.unusableManagementToken).toContain('sbp_');
  });

  it('a real token still takes the direct route, so the prime is untouched', () => {
    const r = resolveIntegrationSecretRoute({ ...cloneWithDeadToken, managementToken: 'sbp_live' });
    expect(r.via).toBe('direct');
  });

  it('with no broker to fall back to, it names the dead value rather than "nothing is configured"', () => {
    // Those two send an operator to opposite remedies, and the second is a lie
    // about a project that plainly has the name set.
    const r = resolveIntegrationSecretRoute({
      ...cloneWithDeadToken,
      missionControlUrl: null,
      cloneApiKey: null,
    });
    expect(r.via).toBe('unconfigured');
    if (r.via !== 'unconfigured') return;
    expect(r.why).toContain('not shaped like');
    expect(r.why).toContain('Remove the value');
  });
});

/**
 * The remedy the direct route offers — "rotate the Supabase management token"
 * — is one a tenant cannot perform. Where a broker exists, a refused direct
 * write must try it rather than dead-ending on that advice.
 */
describe('a refused direct write falls through to the broker', () => {
  const fn = read('update-integration-secret/index.ts');

  it('retries through the broker on a 401, and only then', () => {
    expect(fn).toContain("response.status === 401 && route.via === 'direct'");
    expect(fn).toContain('brokerRoute({');
  });

  it('logs both attempts, so a dead management token stays visible', () => {
    expect(fn).toContain('direct write refused, brokering instead');
  });
});

describe('who refused', () => {
  const broker = resolveIntegrationSecretRoute({
    managementToken: null,
    supabaseUrl: `https://${CLONE_REF}.supabase.co`,
    missionControlUrl: 'https://mission-control.aurixasystems.com.au',
    cloneApiKey: 'ak_live',
  });

  it("names Mission Control when Mission Control said no", () => {
    const f = describeSecretWriteFailure(broker, {
      status: 401,
      headers: new Headers({ 'x-mission-control-refusal': 'unauthorized' }),
    });
    expect(f.end).toBe('mission_control');
    expect(f.code).toBe('mission_control_unauthorized');
  });

  it('names the Management API when Mission Control only relayed', () => {
    const f = describeSecretWriteFailure(broker, {
      status: 403,
      headers: new Headers({ 'x-mission-control-endpoint': 'integrations.secrets' }),
    });
    expect(f.end).toBe('supabase');
    expect(f.detail).toMatch(/relayed/);
  });

  it('names the URL when something that is not Mission Control answered', () => {
    // The reading that did not exist, and the one a wrong MISSION_CONTROL_URL
    // needs. No endpoint header means the request never reached Mission
    // Control — whatever the body says.
    const f = describeSecretWriteFailure(broker, { status: 404, headers: new Headers() });
    expect(f.end).toBe('not_mission_control');
    expect(f.service).toContain('MISSION_CONTROL_URL');
  });

  it('names the token source on the direct route, because that is what gets rotated', () => {
    const direct = resolveIntegrationSecretRoute({
      managementToken: 'sbp_live',
      managementTokenSource: 'SUPABASE_ACCESS_TOKEN',
      supabaseUrl: `https://${PRIME_REF}.supabase.co`,
      missionControlUrl: null,
      cloneApiKey: null,
    });
    const f = describeSecretWriteFailure(direct, { status: 401, headers: new Headers() });
    expect(f.end).toBe('supabase');
    expect(f.detail).toContain('SUPABASE_ACCESS_TOKEN');
  });
});

describe('the endpoint no longer answers before it has authenticated', () => {
  it('resolves its route after the superadmin check and the step-up gate', () => {
    // It used to bail 400 `setupRequired` as the first thing in the handler,
    // to any caller at all, whenever no management token was set — which on a
    // clone is the ordinary state. Two things follow from moving it: an
    // unauthenticated caller learns nothing about how this deployment is
    // wired, and the brokered route can be reached at all.
    const fn = read('update-integration-secret/index.ts');
    const auth = fn.indexOf('verifyAuth(');
    const stepUp = fn.indexOf('requireStepUp(');
    const route = fn.indexOf('resolveIntegrationSecretRoute({');
    expect(auth).toBeGreaterThan(-1);
    expect(stepUp).toBeGreaterThan(auth);
    expect(route).toBeGreaterThan(stepUp);
  });

  it('carries the remedy with the refusal instead of asserting one', () => {
    const fn = read('update-integration-secret/index.ts');
    expect(fn).toContain('setupHint');
    const page = readFileSync(resolve(__dirname, '../../pages/Integrations.tsx'), 'utf8');
    expect(page).toContain('supabaseSetupHint');
    // The banner used to assert "add a SUPABASE_ACCESS_TOKEN" whatever had
    // happened, which is exactly wrong on a clone.
    expect(page).not.toMatch(/Supabase Access Token Required/);
  });
});

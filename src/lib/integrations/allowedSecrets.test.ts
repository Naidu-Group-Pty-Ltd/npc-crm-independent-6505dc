import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INTEGRATIONS, getSupabaseSecretName } from './registry';

/**
 * `update-integration-secret` runs on Deno and cannot import from `src/`, so its allowlist
 * is materialised into `supabase/functions/_shared/integrationSecrets.ts` by
 * `scripts/generate-integration-secrets.mjs`. These tests are the drift guard: they fail
 * the build whenever a registry field has no matching entry in the generated module.
 */
const GENERATED = resolve(
  __dirname,
  '../../../supabase/functions/_shared/integrationSecrets.ts',
);

const source = () => readFileSync(GENERATED, 'utf8');

const generatedNames = (): string[] => {
  const text = source();
  const body = text.slice(
    text.indexOf('ALLOWED_INTEGRATION_SECRETS'),
    text.indexOf('INTEGRATION_SECRET_MAP'),
  );
  return [...body.matchAll(/^ {2}'([A-Z0-9_]+)',$/gm)].map((m) => m[1]);
};

const generatedMap = (): Record<string, string[]> => {
  const text = source();
  const body = text.slice(text.indexOf('export const INTEGRATION_SECRET_MAP'));
  return Object.fromEntries(
    [...body.matchAll(/^ {2}'([a-z0-9_]+)': \[([^\]]*)\],$/gm)].map((m) => [
      m[1],
      [...m[2].matchAll(/'([A-Z0-9_]+)'/g)].map((s) => s[1]),
    ]),
  );
};

const registryNames = (): string[] => [
  ...new Set(INTEGRATIONS.flatMap((i) => i.fields.map((f) => getSupabaseSecretName(f.key)))),
];

describe('update-integration-secret allowlist', () => {
  it('covers every credential field in the registry', () => {
    const generated = new Set(generatedNames());
    const missing = registryNames().filter((name) => !generated.has(name));

    expect(missing, 'run: npm run integrations:secrets:generate').toEqual([]);
  });

  it('contains nothing the Integrations page cannot send', () => {
    const registry = new Set(registryNames());
    const extra = generatedNames().filter((name) => !registry.has(name));

    expect(extra, 'run: npm run integrations:secrets:generate').toEqual([]);
  });

  it('stores aliased secret names, not raw field keys', () => {
    const generated = new Set(generatedNames());

    // The Listings pipeline's names are fleet-managed and never writable from
    // the page; the page's Airtable card is the workflow connection.
    expect(generated.has('AIRTABLE_TOKEN')).toBe(false);
    expect(generated.has('AIRTABLE_BASE_ID')).toBe(false);
    expect(generated.has('AIRTABLE_API_KEY')).toBe(true);
    expect(generated.has('AIRTABLE_WORKFLOW_BASE_ID')).toBe(true);
    // The two legacy fields whose stored key differs from the Supabase secret name.
    expect(generated.has('GOHIGHLEVEL_API_KEY')).toBe(true);
    expect(generated.has('GHL_API_KEY')).toBe(false);
    expect(generated.has('GOHIGHLEVEL_LOCATION_ID')).toBe(true);
    expect(generated.has('GHL_LOCATION_ID')).toBe(false);
  });

  it('gives every card at least one required field, so a card can read as configured', () => {
    // The page derives a card's status from its REQUIRED fields alone:
    // `configuredFields.length === 0` is `not_configured`, and a card with no
    // required field has an empty required set, so it reads "Not configured"
    // for ever however the deployment is set. That is a false reading of the
    // kind a credential register must not print.
    //
    // It is also what the page IS: every entry maps to a credential an edge
    // function or the browser reads. A service that needs no credential — the
    // geocoding chain's OpenStreetMap providers, which are on by default — is
    // configuration rather than an integration, and its environment names are
    // documented in `docs/integrations/GEOCODING_WITHOUT_GOOGLE.md` instead.
    const optionalOnly = INTEGRATIONS
      .filter((i) => i.fields.length > 0 && i.fields.every((f) => f.required === false))
      .map((i) => i.id);
    expect(optionalOnly).toEqual([]);
  });

  it('only lists names the endpoint’s own format check accepts', () => {
    // Mirrors SECRET_NAME_REGEX in supabase/functions/update-integration-secret/index.ts.
    const SECRET_NAME_REGEX = /^[A-Z][A-Z0-9_]{2,50}$/;
    const rejected = generatedNames().filter((name) => !SECRET_NAME_REGEX.test(name));

    expect(rejected).toEqual([]);
  });
});

describe('check-integration-secrets map', () => {
  it('lists every integration exactly once', () => {
    expect(Object.keys(generatedMap()).sort()).toEqual(INTEGRATIONS.map((i) => i.id).sort());
  });

  it('lists each integration’s secrets in registry field order', () => {
    const map = generatedMap();
    const drifted = INTEGRATIONS.map((integration) => ({
      id: integration.id,
      registry: integration.fields.map((f) => getSupabaseSecretName(f.key)),
      generated: map[integration.id],
    })).filter(({ registry, generated }) => JSON.stringify(registry) !== JSON.stringify(generated));

    expect(drifted, 'run: npm run integrations:secrets:generate').toEqual([]);
  });

  it('agrees with the flat allowlist', () => {
    const fromMap = [...new Set(Object.values(generatedMap()).flat())].sort();

    expect(fromMap).toEqual([...generatedNames()].sort());
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INTEGRATIONS, SUPABASE_SECRET_ALIASES, getSupabaseSecretName } from './registry';
import {
  LISTINGS_PIPELINE_SECRETS,
  listingsPipelineRefusal,
} from '../../../supabase/functions/_shared/listingsPipelineSecrets.pure';

const FUNCTIONS = resolve(__dirname, '../../../supabase/functions');
const read = (rel: string) => readFileSync(resolve(FUNCTIONS, rel), 'utf8');

describe('the Listings pipeline key cannot be superseded from the Integrations page', () => {
  it('no registry field resolves to a Listings pipeline name', () => {
    const written = INTEGRATIONS.flatMap((i) => i.fields.map((f) => getSupabaseSecretName(f.key)));
    expect(written.filter((n) => LISTINGS_PIPELINE_SECRETS.has(n))).toEqual([]);
  });

  it('the AIRTABLE_API_KEY → AIRTABLE_TOKEN alias is gone', () => {
    expect(SUPABASE_SECRET_ALIASES.AIRTABLE_API_KEY).toBeUndefined();
    expect(getSupabaseSecretName('AIRTABLE_API_KEY')).toBe('AIRTABLE_API_KEY');
  });

  it("the page's Airtable card is the workflow connection under its own names", () => {
    const card = INTEGRATIONS.find((i) => i.id === 'airtable');
    expect(card?.fields.map((f) => f.key)).toEqual(['AIRTABLE_API_KEY', 'AIRTABLE_WORKFLOW_BASE_ID']);
    expect(card?.description).toMatch(/managed by Mission Control/);
  });

  it('names exactly what the pipeline reads', () => {
    // Every env read in the four pipeline functions is on the list; the list
    // is the set of names Mission Control forwards.
    const pipeline = ['airtable-proxy/index.ts', 'listings-cache/index.ts', 'listing-images/index.ts', 'listing-enrichment/index.ts'];
    const read_ = new Set<string>();
    for (const f of pipeline) {
      for (const m of read(f).matchAll(/Deno\.env\.get\(['"](AIRTABLE_[A-Z0-9_]+)['"]\)/g)) read_.add(m[1]);
    }
    expect([...read_].filter((n) => !LISTINGS_PIPELINE_SECRETS.has(n))).toEqual([]);
    // ...and the workflow connection's names are not on it.
    expect(LISTINGS_PIPELINE_SECRETS.has('AIRTABLE_API_KEY')).toBe(false);
    expect(LISTINGS_PIPELINE_SECRETS.has('AIRTABLE_WORKFLOW_BASE_ID')).toBe(false);
  });

  it('the write endpoint refuses them before the allow-list, in the operator’s terms', () => {
    const fn = read('update-integration-secret/index.ts');
    const refusal = fn.indexOf('listingsPipelineRefusal(secret.name)');
    const allowlist = fn.indexOf('ALLOWED_SECRETS.has(secret.name)');
    expect(refusal).toBeGreaterThan(-1);
    expect(allowlist).toBeGreaterThan(refusal);
    expect(listingsPipelineRefusal('AIRTABLE_TOKEN')).toMatch(/managed by Mission Control/);
    expect(listingsPipelineRefusal('AIRTABLE_API_KEY')).toBeNull();
  });

  it('the workflow catalog reads the workflow base, never the Listings base', () => {
    const catalog = read('_shared/workflow/catalog/property.pure.ts');
    expect(catalog).not.toMatch(/secret\.AIRTABLE_BASE_ID\b/);
    expect(catalog).toMatch(/secret\.AIRTABLE_WORKFLOW_BASE_ID/);
  });
});

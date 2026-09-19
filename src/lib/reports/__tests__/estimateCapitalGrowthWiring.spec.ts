/**
 * Estimate CGR is wired the way the rest of the platform is: declared to the
 * gateway and the registry, authorised inside, metered where it spends,
 * reading the register through the one reader and the one adapter, writing
 * nothing — and the button fills the same field the cash flow already reads.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { judgeGoogleMapsBody } from '../../../../supabase/functions/_shared/googleMapsBody.pure';

const ROOT = join(__dirname, '..', '..', '..', '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');

const FUNCTION = read('supabase', 'functions', 'estimate-capital-growth', 'index.ts');
const CONFIG = read('supabase', 'config.toml');
const REGISTRY = JSON.parse(read('supabase', 'functions-registry', 'SECURITY_REGISTRY.json')) as { functions: Record<string, { verify_jwt: boolean; exposure_class: string }> };
const FINANCIALS = read('src', 'components', 'reports', 'manual-inputs', 'FinancialsTab.tsx');
const OVERRIDES = read('src', 'components', 'reports', 'PreGenerationOverrides.tsx');
const LOCATION_SERVICE = read('supabase', 'functions', 'location-intelligence-service', 'index.ts');
const CHAIN = read('supabase', 'functions', '_shared', 'geocode', 'geocoder.ts');

describe('the function', () => {
  it('is declared to the gateway and the registry as a human-authenticated function', () => {
    expect(CONFIG).toMatch(/\[functions\.estimate-capital-growth\]\s*\nverify_jwt = true/);
    expect(REGISTRY.functions['estimate-capital-growth']).toMatchObject({ verify_jwt: true, exposure_class: 'human-authenticated' });
  });

  it('authorises inside, guards CSRF, and asks the one geocoding chain rather than any vendor itself', () => {
    expect(FUNCTION).toContain('verifyAuth(supabase, req.headers, body)');
    expect(FUNCTION).toContain('enforceCsrf(req)');
    // Google refused every geocode from 12 Sep 2026. The function names no
    // geocoding vendor at all now; the chain does, behind one contract, and
    // its default order asks no Google.
    expect(FUNCTION).toContain("import { geocodeAddress } from '../_shared/geocode/geocoder.ts';");
    expect(FUNCTION).not.toMatch(/maps\.googleapis\.com/);
    expect(FUNCTION).not.toMatch(/\bfetch\(`https:\/\/maps/);
    // The council comes from the ABS point-in-polygon query, because
    // Queensland's register is by council and Truganina alone straddles two.
    expect(FUNCTION).toContain('wantLga: true');
  });

  it('refuses a geocode no finer than a state — in the chain, for every provider — and falls back to the typed text, saying so', () => {
    expect(CHAIN).toContain('assessGeocodeGranularity(result.lat, result.lng, result.types)');
    expect(FUNCTION).toContain('parseAddressText(propertyAddress)');
    expect(FUNCTION).toContain('mergeGeography(geocoded.geography, parsed)');
    expect(FUNCTION).toContain('the typed address was parsed instead');
  });

  it('asks every source finest first through the one reader and the one adapter, and invents nothing', () => {
    expect(FUNCTION).toContain('salesRegisterSourcesFor(geography.state)');
    expect(FUNCTION).toContain("import { readSalesRegister } from '../_shared/reports/market/salesRegisterRead.ts';");
    expect(FUNCTION).toContain('openDataSalesPoints({');
    expect(FUNCTION).toContain('estimateCapitalGrowth(candidates)');
    expect(FUNCTION).toContain("reason: 'no open growth series reaches this address yet'");
    expect(FUNCTION).not.toMatch(/\.insert\(|\.upsert\(|\.update\(|\.delete\(/);
  });
});

describe('the button', () => {
  it('sits with the Growth label, is disabled without an address, and fills the same capitalGrowth the cash flow reads', () => {
    expect(FINANCIALS).toContain("Estimate CGR");
    expect(FINANCIALS).toContain('disabled={disabled || isEstimatingCgr || !propertyAddress}');
    expect(OVERRIDES).toContain("invokeSecureFunction('estimate-capital-growth', {");
    expect(OVERRIDES).toContain('setCapitalGrowth(reading.ratePct.toFixed(1));');
    // the estimate is passed to the report as the existing override, not a new field
    expect(OVERRIDES).toContain('capitalGrowth: capitalGrowth ? parseFloat(capitalGrowth) : undefined,');
  });

  it('shows the basis and the caveats under the field, and leaves the field alone when nothing was found', () => {
    expect(FINANCIALS).toContain('data-testid="cgr-estimate-reading"');
    expect(FINANCIALS).toContain('{cgrEstimate.basis}');
    expect(FINANCIALS).toContain('cgrEstimate.caveats.map');
    expect(OVERRIDES).toContain('The Growth field is unchanged.');
    expect(OVERRIDES).not.toMatch(/setCapitalGrowth\(['"]5['"]\)/);
  });
});

describe('the geocode is billed only when served, and drawn from the one daily allowance', () => {
  // Google answers HTTP 200 with the verdict in the body. The first deployed
  // version judged nothing, and its first refused geocode (REQUEST_DENIED,
  // 16 Sep 2026 00:43Z) was logged `status: 'success'` with one billable
  // request — the exact trap `meteredFetch.judgeBody` exists for.
  it('judges the body with the one shared judge, and labels the call', () => {
    // The Google provider lives in the chain now, and so does the judge it
    // passes; the function labels the call and the chain carries the label.
    expect(CHAIN).toContain("import { ADDRESS_IS_THE_ANSWER, judgeGoogleMapsBody } from '../googleMapsBody.pure.ts';");
    expect(CHAIN).toContain('judgeBody: judgeGoogleMapsBody,');
    expect(CHAIN).toContain('feature: opts.feature,');
    expect(FUNCTION).toContain("feature: 'estimate-capital-growth/geocode'");
  });

  it('consumes the product-wide geocoding allowance before the request, once — inside the Google provider alone', () => {
    expect(CHAIN).toContain("await consumeGoogleDailyCap(supabase, 'geocoding')");
    expect(CHAIN.split("consumeGoogleDailyCap(supabase, 'geocoding')").length - 1).toBe(1);
    // The free providers spend no credential and consume no Google unit, and
    // the function itself consumes nothing: it cannot know which provider the
    // chain will reach.
    expect(FUNCTION).not.toContain('consumeGoogleDailyCap');
    expect(FUNCTION).toContain('the geocoder did not place the address (${outcome.detail}); the typed address was parsed instead');
  });

  it('is the same judge the location service uses — one implementation, imported by both', () => {
    expect(LOCATION_SERVICE).toContain('from "../_shared/googleMapsBody.pure.ts"');
    expect(LOCATION_SERVICE).not.toMatch(/const judgeGoogleMapsBody\b/);
    expect(LOCATION_SERVICE).not.toMatch(/const ADDRESS_IS_THE_ANSWER\b/);
  });

  it('counts a served request and refuses to count a refusal', () => {
    expect(judgeGoogleMapsBody({ status: 'OK', results: [] })).toBe('success');
    expect(judgeGoogleMapsBody({ status: 'ZERO_RESULTS', results: [] })).toBe('success');
    for (const status of ['REQUEST_DENIED', 'OVER_QUERY_LIMIT', 'OVER_DAILY_LIMIT', 'INVALID_REQUEST', 'UNKNOWN_ERROR', 'SOMETHING_NEW']) {
      expect(judgeGoogleMapsBody({ status })).toBe('error');
    }
    expect(judgeGoogleMapsBody({})).toBeNull();
    expect(judgeGoogleMapsBody(null)).toBeNull();
    expect(judgeGoogleMapsBody('OK')).toBeNull();
  });
});

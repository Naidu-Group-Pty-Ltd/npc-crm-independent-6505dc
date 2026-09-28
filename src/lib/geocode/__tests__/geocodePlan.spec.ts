/**
 * What the geocoding chain asks — pinned on the addresses of 24 Sep 2026.
 *
 * Report 79d677d6 (93 Schofields Farm Road) was written with its geography
 * unresolved because the chain asked Nominatim for a street called
 * "93 Schofields Farm Road (tallawong) NSW 2762" in a city called
 * "(tallawong)", and the ABS for a suburb of that name. The listing sits on
 * a development split — Schofields on the listing, Tallawong beside it (the
 * owner's reading) — so the fix is not to trust either suburb name: ask for
 * the street by its postal area when the named suburb misses, and keep the
 * bracketed name as a second suburb candidate. `geocoder.ts` does the I/O
 * and follows this plan; the chain itself was driven against a stubbed
 * Nominatim and ABS for the PR and reproduced the production failure on the
 * code before this change.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { planGeocode, suburblessAnswerRefusal } from '../../../../supabase/functions/_shared/geocode/geocodePlan.pure';
import { geocodeCacheKey } from '../../../../supabase/functions/_shared/geocode/geocodeResult.pure';
import { annotatedLocalities, parseAddressText } from '../../../../supabase/functions/_shared/reports/market/addressGeography.pure';

describe('planGeocode', () => {
  it('asks for the street alone for the stored Schofields address, and keeps Tallawong as a suburb candidate', () => {
    // Exactly what location-intelligence-service sent for report 79d677d6.
    const plan = planGeocode({ address: '93 Schofields Farm Road (tallawong) NSW 2762, Australia', state: 'NSW', postcode: '2762' })!;
    expect(plan.address).toBe('93 Schofields Farm Road NSW 2762, Australia');
    expect(plan.ask).toMatchObject({ street: '93 Schofields Farm Road', suburb: null, state: 'NSW', postcode: '2762' });
    // No suburb in the first question, so there is nothing to drop.
    expect(plan.withoutSuburb).toBeNull();
    expect(plan.localityCandidates).toEqual(['tallawong']);
  });

  it('asks again without the suburb when the listing names one, and tries the bracketed suburb second', () => {
    // The same listing composed with its suburb (propertyAddress.pure.ts).
    const plan = planGeocode({ address: '93 Schofields Farm Road (tallawong), Schofields NSW 2762, Australia', state: 'NSW', postcode: '2762' })!;
    expect(plan.ask).toMatchObject({ street: '93 Schofields Farm Road', suburb: 'Schofields', postcode: '2762' });
    expect(plan.withoutSuburb).toMatchObject({ street: '93 Schofields Farm Road', suburb: null, state: 'NSW', postcode: '2762' });
    expect(plan.localityCandidates).toEqual(['Schofields', 'tallawong']);
  });

  it('never drops the suburb where the street or the postal area could not identify the street without it', () => {
    expect(planGeocode({ address: 'Schofields NSW 2762' })!.withoutSuburb).toBeNull();
    expect(planGeocode({ address: '93 Schofields Farm Road, Schofields NSW' })!.withoutSuburb).toBeNull();
  });

  it('reads a unit address by its postcode, not its unit number', () => {
    const plan = planGeocode({ address: '1408/5 SECOND AVE, Blacktown NSW 2148' })!;
    expect(plan.ask).toMatchObject({ street: '1408/5 SECOND AVE', suburb: 'Blacktown', state: 'NSW', postcode: '2148' });
  });

  it('asks an ordinary address exactly as before, under the same cache key', () => {
    // Existing geocode_cache rows must still be hit: the key the chain used
    // before this change (whitespace-collapsed address, parsed suburb) and
    // the key it uses now must agree for an address with no brackets.
    for (const address of ['291 Stone Mason Drive, Kellyville NSW 2155', '12 Smith St , Kellyville NSW 2155', '10 Leakes Road, Truganina VIC 3029']) {
      const before = address.replace(/\s+/g, ' ').trim();
      const parsed = parseAddressText(before);
      const oldKey = geocodeCacheKey({ address: before, suburb: parsed.suburb, state: parsed.state, postcode: parsed.postcode });
      const plan = planGeocode({ address })!;
      expect(geocodeCacheKey(plan.ask), address).toBe(oldKey);
    }
    expect(planGeocode({ address: '291 Stone Mason Drive, Kellyville NSW 2155' })!.ask.street).toBe('291 Stone Mason Drive');
  });

  it('has nothing to ask about an empty address or one that was only a note', () => {
    expect(planGeocode({ address: '   ' })).toBeNull();
    expect(planGeocode({ address: '(off the plan)' })).toBeNull();
  });
});

describe('annotatedLocalities', () => {
  it('keeps a bracketed place name and nothing a listing uses brackets for otherwise', () => {
    expect(annotatedLocalities('93 Schofields Farm Road (Tallawong)')).toEqual(['Tallawong']);
    expect(annotatedLocalities('5 Main St (Rouse Hill) (rouse hill)')).toEqual(['Rouse Hill']);
    expect(annotatedLocalities('Lot 12 (off the plan) Hunza Road')).toEqual([]);
    expect(annotatedLocalities('Lot 12 (Lot 12) Hunza Road')).toEqual([]);
    expect(annotatedLocalities('12 Main St (rear)')).toEqual([]);
    expect(annotatedLocalities('12 Main St [Stage 3 Estate]')).toEqual([]);
    expect(annotatedLocalities('12 Main St')).toEqual([]);
  });
});

describe('suburblessAnswerRefusal', () => {
  // The question without the suburb keeps the postal area as its only
  // locality, so it may find the street and nothing else.
  it('accepts the house or the street in the postal area asked', () => {
    expect(suburblessAnswerRefusal({ precision: 'address', postcode: '2762' }, '2762')).toBeNull();
    expect(suburblessAnswerRefusal({ precision: 'street', postcode: '2762' }, '2762')).toBeNull();
  });

  it('refuses a suburb or postcode centroid, which is the locality fallback\'s job under the suburb\'s own name', () => {
    expect(suburblessAnswerRefusal({ precision: 'locality', postcode: '2762' }, '2762')).toMatch(/not the street/);
    expect(suburblessAnswerRefusal({ precision: 'postcode', postcode: '2762' }, '2762')).toMatch(/not the street/);
  });

  it('refuses a street of the same name in another postal area, and one that names none', () => {
    expect(suburblessAnswerRefusal({ precision: 'address', postcode: '2765' }, '2762')).toBe('the match is in postcode 2765, not 2762');
    expect(suburblessAnswerRefusal({ precision: 'street', postcode: null }, '2762')).toMatch(/names no postcode/);
  });
});

describe('the chain follows the plan', () => {
  const CHAIN = readFileSync(join(__dirname, '..', '..', '..', '..', 'supabase', 'functions', '_shared', 'geocode', 'geocoder.ts'), 'utf8');

  // The chain narrows its result union with `x.ok === false` / `x.ok === true`
  // as well as `!x.ok` / `x.ok` — the same test either way, so both spellings
  // pass and what is pinned is the ORDER of the questions, not the syntax.
  it('plans before it asks, and asks the second question only after a no-match', () => {
    expect(CHAIN).toContain('const plan = planGeocode(ask);');
    expect(CHAIN).toMatch(/(?:!attempt\.ok|attempt\.ok === false) && attempt\.reason === 'no_match' && plan\.withoutSuburb/);
    // The answer to the second question must stay in the asked postal area.
    expect(CHAIN).toMatch(/askNominatim\(supabase, plan\.withoutSuburb, \{ timeoutMs, env \}, plan\.withoutSuburb\.postcode \?\? null\)/);
    expect(CHAIN).toMatch(/const refusal = suburblessAnswerRefusal\(mapped, withinPostcode\);/);
  });

  it('tries each locality candidate only after the one before it found nothing', () => {
    expect(CHAIN).toMatch(/const \[first, \.\.\.rest\] = plan\.localityCandidates;/);
    expect(CHAIN).toMatch(/if \(attempt\.ok(?: === true)? \|\| attempt\.reason !== 'no_match'\) break;/);
  });
});

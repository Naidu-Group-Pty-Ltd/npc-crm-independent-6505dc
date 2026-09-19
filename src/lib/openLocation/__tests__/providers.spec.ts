/**
 * The three provider orders. One deliberate difference from
 * GEOCODER_PROVIDERS: each default lists the free provider first and
 * Google AFTER it, so deploy day changes nothing and the free provider
 * takes over the moment it can answer (the register loads, the token is
 * minted) with no configuration change.
 */
import { describe, expect, it } from 'vitest';
import {
  AMENITY_PROVIDERS_ENV,
  COMMUTE_PROVIDERS_ENV,
  DEFAULT_AMENITY_PROVIDERS,
  DEFAULT_COMMUTE_PROVIDERS,
  DEFAULT_IMAGERY_PROVIDERS,
  STREET_IMAGERY_PROVIDERS_ENV,
  amenityProviderOrder,
  commuteProviderOrder,
  imageryProviderOrder,
} from '../providers.pure.ts';

const env = (value: string | undefined) => () => value;

describe('the defaults', () => {
  it('free first, google after — never google alone, never empty', () => {
    expect(DEFAULT_AMENITY_PROVIDERS).toEqual(['register', 'google']);
    expect(DEFAULT_COMMUTE_PROVIDERS).toEqual(['osrm', 'google']);
    expect(DEFAULT_IMAGERY_PROVIDERS).toEqual(['mapillary', 'google']);
  });

  it('an unset variable is the default', () => {
    expect(amenityProviderOrder(env(undefined))).toEqual(['register', 'google']);
    expect(commuteProviderOrder(env(undefined))).toEqual(['osrm', 'google']);
    expect(imageryProviderOrder(env(undefined))).toEqual(['mapillary', 'google']);
  });
});

describe('parsing', () => {
  it('honours an explicit order, case- and space-insensitively', () => {
    expect(amenityProviderOrder(env('google, register'))).toEqual(['google', 'register']);
    expect(commuteProviderOrder(env('OSRM'))).toEqual(['osrm']);
    expect(imageryProviderOrder(env('google'))).toEqual(['google']);
  });

  it('drops unknown names and never resolves to no providers', () => {
    // A typo must not switch a working surface off (the osmAllowance rule).
    expect(amenityProviderOrder(env('registry,googel'))).toEqual(['register', 'google']);
    expect(commuteProviderOrder(env('osrm,teleport'))).toEqual(['osrm']);
    expect(imageryProviderOrder(env(',,'))).toEqual(['mapillary', 'google']);
  });

  it('deduplicates a repeated name', () => {
    expect(amenityProviderOrder(env('register,register,google'))).toEqual(['register', 'google']);
  });

  it('names its variables once', () => {
    expect(AMENITY_PROVIDERS_ENV).toBe('AMENITY_PROVIDERS');
    expect(COMMUTE_PROVIDERS_ENV).toBe('COMMUTE_PROVIDERS');
    expect(STREET_IMAGERY_PROVIDERS_ENV).toBe('STREET_IMAGERY_PROVIDERS');
  });
});

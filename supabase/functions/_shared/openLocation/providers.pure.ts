/**
 * Which provider answers each of the three location surfaces, in what
 * order — the same shape as `GEOCODER_PROVIDERS`, with one deliberate
 * difference in the defaults.
 *
 * The geocoder's default names no Google, because its free chain answers
 * at request time for every address. These three cannot promise that on
 * day one: the amenity register answers only once its first ingest has
 * run, OSRM is somebody else's live server, and Mapillary needs a token
 * no deployment has minted yet. So each default lists the free provider
 * FIRST and Google AFTER it — on the day this ships, a deployment behaves
 * exactly as it did yesterday, and the free provider takes over the
 * moment it can answer (the register loads, the token is set), with no
 * configuration change and no code change. An operator who wants Google
 * gone entirely removes it from the order, exactly as with the geocoder.
 *
 * Unknown names are dropped rather than erred: a typo must not switch a
 * working surface off (`osmAllowanceFor`'s rule). An empty result falls
 * back to the default order, so the variable cannot spell "no providers".
 */

export type AmenityProvider = 'register' | 'google';
export type CommuteProvider = 'osrm' | 'google';
export type ImageryProvider = 'mapillary' | 'google';

export const AMENITY_PROVIDERS_ENV = 'AMENITY_PROVIDERS';
export const COMMUTE_PROVIDERS_ENV = 'COMMUTE_PROVIDERS';
export const STREET_IMAGERY_PROVIDERS_ENV = 'STREET_IMAGERY_PROVIDERS';

export const DEFAULT_AMENITY_PROVIDERS: AmenityProvider[] = ['register', 'google'];
export const DEFAULT_COMMUTE_PROVIDERS: CommuteProvider[] = ['osrm', 'google'];
export const DEFAULT_IMAGERY_PROVIDERS: ImageryProvider[] = ['mapillary', 'google'];

function parseOrder<T extends string>(raw: string | undefined, known: readonly T[], fallback: T[]): T[] {
  const listed = (raw ?? '')
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter((p): p is T => (known as readonly string[]).includes(p));
  const deduped = [...new Set(listed)];
  return deduped.length > 0 ? deduped : [...fallback];
}

export function amenityProviderOrder(env: (k: string) => string | undefined): AmenityProvider[] {
  return parseOrder(env(AMENITY_PROVIDERS_ENV), ['register', 'google'] as const, DEFAULT_AMENITY_PROVIDERS);
}

export function commuteProviderOrder(env: (k: string) => string | undefined): CommuteProvider[] {
  return parseOrder(env(COMMUTE_PROVIDERS_ENV), ['osrm', 'google'] as const, DEFAULT_COMMUTE_PROVIDERS);
}

export function imageryProviderOrder(env: (k: string) => string | undefined): ImageryProvider[] {
  return parseOrder(env(STREET_IMAGERY_PROVIDERS_ENV), ['mapillary', 'google'] as const, DEFAULT_IMAGERY_PROVIDERS);
}

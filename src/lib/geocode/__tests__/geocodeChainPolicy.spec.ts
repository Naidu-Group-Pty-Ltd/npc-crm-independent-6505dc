/**
 * What the chain may remember, and when it must stop asking.
 *
 * From 07:51:29 UTC on 24 Sep 2026 the public Nominatim answered HTTP 403 to
 * every request from the production egress. The chain fell through to the ABS
 * suburb centroid — correctly — and then wrote that centroid into
 * `geocode_cache` as the address's permanent answer, so
 * `1408/5 SECOND AVE, Blacktown` and `93 Schofields Farm Road, Schofields`
 * could never have been placed again, by a regeneration or by the refusal
 * lifting. These pin the three rules that close it.
 */
import { describe, expect, it } from 'vitest';
import {
  FLOOR_REASK_AFTER_MS,
  PAUSE_AFTER_STATUS_MS,
  PAUSE_BOUNDS_MS,
  STREET_REASK_AFTER_MS,
  cacheVerdict,
  cachedAnswerIsProvisional,
  parseRetryAfter,
  pauseAfterRefusal,
  refusalExcerpt,
  rememberedStreetAnswerIsProvisional,
} from '../../../../supabase/functions/_shared/geocode/geocodeChainPolicy.pure.ts';

const NOW = Date.parse('2026-09-24T10:19:08Z');

describe('rule 1 — an outage is never remembered as the address', () => {
  it('serves, and does not remember, a suburb centroid taken while a street-level provider could not be asked', () => {
    const v = cacheVerdict({ precision: 'locality' }, [
      { provider: 'nominatim', providerRefused: true },
      { provider: 'photon', providerRefused: false },
    ]);
    expect(v.write).toBe(false);
    if (v.write === false) expect(v.reason).toContain('nominatim');
  });

  it('remembers a suburb centroid every street-level provider LOOKED for and could not better', () => {
    // The best this address will get — and remembering it is what stops the
    // chain re-asking a public service the same question.
    expect(cacheVerdict({ precision: 'locality' }, [
      { provider: 'nominatim', providerRefused: false },
      { provider: 'photon', providerRefused: false },
    ]).write).toBe(true);
  });

  it('always remembers a street or address answer — an address does not move', () => {
    for (const precision of ['address', 'street'] as const) {
      expect(cacheVerdict({ precision }, [{ provider: 'nominatim', providerRefused: true }]).write).toBe(true);
    }
  });

  it('is not moved by a floor provider that failed', () => {
    // The ABS is the floor, not a street-level provider: its outage says
    // nothing about whether a street answer was available.
    expect(cacheVerdict({ precision: 'postcode' }, [{ provider: 'abs_locality', providerRefused: true }]).write).toBe(true);
  });
});

describe('rule 2 — a remembered answer coarser than a street is provisional', () => {
  const base = {
    precision: 'locality' as const,
    nowMs: NOW,
    askNamesStreet: true,
    streetLevelProvidersConfigured: true,
  };

  it('is asked again once it is an hour old', () => {
    expect(cachedAnswerIsProvisional({ ...base, resolvedAt: new Date(NOW - FLOOR_REASK_AFTER_MS).toISOString() })).toBe(true);
    expect(cachedAnswerIsProvisional({ ...base, resolvedAt: new Date(NOW - FLOOR_REASK_AFTER_MS + 60_000).toISOString() })).toBe(false);
  });

  it('is asked again where nothing proves when it was resolved', () => {
    expect(cachedAnswerIsProvisional({ ...base, resolvedAt: null })).toBe(true);
    expect(cachedAnswerIsProvisional({ ...base, resolvedAt: 'yesterday' })).toBe(true);
  });

  it('is never asked again for a question that names no street — a suburb cannot be placed finer than itself', () => {
    expect(cachedAnswerIsProvisional({ ...base, askNamesStreet: false, resolvedAt: null })).toBe(false);
  });

  it('is never asked again where no street-level provider is configured', () => {
    expect(cachedAnswerIsProvisional({ ...base, streetLevelProvidersConfigured: false, resolvedAt: null })).toBe(false);
  });

  it('never re-asks a street or address answer', () => {
    for (const precision of ['address', 'street'] as const) {
      expect(cachedAnswerIsProvisional({ ...base, precision, resolvedAt: null })).toBe(false);
    }
  });
});

describe('rule 3 — a refusal pauses the provider that sent it', () => {
  it('pauses a 403 for half an hour: an operator blocked this client, and asking again cannot help', () => {
    expect(pauseAfterRefusal(403, null, NOW)).toBe(NOW + PAUSE_AFTER_STATUS_MS.forbidden);
  });

  it('honours Retry-After on a 429, in seconds or as a date, inside the bounds', () => {
    expect(pauseAfterRefusal(429, '120', NOW)).toBe(NOW + 120_000);
    expect(pauseAfterRefusal(429, new Date(NOW + 600_000).toUTCString(), NOW)).toBe(NOW + 600_000);
    expect(pauseAfterRefusal(429, null, NOW)).toBe(NOW + PAUSE_AFTER_STATUS_MS.tooMany);
    // A mistyped or hostile header can neither spin us nor stall us.
    expect(pauseAfterRefusal(429, '0', NOW)).toBe(NOW + PAUSE_BOUNDS_MS.min);
    expect(pauseAfterRefusal(429, '99999999', NOW)).toBe(NOW + PAUSE_BOUNDS_MS.max);
  });

  it('never shortens a 403 on the strength of a Retry-After', () => {
    expect(pauseAfterRefusal(403, '5', NOW)).toBe(NOW + PAUSE_AFTER_STATUS_MS.forbidden);
  });

  it('pauses a failing service briefly, and does not pause on anything that is not a refusal', () => {
    expect(pauseAfterRefusal(503, null, NOW)).toBe(NOW + PAUSE_AFTER_STATUS_MS.serverError);
    for (const status of [200, 400, 404, 500]) expect(pauseAfterRefusal(status, null, NOW)).toBeNull();
  });

  it('reads Retry-After strictly', () => {
    expect(parseRetryAfter('  30 ', NOW)).toBe(30_000);
    expect(parseRetryAfter('soon', NOW)).toBeNull();
    expect(parseRetryAfter('', NOW)).toBeNull();
  });

  it('keeps the refusal\'s own words for the log — markup removed, bounded', () => {
    const page = '<html><head><style>p{}</style><title>Access blocked</title></head><body>'
      + '<h1>Access blocked</h1><p>You have been blocked because you have violated the '
      + '<a href="https://operations.osmfoundation.org/policies/nominatim/">usage policy</a>&nbsp;of OSM\'s Nominatim.</p>'
      + '<script>track()</script></body></html>';
    const words = refusalExcerpt(page);
    expect(words).toBe('Access blocked Access blocked You have been blocked because you have violated the usage policy of OSM\'s Nominatim.');
    expect(refusalExcerpt('x'.repeat(500)).length).toBe(200);
    expect(refusalExcerpt(null)).toBe('');
  });
});

describe('rule 4 — a remembered street answer is put to the address register', () => {
  // 25 Sep 2026 00:18 UTC: `60 Lawley Street, Spalding WA 6530` was served
  // OpenStreetMap's street point from before the register existed, and G-NAF
  // — which holds the address at its property centroid — was never asked.
  const base = {
    precision: 'street' as const,
    provider: 'nominatim' as const,
    nowMs: NOW,
    askNamesNumber: true,
    registerConfigured: true,
  };

  it('is put to the register once it is an hour old, and not before', () => {
    expect(rememberedStreetAnswerIsProvisional({ ...base, resolvedAt: new Date(NOW - STREET_REASK_AFTER_MS).toISOString() })).toBe(true);
    expect(rememberedStreetAnswerIsProvisional({ ...base, resolvedAt: new Date(NOW - STREET_REASK_AFTER_MS + 60_000).toISOString() })).toBe(false);
  });

  it('is put to the register where nothing proves when it was resolved', () => {
    expect(rememberedStreetAnswerIsProvisional({ ...base, resolvedAt: null })).toBe(true);
    expect(rememberedStreetAnswerIsProvisional({ ...base, resolvedAt: 'last week' })).toBe(true);
  });

  it('holds for every free-text provider that can stop at a street', () => {
    for (const provider of ['nominatim', 'photon', 'google'] as const) {
      expect(rememberedStreetAnswerIsProvisional({ ...base, provider, resolvedAt: null }), provider).toBe(true);
    }
  });

  it('never re-asks the register about a street it placed itself', () => {
    expect(rememberedStreetAnswerIsProvisional({ ...base, provider: 'gnaf', resolvedAt: null })).toBe(false);
  });

  it('never puts an ask with no number or lot to the register — it answers about an address, not a street', () => {
    expect(rememberedStreetAnswerIsProvisional({ ...base, askNamesNumber: false, resolvedAt: null })).toBe(false);
  });

  it('asks nothing where no register is configured', () => {
    expect(rememberedStreetAnswerIsProvisional({ ...base, registerConfigured: false, resolvedAt: null })).toBe(false);
  });

  it('leaves an address answer, and a floor answer, to the rules that own them', () => {
    for (const precision of ['address', 'locality', 'postcode'] as const) {
      expect(rememberedStreetAnswerIsProvisional({ ...base, precision, resolvedAt: null }), precision).toBe(false);
    }
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { claimSupportRules } from '../../../../supabase/functions/_shared/reports/investment/chartEvidence.pure.ts';
import {
  PARCEL_GRADE_PRECISION,
  coordinateProvenance,
  enrichmentCoordinate,
  ledgerOutcomeFor,
  recoveredCoordinate,
  type GeocodeOutcomeLike,
  type SubjectCoordinateOutcome,
  type SubjectCoordinateRefusal,
} from '../../../../supabase/functions/_shared/reports/location/planningCoordinate.pure.ts';

// tsconfig.app has strict: false, which disables discriminated-union
// narrowing by truthiness — cast explicitly after the guard.
type RefusalOutcome = Extract<SubjectCoordinateOutcome, { usable: false }>;
const asRefusal = (out: SubjectCoordinateOutcome): RefusalOutcome =>
  out as RefusalOutcome;

/**
 * Which coordinate may ask a planning register about this property.
 *
 * Measured over the 105 stored reports in the verification corpus:
 *
 * ```
 * rows                                                105
 * rows carrying a coordinate on location_intelligence   5
 * rows carrying a planning key in data_sources          0
 * ```
 *
 * Two faults. The 100 with no coordinate never reached the register at all.
 * And the five that DO carry one also have no planning key — `23 MACKAY
 * Street, Moranbah QLD 4744`, generated 2026-09-08 after
 * `planning-data-service` went live, holds `{lat: -22.006014, lng:
 * 148.0590271}` on its `location_intelligence` column and `{}` in
 * `enhanced_data`, because the guard reads the in-memory working object and
 * the resume worker starts that empty.
 */
const NOW = '2026-09-19T08:00:00.000Z';

describe('the coordinate this run already has', () => {
  it('is used when the enrichment produced one', () => {
    const c = enrichmentCoordinate({ coordinates: { lat: -33.83, lng: 148.69 } }, NOW);
    expect(c).not.toBeNull();
    expect(c!.lat).toBe(-33.83);
    expect(c!.source).toBe('enrichment');
    expect(c!.precision).toBe(PARCEL_GRADE_PRECISION);
  });

  it('accepts numeric strings, because a stored object is not typed', () => {
    const c = enrichmentCoordinate({ coordinates: { lat: '-22.006014', lng: '148.0590271' } }, NOW);
    expect(c?.lat).toBe(-22.006014);
    expect(c?.lng).toBe(148.0590271);
  });

  it.each([
    ['null', null],
    ['no coordinates key', { schools: [] }],
    ['a null coordinates value', { coordinates: null }],
    ['a half coordinate', { coordinates: { lat: -33.83 } }],
    ['a non-numeric coordinate', { coordinates: { lat: 'unknown', lng: 148.69 } }],
    ['NaN', { coordinates: { lat: Number.NaN, lng: 148.69 } }],
  ])('is absent for %s', (_label, input) => {
    expect(enrichmentCoordinate(input, NOW)).toBeNull();
  });

  it('carries no provenance line, because its own acquisition stamp does', () => {
    const c = enrichmentCoordinate({ coordinates: { lat: 1, lng: 2 } }, NOW)!;
    expect(coordinateProvenance(c)).toBeNull();
  });
});

describe('recovery, and the precision it insists on', () => {
  const ok = (precision: string) => ({
    ok: true,
    result: {
      lat: -33.8301,
      lng: 148.6934,
      precision,
      provider: 'nominatim',
      attribution: '© OpenStreetMap contributors',
      matchedAddress: '48 Redfern Street, Cowra, New South Wales, 2794, Australia',
    },
    fromCache: false,
    tried: ['nominatim'],
  });

  it('uses a match at the address', () => {
    const out = recoveredCoordinate(ok('address'), NOW);
    expect(out.usable).toBe(true);
    if (!out.usable) return;
    expect(out.coordinate.source).toBe('geocode_recovery');
    expect(out.coordinate.provider).toBe('nominatim');
    expect(out.coordinate.matchedAddress).toContain('48 Redfern Street');
  });

  /*
   * The rule that makes recovery safe. A planning control is an attribute of
   * the PARCEL: a zone is a polygon over many lots and an overlay can follow a
   * creek through one of them, so a street point may sit on the road reserve
   * or the neighbour's lot and a suburb centroid is a different property.
   * `assessGeocodeGranularity` keeps `locality` acceptable for a MAP PIN
   * because a suburb centroid is imprecise rather than wrong; here it is
   * wrong. This is `crimePostcodeAuthority`'s rule in another register.
   */
  it.each(['street', 'locality', 'postcode'])('refuses a match at %s', (precision) => {
    const out = recoveredCoordinate(ok(precision), NOW);
    expect(out.usable).toBe(false);
    if (out.usable) return;
    expect(asRefusal(out).refusal).toBe('too_coarse');
    expect(asRefusal(out).detail).toContain(precision);
    expect(asRefusal(out).detail).toMatch(/parcel/i);
  });

  it('refuses a match that states no precision at all', () => {
    const out = recoveredCoordinate(ok(''), NOW);
    expect(out.usable).toBe(false);
    if (!out.usable) expect(asRefusal(out).refusal).toBe('too_coarse');
  });

  it('refuses a match carrying no usable coordinate', () => {
    const out = recoveredCoordinate(
      { ok: true, result: { lat: null, lng: null, precision: 'address' }, tried: ['nominatim'] },
      NOW,
    );
    expect(out.usable).toBe(false);
    if (!out.usable) expect(asRefusal(out).refusal).toBe('provider_unavailable');
  });

  it('records the provider, what it matched and when — the provenance nothing else holds', () => {
    const out = recoveredCoordinate(ok('address'), NOW);
    if (!out.usable) throw new Error('expected a usable coordinate');
    const line = coordinateProvenance(out.coordinate)!;
    expect(line).toContain('nominatim');
    expect(line).toContain('48 Redfern Street');
    expect(line).toContain('address');
    expect(line).toContain(NOW);
    expect(line).toContain('OpenStreetMap');
  });
});

describe('a refusal says which kind it is', () => {
  /*
   * Four different sentences, and a fifth that is NOT here: a register asked
   * at the parcel and holding nothing there. That one is a fact about the
   * property; none of these is.
   */
  it.each<[string, GeocodeOutcomeLike, SubjectCoordinateRefusal, string]>([
    [
      'no geocoder matched the address',
      { ok: false, reason: 'no_match', providerRefused: false, detail: 'no candidates', tried: ['nominatim', 'abs_locality'] },
      'no_match',
      'never_requested',
    ],
    [
      'no provider was reachable',
      { ok: false, reason: 'unavailable', providerRefused: true, detail: 'timeout', tried: ['nominatim'] },
      'provider_unavailable',
      'requested_failed',
    ],
    [
      'the provider refused',
      { ok: false, reason: 'refused', providerRefused: true, detail: 'HTTP 403', tried: ['google'] },
      'provider_refused',
      'requested_failed',
    ],
    [
      'our own allowance refused',
      { ok: false, reason: 'budget', providerRefused: true, capReason: 'daily_cap', detail: '', tried: [] },
      'budget',
      'requested_failed',
    ],
  ])('%s', (_label, outcome, refusal, ledger) => {
    const out = recoveredCoordinate(outcome, NOW);
    expect(out.usable).toBe(false);
    if (out.usable) return;
    expect(asRefusal(out).refusal).toBe(refusal);
    expect(ledgerOutcomeFor(asRefusal(out).refusal)).toBe(ledger);
    expect(asRefusal(out).detail.length).toBeGreaterThan(20);
  });

  it('names the allowance that refused, so an operator is sent to the right place', () => {
    const out = recoveredCoordinate(
      { ok: false, reason: 'budget', capReason: 'kill_switch', tried: [] },
      NOW,
    );
    if (out.usable) throw new Error('expected a refusal');
    expect(asRefusal(out).detail).toContain('kill_switch');
    expect(asRefusal(out).detail).toMatch(/a limit of ours, not an answer about the address/);
  });

  it('keeps ours apart from the address\'s, on every refusal there is', () => {
    const ours: SubjectCoordinateRefusal[] = ['provider_unavailable', 'provider_refused', 'budget'];
    const theirs: SubjectCoordinateRefusal[] = ['no_address', 'no_match', 'too_coarse'];
    for (const r of ours) expect(ledgerOutcomeFor(r)).toBe('requested_failed');
    for (const r of theirs) expect(ledgerOutcomeFor(r)).toBe('never_requested');
    // and the union is the whole type — a new refusal must be classified here
    const source = readFileSync(
      resolve(__dirname, '../../../../supabase/functions/_shared/reports/location/planningCoordinate.pure.ts'),
      'utf8',
    );
    const declared = source
      .slice(source.indexOf('export type SubjectCoordinateRefusal'), source.indexOf(';', source.indexOf('export type SubjectCoordinateRefusal')))
      .match(/'([a-z_]+)'/g)!
      .map((q) => q.replace(/'/g, ''));
    expect(new Set(declared)).toEqual(new Set([...ours, ...theirs]));
  });
});

describe('the generator asks at the qualified coordinate, and nowhere else', () => {
  const generator = readFileSync(
    resolve(__dirname, '../../../../supabase/functions/generate-investment-report/index.ts'),
    'utf8',
  );

  it('gates the planning register and the published-project register on it', () => {
    expect(generator).toContain('const planningCoords = subjectCoordinate;');
    expect(generator).toContain('const publishedProjectCoords = subjectCoordinate;');
  });

  it('never reads the raw enrichment coordinate for either of them', () => {
    // The defect: `enhancedData.locationIntelligence?.coordinates` is the
    // working object, empty on the resume run that writes the document.
    for (const producer of ['planningCoords', 'publishedProjectCoords']) {
      expect(generator).not.toContain(`const ${producer} = enhancedData.locationIntelligence?.coordinates`);
    }
  });

  it('records the coordinate as its own acquisition producer', () => {
    expect(generator).toContain("producer: 'subjectCoordinate'");
  });
});

describe('a refused claim is refused in every form it could take', () => {
  /*
   * "Unsupported figures must not simply move to another format."
   *
   * The evidence contract REMOVES an unsupported chart rather than tabulating
   * it, and the prose rules are the counterpart that stops the model writing
   * the same claim in words. The preamble enumerated prose, captions, summary
   * strips and tables — and not the two formats a removed chart most naturally
   * becomes: a `::: stat :::` card and a timeline stop.
   *
   * Measured before widening anything further: across the 12 distinct
   * documents in the verification corpus, 316 of 620 table rows carry a
   * figure and 269 of those (85.1%) name no basis within four lines — because
   * they are the acquisition-cost and annual-cost tables, every figure of
   * which comes from the record's own stored calculation. A blanket
   * "every table figure needs a basis" rule would fire on 85% of a document
   * and teach people to dismiss it, which is the hazard
   * `FIGURE_KINDS_NEEDING_A_BASIS` already names in its own comment. So the
   * correction is to the ENUMERATION the rules already carry, not a new rule.
   */
  const rules = claimSupportRules({
    recordedScores: [],
    demographics: false,
    marketData: false,
    location: false,
    withheldFacts: [],
  });

  it('names every format a refused figure could move to', () => {
    for (const format of ['PROSE', 'captions', 'summary strips', 'tables', '::: stat ::: cards', 'timeline stops']) {
      expect(rules).toContain(format);
    }
  });

  it('says in terms that moving a figure does not support it', () => {
    expect(rules).toMatch(/refused in EVERY form/);
    expect(rules).toMatch(/does not make it supported/);
    expect(rules).toMatch(/may not reappear as a list of the same numbers/);
  });

  it('still forbids the population share in a table, which it always did', () => {
    expect(rules).toContain('not in a table');
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * RF-7.2B.1B0 — a refusal by the geocoder is not a fact about the address.
 *
 * Measured in production on 2026-09-12: 24 of 24 geocode attempts over 24
 * hours answered `REQUEST_DENIED`, 0 answered `ZERO_RESULTS`, 0 succeeded. So
 * every report generated in that window carried no coordinate, no geography,
 * and therefore no demographics, SEIFA or employment — while the only reason
 * the platform recorded was `address_not_resolved`, whose message reads "the
 * address could not be resolved to a location in Australia".
 *
 * That is the expensive kind of false: it blames the customer's address for
 * this deployment's own credential, and sends whoever reads it to re-check an
 * address that was never wrong. Same class as the faults this repository has
 * already paid for — a read that FAILED is not a row that is ABSENT; a
 * provider configured but in simulator mode reported as no provider at all.
 *
 * `location-intelligence-service` is an edge function whose internals are not
 * importable from here (it calls `serve()` at module scope and `geocodeAddress`
 * is private), so these assert the rules against its source — the same
 * treatment the RF-7.2B.1A.2 call-path tests use, and the reason
 * `check-edge-functions.mjs` exists.
 */
const SERVICE = resolve(
  __dirname,
  '../../../../supabase/functions/location-intelligence-service/index.ts',
);
const src = readFileSync(SERVICE, 'utf8');

/**
 * The geocoding chain the service asks since Google refused every geocode
 * (16 Sep 2026). Its Google provider is the one place a Google geocoder body
 * is read now, so the rules about that body are asserted there; the service
 * maps the chain's verdict and re-derives nothing from the absence of a point.
 */
const CHAIN = resolve(__dirname, '../../../../supabase/functions/_shared/geocode/geocoder.ts');
const chain = readFileSync(CHAIN, 'utf8');

/** One provider's function in the chain, from its signature to the next function. */
function providerBody(name: string, next: string): string {
  const start = chain.indexOf(`async function ${name}(`);
  expect(start).toBeGreaterThan(-1);
  const end = chain.indexOf(`function ${next}(`, start);
  expect(end).toBeGreaterThan(start);
  return chain.slice(start, end);
}

/** The body of `geocodeAddress`, from its signature to the next top-level `}`. */
function geocodeAddressBody(): string {
  const start = src.indexOf('async function geocodeAddress(');
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf('\n}', start);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

/**
 * The same source with comments removed.
 *
 * Every rule below is about what the code DOES, and this file explains itself
 * at length — `generateMockLocationData` is named in a comment recording what
 * used to be there, and matching that would assert the opposite of the truth.
 */
const codeOnly = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/** The `if (…) { … }` block whose head contains `head`, brace-matched. */
function blockContaining(text: string, head: string): string {
  const at = text.indexOf(head);
  expect(at).toBeGreaterThan(-1);
  const open = text.indexOf('{', at);
  expect(open).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return text.slice(at, i + 1);
    }
  }
  throw new Error(`unbalanced block for ${head}`);
}

describe('RF-7.2B.1B0 — the geocoder says which kind of failure it was', () => {
  it('every exit from geocodeAddress carries a verdict, never a bare null', () => {
    const body = geocodeAddressBody();
    // A bare `return null` is the whole defect: it makes a denied credential
    // and a genuine miss indistinguishable to every caller.
    expect(body).not.toMatch(/return\s+null\s*;/);
    // Five exits: no address, not attempted (an allowance refused it), the
    // chain found no point (the provider's fault or a genuine miss, and it
    // says which), rejected point, success.
    const verdicts = body.match(/return\s*\{\s*ok:\s*(?:true|false)/g) ?? [];
    expect(verdicts.length).toBeGreaterThanOrEqual(5);
  });

  it('declares an outcome type that carries providerRefused', () => {
    // Judged on the DECLARATION with its comments stripped, not on a byte
    // window from the type's name. The window was 200 characters and RC-2
    // pushed the field out of it by explaining, above the field, why a cost
    // ceiling is a separate flag — a failure that says nothing about whether
    // the type is right. This file already learned that lesson once, in
    // `maps providerRefused onto it`; it applies here too.
    const at = src.indexOf('type GeocodeOutcome');
    expect(at).toBeGreaterThan(-1);
    // To the blank line that ends it — a `;` would stop inside the first
    // union member, which is where `{ ok: true; lat: number; … }` puts one.
    const declaration = codeOnly(src.slice(at, src.indexOf('\n\n', at)));
    expect(declaration).toMatch(/providerRefused:\s*boolean/);
    expect(src).toContain('Promise<GeocodeOutcome>');
  });

  it('treats ZERO_RESULTS as the ONLY statement about the address', () => {
    // The constant and the judge live in `_shared/googleMapsBody.pure.ts`,
    // one implementation; the chain's Google provider imports both rather
    // than declaring its own, and the service declares nothing of the kind.
    expect(chain).toContain("import { ADDRESS_IS_THE_ANSWER, judgeGoogleMapsBody } from '../googleMapsBody.pure.ts';");
    expect(chain).not.toContain("const ADDRESS_IS_THE_ANSWER =");
    expect(src).not.toContain("const ADDRESS_IS_THE_ANSWER =");
    const shared = readFileSync(resolve(SERVICE, '..', '..', '_shared', 'googleMapsBody.pure.ts'), 'utf8');
    expect(shared).toContain("export const ADDRESS_IS_THE_ANSWER = 'ZERO_RESULTS'");
    // The test that matters: an unrecognised status must count as OURS. The
    // provider names the one address status and refuses everything else; an
    // allow-list of "our" statuses would let a new Google status be blamed on
    // the customer's address.
    const google = providerBody('askGoogle', 'councilOf');
    expect(google).toContain('data.status === ADDRESS_IS_THE_ANSWER');
    expect(codeOnly(google)).not.toContain('ZERO_RESULTS');
    // And the service maps the chain's reading rather than re-deriving one
    // from the absence of a point: only `no_match` is about the address, and
    // `no_match` is what every provider answers when it looked and found no
    // such address.
    expect(geocodeAddressBody()).toContain("const refused = outcome.reason !== 'no_match'");
  });

  it('never enumerates the refusal statuses, so a new one is still ours', () => {
    for (const body of [geocodeAddressBody(), providerBody('askGoogle', 'councilOf')]) {
      for (const status of [
        'REQUEST_DENIED', 'OVER_QUERY_LIMIT', 'OVER_DAILY_LIMIT', 'INVALID_REQUEST',
      ]) {
        // Naming them in the decision would make the rule an allow-list by the
        // back door. They may appear in prose; they may not appear in code.
        expect(codeOnly(body)).not.toContain(status);
      }
    }
  });

  it('a transport failure and a thrown request are ours', () => {
    // In the chain, for every provider: an HTTP non-ok answer, a body with no
    // usable point under a status that is not the address's, and a request
    // that never reached the provider are the provider's fault.
    for (const [name, next] of [['askNominatim', 'askAbsLocality'], ['askAbsLocality', 'googlePrecision']] as const) {
      const body = providerBody(name, next);
      expect(blockContaining(body, 'if (!res.ok)'), name).toContain('providerRefused: true');
      expect(blockContaining(body, 'catch (error)'), name).toContain('providerRefused: true');
    }
    const google = providerBody('askGoogle', 'councilOf');
    expect(blockContaining(google, "if (data.status !== 'OK' || !first || !loc)")).toContain('providerRefused: true');
    expect(blockContaining(google, 'catch (error)')).toContain('providerRefused: true');
    // And the service carries that verdict through unchanged.
    expect(geocodeAddressBody()).toContain('return { ok: false, providerRefused: refused };');
  });

  it('a point we rejected as not-in-Australia is NOT a provider refusal', () => {
    // The provider answered about this address; we declined the answer. That
    // is ours to explain but it is not a service fault, and calling it one
    // would send an operator to the Google console over a bad address.
    //
    // Brace-matched rather than measured in bytes: a window test fails when a
    // comment above the return grows, which says nothing about whether the
    // code is right.
    const branch = blockContaining(geocodeAddressBody(), 'if (!verdict.ok)');
    expect(branch).toContain('providerRefused: false');
    expect(branch).not.toContain('providerRefused: true');
  });

  it('an empty address is not a provider refusal either', () => {
    const branch = blockContaining(geocodeAddressBody(), 'if (!address)');
    expect(branch).toContain('providerRefused: false');
    expect(branch).not.toContain('providerRefused: true');
  });
});

describe('RF-7.2B.1B0 — the reason reaches the caller', () => {
  it('the vocabulary carries geocoder_unavailable', () => {
    expect(src).toMatch(/type UnresolvedReason[\s\S]{0,200}'geocoder_unavailable'/);
    expect(src).toMatch(/UNRESOLVED_MESSAGE[\s\S]{0,600}geocoder_unavailable:/);
  });

  it('maps providerRefused onto it, and nothing else onto it', () => {
    // Asserted on the ASSIGNMENT rather than on a byte window. The window was
    // 400 characters from `coordinates = geocoded.ok`, which RF-7.2B.1B1 pushed
    // the mapping out of by adding one line above it — a failure that says
    // nothing about whether the mapping is right. The statement itself is the
    // rule: which of the two reasons is chosen, decided from the provider's own
    // refusal flag and from nothing else.
    const assignment = src.match(/reason\s*=\s*geocoded\.ok[\s\S]*?;/)?.[0] ?? '';
    expect(assignment).toBeTruthy();
    expect(assignment).toContain('geocoded.providerRefused');
    expect(assignment).toContain("'geocoder_unavailable'");
    expect(assignment).toContain("'address_not_resolved'");

    // A refused provider is the ONLY route to `geocoder_unavailable`. Asserted
    // as a property of the statement rather than as one arrangement of it: the
    // original regex pinned a particular ternary shape, and RC-2 changed the
    // shape (adding a third outcome) without weakening the rule. What must
    // hold is that `geocoder_unavailable` is reachable only where
    // `providerRefused` is being tested — so every OTHER branch of the
    // statement names a different reason.
    const guardedByRefusal = assignment
      .split(/\?|:/)
      .filter((part) => part.includes("'geocoder_unavailable'"));
    expect(guardedByRefusal).toHaveLength(1);
    expect(assignment.indexOf('geocoded.providerRefused'))
      .toBeLessThan(assignment.indexOf("'geocoder_unavailable'"));

    // RC-2 — and a refused SPEND is not a provider refusal. It produces no
    // coordinate either, but it sends an operator to a completely different
    // remedy: this deployment's own controls rather than broken map access.
    // The two must never collapse into one reason.
    //
    // The state is named for what happened rather than for one of its causes:
    // the lookup was not attempted, and it might not have been because the
    // provider was switched off, because the allowance was spent, or because
    // the shared counter could not be read. `capReason` carries which.
    expect(assignment).toContain('geocoded.capped');
    expect(assignment).toContain("'geocoder_not_attempted'");
    expect(assignment.indexOf('geocoded.capped'))
      .toBeLessThan(assignment.indexOf('geocoded.providerRefused'));
  });

  it('its message says the fault is ours and clears the address', () => {
    const at = src.indexOf('geocoder_unavailable:');
    expect(at).toBeGreaterThan(-1);
    const message = src.slice(at, src.indexOf('\n  supplied_coordinates_rejected:', at));
    // It must not repeat the claim that was false.
    expect(message).not.toContain('The address could not be resolved');
    // It must say whose fault it is, and say the address was not rejected.
    expect(message).toMatch(/map service access/);
    expect(message).toMatch(/never rejected as invalid/);
  });

  it('leaves the genuine address reading exactly as it was', () => {
    // A widening that quietly reworded the true case would be a second change
    // hiding inside this one.
    expect(src).toContain(
      "'The address could not be resolved to a location in Australia — "
      + "location intelligence is unavailable for this property.'",
    );
    expect(src).toContain(
      "'The supplied coordinates are not a location in Australia — "
      + "location intelligence is unavailable for this property.'",
    );
  });

  it('still refuses to invent a location, whichever reason it was', () => {
    // The whole point of the unresolved branch. `generateMockLocationData` is
    // gone and must stay gone: a reason code is an explanation, never a
    // licence to answer with sample data. It survives as PROSE — a comment
    // recording what used to be here — so the assertion is against code
    // alone, or it would fail on the very note that says the thing is gone.
    expect(codeOnly(src)).not.toContain('generateMockLocationData');
    expect(src).toContain('generateMockLocationData');
    expect(src).toMatch(/success:\s*false,\s*\n\s*resolved:\s*false/);
  });
});

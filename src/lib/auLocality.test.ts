import { describe, expect, it } from 'vitest';
import {
  buildGeocodeQuery,
  normaliseAuState,
  normalisePostcode,
  reconcileLocality,
  stateForPostcode,
} from '../../supabase/functions/_shared/auLocality.pure';

describe('stateForPostcode', () => {
  it('maps the ranges', () => {
    expect(stateForPostcode('2000')).toBe('NSW'); // Sydney
    expect(stateForPostcode('3451')).toBe('VIC'); // Campbells Creek
    expect(stateForPostcode('4171')).toBe('QLD'); // Balmoral
    expect(stateForPostcode('5000')).toBe('SA');
    expect(stateForPostcode('6015')).toBe('WA'); // City Beach
    expect(stateForPostcode('7000')).toBe('TAS');
    expect(stateForPostcode('0800')).toBe('NT');
  });

  it('carves ACT out of the NSW block', () => {
    // 2600 is Canberra. A plain 1000-2999 range test would call it NSW.
    expect(stateForPostcode('2600')).toBe('ACT');
    expect(stateForPostcode('2617')).toBe('ACT');
    expect(stateForPostcode('2911')).toBe('ACT');
    expect(stateForPostcode('2619')).toBe('NSW');
    expect(stateForPostcode('2150')).toBe('NSW'); // Parramatta
  });

  it('returns null for anything unallocated', () => {
    for (const value of ['0000', '9999999', 'abcd', '', null, undefined, {}]) {
      expect(stateForPostcode(value)).toBeNull();
    }
  });
});

describe('normaliseAuState / normalisePostcode', () => {
  it('accepts the spellings the sources actually use', () => {
    expect(normaliseAuState('vic')).toBe('VIC');
    expect(normaliseAuState('  Victoria ')).toBe('VIC');
    expect(normaliseAuState('Western Australia')).toBe('WA');
    expect(normaliseAuState('Queensland')).toBe('QLD');
    expect(normaliseAuState('nowhere')).toBeNull();
    expect(normaliseAuState(null)).toBeNull();
  });

  it('zero-pads a three-digit NT postcode', () => {
    expect(normalisePostcode('800')).toBe('0800');
    expect(normalisePostcode(800)).toBe('0800');
    expect(normalisePostcode('6015')).toBe('6015');
  });

  it('rejects a postcode in no allocation', () => {
    expect(normalisePostcode('0000')).toBeNull();
    expect(normalisePostcode('12345')).toBeNull();
    expect(normalisePostcode('')).toBeNull();
  });
});

/**
 * These are the real records. The contamination they describe is what makes the
 * whole module necessary — a geocoder handed the raw values places a Victorian
 * house in Brisbane and the map shows it without hesitation.
 */
describe('reconcileLocality', () => {
  it('drops both when the postcode belongs to another state', () => {
    // rec018CevccTQUqtd: "5 Banya Street, Campbells Creek, VIC" carrying 4171,
    // which is Balmoral, Queensland. Upstream scored this 0.90 address
    // confidence, so no confidence threshold would have caught it.
    const verdict = reconcileLocality({ state: 'VIC', postcode: '4171' });
    expect(verdict.trust).toBe('conflict');
    expect(verdict.state).toBeNull();
    expect(verdict.postcode).toBeNull();
    expect(verdict.conflicts[0]).toContain('4171');
    expect(verdict.conflicts[0]).toContain('QLD');
  });

  it('drops both for the Caboolture case', () => {
    // rec01PEqlXeCrF0X4: Caboolture, QLD carrying 6015 — City Beach, WA. 6015
    // recurs across unrelated records, which is the batch-carryover signature.
    expect(reconcileLocality({ state: 'QLD', postcode: '6015' }).trust).toBe('conflict');
  });

  it('keeps both when they agree', () => {
    const verdict = reconcileLocality({ state: 'NSW', postcode: '2150' });
    expect(verdict).toMatchObject({ state: 'NSW', postcode: '2150', trust: 'record' });
    expect(verdict.conflicts).toHaveLength(0);
  });

  it('derives the state from a lone postcode', () => {
    expect(reconcileLocality({ postcode: '3451' })).toMatchObject({
      state: 'VIC',
      postcode: '3451',
      trust: 'derived',
    });
  });

  it('keeps a lone state', () => {
    expect(reconcileLocality({ state: 'wa' })).toMatchObject({
      state: 'WA',
      postcode: null,
      trust: 'record',
    });
  });

  it('reports nothing usable rather than inventing something', () => {
    expect(reconcileLocality({}).trust).toBe('unknown');
    expect(reconcileLocality({ state: 'Atlantis', postcode: '0000' }).trust).toBe('unknown');
  });

  it('treats an unallocated postcode as absent, not as a conflict', () => {
    // Nothing to contradict the state with, so the state survives.
    expect(reconcileLocality({ state: 'VIC', postcode: '0000' })).toMatchObject({
      state: 'VIC',
      trust: 'record',
    });
  });
});

describe('buildGeocodeQuery', () => {
  it('joins the parts that survived', () => {
    expect(
      buildGeocodeQuery({ address: '5 Banya Street', suburb: 'Campbells Creek', state: 'VIC', postcode: null }),
    ).toBe('5 Banya Street, Campbells Creek, VIC');
  });

  it('refuses the placeholder text', () => {
    // "Unknown Address, Unknown Suburb" is a query Google answers confidently
    // with somewhere entirely unrelated.
    expect(
      buildGeocodeQuery({ address: 'Unknown Address', suburb: 'Unknown Suburb', state: 'NSW' }),
    ).toBe('NSW');
    expect(buildGeocodeQuery({ address: null, suburb: null })).toBe('');
  });
});

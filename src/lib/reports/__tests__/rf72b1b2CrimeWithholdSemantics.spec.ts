import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CRIME_EVIDENCE_WITHHELD_NOTE,
  isTrustedProvenance,
  resolveCrimePostcodeAuthority,
} from '../../../../supabase/functions/_shared/reports/location/crimePostcodeAuthority.pure.ts';
import { crimeStatBlocks } from '../../../../supabase/functions/_shared/reports/crimePromptBlocks.pure.ts';

/**
 * RF-7.2B.1B2 §6 — withheld crime evidence must degrade HONESTLY.
 *
 * RF-7.2B.1B1 settled WHICH postcode may select crime evidence. This settles
 * what the client document is entitled to say when none may. The danger is not
 * the missing table: it is the report reading its own silence as a finding —
 * "zero recorded offences", "low crime", "a safe area" — or quietly serving a
 * state, LGA or SA2 figure in a postcode-shaped slot.
 */

const REPO = resolve(__dirname, '../../../..');
const read = (p: string) => readFileSync(resolve(REPO, p), 'utf8');
const generator = read('supabase/functions/generate-investment-report/index.ts');
const crimeService = read('supabase/functions/crime-statistics-service/index.ts');
const crimeReading = read('supabase/functions/_shared/crimeReading.pure.ts');

/** A complete, trusted reading — the permitted case. */
const READING = {
  areaKind: 'postcode',
  area: '2794',
  state: 'NSW',
  source: 'BOCSAR',
  referencePeriod: 'Jul 2025 – Jun 2026',
  totalLast12Months: 1144,
  totalPrevious12Months: 1111,
  totalChangePct: 2.97,
};

describe('RF-7.2B.1B2 §6 — withheld crime evidence degrades honestly', () => {
  // -- A -------------------------------------------------------------------
  it('A — a resolved canonical POA is the authority, and evidence is permitted', () => {
    const authority = resolveCrimePostcodeAuthority({
      geographyPostcode: '2794',
      structuredPostcode: '9999',
      freeTextPostcode: '2267',
      state: 'NSW',
    });
    expect(authority.trusted).toBe(true);
    expect(authority.provenance).toBe('resolved_geography');
    expect(authority.postcode).toBe('2794');
    // The POA outranks both weaker candidates rather than tie-breaking with them.
    expect(authority.postcode).not.toBe('9999');
    expect(authority.postcode).not.toBe('2267');

    const block = crimeStatBlocks({ crimeStatistics: READING });
    expect(block).toContain('Recorded offences in postcode 2794');
    expect(block).toContain('1,144');
  });

  // -- B -------------------------------------------------------------------
  it('B — with no resolved POA the postcode-specific counts are withheld', () => {
    const authority = resolveCrimePostcodeAuthority({
      geographyPostcode: null,
      structuredPostcode: '2794',
      freeTextPostcode: '2794',
      state: 'NSW',
    });
    expect(authority.trusted).toBe(false);
    expect(authority.postcode).toBeNull();
    expect(isTrustedProvenance(authority.provenance)).toBe(false);

    // The generator withholds the block outright on an untrusted authority.
    expect(generator).toContain('crimeStatistics: undefined');
    expect(generator).toContain('!crimeAuthority.trusted && enhancedData.crimeStatistics');
  });

  // -- C -------------------------------------------------------------------
  it('C — a withheld count never becomes a numerical zero', () => {
    for (const withheld of [
      {},
      { crimeStatistics: undefined },
      { crimeStatistics: {} },
      { crimeStatistics: { areaKind: 'postcode', area: '2794' } },
      { crimeStatistics: { totalLast12Months: null } },
    ]) {
      const block = crimeStatBlocks(withheld as never);
      // No figure of any kind, and specifically no zero.
      expect(block).not.toMatch(/\b0\b/);
      expect(block).not.toMatch(/\*\*\d/);
      expect(block).not.toContain('|');           // no table
      expect(block).not.toMatch(/per 100,000/);   // no rate
    }
  });

  // -- D -------------------------------------------------------------------
  it('D — a withheld reading cannot become a qualitative safety conclusion', () => {
    const block = crimeStatBlocks({});
    // It says what it is, and forbids the invention explicitly.
    expect(block).toContain('No recorded-crime register is integrated for this location');
    expect(block).toMatch(/do NOT print a crime table, a safety score, a rating or an estimated rate/);
    // and carries no positive safety CLAIM a reader could lift.
    //
    // Whole phrases, not tokens: the block legitimately contains the word
    // "safety" inside "do NOT print ... a safety score", which is a
    // prohibition and the opposite of a claim. A bare-substring ban would
    // fail the code for saying exactly the right thing.
    for (const claim of [
      'low crime', 'safe area', 'safe neighbourhood', 'safe suburb',
      'zero offences', 'no recorded offences', 'no offences', 'crime-free',
      'lower than average', 'below average', 'well below', 'relatively safe',
    ]) {
      expect(block.toLowerCase()).not.toContain(claim);
    }
    // Nothing in it asserts a quantity at all.
    expect(block).not.toMatch(/\b\d/);
    // The operator-facing withheld note is not client prose and says so.
    expect(CRIME_EVIDENCE_WITHHELD_NOTE.toLowerCase()).not.toContain('low crime');
    expect(CRIME_EVIDENCE_WITHHELD_NOTE.toLowerCase()).not.toContain('safe');
  });

  // -- E -------------------------------------------------------------------
  it('E — a free-text parse is never an authority, at any rank', () => {
    expect(isTrustedProvenance('free_text_parse')).toBe(false);
    expect(isTrustedProvenance('structured_subject')).toBe(false);
    expect(isTrustedProvenance('none')).toBe(false);
    expect(isTrustedProvenance('resolved_geography')).toBe(true);

    // The measured case: a lot number that is a real postcode in another state.
    const lot = resolveCrimePostcodeAuthority({
      freeTextPostcode: '2267',            // parsed from "Lot 2267 Hunza Road"
      state: 'VIC',
      structuredPostcode: '2267',
    });
    expect(lot.trusted).toBe(false);
    expect(lot.postcode).toBeNull();

    // Even where it does not contradict the state, it is still not trusted.
    const consistent = resolveCrimePostcodeAuthority({
      freeTextPostcode: '2794', state: 'NSW',
    });
    expect(consistent.trusted).toBe(false);

    // and the generator sends the authority rather than the parsed variable
    expect(generator).toContain('postcode: crimePostcodeAtIntake.postcode');
    expect(generator).toContain('crimePostcodeAtIntake.trusted');
  });

  // -- F -------------------------------------------------------------------
  it('F — nothing substitutes a state, LGA or SA2 figure into a postcode slot', () => {
    // State-wide movement is only ever composed ALONGSIDE a real local total,
    // never in place of one: it lives after the `total === null` early return.
    const withheld = crimeStatBlocks({});
    expect(withheld).not.toContain('State-wide movement');

    const present = crimeStatBlocks({
      crimeStatistics: { ...READING, stateContext: { totalChangePct: -3.14 } },
    });
    expect(present).toContain('State-wide movement');
    // and it is labelled as state-wide rather than presented as the area's own
    expect(present).toMatch(/State-wide movement over the same window/);

    // The service refuses rather than widening the geography.
    expect(crimeService).toContain('figures are unavailable rather than guessed from a suburb name');
    expect(crimeService).toContain("refusing rather than reporting another council's offences");
  });

  // -- G -------------------------------------------------------------------
  it('G — the QLD LGA path needs a cadastre LGA and states its grain', () => {
    // Reachable only once planning data has resolved the parcel from the
    // verified coordinate.
    expect(generator).toContain("enhancedData.planningData?.parcel?.status === 'ok'");
    expect(generator).toMatch(/state === 'QLD' && qldLga/);
    // and it carries the authoritative postcode beside the LGA, not the parse
    expect(generator).toContain('postcode: crimeAuthority.postcode, lga: qldLga');
    expect(generator).not.toMatch(/state, postcode, lga/);

    // No LGA supplied → refused, never keyed off the suburb name.
    expect(crimeService).toContain("eq('area_kind', 'lga')");
    expect(crimeService).toMatch(/if \(wanted === ''\)/);

    // The grain is explicit in the client-facing prose, not implied.
    expect(crimeReading).toContain("areaKind: 'local government area'");
    const lgaBlock = crimeStatBlocks({
      crimeStatistics: { ...READING, areaKind: 'local government area', area: 'Cowra Shire', state: 'QLD' },
    });
    expect(lgaBlock).toContain('Recorded offences in local government area Cowra Shire');
    expect(lgaBlock).toContain('never add the two levels together');
  });

  it('the two vocabularies stay apart — an obligation is not an outcome', () => {
    // A withheld reading and a measured zero must not read alike.
    const measuredZero = crimeStatBlocks({ crimeStatistics: { ...READING, totalLast12Months: 0 } });
    expect(measuredZero).toContain('Recorded offences in postcode 2794');
    expect(measuredZero).toContain('**0**');
    expect(crimeStatBlocks({})).not.toContain('Recorded offences in');
  });
});

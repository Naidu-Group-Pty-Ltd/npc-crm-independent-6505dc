import { describe, expect, it } from 'vitest';
import {
  CONFLICT_MAX_EXPLICIT_TERMS,
  CONFLICT_MAX_TERMS,
  conflictHit,
  conflictKey,
  conflictOutcome,
  conflictSearchTerms,
} from './conflictSearch.pure.ts';

/**
 * The conflict search's judgement, run rather than described.
 *
 * The defects this replaces all reported ABSENCE: a term normalised on one
 * side of the comparison only could not find the party it was copied from, a
 * filter composed as a string could not be trusted with a comma or a bracket
 * in a company name, and a search over nothing recorded "clear". Each case
 * below is one of those, stated as the answer a solicitor should get.
 */

describe('conflictKey', () => {
  it('makes the spellings of one name the same key', () => {
    const same: string[][] = [
      ['ACME (Aust) Pty Ltd', 'ACME Aust Pty. Ltd.', 'acme  aust pty ltd'],
      ["O'Brien", 'OBrien', 'o brien', 'O’Brien'],
      ['Zoë Müller', 'Zoe Muller', 'ZOE MÜLLER'],
      ['Ｓｍｉｔｈ Holdings', 'Smith-Holdings', 'smith holdings'],
    ];
    for (const spellings of same) {
      const keys = new Set(spellings.map(conflictKey));
      expect(keys.size, spellings.join(' / ')).toBe(1);
    }
  });

  it('keeps different names apart', () => {
    expect(conflictKey('Smith Pty Ltd')).not.toBe(conflictKey('Smyth Pty Ltd'));
    expect(conflictKey('Unit 12')).not.toBe(conflictKey('Unit 21'));
  });

  it('leaves only letters and digits, so a key can carry no filter syntax', () => {
    for (const hostile of ['a%b,c(d)', "x' OR 1=1 --", 'name.ilike.*', 'a_b\\c', '(ACME),(or)']) {
      expect(conflictKey(hostile)).toMatch(/^[\p{L}\p{N}]*$/u);
    }
  });
});

describe('conflictSearchTerms', () => {
  it("searches the matter's parties, so a matter with parties always has terms", () => {
    const terms = conflictSearchTerms(undefined, [
      { name: 'Jane Citizen', organisation: null },
      { name: null, organisation: 'ACME (Aust) Pty Ltd' },
    ]);
    expect(terms.map(([, term]) => term)).toEqual(['Jane Citizen', 'ACME (Aust) Pty Ltd']);
  });

  it('puts the caller’s own terms first and keeps one entry per key', () => {
    const terms = conflictSearchTerms(
      ['Acme Aust Pty. Ltd.', 'Harbour Trust'],
      [{ name: 'ACME (Aust) Pty Ltd' }, { name: 'harbour   trust' }, { name: 'New Party' }],
    );
    expect(terms.map(([, term]) => term)).toEqual(['Acme Aust Pty. Ltd.', 'Harbour Trust', 'New Party']);
  });

  it('drops what is too short to be a search, and anything that is not a string', () => {
    const terms = conflictSearchTerms(['Li', 'J.', '   ', 42, null, { name: 'x' }, 'Lee'], [{ name: 'Al' }]);
    expect(terms.map(([, term]) => term)).toEqual(['Lee']);
  });

  it('bounds the caller’s terms and the whole search', () => {
    const many = Array.from({ length: 60 }, (_, i) => `Explicit Party ${i}`);
    expect(conflictSearchTerms(many, [])).toHaveLength(CONFLICT_MAX_EXPLICIT_TERMS);
    const parties = Array.from({ length: 60 }, (_, i) => ({ name: `Recorded Party ${i}` }));
    const bounded = conflictSearchTerms(many, parties);
    expect(bounded).toHaveLength(CONFLICT_MAX_TERMS);
    // The caller's own terms survive the bound; the parties fill what is left.
    expect(bounded.slice(0, CONFLICT_MAX_EXPLICIT_TERMS).every(([, term]) => term.startsWith('Explicit'))).toBe(true);
  });

  it('reads back a term as it was written, only its whitespace collapsed', () => {
    const [[key, term]] = conflictSearchTerms(['  ACME   (Aust)\tPty Ltd '], []);
    expect(term).toBe('ACME (Aust) Pty Ltd');
    expect(key).toBe('acmeaustptyltd');
  });
});

describe('conflictHit', () => {
  const searched = conflictSearchTerms(undefined, [
    { name: 'Jane Citizen' },
    { organisation: 'ACME (Aust) Pty Ltd' },
  ]);

  it('finds the party a term was copied from, however it was punctuated there', () => {
    expect(conflictHit(searched, { organisation: 'Acme Aust Pty. Ltd.' })?.[1]).toBe('ACME (Aust) Pty Ltd');
    expect(conflictHit(searched, { name: 'JANE CITIZEN' })?.[1]).toBe('Jane Citizen');
  });

  it('reads the name and the organisation both', () => {
    expect(conflictHit(searched, { name: 'Someone Else', organisation: 'ACME (AUST) PTY LTD' })).toBeDefined();
  });

  it('errs towards a match: a stored name that contains a term is a hit', () => {
    expect(conflictHit(searched, { name: 'Jane Citizen-Smith' })).toBeDefined();
  });

  it('does not match a party that shares nothing, or has no name at all', () => {
    expect(conflictHit(searched, { name: 'John Doe', organisation: 'Other Co' })).toBeUndefined();
    expect(conflictHit(searched, { name: null, organisation: '' })).toBeUndefined();
  });
});

describe('conflictOutcome', () => {
  it('never records a search over nothing as a clearance', () => {
    expect(conflictOutcome(0, 0)).toBe('pending');
  });

  it('clears only when something was searched and nothing was found', () => {
    expect(conflictOutcome(12, 0)).toBe('clear');
    expect(conflictOutcome(12, 1)).toBe('potential_conflict');
  });
});

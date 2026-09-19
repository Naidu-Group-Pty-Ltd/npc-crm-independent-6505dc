/**
 * Audit item 9 — the client card and "View Full Calculator" showed two
 * different borrowing capacities for the same client, $560,073 and $485,149.
 *
 * The whole $74,924 was one question answered two ways: is this household a
 * couple? HEM's base is $2,100/month for a single and $2,950 for a couple,
 * this household sits on the 1.40 income multiplier, and living expenses are
 * `max(HEM, declared)` against $3,500 declared — so the two readings bind at
 * $3,500 and $4,130, which is $630/month, which at the 9.5% assessment rate
 * over 30 years is exactly $74,924 of capacity.
 *
 * These pin the rule and the production spellings it has to survive.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  COUPLE_MARITAL_STATUSES,
  coupleBasis,
  describeHousehold,
  householdCategory,
  isCoupleHousehold,
  normaliseMaritalStatus,
} from '@/lib/householdComposition.pure';

describe('the spellings that are actually in the database', () => {
  // Measured 2026-08-31 against `public.clients`: Married 11, married 11,
  // single 5, Single 2, Defacto 1, Widow 1, widowed 1, NULL 744.
  it.each([
    ['Married', true],
    ['married', true],
    ['Defacto', true],
    ['single', false],
    ['Single', false],
    ['Widow', false],
    ['widowed', false],
    [null, false],
  ] as const)('%s → couple: %s', (status, expected) => {
    expect(isCoupleHousehold({ maritalStatus: status })).toBe(expected);
  });

  it('reads Defacto, which no implementation could match before', () => {
    // The server and the policy engine looked for `de facto` (a space) and the
    // modal for `de_facto` (an underscore). The column holds `Defacto`, so the
    // one de-facto client in the system was assessed as a single household by
    // every one of them.
    expect(normaliseMaritalStatus('Defacto')).toBe('defacto');
    expect(normaliseMaritalStatus('de facto')).toBe('defacto');
    expect(normaliseMaritalStatus('de_facto')).toBe('defacto');
    expect(normaliseMaritalStatus('De-Facto')).toBe('defacto');
    for (const spelling of ['Defacto', 'de facto', 'de_facto', 'De-Facto']) {
      expect(isCoupleHousehold({ maritalStatus: spelling })).toBe(true);
    }
  });
});

describe('a second applicant is a second person in the household', () => {
  it('makes a couple whatever the status field says', () => {
    // Fourteen clients carry a secondary_first_name. For five of them — three
    // with no status recorded, one Defacto, one widowed — the server said
    // single while the screen beside it said couple.
    expect(isCoupleHousehold({ maritalStatus: null, secondaryApplicantName: 'Sam' })).toBe(true);
    expect(isCoupleHousehold({ maritalStatus: 'widowed', secondaryApplicantName: 'Kunjimon' })).toBe(true);
    expect(isCoupleHousehold({ maritalStatus: 'Defacto', secondaryApplicantName: 'Kirukku' })).toBe(true);
  });

  it('is never the reverse — a couple status stands with no second name', () => {
    expect(isCoupleHousehold({ maritalStatus: 'married', secondaryApplicantName: null })).toBe(true);
  });

  it('ignores a name that is only whitespace', () => {
    // `secondary_first_name` holds trailing spaces in production ("Sam ",
    // "Sumana "), so it is trimmed — but an empty string must not promote a
    // single household to a couple.
    expect(isCoupleHousehold({ maritalStatus: null, secondaryApplicantName: '   ' })).toBe(false);
    expect(isCoupleHousehold({ maritalStatus: null, secondaryApplicantName: 'Sam ' })).toBe(true);
  });
});

describe('the classification explains itself', () => {
  it('names which of the two reasons applied', () => {
    expect(coupleBasis({ maritalStatus: 'Married' })).toBe('marital_status');
    expect(coupleBasis({ secondaryApplicantName: 'Atish' })).toBe('secondary_applicant');
    expect(coupleBasis({ maritalStatus: 'single' })).toBe('none');
  });

  it('says so in words an operator reads, with no column names in it', () => {
    for (const household of [
      { maritalStatus: 'Married' },
      { secondaryApplicantName: 'Atish' },
      { maritalStatus: 'single' },
    ]) {
      const text = describeHousehold(household);
      expect(text).not.toMatch(/_/);
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it('keys the HEM tables', () => {
    expect(householdCategory({ maritalStatus: 'married' })).toBe('couple');
    expect(householdCategory({ maritalStatus: null })).toBe('single');
  });
});

describe('the couple list', () => {
  it('holds only normalised spellings, or an entry can never match', () => {
    for (const status of COUPLE_MARITAL_STATUSES) {
      expect(normaliseMaritalStatus(status)).toBe(status);
    }
  });

  it('excludes every status that describes one adult', () => {
    for (const status of ['single', 'widowed', 'widow', 'divorced', 'separated']) {
      expect(COUPLE_MARITAL_STATUSES).not.toContain(status);
    }
  });
});

describe('there is exactly one implementation', () => {
  const root = join(__dirname, '..', '..', '..');
  const sources = [
    'supabase/functions/calculate-borrowing-capacity/index.ts',
    'src/utils/borrowingCapacityCalculations.ts',
    'src/utils/policyEngine.ts',
    'src/components/borrowing-capacity/BorrowingCapacityModal.tsx',
  ];

  it.each(sources)('%s does not carry its own couple list', (relative) => {
    const source = readFileSync(join(root, relative), 'utf8');
    // The inline list that was in all four, in two spellings. A comment may
    // mention it; an array literal may not.
    expect(source).not.toMatch(/\[\s*'married'\s*,\s*'de[ _]facto'/);
    expect(source).not.toMatch(/marital_status === 'de_facto'/);
  });

  it('routes every HEM lookup through the shared classifier', () => {
    for (const relative of sources.slice(0, 3)) {
      expect(readFileSync(join(root, relative), 'utf8')).toMatch(/householdCategory\(/);
    }
  });

  it('hands the server the whole household, not a status string', () => {
    // The server's HEM function takes a HouseholdComposition precisely so a
    // call site cannot leave the second applicant out — which is the omission
    // that made the two screens disagree.
    const engine = readFileSync(join(root, sources[0]), 'utf8');
    expect(engine).toMatch(/function getHemBenchmark\(household: HouseholdComposition/);
    expect(engine).toMatch(/secondaryApplicantName: client\.secondary_first_name/);
  });

  it('passes the second applicant from the calculator too', () => {
    const modal = readFileSync(join(root, sources[3]), 'utf8');
    expect(modal).toMatch(/clientData\?\.client\?\.secondary_first_name \?\? null/);
  });
});

describe('the correction can only ever go one way', () => {
  /**
   * The rule this replaced, verbatim from all three server-side copies.
   * Kept here as data so the property below is checked against the real
   * predecessor rather than against a description of it.
   */
  const previousRule = (maritalStatus: string | null | undefined) =>
    ['married', 'de facto', 'couple', 'partnered']
      .includes(String(maritalStatus ?? '').toLowerCase());

  const spellings = [
    null, undefined, '', 'married', 'Married', 'MARRIED', 'de facto', 'De Facto',
    'de_facto', 'Defacto', 'defacto', 'couple', 'Couple', 'partnered', 'spouse',
    'single', 'Single', 'widowed', 'Widow', 'divorced', 'separated', 'unknown',
  ];

  it('never turns a couple household into a single one', () => {
    // This is the safety property. A household reclassified single would
    // LOWER its HEM and RAISE the capacity reported for it — the dangerous
    // direction, and the one that cannot be justified as prudence. The new
    // rule is a strict superset of the old, so it cannot happen: normalising
    // only widens what matches, and a secondary applicant only adds.
    for (const status of spellings) {
      for (const secondary of [null, 'Kirukku']) {
        if (previousRule(status)) {
          expect(isCoupleHousehold({ maritalStatus: status, secondaryApplicantName: secondary }))
            .toBe(true);
        }
      }
    }
  });

  it('changes exactly the cases production showed were wrong', () => {
    // Defacto — the only de-facto spelling in the column, matched by nothing.
    expect(previousRule('Defacto')).toBe(false);
    expect(isCoupleHousehold({ maritalStatus: 'Defacto' })).toBe(true);

    // A second applicant with no usable status — three clients.
    expect(previousRule(null)).toBe(false);
    expect(isCoupleHousehold({ maritalStatus: null, secondaryApplicantName: 'Atish' })).toBe(true);

    // And nothing else moves.
    for (const status of ['single', 'Single', 'widowed', 'Widow', 'divorced', 'separated']) {
      expect(isCoupleHousehold({ maritalStatus: status })).toBe(false);
    }
  });
});

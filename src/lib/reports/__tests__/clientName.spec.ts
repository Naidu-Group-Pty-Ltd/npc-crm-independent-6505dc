/**
 * The columns a client's name is actually stored in.
 *
 * `render-borrowing-capacity-pdf` selected `id, first_name, surname,
 * company_name` from `clients`. **None of those three columns exists.**
 * PostgREST answered `column clients.first_name does not exist`, supabase-js
 * returned `{ data: null, error }`, and the route's `if (!clientRes.data)`
 * turned that into `{ error: 'not found' }` with a 404 — for every client in
 * the database, on every request. `borrowing_capacity_renders` had no rows
 * because the function never got past its first read.
 *
 * Nothing could catch it: the columns are strings inside a query builder, so
 * TypeScript sees nothing, and the only symptom was a 404 that reads like a
 * permissions problem. Two guards, then:
 *
 *  1. The helper is tested against the shapes production actually holds.
 *  2. Both render routes must use the shared constant rather than spelling the
 *     columns themselves, and neither may name the three that do not exist.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  CLIENT_NAME_COLUMNS,
  clientDisplayName,
  smartCapitalize,
} from '../../../../supabase/functions/_shared/clientName';

const REPO = resolve(__dirname, '../../../..');
const read = (path: string) => readFileSync(resolve(REPO, path), 'utf8');

const ROUTES = [
  'supabase/functions/render-borrowing-capacity-pdf/index.ts',
  'supabase/functions/render-cash-flow-pdf/index.ts',
] as const;

describe('CLIENT_NAME_COLUMNS', () => {
  /**
   * Verified against the live schema, not assumed: `information_schema.columns`
   * for `public.clients` has `primary_first_name`, `primary_surname`,
   * `secondary_first_name` and `secondary_surname`, and has no `first_name`,
   * `surname` or `company_name` at all.
   */
  it('names the four columns the table has', () => {
    expect(CLIENT_NAME_COLUMNS.split(',').map((c) => c.trim())).toEqual([
      'id',
      'primary_first_name',
      'primary_surname',
      'secondary_first_name',
      'secondary_surname',
    ]);
  });

  it('names none of the three that broke this', () => {
    for (const ghost of ['first_name', 'surname', 'company_name']) {
      // Word-boundary, so `primary_first_name` does not count as `first_name`.
      expect(CLIENT_NAME_COLUMNS).not.toMatch(new RegExp(`(^|[ ,])${ghost}([ ,]|$)`));
    }
  });
});

describe('clientDisplayName', () => {
  /** The three rows the corrected select returns for clients with assessments. */
  it.each([
    [{ primary_first_name: 'rugesh', primary_surname: 'naidu' }, 'Rugesh Naidu'],
    [{ primary_first_name: 'samuel', primary_surname: 'lavis' }, 'Samuel Lavis'],
    [
      {
        primary_first_name: 'lavanethaan',
        primary_surname: 'ravachandran',
        secondary_first_name: 'Kunjimon',
        secondary_surname: 'Koothy',
      },
      'Lavanethaan Ravachandran',
    ],
  ])('reads %o as the primary applicant', (row, expected) => {
    expect(clientDisplayName(row)).toBe(expected);
  });

  it('falls back to the secondary applicant when the primary has no name', () => {
    expect(clientDisplayName({
      primary_first_name: null,
      primary_surname: null,
      secondary_first_name: 'Kunjimon',
      secondary_surname: 'Koothy',
    })).toBe('Kunjimon Koothy');
  });

  it('uses whichever half of a name is present', () => {
    expect(clientDisplayName({ primary_surname: 'naidu' })).toBe('Naidu');
    expect(clientDisplayName({ primary_first_name: 'rugesh' })).toBe('Rugesh');
  });

  /**
   * Empty rather than a placeholder, so the caller decides. The Snapshot's
   * cover says "Client"; the Cash Flow cover omits the line entirely.
   */
  it('has nothing to say about a row with no name on it', () => {
    for (const empty of [null, undefined, {}, { primary_first_name: '   ', primary_surname: '' }]) {
      expect(clientDisplayName(empty as never)).toBe('');
    }
  });
});

describe('smartCapitalize', () => {
  /** Names in this database are stored lower-case; a cover should not shout. */
  it('title-cases a name that is all one case', () => {
    expect(smartCapitalize('rugesh naidu')).toBe('Rugesh Naidu');
    expect(smartCapitalize('JOHN SMITH')).toBe('John Smith');
  });

  it('leaves a name that already has case alone', () => {
    expect(smartCapitalize('de Silva Fernando')).toBe('de Silva Fernando');
    expect(smartCapitalize('McArthur')).toBe('McArthur');
  });

  it('capitalises after a hyphen and an apostrophe, not only a space', () => {
    expect(smartCapitalize("mary-jane o'brien")).toBe("Mary-Jane O'Brien");
  });
});

describe('the render routes read the client the one way', () => {
  it.each(ROUTES)('%s uses the shared constant', (path) => {
    const source = read(path);
    expect(source).toContain("from '../_shared/clientName.ts'");
    expect(source).toMatch(/\.select\(CLIENT_NAME_COLUMNS\)/);
  });

  it.each(ROUTES)('%s spells no client column itself', (path) => {
    const source = read(path);
    // Any `.select('…')` naming one of the three ghosts. `primary_first_name`
    // and `whitelabel.company_name` are fine — this looks only inside selects.
    for (const select of source.match(/\.select\(\s*'[^']*'\s*\)/g) ?? []) {
      for (const ghost of ['first_name', 'surname', 'company_name']) {
        expect(
          new RegExp(`(^|[ ,'])${ghost}([ ,']|$)`).test(select),
          `${path} selects \`${ghost}\`, which is not a column on any table this route reads`,
        ).toBe(false);
      }
    }
  });

  /**
   * The systemic half of the fix. A select that errors returns `data: null`,
   * and a route that reads only `data` cannot tell "no such row" from "that
   * query was wrong" — which is exactly how a typo became a 404 nobody could
   * diagnose.
   */
  it('render-borrowing-capacity-pdf refuses to read a failed query as a missing row', () => {
    const source = read(ROUTES[0]);
    expect(source).toMatch(/if \(res\.error\)/);
    expect(source).toContain('could not read the');
  });
});

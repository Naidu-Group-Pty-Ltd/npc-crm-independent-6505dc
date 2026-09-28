/**
 * Finding a client before creating one, and creating one the table will accept.
 *
 * The three defects these pin each pushed an adviser towards a duplicate or a
 * failure: a full name found nobody, a single name was accepted and then
 * failed as a 500 on a NOT NULL column, and an email guard built on `ilike`
 * treated `_` as a wildcard.
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_SEARCH_WORDS, clientSearchFilters, filterSafeWord, newClientProblem, sameEmail, searchWords,
} from '../../../../supabase/functions/_shared/ciAssessments/clientRecords.pure';

describe('searching the client book', () => {
  it('finds a full name — each word may match a different field', () => {
    const filters = clientSearchFilters('Marcus Chen');
    expect(filters).toHaveLength(2);
    expect(filters[0]).toContain('primary_first_name.ilike.%Marcus%');
    expect(filters[0]).toContain('primary_surname.ilike.%Marcus%');
    expect(filters[1]).toContain('primary_surname.ilike.%Chen%');
    expect(filters[1]).toContain('primary_email.ilike.%Chen%');
  });

  it('cannot be used to add a condition of its own', () => {
    for (const hostile of ['a,id.eq.1', 'x)or(id.eq.1', 'a*b', 'a\\b', '"quoted"', '100%']) {
      for (const filter of clientSearchFilters(hostile)) {
        // Each filter is exactly three or four conditions, and nothing the
        // term contained can split or group them.
        const conditions = filter.split(',');
        expect(conditions.length, hostile).toBeLessThanOrEqual(4);
        for (const condition of conditions) {
          expect(condition, hostile).toMatch(/^primary_[a-z_]+\.ilike\.%[^,()"*\\%]*%$/);
        }
      }
    }
  });

  it('treats a phone number as one search, in any spacing', () => {
    expect(clientSearchFilters('0412 345 678')).toEqual(['primary_mobile.ilike.%0%4%1%2%3%4%5%6%7%8%']);
    expect(clientSearchFilters('(02) 9876-5432')).toEqual(['primary_mobile.ilike.%0%2%9%8%7%6%5%4%3%2%']);
    // Too short to be read as a number spread out — matched as a word instead.
    expect(clientSearchFilters('0412')[0]).toContain('primary_mobile.ilike.%0412%');
  });

  it('drops single letters and repeats, and stops at a sensible number of words', () => {
    expect(searchWords('J Smith smith')).toEqual(['Smith']);
    expect(searchWords('a b c d e f g h')).toEqual([]);
    expect(searchWords('one two three four five six')).toHaveLength(MAX_SEARCH_WORDS);
    expect(filterSafeWord('o_brien')).toBe('o_brien');
  });

  it('returns no filter for an empty term, which lists recent clients', () => {
    expect(clientSearchFilters('   ')).toEqual([]);
  });
});

describe('creating a client', () => {
  it('requires both names, because the table stores both as NOT NULL', () => {
    expect(newClientProblem({ firstName: 'Marcus', surname: '' })?.code).toBe('MISSING_NAME');
    expect(newClientProblem({ firstName: '', surname: 'Chen' })?.code).toBe('MISSING_NAME');
    expect(newClientProblem({ firstName: '  ', surname: 'Chen' })?.code).toBe('MISSING_NAME');
    expect(newClientProblem({ firstName: 'Marcus', surname: 'Chen' })).toBeNull();
  });

  it('refuses an email that is not one', () => {
    expect(newClientProblem({ firstName: 'Marcus', surname: 'Chen', email: 'marcus' })?.code).toBe('INVALID_EMAIL');
    expect(newClientProblem({ firstName: 'Marcus', surname: 'Chen', email: 'marcus@chen.com.au' })).toBeNull();
  });

  it('decides a duplicate on the address itself, not on a wildcard match', () => {
    expect(sameEmail('Jo_Smith@Example.com', 'jo_smith@example.com')).toBe(true);
    expect(sameEmail('joXsmith@example.com', 'jo_smith@example.com')).toBe(false);
    expect(sameEmail('', '')).toBe(false);
    expect(sameEmail(null, 'a@b.co')).toBe(false);
  });

  it('is enforced by the server with the same rule', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(process.cwd(), 'supabase/functions/manage-ci-assessments/index.ts'), 'utf8');
    const create = source.slice(source.indexOf("case 'create_client': {"), source.indexOf("case 'link_client': {"));
    expect(create).toContain('newClientProblem({ firstName, surname, email })');
    expect(create).toContain('sameEmail(row.primary_email, email)');
    // Never null into a NOT NULL column again.
    expect(create).not.toMatch(/primary_first_name: firstName \|\| null/);
    expect(create).not.toMatch(/primary_surname: surname \|\| null/);
    // The existing record is named only where the caller may reach it.
    expect(create).toContain('loadReachableClient(');
    expect(create).toContain("'DUPLICATE_EMAIL_UNREACHABLE'");
  });
});

/**
 * A construction year is one fact under three spellings, and the read path
 * asked for the only one nothing writes.
 *
 * Measured on production, 18 Sep 2026, over all 1,230 stored reports:
 *
 * | where a construction year lives      | reports |
 * | ------------------------------------ | ------: |
 * | `manual_overrides.constructionYear`  |  **32** |
 * | `property_specs.year_built`          |       0 |
 *
 * The override registry's key is `constructionYear` (`src/types/overrideFields.ts`),
 * the generator sends `propertyDetails.constructionYear`, and the spec column is
 * `year_built` — while `readPropertyFacts` asked for `o.yearBuilt`, a key no
 * surface in this product writes. So 262 Pallas Street carries 1941 and every
 * reader downstream of this function saw null.
 *
 * `reportBindingProjection.pure.ts` already healed the same three spellings for
 * template bindings. This is the same heal on the path the scorer and the fork
 * read, so one fact reaches both.
 */

import { describe, expect, it } from 'vitest';
import { readPropertyFacts } from '../../../../supabase/functions/_shared/reports/investment/propertyRecord.pure.ts';

describe('a construction year is read under every spelling that exists', () => {
  it('reads the override key the registry actually writes', () => {
    // 262 Pallas Street, verbatim shape.
    const facts = readPropertyFacts({ property_type: 'house' }, { constructionYear: 1941 });
    expect(facts.yearBuilt).toBe(1941);
  });

  it('prefers the spec column where one was composed', () => {
    const facts = readPropertyFacts({ year_built: 1998 }, { constructionYear: 1941 });
    expect(facts.yearBuilt).toBe(1998);
  });

  it('still reads the legacy camelCase override', () => {
    expect(readPropertyFacts({}, { yearBuilt: 2004 }).yearBuilt).toBe(2004);
  });

  it('is null where no spelling carries one, never a guess', () => {
    // 18 Annabelle Crescent: no construction year on the record at all.
    expect(readPropertyFacts({ property_type: 'house' }, {}).yearBuilt).toBeNull();
  });
});

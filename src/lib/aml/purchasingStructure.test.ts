import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ENTITY_ONLY_STRUCTURE_FIELDS, LEGAL_ENTITY_STRUCTURES, PURCHASING_STRUCTURE_TYPES,
  collectsEntityFields, prunePurchasingStructure,
} from './purchasingStructure';
import {
  applicableQuestionnaireSections,
} from '../../../supabase/functions/_shared/aml/questionnaireSections.pure';

/**
 * The rule that decides which purchasing-structure questions apply.
 *
 * It is shared by the portal form (which renders it) and `save_questionnaire`
 * (which enforces it at the write boundary), so these cover the thing that
 * actually went wrong: an Individual purchaser whose stored payload carried a
 * company name, an ABN and a list of directors, invisibly, all the way into the
 * submission snapshot.
 */

const ENTITY_ANSWERS = {
  entity_name: 'Example Pty Ltd',
  abn_acn: '12345678901',
  controllers: 'Ada Example, Grace Example',
  beneficial_owners: 'Ada Example — 60%',
  registered_address: '1 Example Street, Sydney NSW',
};

describe('which structures are asked the entity questions', () => {
  it('asks a company, trust, SMSF or partnership', () => {
    for (const type of ['Company', 'Trust', 'SMSF', 'Partnership']) {
      expect(collectsEntityFields(type), type).toBe(true);
    }
  });

  it('asks neither an individual nor a joint purchase', () => {
    // Two people buying in their own names are not a legal entity: no legal
    // name, no ABN/ACN, no registered office, no >25% controller.
    expect(collectsEntityFields('Individual')).toBe(false);
    expect(collectsEntityFields('Joint')).toBe(false);
  });

  it('asks nothing before a structure has been chosen', () => {
    expect(collectsEntityFields('')).toBe(false);
    expect(collectsEntityFields(undefined)).toBe(false);
    expect(collectsEntityFields(null)).toBe(false);
  });

  it('is case-sensitive against the canonical vocabulary', () => {
    // `company` is not a structure the questionnaire accepts, and treating it
    // as one would collect entity answers against a value the server rejects.
    expect(collectsEntityFields('company')).toBe(false);
  });

  it('offers the six types the questionnaire validates', () => {
    expect([...PURCHASING_STRUCTURE_TYPES]).toEqual([
      'Individual', 'Joint', 'Company', 'Trust', 'SMSF', 'Partnership',
    ]);
  });

  it('agrees with the section engine about what a legal entity is', () => {
    // `ENTITY_STRUCTURES` in the edge function decides whether the
    // `entity_details` SECTION is raised. A structure that gets that section is
    // exactly one whose entity questions apply — if the two ever disagree, the
    // portal asks for a company name in a section and then never asks the
    // company anything, or the reverse.
    // The engine moved to `_shared/aml/questionnaireSections.pure.ts`, so the
    // agreement is asserted against its BEHAVIOUR rather than against a
    // regex over its source — the same check, and it survives a refactor.
    const raises = (entity_type: string) =>
      applicableQuestionnaireSections((name) =>
        name === 'purchasing_structure' ? { entity_type } : null,
      ).includes('entity_details');

    for (const structure of LEGAL_ENTITY_STRUCTURES) {
      expect(raises(structure), structure).toBe(true);
    }
    for (const structure of ['Individual', 'Joint']) {
      expect(raises(structure), structure).toBe(false);
    }
  });
});

describe('pruning a purchasing-structure payload', () => {
  it('drops every entity answer for an individual', () => {
    expect(prunePurchasingStructure({ entity_type: 'Individual', ...ENTITY_ANSWERS }))
      .toEqual({ entity_type: 'Individual' });
  });

  it('drops every entity answer for a joint purchase', () => {
    expect(prunePurchasingStructure({ entity_type: 'Joint', ...ENTITY_ANSWERS }))
      .toEqual({ entity_type: 'Joint' });
  });

  it('names the entity-only keys explicitly, so nothing else is touched', () => {
    expect([...ENTITY_ONLY_STRUCTURE_FIELDS]).toEqual([
      'entity_name', 'abn_acn', 'controllers', 'beneficial_owners', 'registered_address',
    ]);
    // An unrelated answer the form may grow later survives the prune.
    expect(prunePurchasingStructure({ entity_type: 'Individual', notes: 'keep me' }))
      .toEqual({ entity_type: 'Individual', notes: 'keep me' });
  });

  it('keeps every entity answer for a company, trust, SMSF and partnership', () => {
    for (const entity_type of ['Company', 'Trust', 'SMSF', 'Partnership']) {
      expect(prunePurchasingStructure({ entity_type, ...ENTITY_ANSWERS }), entity_type)
        .toEqual({ entity_type, ...ENTITY_ANSWERS });
    }
  });

  it('drops entity answers typed before any structure was chosen', () => {
    // Nothing on screen collected them, so nothing may be stored against them.
    expect(prunePurchasingStructure({ ...ENTITY_ANSWERS })).toEqual({});
  });

  it('returns the same object when there is nothing to remove', () => {
    // Load-bearing in the browser: a fresh object per keystroke would re-render
    // and re-schedule the autosave for a payload that had not changed.
    const company = { entity_type: 'Company', ...ENTITY_ANSWERS };
    expect(prunePurchasingStructure(company)).toBe(company);
    const individual = { entity_type: 'Individual' };
    expect(prunePurchasingStructure(individual)).toBe(individual);
  });

  it('does not mutate the payload it is given', () => {
    const before = { entity_type: 'Individual', ...ENTITY_ANSWERS };
    prunePurchasingStructure(before);
    expect(before.entity_name).toBe('Example Pty Ltd');
  });

  it('leaves a non-payload alone rather than throwing', () => {
    expect(prunePurchasingStructure(null as any)).toBeNull();
    expect(prunePurchasingStructure([] as any)).toEqual([]);
  });
});

describe('the server applies the same rule at the write boundary', () => {
  const source = readFileSync(
    join(process.cwd(), 'supabase/functions/aml-client-portal/index.ts'), 'utf8');

  it('prunes purchasing_structure on save, whichever client sent it', () => {
    /*
     * The row is what an analyst reads and what `submit_for_review` freezes,
     * so the guarantee cannot rest on the browser having pruned first.
     *
     * The prune moved from the call site into `questionnaireValidation.ts`
     * when the political-exposure declaration gained one too: that file is
     * the write boundary, and `aml-client-portal/index.ts` is held to a
     * contract that no line of its code may mention PEP, screening, risk or
     * sanctions. What matters here is unchanged — every save goes through a
     * prune the browser cannot skip.
     */
    expect(source).toMatch(/normaliseQuestionnaireSection\(\s*body\.section/);
    const boundary = readFileSync(
      join(process.cwd(),
        'supabase/functions/aml-client-portal/questionnaireValidation.ts'), 'utf8');
    expect(boundary).toContain('purchasingStructure.pure.ts');
    expect(boundary).toMatch(
      /section === 'purchasing_structure'\) return prunePurchasingStructure\(payload\)/);
  });

  it('keeps the staff ownership vocabulary out of the portal function', () => {
    // The field list lives in the shared pure module precisely so this stays
    // true — `beneficial_owners` is also a staff-side table name, and the
    // portal-safety contract forbids it appearing here.
    expect(source).not.toContain('beneficial_owners');
  });
});

/**
 * The site-constraint conversion — the properties that make it safe to
 * activate, asserted rather than promised.
 *
 * The module is written and **not wired**: `CONVERSIONS` in
 * `riskEvidenceConnection.pure.ts` is still empty, so nothing in production
 * reads this and every report scores exactly as it did. These tests exist so
 * the method is a verified unit before that entry is ever made — a module with
 * no caller and no test is the defect `builderPortalUiMounted.spec.ts` was
 * written for, arrived at from the other direction.
 */
import { describe, expect, it } from 'vitest';
import type { ConstraintFamily } from '../../../../supabase/functions/_shared/planning/planningConstraints.pure';
import {
  FAMILY_DEDUCTION,
  SITE_CONSTRAINT_SEVERITY_VERSION,
  combineDeductions,
  scoreSiteConstraints,
  type SeverityFinding,
} from '../../../../supabase/functions/_shared/reports/risk/siteConstraintSeverity.pure';

const f = (family: ConstraintFamily, kind: SeverityFinding['kind']): SeverityFinding => ({ family, kind });

describe('it can never rate an absence', () => {
  it('returns null when no register returned anything', () => {
    expect(scoreSiteConstraints([])).toBeNull();
  });

  it('reads findings and nothing else — no outcome can reach it', () => {
    /*
     * The type is the guarantee: `SeverityFinding` carries no register
     * outcome, so "answered and found nothing" is not expressible here. The
     * caller keeps its own refusal for that case, which is what stops a
     * completed negative becoming a safe score.
     */
    const keys = Object.keys(f('flood', 'hazard'));
    expect(keys).not.toContain('outcome');
    expect(keys.sort()).toEqual(['family', 'kind']);
  });
});

describe('the basis is the publisher’s own triage', () => {
  it('a context reading deducts nothing, because it changes neither', () => {
    const r = scoreSiteConstraints([f('growthArea', 'context'), f('regionalPlan', 'context')])!;
    expect(r.answer).toBe(100);
    // It is still reported: dropping it would hide a retrieval.
    expect(r.deductions).toHaveLength(2);
    expect(r.deductions.every((d) => d.applied === 0)).toBe(true);
  });

  it('a hazard outranks a protection outranks an ordinary control', () => {
    const hazard = scoreSiteConstraints([f('flood', 'hazard')])!.answer;
    const protection = scoreSiteConstraints([f('heritage', 'protection')])!.answer;
    const control = scoreSiteConstraints([f('height', 'control')])!.answer;
    expect(hazard).toBeLessThan(protection);
    expect(protection).toBeLessThan(control);
  });

  it('the ordinary development envelope is not an adverse finding', () => {
    // 97 Poole Road's actual return: Height of Buildings 10 m and Minimum Lot
    // Size 450 m², both `control`, both mapped over the land at the point.
    const r = scoreSiteConstraints([f('height', 'control'), f('minimumLotSize', 'control')])!;
    expect(r.answer).toBe(91);
    // A normal suburban lot must not read as constrained.
    expect(r.answer).toBeGreaterThan(85);
  });

  it('names a deduction for every family the vocabulary declares', () => {
    // A family with no entry would fall through to `other` silently, which is
    // how a real constraint comes to be scored as an unknown one.
    for (const family of Object.keys(FAMILY_DEDUCTION) as ConstraintFamily[]) {
      expect(typeof FAMILY_DEDUCTION[family], family).toBe('number');
      expect(FAMILY_DEDUCTION[family], family).toBeGreaterThanOrEqual(0);
      expect(FAMILY_DEDUCTION[family], family).toBeLessThanOrEqual(100);
    }
  });
});

describe('combination is diminishing, never additive', () => {
  it('the worst finding dominates and later ones deepen it', () => {
    expect(combineDeductions([30])).toBe(30);
    expect(combineDeductions([30, 30])).toBe(45);
    expect(combineDeductions([30, 30, 30])).toBe(52.5);
  });

  it('order does not matter — it sorts worst-first itself', () => {
    expect(combineDeductions([6, 35, 20])).toBeCloseTo(combineDeductions([35, 20, 6]), 10);
  });

  it('many routine controls never rank with one severe hazard', () => {
    const routine = scoreSiteConstraints(
      (['height', 'minimumLotSize', 'floorSpaceRatio', 'parking', 'design'] as const)
        .map((k) => f(k, 'control')),
    )!.answer;
    const severe = scoreSiteConstraints([f('flood', 'hazard')])!.answer;
    expect(routine).toBeGreaterThan(severe);
  });

  it('stays inside 0-100 on the worst set the vocabulary allows', () => {
    const everything = (Object.keys(FAMILY_DEDUCTION) as ConstraintFamily[])
      .map((family) => f(family, 'hazard'));
    const r = scoreSiteConstraints(everything)!;
    expect(r.answer).toBeGreaterThanOrEqual(0);
    expect(r.answer).toBeLessThanOrEqual(100);
  });
});

describe('it is reproducible and it names its basis', () => {
  it('identical findings give identical results', () => {
    const findings = [f('bushfire', 'hazard'), f('heritage', 'protection')];
    expect(JSON.stringify(scoreSiteConstraints(findings)))
      .toBe(JSON.stringify(scoreSiteConstraints(findings)));
  });

  it('carries the version a stored assessment would name', () => {
    expect(scoreSiteConstraints([f('flood', 'hazard')])!.version)
      .toBe(SITE_CONSTRAINT_SEVERITY_VERSION);
    expect(SITE_CONSTRAINT_SEVERITY_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('says the score describes what was returned, not what was not', () => {
    const r = scoreSiteConstraints([f('flood', 'hazard')])!;
    expect(r.basis).toContain('not a');
    expect(r.basis).toMatch(/what the registers returned/i);
  });
});

describe('it is not wired', () => {
  it('nothing in the shipped pipeline imports it yet', async () => {
    const { CONVERSIONS } = await import(
      '../../../../supabase/functions/_shared/reports/risk/riskEvidenceConnection.pure'
    );
    expect(Object.keys(CONVERSIONS)).toHaveLength(0);
  });
});

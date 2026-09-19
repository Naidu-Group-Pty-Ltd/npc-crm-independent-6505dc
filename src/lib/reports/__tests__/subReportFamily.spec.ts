/**
 * Pins the Compass family rules: one engine per variant name, the family
 * resolved across BOTH historical linkage columns, and staleness derived —
 * a child is stale exactly when its parent moved after the child was
 * generated, and an unverifiable comparison never cries wolf.
 */
import { describe, expect, it } from 'vitest';

import {
  ENGINE_FOR_VARIANT,
  SUB_REPORT_VARIANTS,
  childStaleness,
  engineForVariant,
  familyParentId,
  isBaseReport,
  normaliseFamilyVariant,
  shapeFamily,
} from '../../../../supabase/functions/_shared/reports/investment/subReportFamily.pure';

describe('one engine per variant name (F9)', () => {
  it('financial and strategic are deterministic forks; briefing and snapshot are condensations', () => {
    expect(engineForVariant('financial')).toBe('fork-investment-report');
    expect(engineForVariant('strategic')).toBe('fork-investment-report');
    expect(engineForVariant('briefing')).toBe('condense-investment-report');
    expect(engineForVariant('snapshot')).toBe('condense-investment-report');
  });

  it('answers null for anything else — no engine is a guess', () => {
    expect(engineForVariant('compass')).toBeNull();
    expect(engineForVariant('')).toBeNull();
    expect(engineForVariant(undefined)).toBeNull();
  });

  it('the mapping covers exactly the sub-report variants', () => {
    expect(Object.keys(ENGINE_FOR_VARIANT).sort()).toEqual([...SUB_REPORT_VARIANTS].sort());
  });
});

describe('family linkage across both historical columns', () => {
  it('reads whichever column history wrote', () => {
    expect(familyParentId({ derived_from_report_id: 'p1' })).toBe('p1');
    expect(familyParentId({ parent_report_id: 'p1' })).toBe('p1');
    expect(familyParentId({ derived_from_report_id: 'p1', parent_report_id: 'p2' })).toBe('p1');
    expect(familyParentId({})).toBeNull();
  });

  it('recognises the base by variant, aliases included', () => {
    expect(isBaseReport({ report_variant: 'compass' })).toBe(true);
    expect(isBaseReport({ report_variant: 'composite' })).toBe(true);
    expect(isBaseReport({ report_tier: 'compass' })).toBe(true);
    expect(isBaseReport({ report_variant: 'financial' })).toBe(false);
    expect(normaliseFamilyVariant('Due Diligence')).toBe('strategic');
  });
});

describe('staleness (F10)', () => {
  const parent = { updated_at: '2026-09-02T10:00:00Z' };

  it('a child generated before the parent last moved is stale', () => {
    const s = childStaleness(parent, { variant_generated_at: '2026-09-01T10:00:00Z' });
    expect(s.stale).toBe(true);
    expect(s.parentChangedAt).toBe('2026-09-02T10:00:00Z');
  });

  it('a child generated after is fresh; equal stamps are fresh', () => {
    expect(childStaleness(parent, { variant_generated_at: '2026-09-02T11:00:00Z' }).stale).toBe(false);
    expect(childStaleness(parent, { variant_generated_at: '2026-09-02T10:00:00Z' }).stale).toBe(false);
  });

  it('falls back through updated_at then created_at for historic children', () => {
    expect(childStaleness(parent, { updated_at: '2026-09-01T00:00:00Z' }).stale).toBe(true);
    expect(childStaleness(parent, { created_at: '2026-09-03T00:00:00Z' }).stale).toBe(false);
  });

  it('an unverifiable comparison never cries wolf', () => {
    expect(childStaleness(null, { variant_generated_at: '2026-09-01T00:00:00Z' }).stale).toBe(false);
    expect(childStaleness(parent, {}).stale).toBe(false);
    expect(childStaleness({ updated_at: 'not a date' }, { variant_generated_at: '2026-09-01T00:00:00Z' }).stale).toBe(false);
  });
});

describe('shapeFamily', () => {
  const parent = { id: 'p', report_variant: 'compass', updated_at: '2026-09-02T10:00:00Z' };
  const fin = { id: 'f', report_variant: 'financial', status: 'completed', derived_from_report_id: 'p', variant_generated_at: '2026-09-01T00:00:00Z' };
  const brief = { id: 'b', report_variant: 'briefing', status: 'completed', parent_report_id: 'p', updated_at: '2026-09-03T00:00:00Z' };
  const stranger = { id: 'x', report_variant: 'snapshot', status: 'completed', parent_report_id: 'other' };

  it('resolves the same family from the parent or from a child, across both columns', () => {
    for (const anchor of ['p', 'f', 'b']) {
      const family = shapeFamily(anchor, [parent, fin, brief, stranger, fin]);
      expect(family.parentId).toBe('p');
      expect(family.children.map((c) => c.id)).toEqual(['f', 'b']);
    }
  });

  it('derives staleness per child and lists the stale ones', () => {
    const family = shapeFamily('p', [parent, fin, brief]);
    expect(family.children.find((c) => c.id === 'f')?.stale).toBe(true);
    expect(family.children.find((c) => c.id === 'b')?.stale).toBe(false);
    expect(family.staleChildren.map((c) => c.id)).toEqual(['f']);
  });

  it('a stale but incomplete child is not offered for refresh', () => {
    const pending = { ...fin, id: 'f2', status: 'processing' };
    const family = shapeFamily('p', [parent, pending]);
    expect(family.children.find((c) => c.id === 'f2')?.stale).toBe(true);
    expect(family.staleChildren).toHaveLength(0);
  });

  it('an orphan anchor is its own family of none', () => {
    const orphan = { id: 'o', report_variant: 'financial', status: 'completed' };
    const family = shapeFamily('o', [orphan]);
    expect(family.parentId).toBeNull();
    expect(family.children).toHaveLength(0);
    expect(family.staleChildren).toHaveLength(0);
  });
});

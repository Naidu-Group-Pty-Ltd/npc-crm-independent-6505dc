/**
 * The Briefing and Snapshot of a Compass can be produced more than once.
 *
 * 37 Bolin Street, 27 Sep 2026: every Briefing and Snapshot request after the
 * first answered 404 "Parent Compass report not found" two hundred
 * milliseconds after logging "Parent report found". The condense engine
 * created children with no owner, and its regeneration path then refused the
 * caller access to the very child it had written.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  CHILD_OWNED_ELSEWHERE,
  mayRegenerateChild,
  ownerForNewChild,
  ownerForRegeneratedChild,
} from '../../../../supabase/functions/_shared/reports/subReportOwnership.pure';

const parent = { generated_by: 'adviser-a' };

describe('who owns a sub-report', () => {
  it('a new child takes the parent\'s owner, as the fork always has', () => {
    expect(ownerForNewChild(parent, 'adviser-b')).toBe('adviser-a');
    expect(ownerForNewChild({ generated_by: null }, 'adviser-b')).toBe('adviser-b');
    expect(ownerForNewChild({ generated_by: null }, 'service_role')).toBeNull();
  });

  it('the child the defect wrote — no owner — may be regenerated, and is healed', () => {
    expect(mayRegenerateChild({ generated_by: null }, parent, 'adviser-a', false)).toBe(true);
    expect(ownerForRegeneratedChild({ generated_by: null }, parent, 'adviser-a')).toBe('adviser-a');
  });

  it('the parent\'s own child, or the caller\'s, may be regenerated', () => {
    expect(mayRegenerateChild({ generated_by: 'adviser-a' }, parent, 'adviser-b', false)).toBe(true);
    expect(mayRegenerateChild({ generated_by: 'adviser-b' }, parent, 'adviser-b', false)).toBe(true);
  });

  it('another adviser\'s child is never overwritten, and the refusal says so', () => {
    expect(mayRegenerateChild({ generated_by: 'adviser-c' }, parent, 'adviser-b', false)).toBe(false);
    expect(mayRegenerateChild({ generated_by: 'adviser-c' }, parent, 'adviser-b', true)).toBe(true);
    expect(CHILD_OWNED_ELSEWHERE).not.toMatch(/not found/i);
  });
});

describe('the condense engine applies the rule', () => {
  const source = readFileSync('supabase/functions/condense-investment-report/index.ts', 'utf8');

  it('stamps the owner on create and heals it on regenerate', () => {
    expect(source).toContain('generated_by: ownerForNewChild(parentReport, userId)');
    expect(source).toContain('generated_by: ownerForRegeneratedChild(existingTier, parentReport, userId!)');
  });

  it('never answers "parent not found" about a child', () => {
    const block = source.slice(source.indexOf('if (existingTier && !mayRegenerateChild('), source.indexOf('let condensedReport'));
    expect(block).toContain('CHILD_OWNED_ELSEWHERE');
    expect(block).toContain('status: 403');
    expect(block).not.toContain('Parent Compass report not found');
  });
});

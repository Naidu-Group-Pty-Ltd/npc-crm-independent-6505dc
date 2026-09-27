/**
 * The report-type buttons open documents; only a missing one is created.
 *
 * 37 Bolin Street, 27 Sep 2026: every click on Financial or Strategic re-forked
 * the report (four forks in four minutes), and every click on Briefing or
 * Snapshot asked for a model run that then failed. A button that names a
 * document opens it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { currentChildOf, familyPreparation, variantAction } from '../variantNavigation.pure';
import type { ReportFamily } from '../investment/subReportFamily.pure';

const child = (id: string, variant: 'financial' | 'strategic' | 'briefing' | 'snapshot', at: string, stale = false) => ({
  id, variant, status: 'completed', row: { id, variant_generated_at: at }, stale, parentChangedAt: null, childGeneratedAt: at,
});

const family: ReportFamily = {
  parentId: 'compass-1',
  parent: { id: 'compass-1' },
  children: [
    child('fin-1', 'financial', '2026-09-27T14:35:21Z'),
    child('strat-1', 'strategic', '2026-09-27T14:39:00Z'),
    child('brief-old', 'briefing', '2026-09-20T10:00:00Z', true),
    child('brief-new', 'briefing', '2026-09-27T14:40:00Z'),
  ],
  staleChildren: [],
};

describe('what a report button does', () => {
  it('opens an existing report rather than producing it again', () => {
    expect(variantAction(family, 'compass-1', 'financial')).toMatchObject({ kind: 'open', reportId: 'fin-1' });
    expect(variantAction(family, 'fin-1', 'strategic')).toMatchObject({ kind: 'open', reportId: 'strat-1' });
  });

  it('opens the NEWEST of a variant, the one the engines regenerate in place', () => {
    expect(currentChildOf(family, 'briefing')?.id).toBe('brief-new');
    expect(variantAction(family, 'compass-1', 'briefing')).toMatchObject({ kind: 'open', reportId: 'brief-new' });
    // Viewing the older duplicate, the button takes the reader to the current one.
    expect(variantAction(family, 'brief-old', 'briefing')).toMatchObject({ kind: 'open', reportId: 'brief-new' });
  });

  it('marks the report on screen, and returns to the Compass from any child', () => {
    expect(variantAction(family, 'strat-1', 'strategic')).toEqual({ kind: 'here' });
    expect(variantAction(family, 'compass-1', 'compass')).toEqual({ kind: 'here' });
    expect(variantAction(family, 'strat-1', 'compass')).toMatchObject({ kind: 'open', reportId: 'compass-1' });
  });

  it('offers to create only what this Compass does not have', () => {
    expect(variantAction(family, 'compass-1', 'snapshot')).toEqual({ kind: 'generate' });
  });

  it('says nothing either way when the family could not be read', () => {
    expect(variantAction(null, 'compass-1', 'financial')).toEqual({ kind: 'unknown' });
    expect(variantAction({ ...family, parentId: null }, 'x', 'briefing')).toEqual({ kind: 'unknown' });
  });

  it('the header control decides through the rule and produces only on generate', () => {
    const source = readFileSync('src/components/reports/ReportVariantControls.tsx', 'utf8');
    expect(source).toContain('variantAction(');
    // generateSubReport is reached from the create path alone.
    expect(source.match(/generateSubReport\(/g)?.length).toBe(1);
    expect(source).toMatch(/action\.kind === 'generate'[\s\S]{0,80}await create\(/);
  });
});

describe('one click prepares the whole family', () => {
  const child = (id: string, variant: string, stale = false) =>
    ({ id, variant, stale, status: 'completed', row: { variant_generated_at: '2026-09-27T14:35:00Z' } }) as never;

  it('lists what is missing and what is out of date, in the order the buttons are drawn', () => {
    const plan = familyPreparation({
      parentId: 'compass', children: [child('fin', 'financial', true), child('dd', 'strategic')], staleChildren: [],
    } as never);
    expect(plan.missing).toEqual(['briefing', 'snapshot']);
    expect(plan.stale).toEqual(['financial']);
    expect(plan.all).toEqual(['financial', 'briefing', 'snapshot']);
    expect(plan.modelRuns).toBe(2);
  });

  it('offers nothing for a complete, current family or an unread one', () => {
    const complete = familyPreparation({
      parentId: 'compass',
      children: ['financial', 'strategic', 'briefing', 'snapshot'].map((v) => child(v, v)),
      staleChildren: [],
    } as never);
    expect(complete.all).toEqual([]);
    expect(familyPreparation(null).all).toEqual([]);
  });
});

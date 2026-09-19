/**
 * The spine — the document's structure, checkable before it is drawn.
 *
 * What this catches is the failure nothing else can see: a section that
 * silently did not build. A PDF that is missing its constraints table is a
 * valid PDF, renders without an error and looks fine until somebody counts.
 */

import { describe, expect, it } from 'vitest';
import { REPORT_ARCHETYPES, spinePageBudget } from '../../../../../supabase/functions/_shared/reportDesign/structure.pure';
import { capacitySections, capacitySpine, validateCapacitySpine } from '../sections.pure';
import { buildCapacitySnapshot } from '../normalise.pure';
import type { CommercialCapacitySnapshot } from '../payload.pure';
import { SAMPLE_ANALYSIS, sampleAssessmentRow, sampleRunRow } from './fixtures/sampleRun';

function full(): CommercialCapacitySnapshot {
  const run = sampleRunRow();
  return buildCapacitySnapshot({
    assessment: sampleAssessmentRow(),
    outputs: run.outputs,
    inputs: run.inputs_snapshot,
    clientName: 'Asteron Industrial Holdings Pty Ltd',
    analysis: SAMPLE_ANALYSIS,
  });
}

function minimal(): CommercialCapacitySnapshot {
  return buildCapacitySnapshot({ assessment: sampleAssessmentRow(), outputs: {}, inputs: {} });
}

describe('capacitySections', () => {
  it('always carries the four sections that are the report', () => {
    // What was concluded, what the transaction is, what services it, what bound
    // it. A document without any one of those is not this document.
    expect(minimal().propertyIncome).toBeNull();
    expect(capacitySections(minimal()).map((s) => s.id))
      .toEqual(['capacity', 'transaction', 'income', 'constraints', 'compliance']);
  });

  it('adds each conditional section only when its data exists', () => {
    expect(capacitySections(full()).map((s) => s.id)).toEqual([
      'capacity', 'transaction', 'income', 'constraints',
      'portfolio', 'analysis', 'compliance', 'method',
    ]);
  });

  it('puts the appendix last', () => {
    const ids = capacitySections(full()).map((s) => s.id);
    // A reader who wants the calculation trail knows to look for it; a reader
    // who does not should not walk through thirty rows to reach compliance.
    expect(ids[ids.length - 1]).toBe('method');
    expect(ids.indexOf('compliance')).toBeLessThan(ids.indexOf('method'));
  });

  it('gives every section a title, a note and a positive budget', () => {
    for (const section of capacitySections(full())) {
      expect(section.title.length, section.id).toBeGreaterThan(0);
      expect(section.note?.length ?? 0, section.id).toBeGreaterThan(0);
      expect(section.pageBudget, section.id).toBeGreaterThan(0);
    }
  });
});

describe('capacitySpine', () => {
  it('opens with a cover and a contents page and closes with the company page', () => {
    const spine = capacitySpine(full());
    expect(spine[0].slot).toBe('cover');
    expect(spine[1].slot).toBe('contents');
    expect(spine[spine.length - 1].slot).toBe('closing');
  });

  it('claims a page count inside the archetype\'s band, at both extremes', () => {
    const [floor, ceiling] = REPORT_ARCHETYPES['commercial-capacity'].pageBudget;

    // The band exists to catch a document that collapsed and one that ran away.
    // Both ends have to be reachable, or it catches neither.
    expect(spinePageBudget(capacitySpine(minimal()))).toBeGreaterThanOrEqual(floor);
    expect(spinePageBudget(capacitySpine(full()))).toBeLessThanOrEqual(ceiling);
  });

  it('validates clean for both the minimal and the full document', () => {
    expect(validateCapacitySpine(minimal())).toEqual([]);
    expect(validateCapacitySpine(full())).toEqual([]);
  });
});

describe('the archetype', () => {
  it('is registered, and is its own format rather than a borrowing-capacity alias', () => {
    const archetype = REPORT_ARCHETYPES['commercial-capacity'];
    expect(archetype.id).toBe('commercial-capacity');
    expect(archetype.documentName).toContain('Commercial');
    // A contents page is the visible difference: this is a credit pack a reader
    // arrives at wanting one section, not one argument told in order.
    expect(archetype.contents).toBe(true);
    expect(archetype.slots).toContain('contents');
  });

  it('did not disturb the Snapshot\'s archetype', () => {
    // Adding a format must not move an existing one's page band; every one of
    // them is a claim measured against real renders.
    expect(REPORT_ARCHETYPES['borrowing-capacity'].pageBudget).toEqual([4, 12]);
    expect(REPORT_ARCHETYPES['borrowing-capacity'].contents).toBe(false);
  });
});

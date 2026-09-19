/**
 * Structure, checked before anything is drawn.
 *
 * The shipping generator draws nineteen steps in a row, each deciding for
 * itself whether to add a page, so the only way to learn that a document lost
 * its audit trail is to open the PDF and count. A spine can be asserted on.
 */
import { describe, expect, it } from 'vitest';

import { REPORT_ARCHETYPES, spinePageBudget, validateSpine } from '@/lib/reportDesign/structure.pure';

import { buildSnapshot } from '../normalise.pure';
import { snapshotSections, snapshotSpine, validateSnapshotSpine } from '../sections.pure';
import {
  SAMPLE_ASSESSMENT,
  SAMPLE_AUDIT_TRAIL,
  SAMPLE_CLIENT_NAME,
  SAMPLE_EXPLANATION,
  SAMPLE_SCENARIO_PRESETS,
} from './fixtures/sampleAssessment';

const full = buildSnapshot({
  clientName: SAMPLE_CLIENT_NAME,
  assessment: SAMPLE_ASSESSMENT,
  auditTrail: SAMPLE_AUDIT_TRAIL,
  explanation: SAMPLE_EXPLANATION,
  scenarioPresets: SAMPLE_SCENARIO_PRESETS,
});
const minimal = buildSnapshot({ clientName: 'Nobody', assessment: {} });

describe('sections', () => {
  it('always carries the three that are the report', () => {
    expect(snapshotSections(minimal).map((s) => s.id)).toEqual(['capacity', 'income', 'ledger']);
  });

  it('adds the conditional three when their data exists', () => {
    expect(snapshotSections(full).map((s) => s.id)).toEqual([
      'capacity', 'income', 'ledger', 'explanation', 'audit', 'scenarios',
    ]);
  });

  it('gives every section a title, a note and a positive budget', () => {
    for (const s of snapshotSections(full)) {
      expect(s.title.trim().length, s.id).toBeGreaterThan(0);
      expect(s.note?.trim().length, s.id).toBeGreaterThan(0);
      expect(s.pageBudget, s.id).toBeGreaterThan(0);
    }
  });

  it('uses each id once', () => {
    const ids = snapshotSections(full).map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('spine', () => {
  it('opens with a cover and closes with the disclaimer', () => {
    const spine = snapshotSpine(full);
    expect(spine[0].slot).toBe('cover');
    expect(spine[spine.length - 1].slot).toBe('closing');
  });

  it('carries no contents page — a table of contents for six sections is padding', () => {
    expect(snapshotSpine(full).some((e) => e.slot === 'contents')).toBe(false);
  });

  it.each([['a full assessment', full], ['an empty one', minimal]])(
    'is valid for %s',
    (_label, payload) => {
      expect(validateSnapshotSpine(payload)).toEqual([]);
    },
  );

  /**
   * The archetype's band is [4, 12]. Both ends matter: below it the document is
   * missing something, above it the format has outgrown its archetype and that
   * is a decision, not a drift.
   */
  it.each([['a full assessment', full], ['an empty one', minimal]])(
    'stays inside the archetype page band for %s',
    (_label, payload) => {
      const [min, max] = REPORT_ARCHETYPES['borrowing-capacity'].pageBudget;
      const total = spinePageBudget(snapshotSpine(payload));
      expect(total).toBeGreaterThanOrEqual(min);
      expect(total).toBeLessThanOrEqual(max);
    },
  );

  /**
   * The budgets are not decoration: a real render of the full fixture through
   * WeasyPrint is eleven pages, and the spine claims eleven. The golden diff
   * pins the actual count; this pins the claim, so the two can disagree
   * loudly rather than silently.
   */
  it('claims the eleven pages the full fixture actually renders', () => {
    expect(spinePageBudget(snapshotSpine(full))).toBe(11);
  });

  it('reports a problem rather than throwing on a spine that breaks its archetype', () => {
    const problems = validateSpine('borrowing-capacity', [
      { slot: 'contents', id: 'x.contents', title: 'Contents', pageBudget: 1 },
      { slot: 'chapter', id: 'x.untitled', title: '  ', pageBudget: 0 },
    ]);
    expect(problems.join(' ')).toContain('not permitted');
    expect(problems.join(' ')).toContain('has no title');
    expect(problems.join(' ')).toContain('page budget must be positive');
  });
});

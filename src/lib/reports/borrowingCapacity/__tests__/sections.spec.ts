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
import { incomeSectionNote, snapshotSections, snapshotSpine, validateSnapshotSpine } from '../sections.pure';
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
      'capacity', 'income', 'ledger', 'audit', 'basis', 'scenarios',
    ]);
  });

  /**
   * §21. The engine's explanation restated the working step for step, in a
   * log's shorthand, with its DTI over the wrong income. It is still read into
   * the payload (the template catalogue binds it) and is no longer a section.
   */
  it('prints no section for the engine\'s explanation, though the payload carries one', () => {
    expect(full.explanation).not.toBeNull();
    expect(snapshotSections(full).map((s) => s.title)).not.toContain('How this was calculated');
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

/**
 * §21. One standfirst served every document, and a client with no income and
 * no liabilities read a promise of two tables over a callout and two figures.
 * Each half is said only where its table is drawn.
 */
describe('the income section\'s standfirst', () => {
  const noLiabilities = { ...full, expenses: { ...full.expenses, liabilities: [], capitalisedLmi: null } };
  const noLines = { ...full, income: { ...full.income, rows: [], proposedRent: null } };
  const noIncome = { ...full, income: { ...full.income, recorded: false } };

  it.each([
    ['income lines and liabilities', full,
      'Every income component with its shading, and every liability with its servicing.'],
    ['income lines and no liability', noLiabilities,
      'Every income component with its shading, and the expenses and commitments set against it.'],
    ['an income with no lines', noLines,
      'The income the assessment ran on, and every liability with its servicing.'],
    ['no income and liabilities', noIncome,
      'The living expenses the assessment applied, and every liability with its servicing.'],
    ['no income and no liability', { ...noIncome, expenses: noLiabilities.expenses },
      'The living expenses and commitments the assessment applied.'],
  ])('says what is drawn for %s', (_label, payload, note) => {
    expect(incomeSectionNote(payload)).toBe(note);
    expect(snapshotSections(payload).find((s) => s.id === 'income')?.note).toBe(note);
  });

  it('counts a capitalised premium as a liability, because the table lists it', () => {
    expect(full.expenses.capitalisedLmi).not.toBeNull();
    const premiumOnly = { ...full, expenses: { ...full.expenses, liabilities: [] } };
    expect(incomeSectionNote(premiumOnly)).toContain('every liability with its servicing');
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
   * The budgets are not decoration. Measured through WeasyPrint on 1 Oct 2026,
   * at the end of §21's audit:
   *  - with an advisor card on one of its scenarios, this fixture is nine
   *    pages in the standard design and in all fifty catalogue designs;
   *  - without one, as built here, it is eight in the standard design and in
   *    46 of the 50, and nine in the four `wm` designs, whose taller section
   *    headers hold the settings table over.
   * The spine claims nine, the fuller document. The sections run on under one
   * another since §16, so a budget is the share of a page run a section takes,
   * not a page count of its own. This pins the claim, so the claim and a
   * measurement can disagree loudly rather than silently.
   */
  it('claims the nine pages the fixture renders with an advisor card', () => {
    expect(spinePageBudget(snapshotSpine(full))).toBe(9);
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

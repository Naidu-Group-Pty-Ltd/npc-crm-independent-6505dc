/**
 * Which sections this document has, and how long it claims to be.
 *
 * Structure, decided before anything is drawn. The shipping generator has no
 * such thing: it draws 19 steps in a row, each one deciding for itself whether
 * to `doc.addPage()`, so the only way to find out that a document lost its
 * audit trail is to open the PDF and count (`BORROWING_CAPACITY.md` §2).
 *
 * A spine is checkable. `validateSpine` catches a section with no title, a
 * non-positive page budget, a slot the `borrowing-capacity` archetype does not
 * permit, and a total outside its [4, 12] band — all before the HTML exists.
 */

import type { ChapterInput, SpineEntry } from '../../reportDesign/structure.pure.ts';
import { buildSpine, validateSpine } from '../../reportDesign/structure.pure.ts';
import type { BorrowingCapacitySnapshot } from './payload.pure.ts';

export type SnapshotSectionId =
  | 'capacity'
  | 'income'
  | 'ledger'
  | 'audit'
  | 'scenarios'
  | 'basis';

export interface SnapshotSection extends ChapterInput {
  id: SnapshotSectionId;
}

/**
 * Every section, in printed order, with the condition that turns it on.
 *
 * The three unconditional ones are the report: what the client can borrow, what
 * that was calculated from, and how the arithmetic runs. The others exist only
 * when the data does.
 *
 * There is no "How this was calculated" any more (§21). It printed the
 * engine's own explanation, which restates the working of "How the capacity is
 * built" step for step in a log's shorthand — "1 commitment(s) at
 * $2,450/mo", "Surplus = $9,909 − $3,750 − $2,450 = $3,709/mo. At 9.50% over
 * 30yr → max loan", "RED band" — and states the debt-to-income ratio over gross
 * income where the stored ratio divides by the APS 220 income, so its own
 * arithmetic did not reach the ratio it printed. Every figure in it is in the
 * working, the ratio's note, the terms or the basis, in the report's words.
 * The explanation is still read into the payload, for the template catalogue.
 */
export function snapshotSections(payload: BorrowingCapacitySnapshot): SnapshotSection[] {
  const sections: SnapshotSection[] = [
    {
      id: 'capacity',
      title: 'Capacity at a glance',
      // Every budget below was set from a real render of the fixture that
      // exercises every section, not estimated. A budget nobody checked is a
      // number, not a claim.
      pageBudget: 2,
      note: 'What the assessment concluded, and on what terms.',
    },
    {
      id: 'income',
      title: 'Income and commitments',
      // One since the sections run on (§16): the income table, its note and
      // the liabilities share the page run with the answer before them.
      pageBudget: 1,
      note: incomeSectionNote(payload),
    },
    {
      id: 'ledger',
      title: 'How the capacity is built',
      // One: the working, the ratio's note and the advice. The headroom chart
      // moved to the answer it illustrates (§16).
      pageBudget: 1,
      note: 'The arithmetic from gross income to maximum capacity.',
    },
  ];

  if (payload.audit) {
    sections.push({
      id: 'audit',
      title: 'Audit trail',
      pageBudget: 1,
      note: 'Every value the lender adjusted, what it started as, and the rule that moved it.',
    });
  }

  // The settings come before the scenarios, beside the rest of the evidence,
  // and the document ends on what could change the answer — the order the
  // legacy Snapshot used. Measured over all 51 designs (1 Oct 2026): with the
  // scenarios first, the basis's table could not follow the audit trail onto
  // its page, and the page under the audit trail ran 37% empty on 40 of them;
  // this way the basis fills it, the worst page is 32% empty, and ten fewer
  // pages are printed (§21).
  if (payload.assumptions.length) {
    sections.push({
      id: 'basis',
      title: 'On what basis',
      pageBudget: 1,
      note: 'The lender policy and settings this assessment was run under.',
    });
  }

  if (payload.scenarios) {
    sections.push({
      id: 'scenarios',
      title: 'Scenario comparison',
      pageBudget: 1,
      note: 'What changes to income, commitments or rates would do to the result.',
    });
  }

  return sections;
}

/**
 * The income section's standfirst, composed from what the section draws.
 *
 * It was one sentence for every document, "Every income component with its
 * shading, and every liability with its servicing.", so a client with no
 * income and no liabilities on the record read a promise of two tables over a
 * callout and two figures (§21). Each half is said only where its table is
 * drawn. The income table has components only where there are lines, and it
 * is not drawn at all where no income is recorded (the callout says so). The
 * liabilities table needs a liability. The living expenses and commitments are
 * always on the page.
 */
export function incomeSectionNote(payload: BorrowingCapacitySnapshot): string {
  const incomeLines = payload.income.rows.length + (payload.income.proposedRent ? 1 : 0);
  const liabilities = payload.expenses.liabilities.length + (payload.expenses.capitalisedLmi ? 1 : 0) > 0;
  const income = !payload.income.recorded
    ? null
    : incomeLines
      ? 'Every income component with its shading'
      : 'The income the assessment ran on';
  if (income) {
    return `${income}, and ${liabilities ? 'every liability with its servicing' : 'the expenses and commitments set against it'}.`;
  }
  return liabilities
    ? 'The living expenses the assessment applied, and every liability with its servicing.'
    : 'The living expenses and commitments the assessment applied.';
}

/** Cover, the sections, closing. */
export function snapshotSpine(payload: BorrowingCapacitySnapshot): SpineEntry[] {
  return buildSpine({
    archetype: 'borrowing-capacity',
    chapters: snapshotSections(payload),
  });
}

/**
 * Structural problems with this document, before it is rendered.
 *
 * Empty for a valid one. The caller decides what to do — the render path throws,
 * the tests assert — but the check itself is here so both use the same one.
 */
export function validateSnapshotSpine(payload: BorrowingCapacitySnapshot): string[] {
  return validateSpine('borrowing-capacity', snapshotSpine(payload));
}

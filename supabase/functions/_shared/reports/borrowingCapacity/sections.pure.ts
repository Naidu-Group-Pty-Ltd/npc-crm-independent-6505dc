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
  | 'explanation'
  | 'audit'
  | 'scenarios';

export interface SnapshotSection extends ChapterInput {
  id: SnapshotSectionId;
}

/**
 * Every section, in printed order, with the condition that turns it on.
 *
 * The three unconditional ones are the report: what the client can borrow, what
 * that was calculated from, and how the arithmetic runs. The other three exist
 * only when the data does.
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
      // Two: the income table and its note fill the first, the liabilities
      // table opens the second.
      pageBudget: 2,
      note: 'Every income component with its shading, and every liability with its servicing.',
    },
    {
      id: 'ledger',
      title: 'How the capacity is built',
      // Two since the headroom chart joined it: the chart and the ledger fill
      // the first, the recommendations and warnings open the second.
      pageBudget: 2,
      note: 'The arithmetic from gross income to maximum capacity.',
    },
  ];

  if (payload.explanation) {
    sections.push({
      id: 'explanation',
      title: 'How this was calculated',
      pageBudget: 1,
      note: 'The assessment step by step, in plain terms.',
    });
  }

  if (payload.audit) {
    sections.push({
      id: 'audit',
      title: 'Audit trail',
      pageBudget: 1,
      note: 'Every value the lender adjusted, what it started as, and the rule that moved it.',
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

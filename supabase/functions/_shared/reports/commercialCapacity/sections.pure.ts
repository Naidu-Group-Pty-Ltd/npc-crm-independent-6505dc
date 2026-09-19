/**
 * Which sections this document has, and how long it claims to be.
 *
 * Structure decided before anything is drawn, so a document that lost its
 * constraints table fails here — with a message naming the problem — rather
 * than as a PDF somebody opens and counts.
 *
 * Five of the nine sections are conditional. That is not optionality for its
 * own sake: a lease-doc refinance has no business income, an owner-occupier has
 * no tenancy schedule, and a first commercial purchase has no portfolio. A
 * document that printed those headings over an empty table would be telling the
 * reader something false about the deal.
 */

import type { ChapterInput, SpineEntry } from '../../reportDesign/structure.pure.ts';
import { buildSpine, validateSpine } from '../../reportDesign/structure.pure.ts';
import type { CommercialCapacitySnapshot } from './payload.pure.ts';

export type CapacitySectionId =
  | 'capacity'
  | 'transaction'
  | 'income'
  | 'constraints'
  | 'portfolio'
  | 'analysis'
  | 'compliance'
  | 'method';

export interface CapacitySection extends ChapterInput {
  id: CapacitySectionId;
}

/**
 * Every section, in printed order, with the condition that turns it on.
 *
 * The order is the order a credit assessor reads a deal in: what was concluded,
 * what the transaction is, what services it, what bound it, what it does to the
 * borrower's existing position, what it means, and what has to happen next.
 * "How this was calculated" is last because it is the appendix — a reader who
 * wants it knows to look for it, and a reader who does not should not have to
 * walk through it to reach the compliance classification.
 */
export function capacitySections(payload: CommercialCapacitySnapshot): CapacitySection[] {
  const sections: CapacitySection[] = [
    {
      id: 'capacity',
      title: 'Capacity at a glance',
      // Two: the summary, the KPI strip and the utilisation chart fill the
      // first; the ratio table and the assessment terms open the second.
      pageBudget: 2,
      note: 'What the assessment concluded, on what terms, and against which tests.',
    },
    {
      id: 'transaction',
      title: 'The transaction',
      pageBudget: 1,
      note: 'Acquisition costs, total project cost and how it is funded.',
    },
    {
      id: 'income',
      title: 'Income and serviceability',
      // Two, and often three in practice — the tenancy schedule can be long.
      // The budget is the claim for a typical deal, not the worst case; a spine
      // budget that assumed the longest schedule would put every ordinary
      // document under its own claim.
      pageBudget: 2,
      note: 'What the property earns, what the business earns, and what is left after debt service.',
    },
    {
      id: 'constraints',
      title: 'What sets the capacity',
      pageBudget: 2,
      note: 'Every capacity test, what it permits, and which one binds.',
    },
  ];

  if (payload.portfolio) {
    sections.push({
      id: 'portfolio',
      title: 'Portfolio impact',
      pageBudget: 1,
      note: 'The borrower\'s position before and after the proposed transaction.',
    });
  }

  if (payload.analysis) {
    sections.push({
      id: 'analysis',
      title: 'Analysis',
      pageBudget: 2,
      note: 'An interpretation of the figures, the findings behind it, and what would move the result.',
    });
  }

  sections.push({
    id: 'compliance',
    title: 'Compliance and next steps',
    pageBudget: 1,
    note: 'Classification, risk indicators, outstanding information and recommended actions.',
  });

  if (payload.method) {
    sections.push({
      id: 'method',
      title: 'How this was calculated',
      // The explain trail runs to thirty-odd steps on a full assessment, each a
      // row. Two pages, and the table breaks across them rather than moving
      // whole — see the stylesheet rules `BORROWING_CAPACITY.md` §7 records.
      pageBudget: 2,
      note: 'Every step of the calculation, with the formula the engine applied.',
    });
  }

  return sections;
}

/** Cover, contents, the sections, closing. */
export function capacitySpine(payload: CommercialCapacitySnapshot): SpineEntry[] {
  return buildSpine({
    archetype: 'commercial-capacity',
    chapters: capacitySections(payload),
  });
}

/**
 * Structural problems with this document, before it is rendered.
 *
 * Empty for a valid one. The caller decides what to do about them — the render
 * path throws, the tests assert — but the check itself lives here so both use
 * the same one.
 */
export function validateCapacitySpine(payload: CommercialCapacitySnapshot): string[] {
  return validateSpine('commercial-capacity', capacitySpine(payload));
}

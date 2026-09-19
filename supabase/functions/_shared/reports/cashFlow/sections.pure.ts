/**
 * What the document contains, and in what order.
 *
 * The archetype already says what this format is: "a matrix document. The
 * projection table is the artefact; the narrative exists to frame it." That
 * sentence decides the running order below — the table gets its own landscape
 * page and everything else is either the setup for it or the reading of it.
 *
 * Sections appear only when they have something to say. A report on a property
 * with no itemised acquisition costs does not print an empty costs table, and a
 * spine that claimed it would is a spine that fails validation.
 */
import type { ReportArchetypeId, SpineEntry } from '../../reportDesign/structure.pure.ts';
import { buildSpine, validateSpine } from '../../reportDesign/structure.pure.ts';
import type { CashFlowProjection } from './payload.pure.ts';

export const ARCHETYPE_ID: ReportArchetypeId = 'cash-flow-projection';

export interface CashFlowSection {
  id: string;
  title: string;
  /** One line under the chapter number. */
  note: string;
  pageBudget: number;
  /** Opens the landscape page. Only the matrix does. */
  wide?: boolean;
}

/**
 * The sections this projection has content for.
 *
 * `position` and `projection` are unconditional — a cash flow report without a
 * purchase and without a table is not this document. The rest earn their place.
 */
export function cashFlowSections(p: CashFlowProjection): CashFlowSection[] {
  const sections: CashFlowSection[] = [
    {
      id: 'position',
      title: 'The purchase and the first year',
      note: 'What was bought, how it was funded, and what it does in year one.',
      pageBudget: 2,
    },
    {
      id: 'projection',
      title: `The ${p.meta.termYears}-year projection`,
      note: 'Every year, in full. These two tables are the report.',
      // Two landscape pages: the position, then the cash flow. One table of all
      // fourteen lines is one row taller than a landscape page holds.
      pageBudget: 2,
      wide: true,
    },
    {
      id: 'growth',
      title: 'Value, debt and equity',
      note: 'What the position looks like as the loan is paid and the value moves.',
      pageBudget: 2,
    },
  ];

  if (p.assumptions.length || p.notes.length) {
    sections.push({
      id: 'assumptions',
      title: 'What this assumes',
      note: 'A projection is only as good as what it takes for granted.',
      pageBudget: 1,
    });
  }

  return sections;
}

/** The spine, cover and closing page included. */
export function cashFlowSpine(p: CashFlowProjection): SpineEntry[] {
  return buildSpine({
    archetype: ARCHETYPE_ID,
    chapters: cashFlowSections(p).map((s) => ({
      id: s.id,
      title: s.title,
      pageBudget: s.pageBudget,
      note: s.note,
      wide: s.wide,
    })),
  });
}

/**
 * Every way this document violates its own archetype. Empty means valid.
 *
 * The years check is here rather than only in `normalise.pure.ts` because
 * `renderCashFlowDocument` is exported and can be reached with a payload that
 * never passed through the normaliser. A projection with no years still builds
 * a structurally valid spine — three sections, a cover and a closing page — and
 * would render as a document whose central table has no columns. That is worse
 * than an error: it looks finished.
 */
export function validateCashFlowSpine(p: CashFlowProjection): string[] {
  const problems = validateSpine(ARCHETYPE_ID, cashFlowSpine(p));
  if (!p.years.length) problems.push('the projection has no years to project');
  if (p.years.length !== p.meta.termYears) {
    problems.push(
      `the term says ${p.meta.termYears} years and the projection carries ${p.years.length}`,
    );
  }
  return problems;
}

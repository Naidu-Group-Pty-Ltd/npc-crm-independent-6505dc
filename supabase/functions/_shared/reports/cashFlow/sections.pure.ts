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
  /** Set to fit ONE portrait page — its opener is shallower and its blocks are held whole. */
  onePage?: boolean;
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
      note: 'What was bought, what it rests on, what it costs, and what it does in year one.',
      // The Input Summary and the two expenditure tables are a page of their
      // own before year one's lines.
      pageBudget: (p.inputs?.length ?? 0) > 0 || p.expenditure ? 3 : 2,
    },
  ];

  // A new build's staged contract, before the projection it finances. Only
  // where the record states a build contract and the adviser left the
  // schedule in the export — an established property has no build to stage.
  if (p.construction && p.showConstructionSchedule) {
    sections.push({
      id: 'construction',
      title: p.plannedBuild ? 'The build planned on this land' : 'The construction schedule',
      note: p.plannedBuild
        ? `How the build planned on this land is drawn over ${p.construction.durationMonths} months, and what the interest comes to while it is built.`
        : `How the build contract is drawn over ${p.construction.durationMonths} months, and what the interest comes to while it is built.`,
      pageBudget: 1,
      wide: true,
    });
  }

  sections.push(
    {
      id: 'projection',
      title: `The ${p.meta.termYears}-year projection`,
      note: 'Every year, in full, on one page.',
      // ONE landscape page. The table used to be split in two because fourteen
      // lines at the standard row height were one row more than a landscape
      // page holds; the owner's rule is that the projection is read on one
      // page, so the matrix is set at a compact row height instead.
      pageBudget: 1,
      wide: true,
    },
    {
      id: 'growth',
      title: 'Value, debt and equity',
      note: 'What the position looks like as the loan is paid and the value moves.',
      // One page: both charts on one year axis, with the figures they explain.
      pageBudget: 1,
      onePage: true,
    },
  );

  if (p.assumptions.length || p.notes.length) {
    sections.push({
      id: 'assumptions',
      title: 'What this assumes',
      note: 'A projection is only as good as what it takes for granted.',
      // One page, opened as "Value, debt and equity" is. At the full opener
      // the page held the table, three notes and the caution with a line or
      // two to spare, so a fourth note (depreciation excluded) or a longer
      // one sent the caution alone onto a page of its own (Audit 7, §12).
      pageBudget: 1,
      onePage: true,
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

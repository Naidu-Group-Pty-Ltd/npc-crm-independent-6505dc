/**
 * What the document contains, and in what order.
 *
 * ## The verdict goes first
 *
 * The producer writes its recommendation last (`compare-cash-flow-reports`
 * schema, `:199`) and the legacy generators print it near the end. Someone who
 * put five properties side by side does not need walking to the answer — the
 * same inversion the Portfolio and the Property Comparison already took.
 *
 * ## The tables are the document
 *
 * Sections 1–5 and 10 are arithmetic and always present. Sections 6–9 exist only
 * when the adviser pressed "Generate AI Analysis", and each of the four is
 * **independently** conditional rather than gated as a block.
 *
 * That is not defensive coding. `compare-cash-flow-reports:219` asks for eight
 * sections with `maxTokens: 4000`, and a response that closes its braces early
 * still parses — so a partial analysis is a normal arrival, not an error, and
 * `overallRecommendation` is simultaneously the last thing written and the first
 * thing an adviser looks for. Gating all four together would drop three present
 * sections because a fourth ran out of budget.
 *
 * A comparison with no analysis at all is a complete, sendable document. That is
 * the whole point of the migration: today `exportAiAnalysisPDF` returns without
 * drawing anything when `aiAnalysis` is null (`CashFlowAnalysisModal.tsx:1947`),
 * so there is no way to hand a client the ten years they just watched an adviser
 * edit.
 */
import type { ReportArchetypeId, SpineEntry } from '../../reportDesign/structure.pure.ts';
import { buildSpine, validateSpine } from '../../reportDesign/structure.pure.ts';
import type { CashFlowComparison } from './payload.pure.ts';
import { MAX_COMPARED_PROPERTIES, MIN_COMPARED_PROPERTIES } from './payload.pure.ts';

export const ARCHETYPE_ID: ReportArchetypeId = 'cash-flow-comparison';

export interface ComparisonSection {
  id: string;
  title: string;
  /** One line under the section number, and on the contents page. */
  note: string;
  pageBudget: number;
  /** Opens a landscape page. Only the two matrices do. */
  wide?: boolean;
}

/** True when the model wrote at least one of the four discursive blocks. */
export function hasDiscursiveAnalysis(p: CashFlowComparison): boolean {
  const a = p.analysis;
  return Boolean(a && (a.summary || a.trajectory || a.capitalGrowth || a.yields));
}

/** True when at least one ranking carries something worth a paragraph. */
export function hasRankingDetail(p: CashFlowComparison): boolean {
  return Boolean(p.analysis?.rankings.some(
    (r) => r.verdict || r.strengths.length || r.weaknesses.length,
  ));
}

/**
 * Above this many properties, the tables that put properties in columns spill
 * onto a second page.
 *
 * Measured, not guessed: rendering two-property and five-property comparisons
 * through WeasyPrint puts the verdict, the measures and the basis at two pages
 * each at two properties and three each at five. The boundary is not exact —
 * it depends on how long the addresses are — but a budget is an expectation
 * checked against a band, not a page prediction.
 */
const CROWDED_FROM = 4;

/**
 * A wide section costs its chapter-header page plus its matrices.
 *
 * The first render declared one page for each and produced three, because
 * `renderBandedMatrix` emits its own landscape page and the chapter header
 * needs a portrait one before it. Both wide sections carry two matrices — see
 * `measureMatrix` in `render.pure.ts` for why they are split rather than
 * interleaved — so both are always three pages, at every property count.
 */
const WIDE_SECTION_PAGES = 3;

/** The sections this comparison has content for. */
export function comparisonSections(p: CashFlowComparison): ComparisonSection[] {
  const crowded = p.properties.length >= CROWDED_FROM ? 1 : 0;
  const sections: ComparisonSection[] = [
    {
      id: 'verdict',
      title: 'Which property comes out ahead',
      note: 'The ranking, how far apart they are, and what each one leads on.',
      pageBudget: 2 + crowded,
    },
    {
      id: 'entry',
      title: 'What each costs to get into',
      note: 'Purchase, deposit, loan and the costs of acquiring each property.',
      pageBudget: 2,
    },
    {
      id: 'cash-flow-matrix',
      title: `${p.meta.termYears} years of cash flow`,
      note: 'What each property costs or returns, year by year, and cumulatively.',
      pageBudget: WIDE_SECTION_PAGES,
      wide: true,
    },
    {
      id: 'position-matrix',
      title: `${p.meta.termYears} years of value and equity`,
      note: 'What each property is worth and what is owned of it, year by year.',
      pageBudget: WIDE_SECTION_PAGES,
      wide: true,
    },
    {
      id: 'measures',
      title: 'The measures side by side',
      note: 'Return, yield and how long each takes to repay what it cost to buy.',
      pageBudget: 2 + crowded,
    },
  ];

  if (hasDiscursiveAnalysis(p)) {
    sections.push({
      id: 'analysis',
      title: 'What the analysis found',
      note: 'The written comparison, against the figures in the tables above.',
      pageBudget: 2,
    });
  }

  if (hasRankingDetail(p)) {
    sections.push({
      id: 'each-property',
      title: 'Each property in turn',
      note: 'What the analysis said in favour of, and against, each one.',
      // Budgeted on the **ranking** count rather than the property count, which
      // is not the same number. A model can return more rankings than there are
      // properties — this section then prints the extras with a note saying they
      // matched nothing, and those notes are what makes it longer. Measured at
      // roughly two rankings to a page.
      pageBudget: Math.max(1, Math.ceil((p.analysis?.rankings.length ?? 0) / 2)),
    });
  }

  if (p.analysis?.investorMatches.length) {
    sections.push({
      id: 'suits',
      title: 'Who each property suits',
      note: 'The four investor profiles, and what the analysis matched to each.',
      pageBudget: 1,
    });
  }

  if (p.analysis?.risk || p.analysis?.recommendation) {
    sections.push({
      id: 'risk',
      title: 'Risk, and what to avoid',
      // Deliberately not section 1. Naming a property to avoid on the same page
      // as the ranking, in a document an adviser may hand to a client who is
      // considering that property, is a different act from ranking it last.
      note: 'Stability, the risks named, and the recommendation.',
      pageBudget: 2,
    });
  }

  sections.push({
    id: 'basis',
    title: 'On what basis',
    note: 'The assumptions behind every figure above, per property.',
    // One assumptions table per property, so this is the other section that
    // grows with the count.
    pageBudget: 2 + crowded,
  });

  return sections;
}

/** The spine, cover and closing page included. */
export function comparisonSpine(p: CashFlowComparison): SpineEntry[] {
  return buildSpine({
    archetype: ARCHETYPE_ID,
    chapters: comparisonSections(p).map((s) => ({
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
 * The property checks are here as well as in `normalise.pure.ts` because
 * `renderComparisonDocument` is exported and can be reached with a payload that
 * never passed through the normaliser. A one-property "comparison" builds a
 * structurally valid spine and would render as a document whose central tables
 * have a single column — worse than an error, because it looks finished.
 */
export function validateComparisonSpine(p: CashFlowComparison): string[] {
  const problems = validateSpine(ARCHETYPE_ID, comparisonSpine(p));

  if (p.properties.length < MIN_COMPARED_PROPERTIES) {
    problems.push(
      `a comparison needs at least ${MIN_COMPARED_PROPERTIES} properties, got ${p.properties.length}`,
    );
  }
  if (p.properties.length > MAX_COMPARED_PROPERTIES) {
    problems.push(
      `a comparison accepts at most ${MAX_COMPARED_PROPERTIES} properties, got ${p.properties.length}`,
    );
  }
  if (!p.meta.termYears) {
    problems.push('the comparison has no years to compare');
  }
  const ragged = p.properties.find((x) => x.projection.years.length !== p.meta.termYears);
  if (ragged) {
    problems.push(
      `${ragged.address} projects ${ragged.projection.years.length} years against a stated term of `
      + `${p.meta.termYears}`,
    );
  }
  return problems;
}

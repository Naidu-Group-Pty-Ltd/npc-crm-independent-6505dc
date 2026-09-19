/**
 * What the document contains, and in what order.
 *
 * ## Nine sections out of twenty
 *
 * The legacy generator draws twenty content blocks in one continuous flow.
 * Nine is not a trim of twenty; it is the observation that twenty blocks are
 * not twenty subjects. Five pairs are one subject drawn twice, or drawn in two
 * places because the drawing order forced it — the property table and the
 * property cashflow cards, financial health and risk, growth opportunities and
 * strategic recommendations and the twelve-month plan, market conditions and
 * projections, borrowing capacity utilisation and the borrowing capacity pack.
 *
 * ## Why the contents page is generated
 *
 * The legacy builds one by hand from a counter that starts at 3 and is
 * incremented as entries are pushed, six of them without incrementing at all.
 * Nothing reconciles it against the real page count, and nothing could: every
 * section paginates against its own measured content, so where a section lands
 * is not knowable until it is drawn. `contentsEntriesFor` derives the list from
 * this spine instead, and page numbers come from `@page` counters — so neither
 * can claim something that was not printed.
 *
 * ## The holdings budget is the only data-dependent one
 *
 * Both other formats hardcode every budget and are right to: a cash flow
 * projection is always ten years, a capacity assessment always one capacity. A
 * portfolio is between one and thirty-odd properties, so a fixed budget would
 * be wrong for most of them and the spine-versus-render assertion would either
 * fail constantly or be set so loose it asserted nothing.
 */
import type { ReportArchetypeId, SpineEntry } from '../../reportDesign/structure.pure.ts';
import { buildSpine, validateSpine } from '../../reportDesign/structure.pure.ts';
import type { PortfolioReview } from './payload.pure.ts';

export const ARCHETYPE_ID: ReportArchetypeId = 'portfolio-performance';

/**
 * Rows of the holdings matrix that fit on one landscape page.
 *
 * The matrix is transposed — one *column* per property, one row per line item —
 * so this bounds the columns, and the thirteen lines always fit the height.
 */
export const HOLDINGS_PER_PAGE = 18;

/**
 * Properties that get their own prose commentary in the performance section.
 *
 * Everything past this appears in the ranking table and in the holdings matrix;
 * only the paragraphs are capped, and `performanceSection` says so on the page
 * when the cap bites. A thirty-property portfolio would otherwise spend thirty
 * pages on per-property prose, which is a filing cabinet rather than a review.
 *
 * The largest portfolio in the record has four properties, so this has never
 * bitten in production. It exists because the format accepts up to
 * `MAX_HOLDINGS`, and an unbounded section is how a document becomes a runaway.
 */
export const DETAIL_CAP = 20;

/**
 * Every budget below was measured, not estimated: all 21 stored reports were
 * rendered through WeasyPrint and the section boundaries read off the running
 * heads. They land between 18 and 26 pages, and each budget here is what that
 * section actually occupied.
 *
 * They remain estimates. Section length is driven by how much prose a model
 * wrote, which no count in the payload predicts — two reports for the same
 * client, generated a week apart, differ by a page. The budgets exist so
 * `validateSpine` can catch a document that has collapsed or run away, not so
 * it can predict a page number, and nothing in this format prints one.
 */

export interface PortfolioSection {
  id: string;
  title: string;
  /** One line under the chapter number, and on the contents page. */
  note: string;
  pageBudget: number;
  /** Opens the landscape page. Only the holdings matrix does. */
  wide?: boolean;
}

/** The sections this payload has content for. */
export function portfolioSections(p: PortfolioReview): PortfolioSection[] {
  const sections: PortfolioSection[] = [
    {
      id: 'standing',
      title: 'Where the portfolio stands',
      note: 'What it is worth, what it owes, and what it does each month.',
      pageBudget: 2,
    },
  ];

  if (p.composition) {
    sections.push({
      id: 'composition',
      title: 'What the portfolio is made of',
      note: 'The mix by value, and whether it is concentrated.',
      pageBudget: 2,
    });
  }

  sections.push({
    id: 'holdings',
    title: 'Every property',
    note: 'The complete inventory — one row per property, every figure the record holds.',
    // One page of framing plus however many the matrix needs. The legacy's
    // equivalent silently drops rows past a hardcoded index; a budget derived
    // from the actual count is what makes that impossible here.
    pageBudget: 1 + Math.max(1, Math.ceil(p.holdings.length / HOLDINGS_PER_PAGE)),
    wide: true,
  });

  if (p.verdicts.length) {
    sections.push({
      id: 'performance',
      title: 'How each property is performing',
      note: 'Which properties carry the portfolio, which drag on it, and why.',
      // A page of chart and ranking table, then roughly a page of commentary
      // per property. Measured: one property took two pages, four took five.
      pageBudget: 1 + Math.min(p.verdicts.length, DETAIL_CAP),
    });
  }

  if (p.financialHealth || p.risk) {
    sections.push({
      id: 'health',
      title: 'Financial health and risk',
      note: 'The position under today’s rates, and what would move it.',
      pageBudget: 2,
    });
  }

  if (p.capacity) {
    sections.push({
      id: 'capacity',
      title: 'Borrowing capacity and headroom',
      note: 'How much of the assessed capacity is deployed, and what is left.',
      pageBudget: 1,
    });
  }

  if (p.market || p.projection) {
    sections.push({
      id: 'outlook',
      title: 'Market and projections',
      note: 'Where the market is, and where the portfolio goes if the assumptions hold.',
      pageBudget: 3,
    });
  }

  if (p.growth || p.actions.length) {
    sections.push({
      id: 'plan',
      title: 'What to do next',
      note: 'Priority actions first, then the longer horizons.',
      // Two pages of growth prose, then the action table — which runs to
      // twenty-odd rows on real reports and is the one part of this section
      // whose length the payload does predict.
      pageBudget: 2 + Math.ceil(Math.max(p.actions.length, 1) / 12),
    });
  }

  if (p.review) {
    sections.push({
      id: 'review',
      title: 'This review',
      note: 'When it was done, what it scored, and when the next one is due.',
      pageBudget: 2,
    });
  }

  return sections;
}

/** The spine, cover and closing page included. */
export function portfolioSpine(p: PortfolioReview): SpineEntry[] {
  return buildSpine({
    archetype: ARCHETYPE_ID,
    chapters: portfolioSections(p).map((s) => ({
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
 * The holdings check is here rather than only in the normaliser because
 * `renderPortfolioDocument` is exported and can be reached with a payload that
 * never passed through it. A review with no holdings still builds a
 * structurally valid spine and would render as a document whose central table
 * has no rows — worse than an error, because it looks finished.
 */
export function validatePortfolioSpine(p: PortfolioReview): string[] {
  const problems = validateSpine(ARCHETYPE_ID, portfolioSpine(p));
  if (!p.holdings.length) problems.push('the portfolio has no holdings to review');
  if (!p.meta.clientName.trim()) problems.push('the review names no client');
  return problems;
}

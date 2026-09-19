/**
 * What the document contains, and in what order.
 *
 * ## The verdict goes first
 *
 * The producer writes its recommendation tenth, and the legacy markdown prints it
 * near the end. This document opens with it. Someone who chose to compare
 * properties does not need walking to the answer — the same posture as the
 * Portfolio's "Where the portfolio stands" — and on a truncated record it means
 * the reader learns in the first ten seconds that the record is incomplete rather
 * than after eight sections.
 *
 * ## Placeholders, on the salvaged path only
 *
 * The other three formats drop a section whose block is missing, and are right
 * to: absence there is incidental and unknowable to the reader. Here, on a
 * salvaged record, absence is systematic — `recommendations` survives on two of
 * twenty-seven rows — and a ranked comparison that silently omits *which one
 * should I buy* reads as a finished document that forgot to answer its own
 * question. So a section named in `provenance.missing` is still built, still
 * numbered and still listed, with a body that says what is not there.
 *
 * On the `columns` path a null column drops its section exactly as before.
 */
import type { ReportArchetypeId, SpineEntry } from '../../reportDesign/structure.pure.ts';
import { buildSpine, validateSpine } from '../../reportDesign/structure.pure.ts';
import type { PropertyComparison } from './payload.pure.ts';

export const ARCHETYPE_ID: ReportArchetypeId = 'property-comparison';

/** Red flags that fit on one page below the section's framing. */
export const FLAGS_PER_PAGE = 6;

export interface ComparisonSection {
  id: string;
  title: string;
  /** One line under the chapter number, and on the contents page. */
  note: string;
  pageBudget: number;
  /** Opens the landscape page. Only the scorecard does. */
  wide?: boolean;
  /**
   * Built because the record should hold it and does not.
   *
   * The renderer prints a callout naming what is absent instead of a body. Only
   * ever set on the salvaged path.
   */
  placeholderFor?: string;
}

/** Sections keyed by the source section they render, for the placeholder pass. */
const SOURCE_KEY: Readonly<Record<string, string>> = {
  verdict: 'executiveSummary',
  scorecard: 'rankings',
  ranking: 'rankings',
  money: 'financialComparison',
  place: 'locationComparison',
  risk: 'riskComparison',
  matches: 'investorMatches',
  timing: 'marketTiming',
  advantages: 'competitiveAdvantages',
  flags: 'redFlags',
  plan: 'recommendations',
};

/** The sections this payload has content for, in printed order. */
export function comparisonSections(p: PropertyComparison): ComparisonSection[] {
  const sections: ComparisonSection[] = [
    {
      id: 'verdict',
      title: 'What this comparison found',
      note: 'The ranking, the top pick, and what the analysis concluded.',
      pageBudget: 2,
    },
    {
      id: 'scorecard',
      title: 'Who wins what',
      note: 'Every category, and which property took it.',
      // One page of framing plus the matrix. Bounded: at most five columns.
      pageBudget: 2,
      wide: true,
    },
  ];

  if (p.ranked.some((r) => r.strengths.length || r.concerns.length || r.bestSuitedFor)) {
    sections.push({
      id: 'ranking',
      title: 'Each property in turn',
      note: 'What carries each one, what drags on it, and who it suits.',
      // Measured: a page of framing plus roughly a page per property once the
      // strengths, concerns and suitability prose are in.
      pageBudget: 1 + Math.max(1, p.ranked.length),
    });
  }

  const group = (id: string) => p.axes.find((g) => g.id === id);
  if (group('money')) {
    sections.push({
      id: 'money',
      title: 'The money',
      note: 'Value, yield, cash flow and return, compared.',
      pageBudget: 1,
    });
  }
  if (group('place')) {
    sections.push({
      id: 'place',
      title: 'Location and lifestyle',
      note: 'Schools, infrastructure, growth corridors and access.',
      pageBudget: 1,
    });
  }
  if (group('risk') || p.risks.length) {
    sections.push({
      id: 'risk',
      title: 'Risk',
      note: 'What each property exposes you to, in the analysis’s own words.',
      pageBudget: 2,
    });
  }
  if (p.redFlags.length) {
    sections.push({
      id: 'flags',
      title: 'Before you commit',
      note: 'Concerns raised against individual properties.',
      pageBudget: 1 + Math.ceil(p.redFlags.length / FLAGS_PER_PAGE),
    });
  }
  if (p.matches.length) {
    sections.push({
      id: 'matches',
      title: 'Who each property suits',
      note: 'The investor profile each one fits, and why.',
      pageBudget: 1,
    });
  }
  if (p.advantages.length) {
    sections.push({
      id: 'advantages',
      title: 'What sets each apart',
      note: 'The advantages the analysis found for each property.',
      pageBudget: 1,
    });
  }
  if (p.timing) {
    sections.push({
      id: 'timing',
      title: 'Timing and holding',
      note: 'Which to buy first, and how long to hold each.',
      pageBudget: 1,
    });
  }
  if (p.recommendations) {
    sections.push({
      id: 'plan',
      title: 'What we recommend',
      note: 'The pick, the runners-up, and what to avoid.',
      pageBudget: 2,
    });
  }

  sections.push({
    id: 'basis',
    title: 'On what basis',
    note: 'The settings this comparison was produced under.',
    pageBudget: 1,
  });

  return withPlaceholders(p, sections);
}

/**
 * Add a named placeholder for each section the record should hold and does not.
 *
 * Ordered by where the section would have appeared, so a reader following the
 * contents page finds the gap where they expect the content — not gathered into
 * an apology at the end.
 */
function withPlaceholders(
  p: PropertyComparison,
  sections: ComparisonSection[],
): ComparisonSection[] {
  if (p.provenance.shape !== 'salvaged' || !p.provenance.missing.length) return sections;

  const built = new Set(sections.map((s) => SOURCE_KEY[s.id]).filter(Boolean));
  const order = ['money', 'place', 'risk', 'flags', 'matches', 'advantages', 'timing', 'plan'];

  const placeholders: ComparisonSection[] = [];
  for (const id of order) {
    const key = SOURCE_KEY[id];
    if (!key || built.has(key)) continue;
    if (!p.provenance.missing.includes(key)) continue;
    placeholders.push({
      id: `missing-${id}`,
      title: TITLES[id] ?? 'Not recorded',
      note: 'Not saved with this comparison.',
      pageBudget: 1,
      placeholderFor: key,
    });
  }
  if (!placeholders.length) return sections;

  // Before the closing "On what basis", which is always last.
  const basisAt = sections.findIndex((s) => s.id === 'basis');
  const at = basisAt < 0 ? sections.length : basisAt;
  return [...sections.slice(0, at), ...placeholders, ...sections.slice(at)];
}

const TITLES: Readonly<Record<string, string>> = {
  money: 'The money',
  place: 'Location and lifestyle',
  risk: 'Risk',
  flags: 'Before you commit',
  matches: 'Who each property suits',
  advantages: 'What sets each apart',
  timing: 'Timing and holding',
  plan: 'What we recommend',
};

/** The spine, cover and closing page included. */
export function comparisonSpine(p: PropertyComparison): SpineEntry[] {
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
 * The property check is here as well as in the normaliser because
 * `renderComparisonDocument` is exported and can be reached with a payload that
 * never passed through it. A comparison of one property builds a structurally
 * valid spine and would render as a document whose central table has one column
 * — worse than an error, because it looks finished.
 */
export function validateComparisonSpine(p: PropertyComparison): string[] {
  const problems = validateSpine(ARCHETYPE_ID, comparisonSpine(p));
  if (p.properties.length < 2) {
    problems.push('a comparison needs at least two properties');
  }
  if (!p.ranked.length) {
    problems.push('the comparison ranks nothing');
  }
  return problems;
}

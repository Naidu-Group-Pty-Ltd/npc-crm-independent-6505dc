/**
 * Which of a master's typed pages a derived tier draws.
 *
 * The Investment masters serve five document kinds — the Compass, and the
 * Snapshot, Executive Briefing, Financial Analysis and Due Diligence reports
 * derived from it — through ONE page sequence: cover, contents, the executive
 * dashboard, (the property), the assessment, financial position, ten-year
 * projection, risk and recommendation, the report's own prose, sources and
 * methodology, closing. Every typed page draws from the record, and a derived
 * child copies its parent's `financial_calculations` and `investment_score`,
 * so every typed page drew on every tier — and the tier framework's own
 * constitution says most of them should not have.
 *
 * `sectionRegistry.pure.ts` places each section per tier on a SURFACE:
 * `document` (drawn by the template from the projection) or `markdown` (a
 * section the tier composes or authors in `report_content`). For the four
 * derived tiers only the cover (`identity`), the key-figures strip
 * (`keyFigures`) and — on the Briefing alone — the property identity table are
 * `document`; the score breakdown, the financial position, the ten-year
 * projection, the risks, the recommendation and the provenance are all
 * `markdown`, composed from the same record the typed pages would draw. So on
 * those tiers the typed page is a second copy of a section the prose already
 * carries, and the Snapshot — a tier whose promise is four to six pages —
 * printed seventeen (measured through the real journey, 14 Sep 2026: cover,
 * contents, dashboard, assessment, financial position, projection, risk, eight
 * pages of prose, method, closing).
 *
 * The rule, read from the registry rather than remembered here: **a derived
 * tier keeps a typed page only where the registry places that page's section
 * on the document surface.** The cover, the dashboard, the plates, the prose
 * pages, the overflow notice and the closing page are every tier's; the six
 * Compass-depth pages go on every derived tier; the property page follows
 * `propertyIdentity`'s surface; and the contents page goes on the Snapshot
 * alone, because a table of contents for a six-page document is padding.
 *
 * The Compass's page sequence is not touched by the tier rule — its documents
 * are what RS-3 and RS-4 measured and signed off — and neither is any other
 * format: a template with no Investment tier in its data renders every page
 * it declares. Applied at render time in both renderers (`htmlRenderer.ts`,
 * `pdfRenderer.ts`), so the preview and the final agree and the 500 seeded
 * masters stay as they are.
 *
 * One rule is about the RECORD rather than the tier, and it reaches the
 * Compass: **a page about how the grade was reached has no place on a record
 * that issued no grade.** The assessment page opens "How the grade was
 * reached — Five dimensions, weighted"; on an ungraded record the scorecard
 * under it draws nothing (RS-5a: an unscored dimension draws no row) and what
 * is left is that heading over one dimension's sentence — measured on the
 * long reference report, 70% of the page empty under a promise the record
 * cannot keep. The grade is read from the projection's `recommendation.grade`,
 * which `publishableGrade` publishes only where the policy issued one.
 */
import { REPORT_TIERS, section, type ReportTier } from './sectionRegistry.pure.ts';
import { contentPolicyFor } from './tierContent.pure.ts';

export const DERIVED_TIERS = ['snapshot', 'briefing', 'financial', 'strategic'] as const;
export type DerivedTier = (typeof DERIVED_TIERS)[number];

/** The tier a render context names, if it is one of the four derived ones. */
export function derivedTierOf(value: unknown): DerivedTier | null {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return (DERIVED_TIERS as readonly string[]).includes(v) ? (v as DerivedTier) : null;
}

/**
 * The typed pages that are Compass depth: each draws, from the record, a
 * section every derived tier places on the markdown surface instead.
 */
export const COMPASS_DEPTH_PAGES: readonly string[] = [
  'The assessment',
  'Financial position',
  'Ten-year projection',
  'Cash flow',
  'Risk and recommendation',
  'Sources and methodology',
];

export type PageVerdict = 'kept' | 'compass_depth' | 'property_in_prose' | 'contents_too_short';

export function pageVerdictForTier(pageName: unknown, tier: DerivedTier): PageVerdict {
  const name = String(pageName ?? '').trim();
  if (COMPASS_DEPTH_PAGES.includes(name)) return 'compass_depth';
  if (name === 'The property') {
    const surface = section('propertyIdentity').tiers[tier as ReportTier]?.surface ?? 'markdown';
    return surface === 'document' ? 'kept' : 'property_in_prose';
  }
  if (name === 'Contents' && tier === 'snapshot') return 'contents_too_short';
  return 'kept';
}

/**
 * The pages a template draws for the tier its data names. Anything that is
 * not a derived tier — the Compass, another format, no tier at all — keeps
 * every page, in order, untouched.
 */
export function pagesForTier<P extends { name?: string | null }>(pages: readonly P[], tier: unknown): P[] {
  const derived = derivedTierOf(tier);
  if (!derived) return [...pages];
  return pages.filter((p) => pageVerdictForTier(p.name, derived) === 'kept');
}

/**
 * How a tier's front matter is drawn, as the masters bind it (`report.*`).
 *
 *  - `continuousFrontMatter` — one summary page that flows into the body,
 *    rather than the typed pages a stored pre-tier report was written for;
 *  - `drawsPropertyIdentity` — the summary carries the property table where
 *    "The property" page would have been kept for this tier;
 *  - `frontScorecard` — the summary carries the grade's dimensions where "The
 *    assessment" page would have been: the Compass alone, since every derived
 *    tier places the score breakdown in its prose.
 *
 * ONE function, because two readers need it and must not disagree: the
 * projection that binds a real report, and the geometry gate's fixture
 * (`narrativeGeometryFixture.ts`). The gate once passed 710 renders without
 * ever drawing the flowing summary page, because its fixture did not carry
 * these three flags.
 */
export function frontMatterFlagsFor(tier: unknown): {
  continuousFrontMatter: boolean;
  drawsPropertyIdentity: boolean;
  frontScorecard: boolean;
} {
  const derived = derivedTierOf(tier);
  return {
    continuousFrontMatter: contentPolicyFor(typeof tier === 'string' ? tier : null).continuousFrontMatter,
    drawsPropertyIdentity: derived === null || pageVerdictForTier('The property', derived) === 'kept',
    frontScorecard: derived === null,
  };
}

/** The typed pages that are about the grade, and go with it when none was issued. */
export const GRADE_PAGES: readonly string[] = ['The assessment'];

/** An Investment tier of any kind, including the Compass itself. */
function investmentTierOf(value: unknown): ReportTier | null {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return (REPORT_TIERS as readonly string[]).includes(v) ? (v as ReportTier) : null;
}

/**
 * The pages a template draws for the document its data describes: the tier
 * rule, then the grade rule. Data with no Investment tier keeps every page.
 */
export function pagesForDocument<P extends { name?: string | null }>(
  pages: readonly P[],
  data: { tier?: unknown; recommendation?: { grade?: unknown } | null } | null | undefined,
): P[] {
  const tierPages = pagesForTier(pages, data?.tier);
  if (!investmentTierOf(data?.tier)) return tierPages;
  const grade = data?.recommendation?.grade;
  const graded = typeof grade === 'string' && grade.trim() !== '';
  return graded ? tierPages : tierPages.filter((p) => !GRADE_PAGES.includes(String(p.name ?? '').trim()));
}

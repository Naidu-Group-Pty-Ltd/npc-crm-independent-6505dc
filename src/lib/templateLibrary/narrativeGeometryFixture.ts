/**
 * A report BODY at the size the registry declares, for measuring geometry.
 *
 * ## Why this exists
 *
 * `npm run templates:compass:qa` opens every seeded master in a real Chromium
 * and measures each block's bounding box — the only honest check that a
 * declared block height survives the text that lands in it. It runs against
 * `SAMPLE_REPORT_DATA`, and that fixture carries **no narrative at all**:
 * `narrative.source` is absent, so `narrative.pages` is `undefined` and every
 * page whose conditional reads `narrative && narrative.pages > n` evaluates
 * false.
 *
 * Measured on the Investment Compass masters before this module existed: of
 * **50** schema pages, **7** rendered — Cover, Contents, Executive dashboard,
 * The assessment, Risk and recommendation, Sources and methodology, Important
 * information. The ~30 body pages, the overflow notice and the two financial
 * modelling pages had never been laid out by the gate, on any run.
 *
 * That is the lesson `WHAT_THE_PAGE_ACTUALLY_DRAWS.md` §5 records, one level
 * up. There, a 35-character sample verdict against a production 59-99 meant
 * 510 renders passed while a client's heading printed through the KPI band.
 * Here the sample has no body at all, so the gate was measuring the front
 * matter of a 34-page document and reporting on the document. **A fixture
 * shorter than the product turns a real measurement into a statement about
 * the fixture.**
 *
 * ## What this is, and what it is not
 *
 * It is a **geometry fixture**: text at the declared scale, carrying the
 * constructs a real body carries, so the packer, the markdown block, the
 * chart primitives and the running head are exercised at production size. It
 * is deliberately impossible to mistake for a report — every word in it is
 * the section registry's own `purpose` prose, which is this platform writing
 * about what a section is for, cycled to that section's own `maxWordCount`.
 *
 * It is **not** a report, not a sample document, and nothing may render it for
 * a reader. It states no fact about any property, and it is not offered as
 * evidence about any document's content — only about how a document of this
 * size sets.
 *
 * Deriving it from the registry rather than typing it has one property worth
 * the indirection: when a section's budget changes, the fixture changes with
 * it, so the gate cannot go on measuring last quarter's document.
 */
import { COMPASS_40_SECTIONS } from '@/lib/reports/compassSectionRegistry';
import { SAMPLE_REPORT_DATA } from '@/lib/templateLibrary/sampleReportData';
import { contentPolicyFor } from '../../../supabase/functions/_shared/reports/investment/tierContent.pure';
import { REPORT_TIERS } from '../../../supabase/functions/_shared/reports/investment/sectionRegistry.pure';

/** Words per section come from the registry; nothing here picks a length. */
const wordsOf = (text: string): string[] => text.split(/\s+/).filter(Boolean);

/**
 * Cycle a section's own purpose prose up to its declared word count.
 *
 * Cycling rather than truncating matters: a section budgeted at 950 words
 * whose purpose runs to 200 would otherwise be measured at a fifth of its
 * size, which is the defect this module exists to close, reintroduced one
 * layer down.
 */
function bodyWords(source: string, budget: number): string[] {
  const pool = wordsOf(source);
  if (!pool.length || budget <= 0) return [];
  const out: string[] = [];
  while (out.length < budget) out.push(pool[out.length % pool.length]);
  return out.slice(0, budget);
}

/** Break a word run into paragraphs of roughly `per` words, on sentence shape. */
function paragraphs(words: string[], per: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < words.length; i += per) {
    const chunk = words.slice(i, i + per).join(' ').replace(/[.,;:]+$/, '');
    if (chunk) out.push(`${chunk}.`);
  }
  return out;
}

/**
 * The constructs a body page carries besides prose.
 *
 * Keyed on the registry's own `visualComponents`, so a section that declares a
 * table is measured with one and a section that declares none is measured
 * without — the gate should see the page the section is specified to produce.
 * The directive spellings are `vizDirectives.pure.ts`'s.
 */
function visual(kind: string, heading: string): string | null {
  switch (kind) {
    case 'attributeTable':
    case 'trendTable':
      return [
        '| Measure | Reading | Basis | Source | As at |',
        '| --- | --- | --- | --- | --- |',
        '| Indicative measure one | 4.83% | Computed from the record | Registry fixture | 20 Sep 2026 |',
        '| Indicative measure two | $1,650,000 | Recorded on the row | Registry fixture | 20 Sep 2026 |',
        '| Indicative measure three | 26 | Counted | Registry fixture | 20 Sep 2026 |',
      ].join('\n');
    case 'kpiTiles':
      return `{{bars: title=${heading} — indicative series | max=100 | First measure 62 | Second measure 48 | Third measure 71}}`;
    case 'scorecard':
      return `{{gauge: title=${heading} — indicative reading | value=62 | max=100}}`;
    case 'infrastructureTimeline':
      return `{{timeline: title=${heading} — indicative horizons | 2026 First recorded stage | 2028 Second recorded stage | 2031 Third recorded stage}}`;
    case 'confidenceChip':
      return '- **Evidence held:** the reading above describes the retrieval, never the conclusion beside it.';
    default:
      return null;
  }
}

/**
 * The Compass body, at the registry's declared size.
 *
 * 14 sections, 8,350 words, 34 declared pages — `COMPASS_40_SECTIONS` and
 * `COMPASS_PAGE_BAND` are the authority and this reads them rather than
 * restating them.
 */
export function buildNarrativeGeometryBody(): string {
  const parts: string[] = [];
  for (const section of COMPASS_40_SECTIONS) {
    if (!section.includeInCompass) continue;
    const budget = section.maxWordCount ?? 0;
    if (budget <= 0) continue;
    parts.push(`## ${section.name}`);
    const words = bodyWords(section.purpose ?? section.name, budget);
    const paras = paragraphs(words, 95);
    const visuals = (section.visualComponents ?? [])
      .map((v) => visual(String(v), section.name))
      .filter((v): v is string => Boolean(v));
    // The visual goes after the opening passage rather than at the end: that
    // is where the generator's prompt asks for it, and a figure mid-section is
    // what forces the packer to float it.
    paras.forEach((p, i) => {
      parts.push(p);
      if (i === 0 && visuals.length) parts.push(visuals[0]);
      if (i === 2 && visuals.length > 1) parts.push(visuals[1]);
    });
    visuals.slice(2).forEach((v) => parts.push(v));
  }
  return parts.join('\n\n');
}

/** Built once: it is deterministic, and every caller measures the same body. */
export const NARRATIVE_GEOMETRY_BODY = buildNarrativeGeometryBody();


/**
 * The documents one Investment master has to be measured as.
 *
 * One page sequence serves five document kinds (`tierPageSequence.pure.ts`),
 * and the tier decides which pages it keeps — so measuring the Compass alone
 * leaves the Snapshot, Executive Briefing, Financial Analysis and Due
 * Diligence reports outside the measurement entirely.
 *
 * The tier is set in BOTH places the production adapter sets it, and that is
 * not belt and braces: `pagesForDocument` reads a **top-level** `data.tier`,
 * while the masters bind `report.tier` and the projection publishes it there.
 * Setting only the one the projection publishes changes no page at all —
 * measured, 7 pages either way.
 *
 * `report.type` is here for the same kind of reason. `planNarrative` resolves
 * its profile from it and returns null for a type it does not recognise, so
 * without it the geometry pre-pass never runs and the true page count is never
 * written over the projection's estimate.
 *
 * Shared with `scripts/template-library/investmentCompass/qa.ts` rather than
 * written twice: the gate measures these documents and the spec asserts they
 * are documents, and two copies is how those two come to disagree.
 */
export interface GeometryDocument {
  /** The tier this document is. */
  tier: string;
  data: Record<string, unknown>;
}

export function investmentGeometryDocuments(): GeometryDocument[] {
  return REPORT_TIERS.map((tier) => {
    const data = JSON.parse(JSON.stringify(SAMPLE_REPORT_DATA)) as Record<string, any>;
    const policy = contentPolicyFor(tier);
    data.narrative = { ...(data.narrative ?? {}), source: NARRATIVE_GEOMETRY_BODY };
    data.report = {
      ...(data.report ?? {}),
      type: 'investment_compass',
      tier,
      documentTitle: policy.documentTitle ?? data.report?.documentTitle,
      standfirst: policy.standfirst ?? data.report?.standfirst,
      drawsFinancialModelling: policy.financialModelling,
      companionNote: policy.companionNote ?? data.report?.companionNote,
    };
    data.tier = tier;
    return { tier, data };
  });
}

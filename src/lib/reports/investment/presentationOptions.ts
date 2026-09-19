/**
 * The five controls on the Investment export panel, and what each one is.
 *
 * ## Two different kinds of switch
 *
 * They look alike on the panel and they are not alike at all:
 *
 *  * **Sources** and **Scoring** are CONTENT INCLUSION rules. They remove
 *    whole sections from the report a client receives. Whether the document
 *    comes out in the standard presentation or in a chosen template makes no
 *    difference to whether those sections belong in it, so they are applied to
 *    the report content ONCE, before either renderer sees it.
 *  * **Charts**, **Hero images** and **Sparklines** are PRESENTATION rules.
 *    They decide what is DRAWN, never what is true. Turning charts off leaves
 *    every figure, table and sentence the chart was drawn from exactly where
 *    it was.
 *
 * That distinction is the whole point of this module. A toggle that claimed to
 * change a chosen template's document while changing nothing would be worse
 * than one that plainly did not apply.
 *
 * ## What these may never do
 *
 * None of the five alters a calculated value, the narrative, the evidence, the
 * scoring arithmetic, the geography, the financial record or which sections a
 * report is structurally required to have. A hidden chart does not remove the
 * figures it plotted; a hidden scoring SECTION does not re-score anything.
 */

export interface InvestmentPresentationOptions {
  /** Content: append source notes and supporting references. */
  includeSources: boolean;
  /** Content: include the investment scoring sections. */
  includeScoring: boolean;
  /** Presentation: draw the charts a section's own figures support. */
  includeCharts: boolean;
  /** Presentation: place the hero imagery already stored against the report. */
  includeHeroImages: boolean;
  /** Presentation: draw inline series alongside the financial figures. */
  includeSparklines: boolean;
}

/**
 * What the page starts with, and what every caller that names none of them
 * gets. Hero images default OFF because a report only has them once somebody
 * has placed them; the rest default ON because they are what a complete
 * document contains.
 */
export const DEFAULT_INVESTMENT_PRESENTATION_OPTIONS: InvestmentPresentationOptions = {
  includeSources: true,
  includeScoring: true,
  includeCharts: true,
  includeHeroImages: false,
  includeSparklines: true,
};

export function resolvePresentationOptions(
  partial?: Partial<InvestmentPresentationOptions> | null,
): InvestmentPresentationOptions {
  return { ...DEFAULT_INVESTMENT_PRESENTATION_OPTIONS, ...(partial ?? {}) };
}

/**
 * Section titles the Sources rule removes.
 *
 * Stated once. These lived inside the standard generator, which meant the rule
 * applied to the standard document and to nothing else: a report delivered
 * through a chosen template carried its source notes however the switch was
 * set, and nobody was told.
 */
export const SOURCE_SECTION_PATTERNS: readonly RegExp[] = [
  /market data sources?/i,
  /data sources?/i,
  /data availability/i,
  /data.*sourcing/i,
  /methodology\s*notes?/i,
  /data\s*transparency/i,
  /data\s*limitations?/i,
  /limitations?\s*(&|and)?\s*transparency/i,
  /demographic.*economic data/i,
  /economic data sources?/i,
  /sources?$/i,
];

/** Section titles the Scoring rule removes. Stated once, for the same reason. */
export const SCORING_SECTION_PATTERNS: readonly RegExp[] = [
  /investment scor/i,
  /score breakdown/i,
  /scoring breakdown/i,
  /investment grade/i,
  /investment rating/i,
  /overall score/i,
  /property score/i,
];

/** True when a section heading is removed by the options as set. */
export function sectionIsExcluded(
  heading: string, options: InvestmentPresentationOptions,
): boolean {
  if (!options.includeSources && SOURCE_SECTION_PATTERNS.some((p) => p.test(heading))) return true;
  if (!options.includeScoring && SCORING_SECTION_PATTERNS.some((p) => p.test(heading))) return true;
  return false;
}

/** Apply the content rules to a `Record<heading, body>` of parsed sections. */
export function filterSections(
  sections: Record<string, string>, options: InvestmentPresentationOptions,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [heading, body] of Object.entries(sections)) {
    if (!sectionIsExcluded(heading, options)) out[heading] = body;
  }
  return out;
}

/**
 * The report's own Markdown, with the excluded sections removed.
 *
 * This is what makes the two content rules reach a CHOSEN TEMPLATE: the
 * template binds `narrative.source` and its own section namespace, both of
 * which are built from this string, so filtering it filters every
 * presentation rather than only the standard one.
 *
 * A heading is any ATX heading (`#` … `######`). A section runs to the next
 * heading at the SAME OR SHALLOWER level, so removing "Sources" takes its
 * sub-headings with it and leaves the chapter that follows alone.
 */
export function filterReportContent(
  content: string, options: InvestmentPresentationOptions,
): string {
  if (options.includeSources && options.includeScoring) return content;
  if (!content) return content;

  const lines = content.split('\n');
  const out: string[] = [];
  /** The level being skipped, or null. */
  let skippingAt: number | null = null;

  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      if (skippingAt !== null && level <= skippingAt) skippingAt = null;
      if (skippingAt === null) {
        // The numeral a generated report prefixes its headings with is not
        // part of the title: `## 33. Data Sources` has to match `sources?$`.
        const title = heading[2].replace(/^\s*\d+[.)]\s*/, '').trim();
        if (sectionIsExcluded(title, options)) {
          skippingAt = level;
          continue;
        }
      }
    }
    if (skippingAt === null) out.push(line);
  }
  return out.join('\n');
}

/**
 * The chart directives a narrative carries, removed when their control is off.
 *
 * `markdown.pure.ts` treats `{{kind: …}}` as an instruction to the renderer —
 * it is drawn or it is dropped, and either way its source is never printed. So
 * removing one here removes a FIGURE and never a sentence: the prose around it
 * and every number in that prose are untouched.
 *
 * `margin` carries a `spark=` series and is the narrative's sparkline, so it
 * answers to the sparkline control; every other kind is a chart. A `margin`
 * with no series is a sidenote and is left alone by both.
 */
export function filterNarrativeFigures(
  markdown: string, options: InvestmentPresentationOptions,
): string {
  if (options.includeCharts && options.includeSparklines) return markdown;
  if (!markdown) return markdown;

  return markdown.replace(/\{\{\s*([a-zA-Z_]+)\s*:([^}]*)\}\}/g, (whole, rawKind: string, body: string) => {
    const kind = String(rawKind).toLowerCase();
    if (kind === 'margin') {
      if (!/\bspark\s*=/.test(body)) return whole;
      return options.includeSparklines ? whole : '';
    }
    return options.includeCharts ? whole : '';
  });
}

/** Both content rules and both figure rules, in the order they apply. */
export function applyPresentationOptionsToContent(
  content: string, options: InvestmentPresentationOptions,
): string {
  return filterNarrativeFigures(filterReportContent(content, options), options);
}

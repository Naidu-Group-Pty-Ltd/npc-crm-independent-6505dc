/**
 * What a Market Intelligence report says, as a shape.
 *
 * ## Eight layers of prose, and a prose payload
 *
 * This is the second format in the programme whose payload is model-authored
 * Markdown rather than typed figures, which is why `../markdown.pure.ts` moved
 * out of the Report Q&A directory to sit beside this one. Measured across the
 * six reports in the record, the 46 layer bodies carry ATX headings in 37,
 * bullets in 31, inline bold in 36, ordered lists in 10 and GFM pipe tables in
 * 11 — and no URLs, no Markdown links, no pictographs and no dingbats at all.
 *
 * The one genuinely structured leaf is `marketEvents`, which the edge function
 * gets back from a forced tool call against a strict JSON schema
 * (`generate-market-intelligence-report/index.ts:159-188`). Everything else is a
 * prose contract stated in a prompt, which is exactly why the generator being
 * replaced parses it so fragilely.
 *
 * ## The layers print out of numeric order, and that is deliberate
 *
 * 1, 2, 3, 4, 6, 7, 8, then **5**. Layer 5 is the 90-Day Strategic Outlook and
 * it synthesises the others, so it reads last. `generate()`
 * (`MarketIntelligencePDFGenerator.ts:1013-1147`) has always done this; naming
 * the order here rather than leaving it implicit in a render function is what
 * stops it being "corrected" by someone sorting the keys.
 *
 * ## Almost everything is optional, and the empty case is ordinary
 *
 * The edge function runs layers 1/2/3/6/7 in parallel, each with a `.catch`
 * that returns empty (`index.ts:616-652`), so a failed layer produces a silently
 * empty section rather than an error. **6 of the record's 46 layer bodies are
 * empty strings.** Which layers are requested at all comes from
 * `REPORT_TYPE_LAYERS` (`index.ts:27-36`) and lands in `includedLayers`.
 *
 * The newer fields — `keyInsightsSnapshot`, `actionableStrategy`, `ctaContent`,
 * `layer7_micro`, `layer8_competitive_edge`, `reportType`, `reportTypeLabel`,
 * `audienceSegment`, `includedLayers` — are absent on the one `market_pulse` row
 * and present on the five `full` ones. A reader has to treat every one of them
 * as missing rather than empty.
 */
import type { MarkdownNotices } from '../markdown.pure.ts';

/** The eight layers, in the order the document prints them. */
export const LAYER_ORDER = [
  'layer1_rba',
  'layer2_housing',
  'layer3_sentiment',
  'layer4_regulatory',
  'layer6_economic',
  'layer7_micro',
  'layer8_competitive_edge',
  'layer5_outlook',
] as const;

export type LayerKey = typeof LAYER_ORDER[number];

/**
 * What each layer is called on the page.
 *
 * Carried verbatim from the generator being replaced
 * (`MarketIntelligencePDFGenerator.ts:1039-1111`), because these are the titles
 * a reader of the existing report already knows and the prompts that produce
 * each layer are written to them.
 */
export const LAYER_TITLES: Readonly<Record<LayerKey, string>> = {
  layer1_rba: 'RBA & Interest Rate Analysis',
  layer2_housing: 'Housing Market Pulse',
  layer3_sentiment: 'Consumer & Investor Sentiment',
  layer4_regulatory: 'Regulatory & Policy Watch',
  layer6_economic: 'Economic Indicators Dashboard',
  layer7_micro: 'Suburb & Corridor Intelligence',
  layer8_competitive_edge: 'Competitive Strategic Edge',
  layer5_outlook: '90-Day Strategic Outlook',
};

/**
 * Content shorter than this is not a section.
 *
 * The generator applies exactly this rule, but to one layer only — layer 4 is
 * gated on `cleaned.length > 100` (`:1063-1071`) and the other seven are gated
 * on truthiness alone. So a layer that came back as a single sentence of "no
 * data available" prints as a section with a heading and one line under it. Six
 * of the record's 46 layer bodies are empty and would pass a truthiness check
 * on an object while failing this one on its content.
 */
export const MIN_SECTION_CHARS = 100;

/**
 * More events than this is a paste, not a month.
 *
 * The record's largest `marketEvents` array is 17. The generator prints at most
 * the 12 most recent past and 8 nearest future (`:781-783`), which this keeps.
 */
export const MAX_EVENTS = 40;
export const MAX_PAST_EVENTS = 12;
export const MAX_FUTURE_EVENTS = 8;

/** The record's largest citation list is 21. */
export const MAX_CITATIONS = 60;

/**
 * The most Markdown one section may carry.
 *
 * One layer's `content` reached **244,332 characters** in the record — twenty
 * times the 12,169-character average, and four-fifths of that report's entire
 * payload on its own. `../markdown.pure.ts` would cap it at
 * `MAX_MARKDOWN_CHARS` (65,536) and say so, but 65,536 characters is still
 * twenty-five printed pages for one section of a document whose other sections
 * are three or four.
 *
 * 20,000 sits above the p90 layer (15,229) and below both runaways, so it clips
 * exactly the two bodies in the record that are pathological and leaves the
 * other 44 whole. What is clipped is said on the page by the same callout the
 * Markdown module already prints.
 */
export const MAX_SECTION_CHARS = 20_000;

/**
 * A last-resort whole-document ceiling, in estimated printed lines.
 *
 * With `MAX_SECTION_CHARS` in place this does not fire on anything in the
 * record — the largest real report lands at 24 pages. It exists for the shape
 * nothing has produced yet: fifteen sections all at the section cap, which
 * would be four times the largest document anyone has actually generated.
 */
export const MAX_DOCUMENT_LINES = 1_100;

/** One of the eight layers, after reading. */
export interface Layer {
  key: LayerKey;
  title: string;
  /** Markdown, as the model wrote it, after the editorial strips. */
  content: string;
  /** Sources this layer named. Deduplicated against the document's list. */
  citations: readonly string[];
  /** True when the layer was asked for but came back with nothing to print. */
  empty: boolean;
}

/** A dated market event, from the one leaf with a real schema. */
export interface MarketEvent {
  /** `YYYY-MM-DD` as the tool call requires. Kept as stored. */
  date: string;
  event: string;
  /** `interest_rate` | `economic` | `housing` | `regulatory` | `seasonal`. */
  category: string;
  /** `positive` | `negative` | `neutral`. Drives a tone, never a colour alone. */
  impact: string;
  description: string;
  /** 0–100 as the schema asks. The legacy requires it and never reads it. */
  relevanceScore: number | null;
  /** True when the date is after `preparedOn`. Derived, never read. */
  upcoming: boolean;
}

/**
 * The correlation block.
 *
 * Present only when the report was produced from `MarketCorrelationPanel`, and
 * — until the change that goes with this migration — **never persisted**. The
 * panel passes it in memory to the generator and the History modal cannot, so
 * re-downloading a correlation report has always silently dropped this whole
 * section. `report_data.correlationData` is written from now on; the six
 * existing rows do not have it, and the document says so rather than pretending.
 */
export interface CorrelationBlock {
  aiAnalysis: string;
  perplexityResearch: string;
  citations: readonly string[];
}

/** The three blocks of prose that are not one of the eight layers. */
export interface ProseBlocks {
  executiveSummary: string;
  /** "Your 60-second market briefing" — five bullets, by prompt contract. */
  keyInsightsSnapshot: string;
  /** Three fixed headings: what to do now / what to avoid / timing. */
  actionableStrategy: string;
  /** The model's own close. The brand's own close is added beside it. */
  ctaContent: string;
}

export type AudienceSegment = 'general' | 'investor' | 'homebuyer' | string;

/**
 * How many audience panels the suburb layer carries.
 *
 * `audiencePanels` in `render.pure.ts` prints one callout for a named audience
 * and two for the general edition, which is the legacy's own behaviour
 * (`MarketIntelligencePDFGenerator.ts:862-887`). The page estimate has to charge
 * for them or the section under-claims, so the count lives here — one fact both
 * the planner and the renderer read — rather than being written twice and
 * drifting. `render.spec.ts` counts the callouts the function actually emits and
 * asserts they agree.
 */
export function audiencePanelCount(segment: AudienceSegment): number {
  return segment && segment !== 'general' ? 1 : 2;
}

/**
 * Callouts the brand's own close adds to the next-steps section.
 *
 * `brandClose` prints two — "Why <brand>?" and "Ready to take the next step?" —
 * on every document regardless of what the model wrote.
 */
export const BRAND_CLOSE_CALLOUTS = 2;

export interface MarketIntelligenceReport {
  meta: {
    reportId: string;
    /** `April 2026` — what the edge function wrote, and what names the file. */
    reportPeriod: string;
    /** `full`, `market_pulse`, … as stored. */
    reportType: string;
    /** The cover title. Falls back to a name for the format. */
    reportTypeLabel: string;
    audienceSegment: AudienceSegment;
    /** ISO instant, supplied by the caller. Nothing here has a clock. */
    preparedOn: string;
    /** When the report itself was generated, as stored. */
    generatedAt: string;
    /** True when advisory strategy was asked for, from the row not the payload. */
    includeAdvisoryStrategy: boolean;
    /** Sections the document ended up with content for. */
    layersShown: number;
    /** Sections that were asked for and came back empty. */
    layersEmpty: number;
    /** True when the document budget cut it short. */
    truncated: boolean;
  };
  /** Two or three sentences framing the report. Built from it, not written. */
  narrative: string;
  prose: ProseBlocks;
  /** In `LAYER_ORDER`. Empty layers are carried so the document can say so. */
  layers: readonly Layer[];
  events: readonly MarketEvent[];
  /** Every source named, deduplicated, in first-seen order. */
  citations: readonly string[];
  /** Absent on every row generated before this migration. */
  correlation: CorrelationBlock | null;
  /** Every departure from the stored payload, summed across the document. */
  notices: Readonly<Partial<MarkdownNotices>> & {
    /** Layers asked for that had nothing to print. */
    layersEmpty: number;
    /** Sections dropped by the document budget. */
    sectionsDropped: number;
    /** Characters of prose the budget did not show. */
    charsOmitted: number;
  };
}

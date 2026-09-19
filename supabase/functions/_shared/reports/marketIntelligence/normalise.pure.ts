/**
 * Turning a stored `report_data` blob into a document — or refusing to.
 *
 * Everything this document prints is one jsonb column on one row, written by
 * `generate-market-intelligence-report`. There is no second table and nothing
 * computed live, so the route reads the row and the browser sends an id.
 *
 * ## The editorial strips are content policy, not formatting
 *
 * The generator being replaced runs four passes over the model's prose before
 * drawing it (`MarketIntelligencePDFGenerator.ts:112-161`), and they are the
 * reason the shipping PDF reads like a client document rather than like a model
 * transcript. They are carried here rather than left in a renderer, for the same
 * reason the Client Details emoji removal lives in its normaliser: a policy that
 * lives in a renderer is a policy the next renderer does not have.
 *
 *  - **Data limitations.** Whole `### Data Limitations` sections, and inline
 *    hedging — "the search results do not contain", "this critical data point is
 *    absent", `Note:` / `Caveat:` lines. A client-facing market brief does not
 *    print the model apologising for its own retrieval.
 *  - **Empty regulatory sections.** A numbered section whose body is mostly
 *    `N/A` or "no recent changes identified" is dropped whole.
 *  - **The duplicate brand tagline.** The CTA prompt tells the model not to
 *    write a "Why <Brand>?" section because the document adds its own
 *    (`index.ts:511`), and the model writes one anyway often enough that a strip
 *    exists for it.
 *
 * ## What is deliberately *not* carried
 *
 * `sanitise` (`:86-91`) strips emoji and then **everything outside Latin-1**.
 * That is right for jsPDF, whose built-in faces are WinAnsi-encoded, and wrong
 * here for the same reasons `reportQa` records: it would delete a non-Latin
 * name, and the installed faces set `— – … ≤ ≥ →` correctly. Measured, the
 * corpus contains no pictographs and no dingbats at all, so the strip is
 * removing nothing it was written to remove. `../markdown.pure.ts` handles
 * glyphs, and it keeps scripts.
 *
 * `stripMarkdown` (`:93-100`) is not carried either — it exists because jsPDF
 * cannot set bold inside a paragraph. Here the Markdown is the point.
 */
import {
  LAYER_ORDER,
  LAYER_TITLES,
  MAX_CITATIONS,
  MAX_EVENTS,
  MAX_FUTURE_EVENTS,
  MAX_PAST_EVENTS,
  MIN_SECTION_CHARS,
  type AudienceSegment,
  type CorrelationBlock,
  type Layer,
  type LayerKey,
  type MarketEvent,
  type MarketIntelligenceReport,
  type ProseBlocks,
} from './payload.pure.ts';
import { neutraliseUrls } from '../text.pure.ts';
import { markdownToPlainText, sanitiseGlyphs } from '../markdown.pure.ts';

/** The row, as the route reads it. */
export interface ReportRow {
  id?: unknown;
  report_data?: unknown;
  report_period?: unknown;
  report_type?: unknown;
  audience_segment?: unknown;
  include_advisory_strategy?: unknown;
  generated_at?: unknown;
  status?: unknown;
}

export interface BuildInput {
  row: ReportRow;
  /** ISO instant. Passed in — this module has no clock. */
  preparedOn: string;
  /** The tenant's name, for the brand-tagline strip. From the snapshot. */
  brandName: string;
  /**
   * Issue this report as a different edition than the row says.
   *
   * The audience decides the closing panels on the suburb layer, and nothing
   * else — every word the model wrote is the same. So an investor edition and a
   * homebuyer edition of one stored report are two renders, not two
   * generations, and the legacy could only get the second by running the whole
   * eight-layer model pipeline again.
   *
   * Null or absent leaves the row's own segment alone, so the default output is
   * what the record says it is.
   */
  audienceOverride?: string | null;
}

export type BuildResult =
  | { ok: true; report: MarketIntelligenceReport }
  | { ok: false; error: string };

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** A short field: glyph-sanitised, URL-neutralised, collapsed and capped. */
const short = (v: unknown, max: number): string =>
  neutraliseUrls(sanitiseGlyphs(str(v)).text).replace(/\s+/g, ' ').trim().slice(0, max).trim();

// ── The editorial strips ────────────────────────────────────────────────────

/**
 * Remove the model's hedging about its own retrieval.
 *
 * Carried verbatim in behaviour from `stripDataLimitations`
 * (`MarketIntelligencePDFGenerator.ts:112-125`). The patterns are unchanged
 * because they were tuned against the same prompts that still produce this
 * prose; changing them is a content decision, not a migration.
 */
export function stripDataLimitations(content: string): string {
  if (!content) return '';
  let cleaned = content.replace(
    /#{1,4}\s*Data Limitations?\b[\s\S]*?(?=\n#{1,4}\s|\n---|\n\*\*\d|\n$)/gi,
    '',
  );
  cleaned = cleaned.replace(
    /^.*(?:search results (?:do not|don't|lack|contain no)|data (?:is|are) not (?:available|present|provided)|insufficient (?:data|information)).*$/gmi,
    '',
  );
  cleaned = cleaned.replace(
    /^.*(?:critical data point is absent|not present in (?:these|the) results|would require access to|additional sources.*would be necessary).*$/gmi,
    '',
  );
  cleaned = cleaned.replace(
    /^(?:\*\*)?(?:Note|Caveat|Disclaimer|Important Note|Data Note|Limitation)(?:\*\*)?:.*$/gmi,
    '',
  );
  return cleaned.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Drop a numbered regulatory section whose body is mostly `N/A`.
 *
 * From `stripEmptyRegulatorySections` (`:131-146`). The heuristic — two or more
 * N/A phrases and fewer than four substantive lines — is kept exactly, because
 * it is calibrated against the Regulatory & Policy Watch prompt's own numbered
 * shape and a different threshold would silently change which sections appear.
 */
export function stripEmptyRegulatorySections(content: string): string {
  if (!content) return '';
  const cleaned = content.replace(
    /#{1,4}\s+\d+\.\s+[^\n]+\n[\s\S]*?(?=#{1,4}\s+\d+\.\s|$)/g,
    (match) => {
      const body = match.replace(/#{1,4}\s+[^\n]+\n/g, '');
      const naPhrases = (body.match(
        /\bN\/A\b|No recent.*?(?:changes|updates).*?identified|not.*?identified in the provided/gi,
      ) || []).length;
      const substantive = body
        .split('\n')
        .filter((l) => l.trim() && !l.match(/^#{1,4}\s|^\s*(?:N\/A|When:|Which States|Impact Rating:)\s*$/i))
        .length;
      return naPhrases >= 2 && substantive < 4 ? '' : match;
    },
  );
  return cleaned.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Remove the model's own "Why <Brand>?" block.
 *
 * From `stripDuplicateBrandTagline` (`:151-161`). The document adds the brand's
 * close itself, from the pinned snapshot, so leaving the model's would print the
 * same pitch twice under two slightly different names.
 */
export function stripDuplicateBrandTagline(content: string, brandName: string): string {
  if (!content) return '';
  const escaped = brandName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let cleaned = content.replace(
    new RegExp(`#{1,4}\\s*Why\\s+${escaped}\\??[\\s\\S]*?(?=\\n#{1,4}\\s|\\n---|\\n$)`, 'gi'),
    '',
  );
  cleaned = cleaned.replace(
    /#{1,4}\s*Why NPC Services\?[\s\S]*?(?=\n#{1,4}\s|\n---|\n$)/gi,
    '',
  );
  return cleaned.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Every strip a layer's prose goes through, in order.
 *
 * URL neutralisation runs last for the reason `text.pure.ts` states: a pass that
 * *removes* characters can create a scheme-relative token, so anything that
 * deletes must run before it. The corpus contains no URLs at all today, which is
 * exactly when this is easy to get wrong and never notice.
 */
export function cleanLayerContent(content: string, brandName: string): string {
  const stripped = stripDuplicateBrandTagline(
    stripEmptyRegulatorySections(stripDataLimitations(str(content))),
    brandName,
  );
  return neutraliseUrls(sanitiseGlyphs(stripped).text).trim();
}

// ── Reading the blob ────────────────────────────────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** A citation list, cleaned and deduplicated. Never a URL. */
export function toCitations(raw: unknown, seen = new Set<string>()): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    const text = short(entry, 240);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= MAX_CITATIONS) break;
  }
  return out;
}

/**
 * Read the eight layers, in printed order.
 *
 * A layer is kept in the list even when it is empty, with `empty: true`, because
 * the reader needs to be told that a section they were expecting had nothing in
 * it. The legacy drops it silently and still prints its contents-page entry, so
 * the numbering drifts and a reader counting sections finds one missing with no
 * explanation.
 */
export function toLayers(data: Record<string, unknown>, brandName: string): Layer[] {
  const requested = Array.isArray(data.includedLayers)
    ? new Set((data.includedLayers as unknown[]).map((x) => str(x)))
    : null;

  const layers: Layer[] = [];
  const seenCitations = new Set<string>();

  for (const key of LAYER_ORDER) {
    const block = data[key];
    // `includedLayers` uses the short names — `layer1`, `layer7` — while the
    // payload keys are `layer1_rba`, `layer7_micro`. Matching on the prefix is
    // what makes the two agree.
    const shortName = key.split('_')[0];
    const wasRequested = requested ? requested.has(shortName) || requested.has(key) : block !== undefined;
    if (!wasRequested && block === undefined) continue;

    const content = isRecord(block) ? cleanLayerContent(str(block.content), brandName) : '';
    const citations = isRecord(block) ? toCitations(block.citations, seenCitations) : [];
    layers.push({
      key: key as LayerKey,
      title: LAYER_TITLES[key],
      content,
      citations,
      empty: content.length < MIN_SECTION_CHARS,
    });
  }
  return layers;
}

/** The dated events, past then future, capped as the legacy caps them. */
export function toEvents(raw: unknown, preparedOn: string): MarketEvent[] {
  if (!Array.isArray(raw)) return [];
  const today = /^\d{4}-\d{2}-\d{2}/.exec(preparedOn)?.[0] ?? '';
  const parsed: MarketEvent[] = [];

  for (const entry of raw.slice(0, MAX_EVENTS)) {
    if (!isRecord(entry)) continue;
    const date = short(entry.date, 20);
    const event = short(entry.event, 160);
    if (!date || !event) continue;
    const score = Number(entry.relevance_score ?? entry.relevanceScore);
    parsed.push({
      date,
      event,
      category: short(entry.category, 40),
      impact: short(entry.impact, 20).toLowerCase(),
      description: short(entry.description, 400),
      relevanceScore: Number.isFinite(score) ? score : null,
      upcoming: Boolean(today) && date > today,
    });
  }

  // Date order, and the same two caps the legacy applies — most recent past,
  // nearest future. Sorted here rather than trusted from the row: the edge
  // function sorts descending on write (`index.ts:921-923`), but a hand-edited
  // or older row cannot be assumed to have.
  const past = parsed.filter((e) => !e.upcoming).sort((a, b) => b.date.localeCompare(a.date));
  const future = parsed.filter((e) => e.upcoming).sort((a, b) => a.date.localeCompare(b.date));
  return [...future.slice(0, MAX_FUTURE_EVENTS), ...past.slice(0, MAX_PAST_EVENTS)];
}

/** The correlation block, when the row has one. */
export function toCorrelation(raw: unknown, brandName: string): CorrelationBlock | null {
  if (!isRecord(raw)) return null;
  const aiAnalysis = cleanLayerContent(str(raw.aiAnalysis), brandName);
  const perplexityResearch = cleanLayerContent(str(raw.perplexityResearch), brandName);
  const citations = toCitations(raw.citations);
  if (!aiAnalysis && !perplexityResearch && !citations.length) return null;
  return { aiAnalysis, perplexityResearch, citations };
}

/**
 * Two or three sentences framing the report, built from the record.
 *
 * Not written and not asked of a model — the same rule every format in this
 * programme holds, and it matters most here, where the body is entirely model
 * prose. A lede a reader cannot trace to a row is one more paragraph of the same
 * thing the document is already full of.
 */
export function narrativeFor(
  period: string,
  typeLabel: string,
  shown: number,
  empty: number,
  events: number,
): string {
  const sections = shown === 1 ? 'one section' : `${shown} sections`;
  const missing = empty === 0
    ? ''
    : ` ${empty === 1 ? 'One layer was' : `${empty} layers were`} requested and returned nothing; `
      + `${empty === 1 ? 'it is' : 'they are'} named where ${empty === 1 ? 'it would' : 'they would'} have appeared.`;
  const dated = events
    ? ` ${events} dated market ${events === 1 ? 'event' : 'events'} are listed at the end.`
    : '';
  return `${typeLabel} for ${period}, in ${sections}.${missing}${dated}`;
}

const uuidLike = (v: unknown): string => {
  const s = str(v).trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : '';
};

/**
 * Build the report.
 *
 * Refuses rather than renders when the row has nothing to say: a payload that is
 * not an object, or a report with no prose and no layer that cleared
 * `MIN_SECTION_CHARS`. A cover page and a disclaimer page with nothing between
 * them is a file somebody sends before noticing.
 */
export function buildMarketIntelligenceReport(input: BuildInput): BuildResult {
  const row = input.row ?? {};
  const reportId = uuidLike(row.id);
  if (!reportId) return { ok: false, error: 'report id missing' };

  if (str(row.status) && str(row.status) !== 'completed') {
    return { ok: false, error: `this report is ${str(row.status)}, not completed` };
  }

  const data = row.report_data;
  if (!isRecord(data)) return { ok: false, error: 'this report has no stored payload' };

  const brandName = input.brandName || 'the company';

  const prose: ProseBlocks = {
    executiveSummary: cleanLayerContent(str(data.executiveSummary), brandName),
    keyInsightsSnapshot: cleanLayerContent(str(data.keyInsightsSnapshot), brandName),
    actionableStrategy: cleanLayerContent(str(data.actionableStrategy), brandName),
    ctaContent: cleanLayerContent(str(data.ctaContent), brandName),
  };

  const layers = toLayers(data, brandName);
  const events = toEvents(data.marketEvents, input.preparedOn);
  const correlation = toCorrelation(data.correlationData, brandName);

  const layersShown = layers.filter((l) => !l.empty).length;
  const layersEmpty = layers.filter((l) => l.empty).length;

  const hasAnything = layersShown > 0
    || prose.executiveSummary.length >= MIN_SECTION_CHARS
    || Boolean(correlation);
  if (!hasAnything) return { ok: false, error: 'this report has no content to typeset' };

  // Document-level citation list: the layers' own, then whatever `allCitations`
  // adds that no layer already named. Deduplicated across both, in first-seen
  // order, so a source cited by three layers is listed once.
  const seen = new Set<string>();
  const citations: string[] = [];
  for (const layer of layers) {
    for (const c of layer.citations) {
      if (seen.has(c)) continue;
      seen.add(c);
      citations.push(c);
    }
  }
  for (const c of toCitations(data.allCitations, seen)) citations.push(c);

  const period = short(row.report_period ?? data.reportPeriod, 60) || 'this period';
  const typeLabel = short(data.reportTypeLabel, 80) || 'Market Intelligence Report';

  return {
    ok: true,
    report: {
      meta: {
        reportId,
        reportPeriod: period,
        reportType: short(row.report_type ?? data.reportType, 40) || 'full',
        reportTypeLabel: typeLabel,
        audienceSegment: (short(
          input.audienceOverride || row.audience_segment || data.audienceSegment,
          40,
        ) || 'general') as AudienceSegment,
        preparedOn: input.preparedOn,
        generatedAt: str(row.generated_at) || str(data.generatedAt),
        includeAdvisoryStrategy: row.include_advisory_strategy !== false,
        layersShown,
        layersEmpty,
        truncated: false,
      },
      narrative: narrativeFor(period, typeLabel, layersShown, layersEmpty, events.length),
      prose,
      layers,
      events,
      citations: citations.slice(0, MAX_CITATIONS),
      correlation,
      notices: { layersEmpty, sectionsDropped: 0, charsOmitted: 0 },
    },
  };
}

/** Plain text of a layer's opening, for a contents-page note. */
export function layerSummary(layer: Layer, maxChars = 90): string {
  if (layer.empty) return 'No data returned';
  const firstProse = layer.content
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('#') && !l.startsWith('|') && !l.startsWith('-'));
  return markdownToPlainText(firstProse ?? layer.content, maxChars);
}

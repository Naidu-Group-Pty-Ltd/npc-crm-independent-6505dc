/**
 * What a Market Intelligence template may bind.
 *
 * ## This restates the report, it does not re-read the row
 *
 * `_shared/reports/marketIntelligence/` already builds a
 * `MarketIntelligenceReport` for `render-market-intelligence-pdf` — the eight
 * layers in order, the editorial strips applied, the events, the citations and
 * a notices ledger. This restates that, as every other projection in this
 * programme restates its normaliser.
 *
 * The strips matter: `cleanLayerContent` removes the model's "data limitations"
 * boilerplate, its empty regulatory sections and its duplicated brand tagline.
 * Re-reading `report_data` here would put all three back on a client's page.
 *
 * ## The layers stay Markdown
 *
 * Each layer is Markdown as the model wrote it. It is published as **source**
 * for `markdown-block`, which renders it through the programme's escape-first
 * renderer — the same arrangement Report Q&A uses, and for the same reason:
 * safety belongs to the renderer, so a projection that pre-rendered HTML would
 * move the escaping decision to its caller.
 *
 * ## Only layers with content are published
 *
 * The payload carries empty layers so a document can say it asked. Measured
 * across the six stored reports, **8 of 48 layer bodies are absent** — one
 * housing, two regulatory, one outlook, two suburb, two competitive edge.
 *
 * Publishing them in place would leave holes in the index a template binds by
 * (`layers.3` empty while `layers.4` has content), so a master would need a
 * conditional per layer *and* per position. Instead the empty ones are dropped
 * from `layers` and named in `layersOmitted`, so `layers.0…n` are all real and
 * the document still says what it asked for and did not get.
 *
 * ## Clipping is expected here, not exceptional
 *
 * This is the format that clips a section and says so on the page, and the
 * record shows why: `layer8_competitive_edge` runs 15,055 characters at the
 * median, and one stored `layer5_outlook` is **244,332** — about ninety-nine
 * pages of one section. Each layer therefore publishes the number of pages it
 * needs and, where a master's allocation is smaller, a whole sentence naming
 * what is not shown.
 */
import { renderMarkdown } from './reports/markdown.pure.ts';
import { packMarkdownPages, DEFAULT_LINES_PER_PAGE } from './reports/markdownPaging.pure.ts';
import type {
  MarketIntelligenceReport,
  Layer,
  MarketEvent,
} from './reports/marketIntelligence/payload.pure.ts';

/**
 * Pages a master allocates per layer, and the collection caps.
 *
 * `layerPages` is the number of `markdown-block` pages a master declares for
 * each of the eight layers. Three covers the median of seven of them outright;
 * the eighth (`competitive_edge`, 15,055 characters at p50) is clipped and says
 * so. Raising it multiplies across eight layers and fifty masters, which is a
 * seed-size decision as much as a design one.
 */
/**
 * Characters of a source name that fit on one line of the sources table.
 *
 * Measured on the printed document (Private Banking — Chancery, 9pt): a
 * 88-character URL wrapped at the column's edge, so 84 leaves a margin for the
 * narrower families. A URL breaks at hyphens and slashes, never mid-word, so
 * the estimate errs long rather than short.
 */
export const CITATION_CHARS_PER_LINE = 84;

/** The sources that fit `rows` lines, each taking the lines its length needs. */
export function fitCitationRows(citations: string[], rows: number, charsPerLine: number): string[] {
  const out: string[] = [];
  let used = 0;
  for (const name of citations) {
    const lines = Math.max(1, Math.ceil(name.length / Math.max(1, charsPerLine)));
    if (used + lines > rows) break;
    out.push(name);
    used += lines;
  }
  return out;
}

export const CAPS = {
  layerPages: 3,
  layers: 8,
  events: 10,
  upcomingEvents: 6,
  citations: 12,
  /** Event descriptions drawn as their own ruled rows; the stored report carries 12. */
  eventNotes: 8,
  /** Pages each correlation body may run to, like the other paged prose. */
  correlationPages: 3,
} as const;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** `2026-04-22` → `22 Apr 2026` — the legacy timeline column's own format. */
function shortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return iso ?? '';
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${m[3]} ${month.slice(0, 3)} ${m[1]}` : iso;
}

/**
 * The audience editions, as the legacy labels them — its `AUDIENCE_LABELS`
 * map. The legacy's general edition carries no edition line at all; a labelled
 * cover fact with nothing beside it reads as a rendering fault, so the general
 * edition is worded here instead of left blank.
 */
const EDITION_LABELS: Readonly<Record<string, string>> = {
  general: 'General',
  investor: 'Investor Edition',
  homebuyer: 'Homebuyer Edition',
};

/**
 * The per-audience insight panels, carried verbatim from the legacy's
 * `audiencePanels` — hardcoded English, not model output, and it says the same
 * thing on every report; but somebody wrote it for a client-facing document,
 * so it is carried rather than quietly dropped. One panel for a named
 * audience, two for the general edition, exactly as `render.pure.ts` emits
 * them.
 */
function audiencePanelsFor(segment: string | undefined): Array<{ title: string; body: string }> {
  if (segment === 'investor') {
    return [{
      title: 'What this means for your portfolio',
      body: 'These suburbs have been identified based on their yield-to-growth ratio, '
        + 'supply-demand dynamics, and infrastructure pipeline. Each represents a strategic '
        + 'entry point for portfolio growth with strong rental demand underpinning cash flow '
        + 'stability.',
    }];
  }
  if (segment && segment !== 'general') {
    return [{
      title: 'What this means for your home search',
      body: 'These suburbs offer strong lifestyle value alongside genuine capital growth '
        + 'potential. They represent areas where buying now positions you for long-term wealth '
        + 'building, with improving amenities and transport connectivity.',
    }];
  }
  return [
    {
      title: 'What this means for investors',
      body: 'Focus on yield-to-growth ratios and supply-demand dynamics in the suburbs '
        + 'identified. Each represents a strategic entry point for portfolio growth with strong '
        + 'rental demand underpinning cash flow.',
    },
    {
      title: 'What this means for homebuyers',
      body: 'These suburbs offer genuine lifestyle value alongside capital growth potential. '
        + 'Buying in these locations now positions you for long-term wealth building in a less '
        + 'competitive market.',
    },
  ];
}

function put(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined && value !== null && value !== '') target[key] = value;
}

function str(v: unknown): string | undefined {
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? undefined : s;
}

/**
 * How many pages this Markdown needs at the master's line budget.
 *
 * Shared with the block through `packMarkdownPages`, so a master's conditional
 * and the block's output cannot disagree. See `reports/markdownPaging.pure.ts`.
 */
export function layerPageCount(
  markdown: string,
  linesPerPage: number = DEFAULT_LINES_PER_PAGE,
): number {
  const source = str(markdown);
  if (!source) return 0;
  return packMarkdownPages(renderMarkdown(source).blocks, linesPerPage).length;
}

function projectLayer(layer: Layer, linesPerPage: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  put(out, 'key', str(layer.key));
  put(out, 'title', str(layer.title));
  put(out, 'content', str(layer.content));

  const pages = layerPageCount(layer.content, linesPerPage);
  put(out, 'pages', pages || undefined);

  /*
   * A whole sentence, and only when the allocation actually bites.
   *
   * Not a fragment: a template concatenating "…and N more" into a heading is
   * left with a dangling clause when there is nothing to omit. The Cash Flow
   * Comparison's `matched` taught this.
   */
  if (pages > CAPS.layerPages) {
    const hidden = pages - CAPS.layerPages;
    put(out, 'omissionNote',
      `This section continues for ${hidden} further ${hidden === 1 ? 'page' : 'pages'}, `
      + 'which are not shown in this edition.');
  }

  const citations = (layer.citations ?? []).map(str).filter(Boolean) as string[];
  put(out, 'citationCount', citations.length || undefined);
  return out;
}

function projectEvent(event: MarketEvent): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  put(out, 'date', str(event.date));
  put(out, 'dateLabel', shortDate(event.date));
  put(out, 'event', str(event.event));
  put(out, 'category', str(event.category));
  // The legacy table's own cells: the category with its underscores folded
  // ("interest_rate" → "interest rate") and the impact as a capitalised word
  // in its own column — the legacy encoded it as a coloured dot alone, and
  // colour is never the only channel in this design system.
  put(out, 'categoryLabel', str(event.category)?.replace(/_/g, ' '));
  out.impactLabel = event.impact
    ? event.impact.charAt(0).toUpperCase() + event.impact.slice(1)
    : '—';
  put(out, 'impact', str(event.impact));
  put(out, 'description', str(event.description));
  // `relevanceScore` is nullable and a null is not a zero — a zero would sort
  // and print as a real judgement of "no relevance", which is not what an
  // absent score means.
  if (typeof event.relevanceScore === 'number' && Number.isFinite(event.relevanceScore)) {
    out.relevanceScore = event.relevanceScore;
  }
  return out;
}

export interface ProjectedMarketIntelligence {
  marketIntel: Record<string, unknown>;
}

export function projectMarketIntelligence(
  report: MarketIntelligenceReport,
  linesPerPage: number = DEFAULT_LINES_PER_PAGE,
): ProjectedMarketIntelligence {
  const marketIntel: Record<string, unknown> = {};
  const r = report as unknown as Record<string, any>;

  const allLayers: Layer[] = Array.isArray(r.layers) ? r.layers : [];
  const filled = allLayers.filter((l) => !l?.empty && str(l?.content));

  // Nothing to describe means nothing published, so a page conditional on
  // `marketIntel` cannot draw blank. `audienceSegment` and `reportTypeLabel` are
  // always present on the payload and would otherwise make this truthy — the
  // defect found in the Report Q&A and Capacity projections.
  const hasContent = filled.length > 0 || Boolean(str(r.narrative));
  if (!hasContent) return { marketIntel };

  const meta: Record<string, unknown> = {};
  put(meta, 'reportPeriod', str(r.meta?.reportPeriod));
  put(meta, 'reportTypeLabel', str(r.meta?.reportTypeLabel));
  put(meta, 'audienceSegment', str(r.meta?.audienceSegment));
  // The words the legacy's edition line uses, never the raw enum — the cover
  // bound `audienceSegment` and printed "general" as an edition name.
  const segment = str(r.meta?.audienceSegment);
  if (segment) put(meta, 'editionLabel', EDITION_LABELS[segment] ?? segment);
  put(meta, 'preparedOn', str(r.meta?.preparedOn));
  put(meta, 'generatedAt', str(r.meta?.generatedAt));
  put(meta, 'layersShown', filled.length || undefined);
  if (Object.keys(meta).length) marketIntel.meta = meta;

  // The closing panels the audience segment decides — the one thing besides
  // the edition line it changes. Static copy from the legacy, so the preview
  // and the flowing route say the same words.
  const panels = audiencePanelsFor(segment);
  if (panels.length) marketIntel.audiencePanels = panels;

  put(marketIntel, 'narrative', str(r.narrative));

  const prose = r.prose ?? {};
  const proseOut: Record<string, unknown> = {};
  put(proseOut, 'executiveSummary', str(prose.executiveSummary));
  put(proseOut, 'keyInsights', str(prose.keyInsightsSnapshot));
  put(proseOut, 'strategy', str(prose.actionableStrategy));
  /*
   * The two long ones are paged, exactly as the layers are.
   *
   * Measured on the stored reports, `executiveSummary` runs 4,430 characters
   * and `actionableStrategy` 4,315 — four times what a single block was sized
   * for, and a fixed block set them 275pt past the footer on the most generous
   * variant. Nobody controls their length, because a model writes them, so they
   * get the treatment this format already gives a body of unknown length: one
   * page plus conditional continuations, counted by the same `packMarkdownPages`
   * the block uses so the two cannot disagree.
   */
  put(proseOut, 'executiveSummaryPages',
    layerPageCount(String(prose.executiveSummary ?? ''), linesPerPage) || undefined);
  put(proseOut, 'strategyPages',
    layerPageCount(String(prose.actionableStrategy ?? ''), linesPerPage) || undefined);
  // The briefing too: it measures 1,146 characters on the stored report,
  // already past the 1,100-character block it used to be set into — a model
  // writes it, so its length is nobody's to promise.
  put(proseOut, 'keyInsightsPages',
    layerPageCount(String(prose.keyInsightsSnapshot ?? ''), linesPerPage) || undefined);
  // `ctaContent` is deliberately not published. It is the generator's
  // call-to-action for the email the legacy attached this PDF to; a template is
  // a document rather than a campaign, and a "book a call" panel in the middle
  // of a market report reads as an advertisement.
  if (Object.keys(proseOut).length) marketIntel.prose = proseOut;

  if (filled.length) {
    marketIntel.layers = filled.slice(0, CAPS.layers).map((l) => projectLayer(l, linesPerPage));
  }

  const empties = allLayers.filter((l) => l?.empty || !str(l?.content));
  if (empties.length) {
    const names = empties.map((l) => str(l?.title)).filter(Boolean) as string[];
    if (names.length) {
      put(marketIntel, 'layersOmitted',
        `${names.length === 1 ? 'One section was' : `${names.length} sections were`} `
        + `requested and returned no content: ${names.join(', ')}.`);
    }
  }

  // ── events ───────────────────────────────────────────────────────────────
  const events: MarketEvent[] = Array.isArray(r.events) ? r.events : [];
  const upcoming = events.filter((e) => e?.upcoming);
  const past = events.filter((e) => !e?.upcoming);
  if (past.length) {
    marketIntel.events = past.slice(0, CAPS.events).map(projectEvent);
    put(marketIntel, 'eventCount', past.length);
  }
  if (upcoming.length) {
    marketIntel.upcoming = upcoming.slice(0, CAPS.upcomingEvents).map(projectEvent);
    put(marketIntel, 'upcomingCount', upcoming.length);
  }

  /*
   * What each event meant — the sidenotes the legacy sets under its timeline,
   * labelled with the event rather than only its date, "because a date alone
   * makes a reader flip back to the table". Every one of the stored report's
   * twelve events carries a description, and none of them reached a page.
   * Upcoming first, then past — the legacy single table's own reading order.
   */
  const noted = [...upcoming, ...past].filter((e) => str(e?.description));
  if (noted.length) {
    marketIntel.eventNotes = noted.slice(0, CAPS.eventNotes).map((e) => ({
      label: `${shortDate(e.date)} · ${str(e.event) ?? ''}`.trim(),
      description: str(e.description),
    }));
    put(marketIntel, 'eventNoteCount', noted.length);
    if (noted.length > CAPS.eventNotes) {
      put(marketIntel, 'eventNotesOmitted',
        `${noted.length - CAPS.eventNotes} further ${noted.length - CAPS.eventNotes === 1 ? 'event is' : 'events are'} `
        + 'described only in the calendar above.');
    }
  }

  /*
   * The correlation block — persisted by the generator since this migration and
   * absent on every earlier row, so these pages light up as new correlation
   * reports land rather than pretending on the six that exist. Both bodies are
   * model Markdown and get the paged treatment everything of unknown length
   * here gets.
   */
  const correlation = r.correlation;
  if (correlation) {
    const corr: Record<string, unknown> = {};
    put(corr, 'analysis', str(correlation.aiAnalysis));
    put(corr, 'analysisPages',
      layerPageCount(String(correlation.aiAnalysis ?? ''), linesPerPage) || undefined);
    put(corr, 'research', str(correlation.perplexityResearch));
    put(corr, 'researchPages',
      layerPageCount(String(correlation.perplexityResearch ?? ''), linesPerPage) || undefined);
    if (Object.keys(corr).length) marketIntel.correlation = corr;
  }

  // ── sources ──────────────────────────────────────────────────────────────
  const citations = (Array.isArray(r.citations) ? r.citations : [])
    .map(str).filter(Boolean) as string[];
  if (citations.length) {
    /*
     * The sources table has `CAPS.citations` ROWS of one line each, and the
     * block under it is positioned at the height those rows take. A source is a
     * URL, and a URL longer than the column wraps: measured 14 Sep 2026 on a
     * stored report, three of twelve wrapped and the twelfth row was drawn
     * under the "Further sources" callout. So the budget is spent in LINES —
     * a source that needs two takes two — and what does not fit is counted in
     * the callout rather than hidden behind it.
     */
    const shown = fitCitationRows(citations, CAPS.citations, CITATION_CHARS_PER_LINE);
    marketIntel.citations = shown.map((name) => ({ name }));
    put(marketIntel, 'citationCount', citations.length);
    if (citations.length > shown.length) {
      put(marketIntel, 'citationsOmitted',
        `${citations.length - shown.length} further sources are listed in the full edition.`);
    }
  }

  // ── what the document itself dropped ─────────────────────────────────────
  //
  // The normaliser's own ledger, restated. This format's contract is that it
  // clips and says so, and a notice the reader never sees is the same as no
  // notice at all.
  const notices = r.notices ?? {};
  const dropped = Number(notices.sectionsDropped ?? 0);
  const omitted = Number(notices.charsOmitted ?? 0);
  if (dropped > 0 || omitted > 0) {
    const parts: string[] = [];
    if (dropped > 0) parts.push(`${dropped} ${dropped === 1 ? 'section' : 'sections'}`);
    if (omitted > 0) parts.push(`${omitted.toLocaleString('en-AU')} characters`);
    put(marketIntel, 'truncationNote',
      `The document budget did not show ${parts.join(' and ')}.`);
  }

  return { marketIntel };
}

export function applyMarketIntelligenceProjection(
  target: Record<string, unknown>,
  report: MarketIntelligenceReport,
  linesPerPage: number = DEFAULT_LINES_PER_PAGE,
): void {
  const { marketIntel } = projectMarketIntelligence(report, linesPerPage);
  if (Object.keys(marketIntel).length) target.marketIntel = marketIntel;
}

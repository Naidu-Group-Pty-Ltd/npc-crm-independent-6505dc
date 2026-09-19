/**
 * The spine, and what it costs.
 *
 * Two families of assertion here. The structural ones — an empty layer gets no
 * chapter and no contents entry, the budget never drops what a reader looks for
 * first — are the format's contract. The arithmetic ones pin constants that were
 * measured through WeasyPrint rather than chosen, so a change to any of them is
 * a claim that somebody re-measured.
 */
import { describe, expect, it } from 'vitest';
import { buildMarketIntelligenceReport } from '../normalise.pure';
import {
  chaptersFor,
  CONTENTS_LINES_PER_PAGE,
  contentsPagesFor,
  LINES_PER_CALLOUT,
  LINES_PER_SIDENOTE,
  LINES_PER_TABLE_ROW,
  planSections,
  type PlannedSection,
  SECTION_FURNITURE_LINES,
} from '../sections.pure';
import { audiencePanelCount, MAX_SECTION_CHARS } from '../payload.pure';
import { events, layerBody, PREPARED_ON, prose, reportRow } from './fixtures';

const plan = (row: unknown, audienceOverride?: string) => {
  const built = buildMarketIntelligenceReport({
    row: row as never,
    preparedOn: PREPARED_ON,
    brandName: 'Tenant Advisory',
    audienceOverride,
  });
  if (built.ok === false) throw new Error(built.error);
  return { report: built.report, ...planSections(built.report) };
};

describe('which sections exist', () => {
  it('prints one per populated layer, in LAYER_ORDER', () => {
    const { sections } = plan(reportRow());
    const layerTitles = sections.filter((s) => s.kind === 'layer').map((s) => s.title);
    expect(layerTitles).toEqual([
      'RBA & Interest Rate Analysis',
      'Housing Market Pulse',
      'Consumer & Investor Sentiment',
      'Regulatory & Policy Watch',
      'Economic Indicators Dashboard',
      'Suburb & Corridor Intelligence',
      'Competitive Strategic Edge',
      '90-Day Strategic Outlook',
    ]);
  });

  it('gives an empty layer no chapter and no contents entry', () => {
    // The one structural assertion every format in this programme carries, and
    // the defect it exists for: the generator being replaced builds its contents
    // from `includedLayers` alone and then prints nothing for the empty ones, so
    // the numbering silently drifts.
    const { sections } = plan(reportRow({ data: { layer3_sentiment: { content: '' } } }));
    const titles = sections.map((s) => s.title);
    expect(titles).not.toContain('Consumer & Investor Sentiment');
    expect(chaptersFor(sections).map((c) => c.title)).toEqual(titles);
  });

  it('omits a prose block that did not clear MIN_SECTION_CHARS', () => {
    const { sections } = plan(reportRow({ data: { keyInsightsSnapshot: 'Short.' } }));
    expect(sections.map((s) => s.kind)).not.toContain('briefing');
  });

  it('always prints a next-steps page, even with no CTA prose', () => {
    const { sections } = plan(reportRow({ data: { ctaContent: '' } }));
    expect(sections.map((s) => s.kind)).toContain('next-steps');
  });

  it('prints a correlation section only when the row carries one', () => {
    expect(plan(reportRow()).sections.map((s) => s.kind)).not.toContain('correlation');
    const withBlock = plan(reportRow({
      data: { correlationData: { aiAnalysis: `## Together\n\n${prose(0, 2)}` } },
    }));
    expect(withBlock.sections.map((s) => s.kind)).toContain('correlation');
  });
});

describe('the contents note and the chapter standfirst are different fields', () => {
  it('gives a layer a contents note but no standfirst', () => {
    // Setting the layer's own opening sentence as a standfirst printed it twice
    // within three centimetres — once in italic under the heading and again as
    // the first line of the prose. Found by reading a render.
    const layer = plan(reportRow()).sections.find((s) => s.kind === 'layer')!;
    expect(layer.note).toBeTruthy();
    expect(layer.dek).toBeUndefined();
  });

  it('keeps the standfirst on the sections whose note is authored furniture', () => {
    const strategy = plan(reportRow()).sections.find((s) => s.kind === 'strategy')!;
    expect(strategy.dek).toBe(strategy.note);
    expect(strategy.dek).toBe('Now, what to avoid, and when');
  });
});

describe('what a section costs', () => {
  it('charges the suburb layer for its audience panels', () => {
    const general = plan(reportRow());
    const investor = plan(reportRow(), 'investor');
    const suburb = (p: typeof general) =>
      p.sections.find((s) => s.title === 'Suburb & Corridor Intelligence')!;

    // The general edition prints two panels and a named audience one, so the
    // difference between the two estimates is exactly one callout.
    expect(audiencePanelCount('general')).toBe(2);
    expect(audiencePanelCount('investor')).toBe(1);
    expect(suburb(general).lines - suburb(investor).lines).toBe(LINES_PER_CALLOUT);
  });

  it('charges every other layer nothing for panels', () => {
    const { sections } = plan(reportRow());
    const housing = sections.find((s) => s.title === 'Housing Market Pulse')!;
    const sentiment = sections.find((s) => s.title === 'Consumer & Investor Sentiment')!;
    // Same body length, same cost — no hidden per-layer furniture.
    expect(housing.lines).toBe(sentiment.lines);
  });

  it('charges the events section for its sidenotes, not only its rows', () => {
    // Twelve events render as three pages, not two. Charging a table row alone
    // under-claimed it, which is what the first WeasyPrint run caught.
    const { sections } = plan(reportRow());
    const timeline = sections.find((s) => s.kind === 'events')!;
    expect(timeline.lines).toBeGreaterThan(12 * (LINES_PER_TABLE_ROW + LINES_PER_SIDENOTE));
    expect(timeline.pages).toBe(3);
  });

  it('charges nothing for a sidenote on an event with no description', () => {
    const bare = events(12).map((e) => ({ ...e, description: '' }));
    const { sections } = plan(reportRow({ data: { marketEvents: bare } }));
    const timeline = sections.find((s) => s.kind === 'events')!;
    expect(timeline.pages).toBe(1);
  });

  it('charges the next-steps page for the brand close it always prints', () => {
    const { sections } = plan(reportRow({ data: { ctaContent: '' } }));
    const next = sections.find((s) => s.kind === 'next-steps')!;
    expect(next.lines).toBe(2 * LINES_PER_CALLOUT);
  });

  it('keeps the section furniture at what the render measured', () => {
    // 13 was copied from the Report Q&A and over-claimed every document by four
    // to seven pages, because `pagesForLines` already floors each section at one
    // page for its chapter header.
    expect(SECTION_FURNITURE_LINES).toBe(3);
  });
});

describe('the contents page', () => {
  const entry = (note: string): PlannedSection => ({
    id: 'x', kind: 'layer', title: 'RBA & Interest Rate Analysis', note,
    markdown: '', lines: 0, pages: 1,
  });

  it('is one page for a short report', () => {
    expect(contentsPagesFor(Array.from({ length: 8 }, () => entry('12 dated events')))).toBe(1);
  });

  it('runs to two once the entries outgrow it', () => {
    // Pinned on both sides by render: eleven entries with three-line notes fit,
    // and the fourteen-entry `full` fixture does not.
    const long = "The cash rate held at 3.60% through the quarter, with the board's statement noting";
    expect(contentsPagesFor(Array.from({ length: 11 }, () => entry(long)))).toBe(1);
    expect(contentsPagesFor(Array.from({ length: 12 }, () => entry(long)))).toBe(2);
  });

  it('charges an entry with no note at least two lines', () => {
    const many = Array.from({ length: CONTENTS_LINES_PER_PAGE / 2 }, () => entry(''));
    expect(contentsPagesFor(many)).toBe(1);
    expect(contentsPagesFor([...many, entry('')])).toBe(2);
  });

  it('is never zero', () => {
    expect(contentsPagesFor([])).toBe(1);
  });
});

describe('the caps', () => {
  it('clips a runaway section at a line boundary and reports the residue', () => {
    const runaway = `${layerBody(0)}\n\n${prose(0, 400)}`;
    const { sections, charsOmitted } = plan(reportRow({
      data: { layer5_outlook: { content: runaway } },
    }));
    const outlook = sections.find((s) => s.title === '90-Day Strategic Outlook')!;
    expect(outlook.markdown.length).toBeLessThanOrEqual(MAX_SECTION_CHARS);
    expect(outlook.clippedChars).toBeGreaterThan(0);
    expect(charsOmitted).toBe(outlook.clippedChars);
    // Never mid-construct: the cut lands on a newline.
    expect(runaway.startsWith(outlook.markdown)).toBe(true);
    expect(runaway[outlook.markdown.length]).toBe('\n');
  });

  it('clips rather than drops, so no section vanishes', () => {
    // A whole-document line budget dropped the entire outlook section on this
    // shape, which is worse than shortening it.
    const runaway = `${layerBody(0)}\n\n${prose(0, 400)}`;
    const { sections, dropped } = plan(reportRow({
      data: { layer5_outlook: { content: runaway } },
    }));
    expect(dropped).toEqual([]);
    expect(sections.map((s) => s.title)).toContain('90-Day Strategic Outlook');
  });

  it('leaves an ordinary section untouched', () => {
    const { sections, charsOmitted } = plan(reportRow());
    expect(charsOmitted).toBe(0);
    expect(sections.every((s) => s.clippedChars === undefined)).toBe(true);
  });

  /**
   * Every prose block at the section cap, so the budget is genuinely exhausted
   * before the last sections are reached.
   *
   * The obvious version of this fixture — only the layers oversized — proves
   * nothing: the budget accumulates only over sections it *keeps*, and a
   * non-KEEP section is dropped exactly when it would push the total past, so
   * the running total never climbs high enough to threaten anything. Emptying
   * the KEEP set left that version passing. The cap has to be reached by the
   * kept sections themselves, which means `ctaContent` has to be oversized too.
   */
  const everythingAtTheCap = () => {
    const huge = prose(0, 400);
    return reportRow({
      data: Object.fromEntries([
        ['executiveSummary', huge],
        ['keyInsightsSnapshot', huge],
        ['actionableStrategy', huge],
        ['ctaContent', huge],
        ...['layer1_rba', 'layer2_housing', 'layer3_sentiment', 'layer4_regulatory',
          'layer5_outlook', 'layer6_economic', 'layer7_micro', 'layer8_competitive_edge']
          .map((k) => [k, { content: huge }]),
      ]),
    });
  };

  it('never drops the sections a reader looks for first', () => {
    // The budget skips summary, briefing, next-steps and sources. A missing
    // executive summary reads as a broken document; a layer dropped off the end
    // is named in a callout on the page.
    const kinds = plan(everythingAtTheCap()).sections.map((s) => s.kind);
    expect(kinds).toContain('summary');
    expect(kinds).toContain('briefing');
    expect(kinds).toContain('next-steps');
    expect(kinds).toContain('sources');
  });

  it('does drop the ones it may, on that same document', () => {
    // Without this the assertion above passes on a document the budget never
    // touched, which is what it did until the fixture was made large enough.
    const { dropped } = plan(everythingAtTheCap());
    expect(dropped.length).toBeGreaterThan(0);
    expect(dropped.every((d) => !['summary', 'briefing', 'next-steps', 'sources'].includes(d.kind)))
      .toBe(true);
  });
});

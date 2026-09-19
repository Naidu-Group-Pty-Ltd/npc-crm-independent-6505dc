/**
 * Market Intelligence on the Investment Compass families.
 *
 * ## Eight layers of model-authored Markdown
 *
 * The report is composed of eight named layers, each Markdown as the model
 * wrote it, and each drawn by `markdown-block` — the same block Report Q&A uses
 * and for the same reason: it renders source through the programme's
 * escape-first renderer, so it cannot emit markup the model chose.
 *
 * ## The page budget is fitted to what the record actually holds
 *
 * Measured across the six stored reports, 48 layer bodies:
 *
 * | | |
 * | --- | --- |
 * | absent entirely | **8** |
 * | `layer1_rba` median | 2,291 chars |
 * | `layer8_competitive_edge` median | **15,055** chars |
 * | largest single layer | **244,332** chars — about ninety-nine pages |
 *
 * No fixed sequence carries that range. Each layer therefore gets one page plus
 * two conditional continuations, and where the allocation bites the projection
 * publishes a whole sentence naming the pages not shown. That is this format's
 * own contract rather than an invention: it is the one that clips a section and
 * says so on the page.
 *
 * Empty layers are dropped by the projection rather than carried, so
 * `layers.0…n` are all real and a master needs one conditional per position
 * instead of one per position *and* one per layer. What was asked for and came
 * back empty is named in `layersOmitted` instead, so the document still says it.
 *
 * ## The call to action is not here
 *
 * `prose.ctaContent` exists on the payload and is deliberately unbound. It is
 * the generator's copy for the email the legacy attached this PDF to; a "book a
 * call" panel in the middle of a market report reads as an advertisement.
 */
import {
  DESIGN_FAMILIES,
  resolveManifest,
  type DesignFamily,
  type VariantDefinition,
} from './family';
import {
  beginCompassTemplate,
  callout,
  cols,
  contents,
  contentTop,
  cover,
  definitions,
  disclaimerPage,
  flow,
  ifItFits,
  markdown,
  remainingAfter,
  MARKDOWN_LINES_PER_PAGE,
  oneOf,
  page,
  prose,
  sectionHeading,
  table,
  textHeight,
  withFurniture,
  type PageDef,
} from './blocks';
import { hasContents } from './resolvers';
import { assembleMaster, type CompassSeedTemplate, type ReportFormat } from './master';
import { STANDARD_DISCLAIMER } from '../designSystem';

const FOOTER = '{{marketIntel.meta.reportPeriod}} · Market Intelligence';
const DOCUMENT_LABEL = 'Market Intelligence';

/** Layers a master draws, and pages each is allowed. Mirrors the projection's CAPS. */
const LAYERS = 8;
const LAYER_PAGES = 3;

const ROWS = {
  events: 10,
  upcoming: 6,
  citations: 12,
} as const;

const LENGTHS = {
  narrative: 700,
  // Fitted against the seed builder's overflow guard on the two spacious
  // families (pb-03, le-03), which set the same characters into more vertical
  // space than the rest. A declared height that is too small does not overflow
  // the page — it prints over the next block, which `flow()` cannot see.
  executiveSummary: 1080,
  keyInsights: 1100,
  strategy: 1100,
  /** Longest event name across the stored reports; 47, rounded up. */
  eventName: 50,
  /** Longest stored event description is 193 characters; the cap is 400. */
  eventNote: 210,
  /** The longest audience panel runs 262 characters. */
  audiencePanel: 290,
} as const;

const MARKET_INTELLIGENCE_FORMAT: ReportFormat = {
  key: 'market-intelligence',
  reportType: 'market_intelligence',
  /*
   * `statewide`, not `market`.
   *
   * `market` is in the TypeScript `TemplateLibraryCategory` union but **not** in
   * `template_library_entries_category_check`, which accepts `suburb`,
   * `postcode` and `statewide` instead. The two vocabularies have diverged, and
   * the column is the one that decides — the Client Details masters were
   * rejected mid-apply for the same class of mistake, and the seed builder's
   * category guard exists because of it. It caught this one at build time.
   *
   * Of what the column does accept, `statewide` is the only market-analysis
   * category at a broad geographic scope, which is what a national macro report
   * is closest to. Adding `market` to the constraint would be the better fix and
   * is a migration rather than a template change.
   */
  category: 'statewide',
  tier: 'compass',
  label: 'Market Intelligence',
  extraTags: ['market', 'intelligence', 'macro', 'rba', 'outlook'],
};

const HAS_INTEL = 'marketIntel';

/**
 * Events the calendar sets before it continues onto a second page.
 *
 * Measured on `le-03`, the most generous variant: a calendar row renders about
 * 56pt there, so a header and ten events is 621pt into 584pt of page and ran
 * 37pt past the footer. Eight fits with room, and the rest continue rather than
 * being dropped — the stored report carries exactly ten, so a cap of eight
 * would have lost two off a client's calendar.
 */
const EVENTS_FIRST_PAGE = 8;

/**
 * The legacy timeline's own cells: the short date, the event, the category
 * with its underscores folded, and the impact as a capitalised word — the
 * legacy encoded impact as a coloured dot alone, and colour is never the only
 * channel in this design system. The raw `impact` used to be bound here and
 * printed "neutral" lowercase in a column of sentence-case cells.
 */
function eventRow(collection: string, i: number): string[] {
  return [
    `{{marketIntel.${collection}.${i}.dateLabel}}`,
    `{{marketIntel.${collection}.${i}.event}}`,
    `{{marketIntel.${collection}.${i}.categoryLabel}}`,
    `{{marketIntel.${collection}.${i}.impactLabel}}`,
  ];
}

/**
 * One layer: a titled opening page plus two conditional continuations.
 *
 * The title is bound rather than written, because which layer sits at position
 * `i` depends on which ones came back empty — the projection drops those, so
 * position is not layer identity.
 */
function layerPages(index: number): PageDef[] {
  const out: PageDef[] = [];
  const source = `{{marketIntel.layers.${index}.content}}`;
  /*
   * `layers[${index}]`, bracketed — a page conditional is JavaScript, and
   * `marketIntel.layers.0` is a SyntaxError that logs once and answers false
   * forever. Every one of these thirty-two layer pages shipped silently dark
   * on all fifty masters: the format's eight layers — the document — never
   * rendered, while the cover, the summary and the calendar did. Found the
   * same way the Report Q&A's dark page and the two portfolio market pages
   * were found, and now guarded the same way: the catalogue spec constructs
   * every conditional.
   */
  const has = `marketIntel && marketIntel.layers && marketIntel.layers[${index}]`;

  // Derived from the heading this page actually draws, not from a constant
  // standing in for it. The `- 104` this replaced was 4 to 22pt short on five
  // families, and a too-large body does not overflow visibly — it prints over
  // the next block.
  const heading = sectionHeading({
    eyebrow: 'Market intelligence',
    heading: `{{marketIntel.layers.${index}.title}}`,
    // A layer title — the same order as the longest stored event name
    // (47, `LENGTHS.eventName`), with a line's worth of slack.
    headingChars: 60,
  });
  const firstHeight = remainingAfter([heading], contentTop());
  const bodyHeight = remainingAfter([], contentTop());

  out.push({
    ...withFurniture(page(`Layer ${index + 1}`, [
      ...flow([
        heading,
        markdown(source, 0, firstHeight, MARKDOWN_LINES_PER_PAGE),
      ], contentTop()),
    ]), FOOTER),
    conditional: has,
  });

  for (let p = 1; p < LAYER_PAGES; p += 1) {
    out.push({
      ...withFurniture(page(`Layer ${index + 1} (${p + 1})`, [
        ...flow([
          markdown(source, p, bodyHeight, MARKDOWN_LINES_PER_PAGE),
        ], contentTop()),
      ]), FOOTER),
      conditional: `${has} && marketIntel.layers[${index}].pages > ${p}`,
    });
  }

  // Where the allocation bites, the page says so. The projection publishes this
  // as a whole sentence, and only when there is something to say.
  out.push({
    ...withFurniture(page(`Layer ${index + 1} — continues`, [
      ...flow([
        callout('This section continues', `{{marketIntel.layers.${index}.omissionNote}}`),
      ], contentTop()),
    ]), FOOTER),
    conditional: `${has} && marketIntel.layers[${index}].omissionNote`,
  });

  return out;
}

/** Pages a paged prose section is allowed. Mirrors the projection's page count. */
const PROSE_PAGES = 3;

/**
 * A long prose section: one page plus conditional continuations.
 *
 * The same shape `layerPages` gives a layer, and for the same reason — a model
 * writes these and nobody controls their length. `executiveSummary` measures
 * 4,430 characters on the stored reports and `strategy` 4,315, against a single
 * block that had been sized for about 1,100. That set the page 275pt past the
 * footer on `de-03`, the most generous variant.
 *
 * Continuations are conditional on the page count the projection publishes, so
 * a short section costs nothing: `visiblePages` filters a conditional page out
 * before layout rather than printing it blank.
 */
function prosePages(opts: {
  key: 'executiveSummary' | 'strategy' | 'keyInsights';
  name: string;
  eyebrow: string;
  heading: string;
  c: ReturnType<typeof beginCompassTemplate>;
}): PageDef[] {
  const { key, name, eyebrow, heading, c } = opts;
  const source = `{{marketIntel.prose.${key}}}`;
  const has = `marketIntel && marketIntel.prose && marketIntel.prose.${key}`;
  const firstHeight = c.contentBottom - contentTop() - c.spacing.headingGap - 104;
  const contHeight = c.contentBottom - contentTop() - 12;
  const out: PageDef[] = [];

  out.push({
    ...withFurniture(page(name, [
      ...flow([
        sectionHeading({ eyebrow, heading }),
        markdown(source, 0, firstHeight, MARKDOWN_LINES_PER_PAGE),
      ], contentTop()),
    ]), FOOTER),
    conditional: has,
  });

  for (let p = 1; p < PROSE_PAGES; p += 1) {
    out.push({
      ...withFurniture(page(`${name} (${p + 1})`, [
        ...flow([
          markdown(source, p, contHeight, MARKDOWN_LINES_PER_PAGE),
        ], contentTop()),
      ]), FOOTER),
      conditional: `${has} && marketIntel.prose.${key}Pages > ${p}`,
    });
  }

  return out;
}

function buildTemplate(family: DesignFamily, variant: VariantDefinition): CompassSeedTemplate {
  const manifest = resolveManifest(family, variant);
  const c = beginCompassTemplate(family, variant, manifest);
  const pages: PageDef[] = [];

  // ── Cover ────────────────────────────────────────────────────────────────
  pages.push(cover({
    wordmarkTop: '{{org.name}}',
    wordmarkBottom: 'Market Intelligence',
    tagline: 'Your dedicated property partner',
    marker: DOCUMENT_LABEL,
    eyebrow: '{{marketIntel.meta.reportTypeLabel}}',
    title: '{{marketIntel.meta.reportPeriod}}',
    standfirst:
      'Where the market stands this period, across rates, housing, sentiment, '
      + 'policy and the corridors we watch — and what it means for the next '
      + 'ninety days.',
    locations: 'Prepared {{marketIntel.meta.preparedOn | date}}',
    facts: [
      { label: 'Period', value: '{{marketIntel.meta.reportPeriod}}' },
      // The words the legacy's edition line uses — the raw segment printed
      // "general" as an edition name on every stored report's cover.
      { label: 'Edition', value: '{{marketIntel.meta.editionLabel}}' },
      { label: 'Sections', value: '{{marketIntel.meta.layersShown | fixed:0}}' },
      { label: 'Sources', value: '{{marketIntel.citationCount | fixed:0}}' },
    ],
  }));

  // ── Contents, where the family declares one ──────────────────────────────
  //
  // The list is fixed while the pages are conditional, so it names what this
  // format covers rather than promising a page number — the same rule the
  // Client Details contents holds, for the same reason.
  if (hasContents(manifest.toc_style)) {
    pages.push({
      ...withFurniture(page('Contents', [
        ...flow([
          sectionHeading({ eyebrow: 'In this report', heading: 'Contents' }),
          contents([
            'Where the market stands',
            'In summary',
            'Key insights',
            'The intelligence layers',
            'What moved the market',
            'What to watch',
            'Where this points',
            'The next step',
            'Sources',
          ]),
        ], contentTop()),
      ]), FOOTER),
      conditional: HAS_INTEL,
    });
  }

  // ── Where it stands ──────────────────────────────────────────────────────
  //
  // The narrative is short and fixed — 108 characters on the stored reports —
  // so it keeps a sized block. The executive summary is not: it runs 4,430,
  // which is why it is paged rather than set into one block.
  pages.push({
    ...withFurniture(page('Where it stands', [
      ...flow([
        sectionHeading({ eyebrow: 'This period', heading: 'Where the market stands' }),
        prose('{{marketIntel.narrative}}', textHeight(LENGTHS.narrative)),
        {
          ...callout('Not every section returned', '{{marketIntel.layersOmitted}}'),
          conditional: 'marketIntel && marketIntel.layersOmitted',
        },
      ], contentTop()),
    ]), FOOTER),
    conditional: HAS_INTEL,
  });

  pages.push(...prosePages({
    key: 'executiveSummary',
    name: 'The summary',
    eyebrow: 'This period',
    heading: 'In summary',
    c,
  }));

  // ── What stands out ──────────────────────────────────────────────────────
  //
  // Paged like the summary and the strategy: the stored briefing measures
  // 1,146 characters, already past the 1,100-character block it used to be
  // set into, and a model writes it — its length is nobody's to promise.
  pages.push(...prosePages({
    key: 'keyInsights',
    name: 'What stands out',
    eyebrow: 'This period',
    heading: 'Key insights',
    c,
  }));

  // ── The eight layers ─────────────────────────────────────────────────────
  for (let i = 0; i < LAYERS; i += 1) {
    pages.push(...layerPages(i));
  }

  // ── What happened, and what is coming ────────────────────────────────────
  pages.push({
    ...withFurniture(page('The calendar', [
      ...flow([
        sectionHeading({ eyebrow: 'Dated', heading: 'What moved the market' }),
        table({
          headers: ['Date', 'Event', 'Category', 'Impact'],
          rows: Array.from({ length: EVENTS_FIRST_PAGE }, (_, i) => eventRow('events', i)),
          columnWidths: cols(78, c.contentWidth - 256, 100, 78),
          numeric: [],
          wraps: { chars: LENGTHS.eventName, columnWidth: c.contentWidth - 256 },
        }),
      ], contentTop()),
    ]), FOOTER),
    conditional: 'marketIntel && marketIntel.events',
  });

  // The calendar continues only when there is something to continue with.
  pages.push({
    ...withFurniture(page('The calendar (2)', [
      ...flow([
        sectionHeading({ eyebrow: 'Dated', heading: 'What moved the market' }),
        table({
          headers: ['Date', 'Event', 'Category', 'Impact'],
          rows: Array.from({ length: ROWS.events - EVENTS_FIRST_PAGE }, (_, i) =>
            eventRow('events', EVENTS_FIRST_PAGE + i)),
          columnWidths: cols(78, c.contentWidth - 256, 100, 78),
          numeric: [],
          wraps: { chars: LENGTHS.eventName, columnWidth: c.contentWidth - 256 },
        }),
      ], contentTop()),
    ]), FOOTER),
    conditional: `marketIntel && marketIntel.eventCount > ${EVENTS_FIRST_PAGE}`,
  });

  pages.push({
    ...withFurniture(page('What is coming', [
      ...flow([
        sectionHeading({ eyebrow: 'Ahead', heading: 'What to watch' }),
        table({
          headers: ['Date', 'Event', 'Category', 'Impact'],
          rows: Array.from({ length: ROWS.upcoming }, (_, i) => eventRow('upcoming', i)),
          columnWidths: cols(78, c.contentWidth - 256, 100, 78),
          numeric: [],
          wraps: { chars: LENGTHS.eventName, columnWidth: c.contentWidth - 256 },
        }),
      ], contentTop()),
    ]), FOOTER),
    conditional: 'marketIntel && marketIntel.upcoming',
  });

  // ── What each event meant ────────────────────────────────────────────────
  //
  // The sidenotes the legacy sets under its timeline, labelled with the event
  // rather than only its date — every one of the stored report's twelve events
  // carries a description, and none of them reached a page. Two pages of four,
  // each drawn only as deep as the record.
  const eventNoteRows = (from: number, count: number) =>
    Array.from({ length: count }, (_, i) => ({
      term: `{{marketIntel.eventNotes.${from + i}.label}}`,
      definition: `{{marketIntel.eventNotes.${from + i}.description}}`,
    }));
  pages.push({
    ...withFurniture(page('What each meant', [
      ...flow(ifItFits([
        sectionHeading({ eyebrow: 'Dated', heading: 'What each event meant' }),
        (() => oneOf(
          { when: 'marketIntel && marketIntel.eventNotes && marketIntel.eventNotes.length <= 2', item: definitions('The events, in brief', eventNoteRows(0, 2), LENGTHS.eventNote) },
          { when: 'marketIntel && marketIntel.eventNotes && marketIntel.eventNotes.length > 2', item: definitions('The events, in brief', eventNoteRows(0, 4), LENGTHS.eventNote) },
        ))(),
      ], [
        {
          ...callout('Not every event is described', '{{marketIntel.eventNotesOmitted}}'),
          conditional: 'marketIntel && marketIntel.eventNotesOmitted',
        },
      ], contentTop()), contentTop()),
    ]), FOOTER),
    conditional: 'marketIntel && marketIntel.eventNotes',
  });
  pages.push({
    ...withFurniture(page('What each meant (2)', [
      ...flow([
        (() => oneOf(
          { when: 'marketIntel && marketIntel.eventNotes && marketIntel.eventNotes.length <= 6', item: definitions('The events, continued', eventNoteRows(4, 2), LENGTHS.eventNote) },
          { when: 'marketIntel && marketIntel.eventNotes && marketIntel.eventNotes.length > 6', item: definitions('The events, continued', eventNoteRows(4, 4), LENGTHS.eventNote) },
        ))(),
      ], contentTop()),
    ]), FOOTER),
    conditional: 'marketIntel && marketIntel.eventNotes && marketIntel.eventNotes[4]',
  });

  // ── The correlation view ─────────────────────────────────────────────────
  //
  // Persisted by the generator since this migration and absent on every earlier
  // row — so these pages light up as new correlation reports land, exactly as
  // the Report Q&A citations page does. Both bodies are model Markdown and get
  // the paged treatment everything of unknown length here gets.
  const corrFirst = c.contentBottom - contentTop() - c.spacing.headingGap - 104;
  const corrCont = c.contentBottom - contentTop() - 12;
  for (const [key, pagesKey, name, heading] of [
    ['analysis', 'analysisPages', 'Correlation highlights', 'Correlation highlights'],
    ['research', 'researchPages', 'Correlation research', 'What the research found'],
  ] as const) {
    const has = `marketIntel && marketIntel.correlation && marketIntel.correlation.${key}`;
    const source = `{{marketIntel.correlation.${key}}}`;
    pages.push({
      ...withFurniture(page(name, [
        ...flow([
          sectionHeading({ eyebrow: 'Correlation', heading }),
          markdown(source, 0, corrFirst, MARKDOWN_LINES_PER_PAGE),
        ], contentTop()),
      ]), FOOTER),
      conditional: has,
    });
    for (let p = 1; p < 3; p += 1) {
      pages.push({
        ...withFurniture(page(`${name} (${p + 1})`, [
          ...flow([
            markdown(source, p, corrCont, MARKDOWN_LINES_PER_PAGE),
          ], contentTop()),
        ]), FOOTER),
        conditional: `${has} && marketIntel.correlation.${pagesKey} > ${p}`,
      });
    }
  }

  // The strategy is the other long one — 4,315 characters — so it is paged
  // rather than tucked under the calendar table.
  pages.push(...prosePages({
    key: 'strategy',
    name: 'What to do',
    eyebrow: 'Ahead',
    heading: 'Where this points',
    c,
  }));

  // ── The next step ────────────────────────────────────────────────────────
  //
  // The audience panels the segment decides — the legacy's closing callouts on
  // the suburb layer — and the brand's own close, its two boxes with the brand
  // name bound from the letterhead. Neither is `prose.ctaContent`, which stays
  // deliberately unbound: that is the model's copy for the email this PDF was
  // attached to, and it stays out of the document.
  pages.push({
    ...withFurniture(page('The next step', [
      ...flow(ifItFits([
        sectionHeading({ eyebrow: 'For you', heading: 'The next step' }),
        {
          ...callout(
            '{{marketIntel.audiencePanels.0.title}}',
            '{{marketIntel.audiencePanels.0.body}}',
            textHeight(LENGTHS.audiencePanel, { size: c.scale.cell, extra: 34 }),
          ),
          conditional: 'marketIntel && marketIntel.audiencePanels && marketIntel.audiencePanels[0]',
        },
        {
          ...callout(
            '{{marketIntel.audiencePanels.1.title}}',
            '{{marketIntel.audiencePanels.1.body}}',
            textHeight(LENGTHS.audiencePanel, { size: c.scale.cell, extra: 34 }),
          ),
          conditional: 'marketIntel && marketIntel.audiencePanels && marketIntel.audiencePanels[1]',
        },
      ], [
        // The brand's close, as the legacy prints it — with the name bound
        // from the letterhead rather than written into fifty masters.
        callout(
          'Why {{org.name}}?',
          '{{org.name}} is a strategic property advisory that delivers data-driven, '
          + 'insight-led guidance — enabling clients to act on opportunities others do not see.',
          textHeight(200, { size: c.scale.cell, extra: 34 }),
        ),
        callout(
          'Ready to take the next step?',
          'Contact {{org.name}} to discuss your personalised property strategy.',
        ),
      ], contentTop()), contentTop()),
    ]), FOOTER),
    conditional: 'marketIntel && marketIntel.audiencePanels',
  });

  // ── Sources ──────────────────────────────────────────────────────────────
  pages.push({
    ...withFurniture(page('What it read', [
      ...flow([
        sectionHeading({ eyebrow: 'Grounding', heading: 'Sources' }),
        table({
          headers: ['Source'],
          rows: Array.from({ length: ROWS.citations }, (_, i) => [
            `{{marketIntel.citations.${i}.name}}`,
          ]),
          columnWidths: cols(c.contentWidth),
          numeric: [],
        }),
        {
          ...callout('Further sources', '{{marketIntel.citationsOmitted}}'),
          conditional: 'marketIntel && marketIntel.citationsOmitted',
        },
        {
          ...callout('What the budget did not show', '{{marketIntel.truncationNote}}'),
          conditional: 'marketIntel && marketIntel.truncationNote',
        },
      ], contentTop()),
    ]), FOOTER),
    conditional: 'marketIntel && marketIntel.citations',
  });

  pages.push(disclaimerPage(STANDARD_DISCLAIMER));

  return assembleMaster({
    family, variant, manifest, c, pages, format: MARKET_INTELLIGENCE_FORMAT,
  });
}

/** Every Market Intelligence master, by family, in catalogue order. */
export const MARKET_INTELLIGENCE_TEMPLATES: CompassSeedTemplate[] = DESIGN_FAMILIES.flatMap(
  (family) => family.variants.map((variant) => buildTemplate(family, variant)),
);

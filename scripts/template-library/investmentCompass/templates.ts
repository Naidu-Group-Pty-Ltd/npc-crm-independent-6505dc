/**
 * The fifty approved Investment Compass masters.
 *
 * ## One composition, fifty manifests
 *
 * The approved catalogue marks archetype coverage `BUILT` for each family's
 * reference and `MANIFEST` for the other four, and says so in as many words:
 * "This is the family reference. The other four variants are expressed as
 * overrides on it." So there is one composition here, parameterised by the
 * resolved manifest, rather than fifty hand-drawn documents.
 *
 * That is not a shortcut — it is the property the catalogue is built on. An
 * eleventh family is a declaration in `source.json`; a sixth variant is an
 * override object; and a change to how a section opener is drawn reaches all
 * fifty at once. What makes the fifty *different* is the manifest: 31 KPI
 * layouts, 30 chart styles, 29 cover overlays, 27 section headers and 26 table
 * treatments, each resolved to a primitive by `resolvers.ts`.
 *
 * ## The seven archetypes
 *
 * Every master covers `ARCHETYPES` in order: Cover, Executive dashboard,
 * Narrative, Dense data, Chart and scenario, Risk and recommendation, Sources
 * and appendix. A spacious template spends more pages on the same material —
 * that is what `density: spacious` means — so page count varies by variant
 * while archetype coverage does not.
 *
 * ## Bindings
 *
 * Every value a report supplies is a `{{binding}}` against the production
 * Investment Report namespaces. Risk ratings are literal, following the
 * convention the existing catalogue already sets: the investment adapter emits
 * no rating field, and binding one would print an empty column on every real
 * report.
 */
import {
  DESIGN_FAMILIES,
  axisFor,
  resolveManifest,
  useBucketFor,
  type DesignFamily,
  type TemplateManifest,
  type VariantDefinition,
} from './family';
import {
  callout,
  companionNote,
  contents,
  contentTop,
  cover,
  coverHero,
  definitions,
  disclaimerPage,
  flow,
  furniture,
  ifItFits,
  kpiCapacity,
  kpis,
  markdown,
  remainingAfter,
  MARKDOWN_LINES_PER_PAGE,
  page,
  platePage,
  prose,
  recommendation,
  risks,
  rule,
  scenarioChart,
  sectionHeading,
  oneOf,
  strengthsWatch,
  textHeight,
  table,
  verdict,
  withFurniture,
  beginCompassTemplate,
  type PageDef,
  type TableRowDef,
} from './blocks';
import { hasContents, imageSlotPlan, kpiPlan, type ImagePlate } from './resolvers';
import {
  assembleMaster,
  type CompassSeedTemplate,
  type ReportFormat,
} from './master';
import { VERDICT_HEADLINE_CHARS } from './verdictVocabulary';
import { STANDARD_DISCLAIMER } from '../designSystem';

/** Investment Compass: the format the ten families were drawn for. */
const INVESTMENT_COMPASS_FORMAT: ReportFormat = {
  key: 'investment-compass',
  // Normalised by the adapter registry to the production investment adapter,
  // which is what makes these templates report-ready rather than preview-only.
  reportType: 'investment_compass',
  category: 'investment',
  tier: 'compass',
  label: 'Investment Compass',
};

/** The running foot on every content page. */
/**
 * The running foot.
 *
 * Not `{{client.name}}`: `investment_reports` has no client-name column and
 * `client_property_id` is set on 2 of the 1,182 reports, so every page of every
 * Compass document was footed "<address> · " with a dangling separator. An
 * unresolved binding renders as the empty string, never as a visible `{{…}}`.
 */
const FOOTER = '{{property.address}} · {{report.documentTitle}}';

/**
 * The longest each bound field runs across the 1,182 stored reports.
 *
 * Measured, because a declared height that is too small does not overflow the
 * page — it lays one block over the next, invisibly to `flow()`'s arithmetic
 * guard. See `textHeight` in `blocks.ts`.
 */
/**
 * `breakdown.<dimension>.details`, per dimension, across the 985 scored reports.
 *
 * Sized individually rather than at the worst case. Reserving risk's 228 for
 * all three ran the assessment page 4pt past the footer on Luxury Editorial's
 * third variant — which the seed builder refused to write, exactly as it
 * should: `location` is 94 at its longest and `yield` is 51, and two thirds of
 * that reservation was for prose those dimensions never write.
 */
const DETAIL_CHARS = { location: 94, yield: 51, risk: 228 } as const;

/**
 * The longest companion note any tier publishes.
 *
 * Measured over `TIER_CONTENT` rather than estimated, because the set is closed
 * and small: compass 140, financial 140, briefing 110, snapshot 104, strategic
 * 85, composite none. `sectionHeading` refuses a bound standfirst without a
 * measured length, and for good reason — it reserves the depth the sentence
 * needs at the size and measure each of the six header kinds sets it in, and a
 * heading that under-declares does not overflow the page, it prints over the
 * contents list beneath it.
 *
 * `companionNoteChars.spec.ts` re-reads `TIER_CONTENT` and fails if a tier's
 * sentence is ever rewritten longer than this.
 */
export const COMPANION_NOTE_CHARS = 140;

/** The left half of the running head. */
const DOCUMENT_LABEL = '{{report.documentTitle}} · {{property.address}}';

/**
 * The property specification, one guarded row at a time.
 *
 * ## A label is a promise that a figure follows it
 *
 * This table was eight fixed rows, and on the report behind this change —
 * `1be16c4a`, 93 Bimbadeen Avenue, 15 Aug 2026 — six of them printed as a
 * ruled, striped, labelled row with nothing in the Detail column. That is not
 * that record's misfortune. Counted across the whole `investment_reports`
 * table on 2026-08-16, after `projectInvestmentReport` was taught the finance
 * run's spellings:
 *
 * | row | resolves on | of 1,187 |
 * | --- | ---: | --- |
 * | Address | 1,187 | `property_address`, never null |
 * | Property type | 1,059 | + 34 more from `propertySpecs.propertyType` |
 * | Configuration | 656 | bedrooms 651, bathrooms 633, parking 34 |
 * | Land area | 114 | `propertySpecs.landSizeSqm`; `land_size_sqm` is null on **every** row |
 * | Building area | 114 | `propertySpecs.buildSizeSqm` — note the spelling |
 * | Year built | **0** | the key exists on 1,059 rows and holds null on all of them |
 * | Zoning | **0** | as above |
 * | Council | **0** | as above |
 *
 * So three of the eight could not print on any report ever generated, and two
 * more printed on one report in ten. The rows stay in the master rather than
 * being deleted: the columns exist, an intake that starts filling them fills
 * this page with no template change, and the guard costs a boolean.
 *
 * The unit belongs to the row and not to the projection — `landArea` is a
 * number so that a KPI or a chart can use it — and it is safe to write beside
 * the binding only because the row no longer prints without a value. An
 * unresolved binding renders as the empty string, so a fixed row would have
 * printed a bare " m²".
 */
const PROPERTY_ROWS: Array<{ key: string; row: { cells: string[]; when: string } }> = [
  { key: 'address', row: { cells: ['Address', '{{property.address}}'], when: 'property && property.address' } },
  { key: 'type', row: { cells: ['Property type', '{{property.type}}'], when: 'property && property.type' } },
  { key: 'configuration', row: { cells: ['Configuration', '{{property.configuration}}'], when: 'property && property.configuration' } },
  { key: 'landArea', row: { cells: ['Land area', '{{property.landArea | number}} m²'], when: 'property && property.landArea' } },
  { key: 'yearBuilt', row: { cells: ['Year built', '{{property.yearBuilt}}'], when: 'property && property.yearBuilt' } },
  { key: 'zoning', row: { cells: ['Zoning', '{{property.zoning}}'], when: 'property && property.zoning' } },
  // Was `property.tenancy` and `property.condition`: neither is a key
  // `property_specs` has ever carried, on any of the 1,187 rows.
  { key: 'council', row: { cells: ['Council', '{{property.council}}'], when: 'property && property.council' } },
  { key: 'buildingArea', row: { cells: ['Building area', '{{property.buildingArea | number}} m²'], when: 'property && property.buildingArea' } },
];

/**
 * Compile one master.
 *
 * The density and layout branches are the catalogue's own meaning made
 * structural: a spacious template does not shrink its type to fit more on a
 * page, it uses another page. `flow()` records anything that still runs past
 * the footer and the seed build refuses to write a migration while that log is
 * non-empty.
 */
function buildTemplate(family: DesignFamily, variant: VariantDefinition): CompassSeedTemplate {
  const manifest = resolveManifest(family, variant);
  const c = beginCompassTemplate(family, variant, manifest);
  const spacious = manifest.density === 'spacious';

  /**
   * Does the KPI arrangement run down the page rather than across it?
   *
   * `rows` and `stacked` set one figure per row, so they consume roughly four
   * times the height of a ruled band, and a `display` grid is taller again. On
   * those variants the dashboard has room for the verdict, the figures and the
   * callout and nothing else — so the property snapshot takes its own page.
   * Trying to fit all four is what the overflow guard caught at 62pt past the
   * footer on Bullion Rail.
   */
  const plan = kpiPlan(manifest.kpi_layout);
  const tallKpis = plan.variant === 'rows' || plan.variant === 'stacked'
    || plan.variant === 'display' || plan.items > 6;
  const splitSnapshot = spacious || tallKpis;

  /**
   * Sequential part numbers.
   *
   * A counter rather than a ternary per page. The fifty masters spend different
   * numbers of pages on the same seven archetypes, and hand-computing them at
   * every call site is how a report ends up with two Part 04s — which a reader
   * notices immediately and cannot unsee.
   */
  let partNo = 0;
  const nextPart = (label: string): string =>
    `Part ${String((partNo += 1)).padStart(2, '0')} · ${label}`;
  const nextNumeral = (): string => String(partNo).padStart(2, '0');

  /**
   * The briefed image plates this template declares.
   *
   * Only the two photographic families carry `image_slots`; for every other
   * family this is empty and nothing below emits a thing.
   */
  const slots = imageSlotPlan(manifest.image_slots);
  // Each plate binds a distinct `property.images[n]`, so an operator filling
  // one does not fill them all.
  const plateIndex = new Map<string, number>(
    slots.plates.map((p, i) => [p.id, i]),
  );
  /**
   * The plates that follow a given content page, as pages of their own.
   *
   * Every plate is a page. Inline plates were tried first and cost eight of the
   * ten plated variants their page — "Investment thesis" ran 123pt past the
   * content bottom on `le-03` — because these pages are already full and a slot
   * reserves its height whether or not anything fills it. `platePage` carries
   * the full reasoning.
   */
  let plateNo = 0;
  const platesFor = (placement: ImagePlate['placement']): PageDef[] =>
    slots.plates
      .filter((p) => p.placement === placement)
      .map((p) => {
        plateNo += 1;
        return platePage({
          index: plateIndex.get(p.id)!,
          brief: p.brief,
          // A page name has to distinguish one plate from the next: it is what
          // the reader's page list shows and what the overflow log names.
          name: p.caption ?? `Plate ${String(plateNo).padStart(2, '0')}`,
          caption: p.caption,
          bleed: slots.bleed,
        });
      });

  const pages: PageDef[] = [];

  // ── 01 Cover ─────────────────────────────────────────────────────────────
  pages.push(cover({
    wordmarkTop: '{{org.name}}',
    // The document's NAME, not the format family's: these masters serve the
    // compass, financial, snapshot, briefing and strategic tiers, and the
    // projection translates the tier into `report.documentTitle` /
    // `report.standfirst` in one place (`DOCUMENT_IDENTITY`). Spelled as a
    // literal, every Financial Analysis rendered as an "Investment Compass"
    // on its cover and on every running head and foot.
    wordmarkBottom: '{{report.documentTitle}}',
    tagline: 'Your dedicated property partner',
    marker: '{{report.documentTitle}}',
    eyebrow: '{{report.documentTitle}}',
    title: '{{property.address}}',
    // Was `{{summary.narrative}}`, `{{property.suburb}}`, `{{market.postcode}}`
    // and `{{market.state}}` — none of which any adapter publishes, and none of
    // which has a column to publish from. `location_intelligence` carries
    // amenities, commute, schools and transport; there is no postcode, no state
    // and no market prose anywhere in the row. So the cover said nothing under
    // the address, on every report.
    standfirst: '{{report.standfirst}}',
    locations: 'Prepared {{report.generatedDate | date}}',
    facts: [
      // The action, not the sentence. A KPI cell is a quarter of the measure
      // and `investment_score.recommendation` averages 69 characters: rendered
      // through WeasyPrint the cover's VERDICT cell set five lines and its last
      // one was struck through by the band's bottom rule. The whole sentence is
      // on the verdict page, where there is a measure to set it in. See
      // `recommendationAction` for why the split is exact rather than a guess.
      { label: 'Verdict', value: '{{recommendation.action}}' },
      { label: 'Grade', value: '{{recommendation.grade}}' },
      { label: 'Score', value: '{{recommendation.score | fixed:0}}', },
      { label: 'Weekly position', value: '{{financials.weeklyNet | currency}}' },
    ],
  }));

  // A photographic cover is the plate BEHIND the cover composition, so the
  // wordmark, title and fact band paint over it. Absent, the cover falls back
  // to its field colour — which is exactly the typographic cover the
  // `three_interior` and `none` variants use, so the two are one composition.
  if (slots.coverHero) {
    const hero = slots.plates.find((p) => p.placement === 'cover');
    if (hero) {
      const cv = pages[0];
      pages[0] = {
        ...cv,
        blocks: [...coverHero(plateIndex.get(hero.id)!, hero.brief), ...cv.blocks],
      };
    }
  }

  // ── Contents, where the family declares one ──────────────────────────────
  if (hasContents(manifest.toc_style)) {
    pages.push(withFurniture(page('Contents', [
      ...furniture(DOCUMENT_LABEL, nextPart('Contents'), 'Contents'),
      ...flow([
        sectionHeading({ eyebrow: 'In this report', heading: 'Contents', numeral: nextNumeral() }),
        /*
         * Where the rest of the analysis is, above the list rather than below
         * it.
         *
         * This is the one page where a reader looks for a section and does not
         * find it. Seed v14 made the three financial pages conditional on
         * `report.drawsFinancialModelling` and the contents block draws the
         * pages that actually rendered — so a Compass's contents correctly stop
         * listing "Financial position" and "Ten-year projection", and nothing
         * then said where they had gone.
         *
         * Above the list, because `contents()`'s row count is a size HINT with
         * eight rows of slack for the gap between section names and page count:
         * a document whose real list outruns the hint draws down into the white
         * space beneath it, and that space has to stay empty. Measured over the
         * fifty masters, the room below the contents block runs from 122pt
         * (Luxury Editorial's third variant) to 301pt.
         *
         * `put()` drops an absent value, so `composite` — the one tier that
         * publishes no companion note — binds nothing, and the conditional
         * stops the block being drawn at all rather than drawing an empty one.
         */
        {
          ...companionNote('{{report.companionNote}}', COMPANION_NOTE_CHARS),
          conditional: 'report && report.companionNote',
        },
        contents([
          'The verdict and the numbers that carry it',
          'The property',
          'Investment thesis',
          'Financial position',
          'Ten-year projection',
          'Risk and recommendation',
          'Sources and methodology',
        ]),
      ], contentTop()),
    ]), FOOTER));
  }

  // ── 02 Executive dashboard ───────────────────────────────────────────────
  const allKpis = [
    { label: 'Purchase price', value: '{{financials.purchasePrice | currency}}', note: 'Contract, before costs' },
    { label: 'Weekly rent', value: '{{financials.weeklyRent | currency}}', note: '{{financials.annualRent | currency}} p.a.' },
    { label: 'Gross yield', value: '{{financials.grossYield | percent}}', note: 'On the purchase price' },
    { label: 'Weekly position', value: '{{financials.weeklyNet | currency}}', note: '{{financials.annualNet | currency}} p.a., before tax' },
    { label: 'Loan amount', value: '{{financials.loanAmount | currency}}', note: 'At settlement' },
    { label: 'Cash on cash', value: '{{financials.cashOnCash | percent}}', note: 'Year one' },
    { label: 'Total cost', value: '{{financials.totalCost | currency}}', note: 'Including acquisition costs' },
    { label: 'Annual repayment', value: '{{financials.annualRepayment | currency}}', note: 'P&I, modelled rate' },
    // Was `financials.breakEvenRent`, which no column supplies and no
    // derivation can honestly reach. `netYield` is stored on every scored
    // report and is the figure a reader wants beside the gross.
    { label: 'Net yield', value: '{{financials.netYield | percent}}', note: 'After holding costs' },
    { label: 'Capital growth', value: '{{assumptions.capitalGrowth | percent}}', note: 'Base case, per annum' },
    { label: 'Interest rate', value: '{{assumptions.interestRate | percent}}', note: 'Modelled' },
    { label: 'Vacancy', value: '{{assumptions.vacancy | percent}}', note: 'Allowance' },
  ];
  // The arrangement decides how many figures it wants — four for a ruled band,
  // twelve for a console, five for a position strip. Supplying more than it
  // asks for would silently drop them.
  const dashboardKpis = allKpis.slice(0, kpiCapacity());

  pages.push(withFurniture(page('Executive dashboard', [
    ...furniture(DOCUMENT_LABEL, nextPart('Verdict'), 'Verdict and dashboard'),
    ...flow([
      verdict({
        eyebrow: 'The verdict',
        heading: '{{recommendation.headline}}',
        // `investment_score` holds ONE recommendation string and no rationale
        // beside it, so this used to be blank under a heading that promised an
        // explanation. The sentence is COMPOSED by the projection
        // (`recommendation.gradedLine`) rather than interpolated here, for two
        // measured reasons: a row with no score used to print "Graded  at
        // out of 100" with the holes left in (every Strategic fork ever
        // produced), and the hardcoded weighting clause misstated variant
        // scores, whose dimensions are not the composite five. Absent score →
        // absent binding → no sentence, never a broken one.
        body: '{{recommendation.gradedLine}}',
        // The heading is a binding, so it is sized from what it can RESOLVE to
        // rather than from its own 27 characters. See `verdictVocabulary.ts`:
        // the vocabulary is closed, so this is exact rather than estimated.
        headingChars: VERDICT_HEADLINE_CHARS,
      }),
      kpis(dashboardKpis),
      ...(splitSnapshot ? [] : [
        table({
          headers: ['Property', 'Detail'],
          // Every row is guarded. See `PROPERTY_ROWS` for what each one costs
          // when it is not — this page printed four ruled, labelled, empty rows
          // on the report behind this change.
          rows: PROPERTY_ROWS.filter((r) => r.key !== 'address' && r.key !== 'yearBuilt' && r.key !== 'buildingArea')
            .map((r) => r.row)
            .concat([
              { cells: ['Loan amount', '{{financials.loanAmount | currency}}'], when: 'financials && financials.loanAmount' },
              { cells: ['Annual repayment', '{{financials.annualRepayment | currency}}'], when: 'financials && financials.annualRepayment' },
            ]),
          columnWidths: [0.42, 0.58],
          numeric: [],
        }),
        // One each, not two.
        //
        // Across the 985 scored reports `investment_score.strengths` holds at
        // least one on 745 and at least two on **47**; `weaknesses` holds one on
        // 874 and two on **15**. A second row therefore printed a marker with
        // nothing beside it on 95% and 98% of reports respectively.
        strengthsWatch(['{{summary.strength.0}}'], ['{{summary.watch.0}}']),
      ]),
      // No closing callout. It bound `financials.narrative`, which nothing
      // publishes and no column holds, so it printed a titled panel with an
      // empty body on every report.
    ], contentTop()),
  ]), FOOTER));

  if (splitSnapshot) {
    pages.push(withFurniture(page('The property', [
      ...furniture(DOCUMENT_LABEL, nextPart('The property'), 'The property'),
      ...flow([
        sectionHeading({
          eyebrow: 'The asset',
          heading: 'What is being bought',
          numeral: nextNumeral(),
          // No standfirst: `property.rationale` has no column and no producer.
        }),
        table({
          headers: ['Property', 'Detail'],
          rows: PROPERTY_ROWS.map((r) => r.row),
          columnWidths: [0.34, 0.66],
          numeric: [],
        }),
        // One each, not two.
        //
        // Across the 985 scored reports `investment_score.strengths` holds at
        // least one on 745 and at least two on **47**; `weaknesses` holds one on
        // 874 and two on **15**. A second row therefore printed a marker with
        // nothing beside it on 95% and 98% of reports respectively.
        strengthsWatch(['{{summary.strength.0}}'], ['{{summary.watch.0}}']),
      ], contentTop()),
    ]), FOOTER));
  }

  // Outside the `splitSnapshot` branch on purpose: not every variant gives the
  // property its own page, and a plate that exists only when it does would be
  // dropped from four of the ten plated masters without anything saying so.
  pages.push(...platesFor('property'));

  // ── 03 The assessment ────────────────────────────────────────────────────
  //
  // This page used to be four bound paragraphs — `market.conclusion.headline`,
  // `market.narrative`, `market.conclusion.body` and `property.rationale` — and
  // **not one of them had a source**. No adapter published `market`, and
  // `location_intelligence` carries amenities, commute, schools and transport
  // rather than prose. So the Investment Compass's central narrative page
  // rendered as white paper under a blank heading on every report ever produced.
  //
  // What the record does hold is `investment_score.breakdown`: five weighted
  // dimensions, each with a score and a `details` sentence. That is the
  // reasoning behind the grade, and it is what this page now shows.
  //
  // Three of the five carry prose and two do not. Measured across the 985
  // scored reports: `riskScore.details` on all 985 (228 characters at its
  // longest), `yieldScore` on all 985 (51), `locationScore` on 965 (94) — while
  // `growthScore` and `demandScore` are scored a flat 50 with no details on 919
  // of the 985, which is why they appear in the scorecard and not in the
  // reasoning beneath it.
  pages.push(withFurniture(page('The assessment', [
    ...furniture(DOCUMENT_LABEL, nextPart('Assessment'), 'The assessment'),
    ...flow(ifItFits([
      sectionHeading({
        eyebrow: 'How the grade was reached',
        // Was "Five dimensions, weighted", over a table of THREE rows on
        // 9 Hollow Street and FOUR on 1 Crestview Avenue and 97 Poole Road
        // (20 Sep 2026). The projection publishes nothing bindable for a
        // dimension the engine did not score — an absence is omitted, never
        // worded — so the row count is the count of what was measured, and a
        // heading that promises five contradicts the table under it on every
        // report that could not score one. This one is true at three, four
        // or five.
        heading: 'Weighted across what was measured',
        numeral: nextNumeral(),
        // Was "A dimension the assessment had no data for is scored at the
        // midpoint", which described the placeholder rather than the report.
        // The engine withholds such a dimension and the table now says so, so
        // the sentence would contradict the page under it.
        //
        // The share is explained because the column is an ADJUSTED weight and
        // the page has no room for the nominal one beside it: the method's
        // five weights, re-spread across the dimensions the evidence could
        // measure, so a reader meeting "5%" against Demand can tell it from
        // the 15% the published method gives that dimension. The full
        // original-versus-adjusted table is in "How this grade was reached".
        standfirst: 'Each dimension is scored out of 100. Its share is how much of the grade it '
          + 'carried. A dimension with no data is left unscored.',
      }),
      table({
        // "Weight" read as the published methodology weight. It is the
        // ADJUSTED share, and naming it as one is the difference between a
        // reader checking the arithmetic and a reader mistrusting it.
        headers: ['Dimension', 'Score', 'Share of grade'],
        // `scoreLabel` / `weightLabel`, not `score` / `weight`. The engine
        // leaves a placeholder 50 and a 0 weight in an excluded dimension, so
        // binding the figures printed "Growth 50 0%" — a score the assessment
        // never gave, next to a weight saying it counted for nothing. The
        // projection composes the words; see `assessment` in
        // `reportBindingProjection.pure.ts` for the counts.
        rows: [0, 1, 2, 3, 4].map((i) => [
          `{{assessment.${i}.label}}`,
          `{{assessment.${i}.scoreLabel}}`,
          `{{assessment.${i}.weightLabel}}`,
        ]),
        columnWidths: [0.5, 0.25, 0.25],
        numeric: [1, 2],
      }),
      // Location, yield and risk — the three that say something. Each is
      // conditional on its own `details`, because a dimension with a score and
      // no prose must not print a term with nothing beside it.
      //
      // One heading, not three. Each of these is its own block, and every one
      // of them was titled "Why", so a report carrying all three printed the
      // word three times down the page with one row under each. The first
      // block that renders carries the heading; the rest are headless
      // continuations of the same list, which is what they read as.
      ...[
        { i: 1, term: 'Location', chars: DETAIL_CHARS.location },
        { i: 2, term: 'Yield', chars: DETAIL_CHARS.yield },
        { i: 4, term: 'Risk', chars: DETAIL_CHARS.risk },
      ].map(({ i, term, chars }, n) => {
        const has = (j: number) => `assessment && assessment[${j}] && assessment[${j}].details`;
        const earlier = [1, 2, 4].slice(0, n);
        const row = [{ term, definition: `{{assessment.${i}.details}}` }];
        // The first block in the group carries the heading unconditionally;
        // there is nothing above it to have carried one.
        if (n === 0) return { ...definitions('Why', row, chars), conditional: has(i) };
        // For the rest: two mutually exclusive variants at the SAME position —
        // `oneOf`, not two flow items, or the page reserves height for both.
        // Headed when nothing above rendered, headless when something did.
        const somethingAbove = earlier.map((j) => `(${has(j)})`).join(' || ');
        return oneOf(
          { when: `${has(i)} && !(${somethingAbove})`, item: definitions('Why', row, chars) },
          { when: `${has(i)} && (${somethingAbove})`, item: definitions('', row, chars) },
        );
      }),
    ], [
      // Opportunities are an array on the scored reports and empty on most of
      // them, so this is drawn only where the variant has room AND the record
      // has one.
      /*
       * A callout, not a definition list, because there is no term.
       *
       * This was `definitions('Opportunities', [{ term: 'Noted', definition:
       * '{{opportunities.0}}' }])`. Every sibling definition list on this page
       * carries a real term naming what the row is about — `Location`,
       * `Yield`, `Risk` — and the record gives an opportunity as one
       * unlabelled string, so any term in that slot is invented. `Noted` is a
       * placeholder occupying a label slot, which is `propertyTypeLabel`'s
       * rule read from the other end.
       *
       * The heading already said "Opportunities", so the 160pt term column
       * was carrying a word that repeated nothing and meant nothing. A
       * callout is the container the page already uses for one unqualified
       * statement (see "No risk recorded" below) and it is height-neutral
       * here: the definition list declared 30 + one ~45pt row against the
       * callout's 72.
       *
       * Only `opportunities.0` is drawn, and that is deliberate for the same
       * measured reason `strengthsWatch` draws one each: a second row prints a
       * marker with nothing beside it on the overwhelming majority of records.
       */
      {
        ...callout('Opportunity', '{{opportunities.0}}'),
        conditional: 'opportunities && opportunities[0]',
      },
    ], contentTop()), contentTop()),
  ]), FOOTER));
  pages.push(...platesFor('thesis'));

  /**
   * The financial modelling pages, and the tiers that may carry them.
   *
   * One master serves five document kinds, so the acquisition table, the cash
   * flow and the ten-year equity chart were drawn on all five: the Investment
   * Compass — a Location & Property Fit report whose own section registry says
   * "ALL detailed financial modelling ... MUST NOT appear here" — opened on
   * purchase price, gross yield, LVR and a ten-year projection, and the
   * Financial Analysis carried the location case. Each report answered the
   * other's question.
   *
   * `report.drawsFinancialModelling` is published by
   * `reportBindingProjection` from `tierContent.pure.ts`, the one module that
   * decides what a tier contains. It is a PAGE conditional rather than a set of
   * row guards because the projection also withholds the bindings: a page kept
   * with nothing to bind would print labelled empty rows, which is worse than
   * the page a reader never sees. `visiblePages` filters before layout, so a
   * dropped page costs nothing and the narrative pages behind it move up.
   *
   * The KPI band needs no guard: `renderKpiGridHtml` already drops a tile whose
   * bound value resolved to nothing and draws nothing when none survive, so the
   * dashboard closes up around the figures the tier does publish.
   */
  const FINANCIAL_TIERS = 'report && report.drawsFinancialModelling';

  // ── 04 Dense data ────────────────────────────────────────────────────────
  /**
   * What the purchase costs, and what of it is cash.
   *
   * ## "Total acquisition cost / Sum of the above" was two false claims
   *
   * The figure is `initialCosts.totalUpfront` — $340,287 on the report behind
   * this change — printed under rows that add to $1,460,587, because the
   * purchase price is in the same column and is not a cash cost. A reader
   * checking the arithmetic finds it wrong by a factor of four, and the one
   * they are most likely to act on is the one at the bottom in bold.
   *
   * It is not the sum of anything, either. Measured over the 167 stored runs
   * that carry the block, `totalUpfront` equals deposit + duty + legal +
   * inspection + LMI on **29** of them; the average gap is $454 and the largest
   * is $93,000. So no basis of the form "sum of …" is true of this figure, and
   * `totals: [last]` — a doubled rule, which is the accounting convention for
   * "the numbers above add up to this" — was itself the claim.
   *
   * Three changes, all of them removing an assertion rather than adding one:
   * the row says what the figure is (`Total upfront cash`), the basis says
   * where it comes from rather than how it was reached, and the doubled rule is
   * gone. The deposit is shown because it is the largest part of that cash and
   * the projection publishes it (`initialCosts.deposit`) — its absence is what
   * made the total look unrelated to the page.
   */
  const acquisitionRows: TableRowDef[] = [
    ['Purchase price', '{{financials.purchasePrice | currency}}', 'Contract'],
    { cells: ['Deposit', '{{financials.deposit | currency}}', 'Cash at exchange'], when: 'financials && financials.deposit' },
    ['Stamp duty', '{{financials.stampDuty | currency}}', 'State schedule'],
    ['Legal and conveyancing', '{{financials.legalFees | currency}}', 'Estimate'],
    ['Building and pest', '{{financials.inspectionFees | currency}}', 'Estimate'],
    // `financials.loanFees` has no column and no producer; the row printed a
    // label, a blank and "Lender schedule" on every report.
    ['LVR at settlement', '{{financials.lvr | percent:0}}', 'Loan over price'],
    ['Total upfront cash', '{{financials.totalCost | currency}}', 'Cash required at settlement'],
  ];
  /**
   * The cash flow table foots, and every line it subtracts is on it.
   *
   * The engine holds EIGHT annual cost components and this table printed four
   * of them, so on 262 Pallas Street the rows came to $10,780 against a net
   * position built on $12,880 and the reader was $2,100 short with nowhere
   * to look. The projection now folds water rates into the row whose label
   * already claims them and letting fees into management, and publishes land
   * tax and strata as `annualOtherCosts` — a row that draws only where they
   * come to something, because both are nil on an ordinary house and a line
   * of $0 is one the reader has to discount rather than read.
   */
  const cashflowRows: TableRowDef[] = [
    ['Rental income', '{{financials.weeklyRent | currency}}', '{{financials.annualRent | currency}}'],
    {
      cells: ['Vacancy allowance', '{{financials.weeklyVacancyAllowance | currency}}', '{{financials.annualVacancyAllowance | currency}}'],
      when: 'financials && financials.annualVacancyAllowance',
    },
    ['Loan repayments', '{{financials.weeklyRepayment | currency}}', '{{financials.annualRepayment | currency}}'],
    ['Council and water rates', '{{financials.weeklyRates | currency}}', '{{financials.annualRates | currency}}'],
    ['Insurance', '{{financials.weeklyInsurance | currency}}', '{{financials.annualInsurance | currency}}'],
    ['Management', '{{financials.weeklyManagement | currency}}', '{{financials.annualManagement | currency}}'],
    ['Maintenance', '{{financials.weeklyMaintenance | currency}}', '{{financials.annualMaintenance | currency}}'],
    {
      cells: ['Land tax and strata', '{{financials.weeklyOtherCosts | currency}}', '{{financials.annualOtherCosts | currency}}'],
      when: 'financials && financials.annualOtherCosts',
    },
    ['Net position', '{{financials.weeklyNet | currency}}', '{{financials.annualNet | currency}}'],
  ];

  pages.push({ ...withFurniture(page('Financial position', [
    ...furniture(DOCUMENT_LABEL, nextPart('Financials'), 'Financial position'),
    ...flow([
      sectionHeading({
        eyebrow: 'Acquisition and holding',
        heading: 'What it costs and what it returns',
        numeral: nextNumeral(),
      }),
      table({
        headers: ['Acquisition', 'Amount', 'Basis'],
        rows: acquisitionRows,
        columnWidths: [0.46, 0.27, 0.27],
        // NO `totals`. A doubled rule is the accounting convention for "the
        // numbers above add up to this", and this figure is not their sum —
        // see the note on `acquisitionRows`. Withdrawing the rule withdraws
        // the claim; the "Cash flow" table below keeps its total because its
        // net position genuinely is one.
      }),
      ...(spacious ? [] : [
        table({
          headers: ['Cash flow', 'Weekly', 'Annual'],
          rows: cashflowRows,
          columnWidths: [0.46, 0.27, 0.27],
          totals: [cashflowRows.length - 1],
        }),
      ]),
    ], contentTop()),
  ]), FOOTER), conditional: FINANCIAL_TIERS });

  if (spacious) {
    pages.push({ ...withFurniture(page('Cash flow', [
      ...furniture(DOCUMENT_LABEL, nextPart('Cash flow'), 'Cash flow'),
      ...flow([
        sectionHeading({
          eyebrow: 'Holding position',
          heading: 'The weekly and annual position',
          numeral: nextNumeral(),
        }),
        table({
          headers: ['Cash flow', 'Weekly', 'Annual'],
          rows: cashflowRows,
          columnWidths: [0.46, 0.27, 0.27],
          totals: [cashflowRows.length - 1],
        }),
        // No funding callout: `financials.fundingNote` has no column and no
        // producer, so it printed a titled panel with nothing in it.
      ], contentTop()),
    ]), FOOTER), conditional: FINANCIAL_TIERS });
  }

  // ── 05 Chart and scenario ────────────────────────────────────────────────
  pages.push({ ...withFurniture(page('Ten-year projection', [
    ...furniture(DOCUMENT_LABEL, nextPart('Projection'), 'Ten-year projection'),
    ...flow([
      sectionHeading({
        eyebrow: 'Projections',
        heading: 'Equity and value over ten years',
        numeral: nextNumeral(),
      }),
      scenarioChart({
        title: 'Projected equity position',
        caption: 'Property value less loan balance, by year',
        // Dollars. `projections.moderate[].equity` is stored in whole dollars,
        // and this series runs from $348k to $1.1m on the report behind this
        // change — figures a reader could not see at all until the axis was
        // labelled.
        axis: 'money',
        yAxisLabel: 'Equity',
        dataPath: 'tenYear.equitySeries',
        data: Array.from({ length: 10 }, (_, i) => ({ label: `Yr ${i + 1}`, value: 0 })),
      }),
      definitions('Assumptions', [
        { term: 'Capital growth', definition: '{{assumptions.capitalGrowth | percent}} per annum' },
        { term: 'Interest rate', definition: '{{assumptions.interestRate | percent}}' },
        { term: 'Vacancy allowance', definition: '{{assumptions.vacancy | percent}}' },
        // `assumptions.rentalGrowth` was the fourth row and has no column.
        { term: 'Occupancy', definition: '{{assumptions.occupancyWeeks}} weeks a year' },
      ]),
    ], contentTop()),
  ]), FOOTER), conditional: FINANCIAL_TIERS });
  pages.push(...platesFor('projection'));

  // ── 06 Risk and recommendation ───────────────────────────────────────────
  pages.push(withFurniture(page('Risk and recommendation', [
    ...furniture(DOCUMENT_LABEL, nextPart('Risk'), 'Risk and recommendation'),
    ...flow([
      sectionHeading({
        eyebrow: 'Risk register',
        heading: 'Manageable with verification, not without it',
        numeral: nextNumeral(),
      }),
      // ONE row, not three, and no `why`/`ddAction` columns.
      //
      // `investment_score.risks` is an array of plain strings whose length runs
      // **0 to 1** across all 1,182 reports — never 2, never 3 — and a string
      // has no `why` and no verification action. So this register drew three
      // rows of which at most one could ever fill, and all three of its prose
      // columns were empty on every report ever produced.
      //
      // The row is conditional because 197 reports carry no score object at all
      // and a further set score zero risks; the assessment page carries the
      // risk dimension's own reasoning either way.
      {
        ...risks('Hazard · rating · verification', [{
          // `Not assessed`, not `Noted`. The record holds a bare risk STRING
          // from `investment_score.risks` and no severity at all, and
          // `RISK_EXPOSURE_LEVELS` is `Low | Moderate | High | Not assessed` —
          // so `Noted` was a fifth word in a four-word vocabulary, in the
          // column that states the EXPOSURE. It is also absent from
          // `RATING_PALETTE`, which is why the chip already drew it neutral.
          //
          // `severityFromRating` answers null for both, so neither draws a bar;
          // what changes is that the reader is given the platform's own word
          // for "nobody assessed this" instead of one it uses nowhere else.
          // `confidence: 'Indicative'` is deliberately kept — it IS in
          // `CONFIDENCE_PALETTE`, and it is an honest qualifier for an
          // unverified one-liner rather than a claim the record cannot support.
          risk: '{{risks.0.risk}}', rating: 'Not assessed', confidence: 'Indicative',
          why: '{{assessment.4.details}}', ddAction: 'Verify before exchange',
        }], DETAIL_CHARS.risk),
        conditional: 'risks && risks[0] && risks[0].risk',
      },
      // A withheld register renders its reason.
      //
      // The register above is conditional and the heading over it is not, so
      // on a report whose record holds no risk string — 197 carry no score
      // object at all — the page opened "Risk register / Manageable with
      // verification, not without it" over nothing. An empty area under a
      // heading reads as a broken page, and it is also the wrong reading:
      // this is a fact about what the record carries, not a finding that the
      // property has no risks.
      {
        ...callout(
          'No risk recorded',
          'No risk was recorded against this property’s assessment. That is a statement about the record '
          + 'rather than a finding: it does not mean no risk applies. The assessment section sets out the '
          + 'risk dimension’s own reasoning, and the recommendation below stands either way.',
        ),
        conditional: '!(risks && risks[0] && risks[0].risk)',
      },
      recommendation(
        '{{recommendation.headline}}',
        // Was `recommendation.rationale`, which the record does not carry —
        // and then a hand-interpolated "Graded … out of 100" that printed
        // with holes on score-less rows and hardcoded "five" dimensions.
        // The projection composes the sentence only when the record can say
        // it (`recommendation.gradedDetailLine`).
        '{{recommendation.gradedDetailLine}}',
      ),
    ], contentTop()),
  ]), FOOTER));

  // ── 06b The report itself ────────────────────────────────────────────────
  //
  // Everything above this point is drawn from the calculator's jsonb columns —
  // `investment_score`, `financial_calculations`, `property_specs`. None of it
  // is the report. The report is `report_content`: the document the model
  // writes against the configured `report_structure_templates` guide, and what
  // an operator means by "the report structure".
  //
  // Until now no master carried a word of it. `{{sections.*}}` was bound by 0
  // of the 13 active `report_templates` rows, and the projection published
  // nothing from `report_content` at all — so choosing a template produced a
  // scorecard on a fixed page sequence and the report was simply absent.
  //
  // Measured 2026-08-16 across the 1,183 stored bodies:
  //
  //   tier        reports   median lines   longest
  //   compass       1,120        423        3,192
  //   strategic         9      1,166        1,322
  //   financial         9        785          906
  //   briefing         21        298          968
  //   snapshot         24         71          157
  //
  // No fixed sequence covers that range, which is exactly the case conditional
  // pages exist for: `NARRATIVE_PAGES` continuations, each holding one bucket
  // of the same source, each conditional on the bucket existing. A page that
  // does not render costs nothing — `visiblePages` filters before layout — so a
  // snapshot produces two pages here and a compass a dozen, from one master.
  //
  // The page count comes from the projection, computed with the same
  // `packMarkdownPages` the block uses. See `reports/markdownPaging.pure.ts`
  // for why that has to be one function rather than two.
  // 40, not 24. The allowance is a page budget, and it was set from the compass
  // median; a strategic report's median body is ~38 pages, so at 24 the format
  // whose document is longest was the one most often clipped. 40 covers the
  // median of every tier. A page that is not needed costs nothing — the
  // conditional filters it before layout — so the only price of a generous
  // allowance is schema size, and the only price of a mean one is a client
  // reading half a report.
  const NARRATIVE_PAGES = 40;
  // The same measure the Report Q&A masters take: the first page gives up the
  // heading block, the continuations do not.
  //
  // The body's first page carries no section heading of its own.
  //
  // It used to open on `As assessed / The report`, which named the document a
  // reader was already holding and then repeated itself in the running head of
  // every page under it. The body's real first heading is whatever the report
  // opens with — the executive verdict — and the markdown already sets it. A
  // heading reading "The report" over a report is the redundancy §7 names.
  //
  // With it gone the first page and the continuations have the same box, which
  // is stated once rather than computed twice: two expressions that must stay
  // equal are one line of drift away from printing a line twice or losing it.
  const narrativeHeight = remainingAfter([], contentTop());
  const firstNarrativeHeight = narrativeHeight;
  const contNarrativeHeight = narrativeHeight;

  // One part number for the whole report body. Each continuation page used to
  // mint its own — running heads marched "Part 08 · Report" through
  // "Part 33 · Report" and the Sources page introduced itself as Part 49 with
  // a two-inch numeral. A continuation is the same part, so it carries the
  // opener's label verbatim, and everything after the body numbers on from
  // the opener rather than from the page count.
  //
  // The running head names the CHAPTER the page is in, not the document.
  //
  // `Part 08 · Report` through `Part 33 · Report` told a reader they were in
  // the report, which they knew, on every page of a body that moves from the
  // executive verdict to demand drivers to planning controls to the risk
  // register. `narrative.chapters.N` is the chapter in force when page N
  // opens, measured by the pre-pass at this template's own geometry — so the
  // head cannot name a chapter a different packing would have put there. A
  // page before the first heading resolves to nothing and the binding prints
  // the empty string, which is the right answer: an unresolved binding is
  // never a visible `{{…}}`.
  const reportPart = nextPart('Report');
  /**
   * What a running-head family puts on the right of these pages: the chapter,
   * and NOT the part.
   *
   * The body is one part, correctly — so `reportPart` is the same string on
   * every page of it, and a running-head family (which draws the part and
   * discards the section, unlike a rail) printed `Part 05 · Report` on 29 of
   * the 36 pages of the 42 Patya Circuit report. v16 fixed the discarded half
   * and left the repeated one, so the 97 Poole Road Compass of 20 Sep 2026
   * carried `Part 07 · <chapter>` on TWENTY-SIX consecutive pages.
   *
   * A running head exists to say where the reader is. Across a single part
   * the part number says it twenty-six times and says nothing; the chapter
   * says it once per chapter, and it is already measured per page by the same
   * pre-pass that decides the page breaks. The part structure is on the
   * contents page, where it is what varies.
   *
   * Dropping the prefix also takes the worst case this can compose from
   * `'Part NN · '.length + CHAPTER_MAX_CHARS` (74) down to 64, so a long
   * chapter — `Zoning, Planning and Development Considerations` set over two
   * ragged right-aligned lines on six pages of that report — sets on one.
   *
   * A RAILED family is untouched and stays right: there the part is an eyebrow
   * ABOVE the chapter rather than a prefix beside it, so the repetition is
   * subordinate by construction and carries the orientation for free.
   */
  const reportChapter = (i: number): string => `{{narrative.chapters.${i}}}`;
  pages.push({
    ...withFurniture(page('The report', [
      ...furniture(DOCUMENT_LABEL, reportPart, '{{narrative.chapters.0}}', reportChapter(0)),
      ...flow([
        markdown('{{narrative.source}}', 0, firstNarrativeHeight, MARKDOWN_LINES_PER_PAGE),
      ], contentTop()),
    ]), FOOTER),
    // `narrative.source`, not `narrative`: 4 of the 1,187 stored reports carry
    // no body, and this page must not open a heading over nothing.
    conditional: 'narrative && narrative.source',
  });

  for (let i = 1; i < NARRATIVE_PAGES; i += 1) {
    pages.push({
      ...withFurniture(page(`The report (${i + 1})`, [
        ...furniture(DOCUMENT_LABEL, reportPart, `{{narrative.chapters.${i}}}`, reportChapter(i)),
        ...flow([
          markdown('{{narrative.source}}', i, contNarrativeHeight, MARKDOWN_LINES_PER_PAGE),
        ], contentTop()),
      ]), FOOTER),
      conditional: `narrative && narrative.pages > ${i}`,
      // One contents entry for the report, not forty. `toc` lists a row per
      // rendered page, so a compass body — which is what these 39 pages exist
      // to carry — put "The report (2)" … "The report (40)" on the contents
      // page and filled two sheets with them. The page still renders and is
      // still numbered; it just does not open a second entry about the section
      // the page before it opened. See `PageSchema.tocContinues`.
      tocContinues: true,
    });
  }

  // The cut, said on the page. The block stops drawing buckets it has no page
  // for, so without this the tail of a strategic report — whose median body is
  // 1,166 lines, past this allowance — would vanish with nothing saying so.
  // A page of its own rather than a callout on the last continuation, because
  // that continuation's body is sized to the full page and a callout above it
  // would print over the text.
  pages.push({
    ...withFurniture(page('Not the whole report', [
      ...furniture(DOCUMENT_LABEL, reportPart, 'Not the whole report'),
      ...flow([
        sectionHeading({ eyebrow: 'Continued elsewhere', heading: 'Not the whole report' }),
        callout(
          'This document carries the first part',
          `The assessment runs past the ${NARRATIVE_PAGES} pages this template sets aside for it. `
          + 'The full report is available from the report page, which paginates it in full.',
          textHeight(200, { extra: 34 }),
        ),
      ], contentTop()),
    ]), FOOTER),
    conditional: `narrative && narrative.pages > ${NARRATIVE_PAGES}`,
  });

  // ── 07 Sources and appendix ──────────────────────────────────────────────
  pages.push(withFurniture(page('Sources and methodology', [
    ...furniture(DOCUMENT_LABEL, nextPart('Sources'), 'Sources and methodology'),
    ...flow([
      sectionHeading({
        eyebrow: 'Basis of assessment',
        heading: 'How this assessment was reached',
        numeral: nextNumeral(),
      }),
      // Six rows, of which five could never resolve. There is no `profiles`
      // table, so `author.*` has no source; `client.name` has no column;
      // `market.postcode`/`state`/`suburbCount` are published by nothing; and
      // `assumptions.taxRate`/`sellingCosts` have no column either. The method
      // page listed six labelled terms with one value between them.
      definitions('Method', [
        { term: 'Prepared by', definition: '{{org.name}}' },
        { term: 'Date of preparation', definition: '{{report.generatedDate | date}}' },
        { term: 'Property assessed', definition: '{{property.address}}' },
        { term: 'Assessment grade', definition: '{{recommendation.grade}} · {{recommendation.score | fixed:0}} out of 100' },
        { term: 'Interest rate assumed', definition: '{{assumptions.interestRate | percent}}' },
        { term: 'Capital growth assumed', definition: '{{assumptions.capitalGrowth | percent}} per annum' },
      ], 96),
      callout(
        'Scope',
        'Figures are drawn from the stored assessment and are not re-derived here. '
        + 'No tax position is modelled and no valuation after settlement is assumed.',
        textHeight(150, { extra: 34 }),
      ),
    ], contentTop()),
  ]), FOOTER));
  pages.push(...platesFor('sources'));

  // The plates that belong to no section — `six_with_bleed`'s two extras. They
  // close the narrative rather than following one of its pages.
  pages.push(...platesFor('page'));

  pages.push(disclaimerPage(STANDARD_DISCLAIMER));

  return assembleMaster({ family, variant, manifest, c, pages, format: INVESTMENT_COMPASS_FORMAT });
}

/** Every Investment Compass master, by family, in catalogue order. */
export const INVESTMENT_COMPASS_TEMPLATES: CompassSeedTemplate[] = DESIGN_FAMILIES.flatMap(
  (family) => family.variants.map((variant) => buildTemplate(family, variant)),
);

/** The five Private Banking masters, kept as a named export for the pilot specs. */
export const PRIVATE_BANKING_TEMPLATES: CompassSeedTemplate[] =
  INVESTMENT_COMPASS_TEMPLATES.filter((t) => t.designMeta.familyKey === 'private_banking');

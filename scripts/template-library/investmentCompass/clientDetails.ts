/**
 * The Client Details Form, drawn in the ten Investment Compass families.
 *
 * The sixth report format on the family system. It shares `master.ts` with the
 * other five and contributes only its own page sequence — see
 * `docs/template-library/07-investment-compass-families.md`.
 *
 * ## 96% of these documents are about a client with nothing recorded
 *
 * Measured across all 775 clients: **742 have no property, no employment, no
 * asset, no liability and no expense.** That is not an edge case to guard
 * against, it is the document. `docs/reports/CLIENT_DETAILS.md` records what the
 * shipping generator does with it — opens on a Properties Overview, follows
 * with per-property blocks and a Portfolio Summary, and for 742 clients
 * produces a cover and several pages of empty tables.
 *
 * So every financial page here is conditional on `clientDetails.hasFinancials`,
 * and the closing page carries two mutually exclusive statements at one
 * position: a summary of where the client stands, or the sentence that says the
 * record holds contact details and nothing else. A client with a name and an
 * address gets a short document that reads as finished, because it is.
 *
 * A conditional page costs nothing when it does not render — `visiblePages`
 * filters it out before anything is laid out — which is why the page count runs
 * 5 to 13 across the same fifty masters.
 *
 * ## Every collection is capped, and the caps are measured
 *
 * These pages cannot paginate. `clientDetailsProjection.pure.ts` carries the
 * table; the short version is that expenses are **grouped by category rather
 * than listed** (one client records 100 rows; grouped, the worst case is 14),
 * and assets and liabilities are drawn 8 of a possible 18 and 16 with the count
 * printed beside them.
 *
 * Where a cap bites, the page says so. That is `PORTFOLIO.md`'s F4: the finding
 * against the shipping generator is not that it stops, it is that it stops with
 * nothing on the page saying so.
 *
 * ## Below the cap, the table is as deep as the record
 *
 * A fixed eight-row table beside two recorded assets rules off six empty bands,
 * so every capped table here is drawn at one of a few depths — mutually
 * exclusive `oneOf` variants keyed on the published count, split where the
 * production distribution actually clusters: assets {1:3, 2:4, 3:4, 7:7, 9:1,
 * 18:1} → depths 3/7/8, liabilities {1:4, 2:4, 4:1, 8:8, 16:1} → 2/4/8,
 * employment {1:19, 2:7, 3:2} → 1/2/3, address history {1:8, 3:8, 5:1, 20:1} →
 * 1/3/4, holdings one to four → 1/2/3/4, and expense categories {1:2, 2:2,
 * 14:9} → 2/14. The reserved height is the deepest variant's — the win is that
 * no client's page rules off rows their record does not hold.
 *
 * ## No emoji, and no borrowing capacity
 *
 * The legacy headings carry `🏠`, `📈`, `🏛️`, `💸` and `✓ ✗ ⏳ ▲ ▼ ●`. Harmless
 * when every page is a raster of the browser's own rendering; tofu the moment
 * the page is real text, because these families' faces carry no emoji coverage.
 * The normaliser has already turned every one of them into a word.
 *
 * Borrowing capacity has its own migrated format with its own contract and its
 * own fifty masters. Carrying a copy inside this document would mean two places
 * to fix the same defect.
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
  contents,
  contentTop,
  cover,
  definitions,
  disclaimerPage,
  flow,
  furniture,
  ifItFits,
  kpiCapacity,
  kpis,
  oneOf,
  page,
  prose,
  sectionHeading,
  strengthsWatch,
  table,
  textHeight,
  withFurniture,
  type BlockDef,
  type FlowItem,
  type KpiItem,
  type PageDef,
  renderTimePart,
  RENDER_TIME_NUMERAL,
} from './blocks';
import { hasContents } from './resolvers';
import { assembleMaster, type CompassSeedTemplate, type ReportFormat } from './master';
import { STANDARD_DISCLAIMER } from '../designSystem';

/**
 * The running foot.
 *
 * `{{client.name}}` resolves here, and this is the **only** one of the six
 * formats where it does: `clients` is the source table, so the document is
 * genuinely about a named person. The Borrowing Capacity, Comparison and Cash
 * Flow masters name their subject instead, because their source tables carry no
 * client at all.
 */
const FOOTER = '{{client.name}} · Client details';
const DOCUMENT_LABEL = 'Client Details Form';

/**
 * The residence rows, and which of them the record may not hold.
 *
 * `clientDetailsProjection` publishes with `put`, which omits an absent value
 * rather than writing an empty string — so an unheld field leaves its path
 * unresolved and its row prints as a term with no definition.
 */
const RESIDENCE_ADDRESS = { term: 'Address', definition: '{{clientDetails.residence.address}}' };
const RESIDENCE_LOCALITY = {
  term: 'Suburb',
  definition: '{{clientDetails.residence.suburb}} {{clientDetails.residence.state}} {{clientDetails.residence.postcode}}',
};
const RESIDENCE_LIVING = { term: 'Living situation', definition: '{{clientDetails.residence.livingSituation}}' };
const RESIDENCE_STATUS = { term: 'Residential status', definition: '{{clientDetails.residence.residentialStatus}}' };

/** Any part of the locality line — the row says "Suburb" but sets three fields. */
const HAS_LOCALITY_BARE = 'clientDetails && clientDetails.residence && '
  + '(clientDetails.residence.suburb || clientDetails.residence.state || clientDetails.residence.postcode)';
const HAS_LOCALITY = '(' + HAS_LOCALITY_BARE + ')';
const HAS_RESIDENTIAL_STATUS_BARE = '(clientDetails && clientDetails.residence && clientDetails.residence.residentialStatus)';
const HAS_RESIDENTIAL_STATUS = HAS_RESIDENTIAL_STATUS_BARE;

/** What the pages draw. See `clientDetailsProjection.pure.ts` for the measurements. */
const ROWS = {
  assets: 8,
  liabilities: 8,
  properties: 4,
  employment: 3,
  addressHistory: 4,
  expenseCategories: 14,
} as const;

/**
 * The longest each bound field runs across the record.
 *
 * Measured, because a declared height that is too small does not overflow the
 * page — it lays one block over the next, invisibly to `flow()`'s arithmetic
 * guard. See `textHeight` in `blocks.ts`.
 */
const LENGTHS = {
  /** `narrative` is two or three sentences the normaliser builds from the record. */
  narrative: 420,
  /** The longest stored `address` is 55; a residence line adds suburb/state/postcode. */
  address: 90,
  /** `liability.basis` — "as recorded", "estimated on generic terms", and so on. */
  basis: 60,
  /** `employer_name` maxes at 57 characters in the record. */
  employer: 57,
  /**
   * `secondaryResidence.line` — address · living situation · residential
   * status, composed in the projection. Address caps at 55 in the record;
   * suburb, state, postcode and the two status words add the rest.
   */
  secondaryResidence: 150,
  /**
   * The per-holding callout: `strapline` (kind · lender · ownership · terms —
   * ~93 characters with a 26-character lender, the longest in the record) plus
   * the rent-against-outgoings sentence (~68 with three formatted amounts).
   * The budget the piecewise binding this replaces was measured at.
   */
  holdingSummary: 190,
} as const;

const CLIENT_DETAILS_FORMAT: ReportFormat = {
  key: 'client-details-form',
  reportType: 'client_details',
  // `client_form`, not `client_details`. The report *type* is client_details —
  // that is what the adapter registry keys on — but `category` is a separate,
  // constrained vocabulary, and the taxonomy's term for a client-facing form is
  // `client_form`. These 50 rows were rejected by
  // template_library_entries_category_check on the first real apply.
  category: 'client_form',
  tier: 'compass',
  label: 'Client Details Form',
  extraTags: ['client-details', 'fact-find', 'broker', 'household'],
};

/** Present on every record, financial or not. */
const IDENTITY_KPIS: KpiItem[] = [
  { label: 'Prepared', value: '{{report.generatedDate | date}}', note: 'From the record as it stands' },
  { label: 'People', value: '{{clientDetails.contacts.0.name}}', note: 'Primary contact' },
  { label: 'Marital status', value: '{{clientDetails.maritalStatus}}', note: 'As recorded' },
  { label: 'Dependents', value: '{{clientDetails.dependents | fixed:0}}', note: 'As recorded' },
  { label: 'Properties', value: '{{clientDetails.propertyCount | fixed:0}}', note: 'Held by the household' },
  { label: 'Second contact', value: '{{clientDetails.hasSecondaryContact}}', note: 'On the record' },
];

/** The financial summary. Only ever drawn on a page conditional on the record. */
const POSITION_KPIS: KpiItem[] = [
  { label: 'Net worth', value: '{{clientDetails.position.netWorth | currency}}', note: 'Equity plus assets, less debts' },
  { label: 'Monthly income', value: '{{clientDetails.position.incomeMonthly | currency}}', note: 'Employment, other and rent' },
  { label: 'Monthly commitments', value: '{{clientDetails.position.commitmentsMonthly | currency}}', note: 'Servicing, outgoings and expenses' },
  { label: 'Monthly surplus', value: '{{clientDetails.position.surplusMonthly | currency}}', note: 'Income less commitments' },
  { label: 'Property equity', value: '{{clientDetails.position.propertyEquity | currency}}', note: 'Value less what is owed' },
  { label: 'Commitment ratio', value: '{{clientDetails.position.commitmentRatio | percent}}', note: 'Commitments over income' },
];

const HAS_FINANCIALS = 'clientDetails && clientDetails.hasFinancials';

/** A page that exists only for the 33 clients whose record holds something. */
function financialPage(p: PageDef, extra?: string): PageDef {
  return { ...p, conditional: extra ? `${HAS_FINANCIALS} && ${extra}` : HAS_FINANCIALS };
}

function assetRow(i: number): string[] {
  return [
    `{{clientDetails.assets.${i}.type}}`,
    `{{clientDetails.assets.${i}.description}}`,
    `{{clientDetails.assets.${i}.value | currency}}`,
  ];
}

function liabilityRow(i: number): string[] {
  return [
    `{{clientDetails.liabilities.${i}.type}}`,
    `{{clientDetails.liabilities.${i}.provider}}`,
    `{{clientDetails.liabilities.${i}.balance | currency}}`,
    `{{clientDetails.liabilities.${i}.monthlyServicing | currency}}`,
  ];
}

function expenseRow(i: number): string[] {
  return [
    `{{clientDetails.expenseGroups.${i}.category}}`,
    `{{clientDetails.expenseGroups.${i}.lines | fixed:0}}`,
    `{{clientDetails.expenseGroups.${i}.monthly | currency}}`,
  ];
}

function propertyRow(i: number): string[] {
  return [
    `{{clientDetails.properties.${i}.shortAddress}}`,
    `{{clientDetails.properties.${i}.kind}}`,
    `{{clientDetails.properties.${i}.value | currency}}`,
    `{{clientDetails.properties.${i}.loanRemaining | currency}}`,
    `{{clientDetails.properties.${i}.lvr | percent:0}}`,
    `{{clientDetails.properties.${i}.netMonthly | currency}}`,
  ];
}

/**
 * The two closings, at one position.
 *
 * Mutually exclusive conditionals: a client with something recorded gets the
 * summary, and a client with nothing gets the sentence that says so. Neither
 * ever prints beside the other, and the item's height is the taller of the two
 * so whatever follows clears both. See `FlowItem.block` in `blocks.ts`.
 */
function closingStatement(cellSize: number): FlowItem {
  const summary = callout(
    'Where this client stands',
    'Net worth {{clientDetails.position.netWorth | currency}}, on monthly income of '
      + '{{clientDetails.position.incomeMonthly | currency}} against commitments of '
      + '{{clientDetails.position.commitmentsMonthly | currency}}. Every figure in this document '
      + 'is summed from the rows it also prints, so nothing here can disagree with the table it '
      + 'summarises.',
    textHeight(330, { size: cellSize, extra: 34 }),
  );
  const empty = callout(
    'No financial information is recorded for this client',
    'The record holds contact details but no income, assets, liabilities, expenses or property. '
      + 'Everything above is what we have. This document is complete — the record is not.',
    textHeight(330, { size: cellSize, extra: 34 }),
  );

  const first = (item: FlowItem, y: number): BlockDef => {
    const emitted = item.block(y);
    return Array.isArray(emitted) ? emitted[0] : emitted;
  };

  return {
    height: Math.max(summary.height, empty.height),
    block: (y): BlockDef[] => [
      { ...first(summary, y), conditional: HAS_FINANCIALS },
      { ...first(empty, y), conditional: '!(clientDetails && clientDetails.hasFinancials)' },
    ],
  };
}

function buildTemplate(family: DesignFamily, variant: VariantDefinition): CompassSeedTemplate {
  const manifest = resolveManifest(family, variant);
  const c = beginCompassTemplate(family, variant, manifest);

  const nextPart = renderTimePart;
  const nextNumeral = (): string => RENDER_TIME_NUMERAL;

  const pages: PageDef[] = [];

  // ── 01 Cover ─────────────────────────────────────────────────────────────
  pages.push(cover({
    wordmarkTop: '{{org.name}}',
    wordmarkBottom: 'Client Details',
    tagline: 'Your dedicated property partner',
    marker: 'Client Details',
    eyebrow: 'Client details form',
    title: '{{client.name}}',
    standfirst: 'Everything the record holds about this household, as it stands.',
    locations: 'Prepared {{report.generatedDate | date}}',
    facts: [
      { label: 'Properties', value: '{{clientDetails.propertyCount | fixed:0}}' },
      { label: 'Marital status', value: '{{clientDetails.maritalStatus}}' },
      { label: 'Dependents', value: '{{clientDetails.dependents | fixed:0}}' },
      { label: 'Second contact', value: '{{clientDetails.hasSecondaryContact}}' },
    ],
  }));

  // ── Contents, where the family declares one ──────────────────────────────
  //
  // The list is fixed while the pages are conditional, so it names what this
  // format covers rather than promising a page number. Nothing here is keyed
  // on a page index — `INVESTMENT.md` records why anything keyed on a section
  // number stopped working.
  if (hasContents(manifest.toc_style)) {
    pages.push(withFurniture(page('Contents', [
      ...furniture(DOCUMENT_LABEL, nextPart('Contents'), 'Contents'),
      ...flow([
        sectionHeading({ eyebrow: 'In this record', heading: 'Contents', numeral: nextNumeral() }),
        contents([
          'Who this is about',
          'Where they live',
          'Work and income',
          'What they own',
          'What they owe',
          'What they spend',
          'The property portfolio',
          'Each property in turn',
          'Where they stand',
          'Important information',
        ]),
      ], contentTop()),
    ]), FOOTER));
  }

  // ── 02 Who this is about ─────────────────────────────────────────────────
  //
  // Unconditional: this is the page every one of the 775 clients has.
  pages.push(withFurniture(page('Who this is about', [
    ...furniture(DOCUMENT_LABEL, nextPart('Household'), 'Who this is about'),
    ...flow(ifItFits([
      sectionHeading({
        eyebrow: 'The household',
        heading: 'Who this is about',
        numeral: nextNumeral(),
      }),
      // Built from the record rather than written — two or three sentences
      // stating what the record holds and what it does not.
      prose('{{clientDetails.narrative}}', textHeight(LENGTHS.narrative, { lineHeight: 1.62 })),
      kpis(IDENTITY_KPIS.slice(0, kpiCapacity())),
    ], [
      // The second person, where the record carries one — 13 records do.
      {
        ...definitions('Second contact', [
          { term: '{{clientDetails.contacts.1.name}}', definition: '{{clientDetails.contacts.1.email}} · {{clientDetails.contacts.1.mobile}}' },
        ], LENGTHS.address),
        conditional: 'clientDetails && clientDetails.contacts && clientDetails.contacts[1]',
      },
    ], contentTop()), contentTop()),
  ]), FOOTER));

  // ── 03 Where they live ───────────────────────────────────────────────────
  pages.push({
    ...withFurniture(page('Where they live', [
      ...furniture(DOCUMENT_LABEL, nextPart('Residence'), 'Where they live'),
      ...flow(ifItFits([
        sectionHeading({
          eyebrow: 'Current address',
          heading: 'Where they live',
          numeral: nextNumeral(),
        }),
        // Four fixed rows became four variants, because two of them are
        // optional on the record and the projection omits what it does not
        // hold. `current_suburb` and `residential_status` are both null on the
        // client behind the 15 Aug 2026 export, so the page printed the words
        // "Suburb" and "Residential status" against nothing at all — a form
        // that looks half-filled rather than a record that holds four facts.
        //
        // The secondary contact's residence has never had this problem because
        // its line is *composed in the projection* and omits what is absent
        // (see `LENGTHS.secondaryResidence`). The primary's is drawn as a
        // definition list, so the choice has to be made here.
        oneOf(
          {
            when: HAS_LOCALITY + ' && ' + HAS_RESIDENTIAL_STATUS,
            item: definitions('Residence', [
              RESIDENCE_ADDRESS, RESIDENCE_LOCALITY, RESIDENCE_LIVING, RESIDENCE_STATUS,
            ], LENGTHS.address),
          },
          {
            when: HAS_LOCALITY + ' && !' + HAS_RESIDENTIAL_STATUS_BARE,
            item: definitions('Residence', [
              RESIDENCE_ADDRESS, RESIDENCE_LOCALITY, RESIDENCE_LIVING,
            ], LENGTHS.address),
          },
          {
            when: '!(' + HAS_LOCALITY_BARE + ') && ' + HAS_RESIDENTIAL_STATUS,
            item: definitions('Residence', [
              RESIDENCE_ADDRESS, RESIDENCE_LIVING, RESIDENCE_STATUS,
            ], LENGTHS.address),
          },
          {
            when: '!(' + HAS_LOCALITY_BARE + ') && !' + HAS_RESIDENTIAL_STATUS_BARE,
            item: definitions('Residence', [
              RESIDENCE_ADDRESS, RESIDENCE_LIVING,
            ], LENGTHS.address),
          },
        ),
      ], [
        // The second contact's residence, where the record carries one. One
        // composed line, because the projection carries both legacy shapes in
        // it: the shared sentence, or the apart address with its status words.
        {
          ...definitions('Where the second contact lives', [
            { term: '{{clientDetails.contacts.1.name}}', definition: '{{clientDetails.secondaryResidence.line}}' },
          ], LENGTHS.secondaryResidence),
          conditional: 'clientDetails && clientDetails.secondaryResidence',
        },
        // Address history runs to 20 periods on one record and 4 on all but
        // two, clustering at one and three. The count beside the table is what
        // makes the cap honest; the depth variants are what stop a one-move
        // record ruling off three empty bands.
        (() => {
          const historyTable = (n: number) => table({
            headers: ['Previous address', 'From', 'To'],
            rows: Array.from({ length: n }, (_, i) => [
              `{{clientDetails.addressHistory.${i}.address}}`,
              `{{clientDetails.addressHistory.${i}.startDate | date}}`,
              `{{clientDetails.addressHistory.${i}.endDate | date}}`,
            ]),
            columnWidths: [0.56, 0.22, 0.22],
            numeric: [],
          });
          return oneOf(
            { when: 'clientDetails && clientDetails.addressHistory && clientDetails.addressHistoryCount <= 1', item: historyTable(1) },
            { when: 'clientDetails && clientDetails.addressHistory && clientDetails.addressHistoryCount > 1 && clientDetails.addressHistoryCount <= 3', item: historyTable(3) },
            { when: 'clientDetails && clientDetails.addressHistory && clientDetails.addressHistoryCount > 3', item: historyTable(ROWS.addressHistory) },
          );
        })(),
      ], contentTop()), contentTop()),
    ]), FOOTER),
    conditional: 'clientDetails && clientDetails.residence',
  });

  // ── 04 Work and income ───────────────────────────────────────────────────
  pages.push(financialPage(withFurniture(page('Work and income', [
    ...furniture(DOCUMENT_LABEL, nextPart('Income'), 'Work and income'),
    ...flow(ifItFits([
      sectionHeading({
        eyebrow: 'What comes in',
        heading: 'Work and income',
        numeral: nextNumeral(),
        standfirst: 'Salary is stated as the annual figure whatever frequency it was captured '
          + 'at, and every monthly total below is converted through one function.',
      }),
      // 19 of the 28 clients with employment record exactly one row; a fixed
      // three-row table rules off two empty bands for every one of them.
      (() => {
        const employmentTable = (n: number) => table({
          headers: ['Employer', 'Role', 'Type', 'Gross annual'],
          rows: Array.from({ length: n }, (_, i) => [
            `{{clientDetails.employment.${i}.employer}}`,
            `{{clientDetails.employment.${i}.role}}`,
            `{{clientDetails.employment.${i}.employmentType}}`,
            `{{clientDetails.employment.${i}.grossAnnual | currency}}`,
          ]),
          columnWidths: [0.32, 0.26, 0.2, 0.22],
        });
        return oneOf(
          { when: 'clientDetails && clientDetails.employmentCount <= 1', item: employmentTable(1) },
          { when: 'clientDetails && clientDetails.employmentCount == 2', item: employmentTable(2) },
          { when: 'clientDetails && clientDetails.employmentCount > 2', item: employmentTable(ROWS.employment) },
        );
      })(),
      table({
        headers: ['Income, monthly', 'Amount'],
        rows: [
          ['Employment', '{{clientDetails.income.employmentMonthly | currency}}'],
          ['Other income', '{{clientDetails.income.otherMonthly | currency}}'],
          ['Rent received', '{{clientDetails.income.rentalMonthly | currency}}'],
          ['Total monthly', '{{clientDetails.income.totalMonthly | currency}}'],
        ],
        columnWidths: [0.62, 0.38],
        totals: [3],
      }),
    ], [
      {
        ...definitions('Also recorded', [
          { term: '{{clientDetails.otherIncome.0.label}}', definition: '{{clientDetails.otherIncome.0.monthly | currency}} a month' },
        ], 80),
        conditional: 'clientDetails && clientDetails.otherIncome && clientDetails.otherIncome[0]',
      },
    ], contentTop()), contentTop()),
  ]), FOOTER), 'clientDetails.employment'));

  // ── 05 What they own ─────────────────────────────────────────────────────
  pages.push(financialPage(withFurniture(page('What they own', [
    ...furniture(DOCUMENT_LABEL, nextPart('Assets'), 'What they own'),
    ...flow([
      sectionHeading({
        eyebrow: 'Assets',
        heading: 'What they own',
        numeral: nextNumeral(),
        standfirst: `This page draws up to ${ROWS.assets} assets. Property is not among them — `
          + 'it has its own pages, and counting a home here would state it twice.',
      }),
      // Depths 3/7/8: the record clusters at one to three and at exactly seven,
      // and the cap takes everything beyond.
      (() => {
        const assetTable = (n: number) => table({
          headers: ['Type', 'Description', 'Value'],
          rows: Array.from({ length: n }, (_, i) => assetRow(i)),
          columnWidths: [0.28, 0.46, 0.26],
        });
        return oneOf(
          { when: 'clientDetails && clientDetails.assetCount <= 3', item: assetTable(3) },
          { when: 'clientDetails && clientDetails.assetCount > 3 && clientDetails.assetCount <= 7', item: assetTable(7) },
          { when: 'clientDetails && clientDetails.assetCount > 7', item: assetTable(ROWS.assets) },
        );
      })(),
      table({
        headers: ['Assets, total', 'Amount'],
        rows: [['Non-property assets', '{{clientDetails.position.otherAssets | currency}}']],
        columnWidths: [0.62, 0.38],
        totals: [0],
      }),
      // F4, said out loud: the finding against the shipping generator is not
      // that it stops, it is that it stops with nothing on the page saying so.
      {
        ...callout(
          'This page does not show every asset',
          `The record holds {{clientDetails.assetCount}} assets and the table above draws `
            + `${ROWS.assets}. The total below counts all of them.`,
          textHeight(160, { size: c.scale.cell, extra: 30 }),
        ),
        conditional: `clientDetails && clientDetails.assetCount > ${ROWS.assets}`,
      },
    ], contentTop()),
  ]), FOOTER), 'clientDetails.assets'));

  // ── 06 What they owe ─────────────────────────────────────────────────────
  pages.push(financialPage(withFurniture(page('What they owe', [
    ...furniture(DOCUMENT_LABEL, nextPart('Liabilities'), 'What they owe'),
    ...flow(ifItFits([
      sectionHeading({
        eyebrow: 'Liabilities',
        heading: 'What they owe',
        numeral: nextNumeral(),
        standfirst: 'Servicing is what the client records paying where they record it, and a '
          + 'modelled figure where they do not. The basis is stated for each.',
      }),
      // Depths 2/4/8: half the clients who record any record one or two.
      (() => {
        const liabilityTable = (n: number) => table({
          headers: ['Type', 'Provider', 'Balance', 'Monthly'],
          rows: Array.from({ length: n }, (_, i) => liabilityRow(i)),
          columnWidths: [0.26, 0.3, 0.22, 0.22],
        });
        return oneOf(
          { when: 'clientDetails && clientDetails.liabilityCount <= 2', item: liabilityTable(2) },
          { when: 'clientDetails && clientDetails.liabilityCount > 2 && clientDetails.liabilityCount <= 4', item: liabilityTable(4) },
          { when: 'clientDetails && clientDetails.liabilityCount > 4', item: liabilityTable(ROWS.liabilities) },
        );
      })(),
      {
        ...callout(
          'This page does not show every liability',
          `The record holds {{clientDetails.liabilityCount}} liabilities and the table above `
            + `draws ${ROWS.liabilities}. The position page counts all of them.`,
          textHeight(160, { size: c.scale.cell, extra: 30 }),
        ),
        conditional: `clientDetails && clientDetails.liabilityCount > ${ROWS.liabilities}`,
      },
    ], [
      // Only where a servicing figure is a model rather than a record.
      {
        ...definitions('How servicing was arrived at', [
          { term: '{{clientDetails.liabilities.0.type}}', definition: '{{clientDetails.liabilities.0.basis}}' },
        ], LENGTHS.basis),
        conditional: 'clientDetails && clientDetails.liabilitiesIncludeEstimates == "Yes"',
      },
    ], contentTop()), contentTop()),
  ]), FOOTER), 'clientDetails.liabilities'));

  // ── 07 What they spend ───────────────────────────────────────────────────
  //
  // Grouped, never listed. One client records 100 expense rows and the average
  // among the thirteen who record any is 39; no cap short enough to fit a page
  // would leave a useful document, and a category total is what a broker reads
  // anyway. Fourteen categories is the worst case in the record.
  pages.push(financialPage(withFurniture(page('What they spend', [
    ...furniture(DOCUMENT_LABEL, nextPart('Expenses'), 'What they spend'),
    ...flow([
      sectionHeading({
        eyebrow: 'Living expenses',
        heading: 'What they spend',
        numeral: nextNumeral(),
        standfirst: 'By category, largest first. The record holds '
          + '{{clientDetails.expenseLineCount}} individual lines across '
          + '{{clientDetails.expenseCategoryCount}} categories; they are summed here rather '
          + 'than listed.',
        // Literal apart from two counts, each of which resolves to one or two
        // digits — far shorter than the bindings they replace, so the source
        // length is the safe measure.
        standfirstChars: 175,
      }),
      // Two depths only: of the 13 clients who record expenses, nine group to
      // exactly fourteen categories and four to one or two — the distribution
      // is bimodal, so a middle depth would fit nobody.
      (() => {
        const expenseTable = (n: number) => table({
          headers: ['Category', 'Lines', 'Monthly'],
          rows: Array.from({ length: n }, (_, i) => expenseRow(i)),
          columnWidths: [0.56, 0.16, 0.28],
          numeric: [1, 2],
        });
        return oneOf(
          { when: 'clientDetails && clientDetails.expenseCategoryCount <= 2', item: expenseTable(2) },
          { when: 'clientDetails && clientDetails.expenseCategoryCount > 2', item: expenseTable(ROWS.expenseCategories) },
        );
      })(),
    ], contentTop()),
  ]), FOOTER), 'clientDetails.expenseGroups'));

  // ── 08 The property portfolio ────────────────────────────────────────────
  //
  // 26 of the 775 clients hold any property and the most any one holds is four,
  // so the table draws four and no client loses a holding.
  pages.push(financialPage(withFurniture(page('The property portfolio', [
    ...furniture(DOCUMENT_LABEL, nextPart('Portfolio'), 'The property portfolio'),
    ...flow(ifItFits([
      sectionHeading({
        eyebrow: 'Investment and SMSF holdings',
        heading: 'The property portfolio',
        numeral: nextNumeral(),
        standfirst: 'The home they live in is not in this table. It is somewhere to live before '
          + 'it is an asset — it counts in net worth and not in what they invest.',
      }),
      // One depth per holding count — no client holds more than four, so every
      // portfolio table is exactly as deep as the portfolio.
      (() => {
        const holdingsTable = (n: number) => table({
          headers: ['Property', 'Held as', 'Value', 'Owing', 'LVR', 'Monthly'],
          rows: Array.from({ length: n }, (_, i) => propertyRow(i)),
          columnWidths: [0.28, 0.16, 0.15, 0.15, 0.1, 0.16],
        });
        return oneOf(
          { when: 'clientDetails && clientDetails.propertiesShown <= 1', item: holdingsTable(1) },
          { when: 'clientDetails && clientDetails.propertiesShown == 2', item: holdingsTable(2) },
          { when: 'clientDetails && clientDetails.propertiesShown == 3', item: holdingsTable(3) },
          { when: 'clientDetails && clientDetails.propertiesShown > 3', item: holdingsTable(ROWS.properties) },
        );
      })(),
    ], [
      table({
        headers: ['Portfolio totals', 'Amount'],
        rows: [
          ['Total value', '{{clientDetails.position.propertyValue | currency}}'],
          ['Total owing', '{{clientDetails.position.propertyDebt | currency}}'],
          ['Total equity', '{{clientDetails.position.propertyEquity | currency}}'],
        ],
        columnWidths: [0.62, 0.38],
        totals: [2],
      }),
    ], contentTop()), contentTop()),
  ]), FOOTER), 'clientDetails.properties'));

  // ── 09 Each property in turn ─────────────────────────────────────────────
  //
  // One block per holding, each conditional on that holding existing. They cost
  // their height whether or not they render, which is the price of a
  // conditional in a layout that cannot reflow.
  pages.push(financialPage(withFurniture(page('Each property in turn', [
    ...furniture(DOCUMENT_LABEL, nextPart('Properties'), 'Each property in turn'),
    ...flow([
      sectionHeading({
        eyebrow: 'Property by property',
        heading: 'Each property in turn',
        numeral: nextNumeral(),
      }),
      // `heading` and `strapline` are composed in the projection rather than
      // bound piecewise: the production client this page was measured against
      // stores no lender on any holding, and `{{kind}} · {{lender}} · …`
      // printed "Investment · · rent…" on all three callouts. The strapline
      // also carries what the legacy holdings table draws and this page used
      // to drop — ownership percentage, repayment type and the interest rate.
      ...Array.from({ length: ROWS.properties }, (_, i) => ({
        ...callout(
          `{{clientDetails.properties.${i}.heading}}`,
          `{{clientDetails.properties.${i}.strapline}} · `
            + `rent {{clientDetails.properties.${i}.rentMonthly | currency}} a month against `
            + `outgoings of {{clientDetails.properties.${i}.expensesMonthly | currency}}, `
            + `netting {{clientDetails.properties.${i}.netMonthly | currency}}.`,
          textHeight(LENGTHS.holdingSummary, { size: c.scale.cell, extra: 30 }),
        ),
        conditional: `clientDetails && clientDetails.properties && clientDetails.properties[${i}]`,
      })),
    ], contentTop()),
  ]), FOOTER), 'clientDetails.properties'));

  // ── 10 Where they stand ──────────────────────────────────────────────────
  //
  // Unconditional, and the page that makes this format work for the 742 clients
  // whose record holds nothing: the KPI band is conditional, the closing
  // statement is drawn twice at one position, and exactly one of the two
  // renders.
  pages.push(withFurniture(page('Where they stand', [
    ...furniture(DOCUMENT_LABEL, nextPart('Position'), 'Where they stand'),
    ...flow(ifItFits([
      sectionHeading({
        eyebrow: 'The position',
        heading: 'Where they stand',
        numeral: nextNumeral(),
      }),
      {
        ...kpis(POSITION_KPIS.slice(0, kpiCapacity())),
        conditional: HAS_FINANCIALS,
      },
      closingStatement(c.scale.cell),
    ], [
      {
        ...strengthsWatch(
          ['{{clientDetails.position.otherAssets | currency}} in non-property assets'],
          ['{{clientDetails.position.otherLiabilities | currency}} in non-property debt'],
          { strengths: 'Assets', watch: 'Debts' },
          70,
        ),
        conditional: HAS_FINANCIALS,
      },
    ], contentTop()), contentTop()),
  ]), FOOTER));

  pages.push(disclaimerPage(STANDARD_DISCLAIMER));

  return assembleMaster({ family, variant, manifest, c, pages, format: CLIENT_DETAILS_FORMAT });
}

/** Every Client Details Form master, by family, in catalogue order. */
export const CLIENT_DETAILS_TEMPLATES: CompassSeedTemplate[] = DESIGN_FAMILIES.flatMap(
  (family) => family.variants.map((variant) => buildTemplate(family, variant)),
);

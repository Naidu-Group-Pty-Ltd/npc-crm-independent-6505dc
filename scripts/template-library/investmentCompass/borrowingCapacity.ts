/**
 * The Borrowing Capacity Snapshot, drawn in the ten Investment Compass families.
 *
 * ## Why a second composer rather than a parameter on the first
 *
 * The family system is format-agnostic by construction — typography, density,
 * margins, KPI arrangement, table treatment and colourway carry no subject
 * matter — so all ten designs serve this format unchanged, and `master.ts`
 * compiles both catalogues through one shell. What is *not* shared is the
 * document: an Investment Compass report argues about a property and ends on a
 * ten-year projection; a Snapshot argues about a household's income and ends on
 * what a lender would advance against it. Bending one page sequence to cover
 * both with conditionals would produce a template that is neither.
 *
 * ## The pages
 *
 * Follows the structure `docs/reports/BORROWING_CAPACITY.md` records for the
 * shipping generator, minus the pages whose data does not exist:
 *
 *  | Snapshot page                    | Here                                  |
 *  |----------------------------------|---------------------------------------|
 *  | Cover                            | Cover                                 |
 *  | Summary, KPIs, assumptions, LMI  | Capacity summary (+ conditional LMI)  |
 *  | Income analysis                  | Income analysis                       |
 *  | Expenses & liabilities           | Commitments                           |
 *  | Capacity breakdown, warnings     | Serviceability, recommendations       |
 *  | Executive summary                | The assessment (narrative)            |
 *  | Assessment ledger                | How the assessment reads              |
 *  | Assumptions                      | What was assumed                      |
 *  | How this was calculated          | conditional — column null on old rows |
 *  | Audit trail                      | conditional — column null on old rows |
 *  | Scenarios                        | conditional — no stored producer      |
 *  | Closing                          | Important information                 |
 *
 * `explanation` and `audit_trail` are columns the calculator now writes, null
 * on every row stored before its keep-update landed — so those pages render
 * nothing today and light up per row as new runs land, with no template
 * change. Scenario presets never reach a column at all (they only travel in a
 * render request), so that page stays dark by construction. The audit table is
 * capped at the projection's fourteen rows with a whole-sentence omission note
 * beyond that, which is what makes a fixed-position page safe against an
 * unbounded trail.
 *
 * ## Bindings
 *
 * Every figure binds the vocabulary `borrowingCapacityProjection.pure.ts`
 * publishes, which is itself read off the live table. Nothing here binds a
 * column name directly: the projection is the contract, and it is what keeps
 * `capacity.dti` a multiple rather than the percentage a reader would assume
 * from the column name.
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
  kpiCapacity,
  kpis,
  oneOf,
  page,
  prose,
  recommendation,
  rule,
  sectionHeading,
  table,
  textHeight,
  verdict,
  withFurniture,
  type KpiItem,
  type PageDef,
  renderTimePart,
  RENDER_TIME_NUMERAL,
} from './blocks';
import { hasContents } from './resolvers';
import { assembleMaster, type CompassSeedTemplate, type ReportFormat } from './master';
import { STANDARD_DISCLAIMER } from '../designSystem';

/**
 * The running foot on every content page.
 *
 * Not `{{client.name}}`, which is what this said until the Cash Flow format's
 * binding audit ran every master's paths against a real row.
 * `borrowing_capacity_assessments` has **no client-name column at all** — it
 * carries `client_id` — and `borrowingCapacityProjection.spec.ts` has always
 * asserted that `client.name` must stay absent rather than be invented. An
 * unresolved binding renders as the empty string, so every page of every
 * assessment was footed " · Borrowing capacity snapshot", and the cover title
 * — the largest type in the document — was blank.
 *
 * The band is what this document concludes and is set on all 143 assessments,
 * so it names the snapshot instead.
 */
const FOOTER = 'Borrowing capacity snapshot · {{capacity.bandLabel}}';
/** The left half of the running head. */
const DOCUMENT_LABEL = 'Borrowing Capacity Snapshot';

/**
 * The longest each bound prose field runs across the 143 stored assessments.
 *
 * Measured, because a height that is too small does not overflow the page — it
 * lays one block over the next, and the arithmetic guard in `flow()` cannot see
 * that. See `textHeight` in `blocks.ts`. Everything else this format binds is a
 * figure, a date or a lender name, and fits the one-line default.
 */
const LENGTHS = {
  /** 270 stored recommendations, 43-70 characters. */
  recommendation: 70,
  /** 63 stored warnings, 35-59. */
  warning: 59,
  /**
   * The legacy engine's executive summary, measured by running all 143
   * assessments through `buildSnapshot` itself: p50 358, p90 473, max 606.
   */
  narrative: 650,
  /**
   * Sized from the producer rather than production (the column is null on all
   * 143 stored rows): `generateExplanationServer`'s longest format string is
   * the expenses step with the property-cashflow rider, ~120 characters with
   * production-sized figures. 160 covers it with a figure's worth of slack.
   */
  explanationStep: 160,
} as const;

const BORROWING_CAPACITY_FORMAT: ReportFormat = {
  key: 'borrowing-capacity',
  // Resolved by the adapter registry to `borrowingCapacityAdapter`, which reads
  // `borrowing_capacity_assessments`. That is what makes these production-ready
  // rather than preview-only.
  reportType: 'borrowing_capacity',
  category: 'finance',
  tier: 'compass',
  label: 'Borrowing Capacity Snapshot',
  extraTags: ['borrowing-capacity', 'serviceability', 'lending'],
};

/**
 * The figures across the top of the summary.
 *
 * Ordered by what a client asks first. `capacity.dti` is a **multiple** of
 * income, not a percentage — the column is `dti_ratio` and reads like a rate,
 * which is exactly why it is set with `| fixed` and labelled "× income".
 */
const SUMMARY_KPIS: KpiItem[] = [
  {
    label: 'Borrowing capacity',
    value: '{{capacity.borrowing | currency}}',
    note: 'At the assessment rate',
  },
  {
    label: 'Stress tested',
    value: '{{capacity.stressTested | currency}}',
    note: 'With the buffer applied',
  },
  {
    label: 'Monthly surplus',
    value: '{{capacity.monthlySurplus | currency}}',
    note: '{{capacity.annualSurplus | currency}} p.a.',
  },
  {
    label: 'Debt to income',
    value: '{{capacity.dti | fixed:1}}',
    note: '× assessable income',
  },
  {
    label: 'Proposed loan',
    value: '{{loan.proposed | currency}}',
    note: '{{loan.lvr | percent}} LVR',
  },
  {
    label: 'Assessment rate',
    value: '{{loan.assessmentRate | percent}}',
    note: '{{loan.interestRate | percent}} + {{loan.bufferRate | percent}} buffer',
  },
];

function buildTemplate(family: DesignFamily, variant: VariantDefinition): CompassSeedTemplate {
  const manifest = resolveManifest(family, variant);
  const c = beginCompassTemplate(family, variant, manifest);
  const spacious = manifest.density === 'spacious';

  const nextPart = renderTimePart;
  const nextNumeral = (): string => RENDER_TIME_NUMERAL;

  const pages: PageDef[] = [];

  // ── 01 Cover ─────────────────────────────────────────────────────────────
  pages.push(cover({
    wordmarkTop: '{{org.name}}',
    wordmarkBottom: 'Borrowing Capacity',
    tagline: 'Your dedicated property partner',
    marker: 'Borrowing Capacity',
    /*
     * The applicants.
     *
     * This slot used to read "Borrowing capacity snapshot", which the cover
     * already says twice — `wordmarkBottom` and `marker` both carry it — while
     * the one thing a cover is normally expected to carry, whose assessment it
     * is, was nowhere on the page.
     *
     * It sits here rather than in `locations` because the eyebrow is a single
     * bound path with no literal beside it: an assessment without a resolvable
     * client prints no eyebrow, where "Prepared for " next to an empty binding
     * would print a preposition with nothing after it. `client.name` is
     * published only when there is a name, and carries both applicants when
     * there are two — 33 of the 143 stored assessments are joint.
     */
    eyebrow: '{{client.name}}',
    // The conclusion, not the applicants — they are the eyebrow above it.
    // `bandLabel` is derived from `serviceability_band`, set on all 143.
    title: '{{capacity.bandLabel}}',
    standfirst: 'What a lender would advance on the income, commitments and buffer stated inside.',
    locations: 'Prepared {{report.generatedDate | date}}',
    facts: [
      { label: 'Capacity', value: '{{capacity.borrowing | currency}}' },
      { label: 'Stress tested', value: '{{capacity.stressTested | currency}}' },
      { label: 'Assessment rate', value: '{{loan.assessmentRate | percent}}' },
      // Was `{{loan.lender}}`, which is `assumptions.selectedLenderName` and is
      // set on 26 of the 143 — a blank fact on 82% of covers. The surplus is
      // stored on all 143 and is the figure the band is a judgement about.
      { label: 'Monthly surplus', value: '{{capacity.monthlySurplus | currency}}' },
    ],
  }));

  // ── Contents, where the family declares one ──────────────────────────────
  if (hasContents(manifest.toc_style)) {
    pages.push(withFurniture(page('Contents', [
      ...furniture(DOCUMENT_LABEL, nextPart('Contents'), 'Contents'),
      ...flow([
        sectionHeading({ eyebrow: 'In this snapshot', heading: 'Contents', numeral: nextNumeral() }),
        contents([
          'The position and the figures behind it',
          'The assessment in brief',
          'Income analysis',
          'Commitments',
          'How the assessment reads',
          'What was assumed',
          'Serviceability and recommendations',
          'Important information',
        ]),
      ], contentTop()),
    ]), FOOTER));
  }

  // ── 02 Capacity summary ──────────────────────────────────────────────────
  pages.push(withFurniture(page('Capacity summary', [
    ...furniture(DOCUMENT_LABEL, nextPart('Position'), 'Capacity summary'),
    ...flow([
      sectionHeading({
        eyebrow: 'The position',
        heading: '{{capacity.bandLabel}}',
        // `bandLabel`'s three values, longest first: "Serviceable with limited
        // headroom" (33) — see `borrowingCapacityProjection.pure.ts:286`.
        headingChars: 33,
        numeral: nextNumeral(),
      }),
      verdict({
        eyebrow: 'Assessed capacity',
        heading: '{{capacity.borrowing | currency}}',
        body: 'Assessed on {{income.shaded | currency}} of shaded income against '
          + '{{expenses.annual | currency}} of living expenses and '
          + '{{liabilities.annual | currency}} of existing commitments, at an assessment '
          + 'rate of {{loan.assessmentRate | percent}}.',
      }),
      kpis(SUMMARY_KPIS.slice(0, kpiCapacity())),
      callout(
        'What this means',
        'Capacity is what a lender would advance at the stated assessment rate, not a '
        + 'pre-approval. It moves with the rate, with your commitments, and with the '
        + 'lender\'s own policy.',
      ),
    ], contentTop()),
  ]), FOOTER));

  // ── 02b The assessment in brief ──────────────────────────────────────────
  //
  // The legacy document opens with a written summary, and the snapshot
  // projection restates it verbatim from `buildSnapshot` — the paragraph
  // carries its own figures through `formatMeasure`, so nothing here rebinds
  // them. Utilisation exists on 66 of 143 assessments; its callout carries a
  // whole-sentence verdict so nothing strands when it is absent.
  pages.push({
    ...withFurniture(page('The assessment', [
      ...furniture(DOCUMENT_LABEL, nextPart('Summary'), 'The assessment'),
      ...flow([
        sectionHeading({
          eyebrow: 'In brief',
          heading: 'How this assessment reads',
          numeral: nextNumeral(),
        }),
        prose('{{summary.narrative}}', textHeight(LENGTHS.narrative)),
        {
          ...callout(
            'Proposed loan against capacity',
            '{{utilisation.verdict}} The proposed {{utilisation.proposedLoan | currency}} '
            + 'is {{utilisation.shareLabel}} of the assessed '
            + '{{utilisation.capacity | currency}}.',
          ),
          conditional: 'utilisation && utilisation.verdict',
        },
      ], contentTop()),
    ]), FOOTER),
    conditional: 'summary && summary.narrative',
  });

  // ── 03 Income ────────────────────────────────────────────────────────────
  pages.push(withFurniture(page('Income analysis', [
    ...furniture(DOCUMENT_LABEL, nextPart('Income'), 'Income analysis'),
    ...flow([
      sectionHeading({
        eyebrow: 'Assessable income',
        heading: 'What counts, and what is shaded',
        numeral: nextNumeral(),
        standfirst: 'Lenders discount income they consider less certain. The shaded column '
          + 'is what the assessment actually used.',
      }),
      /*
       * `income.rows` is the legacy engine's own composition (label, gross,
       * assessed-at rate, shaded). Three depths under mutually exclusive
       * conditionals: production holds one to seven components, clustered at
       * two (66 of 143) — one seven-row table would rule off five empty rows
       * beneath the commonest report, and the four-row table this replaces
       * silently dropped rows five to seven of the deep ones. `shadingLabel`
       * is the retention rate the engine applied ("100%" means unshaded), so
       * the column head says what the number is.
       */
      (() => {
        const incomeTable = (n: number) => table({
          headers: ['Component', 'Gross', 'Assessed at', 'Assessed'],
          rows: [
            ...Array.from({ length: n }, (_, i) => [
              `{{income.rows.${i}.label}}`,
              `{{income.rows.${i}.gross | currency}}`,
              `{{income.rows.${i}.shadingLabel}}`,
              `{{income.rows.${i}.shaded | currency}}`,
            ]),
            ['Total assessable', '{{income.gross | currency}}', '', '{{income.shaded | currency}}'],
          ],
          columnWidths: [0.43, 0.19, 0.15, 0.23],
          totals: [n],
          // A component label runs to 65 characters in production, which
          // wraps to two lines in this column.
          wraps: { chars: 65, columnWidth: c.contentWidth * 0.43 },
        });
        return oneOf(
          { when: 'income && income.rows && income.rows.length <= 2', item: incomeTable(2) },
          { when: 'income && income.rows && income.rows.length > 2 && income.rows.length <= 4', item: incomeTable(4) },
          { when: 'income && income.rows && income.rows.length > 4', item: incomeTable(7) },
        );
      })(),
      callout(
        'Shading applied',
        '{{income.shadingApplied | currency}} of gross income was discounted before '
        + 'the assessment. The rate against each component is the lender\'s, not ours.',
      ),
    ], contentTop()),
  ]), FOOTER));

  // ── 04 Commitments ───────────────────────────────────────────────────────
  pages.push(withFurniture(page('Commitments', [
    ...furniture(DOCUMENT_LABEL, nextPart('Commitments'), 'Commitments'),
    ...flow([
      sectionHeading({
        eyebrow: 'Outgoings',
        heading: 'Living expenses and existing debt',
        numeral: nextNumeral(),
      }),
      table({
        headers: ['Living expenses', 'Monthly', 'Annual'],
        rows: [
          ['{{expenses.methodLabel}}', '{{expenses.monthly | currency}}', '{{expenses.annual | currency}}'],
          ['Declared', '{{expenses.declared | currency}}', ''],
          ['HEM benchmark', '{{expenses.hemBenchmark | currency}}', ''],
        ],
        columnWidths: [0.5, 0.25, 0.25],
      }),
      /*
       * `liabilities.rows` carries the legacy engine's display label — kind
       * plus provider, composed in the projection so a template cannot strand
       * the separator. Three depths: production holds none to six, clustered
       * at one to three (91 of 143) — the three-row table this replaces
       * silently dropped half of a deep report's commitments, and one six-row
       * table would rule off five empty rows beside a single credit card. A
       * report with no liabilities at all (26 of 143) draws no table, which
       * is the truthful rendering of no commitments.
       */
      (() => {
        const liabilityTable = (n: number) => table({
          headers: ['Liability', 'Balance', 'Limit', 'Monthly'],
          rows: [
            ...Array.from({ length: n }, (_, i) => [
              `{{liabilities.rows.${i}.label}}`,
              `{{liabilities.rows.${i}.balance | currency}}`,
              `{{liabilities.rows.${i}.limit | currency}}`,
              `{{liabilities.rows.${i}.servicing | currency}}`,
            ]),
            ['Total servicing', '', '', '{{liabilities.monthly | currency}}'],
          ],
          columnWidths: [0.37, 0.21, 0.21, 0.21],
          totals: [n],
          wraps: { chars: 48, columnWidth: c.contentWidth * 0.37 },
        });
        return oneOf(
          { when: 'liabilities && liabilities.rows && liabilities.rows.length <= 1', item: liabilityTable(1) },
          { when: 'liabilities && liabilities.rows && liabilities.rows.length > 1 && liabilities.rows.length <= 3', item: liabilityTable(3) },
          { when: 'liabilities && liabilities.rows && liabilities.rows.length > 3', item: liabilityTable(6) },
        );
      })(),
    ], contentTop()),
  ]), FOOTER));

  // ── 04b How the assessment reads ─────────────────────────────────────────
  //
  // The legacy document's ledger, restated verbatim by the projection from
  // `buildSnapshot`. `amountLabel` is the formatted measure with its unit —
  // "$302,640 pa" beside "-$2,200/mo" is the point of a ledger, and a bare
  // `| currency` filter would erase the distinction. Eight rows by
  // construction: the engine builds exactly eight.
  pages.push({
    ...withFurniture(page('How the assessment reads', [
      ...furniture(DOCUMENT_LABEL, nextPart('Ledger'), 'How the assessment reads'),
      ...flow([
        sectionHeading({
          eyebrow: 'The ledger',
          heading: 'From income to capacity',
          numeral: nextNumeral(),
        }),
        table({
          headers: ['Line', 'Amount'],
          rows: Array.from({ length: 8 }, (_, i) => [
            `{{ledger.rows.${i}.label}}`,
            `{{ledger.rows.${i}.amountLabel}}`,
          ]),
          columnWidths: [0.62, 0.38],
          totals: [7],
        }),
        callout(
          'Reading the ledger',
          'Income lines are annual, outgoings are monthly, and the deductions are '
          + 'shown with their sign. The final line is what the assessment concluded.',
        ),
      ], contentTop()),
    ]), FOOTER),
    conditional: 'ledger && ledger.rows',
  });

  // ── 04c What was assumed ─────────────────────────────────────────────────
  //
  // The legacy document prints every assumption the run recorded — five to 17
  // in production, clustered at eleven (88 of 143) — so the table is drawn at
  // three depths, and the split points follow the cluster: a nine-row split
  // here once put the commonest report in the 17-row table with six ruled
  // empty rows under it.
  //
  // No `wraps` here, deliberately. Measured over all 143 production runs, the
  // labels top out at 26 characters and every value but one fits a line in the
  // 0.55 column — the exception is the 59-character existing-loan stress-rate
  // sentence, and no report carries more than one value over 40. Charging every
  // row the wrapped height (the `wraps` contract) put the 17-row variant 54 to
  // 120pt past the footer; the honest budget is flat rows plus two spare lines
  // for the one that wraps.
  {
    const wrapSlack = 2 * Math.round(c.scale.cell * 1.6);
    const assumptionRows = (n: number) => {
      const t = table({
        headers: ['Assumption', 'Value'],
        rows: Array.from({ length: n }, (_, i) => [
          `{{assumptions.rows.${i}.label}}`,
          `{{assumptions.rows.${i}.value}}`,
        ]),
        columnWidths: [0.45, 0.55],
      });
      return { height: t.height + wrapSlack, block: t.block };
    };
    pages.push({
      ...withFurniture(page('What was assumed', [
        ...furniture(DOCUMENT_LABEL, nextPart('Assumptions'), 'What was assumed'),
        ...flow([
          sectionHeading({
            eyebrow: 'The inputs',
            heading: 'What this assessment assumed',
            numeral: nextNumeral(),
          }),
          oneOf(
            { when: 'assumptions && assumptions.rows && assumptions.rows.length <= 7', item: assumptionRows(7) },
            { when: 'assumptions && assumptions.rows && assumptions.rows.length > 7 && assumptions.rows.length <= 11', item: assumptionRows(11) },
            { when: 'assumptions && assumptions.rows && assumptions.rows.length > 11', item: assumptionRows(17) },
          ),
        ], contentTop()),
      ]), FOOTER),
      conditional: 'assumptions && assumptions.rows',
    });
  }

  // ── 05 Serviceability ────────────────────────────────────────────────────
  pages.push(withFurniture(page('Serviceability', [
    ...furniture(DOCUMENT_LABEL, nextPart('Serviceability'), 'Serviceability'),
    ...flow([
      sectionHeading({
        eyebrow: 'How the assessment was set',
        heading: 'The rate, the buffer and the term',
        numeral: nextNumeral(),
      }),
      // Every definition here is a figure or a lender name — one line, which is
      // the default reserve. Measured, not assumed: `assumptions
      // .selectedLenderName` is at most 30 characters.
      /*
       * No 'Lender' row: `loan.lender` is set on 26 of 143, and a definition
       * list prints its term whether or not the definition resolves — a
       * stranded "Lender" label on 82% of reports. The lender moved to the
       * conditional callout below. Debt-to-income took its place; the ratio is
       * on all 143 rows and `dtiLabel` is the legacy engine's own formatting.
       */
      definitions('Assessment basis', [
        { term: 'Debt to income', definition: '{{capacity.dtiLabel}}' },
        { term: 'Interest rate used', definition: '{{loan.interestRate | percent}}' },
        { term: 'Serviceability buffer', definition: '{{loan.bufferRate | percent}}' },
        { term: 'Assessment rate', definition: '{{loan.assessmentRate | percent}}' },
        { term: 'Loan term', definition: '{{loan.termYears}} years' },
        { term: 'Expense method', definition: '{{expenses.methodLabel}}' },
      ]),
      {
        ...callout(
          'Lender policy',
          'This assessment was run under {{report.lenderName}} policy settings.',
        ),
        conditional: 'report && report.lenderName',
      },
      // 3 of 143 assessments carry LMI. The page must not print an empty panel
      // for the other 140, so the whole block is conditional on the projection
      // having emitted an LMI namespace at all.
      {
        ...callout(
          'Lenders mortgage insurance',
          'LMI of {{lmi.amount | currency}} applies above {{lmi.lvrTrigger | percent}} LVR '
          + 'and is included in the figures above.',
        ),
        conditional: 'lmi && lmi.amount',
      },
      rule(),
      // 146 characters of fixed copy — two lines at every family's measure, so
      // the height is taken from the text rather than guessed generous. The
      // guessed 76-92pt put pb-03 seven points past the footer.
      prose(
        'Capacity is assessed at a rate above the one you would pay, so the loan stays '
        + 'serviceable if rates move. It is not a pre-approval and not an offer.',
        textHeight(150, { extra: 10 }),
      ),
    ], contentTop()),
  ]), FOOTER));

  // ── 05b How the engine reached this ──────────────────────────────────────
  //
  // The `explanation` column is null on every stored row (the calculator's
  // keep-update post-dates them all), so these pages are sized from the
  // producer: `generateExplanationServer` emits eight unconditional steps,
  // plus one for a non-default lender policy and one for LMI — eight to ten,
  // never fewer. Ten three-line definitions do not fit one page, so the legacy
  // section becomes two: steps one to five here, the rest on a continuation
  // page conditional on there being a rest. The headline goes in an 'In short'
  // callout exactly as the legacy render sets it — at heading size its ~80
  // characters would wrap to three display lines on the tighter families.
  //
  // The continuation page draws its list three times at one position under
  // mutually exclusive step-count conditionals (8, 9, 10), the assumptions
  // table's own pattern — a definition row whose bindings resolve empty still
  // prints its ruled band, so a fixed ten-row list would rule off two empty
  // rows on the commonest report.
  pages.push({
    ...withFurniture(page('How this was calculated', [
      ...furniture(DOCUMENT_LABEL, nextPart('Method'), 'How this was calculated'),
      ...flow([
        sectionHeading({
          eyebrow: 'The method',
          heading: 'How the engine reached this figure',
          numeral: nextNumeral(),
        }),
        {
          ...callout('In short', '{{explanation.headline}}'),
          conditional: 'explanation && explanation.headline',
        },
        definitions('Steps', Array.from({ length: 5 }, (_, i) => ({
          term: `{{explanation.steps.${i}.title}}`,
          definition: `{{explanation.steps.${i}.narrative}}`,
        })), LENGTHS.explanationStep),
      ], contentTop()),
    ]), FOOTER),
    conditional: 'explanation && explanation.steps',
  });
  {
    const stepRows = (from: number, to: number) => definitions(
      'Steps, continued',
      Array.from({ length: to - from }, (_, i) => ({
        term: `{{explanation.steps.${from + i}.title}}`,
        definition: `{{explanation.steps.${from + i}.narrative}}`,
      })),
      LENGTHS.explanationStep,
    );
    pages.push({
      ...withFurniture(page('How this was calculated, continued', [
        ...furniture(DOCUMENT_LABEL, nextPart('Method'), 'How this was calculated'),
        ...flow([
          sectionHeading({
            eyebrow: 'The method, continued',
            heading: 'The remaining steps',
            numeral: nextNumeral(),
          }),
          oneOf(
            { when: 'explanation && explanation.steps && explanation.steps.length <= 8', item: stepRows(5, 8) },
            { when: 'explanation && explanation.steps && explanation.steps.length == 9', item: stepRows(5, 9) },
            { when: 'explanation && explanation.steps && explanation.steps.length > 9', item: stepRows(5, 10) },
          ),
        ], contentTop()),
      ]), FOOTER),
      conditional: 'explanation && explanation.steps && explanation.steps.length > 5',
    });
  }

  // ── 05c The audit trail ──────────────────────────────────────────────────
  // The `audit_trail` column is likewise null on every stored row and cascades
  // per run. The builder writes one entry per adjustment with no ceiling, so
  // the projection caps at fourteen — the row count that fits the tightest
  // family with the omission callout beneath (twenty ran the spacious -03
  // variants up to 61pt past the footer) — and says what it left out in a
  // whole sentence rather than omitting silently. The item cell arrives
  // composed as the legacy table sets it: category caption, em-rule, label.
  pages.push({
    ...withFurniture(page('The audit trail', [
      ...furniture(DOCUMENT_LABEL, nextPart('Audit'), 'The audit trail'),
      ...flow([
        sectionHeading({
          eyebrow: 'Raw against assessed',
          heading: 'What the engine adjusted',
          numeral: nextNumeral(),
        }),
        (() => {
          const auditTable = (n: number) => table({
            headers: ['Item', 'Raw', 'Assessed', 'Change'],
            rows: Array.from({ length: n }, (_, i) => [
              `{{audit.rows.${i}.label}}`,
              `{{audit.rows.${i}.rawLabel}}`,
              `{{audit.rows.${i}.assessedLabel}}`,
              `{{audit.rows.${i}.deltaLabel}}`,
            ]),
            columnWidths: [0.4, 0.2, 0.2, 0.2],
          });
          return oneOf(
            { when: 'audit && audit.rows && audit.rows.length <= 7', item: auditTable(7) },
            { when: 'audit && audit.rows && audit.rows.length > 7', item: auditTable(14) },
          );
        })(),
        {
          ...callout('Further entries', '{{audit.omissionNote}}'),
          conditional: 'audit && audit.omissionNote',
        },
      ], contentTop()),
    ]), FOOTER),
    conditional: 'audit && audit.rows',
  });

  // ── 05d Scenarios ────────────────────────────────────────────────────────
  // Saved what-if presets, when the export came from the scenario modeller.
  pages.push({
    ...withFurniture(page('Scenarios', [
      ...furniture(DOCUMENT_LABEL, nextPart('Scenarios'), 'Scenarios'),
      ...flow([
        sectionHeading({
          eyebrow: 'What if',
          heading: 'Scenarios modelled beside this assessment',
          numeral: nextNumeral(),
        }),
        table({
          headers: ['Scenario', 'Capacity', 'Surplus', 'Band'],
          rows: Array.from({ length: 6 }, (_, i) => [
            `{{scenarios.rows.${i}.name}}`,
            `{{scenarios.rows.${i}.capacity | currency}}`,
            `{{scenarios.rows.${i}.surplus | currency}}`,
            `{{scenarios.rows.${i}.bandLabel}}`,
          ]),
          columnWidths: [0.34, 0.22, 0.22, 0.22],
          wraps: { chars: 46, columnWidth: c.contentWidth * 0.34 },
        }),
      ], contentTop()),
    ]), FOOTER),
    conditional: 'scenarios && scenarios.rows',
  });

  // ── 06 Recommendations ───────────────────────────────────────────────────
  pages.push(withFurniture(page('Recommendations', [
    ...furniture(DOCUMENT_LABEL, nextPart('Recommendations'), 'Recommendations'),
    ...flow([
      sectionHeading({
        eyebrow: 'What would move this',
        heading: 'Recommendations',
        numeral: nextNumeral(),
      }),
      // 43-70 characters an item across the 270 stored recommendations, which
      // is one to two lines at this measure — not the single line a definition
      // list reserves by default. See `textHeight` in `blocks.ts`: a height
      // that is too small does not overflow the page, it lays this block over
      // the one below it, and the arithmetic guard cannot see that.
      definitions('Actions', [
        { term: 'First', definition: '{{recommendations.0}}' },
        { term: 'Second', definition: '{{recommendations.1}}' },
        { term: 'Third', definition: '{{recommendations.2}}' },
      ], LENGTHS.recommendation),
      // Warnings are present on 41 of 143 assessments.
      {
        ...definitions('Warnings', [
          { term: 'Note', definition: '{{warnings.0}}' },
          { term: 'Note', definition: '{{warnings.1}}' },
        ], LENGTHS.warning),
        conditional: 'warnings && warnings[0]',
      },
      recommendation(
        '{{capacity.bandLabel}}',
        'Assessed capacity of {{capacity.borrowing | currency}}, stress tested to '
        + '{{capacity.stressTested | currency}}.',
      ),
    ], contentTop()),
  ]), FOOTER));

  pages.push(disclaimerPage(STANDARD_DISCLAIMER));

  return assembleMaster({ family, variant, manifest, c, pages, format: BORROWING_CAPACITY_FORMAT });
}

/** Every Borrowing Capacity master, by family, in catalogue order. */
export const BORROWING_CAPACITY_TEMPLATES: CompassSeedTemplate[] = DESIGN_FAMILIES.flatMap(
  (family) => family.variants.map((variant) => buildTemplate(family, variant)),
);

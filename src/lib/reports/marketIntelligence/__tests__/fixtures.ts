/**
 * Fictional Market Intelligence rows.
 *
 * Structurally faithful to the six real reports — eight layer keys, the same
 * prose block names, the same `marketEvents` shape, `includedLayers` in the
 * short form the edge function writes — and invented in every particular. No
 * client, no tenant and no figure here is real.
 */

export const LAYER_KEYS = [
  'layer1_rba',
  'layer2_housing',
  'layer3_sentiment',
  'layer4_regulatory',
  'layer5_outlook',
  'layer6_economic',
  'layer7_micro',
  'layer8_competitive_edge',
] as const;

export const REPORT_ID = '33333333-3333-4333-8333-333333333333';
export const PREPARED_ON = '2026-08-03T00:00:00.000Z';

/**
 * Enough prose to clear `MIN_SECTION_CHARS`, in the model's own register.
 *
 * No two calls produce the same paragraph. The version this replaced varied one
 * decimal — `3.60%`, `3.70%`, `3.80%` — inside an otherwise identical sentence,
 * so a twenty-two page render carried the same two paragraphs on nine
 * consecutive sheets. That is not a rendering fault, but it makes the document
 * impossible to read for one, and it fired the critique rubric's only `high`
 * rule seven times on the fixture, which meant the rule could not have caught a
 * real repetition.
 */
const OPENERS = [
  'The cash rate held through the quarter, with the board’s statement noting trimmed-mean inflation inside the target band.',
  'Housing credit grew faster than at any point since 2022, and investor lending took a decade-high share of new commitments.',
  'Consumer sentiment recovered four points off its March low, though it remains below the long-run average.',
  'The prudential regulator left the serviceability buffer unchanged and signalled no review before the new year.',
  'Dwelling approvals fell for a third consecutive month, with the decline concentrated in attached housing.',
  'Unemployment ticked up a tenth while participation held, which the board read as a loosening rather than a weakening.',
  'Advertised rents rose across every capital, with the steepest movement in the smaller markets.',
  'Fixed-rate expiries peaked in the December quarter and the arrears data has not yet moved with them.',
];

const SECONDS = [
  'What that means for a buyer here is narrow: it changes the price of debt, not the supply of houses.',
  'The effect on this market is second-order, arriving through borrowing capacity rather than through demand.',
  'Local stock levels are the binding constraint, and nothing in the quarter’s data moved them.',
  'It matters more to a seller deciding when to list than to a buyer deciding whether to.',
  'For a leveraged holder the sensitivity runs through the loan, and the loan reprices before the rent does.',
];

export function prose(seed = 0, paragraphs = 2): string {
  const n = Math.abs(seed);
  return Array.from({ length: paragraphs }, (_, i) => {
    const k = n + i * 3;
    return `${OPENERS[k % OPENERS.length]} ${SECONDS[k % SECONDS.length]} `
      + `The figure to watch is **${(3.6 + (k % 9) * 0.15).toFixed(2)}%**, which is where the `
      + 'series sat when this report was assembled.';
  }).join('\n\n');
}

const MOVED = [
  'Housing credit growth accelerated for the fourth month',
  'Investor share of new lending reached a decade high',
  'Days on market shortened by six across the capitals',
  'Auction clearance held above 65% for eight consecutive weekends',
  'New listings ran 12% below the five-year average for the month',
  'Rental vacancy fell below 1.2% in every mainland capital',
  'Approvals for attached dwellings fell to a nine-year low',
  'Fixed-rate expiries passed their peak without a rise in arrears',
  'The gap between advertised and achieved rent narrowed to 1.8%',
  'First-home buyer share of new lending rose two points',
];

export function layerBody(seed = 0): string {
  // Spread, so that layer 3's first paragraph is not layer 0's second. A layer
  // draws three paragraphs at `n`, `n + 3` and `n + 5`; consecutive seeds
  // overlap on two of the three, which is how eight layers produced seven
  // duplicate-block findings. The offset keeps them clear of the prose blocks
  // outside the layers, which use small seeds.
  const n = 100 + Math.abs(seed) * 11;
  return `## Overview\n\n${prose(n)}\n\n### What moved\n\n`
    + `- ${MOVED[n % MOVED.length]}\n`
    + `- ${MOVED[(n * 3 + 4) % MOVED.length]}\n\n`
    + `### What it means\n\n${prose(n + 5, 1)}`;
}

export function events(n: number): Array<Record<string, unknown>> {
  return Array.from({ length: n }, (_, i) => ({
    date: `2026-0${(i % 8) + 1}-${String((i % 27) + 1).padStart(2, '0')}`,
    event: `Reserve Bank board meeting ${i + 1}`,
    category: ['interest_rate', 'economic', 'housing', 'regulatory', 'seasonal'][i % 5],
    impact: ['positive', 'negative', 'neutral'][i % 3],
    description: 'The board is expected to hold, with the statement watched for any change to the '
      + 'language around the trimmed mean.',
    relevance_score: 80 - i,
  }));
}

export const cites = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `Reserve Bank of Australia, Statement on Monetary Policy, chart ${i + 1}`);

export interface RowOverrides {
  row?: Record<string, unknown>;
  data?: Record<string, unknown>;
}

/** A completed `full` report with every layer populated. */
export function reportRow(over: RowOverrides = {}): Record<string, unknown> {
  return {
    id: REPORT_ID,
    status: 'completed',
    report_period: 'April 2026',
    report_type: 'full',
    audience_segment: 'general',
    include_advisory_strategy: true,
    generated_at: '2026-04-22T03:00:00.000Z',
    report_data: {
      generatedAt: '2026-04-22T03:00:00.000Z',
      reportPeriod: 'April 2026',
      reportType: 'full',
      reportTypeLabel: 'Full Market Intelligence Report',
      audienceSegment: 'general',
      executiveSummary: `## Executive Summary\n\n${prose(0, 3)}`,
      keyInsightsSnapshot: '## Your 60-Second Briefing\n\n'
        + '- The cash rate held for a third meeting\n'
        + '- Investor lending reached a decade-high share of new commitments\n'
        + '- Completions fall sharply next year against the ten-year average\n'
        + '- Vacancy is less than half the decade average across the sub-market\n'
        + '- Two states have flagged land tax changes; neither has legislated',
      actionableStrategy: `### What To Do Now\n\n${prose(1, 1)}\n\n### What To Avoid\n\n${prose(2, 1)}`,
      ctaContent: `### Where to start\n\n${prose(4, 1)}`,
      includedLayers: [
        'executive', 'key_insights', 'layer1', 'layer2', 'layer3', 'layer4',
        'layer5', 'layer6', 'layer7', 'layer8', 'actionable_strategy', 'events', 'cta',
      ],
      ...Object.fromEntries(
        LAYER_KEYS.map((k, i) => [k, { content: layerBody(i), citations: cites(3) }]),
      ),
      marketEvents: events(12),
      allCitations: cites(21),
      ...(over.data ?? {}),
    },
    ...(over.row ?? {}),
  };
}

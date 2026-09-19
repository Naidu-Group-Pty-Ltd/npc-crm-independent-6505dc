/**
 * The report type an editable copy of a conversion is filed under.
 *
 * A converted template can be turned into a real Template Builder template, and
 * a template row carries a `report_type` — the adapter key from
 * `reportTemplate/adapters/index.ts`. That key is what the template list filters
 * on and what `resolveTemplate` matches, so filing a converted Cash Flow
 * template as `borrowing_capacity` does not just mislabel it: it makes it
 * resolvable for the wrong report.
 *
 * This was a constant while Borrowing Capacity was the only bindable format,
 * with a comment saying it would need to be a map when a second one arrived.
 * All eight migrated formats are bindable now, so here is the map.
 *
 * Two of them have no natural home in the archetype-to-adapter correspondence
 * and got their own preview-only adapters: Client Details and Market
 * Intelligence. Cash Flow Comparison files under `cashflow` rather than
 * `comparison` — its payload is cash flow projections, and `comparison` is the
 * property comparison's key. `converterChapters.spec.ts` asserts every bindable
 * format resolves through `getAdapter`.
 */
import type { ReportArchetypeId } from '@/lib/reportDesign/structure.pure';

export const CONVERTED_REPORT_TYPES: Record<ReportArchetypeId, string> = {
  'borrowing-capacity': 'borrowing_capacity',
  'cash-flow-projection': 'cashflow',
  'cash-flow-comparison': 'cashflow',
  'client-details': 'client_details',
  'portfolio-performance': 'portfolio',
  'property-comparison': 'comparison',
  'market-intelligence': 'market_intelligence',
  'report-qa': 'qa',
  'commercial-capacity': 'commercial_capacity',
  // Not bindable, and listed so this map stays exhaustive over the archetype
  // union — a new archetype fails the compiler here rather than falling back to
  // whatever the last format happened to be.
  'investment-compass': 'investment',
  'financial-analysis': 'investment',
  snapshot: 'investment',
};

/**
 * The Portfolio adapter's review join.
 *
 * The adapter shipped without it: `applyPortfolioProjection` takes the
 * client's newest completed `portfolio_reviews` row as its third argument —
 * the join `render-portfolio-review-pdf` performs before building the same
 * document — and the adapter called it with two. The review, scenario and
 * per-property-score pages therefore rendered in the production-fit harness,
 * which does the join, and never through the product path: silently the same
 * output as `includeReview: false` on every render. This file pins the join,
 * clause for clause, against the route's own shape.
 *
 * ## The join now travels to a broker, and one clause could not travel with it
 *
 * Neither table is readable from the browser: `portfolio_analysis_reports` is
 * `generated_by = auth.uid()` or a client join, `portfolio_reviews` is a client
 * join, and `auth.uid()` is always NULL under this app's custom cookie session
 * (see `adapters/secureSource.ts`). Both reads moved to `get-client-data`, so
 * the clauses are now a payload rather than a builder chain, and this file
 * asserts them there.
 *
 * The one clause that does not survive the move is `nullsFirst: false`: the
 * broker's list mode takes an order column and a direction and nothing else,
 * and Postgres puts NULLs **first** on a DESC order. A review with no
 * `review_date` would therefore be handed back ahead of every dated one. The
 * adapter takes a small page and prefers the first dated row, which is what the
 * route's join means by "newest completed" — and that substitution is pinned
 * below, because it is the half a reader would not expect.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

interface BrokerCall { name: string; payload: Record<string, any> }

const harness: {
  rows: Record<string, unknown | null>;
  errors: Record<string, { message: string } | null>;
  calls: BrokerCall[];
} = { rows: {}, errors: {}, calls: [] };

/**
 * `get-client-data`, answering out of the same seeded rows the table stub used
 * to. List mode for a non-`clients` table answers `{ success, records }`; that
 * is the broker's own shape, and `secureSource.ts` reads exactly it.
 */
vi.mock('@/lib/secureInvoke', () => ({
  invokeSecureFunction: async (name: string, payload: Record<string, any>) => {
    harness.calls.push({ name, payload });
    const table = String(payload?.listOptions?.table ?? 'clients');
    if (harness.errors[table]) return { data: null, error: harness.errors[table] };
    const seeded = harness.rows[table] ?? null;
    const records = seeded === null ? [] : (Array.isArray(seeded) ? seeded : [seeded]);
    return { data: { success: true, records, count: records.length }, error: null };
  },
}));

// `organisation.ts` still reads the two public letterhead tables on the browser
// client, which is legitimate — `whitelabel_settings` is world-readable — so
// the stub stays, answering empty.
vi.mock('@/integrations/supabase/client', () => {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    in: () => chain,
    maybeSingle: async () => ({ data: null, error: null }),
    then: (onOk: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(onOk),
  };
  return { supabase: { from: () => chain } };
});

import { portfolioAdapter } from '../adapters/portfolioAdapter';
import { resetOrganisationCache } from '../adapters/organisation';

const ANALYSIS_ROW = {
  id: 'a4d5a570-0000-4000-8000-000000000001',
  client_id: 'c4d5a570-0000-4000-8000-000000000002',
  client_name: 'Jordan & Sarah Nguyen',
  health_score: 68,
  portfolio_value: 3_410_000,
  updated_at: '2026-08-12T00:00:00.000Z',
  // One holding, because `buildPortfolioReview` refuses a row with none — and
  // the review namespaces publish only through that build, which is exactly
  // why the adapter's missing join was invisible: the projection's own half
  // still rendered.
  report_data: {
    propertyAnalyses: [{ address: '9/44 Regent Street, Newtown', currentValue: 1_125_000 }],
  },
};

const REVIEW_ROW = {
  status: 'completed',
  review_date: '2026-08-02T14:16:14.279Z',
  risk_level: 'medium',
  overall_score: 55,
  executive_summary: 'Portfolio review completed with an overall score of 55/100.',
};

/** The last list-mode call the adapter made for `table`. */
const lastListCall = (table: string) => [...harness.calls]
  .reverse()
  .find((c) => c.name === 'get-client-data' && c.payload?.listOptions?.table === table)
  ?.payload.listOptions as Record<string, any> | undefined;

beforeEach(() => {
  harness.rows = {
    portfolio_analysis_reports: ANALYSIS_ROW,
    portfolio_reviews: REVIEW_ROW,
    whitelabel_settings: null,
  };
  harness.errors = {};
  harness.calls = [];
  resetOrganisationCache();
});

describe('the review join', () => {
  it('performs the route\'s own join, clause for clause', async () => {
    await portfolioAdapter.buildBindingContext({ reportId: ANALYSIS_ROW.id });

    const review = lastListCall('portfolio_reviews');
    expect(review, 'no portfolio_reviews read was made').toBeTruthy();
    // `render-portfolio-review-pdf`'s clauses, as the broker takes them: the
    // client, completed only, newest `review_date` first.
    expect(review!.filters).toEqual({
      client_id: ANALYSIS_ROW.client_id,
      status: 'completed',
    });
    expect(review!.orderBy).toBe('review_date');
    expect(review!.orderAsc).toBe(false);
  });

  it('prefers a dated review, because the broker cannot say nulls-last', async () => {
    // Postgres puts NULLs first on a DESC order and the broker takes no
    // `nullsFirst`, so an undated review arrives ahead of the one the route
    // would have chosen. Reading `rows[0]` here would put an empty review on
    // the page and look like a projection fault.
    harness.rows.portfolio_reviews = [
      { ...REVIEW_ROW, review_date: null, executive_summary: 'Undated draft.' },
      REVIEW_ROW,
    ];
    const ctx = await portfolioAdapter.buildBindingContext({ reportId: ANALYSIS_ROW.id });
    expect((ctx?.data.portfolio as Record<string, any>)?.review?.summary)
      .toBe('Portfolio review completed with an overall score of 55/100.');
  });

  it('asks for more than one row, so there is a dated one to prefer', async () => {
    await portfolioAdapter.buildBindingContext({ reportId: ANALYSIS_ROW.id });
    // `limit: 1` would reinstate the bug above: the undated row would be the
    // only row.
    expect(lastListCall('portfolio_reviews')!.limit).toBeGreaterThan(1);
  });

  it('hands the review to the projection, so the review pages can render', async () => {
    const ctx = await portfolioAdapter.buildBindingContext({ reportId: ANALYSIS_ROW.id });
    const portfolio = ctx?.data.portfolio as Record<string, any>;
    expect(portfolio?.review?.summary)
      .toBe('Portfolio review completed with an overall score of 55/100.');
    // The normaliser words the level for the page: 'medium' → 'Medium'.
    expect(portfolio?.review?.riskLevel).toBe('Medium');
  });

  it('builds a thinner document, not a failed one, when the read errors', async () => {
    // The route's own posture: a review that cannot be read is a warning, and
    // the projection treats null exactly as `includeReview: false`.
    //
    // The warning is the broker's now rather than the adapter's, because the
    // broker is where the distinction still exists — it answers `[]` for a
    // refusal and for an empty table alike, and treating those the same is how
    // the whole anon-read class stayed silent.
    harness.errors.portfolio_reviews = { message: 'permission denied' };
    harness.rows.portfolio_reviews = null;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ctx = await portfolioAdapter.buildBindingContext({ reportId: ANALYSIS_ROW.id });
    expect(ctx).toBeTruthy();
    expect((ctx?.data.portfolio as Record<string, any> | undefined)?.review).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('portfolio_reviews'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('permission denied'));
    warn.mockRestore();
  });

  it('asks for no review when the analysis names no client', async () => {
    harness.rows.portfolio_analysis_reports = { ...ANALYSIS_ROW, client_id: null };
    await portfolioAdapter.buildBindingContext({ reportId: ANALYSIS_ROW.id });
    expect(lastListCall('portfolio_reviews')).toBeUndefined();
  });

  it('reads neither table on the browser client', async () => {
    await portfolioAdapter.buildBindingContext({ reportId: ANALYSIS_ROW.id });
    // Both go through the broker, which is the whole reason this format can
    // render at all: on the browser client both reads came back empty for
    // every report and every user.
    for (const table of ['portfolio_analysis_reports', 'portfolio_reviews']) {
      expect(
        harness.calls.some((c) => c.payload?.listOptions?.table === table),
        `${table} was not read through get-client-data`,
      ).toBe(true);
    }
  });
});

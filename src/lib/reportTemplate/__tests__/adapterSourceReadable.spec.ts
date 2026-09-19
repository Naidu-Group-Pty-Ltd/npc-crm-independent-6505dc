/**
 * No adapter reads a table the browser cannot see, on the browser client.
 *
 * ## The defect
 *
 * Command Centre identity is a custom HttpOnly-cookie session, not a Supabase
 * Auth session — `src/integrations/supabase/client.ts` creates the client with
 * the anon key and `persistSession: false`, so `auth.uid()` is **always NULL**
 * in the browser and the client's role is **always `anon`**.
 *
 * Sixteen of the tables the report adapters read are unreachable from there,
 * for three different reasons that all look identical from the caller's seat:
 *
 *   an `auth.uid()`-gated policy   investment_reports, clients, portfolio_*, …
 *   a policy for `authenticated`   marketing_intelligence_reports,
 *                                  report_structure_templates
 *   service-role only, or the      commercial_industrial_*, client_*,
 *   anon table GRANT revoked       report_qa_*
 *
 * A `supabase.from(...)` read of any of them therefore returns **zero rows for
 * every record and every user** — not an error, an empty result. The adapters
 * read `maybeSingle()`, answered `null`, the router read `null` as "this
 * adapter refuses this record", and the caller fell through to the legacy
 * generator. So a person could choose a template, be told the choice was kept,
 * and receive the standard layout every single time.
 *
 * It is also the mechanical explanation for `docs/reports/COVERAGE.md`: of the
 * nine active premium templates, the three that had ever rendered a document
 * are exactly the three whose data does not come from one of these tables.
 *
 * ## The rule, and what this file actually checks
 *
 * An adapter reads through something that holds a service-role client and
 * scopes the read to the verified session user: a named broker in
 * `secureSource.ts`, or the `authenticated-data` gateway client. Never the anon
 * browser client.
 *
 * So the check is on the **receiver**, not on the table name. `db().from('x')`
 * and `supabase.from('x')` are the same eleven characters after the dot and
 * opposite answers to this question, and an earlier version of this file that
 * scanned for `.from('<table>')` alone could not tell them apart — it would
 * have failed the fix and passed nothing extra. What it means is that the anon
 * client must not be the thing on the left, in any adapter, for any of these
 * tables.
 *
 * The list is deliberately a measurement rather than a policy: it names the
 * tables *observed* to return nothing, with the dates. Widening it is how a
 * newly-restricted table joins the rule.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BROWSER_INVISIBLE_TABLES } from '@/lib/reportTemplate/adapters/secureSource';

const ADAPTERS = join(__dirname, '../adapters');

const stripComments = (source: string) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/**
 * The identifier the anon browser client is bound to. It is the default export
 * name of `@/integrations/supabase/client` and every file in the repo uses it
 * under that name, which is what makes a source scan able to see it at all.
 */
const ANON_CLIENT = 'supabase';

/**
 * Does this file read `table` with the anon client as the receiver?
 *
 * These reads are written as a chain across four or five lines, so the
 * whitespace *around the dots* is closed up first and the receiver then sits
 * immediately before `.from(`. Only around the dots: collapsing every run of
 * whitespace would join `await` to `supabase` and destroy the very token
 * boundary the pattern needs — which is what the first draft of this file did,
 * and it passed a deliberately reintroduced defect. `detectsBothReceivers`
 * below is here so that cannot happen again silently.
 *
 * The leading class rejects a longer identifier ending in the same letters —
 * `getAuthenticatedSupabaseClient()` is not `supabase`, and neither is a
 * property access like `client.supabase`.
 */
const closeUpChains = (code: string) => code.replace(/\s*\.\s*/g, '.');

const readsWithAnonClient = (code: string, table: string) => new RegExp(
  `(^|[^\\w$.])${ANON_CLIENT}\\.from\\('${table}'\\)`,
).test(closeUpChains(code));

const adapterFiles = readdirSync(ADAPTERS)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'));

describe('the invisible-table list', () => {
  it('names every table measured unreadable in production', () => {
    // Sorted, so the assertion is about membership rather than about the order
    // the module happens to group them in. Three were measured 2026-08-14 and
    // the remaining fourteen on 2026-08-16; `secureSource.ts` records why each
    // one is invisible and what the browser saw against what is there.
    expect([...BROWSER_INVISIBLE_TABLES].sort()).toEqual([
      'borrowing_capacity_assessments',
      'client_assets',
      'client_employment',
      'client_expenses',
      'client_liabilities',
      'client_properties',
      'clients',
      'commercial_industrial_assessments',
      'commercial_industrial_calculation_runs',
      'investment_reports',
      'marketing_intelligence_reports',
      'portfolio_analysis_reports',
      'portfolio_reviews',
      'property_comparisons',
      'report_qa_conversations',
      'report_qa_messages',
      'report_structure_templates',
    ]);
  });
});

describe('the detector', () => {
  /*
   * A source scan that cannot see the defect it names passes for ever and
   * proves nothing. This holds it against both receivers, in the multi-line
   * shape the adapters actually use.
   */
  const anonRead = `
    const { data, error } = await supabase
      .from('clients')
      .select('*')
      .maybeSingle();
  `;
  const gatewayRead = `
    const { data, error } = await db()
      .from('clients')
      .select('*')
      .maybeSingle();
  `;

  it('sees a read on the anon client, written across lines', () => {
    expect(readsWithAnonClient(anonRead, 'clients')).toBe(true);
  });

  it('does not see a read on the gateway client as one', () => {
    expect(readsWithAnonClient(gatewayRead, 'clients')).toBe(false);
  });

  it('does not mistake a longer identifier for the anon client', () => {
    const direct = "await getAuthenticatedSupabaseClient().from('clients').select('*')";
    expect(readsWithAnonClient(direct, 'clients')).toBe(false);
  });

  it('does not report a table the file never reads', () => {
    expect(readsWithAnonClient(anonRead, 'investment_reports')).toBe(false);
  });
});

describe('every adapter', () => {
  it.each(adapterFiles)('%s reads no browser-invisible table on the anon client', (file) => {
    const code = stripComments(readFileSync(join(ADAPTERS, file), 'utf8'));
    const offenders = BROWSER_INVISIBLE_TABLES.filter(
      (table) => readsWithAnonClient(code, table),
    );
    expect(
      offenders,
      `${file} reads ${offenders.join(', ')} through the anon browser client, which `
      + 'returns zero rows under this app\'s custom auth — the read answers "no such '
      + 'record" for every record. Use a broker from secureSource.ts, or the gateway '
      + 'client from getAuthenticatedSupabaseClient().',
    ).toEqual([]);
  });

  /*
   * The receiver check above is only as good as the set of receivers that can
   * exist. `createClient` is the one way to make a fourth client inside this
   * directory and skip the question entirely, so it is refused outright — the
   * two authorised clients are both imported, never constructed here.
   */
  it.each(adapterFiles)('%s constructs no Supabase client of its own', (file) => {
    const code = stripComments(readFileSync(join(ADAPTERS, file), 'utf8'));
    expect(
      code.includes('createClient('),
      `${file} builds its own Supabase client. Import a broker from `
      + 'secureSource.ts or the gateway client from useAuthenticatedSupabase.',
    ).toBe(false);
  });

  it('the ones that need an authorised read path import one', () => {
    // Every adapter whose entry record lives in an invisible table. If one of
    // these stops importing an authorised path, it is reading its record some
    // other way and that way needs the same scrutiny.
    const AUTHORISED = ['./secureSource', 'useAuthenticatedSupabase'];
    const files = [
      'borrowingCapacityAdapter.ts',
      'cashFlowAdapter.ts',
      'clientDetailsAdapter.ts',
      'commercialCapacityAdapter.ts',
      'comparisonAdapter.ts',
      'investmentReportAdapter.ts',
      'marketIntelligenceAdapter.ts',
      'portfolioAdapter.ts',
      'qaAdapter.ts',
    ];
    for (const file of files) {
      const code = stripComments(readFileSync(join(ADAPTERS, file), 'utf8'));
      expect(
        AUTHORISED.some((path) => code.includes(path)),
        `${file} no longer reads through a broker or the gateway`,
      ).toBe(true);
    }
  });
});

describe('the brokers themselves', () => {
  const code = stripComments(readFileSync(join(ADAPTERS, 'secureSource.ts'), 'utf8'));

  it('go through the secure invoke path, never the browser client', () => {
    expect(code).toContain('invokeSecureFunction');
    expect(code).not.toContain("from '@/integrations/supabase/client'");
  });

  it('answer null rather than throwing, so a caller’s fallback stays one line', () => {
    // Every failure is a fallback: the caller's next line is the generator
    // that has produced this document for the life of the product.
    const catches = code.match(/catch\s*\{\s*return (null|\[\]);\s*\}/g) ?? [];
    expect(catches.length).toBeGreaterThanOrEqual(4);
  });
});

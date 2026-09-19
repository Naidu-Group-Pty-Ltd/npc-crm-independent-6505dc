/**
 * The Client Details Form's Template Builder adapter.
 *
 * The sixth production report type, and the second — after the Property
 * Comparison — that does almost nothing itself. The format already has a
 * normaliser feeding `render-client-details-pdf`, and every hard question about
 * this record is answered there: which of nine tables a figure comes from, that
 * stored aggregates like `clients.total_portfolio_value` are never read, that
 * frequencies are converted through one function, that council and water rates
 * are annual despite their `monthly_` prefix. So this loads the nine tables,
 * hands them to `buildClientDetails`, and projects the result.
 *
 * `docs/reports/CLIENT_DETAILS.md` is the contract.
 *
 * ## Nine reads, and the error is checked before the data on every one
 *
 * A failed query returns no rows, and for this format an empty result is
 * indistinguishable from a client who genuinely has none — 742 of the 775
 * clients have no property, no employment, no asset, no liability and no
 * expense. So a read that *errors* must not be treated as a read that returned
 * nothing: that would print a client's document with their liabilities silently
 * missing, on a document whose entire purpose is being sent to a broker.
 *
 * The render route makes the same check for the same reason, in the same words.
 *
 * ## The clock is passed in
 *
 * `buildClientDetails` takes `now` because nothing in the pure modules reads a
 * clock. The adapter is the edge, so the adapter supplies it.
 */
import {
  listClientRows,
  listClientScopedRows,
  loadClientRecord as loadClientRecordSecure,
} from './secureSource';
import { buildClientDetails, composeClientName } from '@/lib/reports/clientDetails/normalise.pure';
import { applyClientDetailsProjection } from '../../../../supabase/functions/_shared/clientDetailsProjection.pure';
import { CLIENT_NAME_COLUMNS } from '../../../../supabase/functions/_shared/clientName';
import { applyOrganisationAndBrand } from './organisation';
import type {
  BrandContext, ReportListing, ReportTemplateAdapter, RoutingContext, TemplateBindingContext,
} from './types';

interface ClientRecord {
  client: Record<string, any>;
  properties: unknown;
  employment: unknown;
  income: unknown;
  incomeSources: unknown;
  assets: unknown;
  liabilities: unknown;
  expenses: unknown;
  addressHistory: unknown;
}

/**
 * The nine tables, or null.
 *
 * Null on a missing client and null on **any** read error — see the header. The
 * caller turns that into the legacy fallback, which is the right outcome: a
 * document that cannot be shown to be complete must not be produced at all.
 */
async function loadClientRecord(clientId: string): Promise<ClientRecord | null> {
  // One authorised call rather than nine direct reads.
  //
  // `clients`' only non-service SELECT policy is `created_by = auth.uid()`,
  // and this app's identity is a custom cookie session, so `auth.uid()` is
  // NULL in the browser: the direct read returned no client for anybody, this
  // function answered null for every client in the database, and the format
  // fell through to its legacy generator every time. See `secureSource.ts`.
  //
  // The broker's `include` keys are this record's keys, and it applies the
  // same `is_active` filter to income sources, so the shape below is the shape
  // that was being assembled here.
  const record = await loadClientRecordSecure(clientId, {
    properties: true,
    employment: true,
    income: true,
    incomeSources: true,
    assets: true,
    liabilities: true,
    expenses: true,
    addressHistory: true,
  });
  if (!record?.client) return null;

  return {
    client: record.client as Record<string, any>,
    properties: record.properties ?? [],
    employment: record.employment ?? [],
    income: record.income ?? [],
    incomeSources: record.incomeSources ?? [],
    assets: record.assets ?? [],
    liabilities: record.liabilities ?? [],
    expenses: record.expenses ?? [],
    addressHistory: record.addressHistory ?? [],
  };
}

/**
 * The columns a name is composed from, for the two reads that only need one.
 *
 * `CLIENT_NAME_COLUMNS` is the sanctioned spelling of the four name columns
 * and is used rather than restated — this function shipped selecting
 * `first_name, last_name`, and **neither column exists on `clients`**, so
 * PostgREST answered `42703` for the whole statement, the error branch
 * returned null, and routing declined every client in the database while
 * `buildBindingContext` (which selects `*`) worked in every harness. The same
 * misspelling 404'd `render-borrowing-capacity-pdf` for every client once
 * before, which is why that constant exists.
 *
 * The middle names are added on top of it: the document composes its subject's
 * name from all three parts, and this read exists to say what the document
 * will say. They are not in the shared constant because
 * `clientDisplayName` — the Borrowing Capacity Snapshot's cover — deliberately
 * prints two parts, and widening the constant would quietly change what a
 * different format's caller receives.
 */
const NAME_COLUMNS =
  `${CLIENT_NAME_COLUMNS}, primary_middle_name, secondary_middle_name`;

/**
 * The clients who have any financial record at all, for the picker's ordering.
 *
 * Five reads of one column each, against the five sparse tables — 794 rows in
 * total today, resolving to 34 distinct clients. A table this caller cannot
 * read contributes nothing rather than failing the list: the ordering is a
 * preference, and a picker ordered by recency is still a picker.
 *
 * The identifiers are capped before they become an `.in(...)` filter, because
 * that clause is a query string and an unbounded one is a 414 rather than a
 * slow request. At the current size the cap is never reached; it is here so
 * that the day these tables fill, the picker degrades to "the first 200
 * clients with records" instead of failing outright.
 */
const MAX_RECORDED_IDS = 200;

async function clientIdsWithRecords(): Promise<string[]> {
  // Through the broker. All five are service-role-only, so on the browser
  // client every one of these returned an empty result and the picker offered
  // no client at all — the same silence `secureSource.ts` documents.
  const tables = [
    'client_properties', 'client_assets', 'client_liabilities',
    'client_employment', 'client_expenses',
  ];
  const results = await Promise.all(
    tables.map((table) => listClientScopedRows(table, { select: 'client_id' })),
  );

  const ids = new Set<string>();
  for (const rows of results) {
    for (const row of rows as Array<{ client_id?: unknown }>) {
      if (typeof row.client_id === 'string' && row.client_id) ids.add(row.client_id);
    }
  }
  return [...ids].slice(0, MAX_RECORDED_IDS);
}

/** Just the client row, for routing — nine reads to decide a title is waste. */
async function loadClientRow(clientId: string): Promise<Record<string, any> | null> {
  // Through the broker: `clients` is invisible to the browser client under
  // this app's custom auth, so this read decided "no such client" for every
  // client and routing declined the format outright. See `secureSource.ts`.
  //
  // The broker returns the whole client row rather than `NAME_COLUMNS`; that
  // constant stays because it documents what the *document* composes a name
  // from, and the two name reads below still project it.
  const record = await loadClientRecordSecure(clientId, { properties: false });
  return (record?.client as Record<string, any>) ?? null;
}

export const clientDetailsAdapter: ReportTemplateAdapter = {
  reportType: 'client_details',
  label: 'Client Details',
  supportsProduction: true,
  legacyFallback: {
    label: 'Client Details legacy generator',
    reason:
      'FormaraPDFGenerator remains the default until a template is activated for this report type. '
      + 'It rasterises every page, so nothing in its output is selectable — which is the whole of '
      + 'this migration’s value.',
  },

  /**
   * Recent clients, the ones with something to show first.
   *
   * Ordering by `updated_at` alone made this picker nearly useless for its own
   * purpose. **34 of the 775 clients have any property, asset, liability,
   * employment or expense record at all**, so twenty of the most recently
   * touched are twenty documents of empty tables — and the whole reason to
   * preview against a real record is to see how the design holds your own
   * numbers.
   *
   * It is not sorted *entirely* by that, because a client with a name and
   * nothing else is not an edge case in this format, it is the ordinary one
   * (see D5 in `docs/reports/CLIENT_DETAILS.md`) and the masters are built
   * around it. So most of the list is clients with records and the rest is
   * whatever is most recent, which keeps both shapes one click away.
   */
  async listRecentReports({ limit = 20 }: { limit?: number } = {}): Promise<ReportListing[]> {
    try {
      const listing = (row: Record<string, any>): ReportListing => ({
        id: String(row.id),
        // The document's own name for its subject, so the picker and the page
        // it renders agree.
        label: composeClientName(row),
        savedAt: (row.updated_at as string) ?? (row.created_at as string) ?? null,
      });

      const recorded = new Set(await clientIdsWithRecords());

      // One brokered page, partitioned here rather than two filtered reads:
      // `clients` is invisible to the browser client, so both reads returned
      // nothing and this picker was empty for everybody. The page is drawn
      // wider than the limit so the clients-with-records half still has
      // something to find in it.
      const page = await listClientRows({
        select: `${NAME_COLUMNS}, updated_at, created_at`,
        orderBy: 'updated_at',
        limit: Math.min(200, Math.max(limit * 4, 50)),
      });
      const withRecords = page.filter((row) => recorded.has(String(row.id)));
      const recent = page;

      const out: ReportListing[] = [];
      const seen = new Set<string>();
      for (const row of [...withRecords, ...recent]) {
        const id = String(row.id);
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(listing(row));
        if (out.length >= limit) break;
      }
      return out;
    } catch {
      return [];
    }
  },

  async resolveRoutingContext({ reportId }): Promise<RoutingContext | null> {
    const row = await loadClientRow(reportId);
    if (!row) return null;
    // The document's own composition, not a second one: the middle name the
    // eleven records that carry one print, the household's `A & B` for the
    // thirteen that describe two people, and the same casing. A file titled
    // for a different person than the pages name is a small wrong that is
    // very visible on a document sent to a broker.
    const name = composeClientName(row);
    return {
      reportId,
      reportType: 'client_details',
      variant: null,
      tier: null,
      title: name !== 'Client' ? `Client details — ${name}` : 'Client details',
      fileLabel: 'client-details',
      sourceTable: 'clients',
      legacyFallback: clientDetailsAdapter.legacyFallback,
    };
  },

  async buildBindingContext(
    { reportId, brand }: { reportId: string; brand?: BrandContext | null },
  ): Promise<TemplateBindingContext | null> {
    const record = await loadClientRecord(reportId);
    if (!record) return null;

    let details;
    try {
      details = buildClientDetails({
        client: record.client,
        properties: record.properties,
        employment: record.employment,
        income: record.income,
        incomeSources: record.incomeSources,
        assets: record.assets,
        liabilities: record.liabilities,
        expenses: record.expenses,
        addressHistory: record.addressHistory,
        now: new Date().toISOString(),
      });
    } catch {
      // `ClientDetailsPayloadError` — a record the normaliser refuses is a
      // record this format must not draw a document from.
      return null;
    }

    const data: Record<string, any> = {
      report: {
        id: record.client.id,
        type: 'client_details',
        generated_at: record.client.updated_at ?? record.client.created_at,
      },
      // The raw row stays bound under its own column names, as with the other
      // adapters, so anything already keyed on one keeps resolving.
      record: record.client,
      brand: {
        tokens: brand?.tokens ?? {},
        logo: brand?.logoUrl ?? null,
      },
    };

    applyClientDetailsProjection(data, details);
    await applyOrganisationAndBrand(data);

    return {
      data,
      meta: { reportId, reportType: 'client_details', variant: null, tier: null },
    };
  },
};

/**
 * Read one area's series from the open-data sales register.
 *
 * Not pure — it takes the service client — but thin: the lookup is by the
 * register's token (`salesAreaToken`), so the cadastre's council name, the
 * boundary service's postcode and the geography's suburb all resolve in one
 * indexed read, and the publisher's own label comes back on the rows for
 * the adapter to print. Two wider series travel beside it for the benchmark
 * points: the publisher's state-wide row where one exists (Queensland's
 * "Total (all monitored regions)", DCJ's "New South Wales"), otherwise the
 * ABS state series; and the ABS national series, the benchmark for a
 * state-level reading.
 *
 * A read that FAILED throws; an area the register does not hold answers no
 * rows — the two are different answers and the caller records them
 * differently (docs/aml/CASE_TENANT_COLUMN.md's rule).
 */
import {
  type SalesMedianRow,
  type SalesRegisterState,
  SALES_STATE_LABELS,
  salesAreaToken,
} from './openData/salesRegister.pure.ts';
import { finiteOrNull } from './registerCell.pure.ts';

export type SalesRegisterAskKind = 'suburb' | 'lga' | 'postcode' | 'state';

export interface SalesRegisterQuery {
  state: SalesRegisterState;
  areaKind: SalesRegisterAskKind;
  /** The caller's name for the area — a suburb, a cadastre LGA, a postcode, or the state itself. */
  area: string;
}

export interface SalesRegisterRead {
  rows: SalesMedianRow[];
  /** The state-wide series: the publisher's own, else the ABS state row. */
  benchmarkRows: SalesMedianRow[];
  /** The ABS national series (`AU`), or empty where not loaded. */
  nationalRows: SalesMedianRow[];
  /** The publisher's own label for the area, or null where nothing matched. */
  areaLabel: string | null;
  /** The newest load stamp on the rows, or null. */
  loadedAt: string | null;
  /** The newest archive capture stamp on the rows, or null where the publisher served them. */
  capturedAt: string | null;
}

/** The publisher's state-wide row, where a register carries one. */
export const BENCHMARK_AREA: Partial<Record<SalesRegisterState, string>> = {
  QLD: 'Total (all monitored regions)',
  NSW: 'New South Wales',
};

const SELECT = 'area, area_kind, dwelling_type, period, median_price, sales_count, loaded_at, price_measure, period_span, captured_at';

interface RegisterRow {
  area: string;
  area_kind: string;
  dwelling_type: string;
  period: string;
  median_price: number | string | null;
  sales_count: number | null;
  loaded_at: string | null;
  price_measure: string | null;
  period_span: string | null;
  captured_at: string | null;
}

function toRow(state: SalesRegisterState, r: RegisterRow): SalesMedianRow {
  return {
    state,
    areaKind: r.area_kind as SalesMedianRow['areaKind'],
    area: r.area,
    dwellingType: r.dwelling_type as SalesMedianRow['dwellingType'],
    period: r.period,
    // `finiteOrNull`, not `=== null ? … : Number(…)`. This register grades
    // the Growth dimension, prints medians in a client's document and backs
    // the Financials tab's Estimate CGR — and a NaN median is worse than an
    // absent one, because `null` is what every consumer here branches on
    // while NaN walks past all of them. See that module's header.
    medianPrice: finiteOrNull(r.median_price),
    salesCount: finiteOrNull(r.sales_count),
    priceMeasure: r.price_measure === 'mean' ? 'mean' : 'median',
    periodSpan: r.period_span === 'year' ? 'year' : 'quarter',
    capturedAt: r.captured_at ?? null,
  };
}

const newest = (rows: RegisterRow[], key: 'loaded_at' | 'captured_at'): string | null =>
  rows.reduce<string | null>((latest, r) => (r[key] && (!latest || (r[key] as string) > latest) ? (r[key] as string) : latest), null);

// deno-lint-ignore no-explicit-any
async function readStateSeries(supabase: any, state: SalesRegisterState): Promise<RegisterRow[]> {
  const { data, error } = await supabase
    .from('market_sales_medians')
    .select(SELECT)
    .eq('state', state)
    .eq('area_kind', state === 'AU' ? 'national' : 'state')
    .limit(1000);
  if (error) throw new Error(`market_sales_medians ${state} series read failed: ${error.message}`);
  return (data ?? []) as RegisterRow[];
}

// deno-lint-ignore no-explicit-any
export async function readSalesRegister(supabase: any, query: SalesRegisterQuery): Promise<SalesRegisterRead> {
  let areaRows: RegisterRow[];
  if (query.areaKind === 'state') {
    areaRows = await readStateSeries(supabase, query.state);
  } else {
    const token = salesAreaToken(query.areaKind, query.area);
    const { data, error } = await supabase
      .from('market_sales_medians')
      .select(SELECT)
      .eq('state', query.state)
      .eq('area_kind', query.areaKind)
      .eq('area_token', token)
      .limit(2000);
    if (error) throw new Error(`market_sales_medians read failed: ${error.message}`);
    areaRows = (data ?? []) as RegisterRow[];
  }
  const rows = areaRows.map((r) => toRow(query.state, r));

  // The state-wide benchmark: the publisher's own row where the register has
  // one, else the ABS state series. For a state-level ask the benchmark is
  // the national series.
  let benchmarkRows: SalesMedianRow[] = [];
  const nationalRows = (await readStateSeries(supabase, 'AU')).map((r) => toRow('AU', r));
  if (query.areaKind === 'state') {
    benchmarkRows = nationalRows;
  } else {
    const publisherArea = BENCHMARK_AREA[query.state];
    if (publisherArea) {
      const { data: bench, error: benchError } = await supabase
        .from('market_sales_medians')
        .select(SELECT)
        .eq('state', query.state)
        .eq('area_kind', 'region')
        .eq('area', publisherArea)
        .limit(1000);
      if (benchError) throw new Error(`market_sales_medians benchmark read failed: ${benchError.message}`);
      benchmarkRows = ((bench ?? []) as RegisterRow[]).map((r) => toRow(query.state, r));
    }
    if (!benchmarkRows.length) {
      benchmarkRows = (await readStateSeries(supabase, query.state)).map((r) => toRow(query.state, r));
    }
  }

  return {
    rows,
    benchmarkRows,
    nationalRows,
    areaLabel: rows[0]?.area ?? (query.areaKind === 'state' ? SALES_STATE_LABELS[query.state] : null),
    loadedAt: newest(areaRows, 'loaded_at'),
    capturedAt: newest(areaRows, 'captured_at'),
  };
}

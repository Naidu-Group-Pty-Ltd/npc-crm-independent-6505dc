/**
 * What every state's projection loader must hold before a row is written.
 *
 * The parsers differ — each jurisdiction lays its workbook out its own way,
 * and each parser is written against the file `state-projection-liveness`
 * described from CI, never against a layout typed from memory. What they
 * produce is one shape, and this module is the one gate it passes through on
 * the way to `population_projections`. It exists as a gate rather than as a
 * convention because every register this programme loads has been wrong in a
 * way a plausible-looking row hid:
 *
 *  - **A parse that found nothing is a refusal, never an empty load.** A
 *    zero-row "success" is the sanctions register's defect and the approvals
 *    walk's: it looks exactly like a publisher that published nothing.
 *  - **A ceiling bounds magnitude, per grain.** A column read one to the left
 *    turns a population into a year or an area code into a population, and
 *    the number still parses. The ceilings are generous by design — they catch
 *    drift, not growth — and a breach names the row.
 *  - **A series with no projected year is not a projection.** It is the
 *    estimated base alone, and printing that under a forward heading is the
 *    worst failure this register could commit.
 *  - **One base per series, and before every projected year.** A second base,
 *    or a base after a projected year, is a mis-marked column.
 *  - **The key is unique.** Two rows for one (edition, series, measure, area,
 *    year) mean the parser read one figure twice, and the upsert would keep
 *    whichever came last.
 *
 * Deno-compatible: explicit `.ts` extensions, no `@/` aliases. Pure.
 */
import type { ProjectionAreaKind, ProjectionMeasure, ProjectionRow } from './projectionRegister.pure.ts';
import { salesAreaToken, suburbToken } from './salesRegister.pure.ts';

/**
 * The lookup token a row is written with — the SAME rule
 * `readProjectionRegister` asks by, so a loaded council can be found by the
 * name the cadastre returns (`City of Onkaparinga` and `ONKAPARINGA CITY
 * COUNCIL` are one token) and a suburb by the resolved suburb. One function,
 * because a loader and a reader that normalise differently write rows no
 * query can reach — which looks exactly like a jurisdiction with nothing
 * loaded.
 */
export function projectionAreaToken(kind: ProjectionAreaKind, name: string): string {
  return kind === 'lga' ? salesAreaToken('lga', name) : suburbToken(name);
}

/** A row as a parser emits it; `loaded_at` is the database's. */
export type ProjectionLoadRow = Omit<ProjectionRow, 'loaded_at'>;

/**
 * The largest population an area of each grain can plausibly hold, in
 * persons. Chosen to catch a misread column, not to judge a projection: the
 * largest SA2 in the country holds tens of thousands, Brisbane City — the
 * largest LGA — about 1.3 million, New South Wales about 8.5 million today.
 */
export const PROJECTION_CEILING: Readonly<Record<ProjectionAreaKind, number>> = {
  sa2: 250_000,
  suburb: 250_000,
  sa3: 1_000_000,
  district: 1_000_000,
  lga: 4_000_000,
  sa4: 4_000_000,
  region: 12_000_000,
  gccsa: 12_000_000,
  state: 20_000_000,
};

/** Households and dwellings are bounded by persons; a looser bound serves both. */
const measureCeilingFactor = (m: ProjectionMeasure) => (m === 'persons' ? 1 : 0.8);

export type ProjectionGuard =
  | { ok: true; rows: ProjectionLoadRow[]; series: string[]; areaKinds: ProjectionAreaKind[]; firstYear: number; lastYear: number }
  | { ok: false; reason: string };

const keyOf = (r: ProjectionLoadRow) => [r.state, r.release, r.series, r.measure, r.area_kind, r.area_code, r.year].join('\u0001');

export function guardProjectionRows(rows: readonly ProjectionLoadRow[]): ProjectionGuard {
  if (rows.length === 0) return { ok: false, reason: 'the parse found no rows — refused, because an empty load reads exactly like a publisher that published nothing' };

  const seen = new Set<string>();
  for (const r of rows) {
    if (!Number.isFinite(r.value) || r.value < 0) {
      return { ok: false, reason: `${r.area} ${r.year} (${r.series}) reads ${r.value} — not a population` };
    }
    if (!Number.isInteger(r.year) || r.year < 1990 || r.year > 2100) {
      return { ok: false, reason: `${r.area} carries a year of ${r.year} — a column read out of place` };
    }
    const ceiling = PROJECTION_CEILING[r.area_kind] * measureCeilingFactor(r.measure);
    if (r.value > ceiling) {
      return { ok: false, reason: `${r.area} ${r.year} (${r.series}) reads ${Math.round(r.value).toLocaleString('en-AU')}, past the ${Math.round(ceiling).toLocaleString('en-AU')} a ${r.area_kind} can hold — unit or column drift` };
    }
    for (const [field, v] of [['release', r.release], ['series', r.series], ['area', r.area], ['area_code', r.area_code], ['area_token', r.area_token], ['publisher', r.publisher], ['source_url', r.source_url]] as const) {
      if (typeof v !== 'string' || v.trim() === '') return { ok: false, reason: `a row for ${r.area || '(no area)'} has no ${field}` };
    }
    const k = keyOf(r);
    if (seen.has(k)) return { ok: false, reason: `${r.area} ${r.year} (${r.series}, ${r.measure}) was read twice — one figure, two rows` };
    seen.add(k);
  }

  // Per series and area: one base at most, before every projected year, and a projected year at all.
  const bySeriesArea = new Map<string, ProjectionLoadRow[]>();
  for (const r of rows) {
    const k = [r.release, r.series, r.measure, r.area_kind, r.area_code].join('\u0001');
    bySeriesArea.set(k, [...(bySeriesArea.get(k) ?? []), r]);
  }
  for (const group of bySeriesArea.values()) {
    const bases = group.filter((r) => r.year_kind === 'base');
    const projected = group.filter((r) => r.year_kind === 'projected');
    const first = group[0];
    if (projected.length === 0) {
      return { ok: false, reason: `${first.area} (${first.series}) holds only its estimated base — an estimate is not a projection` };
    }
    if (bases.length > 1) {
      return { ok: false, reason: `${first.area} (${first.series}) marks ${bases.length} base years — a mis-marked column` };
    }
    if (bases.length === 1 && projected.some((p) => p.year <= bases[0].year)) {
      return { ok: false, reason: `${first.area} (${first.series}) projects a year at or before its base ${bases[0].year}` };
    }
  }

  const years = rows.map((r) => r.year);
  return {
    ok: true,
    rows: [...rows],
    series: [...new Set(rows.map((r) => r.series))].sort(),
    areaKinds: [...new Set(rows.map((r) => r.area_kind))],
    firstYear: Math.min(...years),
    lastYear: Math.max(...years),
  };
}

/** Upsert batches of a size PostgREST takes comfortably in one request. */
export function projectionBatches<T>(rows: readonly T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/**
 * Upsert batches that never split an AREA across two requests.
 *
 * A batch that fails leaves the batches before it written. Cut at a fixed
 * row count, that can leave one area holding its base and half its projected
 * years under a new edition — and the reader, which prefers the edition that
 * reaches furthest, would print that half-written series as the projection.
 * Cut at area boundaries, a failure leaves every area either whole or
 * untouched. An area larger than `size` gets a batch of its own.
 */
export function projectionBatchesByArea(rows: readonly ProjectionLoadRow[], size = 500): ProjectionLoadRow[][] {
  const byArea = new Map<string, ProjectionLoadRow[]>();
  for (const r of rows) {
    const k = [r.area_kind, r.area_code].join('\u0001');
    byArea.set(k, [...(byArea.get(k) ?? []), r]);
  }
  const out: ProjectionLoadRow[][] = [];
  let current: ProjectionLoadRow[] = [];
  for (const group of byArea.values()) {
    if (current.length > 0 && current.length + group.length > size) {
      out.push(current);
      current = [];
    }
    current.push(...group);
  }
  if (current.length > 0) out.push(current);
  return out;
}

/** The table's own key, for `upsert(..., { onConflict })`. */
export const PROJECTION_CONFLICT_KEY = 'state,release,series,measure,area_kind,area_code,year';

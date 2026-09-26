/**
 * A population projection, read from the register for one area, and the one
 * block a report may print from it.
 *
 * ── What this is for ─────────────────────────────────────────────────────
 *
 * `population_projections` holds each jurisdiction's own projection, series
 * by series, with the base year marked. This module turns one area's rows
 * into a reading and a reading into the block the report prompt carries.
 * Everything here is pure; the database read is `projectionRegisterRead.ts`.
 *
 * ── Five rules, each one a failure this programme has already paid for ────
 *
 *  1. **A projection is not a measurement.** No `EvidencePoint` is built from
 *     it, nothing here reaches the scorer, and the block states
 *     `A_PROJECTION_IS_NOT_A_MEASUREMENT` every time it prints a figure.
 *  2. **Every series is printed, and none is preferred.** WA publishes bands,
 *     Queensland low/medium/high. Choosing one is what `choices[0]` did to the
 *     ABS's 72 combinations, and it printed the maximum-growth corner as "the
 *     projection".
 *  3. **The base year is labelled as the estimate it is.** A projection table
 *     opens on the measured population it starts from; printing that under a
 *     forward heading as though projected is the worst failure available.
 *  4. **A region is not an area.** Only SA2, SA3 or the publisher's suburb
 *     describes the property's own area. Anything coarser is printed under a
 *     sentence saying it describes a region the property sits in.
 *  5. **Provenance travels with the figure** — publisher, edition, licence and
 *     the day the register took it — and a figure with none is not printed.
 *
 * Deno-compatible: explicit `.ts` extensions, no `@/` aliases.
 */
import { A_PROJECTION_IS_NOT_A_MEASUREMENT, PROJECTION_GRAIN_LABEL } from './absPopulationProjections.pure.ts';
import { forwardDemandCoverageNote, type ForwardDemandAvailability } from './forwardDemand.pure.ts';
import type { ProjectionState } from './stateProjectionPublishers.pure.ts';
import { auDate } from '../../../planning/auDate.pure.ts';

export type ProjectionAreaKind = 'sa2' | 'sa3' | 'sa4' | 'lga' | 'suburb' | 'district' | 'region' | 'gccsa' | 'state';

export const PROJECTION_AREA_KINDS: readonly ProjectionAreaKind[] = [
  'sa2', 'suburb', 'sa3', 'district', 'lga', 'region', 'sa4', 'gccsa', 'state',
];

export type ProjectionMeasure = 'persons' | 'households' | 'dwellings';

/** The grains that describe the property's OWN area. Everything else is a region it sits in. */
export const OWN_AREA_KINDS: readonly ProjectionAreaKind[] = ['sa2', 'sa3', 'suburb'];

export function projectionDescribesTheArea(kind: ProjectionAreaKind): boolean {
  return OWN_AREA_KINDS.includes(kind);
}

export const PROJECTION_AREA_LABEL: Readonly<Record<ProjectionAreaKind, string>> = {
  sa2: PROJECTION_GRAIN_LABEL.sa2,
  sa3: PROJECTION_GRAIN_LABEL.sa3,
  sa4: PROJECTION_GRAIN_LABEL.sa4,
  gccsa: PROJECTION_GRAIN_LABEL.gccsa,
  lga: PROJECTION_GRAIN_LABEL.lga,
  state: PROJECTION_GRAIN_LABEL.state,
  suburb: 'suburb, as the publisher defines it',
  district: 'district, as the publisher defines it — a group of suburbs',
  region: 'a region the publisher defines',
};

/** One row as the register stores it. */
export interface ProjectionRow {
  state: ProjectionState;
  release: string;
  series: string;
  measure: ProjectionMeasure;
  area_kind: ProjectionAreaKind;
  area_code: string;
  area: string;
  area_token: string;
  year: number;
  year_kind: 'base' | 'projected';
  value: number;
  publisher: string;
  source_url: string;
  licence: string | null;
  loaded_at: string;
}

export interface ProjectionPoint { year: number; value: number; base: boolean }

export interface ProjectionSeriesReading { series: string; points: ProjectionPoint[] }

export interface PopulationProjectionReading {
  state: ProjectionState;
  areaKind: ProjectionAreaKind;
  areaCode: string;
  area: string;
  measure: ProjectionMeasure;
  release: string;
  publisher: string;
  sourceUrl: string;
  licence: string | null;
  /** When the register took it — the newest load among the rows read. */
  loadedAt: string;
  /** Every series the publisher released for this area, in the publisher's order of labels. */
  series: ProjectionSeriesReading[];
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * One area's rows as a reading, or null where they cannot make one.
 *
 * One edition only: where the register holds two, the one whose projections
 * reach furthest is read, then the one taken most recently — a newer edition
 * sits beside an older one in the table and supersedes it here. Persons only,
 * because that is the figure every jurisdiction publishes. A series with no
 * projected year is dropped (a base alone is an estimate, not a projection);
 * a reading with no series left is null.
 */
export function readingFromRows(rows: readonly ProjectionRow[]): PopulationProjectionReading | null {
  const persons = rows.filter((r) => r.measure === 'persons' && finite(r.value) && finite(r.year));
  if (persons.length === 0) return null;

  const byRelease = new Map<string, ProjectionRow[]>();
  for (const r of persons) byRelease.set(r.release, [...(byRelease.get(r.release) ?? []), r]);
  const reach = (rs: ProjectionRow[]) => Math.max(...rs.map((r) => r.year));
  const newest = (rs: ProjectionRow[]) => rs.map((r) => r.loaded_at).sort().pop() ?? '';
  const [release, chosen] = [...byRelease.entries()]
    .sort(([, a], [, b]) => reach(b) - reach(a) || newest(b).localeCompare(newest(a)))[0];

  const bySeries = new Map<string, ProjectionPoint[]>();
  for (const r of chosen) {
    const points = bySeries.get(r.series) ?? [];
    points.push({ year: r.year, value: r.value, base: r.year_kind === 'base' });
    bySeries.set(r.series, points);
  }
  const series: ProjectionSeriesReading[] = [...bySeries.entries()]
    .map(([name, points]) => ({ series: name, points: [...points].sort((a, b) => a.year - b.year) }))
    .filter((s) => s.points.some((p) => !p.base))
    .sort((a, b) => a.series.localeCompare(b.series, 'en-AU', { numeric: true }));
  if (series.length === 0) return null;

  const first = chosen[0];
  return {
    state: first.state,
    areaKind: first.area_kind,
    areaCode: first.area_code,
    area: first.area,
    measure: 'persons',
    release,
    publisher: first.publisher,
    sourceUrl: first.source_url,
    licence: first.licence,
    loadedAt: newest(chosen),
    series,
  };
}

/**
 * The council a projection register may be asked by, from the planning
 * answer at the VERIFIED coordinate — or null.
 *
 * The register's LGA rung was written against `planningData.parcel.lga`
 * alone, which only Queensland's cadastre answers — so Victoria in Future and
 * Tasmania's Treasury, which project by council, would never have been found
 * for the states they cover. The zone layer names the council for NSW
 * (`LGA_NAME`), Victoria (Vicmap's `lga`) and Tasmania (the Local Provisions
 * Schedule's own name), and it is the same kind of fact as the parcel's: what
 * the state's own layer answers at the verified point, never a typed suburb or
 * a token parsed out of an address.
 *
 * The cadastre's answer outranks the zone layer's where both exist. The ACT is
 * refused: it has no councils, and its zoning `lga` is a DIVISION — a suburb —
 * which asked as a council would find nothing, or worse, a namesake.
 */
export function planningCouncilName(planningData: unknown): string | null {
  const p = (planningData ?? null) as {
    parcel?: { status?: unknown; lga?: unknown };
    zoning?: { status?: unknown; lga?: unknown; jurisdiction?: unknown };
  } | null;
  const trimmed = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
  if (p?.parcel?.status === 'ok') {
    const lga = trimmed(p.parcel.lga);
    if (lga) return lga;
  }
  if (p?.zoning?.status === 'ok' && p.zoning.jurisdiction !== 'ACT') return trimmed(p.zoning.lga);
  return null;
}

/**
 * The years a table shows: the base, then projected years stepping to the
 * horizon, at most `max` columns in all — the horizon is always one of them,
 * because a table that stops short of the publisher's own horizon misreports
 * how far the projection reaches.
 *
 * Five-yearly steps back from the horizon where the publisher's years allow
 * them, because that is how every jurisdiction presents its own tables and a
 * reader comparing this page with the publisher's should find the same years.
 */
export function projectionColumns(reading: PopulationProjectionReading, max = 6, asOfYear: number | null = null): number[] {
  const years = [...new Set(reading.series.flatMap((s) => s.points.map((p) => p.year)))].sort((a, b) => a - b);
  const baseYears = new Set(reading.series.flatMap((s) => s.points.filter((p) => p.base).map((p) => p.year)));
  const base = years.find((y) => baseYears.has(y)) ?? null;
  const allProjected = years.filter((y) => !baseYears.has(y));
  // A projected year already behind the report is not forward demand: a
  // 2022 figure in a 2026 report invites comparison with a history the table
  // does not print. The base stays — it is the estimate the projection starts
  // from — and where EVERY projected year is behind, the table is printed
  // whole rather than emptied, because an edition's horizon is still a fact.
  const ahead = asOfYear === null ? allProjected : allProjected.filter((y) => y >= asOfYear);
  const projected = ahead.length > 0 ? ahead : allProjected;
  if (projected.length === 0) return base === null ? [] : [base];
  const horizon = projected[projected.length - 1];
  const quinquennial = projected.filter((y) => (horizon - y) % 5 === 0);
  const pool = quinquennial.length >= 2 ? quinquennial : projected;
  const room = Math.max(1, max - (base === null ? 0 : 1));
  const picked: number[] = [];
  if (pool.length <= room) {
    picked.push(...pool);
  } else {
    // Evenly across the range, always ending on the horizon.
    for (let i = 1; i <= room; i++) picked.push(pool[Math.round((i * (pool.length - 1)) / room)]);
  }
  return [...(base === null ? [] : [base]), ...[...new Set(picked)].sort((a, b) => a - b)];
}

const formatCount = (v: number) => Math.round(v).toLocaleString('en-AU');

/**
 * The day the register took a reading, formatted for the reader: `auDate`, the
 * one date format a page shows. An ISO prefix is the right thing to STORE and
 * never the right thing to print — a delivered Compass once said "as read on
 * 2026-09-20" in prose beside tables reading "20 Sep 2026" (`auDate.pure.ts`).
 */
const dayOf = (iso: string) => auDate(iso) ?? iso;

/**
 * The block a report prompt carries for a held reading.
 *
 * A table the model may quote, the provenance beside it, and the rules that
 * bound what it may say. Never called for an absence — the absence sentence
 * is `forwardDemandCoverageNote`'s, and the two never appear together.
 */
export function projectionTableBlock(reading: PopulationProjectionReading, asOfYear: number | null = null): string {
  const cols = projectionColumns(reading, 6, asOfYear);
  const baseYears = new Set(reading.series.flatMap((s) => s.points.filter((p) => p.base).map((p) => p.year)));
  const header = cols.map((y) => (baseYears.has(y) ? `${y} (estimated base)` : `${y}`));
  const rows = reading.series.map((s) => {
    const byYear = new Map(s.points.map((p) => [p.year, p.value]));
    return `| ${s.series} | ${cols.map((y) => (byYear.has(y) ? formatCount(byYear.get(y)!) : '—')).join(' | ')} |`;
  });
  const own = projectionDescribesTheArea(reading.areaKind);
  const lines: string[] = [
    `**Forward demand — ${reading.publisher}'s population projection for ${reading.area} `
      + `(${PROJECTION_AREA_LABEL[reading.areaKind]}):**`,
    '',
    `| Series | ${header.join(' | ')} |`,
    `| --- | ${header.map(() => '---:').join(' | ')} |`,
    ...rows,
    '',
    `Source: ${reading.publisher}, ${reading.release}${reading.licence ? `, ${reading.licence}` : ''}. `
      + `Accessed ${dayOf(reading.loadedAt)}.`,
  ];
  if (reading.series.length > 1) {
    lines.push('Each row is one of the publisher\'s own series. None is preferred here, and none may be '
      + 'described as the most likely outcome unless the publisher says so.');
  }
  lines.push(A_PROJECTION_IS_NOT_A_MEASUREMENT);
  if (!own) {
    lines.push(`This projection describes ${reading.area}, a region this property sits in rather than its own `
      + 'area, so it is drawn apart from figures about the property and never presented as the suburb\'s.');
  }
  lines.push('Use these figures exactly as printed and name the series you use. State no other projected '
    + 'population, growth rate or horizon, and do not describe the estimated base as a projection.');
  return lines.join('\n');
}

/**
 * What the register read returned for one property: a reading, or which
 * absence it was. Four absences, four sentences — `unavailable` is ours,
 * `not_loaded` is this deployment's, `none_for_area` is how the areas line up,
 * and `no_area_resolved` is about the subject's inputs.
 */
export type ProjectionRegisterRead =
  | {
    kind: 'reading';
    reading: PopulationProjectionReading;
    askedAt: ProjectionAreaKind;
    /** The year the register was read in — a projected year before it is not printed as forward. */
    readYear?: number;
  }
  | {
    kind: 'absent';
    absence: 'no_area_resolved' | 'none_for_area' | 'not_loaded' | 'unavailable';
    askedAt: ProjectionAreaKind | null;
  };

/**
 * The availability sentence an absent read maps to. A reading maps to none —
 * it prints its own table — and each absence keeps its own sentence, because
 * `not_loaded` is about the deployment, `area_not_named` about how the areas
 * line up, `no_area_resolved` about the subject and `unavailable` about us.
 */
export function availabilityOfRead(read: ProjectionRegisterRead): ForwardDemandAvailability | null {
  if (read.kind === 'reading') return null;
  switch (read.absence) {
    case 'not_loaded': return { kind: 'not_loaded' };
    case 'none_for_area': return { kind: 'area_not_named' };
    case 'no_area_resolved': return { kind: 'no_area_resolved' };
    case 'unavailable': return { kind: 'unavailable', reason: 'the register could not be read' };
  }
}

/**
 * What a report says about forward demand: the publisher's own table, or
 * which absence it is. ONE composer, read by the demographics section and by
 * the pinned context both, because two statements of one reading is how a
 * section and the pin come to disagree (`riskRegisterInstruction()`'s lesson).
 *
 * `null` — a caller that never read the register — is `not_read`, never
 * `not_loaded`: once a jurisdiction is loaded, a caller that simply did not
 * ask may not say the deployment holds nothing.
 */
export function forwardDemandStatement(read: ProjectionRegisterRead | null | undefined, state: string | null): string {
  if (read && read.kind === 'reading') return projectionTableBlock(read.reading, read.readYear ?? null);
  const availability = read ? availabilityOfRead(read) : null;
  return forwardDemandCoverageNote(availability ?? { kind: 'not_read' }, state);
}

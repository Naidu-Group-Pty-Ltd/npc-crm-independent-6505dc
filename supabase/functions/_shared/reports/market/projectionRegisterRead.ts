/**
 * Read one area's population projection from `population_projections`.
 *
 * The same three rules `approvalsRegisterRead.ts` answers to, because the
 * same three failures are available here:
 *
 * **Only a TRUSTED geography may select a reading.** An SA2 code resolved from
 * the verified coordinate, the resolved suburb, and the council area the
 * cadastre returned — never a typed suburb and never a token parsed out of an
 * address. A caller with nothing trusted gets `no_area_resolved`, not a
 * plausible neighbour.
 *
 * **The finest grain that answers wins, and the grain travels.** SA2 by the
 * publisher's code first, then SA2 by NAME, then the publisher's suburb, then
 * the council area, and the reading carries the grain it was read at so the
 * page can say whether it describes the property's area or a region it sits
 * in. The name rung exists because New South Wales keys its SA2 projections
 * by the ASGS 2021 SA2 NAME and publishes no code (measured from CI, 23 Sep
 * 2026); the name the property's SA2 is asked by is the ABS's own
 * (`report_geography.sa2_name`), and both sides go through the one token rule.
 *
 * **Four absences, four sentences.** A read that FAILED is not a row that is
 * ABSENT: `unavailable` is ours, `not_loaded` is this deployment's (nothing is
 * held for the jurisdiction at all), `none_for_area` is a statement about the
 * area's size (the jurisdiction's projection is held and does not reach an
 * area this small), and `no_area_resolved` is about the subject.
 *
 * Never throws: a report is not failed because a register is down.
 */
import {
  readingFromRows,
  type ProjectionAreaKind,
  type ProjectionRegisterRead,
  type ProjectionRow,
} from './openData/projectionRegister.pure.ts';
import { projectionAreaToken } from './openData/projectionLoad.pure.ts';
import type { ProjectionState } from './openData/stateProjectionPublishers.pure.ts';

export interface ProjectionRegisterQuery {
  /** The TRUSTED state — `trustedStateForForwardDemand`, never `detectedState || 'NSW'`. */
  state: ProjectionState | null;
  /** The SA2 code resolved from the verified coordinate (`report_geography.sa2_code`). */
  sa2Code: string | null;
  /** The same SA2's ABS name (`report_geography.sa2_name`), for a publisher that keys by name. */
  sa2Name?: string | null;
  /** The resolved suburb (`report_geography.suburb`). */
  trustedSuburb: string | null;
  /** The council area the cadastre returned, where one did. */
  cadastreLga: string | null;
}

export type { ProjectionRegisterRead };

const SELECT = 'state, release, series, measure, area_kind, area_code, area, area_token, year, year_kind, value, '
  + 'publisher, source_url, licence, loaded_at';

/** Enough for every series of every edition of one area, and a bound nonetheless. */
const ROW_CEILING = 2_000;

const STATES: readonly ProjectionState[] = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT'];

/** The rungs, finest first, each with the column and value it is asked by. */
function rungsFor(query: ProjectionRegisterQuery): Array<{ areaKind: ProjectionAreaKind; column: 'area_code' | 'area_token'; value: string }> {
  const rungs: Array<{ areaKind: ProjectionAreaKind; column: 'area_code' | 'area_token'; value: string }> = [];
  const sa2 = query.sa2Code?.trim() ?? '';
  if (/^\d{9}$/.test(sa2)) rungs.push({ areaKind: 'sa2', column: 'area_code', value: sa2 });
  const sa2Name = query.sa2Name?.trim() ?? '';
  if (sa2Name !== '') rungs.push({ areaKind: 'sa2', column: 'area_token', value: projectionAreaToken('sa2', sa2Name) });
  const suburb = query.trustedSuburb?.trim() ?? '';
  if (suburb !== '') rungs.push({ areaKind: 'suburb', column: 'area_token', value: projectionAreaToken('suburb', suburb) });
  const lga = query.cadastreLga?.trim() ?? '';
  if (lga !== '') rungs.push({ areaKind: 'lga', column: 'area_token', value: projectionAreaToken('lga', lga) });
  return rungs;
}

// deno-lint-ignore no-explicit-any
async function jurisdictionHasRows(supabase: any, state: ProjectionState): Promise<boolean> {
  const { count, error } = await supabase
    .from('population_projections')
    .select('area_code', { count: 'exact', head: true })
    .eq('state', state)
    .limit(1);
  if (error) throw new Error(`population_projections probe failed: ${error.message}`);
  return (count ?? 0) > 0;
}

// deno-lint-ignore no-explicit-any
export async function readProjectionRegister(supabase: any, query: ProjectionRegisterQuery): Promise<ProjectionRegisterRead> {
  if (!query.state || !STATES.includes(query.state)) return { kind: 'absent', absence: 'no_area_resolved', askedAt: null };
  const rungs = rungsFor(query);
  if (rungs.length === 0) return { kind: 'absent', absence: 'no_area_resolved', askedAt: null };

  try {
    for (const rung of rungs) {
      // Every filter before the bound — `.eq()` after `.limit()` reads as
      // though the bound had already been applied, and was once believed.
      const { data, error } = await supabase
        .from('population_projections')
        .select(SELECT)
        .eq('state', query.state)
        .eq('area_kind', rung.areaKind)
        .eq(rung.column, rung.value)
        .limit(ROW_CEILING);
      if (error) throw new Error(`population_projections read failed: ${error.message}`);
      const reading = readingFromRows((data ?? []) as ProjectionRow[]);
      if (reading) return { kind: 'reading', reading, askedAt: rung.areaKind, readYear: new Date().getUTCFullYear() };
    }
    const loaded = await jurisdictionHasRows(supabase, query.state);
    return { kind: 'absent', absence: loaded ? 'none_for_area' : 'not_loaded', askedAt: rungs[0].areaKind };
  } catch (_error) {
    return { kind: 'absent', absence: 'unavailable', askedAt: rungs[0].areaKind };
  }
}

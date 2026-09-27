/**
 * Read one area's approved-supply series from the ABS building-approvals
 * register.
 *
 * ## Why this module had to exist before the feature did
 *
 * `generate-investment-report` reads `enhancedData.buildingApprovals` and
 * hands it to `summariseApprovals`. Nothing wrote it. The register loaded,
 * the fact block was wired, and the prompt would have carried
 * **Not searched.** on every report ever generated — a correct sentence about
 * a feature that could never turn on. That is the shape
 * `builder_network_connections` has on the prime: "the product reads it in
 * four places and writes it in none". Nothing false ships from a gap like
 * that, which is exactly why nothing reports it.
 *
 * ## Three rules
 *
 * **Only a TRUSTED geography may select a reading.** An SA2 or a council area
 * is chosen here, and choosing the wrong one describes somebody else's
 * market with this property's name on it —
 * `RF72B1B1_ENRICHMENT_AND_POSTCODE.md`'s rule, where a lot number parsed as
 * a postcode selected a NSW register for a Victorian property. So the query
 * takes named, trusted inputs and a caller with nothing trusted gets
 * `no_area_resolved` rather than a plausible neighbour.
 *
 * **The finest grain that answers wins, and the grain travels.** The ladder
 * is the register's own (SA2, then council, then state), the reading carries
 * the grain it was read at, and nothing here renames a council area as a
 * suburb. `openDataSalesEvidence` prices the grain rather than hiding it, and
 * this answers to the same rule.
 *
 * **The four absences are four different sentences.** A read that FAILED is
 * not a row that is ABSENT (`CASE_TENANT_COLUMN.md`), and a register that has
 * never been loaded is not an area with no approvals — the first is this
 * deployment's, the second is a statement about the area, and rendering
 * either as the other is the confident-clear-against-nothing failure. So a
 * miss is checked against whether the register holds ANY row at that grain
 * before it is reported as the area's.
 */
import {
  type ApprovalsAbsence,
  type ApprovalsMonth,
  type ApprovalsSeries,
} from './approvalsFactBlocks.pure.ts';
import {
  type ApprovalsAreaKind,
  type ApprovalsBuildingType,
} from './openData/absBuildingApprovals.pure.ts';
import {
  type SalesRegisterState,
  SALES_STATE_LABELS,
  salesAreaToken,
} from './openData/salesRegister.pure.ts';
import { finiteOrNull } from './registerCell.pure.ts';

/**
 * What a caller may ask with. Every field is named for the authority behind
 * it, because a field called `suburb` invites a typed one.
 */
export interface ApprovalsRegisterQuery {
  /** The state resolved from the verified coordinate. */
  state: SalesRegisterState | null;
  /** The suburb resolved from the verified coordinate — never a typed one. */
  trustedSuburb: string | null;
  /** The council area named by the cadastre or the planning register. */
  cadastreLga: string | null;
  /**
   * The ABS Statistical Area Level 2 the verified coordinate falls in, as the
   * geography resolver recorded it (`report_geography.sa2_code` / `sa2_name`).
   *
   * The register files SA2 rows under the ABS's own nine-digit code and the
   * SA2's own name — "Schofields - East", "Riverstone - Marsden Park". Asking
   * the SA2 rung with the SUBURB ("Tallawong") can never match one, and on 37
   * Bolin Street, Tallawong (27 Sep 2026) the supply section said the series
   * "publishes no figure for this area" while the register held Schofields -
   * East, the SA2 the same report's population section named twice. The code
   * is asked first because a name is spelt; a code is not.
   */
  trustedSa2?: { code: string | null; name: string | null } | null;
}

export type ApprovalsRegisterRead =
  | { kind: 'series'; series: ApprovalsSeries; askedAt: ApprovalsAreaKind }
  | { kind: 'absent'; absence: ApprovalsAbsence; askedAt: ApprovalsAreaKind | null };

/** Read at most this many rows for one area: 3 building types × ~660 months. */
const ROW_CEILING = 2000;

const SELECT =
  'area, area_kind, area_code, period, building_type, dwelling_units, value_aud, '
  + 'source, source_url, licence, loaded_at';

interface ApprovalsRow {
  area: string;
  area_kind: string;
  area_code: string;
  period: string;
  building_type: string;
  dwelling_units: number | null;
  value_aud: number | string | null;
  source: string;
  source_url: string;
  licence: string;
  loaded_at: string | null;
}

/*
 * Every numeric cell goes through `finiteOrNull`, which is the one statement
 * of this rule — see that module's header for what `=== null ? … : Number(…)`
 * printed on a client's page (`$NaN`) and why it is reachable one narrower
 * `select` away. `value_aud` is `numeric`, which supabase-js hands back as a
 * string, so the conversion cannot be skipped either.
 */
function toMonth(r: ApprovalsRow): ApprovalsMonth {
  return {
    period: r.period,
    buildingType: r.building_type as ApprovalsBuildingType,
    dwellingUnits: finiteOrNull(r.dwelling_units),
    value: finiteOrNull(r.value_aud),
  };
}

const newestLoad = (rows: ApprovalsRow[]): string | null =>
  rows.reduce<string | null>(
    (latest, r) => (r.loaded_at && (!latest || r.loaded_at > latest) ? r.loaded_at : latest),
    null,
  );

/**
 * The ladder this read walks, finest first — the register's own ordering.
 * `national` is deliberately absent: a national approvals count is a fact
 * about Australia, and printing it beside one property's address would be the
 * benchmark-read-as-the-suburb defect `MARKET_FIGURES_IN_THE_REPORT.md`
 * records.
 */
export const APPROVALS_READ_LADDER: readonly ApprovalsAreaKind[] = ['sa2', 'lga', 'state'];

/**
 * Has the loader ever written at this grain on this deployment?
 *
 * Asked only on a MISS, and asked at the grain rather than for the area,
 * because that is the question that separates the two absences: a register
 * with rows at this grain and none for this area is a statement about the
 * area, and a register with none at all is a statement about this deployment.
 */
// deno-lint-ignore no-explicit-any
async function grainHasRows(supabase: any, areaKind: ApprovalsAreaKind): Promise<boolean> {
  const { count, error } = await supabase
    .from('market_building_approvals')
    .select('area_code', { count: 'exact', head: true })
    .eq('area_kind', areaKind)
    .limit(1);
  if (error) throw new Error(`market_building_approvals grain probe failed: ${error.message}`);
  return (count ?? 0) > 0;
}

/** One question put to the register: by the ABS's own code, or by a token. */
interface Ask { token?: string; code?: string; label: string }

/**
 * What each rung of the ladder is asked with, given the trusted inputs —
 * finest and most exact first. An SA2 is asked by its code, then its own
 * name, then (the older convention) the resolved suburb.
 */
function asksFor(areaKind: ApprovalsAreaKind, query: ApprovalsRegisterQuery): Ask[] {
  if (areaKind !== 'sa2') {
    const one = askFor(areaKind, query);
    return one ? [one] : [];
  }
  const asks: Ask[] = [];
  const code = query.trustedSa2?.code?.trim();
  const name = query.trustedSa2?.name?.trim();
  if (code && /^\d{9}$/.test(code)) asks.push({ code, label: name || code });
  if (name) asks.push({ token: salesAreaToken('suburb', name), label: name });
  const suburb = askFor('sa2', query);
  if (suburb && !asks.some((a) => a.token === suburb.token)) asks.push(suburb);
  return asks;
}

/** What each rung of the ladder is asked with, given the trusted inputs. */
function askFor(
  areaKind: ApprovalsAreaKind,
  query: ApprovalsRegisterQuery,
): { token: string; label: string } | null {
  if (areaKind === 'state') {
    return query.state ? { token: salesAreaToken('state', query.state), label: SALES_STATE_LABELS[query.state] } : null;
  }
  if (areaKind === 'lga') {
    return query.cadastreLga ? { token: salesAreaToken('lga', query.cadastreLga), label: query.cadastreLga } : null;
  }
  /*
   * An SA2's label reads like a suburb and is NOT one — it is an ABS
   * statistical area that may span several, which is why the reading carries
   * `areaKind: 'sa2'` all the way to the page and the fact block names the
   * publisher's grain. Tokenising it as a suburb is the register's own
   * convention (`parseAbsBuildingApprovals` writes the token the same way),
   * so this matches the register rather than reinterpreting it.
   */
  return query.trustedSuburb ? { token: salesAreaToken('suburb', query.trustedSuburb), label: query.trustedSuburb } : null;
}

/**
 * One area's series, or the named reason there is none.
 *
 * Never throws: a report is not failed because a supply register is down, and
 * `unavailable` says so in the document rather than blaming the address.
 */
// deno-lint-ignore no-explicit-any
export async function readApprovalsRegister(
  supabase: any,
  query: ApprovalsRegisterQuery,
): Promise<ApprovalsRegisterRead> {
  const rungs = APPROVALS_READ_LADDER
    .flatMap((areaKind) => asksFor(areaKind, query).map((ask) => ({ areaKind, ask })));
  if (rungs.length === 0) return { kind: 'absent', absence: 'no_area_resolved', askedAt: null };

  try {
    for (const rung of rungs) {
      let filtered = supabase
        .from('market_building_approvals')
        .select(SELECT)
        .eq('area_kind', rung.areaKind);
      filtered = rung.ask.code
        ? filtered.eq('area_code', rung.ask.code)
        : filtered.eq('area_token', rung.ask.token);
      // The state narrows a token that could collide across jurisdictions —
      // there are several Springfields. A row the publisher left stateless is
      // deliberately still reachable at state grain, where the state IS the
      // area, so the filter is applied only to sub-state asks.
      //
      // Every filter goes on BEFORE the bound. `.eq()` after `.limit()` is
      // chainable and reads as though the bound had already been applied,
      // which is how a row ceiling comes to be believed while sitting on the
      // wrong side of a filter.
      if (query.state && rung.areaKind !== 'state') filtered = filtered.eq('state', query.state);
      const { data, error } = await filtered.limit(ROW_CEILING);
      if (error) throw new Error(`market_building_approvals read failed: ${error.message}`);
      const rows = (data ?? []) as ApprovalsRow[];
      if (rows.length === 0) continue;

      const series: ApprovalsSeries = {
        area: rows[0].area,
        areaKind: rung.areaKind,
        months: rows.map(toMonth),
        source: rows[0].source,
        sourceUrl: rows[0].source_url,
        licence: rows[0].licence,
        loadedAt: newestLoad(rows),
      };
      return { kind: 'series', series, askedAt: rung.areaKind };
    }

    // Nothing answered. Which absence it is turns on whether the register
    // holds anything at the finest grain we were able to ask at.
    const finest = rungs[0].areaKind;
    const loaded = await grainHasRows(supabase, finest);
    return { kind: 'absent', absence: loaded ? 'none_for_area' : 'not_loaded', askedAt: finest };
  } catch (_error) {
    // Ours, never the area's. `unavailable` is its own sentence.
    return { kind: 'absent', absence: 'unavailable', askedAt: rungs[0].areaKind };
  }
}

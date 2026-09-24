/**
 * How a register too wide for one invocation is loaded in several.
 *
 * ## The measurement — and the axis it has to be taken on
 *
 * Measured from CI against the Bureau's own bytes, 21 Sep 2026. At SA2 grain
 * — the finest the scorer prices — with the query narrowed to what this
 * register reads:
 *
 *     33 months   111.6 MB   past the ceiling
 *     12 months    26.0 MB   past the ceiling
 *      6 months    12.2 MB   workable
 *
 * **Every one of those is a fact about the WIRE, and the wire is not what
 * binds.** This constant was 6 on the strength of that table, and the first
 * real run in production answered `546` — the edge worker's resource limit —
 * on exactly the six-month window it describes. The download was never the
 * problem: the stage holds the whole body as one string, then every row as an
 * object, then the upsert payload, all live at once.
 *
 * Re-measured 22 Sep 2026 IN THE WORKER, using the explicit operator window
 * the stage already accepts, at SA2 grain against the deployed function:
 *
 *      1 month     5,814 rows   HTTP 200
 *      3 months   17,442 rows   HTTP 200
 *      6 months  ~34,884 rows   HTTP 546
 *
 * 5,814 rows a month, dead flat (17,442 is 5,814 x 3 exactly), so the cliff
 * lies between 17,442 and ~34,884 rows. Three is therefore the largest
 * window PROVEN to fit, and 4 and 5 are deliberately not taken: the failure
 * mode of sitting at an unmeasured edge is a nightly 546 that pg_cron reports
 * as green, which is the one shape this register's own header warns about.
 *
 * The lesson generalises past this file. **A bound must be measured on the
 * quantity that binds** — bytes over the wire answered a different question
 * from resources to process, and the smaller number was the one measured.
 *
 * So a full load is several requests, and `market-sales-ingest` has been one
 * heavy read per invocation since five DCJ workbooks in one call exhausted an
 * edge worker's compute allowance. At three months a walk of the 33 the
 * Bureau holds is eleven nightly pages.
 *
 * ## It pages by PERIOD, and that correction is the point
 *
 * `SUPPLY_EVIDENCE.md` first said SA2 "pages by state", because the SA2
 * code's leading digit is its state. That is true, it is how
 * `stateOfAreaCode` labels a row, and it is useless here: an SDMX key selects
 * EXACT CODES, so asking for one state's SA2s means enumerating three hundred
 * of them in a URL. Reading a state off a code and requesting one are
 * different operations. A period is two parameters whatever the geography.
 *
 * ## Newest first, then backwards — so the frontier is measured, not assumed
 *
 * The newest page is ALWAYS short, because the ABS publishes with a lag: a
 * six-month window asked on 21 Sep 2026 returned four months, to 2026-07.
 * Judging that as a truncated body would refuse every healthy load, and
 * hard-coding "expect two months' lag" is a constant nobody here can verify
 * and that the Bureau can change without telling us.
 *
 * So the FIRST page is read at the frontier and whatever it returns defines
 * `latestPeriod`. Every later page lies wholly in the past, so it must be
 * full — short means truncated, and refuses. The loader learns the lag from
 * the publisher instead of being told it.
 */

/**
 * Three months: the largest window measured to fit at the finest grain, and
 * measured in the WORKER rather than on the wire. See the table above — 6
 * answered HTTP 546 in production on the very window the byte measurement
 * called workable.
 */
export const APPROVALS_PAGE_MONTHS = 3;

export interface ApprovalsPage {
  /** 0 is the frontier page; 1 is the six months before it, and so on. */
  index: number;
  startPeriod: string;
  endPeriod: string;
  /**
   * How many months this page must carry to be believed.
   *
   * Null at the frontier, where the publisher's own lag decides and any
   * answer is the answer. A number everywhere else, because a past window
   * that comes back short is a truncated body.
   */
  minPeriods: number | null;
}

/** `YYYY-MM` arithmetic, with no `Date` and so no timezone to get wrong. */
export function shiftMonth(period: string, by: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period.trim());
  if (!m) throw new Error(`period must be YYYY-MM, not "${period}" — refused`);
  const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + by;
  if (total < 0) throw new Error(`shifting ${period} by ${by} months goes before year 0 — refused`);
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** Inclusive months from `from` to `to`; negative where `to` precedes `from`. */
export function monthSpan(from: string, to: string): number {
  const a = /^(\d{4})-(\d{2})$/.exec(from.trim());
  const b = /^(\d{4})-(\d{2})$/.exec(to.trim());
  if (!a || !b) throw new Error(`both periods must be YYYY-MM ("${from}", "${to}") — refused`);
  return (Number(b[1]) * 12 + Number(b[2])) - (Number(a[1]) * 12 + Number(a[2])) + 1;
}

/**
 * The page a given invocation should read.
 *
 * `frontier` is the newest month the register has seen from this flow, or
 * null on the very first run. Page 0 asks forward from `asOf` and takes what
 * the publisher has; every later page steps back a whole window from the
 * frontier and must be complete.
 */
export function approvalsPage(
  index: number,
  asOf: string,
  frontier: string | null,
  months: number = APPROVALS_PAGE_MONTHS,
): ApprovalsPage {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`page index must be a non-negative integer, not ${index} — refused`);
  }
  if (months < 1) throw new Error(`a page must be at least one month, not ${months} — refused`);

  if (index === 0 || frontier === null) {
    /*
     * The frontier. Asked forward from `asOf` so the request always reaches
     * past what is published — and whatever comes back IS the frontier, with
     * no floor, because the lag belongs to the publisher.
     */
    const start = shiftMonth(asOf, -(months - 1));
    return { index, startPeriod: start, endPeriod: asOf, minPeriods: null };
  }
  const end = shiftMonth(frontier, -((index - 1) * months) - 1);
  const start = shiftMonth(end, -(months - 1));
  return { index, startPeriod: start, endPeriod: end, minPeriods: months };
}

/**
 * How many pages reach back to `floor` from a known frontier, so a run can
 * say what remains rather than leaving an operator to work it out.
 */
export function pagesToCover(
  frontier: string,
  floor: string,
  months: number = APPROVALS_PAGE_MONTHS,
): number {
  const span = monthSpan(floor, frontier);
  if (span <= 0) return 1;
  return Math.max(1, Math.ceil(span / months));
}

/**
 * What ONE invocation should ask for, derived from the register's own edges.
 *
 * ## The defect this replaces
 *
 * `approvalsPage` steps back from the frontier by `(index - 1)` windows, so
 * the walk is driven entirely by an `index` somebody has to supply. Nothing
 * ever did. The nightly job posts `{"stage": "approvals"}` with no `page`, the
 * stage reads `Number.isInteger(body.page) ? … : 0`, and page 0 asks FORWARD
 * from today — so every run re-read the same three months and the register
 * could never deepen past one window. `pagesToCover` computed what remained
 * and its answer was printed into a sync row and acted on by nothing.
 *
 * That is the unmounted-mechanism defect this repository has now paid for in
 * a component, a CSS class, four CI gates and `verdict.pricingUrl`: the walk
 * existed, and nothing walked it. It is not a slow backfill — **it is no
 * backfill**, in perpetuity, and a year-on-year reading was unreachable
 * rather than delayed.
 *
 * ## The rule
 *
 * A register that must stay complete and current forever cannot depend on a
 * caller's bookkeeping. It has two edges of its own and they are enough:
 *
 *   * `frontier` — the newest month it holds. Currency.
 *   * `oldest`   — the oldest month it can PROVE it holds, unbroken from the
 *     frontier down. Depth. This was `min(period)` until 23 Sep 2026, and
 *     rows are not proof: a window a run died part-way through has rows and
 *     is not whole. `vouchedOldest`, below, is where the proof comes from.
 *
 * So each invocation asks itself what is owed, in this order, and the order
 * is what makes it converge:
 *
 *   1. **Nothing held** → the frontier window. Establishes the edge and lets
 *      the publisher's own lag define it, which is `approvalsPage`'s rule.
 *      **1b. Rows at the frontier that nothing proves whole** → the frontier
 *      window again, in the same calendar month.
 *   2. **A month may have been published** (`asOf` past `frontier`) → the
 *      frontier window again. This also re-reads the recent months, which is
 *      how a Bureau REVISION reaches the register at all — the upsert
 *      replaces on the publisher's own key.
 *   3. **Current, and shallower than the floor** → the window immediately
 *      below `oldest`. One window deeper per invocation, self-advancing, no
 *      index anywhere — and because `oldest` is the PROVEN edge, a window a
 *      run left half-written is the next one asked for, not stepped past.
 *   4. **Current and deep enough** → `settled`: nothing is owed and no DATA
 *      is requested. A settled run reads the catalogue (to know which flow,
 *      and so which grain, it is) and four facts from its own tables.
 *
 * Step 4 is what makes frequency free. Convergence is bounded by cadence
 * rather than by nights — hourly reaches 24 months in eight hours and then
 * no-ops — and a clone with an empty register walks itself up with nobody
 * scheduling anything, which is `urban-centre-register-ingest`'s rule that
 * the rows a migration INSERTs do not travel.
 *
 * Step 2 before step 3 is deliberate: **currency outranks depth.** A register
 * missing last month is wrong about now, and a register missing 2023 is
 * merely shallow — and the section this feeds may state a level from a short
 * register but may not state a CHANGE, which is a rule about what the page
 * says rather than about what the loader does.
 */
export type ApprovalsWorkKind = 'frontier' | 'backfill' | 'settled';

export interface ApprovalsWork {
  kind: ApprovalsWorkKind;
  /** Absent on `settled`, because a settled run asks the publisher nothing. */
  startPeriod: string | null;
  endPeriod: string | null;
  /** Null at the frontier (the publisher's lag decides), a count below it. */
  minPeriods: number | null;
  /** Windows of DEPTH still owed after this one, so a run says what remains. */
  windowsRemaining: number;
  /** Why this window, in one word an operator can read in a sync row. */
  because: string;
}

/**
 * ## Why currency is a CADENCE and not a comparison
 *
 * The first cut of this tested `asOf > frontier` for "a month may have been
 * published". That is wrong in a way that reproduces the very defect it
 * replaces, and the publisher's own behaviour is why: the ABS releases
 * building approvals about two months in arrears, so `asOf` is ALWAYS ahead
 * of the frontier. The test would pass on every invocation, the frontier
 * window would be re-read forever, and the backfill step below would never
 * execute — a walk that never walks, which is precisely what
 * `pageIndex = 0` was already doing.
 *
 * The register cannot tell "a new month exists" from "the publisher still
 * lags" without asking. So it does not try. The ABS publishes monthly, so
 * **one frontier read per calendar month** is sufficient for currency and is
 * also how a Bureau REVISION to a recent month reaches the register at all.
 * `frontierLoadedAt` is when those rows were last written, which is when the
 * frontier window was last asked — a fact the register already holds in
 * `loaded_at` rather than a counter anyone maintains.
 *
 * Everything else deepens. Depth is therefore the default rather than the
 * leftover, which is what makes convergence bounded by cadence: hourly
 * reaches a 24-month register in eight hours and then settles.
 */
export function planApprovalsWork(args: {
  /** Newest month held, or null on a register with no rows. */
  frontier: string | null;
  /**
   * The edge the walk steps below: the oldest month of the unbroken run the
   * register can PROVE it holds down from the frontier — `vouchedOldest`'s
   * answer, not `min(period)`. Null where nothing is proven; see below.
   */
  oldest: string | null;
  /**
   * `min(period)` in the table, for the reason an operator reads and nothing
   * else. Where it lies below `oldest` the window asked for is a RE-READ of
   * months the table holds rows for and nothing proves whole.
   */
  heldOldest?: string | null;
  /** `YYYY-MM` the run is asking from — the frontier is asked forward to it. */
  asOf: string;
  /** `YYYY-MM` the register is owed back to. */
  floor: string;
  /** `YYYY-MM` the frontier rows were last written, or null if never. */
  frontierLoadedAt: string | null;
  months?: number;
}): ApprovalsWork {
  const months = args.months ?? APPROVALS_PAGE_MONTHS;
  if (months < 1) throw new Error(`a window must be at least one month, not ${months} — refused`);

  const frontierWindow = (because: string, windowsRemaining: number): ApprovalsWork => {
    const page = approvalsPage(0, args.asOf, null, months);
    return {
      kind: 'frontier',
      startPeriod: page.startPeriod,
      endPeriod: page.endPeriod,
      minPeriods: null,
      windowsRemaining,
      because,
    };
  };

  // 1 — nothing held.
  if (args.frontier === null) {
    return frontierWindow('the register holds nothing; establishing the frontier',
      pagesToCover(args.asOf, args.floor, months));
  }

  /*
   * 1b — rows at the frontier, and nothing proving them whole: the frontier
   * window was half-written, or every write that vouched for it describes
   * rows that have since gone. Read it again. This is the frontier's half of
   * the rule `vouchedOldest` states — an unproven month is asked for again,
   * never stepped past — and it is placed before the cadence so a
   * half-written frontier is repaired in the same calendar month rather than
   * next month.
   */
  if (args.oldest === null) {
    return frontierWindow(
      `the register holds rows for ${args.frontier} and no completed write vouches for them; reading the frontier again`,
      Math.ceil(Math.max(0, monthSpan(args.floor, args.frontier) - 1) / months),
    );
  }

  /*
   * Months still owed BELOW the oldest month held. `monthSpan` is inclusive,
   * so a register whose oldest month IS the floor owes zero.
   */
  const monthsBelow = Math.max(0, monthSpan(args.floor, args.oldest) - 1);
  const depthOwed = Math.ceil(monthsBelow / months);

  // 2 — currency, once per calendar month. See the note above for why this is
  //     a cadence rather than `asOf > frontier`.
  if (args.frontierLoadedAt === null || args.frontierLoadedAt < args.asOf) {
    return frontierWindow(
      args.frontierLoadedAt === null
        ? 'the frontier has never been read'
        : `the frontier was last read in ${args.frontierLoadedAt}, and it is now ${args.asOf}`,
      depthOwed,
    );
  }

  // 3 — deepen by exactly one window, immediately below the oldest PROVEN.
  if (depthOwed > 0) {
    const end = shiftMonth(args.oldest, -1);
    const held = args.heldOldest ?? null;
    return {
      kind: 'backfill',
      startPeriod: shiftMonth(end, -(months - 1)),
      endPeriod: end,
      minPeriods: months,
      windowsRemaining: depthOwed - 1,
      because: held !== null && held < args.oldest
        ? `the register is proven whole back to ${args.oldest} and holds rows back to ${held}; `
          + `re-reading the window below the proof, because rows are not a whole window`
        : `the register reaches back to ${args.oldest} and is owed ${args.floor}`,
    };
  }

  // 4 — complete and current. Ask the publisher nothing.
  return {
    kind: 'settled',
    startPeriod: null,
    endPeriod: null,
    minPeriods: null,
    windowsRemaining: 0,
    because: `current to ${args.frontier} and complete to ${args.oldest}`,
  };
}

/**
 * # Which months the register can PROVE it holds
 *
 * ## The hole this closes
 *
 * The walk above deepens from the register's oldest month, and it first read
 * that edge as `min(period)` over the table. A window is written in batches
 * of five hundred rows across four payload shapes, so an invocation that
 * dies part-way — the worker's `546`, a dropped connection, a batch refused —
 * commits some of a window's rows and not the rest. `min(period)` moves INTO
 * the half-written window, the next invocation asks for the window below it,
 * and nothing ever asks for the half-written months again. The register then
 * settles and calls itself complete with a hole in it, which is the outcome
 * `SUPPLY_EVIDENCE.md` §4 exists to forbid, reached by the loader rather than
 * by the publisher.
 *
 * `approvalsWriteOrder` closed the one DETERMINISTIC route there — a negative
 * the table refused part-way through a window. It could not close the
 * transient ones, because a transient failure is not in the data.
 *
 * ## The rule
 *
 * The table can say which months have rows. Only the sync ledger can say
 * which months were written WHOLE: the stage inserts its success row after
 * the last batch commits and never before, so a run that died part-way leaves
 * no success row at all. The edge the walk steps below is therefore the
 * bottom of the unbroken run of months, counted down from the frontier, that
 * completed writes vouch for. Three things follow from that one rule:
 *
 *   * a half-written window vouches for nothing, so the next invocation asks
 *     for the SAME window again — and re-writing it is an upsert on the
 *     publisher's own key, so the repair costs one request;
 *   * a gap ANYWHERE below the frontier ends the run, so a month missed at
 *     the top (a release that slipped past a calendar month, which the
 *     frontier window's `asOf`-anchored range then steps over) is re-read
 *     too, not only a hole at the bottom;
 *   * a frontier month nothing vouches for sends the planner back to the
 *     frontier window (`planApprovalsWork`, rule 1b).
 *
 * What this can cost is a re-read, never a hole: a success row the ledger
 * failed to record costs one repeated window. That asymmetry is the point —
 * the absence of proof is read as absence.
 *
 * ## Two guards, because the ledger outlives the rows it describes
 *
 * The ledger is never pruned and the table can be. It already has been:
 * `20261215030000_approvals_clear_mislabelled_grains.sql` deleted every row
 * the SA2 flow had written so a corrected parser could reload it, and the
 * success rows of the two runs before it — 06:43 and 06:48 UTC on 22 Sep
 * 2026, vouching for 2026-05 → 2026-07 — are still in the ledger describing
 * rows that do not exist. (The production log shows it: the 07:58 run read
 * `frontier=none`, and at 09:20 the walk asked for 2026-04 → 2026-06 below
 * an oldest month of 2026-07.) A stale success row is worse than none,
 * because it vouches for a window a later partial write can leave half-full.
 *
 *   * **Staleness.** Every row one write makes carries that write's
 *     `loaded_at`, and the success row now names it (`rows_loaded_at`). A
 *     success row whose stamp precedes the OLDEST stamp the table still holds
 *     made nothing that survives as it was made — every one of its rows has
 *     since been replaced or deleted — so it vouches for nothing. A row
 *     written before the stamp was recorded is judged on its own insert
 *     time, which follows the stamp by the length of the run; the worst a
 *     skewed clock can do there is cost one window's re-read, after which
 *     the new row carries its stamp and is compared on one clock.
 *   * **The table's own floor.** The edge is never below `min(period)`: a
 *     month the table holds no row for is not held, however the ledger reads.
 *
 * What neither can see is rows deleted from the MIDDLE of the register while
 * older rows survive. The loader never deletes; that would be an operator's
 * act, and it is named here rather than guessed at.
 */

/**
 * The fields of a sync-ledger row that can vouch for a window, and nothing
 * else. A success row's `detail` names every catalogued flow and candidate
 * and runs to kilobytes; this projection is a few hundred bytes, which is
 * what lets the read ask for every approvals row an area kind has without
 * spending the worker's memory on it — the resource that answered `546`.
 */
export const APPROVALS_LEDGER_SELECT = [
  'stage:detail->>stage',
  'area_kind:detail->>area_kind',
  'first:detail->>first_period',
  'last:detail->>latest_period',
  'periods:detail->periods',
  'rows_written:detail->rows_written',
  'period_list:detail->period_list',
  'stamp:detail->>rows_loaded_at',
  'created_at',
].join(',');

/**
 * How many ledger rows one invocation reads. A success row is written about
 * once an hour while the walk deepens and about once a MONTH after it
 * settles, and refusals and settled runs are filtered out at the source, so
 * this is decades of history. Reaching it costs re-reads of the oldest
 * windows and never a hole.
 */
export const APPROVALS_LEDGER_READ_LIMIT = 2000;

/** A window wider than this is not believed, whatever the row says. */
export const APPROVALS_LEDGER_MAX_MONTHS = 600;

/** One `APPROVALS_LEDGER_SELECT` row, typed as what it is: unverified. */
export interface ApprovalsLedgerEntry {
  stage?: unknown;
  area_kind?: unknown;
  first?: unknown;
  last?: unknown;
  periods?: unknown;
  rows_written?: unknown;
  period_list?: unknown;
  stamp?: unknown;
  created_at?: unknown;
}

/** A window a ledger row proves was written whole. */
export interface CompletedApprovalsWindow {
  /** Every month the write carried, ascending. */
  months: string[];
  /** The `loaded_at` its rows carry, or null on a row written before it was recorded. */
  stamp: string | null;
  /** When the ledger recorded it — the database's clock, after the last batch. */
  recordedAt: string | null;
}

/** A calendar month, strictly: `2026-13` and `0000-01` are not periods. */
const LEDGER_PERIOD = /^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/;

const isInstant = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));

/**
 * The window one ledger row proves was written whole, or null where it
 * proves nothing.
 *
 * A row vouches only where it is a success row for THIS area kind, it wrote
 * something, and the months it carried are stated consistently. Rows written
 * since `period_list` was recorded name their months exactly. Older rows
 * carry only a first month, a last month and a count, so they are believed
 * only where the count says the window had no gap — a window of three months
 * spanning four is a window with a hole in it, and which month is missing is
 * not something the row can say.
 */
export function completedWindowOf(
  entry: ApprovalsLedgerEntry | null | undefined,
  areaKind: string,
): CompletedApprovalsWindow | null {
  if (entry === null || entry === undefined || typeof entry !== 'object') return null;
  if (entry.stage !== 'approvals' || entry.area_kind !== areaKind) return null;
  const { first, last, periods, rows_written: written } = entry;
  if (typeof first !== 'string' || typeof last !== 'string') return null;
  if (!LEDGER_PERIOD.test(first) || !LEDGER_PERIOD.test(last)) return null;
  if (typeof periods !== 'number' || !Number.isInteger(periods) || periods < 1) return null;
  if (typeof written !== 'number' || !Number.isFinite(written) || written <= 0) return null;
  const span = monthSpan(first, last);
  if (span < 1 || span > APPROVALS_LEDGER_MAX_MONTHS || periods > span) return null;

  let months: string[];
  if (entry.period_list === undefined || entry.period_list === null) {
    if (periods !== span) return null;
    months = Array.from({ length: span }, (_, i) => shiftMonth(first, i));
  } else if (Array.isArray(entry.period_list)) {
    const list = entry.period_list;
    if (list.length !== periods) return null;
    if (!list.every((p) => typeof p === 'string' && LEDGER_PERIOD.test(p))) return null;
    const sorted = [...new Set(list as string[])].sort();
    if (sorted.length !== periods || sorted[0] !== first || sorted[sorted.length - 1] !== last) return null;
    months = sorted;
  } else {
    return null;
  }

  return {
    months,
    stamp: isInstant(entry.stamp) ? entry.stamp : null,
    recordedAt: isInstant(entry.created_at) ? entry.created_at : null,
  };
}

/**
 * Does this completed write still describe rows the table holds?
 *
 * `stalestLoadedAt` is the OLDEST `loaded_at` in the table. A write whose own
 * stamp precedes it made no row that survives as it was made. Where the row
 * predates the stamp, its insert time stands in — later than the stamp by the
 * length of the run, so it errs towards believing, and a clock skew larger
 * than a run costs one re-read rather than a hole. Where nothing can be
 * compared, it is not believed.
 */
export function stillDescribesTheTable(
  window: CompletedApprovalsWindow,
  stalestLoadedAt: string | null,
): boolean {
  if (!isInstant(stalestLoadedAt)) return false;
  const floor = Date.parse(stalestLoadedAt);
  const own = window.stamp ?? window.recordedAt;
  return own !== null && Date.parse(own) >= floor;
}

export interface VouchedEdge {
  /**
   * The edge the walk steps below: the bottom of the vouched run, and never
   * below `min(period)`. Null where the frontier itself is unproven, which
   * is `planApprovalsWork`'s rule 1b.
   */
  oldest: string | null;
  /** Bottom of the unbroken vouched run down from the frontier, before the table's floor. */
  ledgerOldest: string | null;
  /** Completed writes that vouched, and those set aside as describing rows that have gone. */
  windowsVouching: number;
  windowsStale: number;
}

/**
 * The oldest month the register can prove it holds, contiguously, from the
 * frontier down. See the note above `APPROVALS_LEDGER_SELECT`.
 */
export function vouchedOldest(args: {
  /** `max(period)` in the table. */
  frontier: string | null;
  /** `min(period)` in the table. */
  tableOldest: string | null;
  /** The oldest `loaded_at` in the table. */
  stalestLoadedAt: string | null;
  completed: ReadonlyArray<CompletedApprovalsWindow>;
}): VouchedEdge {
  const vouching = args.completed.filter((w) => stillDescribesTheTable(w, args.stalestLoadedAt));
  const edge: VouchedEdge = {
    oldest: null,
    ledgerOldest: null,
    windowsVouching: vouching.length,
    windowsStale: args.completed.length - vouching.length,
  };
  if (args.frontier === null || args.tableOldest === null) return edge;

  const proven = new Set<string>();
  for (const w of vouching) for (const m of w.months) proven.add(m);
  if (!proven.has(args.frontier)) return edge;

  let bottom = args.frontier;
  for (let below = shiftMonth(bottom, -1); proven.has(below); below = shiftMonth(below, -1)) {
    bottom = below;
  }
  edge.ledgerOldest = bottom;
  // The later of the two: a month is held only where BOTH say so.
  edge.oldest = bottom > args.tableOldest ? bottom : args.tableOldest;
  return edge;
}

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
 *   * `oldest`   — the oldest month it holds. Depth.
 *
 * So each invocation asks itself what is owed, in this order, and the order
 * is what makes it converge:
 *
 *   1. **Nothing held** → the frontier window. Establishes the edge and lets
 *      the publisher's own lag define it, which is `approvalsPage`'s rule.
 *   2. **A month may have been published** (`asOf` past `frontier`) → the
 *      frontier window again. This also re-reads the recent months, which is
 *      how a Bureau REVISION reaches the register at all — the upsert
 *      replaces on the publisher's own key.
 *   3. **Current, and shallower than the floor** → the window immediately
 *      below `oldest`. One window deeper per invocation, self-advancing, no
 *      index anywhere.
 *   4. **Current and deep enough** → `settled`: nothing is owed and NO
 *      request is made. A settled run costs one table read.
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
  /** Oldest month held, or null on a register with no rows. */
  oldest: string | null;
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

  // 1 — nothing held, or an edge the register cannot state.
  if (args.frontier === null || args.oldest === null) {
    return frontierWindow('the register holds nothing; establishing the frontier',
      pagesToCover(args.asOf, args.floor, months));
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

  // 3 — deepen by exactly one window, immediately below the oldest held.
  if (depthOwed > 0) {
    const end = shiftMonth(args.oldest, -1);
    return {
      kind: 'backfill',
      startPeriod: shiftMonth(end, -(months - 1)),
      endPeriod: end,
      minPeriods: months,
      windowsRemaining: depthOwed - 1,
      because: `the register reaches back to ${args.oldest} and is owed ${args.floor}`,
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

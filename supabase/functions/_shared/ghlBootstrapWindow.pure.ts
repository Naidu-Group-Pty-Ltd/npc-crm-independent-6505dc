/**
 * Which slice of the client list this tick looks at, and the proof that no
 * cron cadence can strand one.
 *
 * ## Why a position exists here at all
 *
 * Everything else in this import re-derives what is owed from rows that
 * already exist: `ghl_conversations.last_synced_at` says when we last looked,
 * `ghl_conversation_messages.ghl_message_id` says how deep we already hold.
 * Those are facts about rows, so they cannot go stale and a tick that dies
 * mid-flight loses nothing.
 *
 * One question has no such fact. A client with a `ghl_contact_id` and NO
 * `ghl_conversations` row is either a client nobody has asked GHL about yet
 * or a client GHL genuinely holds no conversation for, and the schema cannot
 * tell them apart. Stamping "we asked and there was nothing" would need a
 * column and therefore a migration. Sweeping the list on a clock does not.
 *
 * ## The trap this exists to make impossible
 *
 * The obvious form is `floor(now / period) % ceil(total / size)` — index the
 * windows and rotate one per tick. It strands clients the moment `period` (a
 * constant somebody typed, matching the cron they read) and the cron's actual
 * cadence disagree, which is one edit to a schedule away. The offsets then
 * form an arithmetic progression modulo the window COUNT and reach only the
 * residues of that stride: a ten-minute constant against a fifteen-minute
 * cron, over six windows, visits {0, 1, 3, 4} and never 2 or 5 — two sixths of
 * the client list permanently unreachable, silently, because a window that is
 * never visited raises no error. Against a half-hourly cron the same code
 * visits {0, 3} alone. `ghlBootstrapWindow.test.ts` executes that form beside
 * this one rather than describing it.
 *
 * ## The rule
 *
 * **The offset advances by AT MOST one window width per tick**, so consecutive
 * windows abut or overlap and their union is the whole list.
 *
 * It is held by DECLARING the fastest cadence this is built for rather than by
 * inferring it. `advancePerMinute` is `size / MAX_TICK_MINUTES`, so a tick gap
 * of anything up to `MAX_TICK_MINUTES` moves the offset by at most `size`. No
 * measurement enters that arithmetic, which is the point: a first attempt
 * derived the step from the observed gap between ticks, and a measurement that
 * is WRONG then amplifies across absolute time — measured at 2 minutes while
 * the job really fires every 15, the offset jumps 7.5 windows a tick and
 * strands a third of the list. That failure is in the test file, executed.
 *
 * The observed gap is still passed in, and it is used for exactly one thing:
 * `cadenceExceeded` reports that the job is firing further apart than this was
 * built for. A reading is for looking at; it does not steer the sweep.
 *
 * `latticeSpacing` is returned for the same reason — it is
 * `gcd(advancePerObservedTick, total)`, the true spacing of the offsets the
 * schedule visits, so the property is observable rather than merely argued.
 *
 * Pure: no imports, no clock of its own — `nowMs` is passed in, because a
 * module that reads the clock cannot be tested.
 */

/**
 * The longest gap between ticks this sweep is built for.
 *
 * `20260403080424_704c3458….sql` schedules the job every ten minutes, so this
 * carries three times that in headroom. Raising the cron's period past it is
 * the one change that needs this number raised with it — and `cadenceExceeded`
 * is what says so out loud rather than leaving it to be noticed.
 */
export const MAX_TICK_MINUTES = 30;

export interface BootstrapWindow {
  /** 0 <= offset < max(total, 1) */
  readonly offset: number;
  /** Rows to request. */
  readonly size: number;
  /** Echoed back, after flooring and clamping at zero. */
  readonly total: number;
  /** How far the offset moves per wall-clock minute. Declared, never inferred. */
  readonly advancePerMinute: number;
  /**
   * `advancePerMinute * MAX_TICK_MINUTES`, which is <= `size` by construction.
   * This is the guarantee, stated as a number a test can check.
   */
  readonly maxAdvancePerTick: number;
  /** What the OBSERVED gap actually moved it by. Reporting only. */
  readonly advancePerObservedTick: number;
  /** gcd(advancePerObservedTick, total) — the spacing the schedule visits. */
  readonly latticeSpacing: number;
  /** The job is firing further apart than `MAX_TICK_MINUTES`. Reporting only. */
  readonly cadenceExceeded: boolean;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.floor(a));
  let y = Math.abs(Math.floor(b));
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x;
}

export function bootstrapWindow(input: {
  readonly total: number;
  readonly size: number;
  readonly nowMs: number;
  /**
   * How long ago the previous tick ran, measured from the data. It does NOT
   * enter the offset — see the header. It decides `cadenceExceeded` and
   * `latticeSpacing`, both of which are readings.
   */
  readonly observedTickMinutes?: number;
}): BootstrapWindow {
  const total = Math.max(0, Math.floor(input.total));
  const size = Math.max(1, Math.floor(input.size));

  // Declared, not inferred. The FLOOR is what makes
  // `advancePerMinute * MAX_TICK_MINUTES <= size` hold for every size,
  // including one smaller than MAX_TICK_MINUTES, where it lands at 1.
  const advancePerMinute = Math.max(1, Math.floor(size / MAX_TICK_MINUTES));
  const maxAdvancePerTick = Math.min(size, advancePerMinute * MAX_TICK_MINUTES);

  const observed = Number.isFinite(input.observedTickMinutes)
    ? Math.max(0, input.observedTickMinutes as number)
    : MAX_TICK_MINUTES;
  const advancePerObservedTick = advancePerMinute * observed;

  if (total === 0) {
    // No clients to sweep. Never divide by zero, and report a lattice of 0
    // rather than pretending to a spacing over an empty list.
    return {
      offset: 0, size, total: 0,
      advancePerMinute, maxAdvancePerTick, advancePerObservedTick,
      latticeSpacing: 0,
      cadenceExceeded: observed > MAX_TICK_MINUTES,
    };
  }

  const minutes = Math.floor(input.nowMs / 60_000);
  // The double modulo keeps the offset non-negative for a nowMs before the
  // epoch, which a test supplies and a clock skew could.
  const offset = (((minutes * advancePerMinute) % total) + total) % total;

  return {
    offset,
    size,
    total,
    advancePerMinute,
    maxAdvancePerTick,
    advancePerObservedTick,
    latticeSpacing: gcd(Math.round(advancePerObservedTick), total),
    cadenceExceeded: observed > MAX_TICK_MINUTES,
  };
}

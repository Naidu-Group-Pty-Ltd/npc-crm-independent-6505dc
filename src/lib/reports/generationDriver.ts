/**
 * One driver per report.
 *
 * Two independent pumps can drive a generation and neither knew about the
 * other: `useChunkedRegeneration` (the Regenerate button) walks the section
 * loop itself, and `ReportGenerationProgress.handleContinueGeneration` walks
 * its own loop of up to sixty calls whenever `isResumable` says a report needs
 * a nudge — which is any report that has not written for `STALLED_AFTER_MS`,
 * **or any report that reads `failed`**, with auto-continue on by default.
 *
 * Measured in production on 97 Poole Road, 20 Sep 2026, from `function_logs`:
 *
 *     03:39:42  section  7/14   77,840 chars
 *     03:39:49  section 14/14  134,392 chars   "All sections complete"
 *     03:40:06  section  8/14   84,316 chars
 *     03:43:00  section 14/14  120,145 chars   "All sections complete"
 *
 * `last_completed_section` cannot go 14 → 8 in one linear run, and the
 * finished document SHRANK by 14,247 characters. Two pumps were writing the
 * same row, each rewinding the other. Whichever pump read the row after the
 * other had rewound it threw "incomplete" and stamped `failed` over a document
 * that was complete — the second time in two days that a finished run reported
 * itself failed, for a different reason each time.
 *
 * Four rules.
 *
 * **Exclusion is per driver INSTANCE, never per driver kind.** The first cut
 * of this module keyed the claim on `'regenerate' | 'auto-continue'`, and two
 * TABS both claiming as `'regenerate'` would both have succeeded — the exact
 * case the module exists for, admitted by its own key. The kind is carried
 * only so a refusal can say where the work already is; the `token` is what
 * makes it exclusive.
 *
 * **The claim lives in `localStorage`, not in a module variable**, because a
 * second tab is one of the pumps this has to separate and a module variable
 * cannot see one. Where storage is unavailable (private mode, blocked site
 * data) it falls back to a module map, which still separates the two pumps
 * *in this tab* — the race actually observed — rather than refusing to work.
 *
 * **It is a lease, never a lock.** A tab closed mid-run leaves its claim
 * behind, and a claim nobody can ever clear would strand the report for good.
 * A claim whose heartbeat has gone quiet for longer than
 * `GENERATION_DRIVER_LEASE_MS` is takeable. That ceiling is deliberately
 * longer than `STALLED_AFTER_MS` and longer than the longest section this
 * pipeline has been measured at (the closing section, 40–110s), so a live
 * driver is never displaced part-way through a section it is going to finish.
 * `oneDriverPerReport.spec.ts` pins that ordering rather than trusting it.
 *
 * **Claiming is not starting.** This module answers one question — may I drive
 * this report — and writes nothing to the report itself. Whether a run should
 * begin at all is still the caller's decision, and the server remains the
 * authority on what the row holds.
 *
 * Not a server lease. The cron watchdog already takes a real one
 * (`claim_stalled_investment_reports`, five minutes, `FOR UPDATE SKIP LOCKED`)
 * and was measured NOT to be a party to this race: its ticks at 04:30:01,
 * 04:32:01 and 04:34:00 returned in 314 ms, 286 ms and 336 ms, which is the
 * shape of "claimed 0", while a browser pump was mid-run. Both pumps in the
 * measured failure were in the browser, which is where this separates them.
 */

/** Which surface is driving. Carried for the refusal message, never for exclusion. */
export type GenerationDriverKind = 'regenerate' | 'auto-continue' | 'continue';

/**
 * One driver's identity for one run.
 *
 * `token` is what the claim compares. Two tabs, two components, or two runs of
 * the same surface each mint their own, so none of them can mistake another
 * for itself.
 */
export interface DriverIdentity {
  kind: GenerationDriverKind;
  token: string;
}

interface StoredClaim {
  kind: GenerationDriverKind;
  token: string;
  /** `Date.now()` of the last sign of life from the holder. */
  heartbeatAt: number;
}

export type ClaimResult =
  | { ok: true }
  | { ok: false; heldBy: GenerationDriverKind };

/**
 * How long a claim survives without a heartbeat.
 *
 * Must exceed `STALLED_AFTER_MS` (90s) — otherwise the widget would judge a
 * report stalled while its driver still holds a live claim, and the two
 * readings would disagree about the same run.
 */
export const GENERATION_DRIVER_LEASE_MS = 150_000;

const KEY_PREFIX = 'report-generation-driver:';

/** In-tab fallback for when `localStorage` cannot be read or written. */
const memory = new Map<string, StoredClaim>();

let counter = 0;

/** A fresh identity for one run. */
export function newDriverIdentity(kind: GenerationDriverKind): DriverIdentity {
  counter += 1;
  // `crypto.randomUUID` is absent over plain HTTP and in some embedded
  // webviews, and the token only has to be unique among the drivers racing for
  // one report — the counter already separates two in this tab.
  let unique: string;
  try {
    unique = crypto.randomUUID();
  } catch {
    unique = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
  return { kind, token: `${unique}-${counter}` };
}

function keyFor(reportId: string): string {
  return `${KEY_PREFIX}${reportId}`;
}

function isKind(value: unknown): value is GenerationDriverKind {
  return value === 'regenerate' || value === 'auto-continue' || value === 'continue';
}

function readClaim(reportId: string): StoredClaim | null {
  try {
    const raw = localStorage.getItem(keyFor(reportId));
    // A successful read is the answer, including when it says "absent".
    // Consulting the in-tab mirror here instead let a released claim come back
    // from the dead: the mirror is a FALLBACK for storage that cannot be read,
    // never a second opinion about storage that can.
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<StoredClaim>;
    if (isKind(parsed.kind) && typeof parsed.token === 'string' && typeof parsed.heartbeatAt === 'number') {
      return { kind: parsed.kind, token: parsed.token, heartbeatAt: parsed.heartbeatAt };
    }
    return null;
  } catch {
    return memory.get(reportId) ?? null;
  }
}

function writeClaim(reportId: string, claim: StoredClaim): void {
  memory.set(reportId, claim);
  try {
    localStorage.setItem(keyFor(reportId), JSON.stringify(claim));
  } catch {
    /* memory already holds it */
  }
}

function clearClaim(reportId: string): void {
  memory.delete(reportId);
  try {
    localStorage.removeItem(keyFor(reportId));
  } catch {
    /* memory is already clear */
  }
}

function isLive(claim: StoredClaim | null, now: number): claim is StoredClaim {
  return claim !== null && now - claim.heartbeatAt < GENERATION_DRIVER_LEASE_MS;
}

/**
 * Which surface is driving this report, or null when nobody is.
 *
 * A claim whose heartbeat has expired reads as nobody, so a caller asking this
 * before scheduling work gets the same answer `claimGenerationDriver` would.
 */
export function generationDriverHolder(
  reportId: string,
  now: number = Date.now(),
): GenerationDriverKind | null {
  const claim = readClaim(reportId);
  return isLive(claim, now) ? claim.kind : null;
}

/**
 * Take the claim, or report which surface holds it.
 *
 * Re-claiming with the SAME identity succeeds and refreshes the heartbeat: a
 * driver that legitimately restarts its own loop is not competing with itself,
 * and refusing there would break the retry paths both pumps already have.
 */
export function claimGenerationDriver(
  reportId: string,
  identity: DriverIdentity,
  now: number = Date.now(),
): ClaimResult {
  const claim = readClaim(reportId);
  if (isLive(claim, now) && claim.token !== identity.token) {
    return { ok: false, heldBy: claim.kind };
  }
  writeClaim(reportId, { kind: identity.kind, token: identity.token, heartbeatAt: now });
  return { ok: true };
}

/**
 * Say the holder is still working.
 *
 * Called once per section rather than on a timer, so the heartbeat measures
 * real progress: a pump wedged inside one call stops refreshing and its claim
 * becomes takeable, which is the behaviour a lease is for. A driver that no
 * longer holds the claim does not take it back by beating.
 */
export function heartbeatGenerationDriver(
  reportId: string,
  identity: DriverIdentity,
  now: number = Date.now(),
): void {
  const claim = readClaim(reportId);
  if (isLive(claim, now) && claim.token !== identity.token) return;
  writeClaim(reportId, { kind: identity.kind, token: identity.token, heartbeatAt: now });
}

/**
 * Give the claim up.
 *
 * Only the holder may release, so a pump displaced after its lease expired
 * cannot clear the claim of whoever took over from it on its way out.
 */
export function releaseGenerationDriver(reportId: string, identity: DriverIdentity): void {
  const claim = readClaim(reportId);
  if (!claim || claim.token === identity.token) clearClaim(reportId);
}

/** Where the work already is, in words an operator reads. */
export function driverHolderLabel(kind: GenerationDriverKind): string {
  switch (kind) {
    case 'regenerate':
      return 'a regeneration already running';
    case 'auto-continue':
      return 'the generation progress panel';
    case 'continue':
      return 'a continue already running';
  }
}

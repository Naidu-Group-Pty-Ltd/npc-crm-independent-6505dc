/**
 * Which registers still need a person, decided from what the run actually did.
 *
 * ── The defect this replaces ──────────────────────────────────────────
 * The determination dialog told the operator, in fixed prose:
 *
 *   "The two Commonwealth registers block automated requests, so the run
 *    above cannot read them. Open, look, and record what came back."
 *
 * By the time that sentence was read, ONE register blocked automated requests.
 * Parliament of Australia had become a loaded register the server searches on
 * every run — 225 entries — and the panel directly above the sentence said so:
 * "1 source was not searched".
 *
 * So the screen contradicted itself, in the same scroll, about the one fact
 * the section exists to convey. And it sent the operator to open by hand a
 * register the platform had just read for them.
 *
 * ── Why the fix is derivation, not a corrected sentence ───────────────
 * Correcting "two" to "one" would be true today and wrong again the first
 * time a register moves between the two states — which has now happened once
 * and will happen again, because the whole programme is about moving sources
 * from "somebody opens a tab" to "the server reads it".
 *
 * Prose that counts things is prose that goes stale. The count and the wording
 * come off the run's own `sources` here, so the screen cannot disagree with
 * the search it is describing.
 *
 * ── The three states, and why the third is not a gap ──────────────────
 * A manual link is not automatically a hole in the automated search. Some of
 * these are not registers the platform could hold at all: ParlInfo is a
 * full-text archive of the parliamentary record and ABN Lookup is a company
 * register that happens to name office holders. Listing those as "the run
 * could not read them" would report a coverage failure that does not exist,
 * which is the same overstatement in the other direction.
 */

/**
 * Manual link id → the index source key the run reports under.
 *
 * Declared, and deliberately not inferred from a name match. `aph_members` and
 * `aph_commonwealth_parliament` are the same register under two spellings,
 * and nothing about either string says so.
 */
export const MANUAL_LINK_TO_INDEX_SOURCE: Record<string, string> = {
  aph_members: "aph_commonwealth_parliament",
  /*
   * Identical on both sides today, and still declared.
   *
   * "The ids happen to match" is not a rule. Leaving this one out because it
   * needs no translation would classify the Australian Government Directory
   * as a source the platform never holds — when the run reports on it by name
   * every time, as `not_reachable`. Being absent from this map means "not a
   * register the index could hold", and the Directory is one it could.
   */
  directory_gov_au: "directory_gov_au",
};

import type { PepIndexRecency } from "./pepOfficeholderIndex.pure.ts";

export type ManualCheckState =
  /** The server read this register on the run. Open it only to confirm. */
  | "searched_by_platform"
  /** The server could not read it. Opening it is the only way it is checked. */
  | "must_check_by_hand"
  /** Never a register the platform holds — an archive or a company register. */
  | "not_held_by_platform";

export interface ManualCheck {
  id: string;
  state: ManualCheckState;
  /** What to do with it, in the imperative. */
  action: string;
}

export interface RunSourceState {
  key: string;
  status: "searched" | "unavailable" | "failed" | "not_reachable";
}

/**
 * Classify each manual register link against a run.
 *
 * With no run — the operator has not pressed the button yet — every register
 * the platform holds is `must_check_by_hand`. That is the honest default: a
 * search nobody has run has read nothing, and telling somebody a register is
 * covered before it has been searched is exactly backwards.
 */
export function classifyManualChecks(input: {
  linkIds: string[];
  runSources: RunSourceState[] | null;
}): ManualCheck[] {
  const byKey = new Map((input.runSources ?? []).map((s) => [s.key, s.status]));
  return input.linkIds.map((id): ManualCheck => {
    const indexKey = MANUAL_LINK_TO_INDEX_SOURCE[id];
    if (!indexKey) {
      return {
        id, state: "not_held_by_platform",
        action: "Open and record what came back.",
      };
    }
    const status = byKey.get(indexKey);
    if (status === "searched") {
      return {
        id, state: "searched_by_platform",
        action: "Already searched on this run — open it to confirm a candidate, "
          + "or to look for what the register holds and the index does not.",
      };
    }
    return {
      id, state: "must_check_by_hand",
      action: status === "failed"
        ? "The run could not read it this time. Open it and record what came back."
        : "The run could not read it. Open it and record what came back.",
    };
  });
}

/**
 * The sentence above the list.
 *
 * Counts what the run says rather than what somebody typed, and never says a
 * number the list below it contradicts. Written so that every branch is true
 * of some real state rather than one branch being the expected case.
 */
export function describeManualChecks(checks: ManualCheck[], hasRun: boolean): string {
  const blocked = checks.filter((c) => c.state === "must_check_by_hand").length;
  const covered = checks.filter((c) => c.state === "searched_by_platform").length;

  if (!hasRun) {
    return "Run the screening above first — it reads the registers the platform "
      + "holds. Whatever it cannot reach is checked here, by hand.";
  }
  if (blocked === 0) {
    return covered > 0
      ? "Every register the platform holds was read on this run. These are the "
        + "places to confirm a candidate, and the sources no register covers."
      : "These are the sources no register the platform holds covers. Open, "
        + "look, and record what came back.";
  }
  const noun = blocked === 1 ? "register" : "registers";
  return `${blocked} ${noun} below cannot be read from here, so the run above did `
    + "not check " + (blocked === 1 ? "it" : "them") + ". Open, look, and record "
    + "what came back.";
}

/**
 * The recency reading a RUN carries, in the shape the renderer already uses.
 *
 * An adapter and not a second implementation. `describeTenure` is the one
 * place that turns "held" plus an as-at into words, and it takes a
 * `PepIndexRecency` because it was written for the index panel, which has a
 * full coverage row. A screening run stores less — the as-at it searched
 * against and the currency reading it recorded at the time — so this fills
 * the gap rather than restating the sentence somewhere else.
 *
 * `ageDays` is computed from the as-at at render time, which is the honest
 * number: the question is how long ago the register was read, and that grows
 * whether or not anybody reruns the screening.
 */
export function recencyFromRunSource(
  asAt: string | null | undefined,
  currency: "fresh" | "ageing" | "stale" | "never" | null | undefined,
  nowMs: number,
): PepIndexRecency {
  const loaded = asAt ? Date.parse(asAt) : NaN;
  if (!Number.isFinite(loaded)) {
    return {
      reading: "never", ageDays: null, loadedAt: null,
      reason: "The register did not record when it was read.",
    };
  }
  return {
    reading: currency ?? "fresh",
    ageDays: Math.max(0, Math.floor((nowMs - loaded) / 86_400_000)),
    loadedAt: new Date(loaded).toISOString().slice(0, 10),
    reason: "",
  };
}

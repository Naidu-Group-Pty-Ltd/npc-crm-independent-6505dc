/**
 * Carrying what the run already read into the manual checklist.
 *
 * ── The defect this closes ────────────────────────────────────────────
 * The screening panel would report, plainly, that the platform had searched
 * two registers under this name and found nothing — and the checklist
 * directly below it then asked an operator to open those same two registers
 * and record what came back. Four rows, "0 of 4 recorded", no distinction
 * between the registers a server had just read and the ones only a person
 * can reach. The work the platform had done was displayed and then demanded
 * again.
 *
 * ── What this does, and what it deliberately does not ─────────────────
 * A register the run reports as `searched` is recorded here FROM THE RUN:
 * the row says which register, what was searched, and what came back, in the
 * run's own terms. It is an ordinary row in the same `rows` state — editable,
 * removable, and counted by `assessPepEvidence` exactly as a hand-typed one
 * is. Nothing about what the server accepts changes.
 *
 * Three rules hold it:
 *
 * 1. **Only `searched` cascades.** `unavailable`, `failed` and
 *    `not_reachable` leave the register outstanding — a read that FAILED is
 *    not a register that was empty, and pre-filling those would be the
 *    confident-clear-against-nothing failure this platform has had before.
 * 2. **A cascaded row is never a clearance.** The wording states a result
 *    about the SEARCH ("0 matches under this name"), carries the register's
 *    currency date when it has one, and says the platform performed it. The
 *    determination is still the operator's.
 * 3. **A register absent from `MANUAL_LINK_TO_INDEX_SOURCE` never cascades.**
 *    ParlInfo and ABN Lookup are not registers the index holds, so no run
 *    result can speak for them however the labels happen to read.
 */
import { MANUAL_LINK_TO_INDEX_SOURCE } from "./pepManualChecks";

/** One source as the run reported it — the fields the cascade needs. */
export interface RunSourceReading {
  key: string;
  status: "searched" | "unavailable" | "failed" | "not_reachable";
  label?: string;
  foundCount?: number;
  asAt?: string | null;
}

/** A register offered in the checklist. */
export interface CascadeTarget {
  id: string;
  kind: string;
  label: string;
  /** The names the operator would have typed into it. */
  searchTerms: string;
}

export interface CascadeDraft {
  searchId: string;
  kind: string;
  source: string;
  reference: string;
  result: string;
}

/** How a cascaded result is worded. One place, so it cannot drift. */
export function describeRunResult(s: RunSourceReading): string {
  const found = typeof s.foundCount === "number" ? s.foundCount : 0;
  const matches = `${found} match${found === 1 ? "" : "es"} under this name`;
  const current = s.asAt ? `, register current to ${s.asAt}` : "";
  return `Searched by the platform on this run — ${matches}${current}`;
}

/**
 * The rows a completed run can record on the operator's behalf.
 *
 * Returns drafts only; the caller decides how to merge them, and never
 * overwrites a row an operator has already put against that register.
 */
export function cascadeRunResults({ targets, sources }: {
  targets: CascadeTarget[];
  sources: RunSourceReading[] | null;
}): CascadeDraft[] {
  if (!sources || sources.length === 0) return [];
  const drafts: CascadeDraft[] = [];
  for (const t of targets) {
    const key = MANUAL_LINK_TO_INDEX_SOURCE[t.id];
    if (!key) continue;
    const s = sources.find((x) => x.key === key);
    if (!s || s.status !== "searched") continue;
    drafts.push({
      searchId: t.id,
      kind: t.kind,
      source: s.label ?? t.label,
      reference: t.searchTerms,
      result: describeRunResult(s),
    });
  }
  return drafts;
}

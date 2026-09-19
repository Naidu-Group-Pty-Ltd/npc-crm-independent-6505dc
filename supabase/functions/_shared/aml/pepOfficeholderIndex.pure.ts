/**
 * The public office-holder index: what it holds, and what it can never say.
 *
 * ── The one rule ──────────────────────────────────────────────────────
 * A HIT is a candidate. A MISS is nothing.
 *
 * No public source lists every prominent public function, none lists family
 * members or close associates at all, and the sources that do exist disagree
 * with each other about spelling, titles and dates. An index built from them
 * is useful for the same reason a commercial PEP database is useful — it
 * surfaces a name worth looking at — and it is dangerous for exactly one
 * reason: it returns zero rows for a person it never covered in the first
 * place, and zero rows reads like an answer.
 *
 * This platform has already had that failure once. `aml.sanctions_entries`
 * was empty from the day it was built, and every screening against it would
 * have cleared everybody. So `describeCoverage` exists, it is attached to
 * every search result, and `searchVerdict` will not produce the word "clear"
 * in any branch.
 *
 * ── Why these sources ─────────────────────────────────────────────────
 * All public, all machine-readable, none licensed:
 *
 *   `aph_commonwealth_parliament` — the register Parliament publishes of its
 *   own senators and members. Authoritative, and narrow: it is a snapshot of
 *   who sits TODAY, with no dates and not one former member in it.
 *
 *   `wikidata_au_public_office` — office holders with a position, a start
 *   and an end. Collaboratively edited, far broader, and the only reachable
 *   source that carries FORMER holders, which is the gap the current
 *   government directory leaves and the one AUSTRAC is most explicit about:
 *   leaving office does not end the risk.
 *
 * The narrower source being the more authoritative one is not a defect to
 * reconcile, it is the shape of what is public. Neither replaces the other,
 * and an absence from both is still not an answer about anybody.
 *
 * Wikidata is collaboratively edited, which is precisely why a hit from it
 * is a lead rather than a source. Every row carries `confirm_url` — the
 * official register the operator confirms against — and the evidence a
 * determination rests on is what they record from THAT, never from here.
 *
 * ── Coverage is MEASURED, not claimed ─────────────────────────────────
 * `covers` used to be a sentence: "Commonwealth, state and territory
 * parliamentarians, ministers, judges, heads of agency…". The first real
 * load wrote 1,254 people across TWO offices — the House of Representatives
 * and its Speaker — because the query walked the wrong root. The load was
 * green, the number was plausible, and the sentence on screen was false.
 *
 * A claim nobody measures is a claim nobody can check, and an overstated
 * coverage line is worse than an unavailable index: it tells an operator
 * that an absence means more than it does. So the prose now describes the
 * SHAPE of the source, and the specifics an operator relies on — how many
 * offices were reached, how many people, which ones — are read off the load
 * itself and rendered beside it.
 */

import type { PepDobComparison } from "./pepCandidateMatch.pure.ts";
import type { PepRuleCoverage } from "./pepRuleCoverage.pure.ts";

export const PEP_INDEX_SOURCES = [
  {
    code: "aph_commonwealth_parliament",
    label: "Senators and members of the Australian Parliament",
    confirmAgainst: "the Parliament of Australia's own parliamentarian search",
    /*
     * Every clause here is a fact about the two files, not a claim about
     * what a federal register ought to hold. They carry no dates at all,
     * which is why "currently sitting" is the whole of the coverage and why
     * the exclusion below is the one that matters most.
     */
    covers:
      "the senators and members currently sitting in the Commonwealth "
      + "Parliament, together with the ministerial and parliamentary offices "
      + "each of them holds",
    excludes:
      "former members and senators — the register is a snapshot of who sits "
      + "today and holds nobody who has left — along with state and territory "
      + "parliaments, non-parliamentary office holders, and family members "
      + "and close associates",
    /* Published by the Parliament itself. */
    collaborative: false,
  },
  {
    code: "wikidata_au_public_office",
    label: "Australian public office holders (Wikidata)",
    /** The register an operator confirms a candidate against. */
    confirmAgainst: "the official register for the office named",
    /**
     * The SHAPE of what the source holds. Anything countable — how many
     * offices, how many people, which ones — comes off the load instead.
     */
    covers:
      "offices whose jurisdiction is Australia or one of its states and "
      + "territories, and the people recorded as having held them — current "
      + "and former",
    excludes:
      "family members and close associates, office holders with no public "
      + "record, and foreign offices held overseas",
    collaborative: true,
  },
] as const;

export type PepIndexSourceCode = (typeof PEP_INDEX_SOURCES)[number]["code"];

export interface PepIndexCoverage {
  sourceCode: string;
  label: string;
  covers: string;
  excludes: string;
  /** Whether the source is collaboratively edited, said out loud. */
  collaborative: boolean;
  entryCount: number;
  /**
   * How many distinct offices the load actually reached, and a sample.
   *
   * Measured by the loader and rendered on screen, because this is exactly
   * the fact a coverage sentence got wrong: a load holding two offices read
   * identically to one holding seven hundred.
   */
  officeCount: number | null;
  sampleOffices: string[];
  /**
   * Which AML/CTF Rule categories this load reached, measured by the loader.
   *
   * Empty when a load predates the measurement — which is not the same as a
   * load that reached nothing, and `ruleCoverageMeasured` is the flag that
   * keeps the two apart. Rendering "no category evidenced" for an older load
   * would report a gap that was never tested for.
   */
  ruleCategories: PepRuleCoverage[];
  ruleCoverageMeasured: boolean;
  /** Office titles no category recognised. What makes every count a floor. */
  unclassifiedOffices: number;
  /** When the source itself says it is current to — not when we synced. */
  sourceAsAt: string | null;
  lastSyncedAt: string | null;
  lastSyncStatus: "succeeded" | "failed" | "running" | "never" | string;
}

export interface PepIndexCandidate {
  externalId: string;
  sourceCode: string;
  fullName: string;
  aliases: string[];
  positionTitle: string;
  /**
   * Null, and it stays null. The AUSTRAC category is part of the
   * determination the operator reaches, not something an index asserts.
   */
  pepType: "foreign" | "domestic" | "international_organisation" | null;
  jurisdiction: string | null;
  positionStart: string | null;
  positionEnd: string | null;
  currentlyHeld: boolean | null;
  confirmUrl: string | null;
  /**
   * The source's own date of birth, at the source's own precision — `1961`,
   * `1961-03` or `1961-03-02`. Null where the register publishes none, and
   * an absent date is never a disagreement.
   */
  dateOfBirth: string | null;
  /**
   * How that compares with the party's recorded date of birth.
   *
   * Present on every candidate, including the ones where there is nothing to
   * compare — the two absences are distinguishable readings, and the one
   * where the PARTY has no date on file is something the operator can fix.
   *
   * It never decided whether this candidate is here. See
   * `pepCandidateMatch.pure.ts`.
   */
  dob: PepDobComparison | null;
  /** 0–1 on the NAME alone — the number that admitted this candidate. */
  score: number;
}

/**
 * What a search RESULT means. Four readings, and none of them is "clear".
 *
 * `unavailable` is deliberately distinct from `no_candidates`: an index that
 * has never loaded, or whose last load failed, has not looked. Reporting that
 * as "nothing found" is the exact shape of the sanctions defect — a technical
 * condition wearing a customer outcome's clothes.
 */
export type PepIndexReading =
  | "candidates"
  | "no_candidates"
  | "unavailable"
  | "not_searchable";

export interface PepIndexVerdict {
  reading: PepIndexReading;
  /** One sentence, in the operator's language. Never a conclusion. */
  message: string;
  candidates: PepIndexCandidate[];
  coverage: PepIndexCoverage[];
}

/** Coverage prose for one source, from its row in the sync table. */
export function describeCoverage(
  sourceCode: string,
  sync: {
    entry_count?: number | null;
    source_as_at?: string | null;
    completed_at?: string | null;
    started_at?: string | null;
    status?: string | null;
    detail?: {
      office_count?: number | null;
      distinct_offices?: number | null;
      sample_offices?: unknown;
      rule_categories?: unknown;
      unclassified_offices?: number | null;
    } | null;
  } | null,
): PepIndexCoverage {
  const source = PEP_INDEX_SOURCES.find((s) => s.code === sourceCode);
  const detail = sync?.detail ?? null;
  const offices = detail?.distinct_offices ?? detail?.office_count ?? null;
  const sample = Array.isArray(detail?.sample_offices)
    ? (detail!.sample_offices as unknown[])
      .map((o) => String(o ?? "").trim()).filter(Boolean).slice(0, 12)
    : [];
  const rawCategories = Array.isArray(detail?.rule_categories)
    ? (detail!.rule_categories as PepRuleCoverage[]) : null;

  return {
    sourceCode,
    label: source?.label ?? sourceCode,
    ruleCategories: rawCategories ?? [],
    // A load from before this was measured is UNMEASURED, not empty.
    ruleCoverageMeasured: rawCategories !== null,
    unclassifiedOffices: Number(detail?.unclassified_offices ?? 0),
    covers: source?.covers ?? "",
    excludes: source?.excludes ?? "",
    collaborative: source?.collaborative ?? true,
    entryCount: Number(sync?.entry_count ?? 0),
    officeCount: typeof offices === "number" && Number.isFinite(offices) ? offices : null,
    sampleOffices: sample,
    sourceAsAt: sync?.source_as_at ?? null,
    lastSyncedAt: sync?.completed_at ?? sync?.started_at ?? null,
    lastSyncStatus: sync?.status ?? "never",
  };
}

/* ══════════════════════════════════════════════════════════════════════
 * HOW CURRENT IS IT — a different question from whether it loaded
 * ══════════════════════════════════════════════════════════════════════
 *
 * This index makes a claim no sanctions list makes: `currently_held`.
 *
 * Every row from the Parliament register carries `currently_held: true`, by
 * construction — the files are a snapshot of who sits today and hold no dates
 * at all. That is accurate at the moment of the load and decays from then on.
 * A member who loses their seat at an election is still shown as **Current**
 * for as long as nothing reloads, and that claim reaches the evidence record:
 * `candidateToMethodDraft` writes "current" or "former" into the source row a
 * determination rests on.
 *
 * Nothing measured that. `indexIsUsable` asks whether a load succeeded and
 * holds rows, and a load that succeeded eight months ago passes it exactly as
 * a load from this morning does — which is the shape of the failure the
 * sanctions register already had once, where freshness of the LOAD was being
 * read as currency of the DATA.
 *
 * ── Usability and currency stay separate ──────────────────────────────
 * `indexIsUsable` is unchanged and deliberately does not consult this. A
 * stale index is still usable: its rows are still leads, and refusing to
 * search it would remove the only assistance an operator has. What it cannot
 * do is support an assertion about TODAY, so the assertion is what gets
 * qualified — "recorded as current on 2026-02-01" rather than "Current".
 *
 * Collapsing the two would repeat the mistake this codebase keeps finding in
 * a new place each time: one badge answering two questions.
 */

/** The refresh runs weekly, so the thresholds are counted in missed runs. */
export const PEP_INDEX_AGEING_AFTER_DAYS = 14;   // two missed runs
export const PEP_INDEX_STALE_AFTER_DAYS = 45;    // six

export type PepIndexRecencyReading = "fresh" | "ageing" | "stale" | "never";

export interface PepIndexRecency {
  reading: PepIndexRecencyReading;
  ageDays: number | null;
  loadedAt: string | null;
  /** One sentence, in the operator's language. Never about a person. */
  reason: string;
}

export function assessIndexRecency(
  coverage: PepIndexCoverage,
  nowMs: number,
  ageingAfterDays: number = PEP_INDEX_AGEING_AFTER_DAYS,
  staleAfterDays: number = PEP_INDEX_STALE_AFTER_DAYS,
): PepIndexRecency {
  const loaded = coverage.lastSyncedAt ? Date.parse(coverage.lastSyncedAt) : NaN;
  if (coverage.lastSyncStatus !== "succeeded" || !Number.isFinite(loaded)) {
    return {
      reading: "never", ageDays: null, loadedAt: null,
      reason: "This register has no successful load, so nothing about it is "
        + "current or out of date — it simply has not been read.",
    };
  }
  const ageDays = Math.max(0, Math.floor((nowMs - loaded) / 86_400_000));
  const loadedAt = new Date(loaded).toISOString().slice(0, 10);

  if (ageDays > staleAfterDays) {
    return {
      reading: "stale", ageDays, loadedAt,
      reason: `Last loaded ${loadedAt}, ${ageDays} days ago. The refresh runs `
        + "weekly, so this has missed several. Entries it marks as currently "
        + "held were current on that date and nothing since has been read.",
    };
  }
  if (ageDays > ageingAfterDays) {
    return {
      reading: "ageing", ageDays, loadedAt,
      reason: `Last loaded ${loadedAt}, ${ageDays} days ago — the weekly `
        + "refresh has missed at least one run.",
    };
  }
  return {
    reading: "fresh", ageDays, loadedAt,
    reason: `Last loaded ${loadedAt}.`,
  };
}

/**
 * How to say "current" about a register that was read on a particular day.
 *
 * There is no branch here that says the bare word "Current". The register
 * recorded a state on a date; whether it still holds is a question about
 * today that no stored row can answer.
 */
export function describeTenure(
  currentlyHeld: boolean | null,
  recency: PepIndexRecency,
): string {
  if (currentlyHeld === null) return "Dates not recorded";
  if (currentlyHeld === false) return "Formerly held";
  if (!recency.loadedAt) return "Recorded as held, date of record unknown";
  return recency.reading === "fresh"
    ? `Held as at ${recency.loadedAt}`
    : `Held as at ${recency.loadedAt} — ${recency.ageDays} days ago`;
}

/**
 * Whether the index is in a state where a search means anything.
 *
 * Fails the same way the sanctions provider does: an empty index, or one
 * whose latest load failed, is UNAVAILABLE rather than empty. Refusal is
 * visible; a confident nothing is not.
 */
export function indexIsUsable(coverage: PepIndexCoverage[]): boolean {
  return coverage.some((c) => c.entryCount > 0 && c.lastSyncStatus === "succeeded");
}

/**
 * Turn a set of candidates into a reading, with the sentence that goes on
 * screen beside it.
 *
 * Every branch is written so that it cannot be paraphrased into a
 * determination. "No candidate" says what was searched and what the search
 * does not reach; it never says the person is not a PEP.
 */
export function searchVerdict(input: {
  hasSearchableName: boolean;
  candidates: PepIndexCandidate[];
  coverage: PepIndexCoverage[];
}): PepIndexVerdict {
  const { candidates, coverage } = input;
  if (!input.hasSearchableName) {
    return {
      reading: "not_searchable",
      message: "There is no name on this party that can be searched.",
      candidates: [], coverage,
    };
  }
  if (!indexIsUsable(coverage)) {
    return {
      reading: "unavailable",
      message: "The office-holder index has not loaded, so nothing was searched. "
        + "Check the public sources directly.",
      candidates: [], coverage,
    };
  }
  if (candidates.length === 0) {
    return {
      reading: "no_candidates",
      message: "No candidate in the index. The index does not cover family members, "
        + "close associates or foreign office holders, so this is not an answer to "
        + "the question — check the sources and record what you find.",
      candidates: [], coverage,
    };
  }
  return {
    reading: "candidates",
    message: `${candidates.length} possible office holder`
      + `${candidates.length === 1 ? "" : "s"} with a similar name. `
      + "Confirm against the official register before relying on any of them.",
    candidates, coverage,
  };
}

/**
 * The source row a confirmed candidate becomes.
 *
 * `result` is deliberately EMPTY. The operator has to say what they saw when
 * they confirmed it — an index hit auto-filled as its own result would be the
 * platform writing the operator's evidence for them, which is the thing that
 * makes a record indefensible.
 */
export function candidateToMethodDraft(c: PepIndexCandidate): {
  kind: string; source: string; reference: string; result: string;
} {
  const held = c.currentlyHeld === false ? "former" : c.currentlyHeld === true ? "current" : null;
  const span = [c.positionStart, c.positionEnd].filter(Boolean).join(" – ");
  return {
    kind: "official_register",
    source: c.confirmUrl
      ? `${c.positionTitle}${c.jurisdiction ? `, ${c.jurisdiction}` : ""} — confirmed against the official register`
      : `${c.positionTitle}${c.jurisdiction ? `, ${c.jurisdiction}` : ""}`,
    reference: [c.fullName, held, span].filter(Boolean).join(" · "),
    result: "",
  };
}

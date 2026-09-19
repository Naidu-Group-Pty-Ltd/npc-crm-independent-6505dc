/**
 * The PEP screening engine: what the platform can establish by itself.
 *
 * ── What this is for ──────────────────────────────────────────────────
 * Determining political exposure used to mean opening five websites in five
 * tabs, typing a name into each, and remembering what came back. That is slow,
 * it is inconsistent between operators, and the record of it is whatever
 * somebody typed afterwards.
 *
 * This runs the searches the platform can run, against the registers it holds,
 * and returns a STRUCTURED result: which sources were searched, which could
 * not be, what was found, and which of those findings are PEP indicators. The
 * reviewer or MLRO then reads that and makes the determination.
 *
 * ── The line this must never cross ────────────────────────────────────
 * **It screens. It does not determine.**
 *
 * An automated search that finds nothing has established nothing. It has
 * searched some registers and not others; it cannot see a foreign office it
 * does not hold, a family relationship nobody publishes, or a person whose
 * name is spelled differently in the source. So:
 *
 *   - the verdict vocabulary shares NO value with the determination
 *     vocabulary, and a test asserts it. There is no `clear`, no `not_pep`,
 *     no `pass`;
 *   - `no_indicators` is a statement about the SEARCH, and it always travels
 *     with what the search did not reach;
 *   - a source that failed is reported as failed, never as empty — the
 *     difference between "looked and found nothing" and "could not look" is
 *     the whole reliability of the result;
 *   - anything unreached forces `requiresManualReview`.
 *
 * ── Why the registers are local ───────────────────────────────────────
 * Every source here is one the platform has already loaded and holds itself:
 * `aml.pep_officeholders` and `aml.sanctions_entries`. That is deliberate.
 *
 * The obvious alternative — calling public APIs live at the moment of the
 * decision — was measured and rejected. Wikidata's action API answered `429
 * You are making too many requests` on the first call from this deployment's
 * egress, and its SPARQL endpoint answered `504` to a query it could not
 * finish inside sixty seconds. A compliance decision cannot depend on a
 * third party's rate limiter. Loading on a schedule and screening locally
 * makes the run instant, reproducible, auditable, and independent of anyone
 * else's uptime at the moment it matters.
 */

/** A source the engine tried to search. */
export interface PepScreeningSourceResult {
  key: string;
  label: string;
  /**
   * `searched` — the register was read and the result below is complete.
   * `unavailable` — the register is not loaded, or its last load failed.
   * `failed` — the read itself errored. NOT the same as finding nothing.
   * `not_reachable` — the source cannot be searched from the server at all
   *   (a WAF that blocks scripted clients), so it stays a manual check.
   */
  status: "searched" | "unavailable" | "failed" | "not_reachable";
  /** What the source holds, in the source's own terms. Always rendered. */
  coverage: string;
  /** What it does NOT hold. Rendered beside every result, including empty. */
  excludes: string;
  /** Matches found. Zero is a result only when `status` is `searched`. */
  foundCount: number;
  /** How current the source is, when it says. */
  asAt?: string | null;
  /**
   * How old the LOAD is, which is a different question from `asAt`.
   *
   * Only the office-holder registers carry one, and only they need it: they
   * are the sources that assert `currently_held`, and that assertion was true
   * on the day of the load and decays from there.
   */
  currency?: "fresh" | "ageing" | "stale" | "never" | null;
  detail?: string | null;
}

/** Something found that bears on political exposure. Never a conclusion. */
export interface PepIndicator {
  key: string;
  /** Which source produced it. */
  sourceKey: string;
  /**
   * `possible_match` — a name match that a person must confirm or dismiss.
   * `sanctions_signal` — a designation, which frequently accompanies office.
   * `declaration` — the customer said so themselves.
   * `coverage_gap` — something the search could not reach. Not a finding
   *   about the subject; a finding about the search.
   */
  kind: "possible_match" | "sanctions_signal" | "declaration" | "coverage_gap";
  severity: "review" | "attention" | "context";
  headline: string;
  detail: string;
  /** The candidate this indicator is about, when it is about one. */
  candidateId?: string | null;
}

export interface PepScreeningCandidate {
  id: string;
  sourceKey: string;
  name: string;
  aliases: string[];
  positionTitle: string | null;
  jurisdiction: string | null;
  positionStart: string | null;
  positionEnd: string | null;
  currentlyHeld: boolean | null;
  confirmUrl: string | null;
  /** The register's own date of birth, at the register's own precision. */
  dateOfBirth?: string | null;
  /**
   * How that compared with the party's. Recorded on the run so the evidence
   * shows what the operator was shown — and it ORDERED this list, it never
   * shortened it.
   */
  dob?: PepDobComparison | null;
  /** 0–1 on the NAME alone. The only thing that admitted this candidate. */
  score: number;
}

/**
 * What the RUN concluded about itself.
 *
 * Every value is a statement about the search. None of them can be read as a
 * statement about the person — `pepDeterminationVocabulary.spec` asserts this
 * set and the determination outcomes are disjoint.
 */
export type PepScreeningVerdict =
  | "indicators_found"
  | "no_indicators"
  | "incomplete"
  | "not_searchable";

export interface PepScreeningRun {
  verdict: PepScreeningVerdict;
  /** One sentence. Never a conclusion about the subject. */
  message: string;
  sources: PepScreeningSourceResult[];
  candidates: PepScreeningCandidate[];
  indicators: PepIndicator[];
  /**
   * Whether a person must look further before determining.
   *
   * True whenever anything was found, anything could not be searched, or the
   * customer never answered. In practice that is almost always — which is
   * correct: this engine exists to inform a determination, not to shorten it
   * to a tick.
   */
  requiresManualReview: boolean;
  /** Everything the run could not reach, in the operator's words. */
  notReached: string[];
  searchedNames: string[];
}

/**
 * The sources that cannot be searched from a server, and why.
 *
 * Measured, not assumed. Each of these answers 403 to a scripted client while
 * serving a browser normally — the same WAF behaviour DFAT's list has. They
 * stay on the manual list, and the engine SAYS it did not check them rather
 * than quietly omitting them, because a source nobody mentions reads as a
 * source nobody needed.
 */
export const SERVER_UNREACHABLE_SOURCES: ReadonlyArray<{
  key: string; label: string; coverage: string; excludes: string; detail: string;
}> = [
  {
    key: "directory_gov_au",
    label: "Australian Government Directory",
    coverage: "Commonwealth office holders, senior officials and board appointments",
    excludes: "state and territory offices, and anybody not currently appointed",
    detail: "Blocks automated requests. Open it from the manual checks below.",
  },
];

/*
 * ── What used to be in that list, and why it is not ───────────────────
 * `aph_members` — "Parliament of Australia — senators and members",
 * "Blocks automated requests" — sat here from the day the engine was
 * written, and it was a true sentence about the wrong thing.
 *
 * `www.aph.gov.au/Senators_and_Members/Members` does answer 403 to a
 * scripted client, from every environment measured. But Parliament also
 * publishes its register as CSV on `static.aph.gov.au`, and that downloads
 * cleanly from a GitHub runner and from this repository's own container:
 * 150 members, 75 senators, on every attempt.
 *
 * So the site blocks automated clients and the register it publishes does
 * not. Those are different facts, and collapsing them meant the product
 * told operators the federal Parliament was out of reach while an
 * authoritative federal register sat one URL away — and then sent them to
 * open it by hand.
 *
 * It is now `aph_commonwealth_parliament` in `PEP_INDEX_SOURCES`, loaded
 * weekly and searched server-side. A source cannot be in both lists: this
 * one is for registers nothing here reads, and a test asserts the two do
 * not overlap.
 */

import type { PepDobComparison } from "./pepCandidateMatch.pure.ts";

const clean = (v: unknown) => String(v ?? "").trim();

/**
 * Assemble the run from what each source returned.
 *
 * Pure: every source result is passed in, already read. The caller does the
 * I/O; this decides what it means, so the meaning is testable without a
 * database and identical everywhere it is rendered.
 */
export function buildScreeningRun(input: {
  searchedNames: string[];
  sources: PepScreeningSourceResult[];
  candidates: PepScreeningCandidate[];
  /** Confirmed / candidate / none, from the party's sanctions screening. */
  sanctionsSignal: "none" | "candidate" | "confirmed";
  /** What the customer answered, when they answered. */
  declaration: { answered: boolean; answer: "yes" | "no" | null; summary?: string | null } | null;
}): PepScreeningRun {
  const { sources, candidates, searchedNames } = input;
  const indicators: PepIndicator[] = [];

  if (searchedNames.length === 0) {
    return {
      verdict: "not_searchable",
      message: "There is no name on this party that can be searched.",
      sources, candidates: [], indicators: [],
      requiresManualReview: true,
      notReached: sources.map((s) => s.label),
      searchedNames,
    };
  }

  /* A candidate is a lead. Every one of them needs a person to look. */
  for (const c of candidates) {
    const held = c.currentlyHeld === false ? "formerly held"
      : c.currentlyHeld === true ? "currently held" : "dates not recorded";
    indicators.push({
      key: `candidate:${c.id}`,
      sourceKey: c.sourceKey,
      kind: "possible_match",
      /*
       * `review`, whatever the dates say.
       *
       * A birth date that disagrees is written into the detail for the
       * reviewer to weigh, and it does not soften the indicator: the
       * registers disagree with each other and with official records often
       * enough that a date is a reason to look harder, never a reason to look
       * less. Downgrading the severity would be the engine forming the
       * conclusion the reviewer is there to form.
       */
      severity: "review",
      headline: `Possible match — ${c.name}`,
      detail: `${c.positionTitle ?? "Office not recorded"}`
        + `${c.jurisdiction ? `, ${c.jurisdiction}` : ""} · ${held}`
        + ` · ${Math.round(c.score * 100)}% name match.`
        + (c.dob?.sentence ? ` ${c.dob.sentence}` : "")
        + " Confirm against the official register before relying on it.",
      candidateId: c.id,
    });
  }

  /*
   * One direction only. A designation frequently accompanies public office,
   * so a match is a reason to look harder — a clear result carries no
   * information about political exposure and is deliberately silent.
   */
  if (input.sanctionsSignal === "confirmed") {
    indicators.push({
      key: "sanctions:confirmed",
      sourceKey: "sanctions_register",
      kind: "sanctions_signal",
      severity: "attention",
      headline: "Confirmed sanctions match on this party",
      detail: "Designated persons frequently hold or have held prominent public "
        + "functions. Consider the listed role when determining political exposure. "
        + "The designation is not itself the determination.",
    });
  } else if (input.sanctionsSignal === "candidate") {
    indicators.push({
      key: "sanctions:candidate",
      sourceKey: "sanctions_register",
      kind: "sanctions_signal",
      severity: "context",
      headline: "Unadjudicated sanctions candidate on this party",
      detail: "If it is confirmed, the listed role may bear on political exposure.",
    });
  }

  /* The customer's own answer is evidence, and it is never the answer. */
  if (input.declaration?.answered && input.declaration.answer === "yes") {
    indicators.push({
      key: "declaration:yes",
      sourceKey: "client_declaration",
      kind: "declaration",
      severity: "review",
      headline: "The customer declared political exposure",
      detail: clean(input.declaration.summary)
        || "The customer answered yes to the political-exposure question.",
    });
  } else if (!input.declaration?.answered) {
    indicators.push({
      key: "declaration:unanswered",
      sourceKey: "client_declaration",
      kind: "coverage_gap",
      severity: "attention",
      headline: "The customer has not answered the political-exposure question",
      detail: "An unanswered question is not a declaration that they are not "
        + "politically exposed. Family members and close associates are reached by "
        + "asking, and no register here publishes them.",
    });
  }

  /* Anything the run could not reach is a finding about the SEARCH. */
  const notReached: string[] = [];
  for (const s of sources) {
    if (s.status === "searched") continue;
    notReached.push(s.label);
    indicators.push({
      key: `gap:${s.key}`,
      sourceKey: s.key,
      kind: "coverage_gap",
      severity: s.status === "not_reachable" ? "context" : "attention",
      headline: `${s.label} was not searched`,
      detail: s.detail
        ?? (s.status === "failed"
          ? "The register could not be read. That is a technical condition, not a result."
          : "The register is not loaded, so nothing was searched against it."),
    });
  }

  /*
   * A register that WAS searched but is out of date.
   *
   * Not a finding about the person, and not an unreached source either — it
   * was read, and what it returned is real. What it cannot support is the
   * claim `currently_held` makes: those rows were current on the day of the
   * load, and an office-holder register that has missed six weekly refreshes
   * is asserting a seat is held on evidence nobody has re-read.
   *
   * `coverage_gap` is deliberately the kind. It is excluded from the real
   * findings, so a stale register never turns an empty search into
   * `indicators_found` — that would report a fact about our loader as a fact
   * about the customer. It does force a person to look, which is the whole
   * of what an old register warrants.
   *
   * `ageing` gets its sentence on the source row and no gap: one missed
   * weekly run is not a hole in the search.
   */
  for (const s of sources) {
    if (s.status !== "searched" || s.currency !== "stale") continue;
    indicators.push({
      key: `stale:${s.key}`,
      sourceKey: s.key,
      kind: "coverage_gap",
      severity: "attention",
      headline: `${s.label} is out of date`,
      detail: (s.detail ?? "This register has not been reloaded recently.")
        + " It was searched and what it returned is real, but an entry it "
        + "marks as currently held was current at the load and has not been "
        + "re-read since.",
    });
  }

  const realFindings = indicators.filter(
    (i) => i.kind === "possible_match" || i.kind === "sanctions_signal"
      || (i.kind === "declaration"));
  const searchedAny = sources.some((s) => s.status === "searched");

  if (!searchedAny) {
    return {
      verdict: "incomplete",
      message: "No register could be searched, so nothing was checked. "
        + "Work through the manual checks below.",
      sources, candidates, indicators,
      requiresManualReview: true, notReached, searchedNames,
    };
  }

  if (realFindings.length > 0) {
    return {
      verdict: "indicators_found",
      message: `${realFindings.length} thing${realFindings.length === 1 ? "" : "s"} `
        + "to consider before determining. Each is a lead, not a finding.",
      sources, candidates, indicators,
      requiresManualReview: true, notReached, searchedNames,
    };
  }

  return {
    verdict: "no_indicators",
    /*
     * The sentence this whole module exists to get right. It reports on the
     * SEARCH and immediately says what the search did not reach, because
     * "nothing found" with nothing beside it is read as "nobody is exposed".
     */
    message: verdictMessage(notReached),
    sources, candidates, indicators,
    /*
     * Any gap forces a person to look — not only an unreached register.
     *
     * An unanswered political-exposure question is exactly such a gap: no
     * register here publishes family members or close associates, so asking
     * the customer is the ONLY route to them. Treating "we searched and found
     * nothing" as settled while that question is open would let the one
     * source that covers the gap go unread.
     */
    requiresManualReview: notReached.length > 0
      || indicators.some((i) => i.kind === "coverage_gap"),
    notReached, searchedNames,
  };
}

/** Kept separate so the wording is asserted in one place. */
function verdictMessage(notReached: string[]): string {
  const base = "The registers searched returned nothing for this name. That is a "
    + "result about the search, not about the person — it is not a determination "
    + "and it does not clear anybody.";
  return notReached.length > 0
    ? `${base} ${notReached.length} source${notReached.length === 1 ? " was" : "s were"} `
      + "not searched; work through the manual checks below."
    : base;
}

/**
 * Whether this run may be attached to a determination as evidence.
 *
 * A run that searched nothing is not evidence of anything, and recording it
 * as a source would put a line in the record that reads like a check.
 */
export function runIsEvidence(run: PepScreeningRun): boolean {
  return run.verdict === "indicators_found" || run.verdict === "no_indicators";
}

/**
 * The source row a completed run becomes.
 *
 * `result` is filled here, unlike a candidate confirmation, because the run's
 * result IS what the platform saw — it searched named registers and this is
 * what they returned. What it deliberately does not do is state a conclusion:
 * the operator still writes the rationale, and the outcome is theirs.
 */
export function runToMethodDraft(run: PepScreeningRun): {
  kind: string; source: string; reference: string; result: string;
} {
  const searched = run.sources.filter((s) => s.status === "searched");
  return {
    kind: "official_register",
    source: `Aurixa PEP screening — ${searched.map((s) => s.label).join("; ")}`,
    reference: run.searchedNames.join(" · "),
    result: run.verdict === "indicators_found"
      ? `${run.candidates.length} possible match`
        + `${run.candidates.length === 1 ? "" : "es"} returned; `
        + `${run.indicators.filter((i) => i.kind !== "coverage_gap").length} indicator(s) to consider`
      : "No entry returned for this name in the registers searched",
  };
}

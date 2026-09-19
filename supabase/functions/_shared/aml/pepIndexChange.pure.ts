/**
 * A refresh is a monitoring event, not just a data load.
 *
 * ── The obligation this exists for ────────────────────────────────────
 * Political exposure is not a fact established once at onboarding. A customer
 * who is determined not to be a PEP in March and is elected in September is a
 * PEP from September, and the obligation to know that is ongoing CDD.
 *
 * What the platform had was a REVIEW DATE. Every determination — including
 * `not_pep` — carries `review_due_at` twelve months out, and monitoring raises
 * an alert when it lapses. That is a periodic reconsideration by a person, and
 * it is necessary. It is also, on its own, a window of up to a year in which a
 * customer can take public office and nothing notices.
 *
 * Meanwhile the office-holder index reloads every week and nobody asks it the
 * obvious question: **does any name in here now match a party we have already
 * screened?** It is the same overlap query the screening runs, pointed the
 * other way, and it costs one index scan per case.
 *
 * ── What a change IS, and what it is not ──────────────────────────────
 * **A new candidate is a change in the SEARCH, not a change in the person.**
 *
 * There are at least three ways a name that returned nothing last month
 * returns something today, and only one of them is "they took office":
 *
 *   1. the person was appointed or elected, and the register now holds them;
 *   2. the register corrected a spelling, or added an alias, and the same
 *      person now matches a query that missed them before;
 *   3. the index expanded — a whole register was added that was not being
 *      searched at all when the last screening ran.
 *
 * All three are worth a person's attention. None of them is a finding, and
 * none of them is a determination. So this produces an ALERT that names what
 * changed and says which of those it could be — never a determination row,
 * never a supersession, and never a change to a standing conclusion. Only a
 * reviewer or MLRO moves that, which is the same line every other part of
 * this feature holds.
 *
 * ── Why (3) needs its own signal, and nearly did not get one ──────────
 * The obvious rule is "a row created since the last run means the person
 * entered the register". Checked against production it is wrong in the case
 * that matters most: **226 rows entered the index in the hour after the only
 * screening runs on file**, because the Parliament register was loaded for
 * the first time. Every one of those rows is new, and not one of them is a
 * person who took office.
 *
 * A bulk register addition is exactly when the most cases change at once, so
 * a reading that mislabels it is wrong at its own peak. The distinguishing
 * fact is whether the SOURCE was being searched at all when the last run
 * happened: if the register's first successful load postdates the run, the
 * coverage grew and the person's circumstances are unremarked.
 */

export interface PriorScreening {
  /** Candidate ids the last recorded run returned, however it found them. */
  candidateIds: string[];
  /** When that run was recorded. */
  runAt: string | null;
}

/**
 * When each register was FIRST loaded successfully, by source code.
 *
 * Not when it was last loaded — the weekly refresh moves that every week and
 * would make every register look new forever. What matters is whether the
 * register was part of the index at all when the prior run happened.
 */
export type SourceFirstLoaded = Record<string, string | null>;

export interface IndexMatch {
  /** `${source_code}:${external_id}` — the same id a screening run stores. */
  id: string;
  sourceCode: string;
  name: string;
  positionTitle: string | null;
  /** When this row entered the index. Null on a row that predates the column. */
  rowCreatedAt: string | null;
  /** 0–1 on the name alone, from the same matcher the screening uses. */
  score: number;
}

export type PepIndexChangeReading =
  | "no_prior_screening"
  | "no_change"
  | "new_candidates";

export interface NewCandidate extends IndexMatch {
  /**
   * `source_added_since` — the whole register was first loaded after the last
   *   screening ran. The COVERAGE grew; nothing is implied about the person.
   *   Checked first, because on a bulk register load every row also looks
   *   like `entered_since` and that reading is wrong for all of them.
   * `entered_since` — the register was already being searched, and this row
   *   entered it after the last run. Consistent with an appointment.
   * `already_present` — the row was already in the index and was not returned
   *   last time. The SEARCH changed: a corrected name or a new alias.
   * `unknown` — the row carries no creation time, so these cannot be told
   *   apart. Reported as unknown rather than guessed.
   */
  origin: "source_added_since" | "entered_since" | "already_present" | "unknown";
}

export interface PepIndexChange {
  reading: PepIndexChangeReading;
  newCandidates: NewCandidate[];
  /** One sentence for the alert. Never a conclusion about the person. */
  summary: string;
}

/**
 * Compare what the index returns NOW against what the last run returned.
 *
 * Pure: the caller does both queries. Nothing here reads a determination or
 * writes anything — a standing conclusion is a reviewer's, and this only ever
 * asks them to look again.
 */
export function detectIndexChange(input: {
  prior: PriorScreening | null;
  currentMatches: IndexMatch[];
  /** When each register was first loaded. Absent entries read as unknown. */
  sourceFirstLoaded?: SourceFirstLoaded;
}): PepIndexChange {
  const { prior, currentMatches, sourceFirstLoaded = {} } = input;

  /*
   * A case nobody has screened is UNSCREENED, which is a different state with
   * a different remedy. Sweeping it in here would report every unscreened
   * party as a change and bury the ones that are.
   */
  if (!prior || prior.runAt === null) {
    return {
      reading: "no_prior_screening", newCandidates: [],
      summary: "No screening run has been recorded for this party, so there is "
        + "nothing to compare against.",
    };
  }

  const seen = new Set(prior.candidateIds);
  const priorRunMs = Date.parse(prior.runAt);
  const fresh = currentMatches.filter((m) => !seen.has(m.id)).map((m): NewCandidate => {
    const createdMs = m.rowCreatedAt ? Date.parse(m.rowCreatedAt) : NaN;
    const firstLoadedRaw = sourceFirstLoaded[m.sourceCode] ?? null;
    const firstLoadedMs = firstLoadedRaw ? Date.parse(firstLoadedRaw) : NaN;

    let origin: NewCandidate["origin"];
    if (!Number.isFinite(priorRunMs)) {
      origin = "unknown";
    } else if (Number.isFinite(firstLoadedMs) && firstLoadedMs > priorRunMs) {
      // The register itself is newer than the run. Checked BEFORE the row's
      // own age, because on a bulk load every row is also newer.
      origin = "source_added_since";
    } else if (!Number.isFinite(createdMs)) {
      origin = "unknown";
    } else {
      origin = createdMs > priorRunMs ? "entered_since" : "already_present";
    }
    return { ...m, origin };
  });

  if (fresh.length === 0) {
    return {
      reading: "no_change", newCandidates: [],
      /*
       * Deliberately not "still clear" or "no match". This says the index
       * returns what it returned before, which is a fact about two searches
       * and about nothing else.
       */
      summary: "The office-holder index returns the same entries for this party "
        + "as it did at the last screening. That is a comparison of two "
        + "searches, not a result about the person.",
    };
  }

  const added = fresh.filter((c) => c.origin === "source_added_since").length;
  const entered = fresh.filter((c) => c.origin === "entered_since").length;
  const present = fresh.filter((c) => c.origin === "already_present").length;
  const unknown = fresh.filter((c) => c.origin === "unknown").length;
  const parts: string[] = [];
  if (added) {
    parts.push(`${added} ${added === 1 ? "comes" : "come"} from a register that `
      + "was not being searched at all when that screening ran, so the coverage "
      + "grew and nothing here is said about the person's circumstances");
  }
  if (entered) {
    parts.push(`${entered} entered a register that was already being searched, `
      + "which is consistent with a person having taken office");
  }
  if (present) {
    parts.push(`${present} ${present === 1 ? "was" : "were"} already in the index `
      + "and did not match before — a corrected name or a new alias");
  }
  if (unknown) {
    parts.push(`${unknown} ${unknown === 1 ? "carries" : "carry"} no record of `
      + "when it was added, so whether it is new cannot be told from here");
  }

  return {
    reading: "new_candidates", newCandidates: fresh,
    summary: `The office-holder index now returns ${fresh.length} entr`
      + `${fresh.length === 1 ? "y" : "ies"} for this party that it did not `
      + `return at the last screening — ${parts.join("; ")}. `
      + "Each is a candidate to confirm against the official register; none of "
      + "them is a determination, and any determination on this case stands "
      + "until a reviewer changes it.",
  };
}

/**
 * How loudly to raise it.
 *
 * A new match on a case where somebody has already concluded **not a PEP** is
 * a different thing from a new match on a case nobody has determined. The
 * first contradicts a recorded conclusion and the file says the question is
 * settled; the second is an ordinary lead on work still in progress.
 *
 * Neither reverses anything. Severity decides what a queue shows first.
 */
export function changeSeverity(input: {
  change: PepIndexChange;
  /** The standing determination's result, if there is one. */
  standingResult: "pep" | "not_pep" | null;
}): "urgent" | "high" | "normal" | null {
  if (input.change.reading !== "new_candidates") return null;
  if (input.standingResult === "not_pep") return "urgent";
  if (input.standingResult === "pep") {
    /*
     * Already recorded as a PEP. A further office is relevant to the risk
     * assessment and to enhanced due diligence, and it is not news about
     * whether they are one.
     */
    return "normal";
  }
  return "high";
}

/** The alert title, kept stable so a re-run does not raise a duplicate. */
export const PEP_INDEX_CHANGE_ALERT_TITLE =
  "Office-holder index now matches a screened party";

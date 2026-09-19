/**
 * Stage 5 as an operator reads it: one lifecycle, one action, and a separate
 * row per determination.
 *
 * ── The problem this exists to solve ──────────────────────────────────
 * Every fact Stage 5 needs was already correct and already server-decided.
 * What was missing was an arrangement of them: the screen showed a stage
 * card, a screening scope, parties in scope, a sanctions requirement, a party
 * screening panel, a screening-checks panel and a right rail, and an operator
 * had to read all seven and reconcile them to learn one thing — what to do
 * next. The worst of the collisions was a case that said "screening has not
 * been run", "screening not required" and "PEP outstanding" at the same time.
 * All three were true. Together they were unreadable.
 *
 * ── The distinction the whole screen turns on ─────────────────────────
 * Three different questions were being rendered in one vocabulary:
 *
 *   OBLIGATION  is this determination owed at all?
 *   METHOD      how would it be carried out?
 *   OUTCOME     what has actually been established?
 *
 * `not required` is an OBLIGATION. `no match` is an OUTCOME. `provider
 * unavailable` is a METHOD being unavailable and says nothing about either of
 * the others. Rendering them in one badge is how "not required" came to look
 * like "clear" and how an unavailable provider came to look like a case that
 * needed nothing.
 *
 * This module is pure: it reads what the server decided and arranges it. It
 * decides no obligation, performs no screening and reaches no determination.
 */
import type {
  AmlScreeningNextAction, AmlScreeningStageSync,
} from "./amlCasesApi";
import type { AmlCaseScreeningPosition } from "./screeningScope";

export type ObligationReading =
  | "required"
  | "not_required"
  | "unknown";

export type MethodReading =
  | "automated"
  | "automated_unavailable"
  | "manual_mlro"
  | "determination"
  | "none";

export type OutcomeReading =
  | "not_started"
  | "running"
  | "no_match"
  | "possible_match"
  | "confirmed_match"
  | "unable_to_complete"
  | "not_a_pep"
  | "pep"
  | "review_due"
  | "not_applicable";

export interface DeterminationRow {
  scope: string;
  title: string;
  obligation: ObligationReading;
  /** Why the obligation is what it is, in the server's own words. */
  obligationDetail: string;
  method: MethodReading;
  methodDetail: string;
  outcome: OutcomeReading;
  outcomeDetail: string;
  /** True when this row is what holds Stage 5 open. */
  blocking: boolean;
}

export const SCOPE_TITLE: Record<string, string> = {
  sanctions: "Targeted financial sanctions",
  pep: "Politically exposed person",
  adverse_media: "Adverse media",
  watchlist: "Internal watchlists",
};

export const OBLIGATION_LABEL: Record<ObligationReading, string> = {
  required: "Required",
  not_required: "Not required",
  // Never rendered as a reassurance: an unread obligation is not an absent one.
  unknown: "Not established",
};

export const METHOD_LABEL: Record<MethodReading, string> = {
  automated: "Automated screening",
  automated_unavailable: "Automated unavailable",
  manual_mlro: "Manual — MLRO",
  determination: "Recorded determination",
  none: "No screening required",
};

export const OUTCOME_LABEL: Record<OutcomeReading, string> = {
  not_started: "Not started",
  running: "Running",
  no_match: "No match",
  possible_match: "Possible match",
  confirmed_match: "Confirmed match",
  unable_to_complete: "Unable to complete",
  not_a_pep: "Not a PEP",
  pep: "PEP",
  review_due: "Review due",
  not_applicable: "Nobody screened",
};

/** Canonical party state → the outcome vocabulary. Unknown fails closed. */
function sanctionsOutcome(state: string | undefined): OutcomeReading {
  switch (state) {
    case "clear": return "no_match";
    case "possible_match": return "possible_match";
    case "confirmed_match": return "confirmed_match";
    case "error": return "unable_to_complete";
    case "processing": return "running";
    default: return "not_started";
  }
}

/**
 * The determination rows for this case, most blocking first.
 *
 * Everything here comes from the server's own per-scope decision and the
 * canonical party readings. Nothing is re-derived: a browser that reached a
 * different conclusion from the same facts would be a second compliance
 * engine, and the two would drift.
 */
export function buildDeterminationRows(args: {
  sync: AmlScreeningStageSync;
  position: AmlCaseScreeningPosition;
  /** Whether the provider could execute an automated check for this case. */
  providerReady: boolean;
  providerRelevant: boolean;
}): DeterminationRow[] {
  const { sync, position, providerReady, providerRelevant } = args;
  /*
   * Two different populations, and conflating them fabricated a
   * determination in production.
   *
   * `subject.required` is about the SCREENING obligation — sanctions. A case
   * whose perimeter stood sanctions down has every subject `required: false`,
   * so `required` is empty. PEP is owed per PARTY under its own scope
   * decision, so a PEP row computed over `required` asked `.some()` of an
   * empty array, got `false`, and reported "Not a PEP · Recorded for every
   * party in scope" on a case with zero `pep_determinations` rows.
   *
   * A vacuous truth is the worst possible failure mode here: it is a
   * determination nobody made, rendered as one that was.
   */
  const required = position.subjects.filter((s) => s.required);
  const enrolled = position.subjects;

  const rows: DeterminationRow[] = (sync.scopes ?? []).map((sc) => {
    const obligation: ObligationReading = sc.required ? "required" : "not_required";
    const title = SCOPE_TITLE[sc.scope] ?? sc.scope;

    if (sc.scope === "pep") {
      // PEP is established by a recorded determination, never by a screening
      // run and never by the client's own declaration.
      //
      // Over the ENROLLED parties, not the screening-required ones — and
      // "nobody is enrolled" is outstanding, never satisfied. An obligation
      // with no parties to discharge it against is an unread position, and
      // an unread position fails closed.
      const outstanding = enrolled.length === 0 || enrolled.some((s) => !s.pep.resolved);
      const noParties = enrolled.length === 0;
      return {
        scope: sc.scope, title, obligation,
        obligationDetail: sc.required
          ? "A determination is owed for every party in scope."
          : sc.reason,
        method: sc.required ? "determination" : "none",
        methodDetail: sc.required
          ? "Recorded by a reviewer or the MLRO, with the sources checked and a rationale. "
            + "A client declaration is evidence that supports it; it is never the "
            + "determination itself."
          : "No determination is owed.",
        outcome: !sc.required
          ? "not_applicable"
          : outstanding ? "not_started" : "not_a_pep",
        outcomeDetail: !sc.required
          ? "No obligation arose, so nobody was assessed."
          : noParties
            ? "Nobody is enrolled for this case yet, so no determination can have been "
              + "made. This is outstanding, not satisfied."
            : outstanding
              ? "Outstanding for at least one party in scope."
              : "Recorded for every party in scope.",
        blocking: sc.required && outstanding,
      };
    }

    // Sanctions, adverse media and watchlists are screened.
    const worst = required
      .map((s) => sanctionsOutcome(s.sanctions.state))
      .sort((a, b) => OUTCOME_RANK.indexOf(a) - OUTCOME_RANK.indexOf(b))[0]
      ?? "not_started";
    /*
     * `settled` needs a party to be settled ABOUT. A required scope with
     * nobody enrolled is outstanding: the `?? "not_started"` above already
     * says so, and this makes the emptiness explicit rather than resting on
     * a fallback that a future edit could quietly change.
     */
    const settled = required.length > 0 && worst === "no_match";
    const automatedBlocked = providerRelevant && !providerReady;

    return {
      scope: sc.scope, title, obligation,
      obligationDetail: sc.required
        ? "A screening is owed before this stage can complete."
        : sc.reason,
      /*
       * The METHOD is reported independently of the obligation and of the
       * outcome, which is the point. An unavailable provider is a fact about
       * one method: it never means the screening is unnecessary, and it never
       * means a second method is unavailable too.
       */
      method: !sc.required
        ? "none"
        : settled
          ? "automated"
          : automatedBlocked ? "automated_unavailable" : "automated",
      methodDetail: !sc.required
        ? "No screening is owed, so none was performed."
        : automatedBlocked && !settled
          ? "The automated method cannot run. The MLRO may complete the required "
            + "screening manually against current published sources."
          : "Run against the official lists; candidates return for adjudication.",
      outcome: sc.required ? worst : "not_applicable",
      outcomeDetail: !sc.required
        ? "No obligation arose, so nobody was screened. This is a policy decision, "
          + "not a screening result."
        : OUTCOME_DETAIL[worst],
      blocking: sc.required && !settled,
    };
  });

  // Required and blocking first; a settled or unowed row never outranks work.
  return rows.sort((a, b) => Number(b.blocking) - Number(a.blocking)
    || Number(b.obligation === "required") - Number(a.obligation === "required"));
}

/** Most blocking first — the state the case reports is the one needing someone. */
const OUTCOME_RANK: OutcomeReading[] = [
  "confirmed_match", "possible_match", "unable_to_complete",
  "not_started", "running", "no_match",
];

const OUTCOME_DETAIL: Record<OutcomeReading, string> = {
  confirmed_match: "A listed party has been confirmed. The case is escalated.",
  possible_match: "A candidate needs adjudicating before this stage can complete.",
  unable_to_complete: "A check could not complete. An error is never a clear result.",
  not_started: "No screening has been performed yet.",
  running: "A check is in progress.",
  no_match: "Screened against the required lists; no listing corresponds.",
  not_a_pep: "Determined.",
  pep: "Determined.",
  review_due: "The determination is past its review date.",
  not_applicable: "Nobody was screened.",
};

/**
 * The ONE reading at the top of the stage.
 *
 * Deliberately derived from the lifecycle first and the action second. A
 * closed case is a retained record whatever the stage's own arithmetic says,
 * and presenting it as live onboarding is the defect this replaces.
 */
export type StageHeadline =
  | "case_closed"
  | "escalated"
  | "manual_review"
  | "action_required"
  | "in_progress"
  | "complete"
  | "unknown";

export const STAGE_HEADLINE_LABEL: Record<StageHeadline, string> = {
  case_closed: "Case closed — journey paused",
  escalated: "Escalation required",
  manual_review: "Manual review required",
  action_required: "Action required",
  in_progress: "Screening in progress",
  complete: "Stage complete",
  unknown: "Position not established",
};

export function deriveStageHeadline(args: {
  caseClosed: boolean;
  action: AmlScreeningNextAction | null;
}): StageHeadline {
  const key = args.action?.key;
  // A finding is a fact about a customer and outranks the lifecycle.
  if (key === "escalate") return "escalated";
  if (key === "adjudicate_match") return "manual_review";
  if (args.caseClosed) return "case_closed";
  if (!args.action) return "unknown";
  if (key === "none") return "complete";
  if (key === "await_provider_result") return "in_progress";
  if (key === "await_submission") return "in_progress";
  return "action_required";
}


/* ═══════════════ The Australian sanctions source, at a glance ══════════ */

/**
 * What the operator needs to know about the data behind an automated
 * screening, without being shown three thousand rows of it.
 *
 * Stage 5 could say a screening was "unavailable" and never say WHY, or which
 * Australian source it would have used. An MLRO signing off a determination
 * has to be able to see that — and an administrator has to be able to see
 * that it is the thing to fix.
 *
 * Every field is derived from canonical live data. Nothing here is a default,
 * a placeholder or a hard-coded count: an unread source reports as unread.
 */
export type SanctionsSourceState =
  | "current"
  | "stale"
  | "not_loaded"
  | "sync_failed"
  | "unknown";

export interface SanctionsSourceReading {
  state: SanctionsSourceState;
  label: string;
  /** One sentence an operator can act on. */
  detail: string;
  /** Entries actually loaded, or null when the count could not be read. */
  entryCount: number | null;
  /** When the list was last loaded successfully, or null. */
  lastLoadedAt: string | null;
  /** Whether automated screening can run against this source right now. */
  automatedReady: boolean;
}

export const SANCTIONS_SOURCE_LABEL = "DFAT Consolidated List";

export function readSanctionsSource(args: {
  /** `sanctions_list_syncs` rows, newest first is not assumed. */
  syncs: Array<{
    list_code?: string | null; status?: string | null;
    entry_count?: number | null; completed_at?: string | null;
  }> | null | undefined;
  /** Total rows in `aml.sanctions_entries`, or null when unread. */
  entryCount: number | null | undefined;
  /** Whether the SERVER says an automated check could execute. */
  providerReady: boolean;
  /** Days after which a loaded list is treated as stale. */
  staleAfterDays: number;
  nowMs: number;
}): SanctionsSourceReading {
  const { syncs, entryCount, providerReady, staleAfterDays, nowMs } = args;

  // An unread source is never reported as ready, and never as absent either.
  if (syncs === null || syncs === undefined) {
    return {
      state: "unknown", label: "Not established",
      detail: "The sanctions source could not be read. That is not evidence it is "
        + "loaded, and not evidence it is missing.",
      entryCount: entryCount ?? null, lastLoadedAt: null, automatedReady: false,
    };
  }

  const succeeded = syncs
    .filter((x) => x.status === "succeeded" && Number(x.entry_count ?? 0) > 0)
    .sort((a, b) => Date.parse(b.completed_at ?? "") - Date.parse(a.completed_at ?? ""));
  const latest = succeeded[0] ?? null;

  if (!latest) {
    const failed = syncs.some((x) => x.status === "failed");
    return failed
      ? {
        state: "sync_failed", label: "Last load failed",
        detail: "The most recent attempt to load the sanctions list did not succeed, so "
          + "no automated screening can run against it.",
        entryCount: entryCount ?? null, lastLoadedAt: null, automatedReady: false,
      }
      : {
        state: "not_loaded", label: "Not loaded",
        detail: "The sanctions list has never been loaded. An automated check would be "
          + "screening against nothing, so it is refused rather than run.",
        entryCount: entryCount ?? 0, lastLoadedAt: null, automatedReady: false,
      };
  }

  const loadedAt = latest.completed_at ?? null;
  const ageMs = loadedAt ? nowMs - Date.parse(loadedAt) : Number.NaN;
  const stale = Number.isFinite(ageMs) && ageMs > staleAfterDays * 24 * 60 * 60 * 1000;

  if (stale) {
    return {
      state: "stale", label: "Out of date",
      detail: `The loaded list is older than ${staleAfterDays} days. Screening against it `
        + "would produce confident results against a world that has changed, so it is "
        + "refused until it is reloaded.",
      entryCount: entryCount ?? latest.entry_count ?? null,
      lastLoadedAt: loadedAt, automatedReady: false,
    };
  }

  return {
    state: "current", label: "Current",
    detail: providerReady
      ? "Loaded and inside the freshness window. Automated screening runs against this."
      : "Loaded and inside the freshness window, but the screening engine is not ready, "
        + "so an automated check cannot run yet.",
    entryCount: entryCount ?? latest.entry_count ?? null,
    lastLoadedAt: loadedAt,
    // The source being good is necessary and not sufficient — the server
    // decides whether a check can actually execute.
    automatedReady: providerReady,
  };
}

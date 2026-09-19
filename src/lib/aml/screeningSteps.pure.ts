/**
 * Stage 5 as a SEQUENCE: numbered steps, one of them current.
 *
 * ── What this replaces ────────────────────────────────────────────────
 * Stage 5 rendered every true thing it knew, all at once, in seven panels
 * that each had equal weight: a next-action card, a classification prompt,
 * a screening scope, a required-determinations list, a not-required
 * collapse, a perimeter statement, a people-to-assess list, a party
 * screening panel, a checks panel and an ownership panel. The single act
 * the case was actually waiting for — one PEP determination — appeared FOUR
 * times, in four different words, with four buttons, and the operator still
 * had to read the whole page to work out that everything else was already
 * settled.
 *
 * Nothing there was wrong. What was missing was ORDER. This module supplies
 * it: the same server-decided facts, arranged as the steps of one path, so
 * an operator reads down until they hit the step that is theirs.
 *
 * ── The rules that keep it honest ─────────────────────────────────────
 * 1  It DERIVES NOTHING NEW. Every obligation, method and outcome comes from
 *    `buildDeterminationRows`, which reads the server's own per-scope
 *    decision. A browser that reached its own conclusion would be a second
 *    compliance engine, and the two would drift on the day it mattered.
 *
 * 2  `not_required` IS NOT `complete`. A step nobody owes is settled — it
 *    stops holding the path open — but it is never ticked, never counted as
 *    work done, and never described as a result. This is the same rule the
 *    determination rows carry, and the reason Stage 5 exists in this shape.
 *
 * 3  THE SERVER OWNS "WHAT NEXT". When `next_action` maps onto a step, that
 *    step is the current one, whatever the local arithmetic would have said.
 *    The spine can be wrong about ordering; it must never disagree with the
 *    server about what is being asked for.
 *
 * 4  A CLOSED CASE HAS NO CURRENT STEP. It is a retained record, not a path
 *    in progress, and presenting a numbered next step on one asserts a
 *    journey that is not moving.
 */
import type {
  AmlScreeningNextAction, AmlScreeningStageSync,
} from "./amlCasesApi";
import type { AmlCaseScreeningPosition } from "./screeningScope";
import { buildDeterminationRows, type DeterminationRow } from "./screeningResolution.pure";
import type { PepDeclarationReading } from "./pepDeclaration";

export type ScreeningStepKey =
  | "perimeter"
  | "parties"
  | "sanctions"
  | "other_checks"
  | "pep"
  | "resolve";

/**
 * Where a step has got to.
 *
 * `not_required` and `done` are deliberately different values that both
 * settle a step. Rendering them with one word is how "no obligation arose"
 * came to read as "screened and clear".
 */
export type ScreeningStepState =
  | "done"
  | "not_required"
  | "current"
  /**
   * Settled once, and a question has since been raised about it.
   *
   * The reopened enquiry is the case this exists for: the recorded finding
   * stands — nothing is inferred from a reopen — but a reviewer has to say
   * whether it still holds before the rest of the path means anything. It is
   * OUTSTANDING (it is not counted as settled) and it is NOT blocking (the
   * server is asking for something else, and this must not outrank it).
   */
  | "review"
  /**
   * Owed, not yet done, and nothing is stopping it — it is simply not the
   * step the server is pointing at right now.
   *
   * This exists because there was no word for it. A PEP determination that
   * had not been made could only be `blocked`, so the screen told an
   * operator something was preventing them when it was their turn, and sent
   * them to look for an obstacle that did not exist.
   */
  | "outstanding"
  /**
   * Cannot be done until something else happens, and that something is
   * NAMED. `blockedBy` carries it, and a step with nothing to name is not
   * blocked — it is `outstanding` or, if the server is asking for it,
   * `current`.
   */
  | "blocked"
  | "waiting"
  | "upcoming"
  | "unknown";

export interface ScreeningStep {
  key: ScreeningStepKey;
  /** 1-based position among the steps that apply to this case. */
  number: number;
  title: string;
  /** Why this step exists at all — one line, stable, never status. */
  purpose: string;
  state: ScreeningStepState;
  /** What is true right now, in the server's terms. One or two sentences. */
  summary: string;
  /** Short factual lines: the evidence behind `summary`. */
  detail: string[];
  /**
   * The server's action, attached to the step it belongs to. Null on every
   * step the server is not currently asking for — a step never invents one.
   */
  action: AmlScreeningNextAction | null;
  /** True when this step is what holds the stage open. */
  blocking: boolean;
  /**
   * What must happen before this step can be done, when something must.
   *
   * Null on every step that is merely outstanding. The rule is one way
   * round: `state === "blocked"` requires a `blockedBy`, because a red badge
   * with no obstacle named is an instruction to go and look for one.
   */
  blockedBy: string | null;
  /** The determination row behind this step, where one exists. */
  row: DeterminationRow | null;
  /**
   * The customer's own declaration, on the step it bears on.
   *
   * Evidence towards the determination and never the determination itself —
   * which is why it is a field of its own rather than a sentence mixed into
   * the step's summary.
   */
  declaration?: PepDeclarationReading | null;
}

export interface ScreeningPath {
  steps: ScreeningStep[];
  /** The one step to act on, or null (case closed, or nothing outstanding). */
  currentKey: ScreeningStepKey | null;
  /** Steps that are settled — done OR not required. */
  settled: number;
  total: number;
  /** True when every step is settled and the server agrees there is no action. */
  complete: boolean;
  /**
   * A CONFIRMED match on this case.
   *
   * Deliberately not "the resolve step is blocked": a possible match is a
   * CANDIDATE — a name the engine returned for a person to look at — and
   * calling that a finding on the page is the same collapse of vocabulary
   * this stage was rebuilt to stop. Only a confirmed match is a finding.
   */
  finding: boolean;
}

/**
 * Which step an action belongs to.
 *
 * `reopen_case` and `none` map to nothing on purpose: neither is a step of
 * the path. One is the lifecycle, the other is its absence.
 */
export const ACTION_STEP: Record<string, ScreeningStepKey | null> = {
  classify_perimeter: "perimeter",
  enrol_subjects: "parties",
  await_submission: "parties",
  run_screening: "sanctions",
  fix_provider: "sanctions",
  complete_manually: "sanctions",
  screening_stalled: "sanctions",
  await_provider_result: "sanctions",
  record_pep: "pep",
  adjudicate_match: "resolve",
  escalate: "resolve",
  reopen_case: null,
  none: null,
};

export const STEP_STATE_LABEL: Record<ScreeningStepState, string> = {
  done: "Done",
  // Never "N/A" and never a tick: it is a statement about obligation.
  not_required: "Not required",
  current: "Do this now",
  review: "Confirm this still holds",
  outstanding: "Still to do",
  blocked: "Blocked",
  waiting: "Waiting",
  upcoming: "Later",
  unknown: "Not established",
};

const OUTSTANDING: ScreeningStepState[] = [
  "current", "review", "outstanding", "blocked", "waiting", "unknown",
];

/** True when a step still holds the path open. */
export function isOutstanding(state: ScreeningStepState): boolean {
  return OUTSTANDING.includes(state);
}

function perimeterStep(args: {
  sync: AmlScreeningStageSync;
  caseClosed: boolean;
}): Omit<ScreeningStep, "number" | "action"> {
  const { sync, caseClosed } = args;
  const p = sync.perimeter ?? null;
  const recordedBy = p?.recorded_by_label ?? null;
  const recordedAt = p?.recorded_at ?? null;
  /*
   * `classification` is ALWAYS populated — an unclassified case reads
   * `designated_service`, because the default is inside the perimeter and a
   * missing decision must never look like an exemption. So "has anybody
   * decided this" is `classified`, not the classification. `recorded_at` is
   * the fallback for a server that predates the flag; without one of the
   * two this step reports the case as unclassified, which is the safe way
   * round: it asks for a decision that has already been made rather than
   * assuming one that has not.
   */
  const classified = p?.classified === true || Boolean(recordedAt);
  const classification = classified ? p?.classification ?? null : null;

  const detail: string[] = [];
  if (classification) {
    detail.push(classification === "outside_perimeter"
      ? `Recorded as OUTSIDE the perimeter${p?.reason_code ? ` — ${p.reason_code.replace(/_/g, " ")}` : ""}.`
      : "Recorded as a real deal — a designated service is being provided.");
    if (recordedBy || recordedAt) {
      detail.push(`Recorded${recordedBy ? ` by ${recordedBy}` : ""}${
        recordedAt ? ` on ${new Date(recordedAt).toLocaleDateString('en-AU')}` : ""}.`);
    }
    if ((p?.scopes_excluded ?? []).length > 0) {
      detail.push(`Checks this removes: ${(p!.scopes_excluded as string[])
        .map((s) => s.replace(/_/g, " ")).join(", ")}.`);
    }
  } else {
    // The default is INSIDE. An unclassified case is not an exempt one.
    detail.push("Nothing recorded yet. A case nobody has classified counts as inside "
      + "the perimeter, so sanctions screening is required.");
  }


  /*
   * The one case where a recorded classification is not the end of it: an
   * enquiry that has been reopened and is being worked again. The finding is
   * NOT changed here and nothing is inferred from the reopen — a perimeter
   * finding stands until a reviewer records another. What changes is that
   * the question is asked in sequence rather than left at the foot of the
   * page for somebody to know to look for.
   */
  const staleEnquiry = !caseClosed
    && classification === "outside_perimeter"
    && p?.reason_code === "enquiry_only";

  return {
    key: "perimeter",
    title: "Confirm what kind of case this is",
    /*
     * Plain language, on purpose. This step used to open with "whether a
     * designated service is being provided decides what screening is owed",
     * which is the statute's sentence rather than the operator's: the
     * question they can actually answer is whether this is a real deal or
     * only an enquiry.
     */
    purpose: "A real deal has to be screened; an enquiry that never became one does "
      + "not. Only a reviewer or the MLRO records this, and it is never assumed.",
    state: !classification ? "current" : staleEnquiry ? "review" : "done",
    summary: !classification
      ? "Nobody has recorded whether we are providing a service here. Until someone "
        + "does, this case counts as inside the perimeter and sanctions screening is "
        + "required."
      : staleEnquiry
        ? "This was recorded as an enquiry only, which is why no sanctions screening "
          + "is required. It has since been reopened and is being worked again — "
          + "confirm whether it is now a real deal."
        : classification === "outside_perimeter"
          ? "Recorded as outside the sanctions perimeter: no service is being provided, "
            + "so no screening is owed. Nobody was screened and nobody was cleared."
          : "Recorded as a real deal, so the full screening obligation applies.",

    detail,
    /*
     * Outstanding, and deliberately NOT blocking.
     *
     * The recorded classification stands until a reviewer records another,
     * so this does not hold the stage: it asks a question beside the work
     * the server is actually asking for. Marking it blocking would take the
     * pointer off that work and put the operator back to reconciling two
     * competing demands, which is the whole defect this arrangement removes.
     */
    blocking: false,
    blockedBy: null,
    row: null,
  };
}

function partiesStep(args: {
  position: AmlCaseScreeningPosition;
  enrolled: number;
}): Omit<ScreeningStep, "number" | "action"> {
  const subjects = args.position.subjects;
  const names = subjects.slice(0, 6).map((s) => s.name);
  return {
    key: "parties",
    title: "Confirm who must be assessed",
    purpose: "Every reconciled party carries the obligation, not only the named "
      + "customer. Nothing below can be settled against a population of nobody.",
    // An unread list is not an empty one, and an empty one is never settled.
    state: !args.position.read ? "unknown" : subjects.length === 0 ? "blocked" : "done",
    summary: !args.position.read
      ? "The party list could not be read. That is not evidence that nobody is enrolled."
      : subjects.length === 0
        ? "Nobody is enrolled for this case yet, so no determination can have been made "
          + "against anybody."
        : `${subjects.length} part${subjects.length === 1 ? "y is" : "ies are"} in scope for `
          + "assessment.",
    detail: subjects.length === 0
      ? []
      : [
        names.join(", ") + (subjects.length > names.length
          ? ` and ${subjects.length - names.length} more` : ""),
        ...(args.enrolled > 0
          ? [`${args.enrolled} enrolled automatically from this case's own record.`]
          : []),
      ],
    blocking: args.position.read && subjects.length === 0,
    /*
     * A real blocker, and the only one on this step: nothing below can be
     * settled against a population of nobody, and enrolment comes from the
     * reconciled parties rather than from anything an operator does here.
     */
    blockedBy: args.position.read && subjects.length === 0
      ? "No parties have been reconciled from the submission yet, so there is "
        + "nobody to assess."
      : null,
    row: null,
  };
}

/** A screened scope (sanctions, adverse media, watchlists) as a step. */
function screenedStep(
  key: ScreeningStepKey,
  title: string,
  purpose: string,
  row: DeterminationRow,
): Omit<ScreeningStep, "number" | "action"> {
  const notRequired = row.obligation === "not_required";
  /*
   * The only thing that genuinely stops this step is the METHOD being
   * unavailable — a provider that cannot run. A screening that is simply not
   * yet run is the operator's turn, not an obstruction, and calling it
   * "Blocked" sent them to look for a fault that was not there.
   */
  const methodUnavailable = row.method === "automated_unavailable";
  return {
    key, title, purpose,
    state: notRequired
      ? "not_required"
      : row.blocking
        ? (row.outcome === "running"
          ? "waiting"
          : methodUnavailable ? "blocked" : "outstanding")
        : "done",
    summary: notRequired ? row.obligationDetail : row.outcomeDetail,
    detail: notRequired
      ? [row.outcomeDetail]
      : [`Method — ${row.methodDetail}`, `Obligation — ${row.obligationDetail}`],
    blocking: row.blocking,
    blockedBy: !notRequired && row.blocking && methodUnavailable
      ? `The automated method is unavailable — ${row.methodDetail}`
      : null,
    row,
  };
}

function pepStep(args: {
  row: DeterminationRow;
  position: AmlCaseScreeningPosition;
  declaration: PepDeclarationReading | null;
}): Omit<ScreeningStep, "number" | "action"> {
  const { row, position, declaration } = args;
  const notRequired = row.obligation === "not_required";
  const outstanding = position.subjects.filter((s) => !s.pep.resolved);
  return {
    key: "pep",
    title: "Record the PEP determination",
    purpose: "A politically-exposed-person determination is owed for every party in "
      + "scope. The client's own declaration is evidence towards it and is never the "
      + "determination itself.",
    /*
     * A determination that is owed and has not been made is OUTSTANDING, not
     * blocked. It used to be `blocked`: a red badge, a warning marker, and
     * the word an operator reads as "something is preventing you" — on the
     * one step in this stage where nothing was, and where the whole route
     * was two clicks away behind a working dialog.
     *
     * The single genuine blocker is having nobody to determine against, and
     * that belongs to the parties step above.
     */
    state: notRequired
      ? "not_required"
      : row.blocking
        ? (position.subjects.length === 0 ? "blocked" : "outstanding")
        : "done",
    summary: notRequired
      ? row.obligationDetail
      : row.blocking
        ? (position.subjects.length === 0
          ? "Nobody is enrolled yet, so no determination can have been made."
          : `${outstanding.length} part${outstanding.length === 1 ? "y needs" : "ies need"} `
            + "a determination, with the sources checked and a rationale.")
        : "Recorded for every party in scope.",
    detail: notRequired
      ? [row.outcomeDetail]
      : outstanding.length > 0
        ? [`Outstanding: ${outstanding.map((s) => s.name).join(", ")}`]
        : position.subjects.map((s) => `${s.name} — ${s.pep.detail}`),
    blocking: row.blocking,
    blockedBy: !notRequired && row.blocking && position.subjects.length === 0
      ? "Nobody is enrolled on this case yet, so there is no party to determine "
        + "against. Confirm who must be assessed first."
      : null,
    row,
    /*
     * What the customer said, carried to the person who has to decide.
     *
     * It is attached to the step and kept OUT of `summary` and `detail` on
     * purpose: the card renders it in its own block, labelled as the
     * customer's declaration, so it can never be read as the determination
     * or as a status this stage reached.
     */
    declaration,
  };
}

function resolveStep(args: {
  position: AmlCaseScreeningPosition;
  sanctionsRow: DeterminationRow | null;
}): Omit<ScreeningStep, "number" | "action"> & { finding: boolean } {
  const { position, sanctionsRow } = args;
  const confirmed = position.subjects.filter((s) => s.sanctions.state === "confirmed_match");
  const possible = position.subjects.filter((s) => s.sanctions.state === "possible_match");
  const screeningOwed = sanctionsRow?.obligation === "required";
  const screeningSettled = screeningOwed && !sanctionsRow?.blocking;

  const base = {
    key: "resolve" as const,
    title: "Resolve what screening found",
    purpose: "A candidate is not a match. Each one is inspected and confirmed or "
      + "dismissed by a person, and the party's state is a projection of those "
      + "resolutions.",
    row: null,
  };

  if (confirmed.length > 0) {
    return {
      ...base, state: "blocked", blocking: true, finding: true,
      blockedBy: "A confirmed match is a finding about a customer. It is resolved "
        + "by escalation, not by completing the stage around it.",
      summary: `${confirmed.length} confirmed match${confirmed.length === 1 ? "" : "es"}. `
        + "This is a finding about a customer and it outranks everything else on the case.",
      detail: confirmed.map((s) => `${s.name} — confirmed match`),
    };
  }
  if (possible.length > 0) {
    return {
      /*
       * A candidate awaiting adjudication is WORK, not an obstruction — a
       * person opens it, looks, and confirms or dismisses it. Naming that
       * "Blocked" is the same mislabel the PEP step carried.
       */
      ...base, state: "outstanding", blocking: true, finding: false, blockedBy: null,
      summary: `${possible.length} candidate${possible.length === 1 ? "" : "s"} awaiting `
        + "adjudication.",
      detail: possible.map((s) => `${s.name} — possible match`),
    };
  }
  if (!screeningOwed) {
    return {
      ...base, state: "not_required", blocking: false, finding: false, blockedBy: null,
      summary: "No screening was owed, so nothing was returned to adjudicate.",
      detail: [],
    };
  }
  if (!screeningSettled) {
    return {
      ...base, state: "upcoming", blocking: false, finding: false, blockedBy: null,
      summary: "Nothing to resolve yet — the screening above has not produced a result.",
      detail: [],
    };
  }
  return {
    ...base, state: "done", blocking: false, finding: false, blockedBy: null,
    summary: "No candidates were returned. There is nothing to adjudicate.",
    detail: [],
  };
}

/**
 * The path for this case: the steps that apply, in order, one of them current.
 */
export function deriveScreeningPath(args: {
  sync: AmlScreeningStageSync;
  position: AmlCaseScreeningPosition;
}): ScreeningPath {
  const { sync, position } = args;
  const caseClosed = sync.case_closed === true;
  const action = sync.next_action ?? null;

  const rows = buildDeterminationRows({
    sync, position,
    providerReady: sync.provider_ready === true,
    providerRelevant: sync.provider_relevant !== false,
  });
  const rowFor = (scope: string) => rows.find((r) => r.scope === scope) ?? null;

  const sanctionsRow = rowFor("sanctions");
  const pepRow = rowFor("pep");
  /*
   * Adverse media and internal watchlists share one step, and it appears
   * only when at least one of them is actually owed. A case that owes
   * neither should not be shown a step about them: the reasoning for a
   * reduced scope stays reviewable in the evidence panels, which is where a
   * question about an obligation nobody has belongs.
   */
  const riskRows = ["adverse_media", "watchlist"]
    .map(rowFor)
    .filter((r): r is DeterminationRow => r !== null && r.obligation === "required");

  const drafts: Array<Omit<ScreeningStep, "number" | "action">> = [
    perimeterStep({ sync, caseClosed }),
    partiesStep({ position, enrolled: sync.enrolled ?? 0 }),
  ];

  if (sanctionsRow) {
    drafts.push(screenedStep(
      "sanctions",
      "Screen for targeted financial sanctions",
      "Targeted financial sanctions bind every dealing. The obligation is not "
      + "risk-based and cannot be stood down — only the perimeter reaches it.",
      sanctionsRow,
    ));
  }
  if (riskRows.length > 0) {
    drafts.push(screenedStep(
      "other_checks",
      riskRows.length === 1 ? riskRows[0].title : "Adverse media and watchlists",
      "Risk-triggered checks. These are owed because this case's profile triggered "
      + "them, and they are screened the same way sanctions are.",
      // Most blocking first — `buildDeterminationRows` already sorted them.
      riskRows[0],
    ));
  }
  if (pepRow) {
    drafts.push(pepStep({
      row: pepRow, position,
      declaration: sync.pep_declaration ?? null,
    }));
  }
  const resolve = resolveStep({ position, sanctionsRow });
  drafts.push(resolve);

  /*
   * The current step.
   *
   * The SERVER decides it whenever its action maps onto one: the spine may
   * be wrong about ordering, but it must never ask for something different
   * from what the server is asking for. Only when the action maps to nothing
   * — `none`, or a closed case's `reopen_case` — does the local order pick
   * the first step that is still outstanding.
   */
  const fromAction = action ? ACTION_STEP[action.key] ?? null : null;
  const firstOutstanding = drafts.find((s) => isOutstanding(s.state))?.key ?? null;
  const currentKey = caseClosed
    ? null
    : fromAction ?? (action?.key === "none" ? null : firstOutstanding);

  const steps: ScreeningStep[] = drafts.map((s, i) => ({
    ...s,
    number: i + 1,
    action: action && ACTION_STEP[action.key] === s.key ? action : null,
    /*
     * The step the server is asking for is CURRENT, whatever its own
     * arithmetic called it.
     *
     * The guard used to be `!isOutstanding(s.state)`, which only ever
     * upgraded a `done` or `upcoming` step. A step whose own arithmetic said
     * `blocked` — which is outstanding — could never be promoted, so the one
     * step the operator was being asked to do kept a red badge, a warning
     * marker and the word "Blocked" while the server pointed at it. That is
     * the same contradiction the old comment described, one state further
     * along, and the guard was what produced it.
     *
     * The honest guard is whether anything is actually in the way.
     * `blockedBy` is that, in words, and a step with nothing to name cannot
     * be blocked.
     */
    state: s.key === currentKey && !s.blockedBy ? "current" : s.state,
  }));

  const settled = steps.filter((s) => !isOutstanding(s.state)).length;
  return {
    steps,
    currentKey,
    settled,
    total: steps.length,
    // The server's own word for it. A stage is not complete because the
    // browser counted its steps.
    complete: action?.key === "none" && !caseClosed,
    finding: resolve.finding,
  };
}

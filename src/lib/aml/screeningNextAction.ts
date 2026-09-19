/**
 * The last word on what Stage 5 asks an operator to do.
 *
 * ── The skew this exists to survive ───────────────────────────────────
 * The server decides the next action, and it learned to ask for a perimeter
 * classification before demanding a provider repair. But the server and the
 * browser deploy on different schedules: measured on 2026-08-18, `aml-cases`
 * in production was v73 (12:17 UTC) while that logic had merged at 13:37 and
 * 14:1x and not yet shipped. The deployed bundle contained no
 * `perimeterClassified`, no `classify_perimeter` and no `classified` field at
 * all, so it answered `fix_provider` for an undecided case exactly as it
 * always had — and the operator was sent to AML Configuration, where a
 * step-up dialog correctly stopped them, to do work nobody had established
 * was needed.
 *
 * A rolling deployment is normal. Sending someone to change AML
 * configuration for a case that may not need sanctions screening is not, so
 * the browser holds this line itself rather than trusting the age of the
 * response it happens to have.
 *
 * ── What it may and may not do ────────────────────────────────────────
 * It rewrites ONE thing: which action is offered. It cannot and does not
 * touch whether sanctions is required, the scope decision, persisted policy,
 * screening outcomes, provider readiness, or any audit record — none of
 * which are inputs here. An undecided perimeter still means sanctions is
 * required; this only changes what the operator is asked to do about it.
 *
 * ── Never infer an exemption from silence ─────────────────────────────
 * Missing, unknown or unreadable perimeter data resolves to NOT classified,
 * which asks for a decision. It never resolves to "not required".
 */
import type { AmlScreeningNextAction, AmlScreeningPerimeter } from "./amlCasesApi";

/**
 * A closed case has no next step in the journey — it has a decision about
 * whether to resume one.
 *
 * Held here as well as on the server for the same reason the perimeter rule
 * is: the two deploy separately, and a Stage 5 that tells somebody to "Run
 * screening" on a retained record is asserting the case is progressing when
 * it is not. The override changes only WHICH action is offered; it reads no
 * policy, writes nothing, and cannot make a screening unnecessary.
 *
 * A finding is deliberately exempt. A possible or confirmed match is a fact
 * about a customer and does not stop being one because the file was closed,
 * so adjudication and escalation still lead.
 */
const FINDINGS: ReadonlyArray<AmlScreeningNextAction["key"]> = [
  "adjudicate_match", "escalate",
];

export function resolveClosedCaseAction(
  action: AmlScreeningNextAction | null | undefined,
  caseClosed: boolean,
): AmlScreeningNextAction | null {
  if (!action) return null;
  if (!caseClosed) return action;
  if (FINDINGS.includes(action.key)) return action;
  if (action.key === "reopen_case") return action;
  return {
    key: "reopen_case",
    label: "Reopen case to resume AML/CTF",
    headline: "This case is closed",
    detail: "The AML/CTF record is retained for compliance purposes and its evidence "
      + "stays readable. The journey is not progressing. If the customer relationship is "
      + "now proceeding, reopen the case — reopening restores the ability to WORK the "
      + "case and never approves the service, revives a terminated gate or restores a "
      + "revoked passport.",
    owner: "reviewer",
  };
}

/**
 * Has a human actually decided this case's perimeter?
 *
 * `classified` is the canonical answer and is preferred whenever the server
 * sends it. The two fallbacks read a real recorded decision out of the older
 * response shape, and both require positive evidence:
 *
 *   outside_perimeter          only a recorded row can say this
 *   designated_service + when  an explicitly recorded INSIDE decision
 *
 * A bare `designated_service` with no timestamp is what an unclassified case
 * looks like — it is the DEFAULT, not a decision — so it reads as undecided.
 */
export function perimeterIsClassified(
  perimeter: AmlScreeningPerimeter | null | undefined,
): boolean {
  if (!perimeter) return false;
  if (typeof perimeter.classified === "boolean") return perimeter.classified;
  if (perimeter.classification === "outside_perimeter") return true;
  return perimeter.classification === "designated_service"
    && Boolean(perimeter.recorded_at);
}

/** The action Stage 5 should actually offer, given what is known. */
export function resolveScreeningNextAction(
  action: AmlScreeningNextAction | null | undefined,
  perimeter: AmlScreeningPerimeter | null | undefined,
  caseClosed = false,
): AmlScreeningNextAction | null {
  // Lifecycle first: nothing below this line is a step a closed case takes.
  const lifecycle = resolveClosedCaseAction(action, caseClosed);
  if (!lifecycle) return null;
  if (lifecycle.key === "reopen_case") return lifecycle;
  action = lifecycle;
  if (!action) return null;
  if (action.key !== "fix_provider") return action;
  if (perimeterIsClassified(perimeter)) return action;

  return {
    key: "classify_perimeter",
    label: "Classify sanctions screening requirement",
    headline: "Classify sanctions screening requirement",
    detail: "Confirm whether this case is inside or outside the sanctions screening "
      + "perimeter before changing screening configuration. Until that is recorded the "
      + "case is treated as inside, so sanctions screening is required — but a case "
      + "that is an enquiry, a duplicate, or a service declined before it commenced "
      + "may not need it at all.",
    owner: "reviewer",
  };
}

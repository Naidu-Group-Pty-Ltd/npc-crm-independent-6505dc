/**
 * What is still outstanding on a determination, all of it, at any moment.
 *
 * ── The defect this replaces ──────────────────────────────────────────
 * The dialog validated correctly and reported one error at a time:
 *
 *     {verdict.errors[0]?.message}
 *
 * Before an outcome is chosen the ONLY error is "Choose what was determined.",
 * so every other requirement is invisible. An operator picks an outcome and
 * discovers they need an independent source; supplies one and discovers they
 * need a rationale; writes one and discovers a source has no recorded result.
 * Each message is correct and the sequence is a corridor of closed doors.
 *
 * The information was all there. It had no arrangement — which is the same
 * finding Stage 5 itself had, one level down.
 *
 * ── The rule that makes an up-front checklist honest ──────────────────
 * **The evidence bar does not depend on which way the determination goes.**
 *
 * `assessPepEvidence` takes a `result` and never reads it: the sources, the
 * results and the rationale are required identically for "a PEP" and "not a
 * PEP". That is deliberate and it is what a reasonable-grounds test means —
 * the standard of evidence cannot be lower for the conclusion that closes the
 * file.
 *
 * It is also what lets this list be shown from the moment the dialog opens,
 * before an outcome exists. `pepEvidenceContract.spec` asserts the two
 * outcomes produce identical errors, so if anyone ever makes the bar depend
 * on the answer, the checklist stops being able to promise this and the test
 * says so rather than the screen quietly misleading somebody.
 *
 * ── One rule, rendered and enforced ───────────────────────────────────
 * Every requirement here is derived from the errors `assessPepEvidence` and
 * `assessPepDeferral` actually produce — never a second list of rules that
 * agrees with them today. What the operator is shown outstanding and what the
 * server refuses cannot become two standards.
 */

export interface PepStepRequirement {
  /** Stable id, so a rendered list can key and a test can name one. */
  id: string;
  /** Which numbered step of the dialog it belongs to. */
  step: 1 | 2 | 3;
  /** Imperative, short enough to scan. */
  label: string;
  met: boolean;
  /**
   * True when this cannot be judged yet — an outcome-specific requirement
   * before an outcome exists. Rendered as pending rather than as failing:
   * an unmet requirement is work to do, and an unknowable one is not yet a
   * question, and showing a red cross against the second is a lie about the
   * operator's progress.
   */
  pending?: boolean;
}

interface EvidenceError { field: string; message: string }

/**
 * Build the outstanding list.
 *
 * `errors` is passed in rather than recomputed, so this cannot drift from the
 * assessment the footer and the server both use.
 */
export function pepDeterminationRequirements(input: {
  outcome: "not_pep" | "pep" | "defer" | null;
  methodCount: number;
  errors: EvidenceError[];
}): PepStepRequirement[] {
  const { outcome, errors } = input;
  const has = (field: string) =>
    errors.some((e) => e.field === field || e.field.startsWith(`${field}.`));

  /*
   * A deferral is not a determination and does not share its requirements.
   * Listing "record a rationale" against somebody who is recording that they
   * could NOT reach a conclusion would be asking them for the thing they have
   * just said they do not have.
   */
  if (outcome === "defer") {
    return [
      {
        id: "defer_reason", step: 3, met: !has("reason"),
        label: "Say why a determination could not be reached",
      },
      {
        id: "defer_needed", step: 3, met: !has("needed"),
        label: "Record what is needed to reach one",
      },
    ];
  }

  const requirements: PepStepRequirement[] = [
    {
      id: "sources", step: 2,
      met: input.methodCount > 0 && !has("methods"),
      label: "Record at least one source, and one of them independent of the customer",
    },
    {
      id: "results", step: 2,
      // `methods.N.result` — a source with nothing recorded against it.
      met: !errors.some((e) => /^methods\.\d+\.result$/.test(e.field)),
      label: "Record what each source returned",
    },
    {
      id: "rationale", step: 3, met: !has("rationale"),
      label: "Record why you are satisfied on reasonable grounds",
    },
  ];

  /*
   * A sanctions register named as a PEP source is a MISTAKE rather than an
   * outstanding task, so it only appears once it has been made. Listing it up
   * front would read as an instruction to go and check one.
   */
  if (errors.some((e) => /^methods\.\d+$/.test(e.field))) {
    requirements.push({
      id: "wrong_source_kind", step: 2, met: false,
      label: "Replace the sanctions register — absence from one is not PEP evidence",
    });
  }

  const outcomeChosen = outcome === "not_pep" || outcome === "pep";
  requirements.unshift({
    id: "outcome", step: 3, met: outcomeChosen,
    label: "Choose what was determined",
  });

  if (outcome === "pep") {
    requirements.push(
      { id: "pep_type", step: 3, met: !has("pep_type"), label: "Choose the PEP category" },
      { id: "relationship", step: 3, met: !has("relationship"), label: "Say who holds the position" },
      { id: "currently_held", step: 3, met: !has("currently_held"), label: "Say whether the position is currently held" },
    );
  } else if (!outcomeChosen) {
    /*
     * Named but not judged. If this ends up being a PEP there are three more
     * questions, and an operator deciding how much time the task needs should
     * be able to see that before they commit to an answer — without being
     * shown a failing tick for a question nobody has asked yet.
     */
    requirements.push({
      id: "pep_details", step: 3, met: false, pending: true,
      label: "If a PEP: the category, who holds the position, and whether it is still held",
    });
  }

  return requirements;
}

/** The one-line summary, counting only what is actually outstanding. */
export function describeOutstanding(reqs: PepStepRequirement[]): string {
  const outstanding = reqs.filter((r) => !r.met && !r.pending);
  if (outstanding.length === 0) return "Everything needed has been recorded.";
  return `${outstanding.length} thing${outstanding.length === 1 ? "" : "s"} still `
    + "needed before this can be recorded.";
}

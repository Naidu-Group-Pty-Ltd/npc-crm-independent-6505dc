/**
 * Lodging a report with AUSTRAC — the order it is actually done in.
 *
 * ── What was missing, and what was not ────────────────────────────────
 * Almost none of this is new machinery. `aml-reporting` already refuses a
 * submission that is not MLRO-approved, already demands step-up MFA, already
 * requires lodgement evidence — and for an SMR, the AUSTRAC reference
 * specifically — and already requires an explicit no-tipping-off
 * attestation before it will write a submission. The server was rigorous.
 *
 * The surface in front of it was a dialog with five boxes: Kind, Reference
 * code, Title, Narrative, Period. Nothing said what happens next, nothing
 * said when the report is due, and — the defect that matters most — nothing
 * asked WHICH CUSTOMER it was about. `reports.case_id` has existed from the
 * first migration and the dialog never set it, so every report ever drafted
 * was filed against nobody. A report about a customer that is not on that
 * customer's file is not on file.
 *
 * ── The path ──────────────────────────────────────────────────────────
 * Five steps, one of them open, in the order they are answered. This is the
 * same shape Stage 5 and Stage 9 use, deliberately: an operator who has
 * learned one guided path in this product has learned all of them.
 *
 * ── The one rule that shapes everything ───────────────────────────────
 * **The platform never lodges.** AUSTRAC Online is the reporting entity's
 * own account, reached with its own credentials, by the person authorised to
 * use it. What this product does is assemble the report, hold the evidence
 * behind it, record who approved it, and keep the receipt — and it says so
 * on the step, so nobody waits for a submission that was always theirs to
 * make.
 */

export type AustracReportKind = "smr" | "ttr" | "ifti" | "compliance_report";

/**
 * The statutory clock for each report.
 *
 * These are the reporting entity's obligations under the AML/CTF Act 2006
 * (Cth), recorded here rather than assumed, in the same way the ongoing-CDD
 * interval is stated in `reviewSchedule.pure.ts`. The section is named so a
 * reader can check it rather than trust this file.
 *
 * They are counted in BUSINESS days, which is what the Act says and is not
 * the same as the calendar days a naive `+3` would give: a suspicion formed
 * on a Thursday is due the following Tuesday, not Sunday.
 */
export interface AustracObligation {
  kind: AustracReportKind;
  label: string;
  /** What this report is for, in one line an operator can act on. */
  purpose: string;
  /** Business days from the triggering event. Null when it is not a clock. */
  businessDays: number | null;
  /** The provision the timing comes from. */
  basis: string;
  /** What starts the clock. */
  clockStarts: string;
}

export const AUSTRAC_OBLIGATIONS: Readonly<Record<AustracReportKind, AustracObligation>> = Object.freeze({
  smr: {
    kind: "smr",
    label: "Suspicious Matter Report",
    purpose: "A suspicion has been formed about a customer, a transaction or an attempt at one.",
    businessDays: 3,
    basis: "AML/CTF Act 2006 (Cth) s.41",
    clockStarts: "the day the suspicion was formed",
  },
  ttr: {
    kind: "ttr",
    label: "Threshold Transaction Report",
    purpose: "Physical currency of A$10,000 or more moved as part of a designated service.",
    businessDays: 10,
    basis: "AML/CTF Act 2006 (Cth) s.43",
    clockStarts: "the day of the transaction",
  },
  ifti: {
    kind: "ifti",
    label: "International Funds Transfer Instruction",
    purpose: "An instruction to move money into or out of Australia was sent or received.",
    businessDays: 10,
    basis: "AML/CTF Act 2006 (Cth) s.45",
    clockStarts: "the day the instruction was sent or received",
  },
  compliance_report: {
    kind: "compliance_report",
    label: "AML/CTF Compliance Report",
    purpose: "The annual report on the reporting entity's own compliance, for the previous calendar year.",
    businessDays: null,
    basis: "AML/CTF Act 2006 (Cth) s.47",
    clockStarts: "the end of the reporting period",
  },
});

/**
 * A suspicion about terrorism financing is due in 24 HOURS, not three days.
 *
 * It is a separate constant rather than a second entry in the table because
 * it is the same report under a tighter clock — treating it as a different
 * kind would let an operator draft "the wrong one" and the two would then
 * need reconciling.
 */
export const TERRORISM_FINANCING_HOURS = 24;

/**
 * True where the report is about a customer rather than about the business.
 *
 * The annual compliance report under s.47 accounts for the reporting
 * entity's own programme; there is no customer to file it against. Without
 * this the "filed against a customer" check read BLOCKED on a report that
 * can never have one, and the first step of the path could never complete —
 * a permanent red on a correctly drafted report, which teaches an operator
 * to read past the checks.
 */
export function isCustomerReport(kind: AustracReportKind): boolean {
  return kind !== "compliance_report";
}

/** `n` business days after `from`, skipping Saturdays and Sundays. */
export function addBusinessDays(from: Date, n: number): Date {
  const d = new Date(from.getTime());
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) left -= 1;
  }
  return d;
}

export interface LodgementClock {
  /** When it is due. Null when this report carries no statutory clock. */
  dueAt: string | null;
  /** How the deadline reads: "3 business days", "24 hours". */
  window: string;
  /** True once the due time has passed and nothing has been lodged. */
  overdue: boolean;
  /** Whole days remaining; negative once overdue. Null with no clock. */
  daysRemaining: number | null;
  basis: string;
}

/**
 * When this report is due.
 *
 * A clock nobody can see is a clock nobody meets. It is derived rather than
 * stored so that correcting the date the obligation arose corrects the
 * deadline, instead of leaving two dates that disagree.
 */
export function lodgementClock(args: {
  kind: AustracReportKind;
  /** When the obligation arose — the suspicion, the transaction, the IFTI. */
  obligationAt: string | null;
  terrorismFinancing?: boolean;
  now?: Date;
}): LodgementClock {
  const o = AUSTRAC_OBLIGATIONS[args.kind];
  const now = args.now ?? new Date();

  if (!args.obligationAt || o.businessDays === null) {
    return {
      dueAt: null,
      window: o.businessDays === null
        ? "Annual — no per-report clock"
        : `${o.businessDays} business days from ${o.clockStarts}`,
      overdue: false,
      daysRemaining: null,
      basis: o.basis,
    };
  }

  const start = new Date(args.obligationAt);
  if (Number.isNaN(start.getTime())) {
    return { dueAt: null, window: "—", overdue: false, daysRemaining: null, basis: o.basis };
  }

  const tf = args.kind === "smr" && args.terrorismFinancing === true;
  const due = tf
    ? new Date(start.getTime() + TERRORISM_FINANCING_HOURS * 3600_000)
    : addBusinessDays(start, o.businessDays);

  const msLeft = due.getTime() - now.getTime();
  return {
    dueAt: due.toISOString(),
    window: tf
      ? `${TERRORISM_FINANCING_HOURS} hours — terrorism financing`
      : `${o.businessDays} business days from ${o.clockStarts}`,
    overdue: msLeft < 0,
    daysRemaining: Math.floor(msLeft / 86_400_000),
    basis: o.basis,
  };
}

/* ── The pre-lodgement checks ─────────────────────────────────────────
 *
 * "Live active checks that need addressing before submission." They are
 * DISCLOSED, not enforced: this module blocks nothing, because the server
 * already refuses what must be refused — an unapproved report, a submission
 * with no evidence, an SMR with no AUSTRAC reference, a missing tipping-off
 * attestation. A second opinion in the browser that could disagree with the
 * server would be a second gate, and two gates is how one of them becomes
 * wrong.
 *
 * What these do is tell an operator what the server will say before they
 * make the trip.                                                          */

export type CheckState = "ready" | "attention" | "blocked" | "done";

export interface ReadinessCheck {
  key: string;
  label: string;
  state: CheckState;
  /** What to do about it, when there is something to do. */
  detail: string;
}

export interface AustracReportFacts {
  kind: AustracReportKind;
  status: string;
  caseId: string | null;
  /** Whose case it is, once linked. */
  subjectLabel: string | null;
  title: string | null;
  narrative: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  mlroSignedAt: string | null;
  submittedAt: string | null;
  /** The AUSTRAC lodgement reference recorded on the submission. */
  externalReference: string | null;
  /** The receipt captured after AUSTRAC acknowledged it. */
  receiptReference: string | null;
  obligationAt: string | null;
  terrorismFinancing?: boolean;
}

/**
 * A narrative is written, or it is not. There is no length.
 *
 * ── Why the character floor went ──────────────────────────────────────
 * This carried a 200-character minimum, rendered as `298 / 200 characters`
 * beside the box. Two things were wrong with it. AUSTRAC sets no such
 * threshold — the floor was this product's invention, and a compliance
 * product telling an MLRO their account of a suspicion is too short by an
 * arbitrary number is asserting a standard nobody set. And the counter READ
 * as a cap: "298 / 200" is the shape of an overrun, on the one field where
 * running out of room would be a serious problem, so the number discouraged
 * exactly the thing it was meant to encourage.
 *
 * What replaces it is not nothing. The questions a narrative has to answer
 * are listed under the box, per obligation, from `KIND_GUIDANCE` — guidance
 * on substance rather than a measure of bulk.
 */
export function narrativeIsWritten(narrative: string | null | undefined): boolean {
  return (narrative ?? "").trim().length > 0;
}

export function austracReadiness(f: AustracReportFacts): ReadinessCheck[] {
  const checks: ReadinessCheck[] = [];

  const customerOwed = isCustomerReport(f.kind);
  checks.push({
    key: "customer",
    label: customerOwed ? "Filed against a customer" : "About the reporting entity",
    state: !customerOwed ? "done" : f.caseId ? "done" : "blocked",
    detail: !customerOwed
      ? "An annual compliance report accounts for the business's own programme, so no customer is linked."
      : f.caseId
        ? `On ${f.subjectLabel ?? "the customer"}'s compliance file.`
        : "Link the compliance case this report is about. A report filed against "
          + "nobody is not on anybody's file, and cannot be found from the customer's record.",
  });

  checks.push({
    key: "narrative",
    label: "Narrative written",
    state: narrativeIsWritten(f.narrative) ? "done" : "attention",
    detail: narrativeIsWritten(f.narrative)
      ? "The grounds are set out in the report."
      : "AUSTRAC reads the narrative, not the fields around it. Set out what happened, "
        + "what was unusual about it, and what you did.",
  });

  const clock = lodgementClock({
    kind: f.kind, obligationAt: f.obligationAt, terrorismFinancing: f.terrorismFinancing,
  });
  if (clock.dueAt) {
    checks.push({
      key: "clock",
      label: "Within the statutory window",
      state: f.submittedAt ? "done" : clock.overdue ? "blocked" : "ready",
      detail: f.submittedAt
        ? "Lodged."
        : clock.overdue
          ? `Past the ${clock.window} allowed by ${clock.basis}. Lodge it and record why it was late — `
            + "a late report is still a report, and the lateness is itself a matter of record."
          : `Due within ${clock.window} (${clock.basis}).`,
    });
  }

  checks.push({
    key: "mlro",
    label: "MLRO approval",
    state: f.mlroSignedAt ? "done" : f.status === "awaiting_mlro" ? "ready" : "attention",
    detail: f.mlroSignedAt
      ? "Approved and recorded."
      : "The MLRO's decision is what authorises lodgement. Nothing here submits on their behalf.",
  });

  checks.push({
    key: "lodgement",
    label: "Lodged at AUSTRAC Online",
    state: f.submittedAt ? "done" : f.mlroSignedAt ? "ready" : "attention",
    detail: f.submittedAt
      ? `Recorded${f.externalReference ? ` — reference ${f.externalReference}` : ""}.`
      : "Lodge it in your own AUSTRAC Online account, then record the reference it gives you. "
        + "This platform never submits on your behalf and holds no AUSTRAC credentials.",
  });

  checks.push({
    key: "receipt",
    label: "Receipt on file",
    state: f.receiptReference ? "done" : f.submittedAt ? "ready" : "attention",
    detail: f.receiptReference
      ? `Receipt ${f.receiptReference} held with the report.`
      : "AUSTRAC's acknowledgement is the evidence the obligation was discharged. Record it here "
        + "so it sits with the report rather than in somebody's inbox.",
  });

  return checks;
}

/**
 * What is still outstanding when somebody is about to approve.
 *
 * ── One rule, two surfaces ────────────────────────────────────────────
 * The approval can be made from the register's own row and from inside the
 * report. Both ask the same question before they proceed, so both ask it
 * from here: two copies of "what is still owed" is how one screen comes to
 * warn about something the other one does not.
 *
 * It EXCLUDES the checks the approval itself unlocks. Lodgement and the
 * receipt come after the decision, and the MLRO check IS the decision —
 * listing any of them would ask the approver to answer for steps their own
 * act enables.
 */
export function outstandingBeforeApproval(f: AustracReportFacts): ReadinessCheck[] {
  const after = new Set(["mlro", "lodgement", "receipt"]);
  return austracReadiness(f).filter(
    (c) => !after.has(c.key) && (c.state === "blocked" || c.state === "attention"),
  );
}

/**
 * What the approver is asked before an incomplete report is approved.
 *
 * Returns null when nothing is outstanding, so a clean report approves in
 * one click and only a real gap ever interrupts.
 */
export function approvalConfirmation(f: AustracReportFacts): string | null {
  const outstanding = outstandingBeforeApproval(f);
  if (outstanding.length === 0) return null;
  const list = outstanding.map((c) => `\u2022 ${c.label}`).join("\n");
  return `${outstanding.length} check${outstanding.length === 1 ? " is" : "s are"} still outstanding:`
    + `\n\n${list}\n\nApprove it anyway? The approval is recorded against you.`;
}

/* ── The path ─────────────────────────────────────────────────────────── */

export interface PathStep {
  key: string;
  n: number;
  label: string;
  detail: string;
  state: "done" | "open" | "todo" | "blocked";
}

/**
 * Five numbered steps with exactly one open.
 *
 * The open step is the first that is not done, so the page always answers
 * "what now" with one thing rather than a list to interpret.
 */
export function deriveAustracPath(f: AustracReportFacts): PathStep[] {
  const narrativeDone = narrativeIsWritten(f.narrative);
  const raw: Array<Omit<PathStep, "n" | "state"> & { done: boolean }> = [
    {
      key: "identify",
      label: "Identify the obligation and the customer",
      detail: `${AUSTRAC_OBLIGATIONS[f.kind].label} — ${AUSTRAC_OBLIGATIONS[f.kind].purpose}`,
      done: Boolean(f.caseId) || !isCustomerReport(f.kind),
    },
    {
      key: "assemble",
      label: "Set out what happened",
      detail: "The narrative AUSTRAC reads, and the period it covers.",
      done: narrativeDone && Boolean(f.title),
    },
    {
      /*
        ── One review, not a review and a routing ──────────────────────
        This was two steps: "Clear the pre-lodgement checks", which
        completed by moving the report to `awaiting_mlro`, and "MLRO
        approves it". The first was a hand-off, and on a reporting entity
        where the person who drafts the report IS the MLRO — which is most
        of them — it was a report sent from somebody to themselves before
        they could act on it.

        Worse, without that routing the two steps complete on exactly the
        same fact, and two steps counting one thing is how "0 of 3 complete"
        comes to sit above a list of four. So they are ONE step: the checks
        are what the approver reviews, and the approval is the act.

        The control is untouched. `mlro_signoff` is still MLRO-only, still
        server-enforced, still recorded against the person who made it —
        removing a ceremony must never remove a control. `awaiting_mlro`
        also still exists and a report already in it still signs off
        normally; nothing in the product routed to it before this path
        offered to, and nothing does now.
      */
      key: "approve",
      label: "Review the checks and approve it",
      /* No "above" or "below": this text is drawn on the hub, inside the
         report and in the draft page's orientation list, and the checks sit
         in a different place in each. A step that describes its own
         position on one screen is wrong on the next. */
      detail: "The MLRO clears the pre-lodgement checks and records the decision that authorises lodgement.",
      done: Boolean(f.mlroSignedAt),
    },
    {
      key: "lodge",
      label: "Lodge it at AUSTRAC Online",
      detail: "In your own account, with your own credentials — then record the reference here.",
      done: Boolean(f.submittedAt),
    },
    {
      key: "receipt",
      label: "Keep the receipt with the report",
      detail: "AUSTRAC's acknowledgement, held on the customer's file.",
      done: Boolean(f.receiptReference),
    },
  ];

  let openTaken = false;
  return raw.map((s, i) => {
    let state: PathStep["state"];
    if (s.done) state = "done";
    else if (!openTaken) { state = "open"; openTaken = true; }
    else state = "todo";
    return { key: s.key, n: i + 1, label: s.label, detail: s.detail, state };
  });
}

/** The one sentence the header leads with. */
export function austracHeadline(f: AustracReportFacts): string {
  if (f.receiptReference) return "Lodged and acknowledged. The obligation is discharged and on file.";
  if (f.submittedAt) return "Lodged at AUSTRAC. Record the receipt when it arrives.";
  if (f.mlroSignedAt) return "Approved. Lodge it in your AUSTRAC Online account, then record the reference.";
  if (!f.caseId && isCustomerReport(f.kind)) return "This report is not yet filed against a customer.";
  const open = deriveAustracPath(f).find((s) => s.state === "open");
  return open ? open.label : "Ready for the MLRO.";
}

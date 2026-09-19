/**
 * Why this report is being made — the part the draft dialog never said.
 *
 * ── The defect ────────────────────────────────────────────────────────
 * The draft dialog asked an operator to choose between five report kinds
 * and then type a narrative, and said nothing at all about which one the
 * situation in front of them actually obliges. That is the decision the
 * whole lodgement rests on: an SMR and a TTR are not degrees of the same
 * thing, they are different obligations with different triggers, different
 * clocks and — for one of them only — a criminal offence attached to
 * telling the customer about it. Picking the wrong one is the easiest
 * mistake on this screen to make and the hardest to see afterwards.
 *
 * So this module carries, for each kind, four things an operator needs
 * BEFORE they type: what the report is for, when AUSTRAC must be informed,
 * what it is NOT for (with the kind that would be right instead), and what
 * the narrative has to answer. It is reference material, held in one place,
 * rendered rather than restated — the same treatment `AUSTRAC_OBLIGATIONS`
 * gives the statutory clock.
 *
 * ── Two rules ─────────────────────────────────────────────────────────
 * **It advises and never decides.** Nothing here writes a field, blocks a
 * save or picks a kind. The operator forms the suspicion and the MLRO
 * approves the report; a guidance module that quietly chose for them would
 * be this product forming a view it has no basis to form.
 *
 * **The wire kind is not the obligation kind.** `reports.kind` accepts five
 * values — `compliance` and `annual` are both the s.47 annual report — and
 * `AUSTRAC_OBLIGATIONS` is keyed by the four obligations. Reading the table
 * with a raw column value returns `undefined` and throws on the next
 * property access, which is exactly what the dialog did. `toObligationKind`
 * is the one translation, and it returns null rather than guessing.
 */
import {
  AUSTRAC_OBLIGATIONS, isCustomerReport, lodgementClock, narrativeIsWritten,
  type AustracReportKind, type LodgementClock,
} from "@/lib/aml/austracReportPath.pure";

export { isCustomerReport };

/** What the `reports.kind` column accepts. */
export type AustracWireKind = "smr" | "ttr" | "ifti" | "compliance" | "annual";

/**
 * How each stored kind is named to an operator.
 *
 * One map, because there were two — the hub's table and the draft form each
 * carried their own copy, and a report is one thing whichever screen names
 * it. It is keyed by the WIRE kind rather than the obligation, because this
 * is what the column holds and what the picker writes.
 */
export const AUSTRAC_KIND_LABEL: Readonly<Record<AustracWireKind, string>> = Object.freeze({
  smr: "Suspicious Matter Report",
  ttr: "Threshold Transaction Report",
  ifti: "International Funds Transfer Instruction",
  compliance: "Compliance Report",
  annual: "Annual Compliance Report",
});

/**
 * The same five, short enough for a chip.
 *
 * The register drew `report.kind.toUpperCase()`, which is the column's own
 * value — so a compliance report wore a chip reading `COMPLIANCE_REPORT`,
 * underscore and all. On a phone, where the column is 40px wide, that chip
 * set one letter per line and made the row 150px tall.
 *
 * It sits beside the full label rather than in the register, because a
 * second place that decides what a report kind is called is how two screens
 * come to call it different things.
 */
export const AUSTRAC_KIND_SHORT: Readonly<Record<AustracWireKind, string>> = Object.freeze({
  smr: "SMR",
  ttr: "TTR",
  ifti: "IFTI",
  compliance: "Compliance",
  annual: "Annual",
});

/**
 * What a report's `status` is called on screen.
 *
 * `status.replace(/_/g, " ")` is not a translation: it produced "awaiting
 * mlro", which spells an office's name in lower case, and "in review" for a
 * value an operator has never seen written down. The vocabulary rule this
 * repository already holds is that database vocabulary never reaches the
 * operator — an unmapped value falls back to the de-underscored form rather
 * than to nothing, because a status nobody named is still a status.
 */
export const AUSTRAC_STATUS_LABEL: Readonly<Record<string, string>> = Object.freeze({
  draft: "Draft",
  in_review: "In review",
  awaiting_mlro: "Awaiting MLRO",
  approved: "Approved",
  submitted: "Lodged",
  acknowledged: "Acknowledged",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
});

/** The reading for a status, never the stored value. */
export function austracStatusLabel(status: string | null | undefined): string {
  const raw = (status ?? "").trim();
  if (!raw) return "\u2014";
  const known = AUSTRAC_STATUS_LABEL[raw];
  if (known) return known;
  const words = raw.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The chip reading for a kind, never the stored value.
 *
 * It covers every spelling the column accepts rather than the five the wire
 * type names — `compliance_report` is one of them, and it is the one that
 * produced the defect.
 */
export function austracKindChip(kind: string | null | undefined): string {
  switch (kind) {
    case "smr": return AUSTRAC_KIND_SHORT.smr;
    case "ttr": return AUSTRAC_KIND_SHORT.ttr;
    case "ifti": return AUSTRAC_KIND_SHORT.ifti;
    case "annual": return AUSTRAC_KIND_SHORT.annual;
    case "compliance":
    case "compliance_report": return AUSTRAC_KIND_SHORT.compliance;
    default: return (kind ?? "").replace(/_/g, " ").toUpperCase() || "\u2014";
  }
}

/**
 * The obligation a stored kind belongs to, or null.
 *
 * `compliance` and `annual` are one obligation under two spellings — the
 * column has carried both since the first migration — so they map to the
 * same entry rather than to two half-populated ones. Anything unrecognised
 * returns null: a report whose kind we cannot place gets no clock and no
 * guidance, which is honest, rather than an SMR's three-day deadline
 * asserted over a report that may not have one.
 */
export function toObligationKind(kind: string | null | undefined): AustracReportKind | null {
  switch (kind) {
    case "smr": return "smr";
    case "ttr": return "ttr";
    case "ifti": return "ifti";
    case "compliance":
    case "annual":
    case "compliance_report": return "compliance_report";
    default: return null;
  }
}

export interface KindGuidance {
  kind: AustracReportKind;
  /** Why a report is being made at all, in one sentence. */
  why: string;
  /** The statutory trigger, split into the tests an operator applies. */
  informWhen: string[];
  /** Recognisable situations in a property-services reporting entity. */
  examples: string[];
  /** What this report is not for, and where that belongs instead. */
  notThis: string | null;
  /** The questions a narrative has to answer to be worth lodging. */
  narrativeAsks: string[];
  /** Tipping off (s.123) applies — the customer must not be told. */
  tippingOff: boolean;
}

export const KIND_GUIDANCE: Readonly<Record<AustracReportKind, KindGuidance>> = Object.freeze({
  smr: {
    kind: "smr",
    why: "You have formed a suspicion on reasonable grounds. The report tells AUSTRAC what you saw "
      + "and why it troubled you; it is not an accusation and it is not a decision to refuse service.",
    informWhen: [
      "You suspect a customer is not who they claim to be, or is acting for somebody they have not named.",
      "The matter may be relevant to investigating an offence, or to the evasion of a taxation law.",
      "The matter may relate to proceeds of crime, terrorism financing, or a sanctions obligation.",
      "The service was only attempted — a customer who walked away still obliges the report.",
    ],
    examples: [
      "Funds for a purchase arrive from a third party with no explained connection to the buyer.",
      "The customer will not, or cannot, explain where the money came from.",
      "Identification is requested and the customer abandons the transaction.",
      "A property is bought and re-sold quickly at a price the market does not support.",
      "Payments are broken into amounts that sit just under a reporting threshold.",
    ],
    notThis: "A cash payment of A$10,000 or more with nothing else unusual about it is a Threshold "
      + "Transaction Report, not a suspicious matter. If it is both, lodge both.",
    narrativeAsks: [
      "Who is involved, and what designated service was being provided or sought?",
      "What actually happened, with dates and amounts?",
      "What made it unusual — what did you expect, and what did you see instead?",
      "What did you ask, and what were you told?",
      "What did you do about it, and what is the position now?",
    ],
    tippingOff: true,
  },
  ttr: {
    kind: "ttr",
    why: "Physical currency of A$10,000 or more (or the foreign-currency equivalent) moved as part of "
      + "a designated service. It is a report of fact — no suspicion is needed and none is implied.",
    informWhen: [
      "You receive physical currency of A$10,000 or more from a customer.",
      "You pay out physical currency of A$10,000 or more to a customer.",
      "The foreign-currency equivalent of A$10,000 or more changes hands as cash.",
    ],
    examples: [
      "A deposit, or part of one, handed over in cash.",
      "Fees or commission settled in cash at or above the threshold.",
    ],
    notThis: "An electronic transfer is not a threshold transaction, however large. If the cash was "
      + "split to stay under the threshold, that is a suspicious matter as well as — often instead of "
      + "— a threshold transaction.",
    narrativeAsks: [
      "Who paid or received the currency, and in what capacity?",
      "How much, in what denomination, and on what date?",
      "Which designated service was it part of?",
      "How was the identity of the person handing it over established?",
    ],
    tippingOff: false,
  },
  ifti: {
    kind: "ifti",
    why: "An instruction to move money into or out of Australia was sent or received, and the "
      + "reporting entity that sent or received the instruction reports it.",
    informWhen: [
      "You sent an instruction to transfer money out of Australia.",
      "You received an instruction to transfer money into Australia.",
    ],
    examples: [
      "An overseas transfer instruction accepted in the course of a designated service.",
    ],
    notThis: "If the customer's bank sent the instruction, the bank reports it — not you. Money simply "
      + "arriving from overseas through a bank is not your IFTI. If its origin is unexplained, that is "
      + "a suspicious matter.",
    narrativeAsks: [
      "Who instructed the transfer, and who was to receive it?",
      "Which countries and which institutions were on each side?",
      "What was the amount, the currency, and the date it was sent or received?",
      "What was the transfer for?",
    ],
    tippingOff: false,
  },
  compliance_report: {
    kind: "compliance_report",
    why: "The annual report on how the reporting entity itself met its AML/CTF obligations over the "
      + "reporting period. It is about the business, not about a customer.",
    informWhen: [
      "Once each reporting period, whether or not anything was reported during it.",
    ],
    examples: [
      "The programme, its independent review, the training completed, and the reports lodged over the period.",
    ],
    notThis: "Nothing about an individual customer belongs here. A customer matter is a suspicious "
      + "matter, a threshold transaction or an international transfer instruction.",
    narrativeAsks: [
      "Which reporting period does this cover?",
      "What changed in the AML/CTF programme over the period?",
      "What did the independent review and the risk assessment find?",
      "What remains outstanding, and by when?",
    ],
    tippingOff: false,
  },
});

/* ── The draft, section by section ───────────────────────────────────── */

export interface DraftFacts {
  kind: string | null;
  caseId: string | null;
  title: string | null;
  narrative: string | null;
  obligationAt: string | null;
  terrorismFinancing: boolean;
  periodStart: string | null;
  periodEnd: string | null;
}

export type DraftSectionState = "complete" | "outstanding" | "optional";

export interface DraftSection {
  key: "obligation" | "customer" | "account" | "period";
  n: number;
  title: string;
  /** Why the operator is being asked for this. */
  purpose: string;
  state: DraftSectionState;
  /** What is still missing, when something is. */
  outstanding: string | null;
}

/**
 * The four questions a draft answers, numbered.
 *
 * They are sections of one form and never a wizard. A draft is deliberately
 * saveable from the moment it has a kind and a title — an SMR is often
 * started the minute the suspicion forms and finished later — so gating the
 * fields behind each other would make the product harder to comply with
 * rather than easier. What the numbering does is tell an operator where
 * they are and what is still owed, which is the thing the dialog never said.
 */
export function draftSections(f: DraftFacts): DraftSection[] {
  const kind = toObligationKind(f.kind);
  const obligation = kind ? AUSTRAC_OBLIGATIONS[kind] : null;

  const clockOwed = Boolean(obligation && obligation.businessDays !== null);
  const obligationDone = Boolean(kind) && (!clockOwed || Boolean(f.obligationAt));

  const customerOwed = Boolean(kind && isCustomerReport(kind));
  const customerDone = !customerOwed || Boolean(f.caseId);

  const titleDone = Boolean((f.title ?? "").trim());
  const narrativeDone = narrativeIsWritten(f.narrative);

  const periodSet = Boolean(f.periodStart && f.periodEnd);
  const periodOwed = Boolean(kind && !isCustomerReport(kind));

  return [
    {
      key: "obligation",
      n: 1,
      title: "Which report, and what obliges it",
      purpose: obligation
        ? obligation.purpose
        : "Choose the report the situation obliges. Each one has its own trigger and its own clock.",
      state: obligationDone ? "complete" : "outstanding",
      outstanding: obligationDone
        ? null
        : !kind
          ? "Choose the kind of report."
          : `Record ${obligation?.clockStarts ?? "when the obligation arose"} — the deadline is counted from it.`,
    },
    {
      key: "customer",
      n: 2,
      title: customerOwed ? "Who it is about" : "Who it is about — the business itself",
      purpose: customerOwed
        ? "The report is held on that customer's compliance file and recorded on their case timeline. "
          + "A report filed against nobody cannot be found from the customer's record."
        : "An annual compliance report is about the reporting entity, so no customer is linked to it.",
      state: customerDone ? "complete" : "outstanding",
      outstanding: customerDone ? null : "Choose the compliance case this report is about.",
    },
    {
      key: "account",
      n: 3,
      title: "What happened",
      purpose: "AUSTRAC reads the narrative, not the fields around it. Set out the facts, what was "
        + "unusual about them, and what you did.",
      state: titleDone && narrativeDone ? "complete" : "outstanding",
      outstanding: !titleDone
        ? "Give the report a title."
        : narrativeDone
          ? null
          : "Set out what happened, in the narrative.",
    },
    {
      key: "period",
      n: 4,
      title: "The period it covers",
      purpose: periodOwed
        ? "The reporting period this annual report accounts for."
        : "Optional — the window the conduct sits in, where that is wider than a single date.",
      state: periodSet ? "complete" : periodOwed ? "outstanding" : "optional",
      outstanding: periodSet ? null : periodOwed ? "Set the reporting period." : null,
    },
  ];
}

/** The one line the dialog leads with: what is still owed, or that nothing is. */
export function draftSummary(sections: DraftSection[]): string {
  const owed = sections.filter((s) => s.state === "outstanding");
  if (owed.length === 0) return "Everything this report needs has been recorded.";
  if (owed.length === 1) return `One thing outstanding — ${owed[0].outstanding}`;
  return `${owed.length} things outstanding before this is ready for the MLRO.`;
}

/**
 * The deadline as the dialog shows it while the date is being typed.
 *
 * Returns null where the kind is unknown or carries no per-report clock, so
 * a caller renders nothing rather than an empty deadline.
 */
export function draftClock(f: DraftFacts): LodgementClock | null {
  const kind = toObligationKind(f.kind);
  if (!kind) return null;
  return lodgementClock({
    kind, obligationAt: f.obligationAt, terrorismFinancing: f.terrorismFinancing,
  });
}

/**
 * Headings for an empty narrative.
 *
 * Offered only into a narrative that is blank, and only as text the operator
 * then writes over — it inserts questions, never answers, so nothing it
 * produces can end up in a lodged report as an assertion nobody made.
 */
export function narrativeSkeleton(kind: AustracReportKind): string {
  return KIND_GUIDANCE[kind].narrativeAsks.map((q) => `${q}\n\n`).join("");
}

/**
 * `draftSections` over a stored report row.
 *
 * The row's own field names rather than `DraftFacts`, so a caller holding an
 * `aml.reports` shape does not have to restate the mapping — which is how
 * the form and the page would come to disagree about the same draft.
 */
export function draftSectionsForReport(row: {
  kind?: string | null;
  case_id?: string | null;
  title?: string | null;
  narrative?: string | null;
  reporting_period_start?: string | null;
  reporting_period_end?: string | null;
  metadata?: unknown;
}): DraftSection[] {
  const meta = (row.metadata as Record<string, unknown> | undefined) ?? {};
  return draftSections({
    kind: row.kind ?? null,
    caseId: row.case_id ?? null,
    title: row.title ?? null,
    narrative: row.narrative ?? null,
    obligationAt: meta.obligation_at ? String(meta.obligation_at) : null,
    terrorismFinancing: meta.terrorism_financing === true,
    periodStart: row.reporting_period_start ?? null,
    periodEnd: row.reporting_period_end ?? null,
  });
}

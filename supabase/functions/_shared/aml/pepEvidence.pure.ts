/**
 * What a PEP determination has to REST ON.
 *
 * ── The standard this encodes ─────────────────────────────────────────
 * The statutory test is that the reporting entity establishes the position
 * **on reasonable grounds**. AUSTRAC treats that as an objective standard:
 * somebody in the same position, reviewing the same material with similar
 * experience, should be capable of reaching the same conclusion. There is no
 * prescribed form, no mandated database and no mandated sequence — but the
 * record must show HOW the conclusion was reached, which means the sources
 * checked, what was searched, and what came back.
 *
 * Everything here is Aurixa policy expressed as a contract. It is stricter
 * than the statutory floor in two deliberate places, and both are marked.
 *
 * ── The rule that prompted this module ────────────────────────────────
 * The dialog's own example of a source was:
 *
 *     "DFAT consolidated list — screened via case screening"
 *
 * The DFAT Consolidated List is a TARGETED FINANCIAL SANCTIONS register. It
 * is the authoritative Australian source for sanctions and it is not a PEP
 * register of any kind. Absence from it is not evidence about political
 * exposure, so a "not a PEP" determination resting on it rests on nothing —
 * and the product was teaching operators to write exactly that.
 *
 * The asymmetry is worth stating, because the instinct to use it is not
 * silly: a sanctions HIT is genuine evidence *towards* exposure (designation
 * lists are full of ministers, officials and state-enterprise directors),
 * while a sanctions MISS says nothing at all. A source that can only ever
 * support the negative conclusion is a source that can only ever mislead. So
 * a sanctions list is refused as a PEP source, and a live sanctions match is
 * surfaced separately as a risk signal that the determination must consider.
 */

/** How a source was consulted. The vocabulary AUSTRAC's own examples use. */
export const PEP_SOURCE_KINDS = [
  "client_declaration",
  "government_directory",
  "parliamentary_register",
  "official_register",
  "open_source",
  "media",
  "pep_database",
  "other",
] as const;

export type PepSourceKind = (typeof PEP_SOURCE_KINDS)[number];

export const PEP_SOURCE_KIND_LABEL: Record<PepSourceKind, string> = {
  client_declaration: "The customer's own declaration",
  government_directory: "Government directory (e.g. directory.gov.au)",
  parliamentary_register: "Parliamentary register (federal, state or territory)",
  official_register: "Other official or regulatory register",
  open_source: "Open-source / internet research",
  media: "Media search",
  pep_database: "Specialist PEP database",
  other: "Other reliable and independent source",
};

/**
 * A source that is the customer telling us about themselves.
 *
 * Kept as its own kind precisely so it can be counted separately: a
 * declaration is evidence towards a determination and can never be the whole
 * of one.
 */
export const PEP_DECLARATION_KIND: PepSourceKind = "client_declaration";

/**
 * Sanctions registers, by the names they are actually written under.
 *
 * Matched case-insensitively against BOTH the free-text source and the
 * reference, because the defect this catches was a free-text example. It is
 * deliberately a small, explicit list rather than a clever pattern: a broad
 * regex would reject "checked the register of members' interests for a
 * sanctions-related directorship", which is a perfectly good PEP source.
 */
export const SANCTIONS_SOURCE_TERMS = [
  "dfat consolidated",
  "consolidated list",
  "sanctions list",
  "sanctions register",
  "ofac",
  "sdn list",
  "un consolidated",
  "unsc consolidated",
  "targeted financial sanctions",
] as const;

/** Whether this text names a sanctions register rather than a PEP source. */
export function namesSanctionsRegister(text: string | null | undefined): boolean {
  const s = String(text ?? "").toLowerCase();
  return SANCTIONS_SOURCE_TERMS.some((t) => s.includes(t));
}

export interface PepMethodInput {
  kind?: string | null;
  /** The source in the operator's own words. */
  source?: string | null;
  /** What was actually searched — terms, a URL, a record identifier. */
  reference?: string | null;
  /** What came back. An unrecorded result is not a check. */
  result?: string | null;
  note?: string | null;
}

export interface PepMethod {
  kind: PepSourceKind;
  source: string;
  reference: string | null;
  result: string | null;
  note: string | null;
}

const clean = (v: unknown, max = 500): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s.slice(0, max) : null;
};

/**
 * Normalise one recorded method.
 *
 * Returns null for a row with no source at all, so a half-filled row cannot
 * become evidence. Unknown kinds fall back to `other` rather than being
 * dropped — losing the operator's typing is worse than a coarse label.
 */
export function normalisePepMethod(input: PepMethodInput): PepMethod | null {
  const source = clean(input?.source, 300);
  if (!source) return null;
  const kindRaw = String(input?.kind ?? "").trim();
  const kind = (PEP_SOURCE_KINDS as readonly string[]).includes(kindRaw)
    ? kindRaw as PepSourceKind
    : "other";
  return {
    kind, source,
    reference: clean(input?.reference),
    result: clean(input?.result),
    note: clean(input?.note),
  };
}

export function normalisePepMethods(rows: unknown): PepMethod[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r) => normalisePepMethod((r ?? {}) as PepMethodInput))
    .filter((m): m is PepMethod => m !== null)
    .slice(0, 20);
}

/** An independent source is anything that is not the customer's own answer. */
export function independentMethods(methods: PepMethod[]): PepMethod[] {
  return methods.filter((m) => m.kind !== PEP_DECLARATION_KIND);
}

export interface PepEvidenceVerdict {
  ok: boolean;
  /** Field-addressable failures, so the dialog can point at the row. */
  errors: Array<{ field: string; message: string }>;
}

/**
 * Whether this evidence can carry this conclusion.
 *
 * Two Aurixa controls sit above the statutory floor, and both are here rather
 * than in a policy document nobody reads at 4pm:
 *
 *   1  A determination needs at least one INDEPENDENT source. The customer's
 *      own answer alone is not reasonable grounds — it is the thing being
 *      tested. AUSTRAC's own worked examples verify a declaration against an
 *      internet or register search.
 *
 *   2  A source that was searched must say what came back. "Checked the
 *      Government Directory" is not a record of a check; "Checked the
 *      Government Directory for <name> — no entry" is.
 *
 * Neither applies to a DEFERRAL, which is the honest answer when the evidence
 * does not yet reach the standard.
 */
export function assessPepEvidence(input: {
  result: "not_pep" | "pep";
  methods: PepMethod[];
  rationale: string | null | undefined;
}): PepEvidenceVerdict {
  const errors: PepEvidenceVerdict["errors"] = [];
  const { methods } = input;

  if (methods.length === 0) {
    errors.push({
      field: "methods",
      message: "Record at least one source that was checked. A determination with no "
        + "sources is not established on reasonable grounds.",
    });
  }

  methods.forEach((m, i) => {
    if (namesSanctionsRegister(m.source) || namesSanctionsRegister(m.reference)) {
      errors.push({
        field: `methods.${i}`,
        message: `"${m.source}" is a sanctions register, not a source of political-`
          + "exposure information. Absence from a sanctions list is not evidence that "
          + "somebody is not a PEP. Record the register or search that was actually "
          + "consulted for public office.",
      });
    }
    if (m.kind !== PEP_DECLARATION_KIND && !m.result) {
      errors.push({
        field: `methods.${i}.result`,
        message: `Record what came back from "${m.source}". A source with no result is `
          + "not a check that can be relied on later.",
      });
    }
  });

  if (independentMethods(methods).length === 0) {
    errors.push({
      field: "methods",
      message: "At least one source independent of the customer is required. The "
        + "customer's own declaration is evidence towards the determination; it is "
        + "never the whole of it.",
    });
  }

  const rationale = clean(input.rationale, 4000);
  if (!rationale || rationale.length < 10) {
    errors.push({
      field: "rationale",
      message: "Record why you are satisfied on reasonable grounds — the objective test "
        + "is whether somebody in your position, reviewing the same material, could "
        + "reach the same conclusion.",
    });
  }

  return { ok: errors.length === 0, errors };
}

/* ═══════════════ When the evidence does not get there ═══════════════ */

/**
 * Why a determination could not be reached yet.
 *
 * This is NOT a third determination outcome, and the distinction is the whole
 * point. `pep_determinations` records determinations; a row in it means
 * somebody established a position on reasonable grounds. An operator who has
 * reached the end of the available checking and is not satisfied has
 * established nothing — and forcing them to pick "not a PEP" to close a
 * dialog is how an unfounded conclusion gets written down.
 *
 * So a deferral writes no determination. It records what is missing, keeps
 * the PEP step outstanding, and leaves the stage blocked.
 */
export const PEP_DEFERRAL_REASONS = [
  "awaiting_client_information",
  "identity_ambiguous",
  "sources_inconclusive",
  "source_unavailable",
  "escalated_for_review",
] as const;

export type PepDeferralReason = (typeof PEP_DEFERRAL_REASONS)[number];

export const PEP_DEFERRAL_REASON_LABEL: Record<PepDeferralReason, string> = {
  awaiting_client_information: "Waiting on information from the customer",
  identity_ambiguous: "Possible match found, but identity could not be confirmed",
  sources_inconclusive: "Sources checked, and they do not settle the question",
  source_unavailable: "A source that is needed could not be reached",
  escalated_for_review: "Escalated — a more senior decision is needed",
};

export interface PepDeferralVerdict {
  ok: boolean;
  errors: Array<{ field: string; message: string }>;
}

/**
 * A deferral has to name what is missing.
 *
 * A record saying only "could not determine" tells the next person nothing
 * and reads, six months later, exactly like nobody having tried.
 */
export function assessPepDeferral(input: {
  reason: string | null | undefined;
  needed: string | null | undefined;
  methods: PepMethod[];
}): PepDeferralVerdict {
  const errors: PepDeferralVerdict["errors"] = [];
  const reason = String(input.reason ?? "").trim();
  if (!(PEP_DEFERRAL_REASONS as readonly string[]).includes(reason)) {
    errors.push({ field: "reason", message: "Choose why the determination cannot be made yet." });
  }
  const needed = clean(input.needed, 2000);
  if (!needed || needed.length < 10) {
    errors.push({
      field: "needed",
      message: "Say what is needed before this can be determined, so the next person "
        + "knows what to obtain.",
    });
  }
  for (const [i, m] of input.methods.entries()) {
    if (namesSanctionsRegister(m.source) || namesSanctionsRegister(m.reference)) {
      errors.push({
        field: `methods.${i}`,
        message: `"${m.source}" is a sanctions register, not a source of political-`
          + "exposure information.",
      });
    }
  }
  return { ok: errors.length === 0, errors };
}

/* ═══════════════ A sanctions match is a signal, not a source ═══════════ */

export type SanctionsSignal = "none" | "candidate" | "confirmed";

/**
 * What a sanctions result means for a PEP determination.
 *
 * One direction only. A designation is frequently held by a person in public
 * office, so a match is a reason to look harder at exposure. A clear result
 * — or no screening at all — carries no information either way, and must
 * never read as support for "not a PEP".
 */
export function sanctionsSignalForPep(signal: SanctionsSignal): string | null {
  if (signal === "confirmed") {
    return "This party has a CONFIRMED sanctions match. Designated persons frequently "
      + "hold or have held prominent public functions — consider the listed role when "
      + "determining political exposure. The match itself is not the determination.";
  }
  if (signal === "candidate") {
    return "This party has an unadjudicated sanctions candidate. If it is confirmed, the "
      + "listed role may bear on political exposure.";
  }
  // Deliberately silent. "Screened, no match" is not evidence about PEP status,
  // and saying anything here would invite it to be read as though it were.
  return null;
}

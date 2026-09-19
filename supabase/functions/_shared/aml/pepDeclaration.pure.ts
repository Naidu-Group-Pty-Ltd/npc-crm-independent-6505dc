/**
 * What the CUSTOMER said about political exposure, and nothing more.
 *
 * ── Why this exists ───────────────────────────────────────────────────
 * The client portal asked one question — "Are you a Politically Exposed
 * Person (PEP)?" — with two radio buttons and no explanation, and stored a
 * bare `yes`/`no`.
 *
 * That is close to useless in both directions. A customer who has never met
 * the term answers "no" to a phrase they do not know, and the answer looks
 * like evidence while carrying almost none: AUSTRAC's definition covers
 * foreign, domestic and international-organisation office holders AND their
 * IMMEDIATE FAMILY MEMBERS and CLOSE ASSOCIATES, which is exactly the part
 * a plain "are you a PEP?" never reaches. And a customer who answers "yes"
 * tells the MLRO nothing they can act on — no office, no country, no
 * relationship — so the determination cannot start without going back to
 * the customer to ask what should have been asked once.
 *
 * So the question is asked properly and its answer travels intact to the
 * people who need it.
 *
 * ── The rule this module cannot break ─────────────────────────────────
 * A DECLARATION IS EVIDENCE. IT IS NEVER A DETERMINATION.
 *
 * Nothing here decides an obligation, records a determination, or changes a
 * screening scope. `personal_details.pep` keeps its `yes`/`no` values
 * precisely so the policy that reads it is untouched; everything added is
 * detail ALONGSIDE that answer. The command centre renders this as what the
 * customer said, beside the determination a reviewer or the MLRO still has
 * to make.
 *
 * ── Why the vocabulary matches the determination's ────────────────────
 * `PEP_RELATIONSHIPS` is the same triple `record_pep_determination`
 * accepts. That is deliberate and is not prefilling: it means the MLRO can
 * read the customer's answer and their own conclusion in one vocabulary and
 * see instantly whether they agree, instead of translating "my father is a
 * minister" into `family_member` by hand and hoping.
 */

/** The relationships a declaration can carry. Same triple as the determination. */
export const PEP_DECLARATION_RELATIONSHIPS = [
  "self", "family_member", "close_associate",
] as const;

export type PepDeclarationRelationship =
  (typeof PEP_DECLARATION_RELATIONSHIPS)[number];

export const PEP_RELATIONSHIP_LABEL:
Record<PepDeclarationRelationship, string> = {
  self: "The customer holds, or has held, the position",
  family_member: "An immediate family member holds, or has held, it",
  close_associate: "A close business or personal associate holds, or has held, it",
};

/**
 * The fields only a "yes" can answer.
 *
 * Pruned when the answer is anything else, for the same reason the entity
 * questions are: a field nobody can see is still a field that saves, and an
 * answer that survives a correction is an answer nobody gave.
 */
export const PEP_DETAIL_FIELDS = [
  "pep_relationship", "pep_role", "pep_country",
] as const;

/** Whether the detail questions apply to this answer. */
export function collectsPepDetail(answer: unknown): boolean {
  return answer === "yes";
}

/**
 * Drop the detail a non-"yes" answer cannot have.
 *
 * Returns the SAME object when nothing needed removing, so a caller can use
 * identity to tell whether anything changed.
 */
export function prunePepDeclaration<T extends Record<string, unknown>>(payload: T): T {
  if (collectsPepDetail(payload?.pep)) return payload;
  const present = PEP_DETAIL_FIELDS.filter((f) => f in (payload ?? {}));
  if (present.length === 0) return payload;
  const out = { ...payload } as Record<string, unknown>;
  for (const f of present) delete out[f];
  return out as T;
}

export interface PepDeclarationReading {
  /** Whether the customer answered the question at all. */
  answered: boolean;
  /** The customer's own answer, verbatim. Never re-interpreted. */
  answer: "yes" | "no" | null;
  relationship: PepDeclarationRelationship | null;
  /** The office or public function, in the customer's words. */
  role: string | null;
  /** The jurisdiction, in the customer's words. */
  country: string | null;
  /**
   * A "yes" that names the position, the country and the relationship.
   * A "yes" without them is INCOMPLETE, not a smaller yes.
   */
  complete: boolean;
  /** One line for the command centre. Never a conclusion. */
  summary: string;
}

const str = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s.slice(0, 300) : null;
};

/**
 * Read the declaration out of a `personal_details` payload.
 *
 * An unanswered question reads as unanswered — never as "no". The whole
 * point of the reading is that the command centre can tell the difference
 * between a customer who said they are not politically exposed and a
 * customer who was never asked.
 */
export function readPepDeclaration(
  personalDetails: Record<string, unknown> | null | undefined,
): PepDeclarationReading {
  const raw = personalDetails?.pep;
  const answer = raw === "yes" ? "yes" : raw === "no" ? "no" : null;
  const relationshipRaw = str(personalDetails?.pep_relationship);
  const relationship = PEP_DECLARATION_RELATIONSHIPS
    .includes(relationshipRaw as PepDeclarationRelationship)
    ? relationshipRaw as PepDeclarationRelationship
    : null;
  const role = str(personalDetails?.pep_role);
  const country = str(personalDetails?.pep_country);

  if (answer === null) {
    return {
      answered: false, answer: null, relationship: null, role: null, country: null,
      complete: false,
      summary: "The customer has not answered the political-exposure question. "
        + "That is not a declaration that they are not politically exposed.",
    };
  }
  if (answer === "no") {
    return {
      answered: true, answer: "no", relationship: null, role: null, country: null,
      complete: true,
      summary: "The customer declared that neither they, nor an immediate family "
        + "member, nor a close associate holds or has held a prominent public "
        + "position.",
    };
  }

  const complete = Boolean(relationship && role && country);
  const parts = [
    relationship ? PEP_RELATIONSHIP_LABEL[relationship] : null,
    role ? `Position: ${role}` : null,
    country ? `Jurisdiction: ${country}` : null,
  ].filter(Boolean) as string[];

  return {
    answered: true, answer: "yes", relationship, role, country, complete,
    summary: complete
      ? `The customer declared political exposure. ${parts.join(". ")}.`
      : "The customer declared political exposure but did not give the position, "
        + "the jurisdiction and the relationship in full"
        + (parts.length > 0 ? `. What was given: ${parts.join(". ")}.` : "."),
  };
}

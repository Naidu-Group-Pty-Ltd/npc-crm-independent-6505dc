/**
 * The client's completeness declaration — and the one thing it must never do.
 *
 * ── Why this is not "are you sanctioned?" ─────────────────────────────
 * Asking a customer whether they appear on Australia's Consolidated List is
 * a bad question twice over. It is unanswerable by an ordinary property
 * client, and it implies their answer decides whether we screen. It does
 * not. Targeted financial sanctions screening is an obligation we carry
 * independently of anything the customer says.
 *
 * So the client is asked the question they CAN answer, and the only one we
 * actually need from them: **is the information we screen on complete?**
 * Names, previous names, aliases, and the people and organisations connected
 * to the transaction. That materially improves matching — an undisclosed
 * former name is a real screening gap — without ever pretending the customer
 * has performed a check.
 *
 * ── The invariant ─────────────────────────────────────────────────────
 * NOTHING in this module widens or narrows a screening obligation.
 *
 *   "Everything is complete"  →  screening runs exactly as it would have
 *   "I need to add something" →  screening runs exactly as it would have
 *   "I'm not sure"            →  screening runs exactly as it would have
 *
 * The answer changes what we ASK NEXT and what we record. It never changes
 * what we must DETERMINE. `decideScreeningPolicy` does not read it, and a
 * test sweeps every value to prove sanctions and PEP survive all of them.
 *
 * The same rule the repository already carries for the PEP declaration:
 * a declaration is evidence that may support a determination. It is never
 * the determination, and never an exemption from making one.
 */

export const COMPLETENESS_ANSWERS = ["complete", "additions", "unsure"] as const;
export type CompletenessAnswer = (typeof COMPLETENESS_ANSWERS)[number];

/**
 * Bump when the wording the client agrees to changes.
 *
 * Stored on the response so the record can establish WHICH acknowledgement a
 * given customer gave, rather than assuming today's wording applied to a
 * submission made months ago.
 */
export const SANCTIONS_ACKNOWLEDGEMENT_VERSION = "2026.08";

export interface SanctionsDeclaration {
  completeness: CompletenessAnswer;
  /** Previous names, alternative spellings, other names used. */
  aliases: string[];
  acknowledged: boolean;
  acknowledgementVersion: string;
}

const clean = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null;

/**
 * Read the stored section into facts.
 *
 * Returns `null` when the section has not been answered — which is NOT the
 * same as "complete", and must never be read as one. A legacy submission
 * predating this section has no declaration at all, and that is exactly what
 * `null` says.
 */
export function readSanctionsDeclaration(
  payload: Record<string, unknown> | null | undefined,
): SanctionsDeclaration | null {
  if (!payload) return null;
  const completeness = payload.completeness;
  if (typeof completeness !== "string"
    || !(COMPLETENESS_ANSWERS as readonly string[]).includes(completeness)) {
    return null;
  }
  const aliases = Array.isArray(payload.aliases)
    ? [...new Set((payload.aliases as unknown[]).map(clean).filter((x): x is string => Boolean(x)))]
      .slice(0, 25)
    : [];
  return {
    completeness: completeness as CompletenessAnswer,
    aliases,
    acknowledged: payload.acknowledged === true,
    acknowledgementVersion: clean(payload.acknowledgement_version)
      ?? SANCTIONS_ACKNOWLEDGEMENT_VERSION,
  };
}

/**
 * Whether the client's answer means we should ask them to name more people.
 *
 * "Additions" and "unsure" both do — an unsure customer is exactly the one
 * whose disclosure is most likely incomplete, and routing them onward is
 * more useful than accepting a shrug. They are asked through the EXISTING
 * `related_parties` section, so a person named here reaches party
 * reconciliation by the same path as any other declared party. There is no
 * separate "sanctions people" model, and a client-side list of who needs
 * screening is never the authority.
 */
export function declarationRequiresPartyDisclosure(
  declaration: SanctionsDeclaration | null,
): boolean {
  if (!declaration) return false;
  return declaration.completeness === "additions" || declaration.completeness === "unsure";
}

/**
 * What the OPERATOR should understand from the declaration.
 *
 * Deliberately never phrased as a screening outcome. "The client says the
 * information is complete" is a statement about disclosure, not about
 * sanctions, and an analyst must not be able to read it as clearance.
 */
export function describeDeclaration(declaration: SanctionsDeclaration | null): {
  label: string;
  detail: string;
  attention: "none" | "info" | "attention";
} {
  if (!declaration) {
    return {
      label: "No completeness declaration",
      detail: "The client has not confirmed whether the screening information is "
        + "complete. This does not change what must be screened.",
      attention: "info",
    };
  }
  switch (declaration.completeness) {
    case "complete":
      return {
        label: "Client declared the information complete",
        detail: "The client confirmed all names, previous names, aliases and connected "
          + "people or organisations have been disclosed. This is a disclosure "
          + "statement, not a screening result.",
        attention: "none",
      };
    case "additions":
      return {
        label: "Client had more to disclose",
        detail: "The client indicated further names or connected parties, which are "
          + "collected through the declared-parties section and reconciled like any "
          + "other party.",
        attention: "info",
      };
    default:
      return {
        label: "Client was unsure whether the information is complete",
        detail: "An unsure declaration is the one most likely to be incomplete. Confirm "
          + "the party list before relying on the screening scope.",
        attention: "attention",
      };
  }
}

/**
 * Client-facing status wording.
 *
 * The customer must never see "possible DFAT sanctions match", "confirmed
 * match", "manual adjudication", "MLRO escalation", "provider failure" or
 * "sanctions list stale". Those are internal compliance states, and showing
 * them to a customer is alarming, unhelpful, and in the match cases a
 * tipping-off risk. Every internal state collapses to one of two neutral
 * sentences.
 */
export function clientFacingScreeningStatus(internalState: string): string {
  switch (internalState) {
    case "completed":
    case "false_positive":
      return "Your compliance checks are complete. No action is needed from you.";
    case "not_required":
      return "No further compliance checks are required from you at this stage.";
    default:
      // Everything else — queued, processing, possible_match, confirmed_match,
      // error, an empty list, a dead provider — is one neutral sentence. The
      // customer's next action is identical in every one of those cases:
      // nothing.
      return "We're completing your compliance checks. No action is currently "
        + "required from you, and we'll be in touch if we need anything further.";
  }
}

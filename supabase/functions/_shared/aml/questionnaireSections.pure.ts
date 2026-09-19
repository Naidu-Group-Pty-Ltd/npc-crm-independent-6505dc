/**
 * Which questionnaire sections apply to a case.
 *
 * ── Why this lives here and not in `aml-client-portal` ────────────────
 * It used to live in the portal function. It moved because the portal
 * function is under a source guard — `amlPortalContracts.test.ts` asserts
 * that `aml-client-portal/index.ts` contains no risk, screening, PEP or
 * sanctions vocabulary anywhere in its code, so that compliance data cannot
 * leak into a client-facing payload one column at a time.
 *
 * Adding the Australian Sanctions & Compliance Screening section put that
 * vocabulary in the portal file and tripped the guard. The guard is right.
 * The answer is not to weaken it or to rename things around it — it is that
 * the questionnaire CONTRACT belongs beside the rest of the shared AML
 * contract, and the portal should only call it.
 *
 * Nothing here reads or returns compliance state. It decides which forms a
 * client is shown, from what they have already answered.
 */

/** The section that collects the completeness declaration. */
export const SANCTIONS_SECTION = "sanctions_screening";

const ENTITY_STRUCTURES = new Set(["Company", "Trust", "SMSF", "Partnership"]);
const MULTI_PARTY_STRUCTURES = new Set([
  "Joint", "Company", "Trust", "SMSF", "Partnership",
]);

export type SectionLookup = (section: string) => Record<string, unknown> | null;

/**
 * The ordered applicable sections for a case.
 *
 * Sections already answered but no longer applicable (the client switches
 * structure from Company to Individual) are retained in storage — never
 * deleted — but drop out of the active checklist.
 */
export function applicableQuestionnaireSections(lookup: SectionLookup): string[] {
  const structure = lookup("purchasing_structure");
  const funding = lookup("funding");
  const entityType = String(structure?.entity_type ?? "");
  const fundingSources = Array.isArray(funding?.sources)
    ? (funding!.sources as unknown[]).map((s) => String(s))
    : [];
  const giftFunded = fundingSources.includes("Gift");

  /*
   * A client who says they have more to disclose — or is unsure — is asked to
   * name the people through the EXISTING declared-parties section, so anyone
   * they add reaches party reconciliation by the same path as any other
   * declared party. There is no separate "sanctions people" model, and the
   * browser is never the authority on who must be screened.
   *
   * "Unsure" pulls the step in deliberately: an unsure customer is exactly
   * the one whose disclosure is most likely incomplete, and asking is more
   * useful than accepting a shrug.
   */
  const completeness = String(lookup(SANCTIONS_SECTION)?.completeness ?? "");
  const needsParties = completeness === "additions" || completeness === "unsure";

  const out: string[] = ["purchasing_structure", "personal_details"];
  if (ENTITY_STRUCTURES.has(entityType)) out.push("entity_details");
  if (MULTI_PARTY_STRUCTURES.has(entityType) || giftFunded || needsParties) {
    out.push("related_parties");
  }
  out.push("purchase_profile", "funding");
  // Asked of every customer, last — once the information it asks them to
  // confirm has actually been collected.
  out.push(SANCTIONS_SECTION);
  return out;
}

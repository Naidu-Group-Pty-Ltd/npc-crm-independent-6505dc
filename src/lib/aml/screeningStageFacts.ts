/**
 * Canonical API rows → Stage 5 facts. Adapters only.
 *
 * Every function here is a projection of something the server already
 * returns. Nothing invents a value, nothing defaults a missing reading to a
 * reassuring one, and nothing decides anything — the decisions live in
 * `screeningReadiness.ts` and `screeningScope.ts`, and the authority for all
 * of it is the server.
 *
 * The rule that shapes the whole file: **an unread source is `null`, never an
 * empty or negative one.** `lists: null` is "the sanctions ledger was not
 * read"; `lists: []` is "it was read and holds nothing". Those produce
 * different sentences on the screen, and collapsing them is how a case with
 * no screening data comes to look clear.
 */
import type { AmlPartyScreeningSubject, AmlSubmissionReview } from "./amlCasesApi";
import type { AmlSanctionsSync, ProviderReadiness } from "./amlVerificationApi";
import type {
  AmlSanctionsListFacts, AmlScreeningProviderFacts,
} from "./screeningReadiness";
import type { AmlScreeningAnswers, AmlScreeningSubjectFacts } from "./screeningScope";

/**
 * The `pep_sanctions` provider row, as `provider_readiness` reports it.
 *
 * `provider_configs.active` is not in that projection, so it is read from the
 * two states that mean the row cannot be used — `not_configured` (no usable
 * row) and `unavailable` (the capability is off). Every other state is a
 * configured, usable row whose remaining problems the readiness module names
 * itself. This is a reading of documented states, not a guess at a column.
 */
export function screeningProviderFactsFrom(
  readiness: ProviderReadiness | null | undefined,
): AmlScreeningProviderFacts | null {
  const s = readiness?.screening;
  if (!s || !s.configured_provider) return null;
  return {
    providerKey: s.configured_provider,
    mode: s.mode,
    active: s.state !== "not_configured" && s.state !== "unavailable",
  };
}

/**
 * Sanctions-list evidence per list code, from `aml.sanctions_list_syncs`.
 *
 * A "successful" sync that published zero entries is not a load — screening
 * against it returns clear for everybody — so `lastSuccessAt` is taken from
 * the most recent success that actually published rows, while
 * `latestAttemptStatus` is taken from the most recent attempt of any outcome.
 * The two are deliberately different reads: a failure behind a good load is a
 * blocker in its own right, because designations published since that failure
 * are missing.
 */
export function sanctionsListFactsFrom(
  syncs: AmlSanctionsSync[] | null | undefined,
): AmlSanctionsListFacts[] | null {
  if (!syncs) return null;
  const byCode = new Map<string, AmlSanctionsSync[]>();
  for (const s of syncs) {
    const list = byCode.get(s.list_code) ?? [];
    list.push(s);
    byCode.set(s.list_code, list);
  }
  const newestFirst = (a: AmlSanctionsSync, b: AmlSanctionsSync) =>
    (a.completed_at ?? a.started_at) < (b.completed_at ?? b.started_at) ? 1 : -1;

  return [...byCode.entries()].map(([listCode, rows]) => {
    const ordered = [...rows].sort(newestFirst);
    const loaded = ordered.find((r) => r.status === "succeeded" && r.entry_count > 0);
    return {
      listCode,
      lastSuccessAt: loaded ? loaded.completed_at ?? loaded.started_at : null,
      entryCount: loaded?.entry_count ?? 0,
      latestAttemptStatus: ordered[0]?.status ?? null,
    };
  });
}

/** Canonical `aml.party_screening_subjects` rows → subject facts. */
export function screeningSubjectFactsFrom(
  subjects: AmlPartyScreeningSubject[] | null | undefined,
): AmlScreeningSubjectFacts[] | null {
  if (!subjects) return null;
  return subjects.map((s) => ({
    id: s.id,
    name: s.screened_name,
    partyType: s.party_type,
    // The server decides who must be screened. `required` is read, never
    // recomputed here — that is the whole point of §7.
    required: s.required && s.state !== "not_required",
    state: s.state,
    pepDetermination: s.pep_determination
      ? {
        result: s.pep_determination.result,
        determinedAt: s.pep_determination.determined_at,
        reviewDueAt: s.pep_determination.review_due_at,
        supersededAt: s.pep_determination.superseded_at,
        method: null,
      }
      : null,
  }));
}

const yesNo = (v: unknown): "yes" | "no" | null =>
  v === true || v === "yes" ? "yes" : v === false || v === "no" ? "no" : null;

const section = (review: AmlSubmissionReview, name: string): Record<string, unknown> | null => {
  const found = review.submission?.sections?.find((s) => s.section === name);
  const payload = found?.payload;
  return payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
};

/**
 * The client's declarations, from the submitted questionnaire.
 *
 * `null` when there is no submission to read — which the scope model treats
 * as "the risk evidence has not been read", never as a clean profile.
 */
export function screeningAnswersFrom(
  review: AmlSubmissionReview | null | undefined,
): AmlScreeningAnswers | null {
  if (!review?.submission) return null;
  const personal = section(review, "personal_details");
  const purchase = section(review, "purchase_profile");
  const funding = section(review, "funding");
  if (!personal && !purchase && !funding) return null;
  return {
    pep: yesNo(personal?.pep),
    adverse: yesNo(personal?.adverse),
    thirdParty: yesNo(purchase?.third_party),
    overseasFunding: yesNo(funding?.overseas),
  };
}

/** The customer's legal structure, from the submitted questionnaire. */
export function screeningEntityTypeFrom(
  review: AmlSubmissionReview | null | undefined,
): string | null {
  if (!review?.submission) return null;
  const structure = section(review, "purchasing_structure");
  const value = structure?.entity_type;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

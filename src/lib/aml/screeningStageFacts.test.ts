/**
 * The adapters, tested on the shapes production actually returns.
 *
 * The invariant running through every case here: an unread source reads as
 * unread. A `null` that becomes `[]`, or a missing answer that becomes "no",
 * is how a case with no screening evidence comes to look clear — and a
 * fabricated "no match" is the most dangerous output this system has.
 */
import { describe, expect, it } from "vitest";

import {
  sanctionsListFactsFrom,
  screeningAnswersFrom,
  screeningEntityTypeFrom,
  screeningProviderFactsFrom,
  screeningSubjectFactsFrom,
} from "./screeningStageFacts";
import { deriveAmlScreeningReadiness } from "./screeningReadiness";
import type { AmlSanctionsSync, ProviderReadiness } from "./amlVerificationApi";
import type { AmlPartyScreeningSubject, AmlSubmissionReview } from "./amlCasesApi";

const capability = (over: Partial<ProviderReadiness["screening"]> = {}) => ({
  capability: "screening", configured_provider: "local_lists", mode: "simulator" as const,
  adapter_wired: true, secrets_present: {}, last_health: null,
  state: "simulator_non_production" as const, ...over,
});
const providerReadiness = (over: Partial<ProviderReadiness["screening"]> = {}) => ({
  environment: "production", simulator_blocked: true, note: "",
  idv: capability(), screening: capability(over),
}) as ProviderReadiness;

const sync = (over: Partial<AmlSanctionsSync> = {}): AmlSanctionsSync => ({
  id: "1", list_code: "dfat", source_url: "", entry_count: 8421, status: "succeeded",
  error_detail: null, started_at: "2026-08-15T00:00:00.000Z",
  completed_at: "2026-08-15T00:05:00.000Z", ...over,
});

describe("the provider row", () => {
  it("is null when nothing is configured", () => {
    expect(screeningProviderFactsFrom(null)).toBeNull();
    expect(screeningProviderFactsFrom(undefined)).toBeNull();
    expect(screeningProviderFactsFrom(providerReadiness({ configured_provider: null }))).toBeNull();
  });

  it("reads exactly what production holds today", () => {
    // aml.provider_configs: pep_sanctions / local_lists / simulator / active
    expect(screeningProviderFactsFrom(providerReadiness())).toEqual({
      providerKey: "local_lists", mode: "simulator", active: true,
    });
  });

  it("reads the two states that mean the row cannot be used", () => {
    for (const state of ["not_configured", "unavailable"] as const) {
      expect(screeningProviderFactsFrom(providerReadiness({ state }))?.active).toBe(false);
    }
    for (const state of ["ready_live", "misconfigured", "unknown"] as const) {
      expect(screeningProviderFactsFrom(providerReadiness({ state }))?.active).toBe(true);
    }
  });
});

describe("the sanctions ledger", () => {
  it("distinguishes unread from empty", () => {
    expect(sanctionsListFactsFrom(null)).toBeNull();
    expect(sanctionsListFactsFrom([])).toEqual([]);
  });

  it("does not count a successful sync that published nothing as a load", () => {
    const f = sanctionsListFactsFrom([sync({ entry_count: 0 })])!;
    expect(f[0].lastSuccessAt).toBeNull();
    expect(f[0].entryCount).toBe(0);
    expect(f[0].latestAttemptStatus).toBe("succeeded");
    // And the readiness module refuses on it.
    expect(deriveAmlScreeningReadiness({
      provider: { providerKey: "local_lists", mode: "live", active: true }, lists: f,
    }).code).toBe("lists_never_loaded");
  });

  it("keeps a failure in front of a good load", () => {
    // Designations published since the failure may be missing, so the good
    // load behind it does not make the list current.
    const f = sanctionsListFactsFrom([
      sync({ id: "2", status: "failed", entry_count: 0, completed_at: "2026-08-16T00:00:00.000Z" }),
      sync(),
    ])!;
    expect(f[0].latestAttemptStatus).toBe("failed");
    expect(f[0].lastSuccessAt).toBe("2026-08-15T00:05:00.000Z");
    expect(f[0].entryCount).toBe(8421);
  });

  it("groups by list code", () => {
    const f = sanctionsListFactsFrom([sync(), sync({ id: "2", list_code: "un" })])!;
    expect(f.map((x) => x.listCode).sort()).toEqual(["dfat", "un"]);
  });

  it("reads production's empty ledger as a hard blocker", () => {
    // aml.sanctions_list_syncs: 0 rows.
    const r = deriveAmlScreeningReadiness({
      provider: { providerKey: "local_lists", mode: "simulator", active: true },
      lists: sanctionsListFactsFrom([]),
    });
    expect(r.canRun).toBe(false);
    expect(r.blockers).toHaveLength(2);
  });
});

describe("the subject list", () => {
  const row = (over: Partial<AmlPartyScreeningSubject> = {}): AmlPartyScreeningSubject => ({
    id: "s1", case_id: "c1", party_type: "co_purchaser", party_id: "p1",
    screened_name: "Sam Roe", required: true, state: "completed",
    last_screened_at: null, refresh_due_at: null, adjudicated_at: null,
    adjudication_note: null, screening_check_id: null, error_category: null, ...over,
  });

  it("is null when unread", () => {
    expect(screeningSubjectFactsFrom(null)).toBeNull();
  });

  it("reads the server's own required flag rather than recomputing it", () => {
    expect(screeningSubjectFactsFrom([row()])![0].required).toBe(true);
    expect(screeningSubjectFactsFrom([row({ required: false })])![0].required).toBe(false);
    // A row the server marked not_required does not become required by
    // carrying a stale true.
    expect(screeningSubjectFactsFrom([row({ state: "not_required" })])![0].required).toBe(false);
  });

  it("carries the canonical determination's supersession and review date", () => {
    const f = screeningSubjectFactsFrom([row({
      pep_determination: {
        id: "d1", party_screening_subject_id: "s1", subject_name: "Sam Roe",
        result: "not_pep", pep_type: null, pep_relationship: null,
        determined_at: "2026-08-01T00:00:00.000Z", determined_by_label: "A. Analyst",
        review_due_at: "2027-08-01T00:00:00.000Z", superseded_at: null,
      },
    })])!;
    expect(f[0].pepDetermination).toMatchObject({
      result: "not_pep",
      reviewDueAt: "2027-08-01T00:00:00.000Z",
      supersededAt: null,
    });
  });

  it("carries no determination as null, never as a not-PEP result", () => {
    expect(screeningSubjectFactsFrom([row()])![0].pepDetermination).toBeNull();
  });
});

describe("the client's declarations", () => {
  const review = (sections: Array<{ section: string; payload: unknown }>) => ({
    submission: { sections },
  } as unknown as AmlSubmissionReview);

  it("is null when there is no submission to read", () => {
    expect(screeningAnswersFrom(null)).toBeNull();
    expect(screeningAnswersFrom({ submission: null } as unknown as AmlSubmissionReview)).toBeNull();
    expect(screeningAnswersFrom(review([]))).toBeNull();
  });

  it("reads all four risk inputs from their own sections", () => {
    expect(screeningAnswersFrom(review([
      { section: "personal_details", payload: { pep: "no", adverse: "no" } },
      { section: "purchase_profile", payload: { third_party: "yes" } },
      { section: "funding", payload: { overseas: false } },
    ]))).toEqual({ pep: "no", adverse: "no", thirdParty: "yes", overseasFunding: "no" });
  });

  it("does not turn a missing answer into 'no'", () => {
    const a = screeningAnswersFrom(review([
      { section: "personal_details", payload: { pep: "no" } },
    ]))!;
    expect(a.pep).toBe("no");
    expect(a.adverse).toBeNull();
    expect(a.thirdParty).toBeNull();
    expect(a.overseasFunding).toBeNull();
  });

  it("does not turn an unrecognised answer into 'no'", () => {
    const a = screeningAnswersFrom(review([
      { section: "personal_details", payload: { pep: "unsure", adverse: "" } },
    ]))!;
    expect(a.pep).toBeNull();
    expect(a.adverse).toBeNull();
  });

  it("reads the entity type, and nothing from an absent section", () => {
    expect(screeningEntityTypeFrom(review([
      { section: "purchasing_structure", payload: { entity_type: "trust" } },
    ]))).toBe("trust");
    expect(screeningEntityTypeFrom(review([]))).toBeNull();
    expect(screeningEntityTypeFrom(review([
      { section: "purchasing_structure", payload: { entity_type: "  " } },
    ]))).toBeNull();
    expect(screeningEntityTypeFrom(null)).toBeNull();
  });
});

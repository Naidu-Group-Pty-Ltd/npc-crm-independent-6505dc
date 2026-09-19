/**
 * One batched read of the evidence the case Overview summarises.
 *
 * ── Why this exists ───────────────────────────────────────────────────
 * The old Overview mounted five self-fetching cards. Rendering it cost
 * thirteen requests: the case, its client requests, three reliance reads
 * for the journey map, a consent read, and seven more from the passport
 * section — each fired from its own `useEffect`, several of them for data
 * the operator had not asked to see.
 *
 * This hook replaces that with a single parallel wave, fired once per
 * case and shared by every Overview component. The passport section and
 * the full journey map moved to Records, so they now load only when
 * somebody opens Records.
 *
 * ── Rules ─────────────────────────────────────────────────────────────
 *  • Every call is an EXISTING read operation. No new server operation,
 *    no direct table access, no widened projection.
 *  • Every call is individually failure-tolerant. A read that fails (or
 *    that this role may not make) resolves to `null`, and `null` reads as
 *    "not available" all the way through to the screen — never as a
 *    reassuring default.
 *  • Nothing here decides anything. It fetches facts; the pure helpers in
 *    `workspaceViewModel.ts` read them.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { amlCasesApi } from "./amlCasesApi";
import { amlEntitiesApi } from "./amlEntitiesApi";
import { amlMonitoringApi } from "./amlMonitoringApi";
import { amlRelianceApi, type IndependentAssessment, type RelianceGrant } from "./amlRelianceApi";
import { amlRiskApi } from "./amlRiskApi";
import { amlTransactionsApi } from "./amlTransactionsApi";
import { amlVerificationApi } from "./amlVerificationApi";
import {
  deriveAmlWorkspaceSummary,
  type AmlConsentFacts,
  type AmlDocumentFacts,
  type AmlFundingFacts,
  type AmlGateFacts,
  type AmlIdentityFacts,
  type AmlMonitoringFacts,
  type AmlOwnershipFacts,
  type AmlPassportFacts,
  type AmlScreeningFacts,
  type AmlTransactionFacts,
  type AmlWorkspaceCaseFacts,
  type AmlWorkspaceFacts,
  type AmlWorkspaceSummary,
} from "./workspaceViewModel";
import { deriveAmlJourney, type AmlJourney } from "./journeyModel";
import { readClientPortalAccess } from "./clientPortalAccessApi";
import type { AmlPortalAccessFacts } from "./portalAccessState";

export interface AmlCaseEvidence {
  identity: AmlIdentityFacts | null;
  screening: AmlScreeningFacts | null;
  monitoring: AmlMonitoringFacts | null;
  gate: AmlGateFacts | null;
  documents: AmlDocumentFacts | null;
  ownership: AmlOwnershipFacts | null;
  funding: AmlFundingFacts | null;
  grants: RelianceGrant[] | null;
  assessments: IndependentAssessment[] | null;
  /** The AUSTRAC-referenced consent catalogue's acceptance state. */
  consent: AmlConsentFacts | null;
  /**
   * Passport state and partner distribution readiness, exactly as the server
   * derives them. `null` = the read was unavailable (disabled, unauthorised,
   * or failed) and reads as "not available" everywhere downstream.
   */
  passport: AmlPassportFacts | null;
  transactions: AmlTransactionFacts | null;
  /**
   * The matter line for the case header. Only read for roles that could
   * already open Purchase & counterparty — the visibility boundary is
   * exactly the one the section has today.
   */
  matterLabel: string | null;
  /**
   * Whether the client can actually get into their portal.
   *
   * Read from `client-portal-invite`'s `check_status` — the same endpoint
   * that issues access, so the workspace and the invite dialog can never
   * disagree about what exists. `null` = the read did not answer, which is
   * reported as "not available" and NEVER as "no account": offering to issue
   * access on an unknown state is how a client who already has a login gets
   * a second invitation.
   */
  portalAccess: AmlPortalAccessFacts | null;
}

const EMPTY_EVIDENCE: AmlCaseEvidence = {
  identity: null,
  screening: null,
  monitoring: null,
  gate: null,
  documents: null,
  ownership: null,
  funding: null,
  grants: null,
  assessments: null,
  consent: null,
  passport: null,
  transactions: null,
  matterLabel: null,
  portalAccess: null,
};

export interface AmlCaseSummaryResult {
  /** True until the first wave settles. Cards render their own skeletons. */
  loading: boolean;
  evidence: AmlCaseEvidence;
  facts: AmlWorkspaceFacts;
  summary: AmlWorkspaceSummary;
  /** The ten-stage operational reading of the same facts. */
  journey: AmlJourney;
  refresh: () => Promise<void>;
}

/**
 * Resolve to `null` instead of throwing, so one bad read cannot blank the
 * page. Takes a thunk rather than a promise so a *synchronous* throw — a
 * missing client, a bad argument — is caught too, not just a rejection.
 */
const soft = <T>(run: () => Promise<T>): Promise<T | null> => {
  try {
    return run().then((v) => v, () => null);
  } catch {
    return Promise.resolve(null);
  }
};

export function useAmlCaseSummary(
  caseRow: AmlWorkspaceCaseFacts | null,
  openClientRequests: number | undefined,
  options: {
    enabled?: boolean; canReadMatter?: boolean; clientId?: string | null;
    /**
     * Whether a PEP determination is owed, from the server's recorded scope
     * decision (`sync_screening_stage`). Passed in rather than re-fetched:
     * the workspace already holds that read, and a second copy of an
     * idempotent compliance read is a second thing to keep in step.
     *
     * `null`/absent means unread, which the journey reading treats as OWED.
     * An unread obligation is not an absent one.
     */
    pepRequired?: boolean | null;
    /**
     * The recorded perimeter classification, from the same stage read.
     *
     * It decides whether Stage 6 — Funding & transaction — is owed at all,
     * and it is the ONLY thing that can stand it down. Absent means
     * unclassified, which reads as inside the perimeter and therefore owed.
     */
    perimeter?: {
      classified?: boolean | null;
      classification?: string | null;
      reason_code?: string | null;
    } | null;
  } = {},
): AmlCaseSummaryResult {
  const enabled = options.enabled !== false;
  const canReadMatter = options.canReadMatter === true;
  const clientId = options.clientId ?? null;
  const caseId = caseRow?.id ?? "";
  const [evidence, setEvidence] = useState<AmlCaseEvidence>(EMPTY_EVIDENCE);
  const [loading, setLoading] = useState(false);
  // Guards against a stale wave landing after a newer one.
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!caseId) return;
    const mine = ++seq.current;
    setLoading(true);
    try {
      const [
        checks,
        screening,
        monitoring,
        gate,
        requirements,
        entities,
        sof,
        grants,
        assessments,
        transactions,
        consent,
        passport,
        portalAccess,
      ] = await Promise.all([
        soft(() => amlVerificationApi.listVerificationChecks(caseId)),
        soft(() => amlCasesApi.listPartyScreening(caseId)),
        soft(() => amlMonitoringApi.caseMonitoringSummary(caseId)),
        soft(() => amlRiskApi.gateContract(caseId)),
        soft(() => amlCasesApi.listRequirements(caseId)),
        soft(() => amlEntitiesApi.listEntitiesForCase(caseId)),
        soft(() => amlMonitoringApi.listSof({ case_id: caseId })),
        soft(() => amlRelianceApi.listGrants(caseId)),
        soft(() => amlRelianceApi.listAssessments(caseId)),
        canReadMatter
          ? soft(() => amlTransactionsApi.listTransactions(caseId))
          : Promise.resolve(null),
        soft(() => amlCasesApi.consentStatus(caseId)),
        // Passport state AND partner readiness in one server-derived read.
        // Role-gated server-side (MLRO); a refusal lands as `null` and is
        // recovered below from the projection every AML role may read.
        soft(() => amlRelianceApi.getPassportDistributionStatus(caseId)),
        // Can the client actually get into their portal? Read from the same
        // endpoint that issues access, so the workspace and the invite
        // dialog can never disagree about what exists. The email is left
        // unread here: `undefined` means "not known", which offers the
        // invitation rather than refusing one that would have worked.
        clientId
          ? soft(() => readClientPortalAccess(clientId))
          : Promise.resolve(null),
      ]);
      if (mine !== seq.current) return;

      /*
       * The Passport state has TWO server-derived sources, and which one a
       * caller may read depends on their role:
       *
       *   get_passport_distribution_status  MLRO only. Carries the state and
       *                                     partner readiness in one read.
       *   get_passport_view                 Any AML role, behind
       *                                     `aml_passport_command_view`.
       *                                     Carries the state, no partners.
       *
       * Both embed the SAME `derivePassportState` result — there is one
       * derivation and it runs server-side. So when the first read is
       * unavailable (an analyst, a reviewer, or a transport failure) the
       * second recovers the credential state rather than leaving an analyst
       * looking at "Not available" for a Passport whose state is perfectly
       * well known. Partner readiness stays absent, because it genuinely is.
       *
       * Fired only on the fallback path, so the common case still costs one
       * request and the heavier projection is never fetched speculatively.
       */
      const passportFallback = passport
        ? null
        : await soft(() => amlRelianceApi.getPassportView(caseId));
      if (mine !== seq.current) return;

      const matter = (transactions?.transactions ?? []).find(
        (t) => t.property_address || t.reference,
      );

      setEvidence({
        identity: checks ? { checks: checks.checks ?? [] } : null,
        /*
         * `pep_determination` rides along on each subject — the operation has
         * always returned it and the journey reading simply never asked. The
         * scope decision is read separately below, so "is a PEP determination
         * owed" and "has one been made" stay different questions.
         */
        screening: screening ? { subjects: screening.subjects ?? [] } : null,
        monitoring: monitoring?.monitoring ?? null,
        gate: gate?.gate ?? null,
        documents: requirements ? { requirements: requirements.requirements ?? [] } : null,
        ownership: entities ? { links: entities.links ?? [] } : null,
        funding: sof ? { sources: sof.items ?? [] } : null,
        grants: grants?.grants ?? null,
        assessments: assessments?.assessments ?? null,
        consent: consent
          ? {
              satisfied: Boolean(consent.satisfied),
              // The catalogue returns `{ code, title }`; the journey reads
              // titles, and a title is what an operator would say out loud.
              outstanding: (consent.outstanding ?? []).map((o) => o.title ?? o.code),
              version: consent.version ?? null,
            }
          : null,
        portalAccess,
        passport: passport
          ? {
              enabled: passport.enabled !== false,
              state: passport.passport?.state ?? null,
              version: passport.passport?.version ?? null,
              issued_at: passport.passport?.issued_at ?? null,
              partners: (passport.partners ?? []).map((p) => ({
                partner: {
                  org_id: p.partner?.org_id ?? null,
                  org_name: p.partner?.org_name ?? null,
                  portal_type: p.partner?.portal_type ?? null,
                },
                state: p.state ?? null,
                ready: p.ready,
                blockers: p.blockers ?? [],
                legal_route: p.legal_route ?? null,
              })),
              summary: passport.summary ?? null,
            }
          : passportFallback?.passport
            ? {
                // Recovered from the read this role may make. Partner
                // readiness is absent — `undefined`, not an empty list, so
                // stage 10 reads "not available" rather than "no partners".
                enabled: undefined,
                state: passportFallback.passport.header?.state ?? null,
                version: passportFallback.passport.header?.state?.current_version ?? null,
                issued_at: passportFallback.passport.header?.last_issued_at ?? null,
                partners: undefined,
                summary: null,
              }
            : null,
        transactions: transactions ? { transactions: transactions.transactions ?? [] } : null,
        matterLabel: matter?.property_address ?? matter?.reference ?? null,
      });
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [caseId, canReadMatter]);

  useEffect(() => {
    if (!enabled || !caseId) return;
    void load();
  }, [enabled, caseId, load]);

  // A case that has not loaded yet still gets a coherent (empty) reading, so
  // nothing downstream has to special-case `null`.
  const fallbackCase: AmlWorkspaceCaseFacts = { status: "draft" };

  const facts = useMemo<AmlWorkspaceFacts>(
    () => ({
      caseRow: caseRow ?? fallbackCase,
      openClientRequests,
      identity: evidence.identity,
      screening: evidence.screening
        ? { ...evidence.screening, pepRequired: options.pepRequired ?? null }
        : null,
      monitoring: evidence.monitoring,
      gate: evidence.gate,
      documents: evidence.documents,
      ownership: evidence.ownership,
      funding: evidence.funding,
      portalAccess: evidence.portalAccess,
      activation: ((caseRow as { metadata?: { activation?: unknown } } | null)?.metadata
        ?.activation ?? null) as AmlWorkspaceFacts["activation"],
      consent: evidence.consent,
      transactions: evidence.transactions,
      passport: evidence.passport,
      perimeter: options.perimeter ?? null,
    }),
    // `fallbackCase` is a constant literal, so it is intentionally not a dep.
    [caseRow, openClientRequests, evidence, options.pepRequired, options.perimeter],
  );

  const summary = useMemo(() => deriveAmlWorkspaceSummary(facts), [facts]);
  const journey = useMemo(() => deriveAmlJourney(facts), [facts]);

  return { loading, evidence, facts, summary, journey, refresh: load };
}

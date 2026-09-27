/**
 * AML/CTF Compliance Passport — cross-portal reliance engine.
 *
 * Legal model: AML/CTF Act 2006 (Cth), Part 2 Division 7 (ss 37A–38). One
 * reporting entity may rely on the applicable customer identification
 * procedure carried out by another, under a WRITTEN customer due diligence
 * arrangement that is regularly reviewed — and the relying entity remains
 * responsible for its own compliance. That last clause is why the
 * "independent assessment" path exists: a partner who wants their own
 * determination makes it here, against internally-transferred records,
 * instead of approaching the client again.
 *
 * Staff ops (verifyAuth; agreements/attestations/grants are MLRO-only —
 * cross-entity disclosure is a restricted operation like every other
 * outward-facing act in this module):
 *   list_agreements | create_agreement | review_agreement
 *   issue_attestation | list_attestations
 *   grant_access | revoke_grant | list_grants
 *   list_assessments | list_access_log
 *
 * Partner ops (bearer token minted by grant_access; no session — mirrors the
 * finance handoff-token pattern; token stored hashed, expiring, revocable):
 *   redeem_attestation | record_independent_assessment
 *
 * Disclosure boundary (Appendix C contracts, extended outward): an
 * attestation states WHAT PROCEDURES WERE PERFORMED — parties verified, by
 * what method, when; consents held; screening performed against which lists
 * and how fresh. It NEVER carries risk ratings, screening match content,
 * reviewer notes or MLRO commentary. A partner relying on our identification
 * procedure has no entitlement to our investigation, and s 123 (tipping off)
 * forbids sharing some of it regardless.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { verifyAuth } from "../_shared/auth.ts";
// `aml.cases` has no tenant_id column. See `_shared/aml/caseTenant.ts`.
import { tenantForCase } from "../_shared/aml/caseTenant.ts";
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { withRequestOrigin } from "../_shared/corsOrigin.ts";
import {
  LEGAL_ROUTES,
  evaluateArrangementForReliance,
  evaluatePartnerLinkForReliance,
} from "../_shared/aml/relianceEligibility.ts";
import {
  evaluateDistribution,
  summariseBatch,
  type DistributionCandidate,
  type DistributionContext,
} from "../_shared/aml/passport/passportDistribution.pure.ts";
import {
  DEFAULT_ALLOWED_ATTRIBUTE_CODES,
  DEFAULT_DENIED_CLASSES,
  evaluateManifestForRead,
  findRestrictedKeys,
  intersectPayloadWithManifest,
  materialInputHash,
  sha256HexCanonical,
  toV2Payload,
} from "../_shared/aml/attestationV2.ts";
import {
  REQUESTABLE_RECORD_CLASSES,
  buildPartnerWorkspaceDto,
  evaluateRecordsRequestScope,
  validatePartnerDetermination,
} from "../_shared/aml/partnerWorkspace.ts";
import {
  evaluateMaterialChange,
  materialInputsFromV2Payload,
} from "../_shared/aml/partnerEvents.ts";
import { evaluateEvidenceObjectDelivery } from "../_shared/aml/partnerRetention.ts";
import {
  ACK_LINK_TTL_DAYS,
  acknowledgementLinkFor,
  arrangementDraftFromAcceptance,
  hashAckToken,
  isAckLive,
  mayRequestReplacementLink,
  mintAckToken,
  passportLinkFor,
} from "../_shared/aml/directAcknowledgement.ts";
import {
  PORTAL_TERMS_ACKNOWLEDGEMENTS,
  readAcknowledgements,
  ACKNOWLEDGEMENTS_INCOMPLETE_ERROR,
} from "../_shared/portalAgreement.ts";
import { escapeHtml, getEmailIdentity, resendAddressing } from "../_shared/emailIdentity.ts";
import { meteredFetch } from "../_shared/meteredFetch.ts";
import { buildPassportView } from "../_shared/aml/passport/passportView.pure.ts";
import { derivePassportState } from "../_shared/aml/passport/passportState.pure.ts";
import {
  DEFAULT_SLA_TARGETS,
  REGISTER_DEFS,
  SLA_TARGET_NOTE,
  buildQueueSummary,
  normaliseReadinessItem,
  registerAllowed,
  type OperationsCapabilities,
  type QueueCount,
  type ReadinessItem,
  type SlaTarget,
} from "../_shared/aml/partnerOperations.ts";
import {
  partnerSurfaceMode, passportDisclosure,
  type PartnerSurfaceMode,
} from "../_shared/aml/partnerSurface.pure.ts";
import {
  PORTAL_ROUTES, portalHandoff,
} from "../_shared/aml/partnerPortalHandoff.pure.ts";
import {
  grantsNeedingForwardManifest, resolveAttestationForRead,
} from "../_shared/aml/passport/attestationCurrency.pure.ts";
import { extractFinanceToken, resolveFinancePartner } from "../_shared/finance-portal-session.ts";
import { resolveSolicitorSession } from "../_shared/solicitorPortalAuth.ts";
import { internalError } from '../_shared/errorResponse.ts';
import {
  backfillStampFor, captureObjectsFor,
} from "../_shared/aml/passport/identityPortrait.pure.ts";
import { attachPortraitUrls } from "../_shared/aml/passport/attachPortraitUrls.ts";
import {
  addMonthsUtc, resolveReviewInterval,
} from "../_shared/aml/reviewSchedule.pure.ts";
import {
  AML_REMINDER_TYPES, passportIssuedReminder, periodicReviewReminder,
  upsertComplianceReminder,
} from "../_shared/aml/complianceReminders.ts";
import { readBoundedJson } from '../_shared/validate.ts';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  // Includes the first-party partner-portal session carriers (all present in
  // the canonical CORS_ALLOWED_REQUEST_HEADERS list in _shared/auth.ts):
  // finance sends x-finance-session-token; the builder and solicitor portals
  // authenticate with HttpOnly cookies plus the x-portal-request marker.
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-session-token, x-command-centre-session-token, x-finance-session-token, x-solicitor-session-token, x-portal-request",
  "Access-Control-Expose-Headers": "x-correlation-id, x-duration-ms",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jr = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/**
 * Issuing the Passport starts the clock on keeping it current.
 *
 * ── What this closes ──────────────────────────────────────────────────
 * `schedule_periodic_review` had to be invoked by hand, from a card at the
 * foot of the last stage. Nothing invoked it on issuance, so a case could
 * carry a live, relied-upon Compliance Passport with no ongoing CDD booked
 * at all — and even where one was booked, it appeared on that one card and
 * on no reminder list in the product.
 *
 * ── What it will not do ───────────────────────────────────────────────
 * It never moves an obligation that already exists: an open periodic review
 * is left exactly where it is, because re-issuing a document is not a
 * reason to re-schedule a scheduled review. It never touches a case whose
 * relationship has ended. And it never fails the issuance — the attestation
 * is the compliance act and this is a prompt, so every outcome is reported
 * and nothing is thrown.
 */
async function armOngoingCdd(admin: any, args: {
  caseId: string; version: number; userId: string | null; userLabel: string | null;
}): Promise<{
  nextReviewAt: string | null; reviewScheduled: boolean; reminderWritten: boolean;
  skipped?: string;
}> {
  try {
    const aml = admin.schema("aml");
    const { data: caseRow } = await aml.from("cases")
      .select("id, case_reference, client_id, subject_display_name, risk_rating, monitoring_status, next_periodic_review_at")
      .eq("id", args.caseId).maybeSingle();
    if (!caseRow) return { nextReviewAt: null, reviewScheduled: false, reminderWritten: false, skipped: "case_not_found" };
    if (caseRow.monitoring_status === "ended") {
      return { nextReviewAt: null, reviewScheduled: false, reminderWritten: false, skipped: "relationship_ended" };
    }

    const { data: open } = await aml.from("existing_customer_reviews")
      .select("id, due_at").eq("case_id", args.caseId).eq("classification", "periodic")
      .in("status", ["queued", "in_progress", "remediation_required"])
      .order("due_at", { ascending: true }).limit(1).maybeSingle();

    let reviewId: string | null = open?.id ?? null;
    let dueAt: string | null = open?.due_at ?? null;
    let scheduled = false;

    if (!open) {
      const { data: tenant } = await aml.from("tenant_settings")
        .select("review_interval_config").eq("tenant_id", tenantForCase(String(caseRow.id))).maybeSingle();
      const interval = resolveReviewInterval(
        caseRow.risk_rating, (tenant?.review_interval_config as Record<string, unknown>) ?? null);
      dueAt = addMonthsUtc(new Date(), interval.months).toISOString();
      const { data: review } = await aml.from("existing_customer_reviews").insert({
        case_id: args.caseId, client_id: caseRow.client_id ?? null,
        classification: "periodic", status: "queued",
        priority: caseRow.risk_rating === "high" || caseRow.risk_rating === "prohibited" ? "high" : "normal",
        due_at: dueAt, original_due_at: dueAt,
      }).select("id").maybeSingle();
      reviewId = review?.id ?? null;
      scheduled = Boolean(reviewId);
      if (scheduled) {
        await aml.from("cases").update({ next_periodic_review_at: dueAt }).eq("id", args.caseId);
        await appendCaseEvent(admin, args.caseId, "system",
          `Periodic review scheduled for ${dueAt.slice(0, 10)} (${interval.months}-month cycle) on Passport issuance`,
          { review_id: reviewId, interval_months: interval.months, attestation_version: args.version },
          args.userId, args.userLabel);
      }
    }

    /* Two reminders, because they answer two questions: "the Passport is
       live, share it" and "this review falls due". Keyed on different
       sources so neither can overwrite the other. */
    const issued = await upsertComplianceReminder(admin, {
      clientId: caseRow.client_id, type: AML_REMINDER_TYPES.passport_issued,
      sourceRef: args.caseId,
      ...passportIssuedReminder({
        caseReference: caseRow.case_reference ?? null,
        subjectLabel: caseRow.subject_display_name ?? null,
        version: args.version,
        nextReviewAt: dueAt,
      }),
      dueDate: new Date().toISOString(),
      priority: "medium",
      createdBy: args.userId,
    });

    let reviewReminder = { written: false };
    if (reviewId && dueAt) {
      const { data: tenantForLabel } = await aml.from("tenant_settings")
        .select("review_interval_config").eq("tenant_id", tenantForCase(String(caseRow.id))).maybeSingle();
      const months = resolveReviewInterval(
        caseRow.risk_rating,
        (tenantForLabel?.review_interval_config as Record<string, unknown>) ?? null).months;
      reviewReminder = await upsertComplianceReminder(admin, {
        clientId: caseRow.client_id, type: AML_REMINDER_TYPES.periodic_review,
        sourceRef: reviewId,
        ...periodicReviewReminder({
          caseReference: caseRow.case_reference ?? null, dueAt, intervalMonths: months,
        }),
        dueDate: dueAt,
        priority: caseRow.risk_rating === "high" || caseRow.risk_rating === "prohibited" ? "high" : "medium",
        createdBy: args.userId,
      });
    }

    return {
      nextReviewAt: dueAt,
      reviewScheduled: scheduled,
      reminderWritten: issued.written || reviewReminder.written,
    };
  } catch (e) {
    /* Never fails the issuance. */
    return {
      nextReviewAt: null, reviewScheduled: false, reminderWritten: false,
      skipped: String((e as Error)?.message ?? e),
    };
  }
}

async function sha256Hex(input: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * A Command Centre notification, broadcast to staff.
 *
 * `target_user_id` null is a deliberate broadcast: a partner accepting or
 * declining an agreement happens with nobody signed in, so there is no
 * "current user" to address it to, and the operator who sent the request is
 * not necessarily the one who will act on it. A failure to notify must never
 * roll back the acceptance itself — the case event is the durable record.
 */
async function notifyCommandCentre(
  admin: any, title: string, message: string, caseId: string | null,
) {
  try {
    /* A PostgREST failure is RETURNED, not thrown — the `catch` below only
       ever saw a network fault. This producer therefore had no way of
       reporting a rejected insert at all, which is the exact failure mode
       `notificationsContract.test.ts` was written for: of ~55 notification
       types the UI can render, only 11 had ever been written, because
       producers named columns the table does not have and nothing said so.
       The error is read explicitly now, and the caller carries on either way
       — a bell entry must never be able to fail an acceptance. */
    const { error } = await admin.from("notifications").insert({
      type: "aml_partner_acknowledgement",
      title: title.slice(0, 300),
      message: message.slice(0, 2000),
      entity_id: caseId,
      target_user_id: null,
      link: caseId ? `/admin/aml/cases/${caseId}?section=passport` : null,
      read: false,
    });
    if (error) {
      console.error("[aml-reliance] notification insert rejected", {
        code: (error as any).code, message: error.message,
      });
    }
  } catch (e) {
    console.error("[aml-reliance] notification insert failed", e);
  }
}

/**
 * The case's Passport view, built once for every audience that may read it.
 *
 * This gathering used to live inside `get_passport_view` and nowhere else,
 * which is why a partner's copy of the document was composed by hand from the
 * attestation payload and came out as a different booklet. Two assemblies of
 * one document eventually disagree about it — they did — so there is one, and
 * the audience is a parameter.
 *
 * `buildPassportView` decides what each audience may hold; nothing here does.
 * That separation is the whole safety property: this function fetches the
 * case's records and the pure assembler builds an audience-safe projection
 * from them, failing closed if any restricted vocabulary survives.
 *
 * Returns null when the case does not exist, so the caller answers 404 in its
 * own words.
 */
async function buildCasePassportView(
  admin: any, caseId: string, audience: "command" | "client" | "partner",
) {
  const { data: caseRow } = await admin.schema("aml").from("cases")
    .select("id, case_reference, subject_display_name, subject_type, status, case_stage, service_gate_status, opened_at, closed_at, assigned_mlro_id")
    .eq("id", caseId).maybeSingle();
  if (!caseRow) return null;

  const [
    { data: attRows }, { data: consents }, { data: checks }, { data: docs },
    { data: reqs }, { data: subjects }, { data: pep }, { data: syncs },
    { data: entityLinks }, { data: sof }, { data: sow }, { data: edd },
    { data: txns }, { data: links }, { data: grants }, { data: assessments },
    { data: refreshObs }, { data: events }, { data: requests }, { data: tenant },
  ] = await Promise.all([
    admin.schema("aml").from("compliance_attestations")
      .select("id, version, issued_at, superseded_at, payload_sha256, schema_version, refresh_required_at")
      .eq("case_id", caseId).order("version", { ascending: true }),
    admin.schema("aml").from("consents")
      .select("id, kind, accepted_at, actor_label").eq("case_id", caseId),
    admin.schema("aml").from("verification_checks")
      /* `outcome_detail` for the ONE image the Passport may show — the face
         the provider extracted from the identity document. Read only through
         `identityPortrait.pure.ts`, which is an allow-list of one key. */
      .select("id, party_label, check_type, status, completed_at, outcome_detail").eq("case_id", caseId),
    admin.schema("aml").from("documents")
      .select("id, requirement_id, status, created_at, reviewed_at, version_number")
      .eq("case_id", caseId).neq("status", "deleted"),
    admin.schema("aml").from("document_requirements")
      .select("id, code, label, required").eq("case_id", caseId),
    admin.schema("aml").from("party_screening_subjects")
      .select("state, last_screened_at, adjudicated_at, screened_name").eq("case_id", caseId),
    admin.schema("aml").from("pep_determinations")
      .select("result, determined_at").eq("case_id", caseId)
      .is("superseded_at", null).order("determined_at", { ascending: false }).limit(1),
    admin.schema("aml").from("sanctions_list_syncs")
      .select("list_code, completed_at").eq("status", "succeeded")
      .order("completed_at", { ascending: false }).limit(10),
    admin.schema("aml").from("entity_case_links")
      .select("entity_id").eq("case_id", caseId),
    admin.schema("aml").from("source_of_funds")
      .select("verified, verified_at").eq("case_id", caseId),
    admin.schema("aml").from("source_of_wealth")
      .select("verified, verified_at").eq("case_id", caseId),
    admin.schema("aml").from("edd_cases")
      .select("status, completed_at").eq("case_id", caseId),
    admin.schema("aml").from("transactions")
      .select("id, kind, status, property_address, contract_date, settlement_date, purchase_price")
      .eq("case_id", caseId).is("archived_at", null),
    admin.schema("aml").from("partner_case_links")
      .select("state, legal_route, portal_type, partner_org_id, partner_organisations:partner_org_id(legal_name, organisation_type)")
      .eq("case_id", caseId),
    admin.schema("aml").from("reliance_grants")
      .select("id, granted_at, expires_at, revoked_at, attestation_id, reliance_agreements:agreement_id(partner_org_name, partner_org_type)")
      .eq("case_id", caseId),
    admin.schema("aml").from("independent_assessments")
      .select("id, status, decided_at, assessor_name, reliance_agreements:agreement_id(partner_org_name, partner_org_type)")
      .eq("case_id", caseId),
    admin.schema("aml").from("partner_refresh_obligations")
      .select("id, created_at, status, completed_at, cancelled_at, due_at").eq("case_id", caseId),
    admin.schema("aml").from("case_events")
      .select("id, category, summary, actor_label, created_at")
      .eq("case_id", caseId).order("created_at", { ascending: false }).limit(300),
    admin.schema("aml").from("client_requests")
      .select("id, kind, subject, status, created_at").eq("case_id", caseId)
      .order("created_at", { ascending: false }),
    admin.schema("aml").from("tenant_settings")
      .select("display_name, mlro_contact_name").eq("tenant_id", "default").maybeSingle(),
  ]);

  // Beneficial owners hang off entities, which link to the case through
  // entity_case_links — a two-step read, not a PostgREST embed.
  const entityIds = [...new Set((entityLinks ?? []).map((l: any) => l.entity_id).filter(Boolean))];
  const [{ data: owners }, { data: reps }, { data: entityRows }] = entityIds.length
    ? await Promise.all([
        admin.schema("aml").from("beneficial_owners")
          .select("full_name, ownership_percent, control_type, is_ubo, verification_state, updated_at")
          .in("entity_id", entityIds),
        admin.schema("aml").from("authorised_representatives")
          .select("full_name, role_title, is_director, is_signatory, verification_state")
          .in("entity_id", entityIds),
        admin.schema("aml").from("entities")
          .select("legal_name, entity_type, abn, acn, jurisdiction, registered_address")
          .in("id", entityIds),
      ])
    : [{ data: [] as any[] }, { data: [] as any[] }, { data: [] as any[] }];

  // Control structure: owners and representatives as ONE party list.
  // Names and roles only — risk flags, PEP linkage and notes stay in
  // the case file and are never projected.
  const ownership = [
    ...(owners ?? []).map((o: any) => ({
      name: o.full_name ?? "Beneficial owner",
      party_kind: "beneficial_owner",
      relationship: o.control_type ?? null,
      ownership_percent: typeof o.ownership_percent === "number" ? o.ownership_percent : null,
      control_type: o.control_type ?? null,
      is_ubo: o.is_ubo ?? null,
      verification_state: o.verification_state ?? null,
    })),
    ...(reps ?? []).map((r: any) => ({
      name: r.full_name ?? "Authorised representative",
      party_kind: "authorised_representative",
      relationship: r.role_title ?? (r.is_director ? "Director" : r.is_signatory ? "Signatory" : null),
      ownership_percent: null,
      control_type: r.is_director ? "director" : r.is_signatory ? "signatory" : null,
      is_ubo: false,
      verification_state: r.verification_state ?? null,
    })),
  ];

  const attFacts = (attRows ?? []).map((a: any) => ({
    version: a.version,
    issued_at: a.issued_at,
    superseded_at: a.superseded_at,
    payload_sha256: a.payload_sha256,
    schema_version: a.schema_version ?? 1,
  }));
  const current = (attRows ?? []).filter((a: any) => !a.superseded_at)
    .sort((a: any, b: any) => b.version - a.version)[0] ?? null;
  // Material currency: the canonical signal is `refresh_required_at`
  // stamped by apply_partner_material_change. v1 attestations are not
  // assessable (null) and never force a caution state on their own.
  const materialCurrent = current
    ? (current.refresh_required_at ? false : ((current.schema_version ?? 1) === 2 ? true : null))
    : null;

  const versionByAttId = new Map<string, number>((attRows ?? []).map((a: any) => [a.id, a.version]));
  const grantView = grants ?? [];
  const lastViewByGrant = new Map<string, string>();
  if ((grants ?? []).length > 0) {
    const { data: views } = await admin.schema("aml").from("reliance_access_log")
      .select("grant_id, created_at").eq("case_id", caseId)
      .in("action", ["redeem", "view_attestation"])
      .order("created_at", { ascending: false }).limit(500);
    for (const v of (views ?? [])) {
      if (v.grant_id && !lastViewByGrant.has(v.grant_id)) lastViewByGrant.set(v.grant_id, v.created_at);
    }
  }
  // Authorised disclosure per organisation. Read from the stored v2
  // manifest: allowed codes minus denied classes, with denied winning.
  // A v1 grant has no manifest and therefore discloses no matrix — the
  // page says so rather than implying an empty matrix means "nothing".
  const manifestByGrant = new Map<string, any>();
  if ((grants ?? []).length > 0) {
    const { data: manifests } = await admin.schema("aml").from("disclosure_manifests")
      .select("grant_id, allowed_attribute_codes, allowed_record_classes, denied_classes, revoked_at")
      .in("grant_id", (grants ?? []).map((g: any) => g.id));
    for (const m of (manifests ?? [])) {
      if (!m.revoked_at) manifestByGrant.set(m.grant_id, m);
    }
  }
  const disclosureFor = (grantId: string | null | undefined) => {
    const m = grantId ? manifestByGrant.get(grantId) : null;
    if (!m) return [];
    const denied = new Set<string>((m.denied_classes ?? []) as string[]);
    const codes = [
      ...((m.allowed_attribute_codes ?? []) as string[]),
      ...((m.allowed_record_classes ?? []) as string[]),
    ];
    const seen = new Set<string>();
    const out: Array<{ code: string; state: "granted" | "limited" | "withheld" }> = [];
    for (const code of codes) {
      if (seen.has(code)) continue;
      seen.add(code);
      out.push({ code, state: denied.has(code) ? "withheld" : "granted" });
    }
    for (const code of denied) {
      if (!seen.has(code)) { seen.add(code); out.push({ code, state: "withheld" }); }
    }
    return out;
  };

  const grantByOrg = new Map<string, any>();
  for (const g of grantView) {
    const org = (g as any).reliance_agreements?.partner_org_name ?? "";
    const prev = grantByOrg.get(org);
    if (!prev || String(g.granted_at) > String(prev.granted_at)) grantByOrg.set(org, g);
  }
  const assessByOrg = new Map<string, any>();
  for (const a of (assessments ?? [])) {
    const org = (a as any).reliance_agreements?.partner_org_name ?? "";
    const prev = assessByOrg.get(org);
    if (!prev || String(a.decided_at) > String(prev.decided_at)) assessByOrg.set(org, a);
  }
  const partners = (links ?? []).map((l: any) => {
    const orgName = l.partner_organisations?.legal_name ?? null;
    const g = orgName ? grantByOrg.get(orgName) : undefined;
    const a = orgName ? assessByOrg.get(orgName) : undefined;
    return {
      org_name: orgName,
      org_type: l.partner_organisations?.organisation_type ?? null,
      portal_type: l.portal_type ?? null,
      link_state: l.state ?? null,
      legal_route: l.legal_route ?? null,
      grant_created_at: g?.granted_at ?? null,
      grant_expires_at: g?.expires_at ?? null,
      grant_revoked_at: g?.revoked_at ?? null,
      attestation_version: g ? (versionByAttId.get(g.attestation_id) ?? null) : null,
      last_viewed_at: g ? (lastViewByGrant.get(g.id) ?? null) : null,
      assessment_status: a?.status ?? null,
      assessment_decided_at: a?.decided_at ?? null,
      assessor_name: a?.assessor_name ?? null,
      disclosure: disclosureFor(g?.id),
    };
  });

  const reqById = new Map<string, any>((reqs ?? []).map((r: any) => [r.id, r]));
  const issuerOrg = tenant?.display_name ?? "NPC Services command centre";
  const entityDetailsTyped = await questionnairePayload(admin, caseId, "entity_details");
  const view = buildPassportView(audience, {
    issuer_org: issuerOrg,
    officer_label: tenant?.mlro_contact_name ?? null,
    case: caseRow,
    attestations: attFacts,
    material_inputs_current: materialCurrent,
    open_refresh_obligations: (refreshObs ?? []).filter((r: any) => r.status === "open").length,
    personal_details: await questionnairePayload(admin, caseId, "personal_details"),
    // The entity REGISTER is canonical for particulars; the questionnaire
    // is what the client typed. Register values win where both exist.
    entity_details: (() => {
      const typed = entityDetailsTyped ?? {};
      const reg = (entityRows ?? [])[0];
      if (!reg) return Object.keys(typed).length ? typed : null;
      return {
        ...typed,
        entity_name: reg.legal_name ?? typed.entity_name,
        abn_acn: reg.acn ?? reg.abn ?? typed.abn_acn,
        registration_place: reg.jurisdiction ?? typed.registration_place,
        registered_address: reg.registered_address ?? typed.registered_address,
      };
    })(),
    documents: (docs ?? []).map((d: any) => ({
      id: d.id,
      requirement_label: reqById.get(d.requirement_id)?.label ?? null,
      requirement_code: reqById.get(d.requirement_id)?.code ?? null,
      required: reqById.get(d.requirement_id)?.required ?? null,
      status: d.status,
      created_at: d.created_at,
      version_number: d.version_number,
    })),
    transactions: txns ?? [],
    ownership,
    screening: {
      subjects: (subjects ?? []).map((s: any) => ({
        state: s.state,
        completed_at: s.adjudicated_at ?? s.last_screened_at ?? null,
        party_label: s.screened_name ?? null,
      })),
      pep_result: (pep ?? [])[0]?.result ?? null,
      pep_determined_at: (pep ?? [])[0]?.determined_at ?? null,
      list_freshness: Object.fromEntries(
        (syncs ?? []).reduce((m: Map<string, string>, s: any) => {
          if (!m.has(s.list_code)) m.set(s.list_code, s.completed_at);
          return m;
        }, new Map()),
      ),
    },
    funding: {
      sof: (sof ?? []).map((r: any) => ({ verified: r.verified, verified_at: r.verified_at })),
      sow: (sow ?? []).map((r: any) => ({ verified: r.verified, verified_at: r.verified_at })),
      edd: (edd ?? []).map((e: any) => ({ status: e.status, completed_at: e.completed_at })),
    },
    partners,
    events: events ?? [],
    client_requests: requests ?? [],
    stamp_input: {
      issuer_org: issuerOrg,
      attestations: attFacts.map((a: any) => ({
        version: a.version, issued_at: a.issued_at, superseded_at: a.superseded_at,
      })),
      consents: consents ?? [],
      verification_checks: (checks ?? []).map((c: any) => {
        /* Named fields only. `outcome_detail` is a provider payload and must
           never travel into the projection whole — the three facts the
           portrait needs are lifted out and the rest is left behind. */
        const sa = c.outcome_detail?.standalone ?? {};
        const idv = sa.id_verification?.id_verification ?? {};
        return {
          id: c.id, party_label: c.party_label, check_type: c.check_type,
          status: c.status, completed_at: c.completed_at,
          /* ONE reader — see `captureObjectsFor`. This expression used to
             prefer `standalone.capture_objects`, a copy written once when the
             evidence block was composed and never updated, so a portrait
             added to the plan afterwards was invisible here. */
          capture_objects: captureObjectsFor(c.outcome_detail),
          document_choice: sa.document_choice
            ?? c.outcome_detail?.standalone_capture?.document_choice ?? null,
          issuing_state: idv.issuing_state ?? null,
          portrait_backfill: backfillStampFor(c.outcome_detail),
        };
      }),
      documents: (docs ?? []).map((d: any) => ({
        status: d.status, reviewed_at: d.reviewed_at, created_at: d.created_at,
      })),
      screening_subjects: (subjects ?? []).map((s: any) => ({
        state: s.state, completed_at: s.adjudicated_at ?? s.last_screened_at ?? null,
      })),
      owners: (owners ?? []).map((o: any) => ({
        verification_state: o.verification_state, verified_at: o.updated_at ?? null,
      })),

      source_of_funds: (sof ?? []).map((r: any) => ({ verified: r.verified, verified_at: r.verified_at })),
      source_of_wealth: (sow ?? []).map((r: any) => ({ verified: r.verified, verified_at: r.verified_at })),
      edd_cases: (edd ?? []).map((e: any) => ({ status: e.status, completed_at: e.completed_at })),
      grants: grantView.map((g: any) => ({
        id: g.id,
        created_at: g.granted_at,
        revoked_at: g.revoked_at,
        partner_org_name: g.reliance_agreements?.partner_org_name ?? null,
        partner_org_type: g.reliance_agreements?.partner_org_type ?? null,
        attestation_version: versionByAttId.get(g.attestation_id) ?? null,
      })),
      assessments: (assessments ?? []).map((a: any) => ({
        id: a.id, status: a.status, decided_at: a.decided_at, assessor_name: a.assessor_name,
        partner_org_name: a.reliance_agreements?.partner_org_name ?? null,
        partner_org_type: a.reliance_agreements?.partner_org_type ?? null,
      })),
      // completed_at / cancelled_at / due_at were dropped here, so the
      // stamp engine could not tell a finished refresh from an
      // outstanding one and every completed obligation still read as a
      // standing request.
      refresh_obligations: (refreshObs ?? []).map((r: any) => ({
        id: r.id, created_at: r.created_at, status: r.status,
        completed_at: r.completed_at ?? null,
        cancelled_at: r.cancelled_at ?? null,
        due_at: r.due_at ?? null,
      })),
      transactions: (txns ?? []).map((t: any) => ({
        id: t.id, status: t.status, settlement_date: t.settlement_date,
        property_address: t.property_address,
      })),
    },
  });
  /* The photograph is signed HERE, for this reader, and never in the
     projection — see `attachPortraitUrls`. */
  await attachPortraitUrls(admin, view, checks ?? []);
  return view;
}

/**
 * An unexpected fault on a PUBLIC link, answered so that both sides learn.
 *
 * `internalError` is right about what it withholds — an anonymous caller is
 * told nothing about our internals, and gets a correlation id instead. It is
 * wrong about who is reading it here. "Internal error" is written for an
 * operator with a support channel; the recipient of a one-time link has none,
 * so the message has to carry the next step itself, and somebody on this side
 * has to be told, because the only party who witnessed the failure is the one
 * party who cannot report it.
 *
 * The notification carries the correlation id, so the console line and the
 * Command Centre entry name the same incident.
 */
async function publicLinkFailure(admin: any, err: unknown, caseId: string | null, what: string) {
  const correlationId = crypto.randomUUID();
  const body = internalError(err, "aml-reliance", correlationId);
  await notifyCommandCentre(
    admin,
    "A partner could not complete the compliance agreement",
    `${what} through a one-time link could not be recorded (reference ${correlationId}). `
    + "Nothing was written, so their agreement still stands as outstanding. They have been asked to "
    + "contact you — re-issue the link from the case's Gate & Passport stage once the fault is cleared.",
    caseId,
  );
  return jr({
    ...body,
    error: "This could not be completed just now, and nothing has been recorded. "
      + "The organisation that sent you this link has been notified — please contact them, "
      + "and they will send a new one.",
  }, 500);
}

async function appendCaseEvent(admin: any, caseId: string, category: string, summary: string, payload: any, actorId: string | null, actorLabel: string | null) {
  const { data: prev } = await admin.schema("aml").from("case_events")
    .select("row_hash").eq("case_id", caseId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const prevHash = prev?.row_hash ?? null;
  const now = new Date().toISOString();
  const rowHash = await sha256Hex(JSON.stringify({ case_id: caseId, category, summary, payload, actor_id: actorId, actor_label: actorLabel, prev_hash: prevHash, created_at: now }));
  await admin.schema("aml").from("case_events").insert({
    case_id: caseId, category, summary, payload, actor_id: actorId, actor_label: actorLabel,
    prev_hash: prevHash, row_hash: rowHash, created_at: now,
  });
}

const GRANT_TTL_DAYS = 90;

/** One questionnaire section's stored payload, or null. Read-only. */
async function questionnairePayload(admin: any, caseId: string, section: string) {
  const { data } = await admin.schema("aml").from("questionnaire_responses")
    .select("payload").eq("case_id", caseId).eq("section", section).maybeSingle();
  return (data?.payload && typeof data.payload === "object") ? data.payload : null;
}

/**
 * Build the sanitised attestation payload for a case.
 *
 * Everything here answers "what procedures were performed" — nothing answers
 * "what did you conclude about this customer". The exclusion list is the
 * contract: risk_rating, risk_score, screening match content, reviewer notes
 * and MLRO commentary must never enter this object.
 */
async function buildAttestationPayload(admin: any, caseRow: any) {
  const caseId = caseRow.id;
  const [{ data: checks }, { data: consents }, { data: sections }, { data: screenings }, { data: syncs }] = await Promise.all([
    admin.schema("aml").from("verification_checks")
      .select("party_label, check_type, status, provider, completed_at, outcome_detail")
      .eq("case_id", caseId),
    admin.schema("aml").from("consents")
      .select("kind, version, accepted_at").eq("case_id", caseId),
    admin.schema("aml").from("questionnaire_responses")
      .select("section, status").eq("case_id", caseId),
    admin.schema("aml").from("screening_checks")
      .select("completed_at, scope, status").eq("case_id", caseId)
      .order("completed_at", { ascending: false }).limit(1),
    admin.schema("aml").from("sanctions_list_syncs")
      .select("list_code, completed_at").eq("status", "succeeded")
      .order("completed_at", { ascending: false }).limit(10),
  ]);

  // One line per party: verified or not, by which method, when. Sighting
  // detail keeps document type + certifier because that is precisely what a
  // relying entity's own risk assessment needs; scores stay internal.
  const partyMap = new Map<string, any>();
  for (const c of (checks ?? [])) {
    const key = c.party_label;
    const cur = partyMap.get(key) ?? { party: key, verified: false, method: null, completed_at: null, document_type: null };
    if (c.status === "passed" && ["electronic_idv", "document_sighting", "dvs"].includes(c.check_type)) {
      cur.verified = true;
      cur.method = c.check_type;
      cur.completed_at = c.completed_at;
      if (c.check_type === "document_sighting") {
        cur.document_type = c.outcome_detail?.document_type ?? null;
        cur.sighting_kind = c.outcome_detail?.sighting_kind ?? null;
        cur.certifier_capacity = c.outcome_detail?.certifier_capacity ?? null;
      }
    }
    partyMap.set(key, cur);
  }

  const latestScreening = (screenings ?? [])[0] ?? null;
  const listFreshness: Record<string, string> = {};
  for (const s of (syncs ?? [])) {
    if (!listFreshness[s.list_code]) listFreshness[s.list_code] = s.completed_at;
  }

  return {
    schema: "aml.compliance_attestation.v1",
    issuer: "NPC Services command centre",
    case_reference: caseRow.case_reference,
    subject: caseRow.subject_display_name,
    subject_type: caseRow.subject_type,
    customer_identification: {
      parties: [...partyMap.values()],
      questionnaire_version: caseRow.metadata?.questionnaire_version ?? null,
      sections_submitted: (sections ?? []).filter((s: any) =>
        ["submitted", "accepted", "complete"].includes(s.status)).length,
      consents_held: (consents ?? []).map((c: any) => ({
        code: c.kind, version: c.version, accepted_at: c.accepted_at,
      })),
    },
    screening: {
      performed: Boolean(latestScreening),
      last_performed_at: latestScreening?.completed_at ?? null,
      scope: latestScreening?.scope ?? null,
      list_freshness: listFreshness,
      // Deliberately absent: match content. A partner sees THAT screening
      // ran and how fresh the lists were, never what it surfaced.
    },
    // Same finance-safe derivation as Appendix C.2: readiness is a boolean
    // derived only from an explicitly approved gate, never the raw status.
    service_readiness: ["approved", "approved_with_controls"]
      .includes(caseRow.service_gate_status) ,
    limitations: [
      "documents_not_verified_against_issuing_authority",
      "liveness_signal_is_heuristic_only",
    ],
    reliance_basis: "AML/CTF Act 2006 (Cth) Pt 2 Div 7 — written CDD arrangement required; relying entity remains responsible for its own compliance",
  };
}

/**
 * Phase 1 enforcement flag. Off = legacy free-text agreement behaviour is
 * preserved exactly. On = new reliance grants require a canonical partner
 * organisation and an active partner-case link (legal_route = reliance).
 * Tolerates both feature-flag value shapes used in this repo.
 */
async function flagEnabled(admin: any, key: string): Promise<boolean> {
  const { data } = await admin.from("feature_flags")
    .select("value").eq("key", key).maybeSingle();
  const v = data?.value;
  if (v === true || v === "true") return true;
  if (v && typeof v === "object" && (v as any).enabled === true) return true;
  return false;
}

const partnerIdentityEnforced = (admin: any) => flagEnabled(admin, "aml_partner_identity");
const arrangementGovernanceEnforced = (admin: any) => flagEnabled(admin, "aml_arrangement_governance");
const attestationV2Enabled = (admin: any) => flagEnabled(admin, "aml_attestation_v2");
/* The Compliance Passport, inside a partner's own portal. Turning this on
   NARROWS the compliance page to the document alone (see
   `_shared/aml/partnerSurface.pure.ts`) unless the full workspace is
   separately enabled — so a deployment cannot acquire eight unreviewed
   panels as a side effect of showing a Passport. */
const partnerPassportViewEnabled = (admin: any) => flagEnabled(admin, "aml_partner_passport_view");
const partnerFullWorkspaceEnabled = (admin: any) => flagEnabled(admin, "aml_partner_workspace_full");

const PARTNER_ORG_TYPES = ["finance", "builder", "developer", "solicitor_conveyancer", "other"];
const PARTNER_PORTAL_TYPES = ["finance", "builder", "developer", "solicitor_conveyancer"];
const PARTNER_USER_SOURCES = ["finance_portal_users", "builder_portal_users", "solicitor_portal_users"];
const PARTNER_CLASSIFICATIONS = [
  "unclassified", "eligible_relying_reporting_entity", "eligible_foreign_equivalent",
  "reporting_entity_no_reliance", "non_reporting_commercial", "outsourcing_principal",
  "service_provider",
];

/** Resolve a partner bearer token to a live grant, or null. */
async function resolveGrant(admin: any, rawToken: string) {
  if (!rawToken || rawToken.length < 20) return null;
  const hash = await sha256Hex(rawToken);
  const { data: grant } = await admin.schema("aml").from("reliance_grants")
    .select("*, reliance_agreements:agreement_id(*), compliance_attestations:attestation_id(*)")
    .eq("access_token_hash", hash).maybeSingle();
  if (!grant) return null;
  if (grant.revoked_at) return { grant, denied: "revoked" };
  if (new Date(grant.expires_at).getTime() < Date.now()) return { grant, denied: "expired" };
  const agreement = (grant as any).reliance_agreements;
  if (!agreement || agreement.status !== "active") return { grant, denied: "agreement_inactive" };
  return { grant, denied: null };
}

/* ── first-party partner workspace (Phase 4) ──────────────────────────── */

/** Surface → membership/link portal types it may serve. The Builder surface
 * serves both builder and developer organisations (there is no standalone
 * Developer Portal; that absence FAILS CLOSED — no session, no access). */
const SURFACE_PORTAL_TYPES: Record<string, string[]> = {
  finance: ["finance"],
  builder: ["builder", "developer"],
  solicitor_conveyancer: ["solicitor_conveyancer"],
};

const PARTNER_WORKSPACE_OPS = new Set([
  "get_partner_compliance_workspace",
  "request_cdd_records",
  "list_partner_records_requests",
  "record_partner_determination",
  "list_partner_evidence_deliveries",
  "get_partner_audit_receipt",
  // Phase 6: refresh obligations and safe notifications (read-only lists;
  // obligations complete through record_partner_determination, never here).
  "list_partner_refresh_obligations",
  "list_partner_notifications",
  // Pre-rollout Stage B: controlled, expiring, audited P3 evidence access.
  "get_partner_evidence_delivery_access",
]);

/** Server-controlled signed-access lifetime for evidence objects. The body
 * cannot lengthen it; nothing persists the URL. */
const EVIDENCE_ACCESS_TTL_SECONDS = 300;
/** Evidence-access attempts allowed per membership per minute. */
const EVIDENCE_ACCESS_RATE_LIMIT = 10;

const WORKSPACE_PORTAL_FLAGS: Record<string, string> = {
  finance: "aml_partner_workspace_finance",
  builder: "aml_partner_workspace_builder",
  solicitor_conveyancer: "aml_partner_workspace_solicitor",
};

type PartnerPortalContext = {
  ok: true;
  surface: string;
  source: string;
  portalUserId: string;
  portalUserLabel: string | null;
  membership: any;
  partnerOrg: any;
};
type PartnerPortalDenied = { ok: false; status: number; error: string; code?: string };

/**
 * Resolve the authenticated portal identity to ONE canonical partner
 * organisation via an active membership.
 *
 * Identity always comes from the portal's own server-trusted session
 * resolver — never from a body identifier. Where the session itself carries
 * an organisation (builder active organisation, solicitor firm), the
 * canonical organisation's recorded portal reference MUST match it; a
 * membership row alone cannot widen a session into another organisation.
 * Finance sessions carry no organisation, so the membership must be
 * unambiguous (exactly one candidate) — ambiguity fails closed.
 */
async function resolvePartnerPortalContext(
  admin: any, req: Request, body: any,
): Promise<PartnerPortalContext | PartnerPortalDenied> {
  const surface = String(body.portal_type ?? "");
  if (!Object.keys(SURFACE_PORTAL_TYPES).includes(surface)) {
    return { ok: false, status: 400, error: "portal_type must be finance, builder or solicitor_conveyancer" };
  }

  let source = "";
  let portalUserId = "";
  let portalUserLabel: string | null = null;
  let sessionSolicitorFirmId: string | null = null;
  let sessionFinanceContactId: string | null = null;

  if (surface === "finance") {
    const token = extractFinanceToken(req.headers, body);
    const resolved: any = await resolveFinancePartner(admin, token);
    if (resolved.error || !resolved.portalUser) {
      return { ok: false, status: resolved.status ?? 401, error: "Invalid or expired session", code: "auth_required" };
    }
    source = "finance_portal_users";
    portalUserId = String(resolved.portalUser.id);
    portalUserLabel = resolved.portalUser.email ?? null;
    const { data: fpUser } = await admin.from("finance_portal_users")
      .select("finance_contact_id").eq("id", portalUserId).maybeSingle();
    sessionFinanceContactId = fpUser?.finance_contact_id ?? null;
  } else if (surface === "builder") {
    /* Phase 7 of the network extraction: the Builder / Developer Portal moved
       to the Builders Network and its session plane left this deployment with
       it — there is no builder portal cookie to resolve any more, and the
       tables one resolved against are gone. A builder partner's channel is
       the emailed Passport link; the in-portal workspace returns over the
       network connection (E4), authenticated by the network rather than by a
       cookie this workspace no longer mints. Same vocabulary the portal
       handoff has used since Phase 6. */
    return {
      ok: false, status: 410,
      error: "The builder portal moved to the Builders Network. Builder partners read the Compliance Passport through the emailed link.",
      code: "portal_moved",
    };
  } else {
    const resolved: any = await resolveSolicitorSession(admin, req.headers, body);
    if (!resolved.ok || !resolved.user) {
      return { ok: false, status: resolved.status ?? 401, error: resolved.error ?? "Invalid or expired session", code: "auth_required" };
    }
    source = "solicitor_portal_users";
    portalUserId = String(resolved.user.id);
    portalUserLabel = resolved.user.email ?? null;
    sessionSolicitorFirmId = resolved.user.firm_id ?? null;
    if (!sessionSolicitorFirmId) {
      return { ok: false, status: 403, error: "No legal practice is linked to this account.", code: "firm_required" };
    }
  }

  const allowedTypes = SURFACE_PORTAL_TYPES[surface];
  const { data: memberships } = await admin.schema("aml").from("partner_portal_memberships")
    .select("*").eq("portal_user_source", source).eq("portal_user_id", portalUserId)
    .eq("status", "active").in("portal_type", allowedTypes);
  const membershipRows: any[] = memberships ?? [];
  if (membershipRows.length === 0) {
    return { ok: false, status: 403, error: "Your account is not enrolled for the compliance workspace. Ask the issuing organisation to set up your membership.", code: "membership_missing" };
  }

  const orgIds = [...new Set(membershipRows.map((m) => String(m.partner_org_id)))];
  const { data: orgs } = await admin.schema("aml").from("partner_organisations")
    .select("*").in("id", orgIds).eq("status", "active");
  const orgRows: any[] = orgs ?? [];

  // Session-organisation cross-check: the canonical organisation must carry
  // the matching portal reference where the session names one.
  let candidates = orgRows;
  if (surface === "solicitor_conveyancer") {
    candidates = orgRows.filter((o) => o.solicitor_firm_id === sessionSolicitorFirmId);
  } else {
    candidates = orgRows.filter((o) =>
      !o.finance_agent_contact_id || o.finance_agent_contact_id === sessionFinanceContactId);
  }
  if (candidates.length === 0) {
    return { ok: false, status: 403, error: "No canonical partner organisation is mapped to your current portal organisation.", code: "partner_org_unmapped" };
  }
  if (candidates.length > 1) {
    // Never guess between organisations.
    return { ok: false, status: 409, error: "Your account maps to more than one partner organisation. Ask the issuing organisation to correct the memberships.", code: "partner_org_ambiguous" };
  }
  const partnerOrg = candidates[0];
  const membership = membershipRows.find((m) => String(m.partner_org_id) === String(partnerOrg.id));
  if (!membership) {
    return { ok: false, status: 403, error: "Membership not found for the resolved organisation.", code: "membership_missing" };
  }
  return { ok: true, surface, source, portalUserId, portalUserLabel, membership, partnerOrg };
}

/** Load a partner-case link by id, scoped to the resolved organisation and
 * the surface's permitted portal types. Absence answers 404 — a link id is
 * never confirmed to an organisation it does not belong to. */
async function loadScopedPartnerLink(admin: any, linkId: string, partnerOrgId: string, surface: string) {
  if (!linkId) return null;
  const { data: link } = await admin.schema("aml").from("partner_case_links")
    .select("*").eq("id", linkId).eq("partner_org_id", partnerOrgId).maybeSingle();
  if (!link) return null;
  if (!SURFACE_PORTAL_TYPES[surface].includes(link.portal_type)) return null;
  return link;
}

/** Latest grant/attestation pair for a case × canonical organisation. Only
 * canonically-stamped grants participate — the workspace is the new path. */
/**
 * This organisation's most recent grant on this matter.
 *
 * ── Why there are two routes and not one ──────────────────────────────
 * A grant carries `partner_org_id` only when its ARRANGEMENT carried one,
 * and until `create_agreement` accepted an organisation, none of them did:
 * every grant the onboarding wizard produced had NULL there. Looking up by
 * that column alone therefore answered "no grant" for a partner who plainly
 * held one, and the portal reported the Passport as never shared.
 *
 * The second route is the arrangement's own pointer, which is the same fact
 * by a second explicit path — not an inference. Both are recorded decisions;
 * neither is a name match, and nothing here falls back to guessing which
 * organisation an arrangement "probably" meant.
 *
 * Deliberately two queries rather than one `.or()`: a PostgREST filter
 * composed as a string is the defect class this codebase has a contract test
 * for, and it would have to interpolate a UUID list here.
 */
async function loadOrgGrantAndAttestation(admin: any, caseId: string, partnerOrgId: string) {
  const select = "*, compliance_attestations:attestation_id(*)";
  const { data: direct } = await admin.schema("aml").from("reliance_grants")
    .select(select)
    .eq("case_id", caseId).eq("partner_org_id", partnerOrgId)
    .order("granted_at", { ascending: false }).limit(1).maybeSingle();
  let grant = direct ?? null;

  if (!grant) {
    const { data: agreements } = await admin.schema("aml").from("reliance_agreements")
      .select("id").eq("partner_org_id", partnerOrgId);
    const agreementIds = (agreements ?? []).map((a: any) => String(a.id));
    if (agreementIds.length > 0) {
      const { data: viaAgreement } = await admin.schema("aml").from("reliance_grants")
        .select(select)
        .eq("case_id", caseId).in("agreement_id", agreementIds)
        .order("granted_at", { ascending: false }).limit(1).maybeSingle();
      grant = viaAgreement ?? null;
    }
  }
  if (!grant) return { grant: null, attestation: null };
  return { grant, attestation: (grant as any).compliance_attestations ?? null };
}


/**
 * "Open it in your portal", resolved for one grant.
 *
 * Every input is a fact the server holds: the arrangement's organisation
 * type decides WHICH portal, the surface flags decide whether that page
 * exists, and an active membership decides whether anybody could sign in and
 * reach it. The rule itself is `portalHandoff` — shared with the browser, so
 * the destination advertised and the route served cannot drift.
 *
 * It never widens access. The path carries a matter identifier, which grants
 * nothing: the portal session re-derives the organisation and re-checks every
 * rule on arrival, and a matter belonging to somebody else is simply not
 * found. The bearer token never appears in it — a credential in a browser
 * address bar survives in history, referrers and screenshots.
 */
async function resolvePortalHandoff(
  admin: any,
  grant: any,
  agreement: any,
  origin: string | null,
) {
  const orgType = String(agreement?.partner_org_type ?? "");
  const route = PORTAL_ROUTES[orgType as keyof typeof PORTAL_ROUTES];
  if (!route) {
    return portalHandoff(
      { partnerOrgType: orgType, surfaceEnabled: false, hasActiveMembership: false },
      origin,
    );
  }

  /* The organisation, by either explicit route — the grant's own column, or
     its arrangement's. See `loadOrgGrantAndAttestation` for why both exist. */
  const orgId = grant?.partner_org_id
    ? String(grant.partner_org_id)
    : (agreement?.partner_org_id ? String(agreement.partner_org_id) : null);

  const surfaceEnabled = orgId
    ? (await flagEnabled(admin, "aml_partner_compliance_workspace"))
      && (await flagEnabled(admin, SURFACE_FLAG_BY_SURFACE[route.surface]))
      && (await partnerPassportViewEnabled(admin))
    : false;

  let hasActiveMembership = false;
  let linkId: string | null = grant?.partner_case_link_id
    ? String(grant.partner_case_link_id) : null;

  if (orgId) {
    const { count } = await admin.schema("aml").from("partner_portal_memberships")
      .select("id", { count: "exact", head: true })
      .eq("partner_org_id", orgId).eq("status", "active");
    hasActiveMembership = (count ?? 0) > 0;

    if (!linkId) {
      /* The grant predates partner links, or was minted before its
         arrangement named an organisation. The matter is still knowable
         exactly — one ACTIVE link for this organisation on this case — and
         is left absent rather than guessed when it is not. */
      const { data: links } = await admin.schema("aml").from("partner_case_links")
        .select("id, portal_type")
        .eq("case_id", grant.case_id).eq("partner_org_id", orgId).eq("state", "active");
      const candidates = (links ?? []).filter(
        (l: any) => SURFACE_PORTAL_TYPES[route.surface].includes(String(l.portal_type)));
      if (candidates.length === 1) linkId = String(candidates[0].id);
    }
  }

  return portalHandoff({
    partnerOrgType: orgType,
    partnerCaseLinkId: linkId,
    surfaceEnabled,
    hasActiveMembership,
  }, origin);
}

/** Surface → its own feature flag, mirroring WORKSPACE_PORTAL_FLAGS. */
const SURFACE_FLAG_BY_SURFACE: Record<string, string> = {
  finance: "aml_partner_workspace_finance",
  builder: "aml_partner_workspace_builder",
  solicitor_conveyancer: "aml_partner_workspace_solicitor",
};


/**
 * The attestation a grant's holder actually reads.
 *
 * A grant authorises a PARTNER to read a CASE's attested record; it does not
 * freeze which version of that record they see. The pin on the grant stays
 * exactly as it is — it records what the access was issued against, which is
 * the audit fact — and the reading follows the case's current version.
 *
 * Before this, issuing v2 answered every existing partner 409
 * `attestation_superseded` and told them to ask for new access. Nothing was
 * broken; it worked as written. But a routine re-issue silently revoked every
 * partner's access and the only repair was to re-send the Passport to each of
 * them by hand.
 */
async function attestationForGrantRead(admin: any, grant: any) {
  const pinned = (grant as any).compliance_attestations ?? null;
  const { data: current } = await admin.schema("aml").from("compliance_attestations")
    .select("*").eq("case_id", grant.case_id).is("superseded_at", null)
    .order("version", { ascending: false }).limit(1).maybeSingle();
  return {
    reading: resolveAttestationForRead({ current: current ?? null, pinned }),
    current: current ?? null,
    pinned,
  };
}

const __corsWrappedHandler = (async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await readBoundedJson(req).catch(() => ({}));
    const op = String(body?.op ?? "");
    if (!op) return jr({ error: "op required" }, 400);
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

    /* ── partner workspace ops: first-party portal sessions (Phase 4) ────── */
    // Session-authenticated, membership-mapped, link-scoped. No bearer token
    // ever reaches a first-party browser; identity comes from the portal's
    // own server-trusted session resolver. Everything is flag-gated: with
    // the master or surface flag off these ops answer 404 and the system
    // behaves exactly as before Phase 4.

    /* ── does this portal's compliance page exist? ────────────────────
       Answered HERE, before the workspace gate, and deliberately without a
       session.

       The browser used to answer this itself with
       `supabase.from("feature_flags").select(...)`, and that read can never
       work for a partner: `public.feature_flags` grants SELECT `TO
       authenticated`, and a portal user's browser client is anon — their
       identity is the portal's own cookie or token session, not a Supabase
       one. RLS does not error on a role that matches no policy, it FILTERS.
       So the query returned `[]` with HTTP 200, `error` was null, every flag
       coerced from `undefined` to `false`, and the page reported "The
       compliance workspace is not available" however the database was set.

       The same trap is documented on `useAmlV3Flags` and
       `useBuilderStockMarketplaceFlag`. The rule they state is the rule
       here: read through the server.

       It discloses nothing. Whether a page exists is what the navigation
       shows anyway, and no case, partner or record is named. */
    if (op === "get_partner_surface_availability") {
      const requested = String(body.portal_type ?? "");
      const surface = requested === "developer" ? "builder" : requested;
      const flagKey = WORKSPACE_PORTAL_FLAGS[surface];
      if (!flagKey) {
        return jr({ error: `portal_type must be one of: ${Object.keys(WORKSPACE_PORTAL_FLAGS).join(", ")}` }, 400);
      }
      const master = await flagEnabled(admin, "aml_partner_compliance_workspace");
      const surfaceOn = await flagEnabled(admin, flagKey);
      return jr({
        availability: {
          portal_type: surface,
          /* The PAGE exists when the master and the surface are both on. The
             document on it is a second question, so it is reported
             separately rather than folded in — a page with a withheld
             Passport is a real state and must not read as no page. */
          compliance_page: master && surfaceOn,
          passport_view: master && surfaceOn && await partnerPassportViewEnabled(admin),
        },
      });
    }

    if (PARTNER_WORKSPACE_OPS.has(op)) {
      const surfaceForFlag = String(body.portal_type ?? "");
      const masterOn = await flagEnabled(admin, "aml_partner_compliance_workspace");
      const surfaceFlagKey = WORKSPACE_PORTAL_FLAGS[surfaceForFlag];
      const surfaceOn = surfaceFlagKey ? await flagEnabled(admin, surfaceFlagKey) : false;
      if (!masterOn || !surfaceOn) {
        return jr({ error: "The partner compliance workspace is not available.", code: "workspace_disabled" }, 404);
      }
      const ctx = await resolvePartnerPortalContext(admin, req, body);
      if (!ctx.ok) return jr({ error: ctx.error, code: ctx.code }, ctx.status);
      const { surface, source, portalUserId, portalUserLabel, membership, partnerOrg } = ctx;

      /* What this partner's compliance page IS. Decided here, on the server,
         and sent to the browser — never derived client-side, because a page
         that decided its own scope could show a panel the deployment has not
         enabled. `partnerSurfaceMode` is the same module the browser uses to
         turn this answer into a panel list. */
      const surfaceMode: PartnerSurfaceMode = partnerSurfaceMode({
        passportViewEnabled: await partnerPassportViewEnabled(admin),
        fullWorkspaceEnabled: await partnerFullWorkspaceEnabled(admin),
      });

      if (op === "get_partner_compliance_workspace") {
        const linkId = String(body.partner_case_link_id ?? "");
        if (!linkId) {
          // Link directory: the organisation's own links only, safe fields only.
          const { data: links } = await admin.schema("aml").from("partner_case_links")
            .select("id, case_id, relationship_role, legal_route, state, portal_type, linked_at, ended_at, end_reason_code, purchase_file_id, legal_matter_id")
            .eq("partner_org_id", partnerOrg.id)
            .in("portal_type", SURFACE_PORTAL_TYPES[surface])
            .order("linked_at", { ascending: false }).limit(100);
          const linkRows: any[] = links ?? [];

          /* ── what each matter may be CALLED ────────────────────────────
             The list used to label every matter with the last six characters
             of its own row id — "Matter …6a5a49" — which names nothing a
             partner recognises and does not scale past a handful.

             The customer's name and the case reference are printed on page
             one of the Passport, so naming them on a matter whose Passport is
             DISCLOSABLE tells the partner nothing they cannot already read.
             Naming them on a withheld matter would be a new disclosure made
             by a list rather than by a decision — so the enrichment is
             attached per link, only where `passportDisclosure` allows it, and
             the browser is never trusted to make that call.

             Three batched reads rather than one per link: a partner with
             fifty matters must not cost a hundred and fifty queries. */
          const caseIds = [...new Set(linkRows.map((l) => String(l.case_id)).filter(Boolean))];
          if (caseIds.length > 0) {
            const [{ data: caseRows }, { data: grantRows }, { data: attRows }] = await Promise.all([
              admin.schema("aml").from("cases")
                .select("id, case_reference, subject_display_name").in("id", caseIds),
              admin.schema("aml").from("reliance_grants")
                .select("id, case_id, agreement_id, partner_org_id, granted_at, expires_at, revoked_at, revoke_reason")
                .in("case_id", caseIds),
              admin.schema("aml").from("compliance_attestations")
                .select("id, case_id, version, superseded_at, refresh_required_at")
                .in("case_id", caseIds).is("superseded_at", null),
            ]);
            /* A grant reaches this organisation by either explicit route —
               its own column, or its arrangement's. Same rule as
               `loadOrgGrantAndAttestation`; never a name match. */
            const { data: orgAgreements } = await admin.schema("aml").from("reliance_agreements")
              .select("id").eq("partner_org_id", partnerOrg.id);
            const agreementIds = new Set((orgAgreements ?? []).map((a: any) => String(a.id)));
            const caseById = new Map((caseRows ?? []).map((c: any) => [String(c.id), c]));
            const attByCase = new Map((attRows ?? []).map((a: any) => [String(a.case_id), a]));
            const grantByCase = new Map<string, any>();
            for (const g of (grantRows ?? [])) {
              const mine = (g.partner_org_id && String(g.partner_org_id) === String(partnerOrg.id))
                || agreementIds.has(String(g.agreement_id));
              if (!mine) continue;
              if (String(g.revoke_reason ?? "") === "superseded_by_reissue") continue;
              const key = String(g.case_id);
              const held = grantByCase.get(key);
              if (!held || String(g.granted_at) > String(held.granted_at)) grantByCase.set(key, g);
            }

            for (const link of linkRows) {
              const key = String(link.case_id);
              const grant = grantByCase.get(key) ?? null;
              const attestation = attByCase.get(key) ?? null;
              const decision = passportDisclosure({
                grant: grant
                  ? { revoked_at: grant.revoked_at ?? null, expires_at: grant.expires_at }
                  : null,
                attestation: attestation
                  ? {
                    superseded_at: attestation.superseded_at ?? null,
                    refresh_required_at: attestation.refresh_required_at ?? null,
                  }
                  : null,
              });
              const expiring = decision.disclosable && grant
                && new Date(grant.expires_at).getTime() - Date.now() <= 14 * 864e5;
              link.expires_at = grant?.expires_at ?? null;
              link.passport_state = decision.disclosable
                ? (expiring ? "expiring" : "available")
                : decision.code === "revoked" ? "withdrawn"
                  : decision.code === "expired" ? "expired"
                    : decision.code === "refresh_required" ? "updating"
                      : "not_shared";
              // Named ONLY where the record may be read.
              if (decision.disclosable) {
                const row = caseById.get(key);
                link.subject_label = row?.subject_display_name ?? null;
                link.case_reference = row?.case_reference ?? null;
              }
              delete link.case_id;
            }
          }

          return jr({
            organisation: { legal_name: partnerOrg.legal_name, classification_status: partnerOrg.classification_status },
            links: linkRows,
            surface_mode: surfaceMode,
          });
        }
        const link = await loadScopedPartnerLink(admin, linkId, partnerOrg.id, surface);
        if (!link) return jr({ error: "Not found" }, 404);

        const { grant, attestation: pinnedAttestation } =
          await loadOrgGrantAndAttestation(admin, link.case_id, partnerOrg.id);
        /* The SAME currency rule the emailed link uses. Without it a partner
           reading in their portal would be pinned to the version their grant
           was minted against while the link showed the current one — two
           surfaces disagreeing about one record, which is the failure this
           whole architecture exists to prevent. */
        const portalCurrency = grant
          ? await attestationForGrantRead(admin, { ...grant, compliance_attestations: pinnedAttestation })
          : null;
        const attestation = portalCurrency?.reading.serve ?? pinnedAttestation;
        let procedures: Record<string, unknown> | null = null;
        let recordAvailability: string[] = [];
        let limitations: string[] = [];
        let manifestRow: any = null;
        if (grant && attestation && (attestation.schema_version ?? 1) === 2) {
          const { data: manifest } = await admin.schema("aml").from("disclosure_manifests")
            .select("*").eq("grant_id", grant.id).maybeSingle();
          manifestRow = manifest ?? null;
          const manifestDecision = evaluateManifestForRead(manifestRow, new Date());
          if (manifestDecision.ok && !attestation.superseded_at && !attestation.refresh_required_at
            && !grant.revoked_at && new Date(grant.expires_at).getTime() > Date.now()) {
            try {
              procedures = intersectPayloadWithManifest(attestation.payload, manifestRow);
              recordAvailability = [...(manifestRow.allowed_record_classes ?? [])];
              limitations = Array.isArray(attestation.payload?.limitations)
                ? attestation.payload.limitations.map(String) : [];
            } catch (_integrity) {
              procedures = null; // tripwire: disclose nothing
            }
          }
        }

        const [{ data: determinations }, { data: requests }, { data: deliveries }, { data: tenantRow }] = await Promise.all([
          admin.schema("aml").from("independent_assessments")
            .select("status, decided_at, based_on_attestation_sha256, created_at")
            .eq("case_id", link.case_id).eq("partner_org_id", partnerOrg.id)
            .order("created_at", { ascending: false }).limit(50),
          admin.schema("aml").from("partner_records_requests")
            .select("id, requested_record_codes, status, requested_at, due_at, origin_response_message")
            .eq("partner_case_link_id", link.id)
            .order("requested_at", { ascending: false }).limit(50),
          admin.schema("aml").from("partner_evidence_deliveries")
            .select("id, record_code, safe_label, delivered_version, delivered_sha256, delivered_at, expires_at, revoked_at")
            .eq("partner_case_link_id", link.id)
            .order("delivered_at", { ascending: false }).limit(100),
          admin.schema("aml").from("tenant_settings")
            .select("display_name").eq("tenant_id", link.tenant_id ?? "default").maybeSingle(),
        ]);

        const dto = buildPartnerWorkspaceDto({
          partnerOrg: { legal_name: partnerOrg.legal_name, classification_status: partnerOrg.classification_status },
          originLabel: tenantRow?.display_name ?? "Issuing organisation",
          link: {
            id: link.id, relationship_role: link.relationship_role, legal_route: link.legal_route,
            state: link.state, portal_type: link.portal_type, linked_at: link.linked_at,
            purchase_file_id: link.purchase_file_id ?? null, legal_matter_id: link.legal_matter_id ?? null,
          },
          attestation: attestation ? {
            schema_version: attestation.schema_version ?? 1, version: attestation.version,
            payload_sha256: attestation.payload_sha256, issued_at: attestation.issued_at,
            superseded_at: attestation.superseded_at ?? null,
            refresh_required_at: attestation.refresh_required_at ?? null,
          } : null,
          grant: grant ? { revoked_at: grant.revoked_at ?? null, expires_at: grant.expires_at } : null,
          procedures, limitations, recordAvailability,
          determinations: determinations ?? [],
          requests: requests ?? [],
          deliveries: deliveries ?? [],
          now: new Date(),
        });

        /* ── the Compliance Passport, in the partner's own portal ───────
           The DOCUMENT, from `buildCasePassportView` — the same assembler,
           the same composer and the same `assertPartnerSafe` boundary that
           `redeem_attestation` serves to the emailed link. It is deliberately
           the same call rather than a portal-specific projection: the
           standing requirement is that the partner's copy and the Command
           Centre's are one record, and two implementations of "the partner's
           view" is precisely how that stops being true.

           Whether it may be shown is decided by `passportDisclosure` from the
           grant and the attestation — never by the page, never by the mode.
           A revoked grant, a lapsed one, a superseded attestation or one
           flagged for refresh all withhold it and say which, in words a
           partner may read. */
        const disclosure = passportDisclosure({
          grant: grant ? { revoked_at: grant.revoked_at ?? null, expires_at: grant.expires_at } : null,
          attestation: attestation
            ? {
              superseded_at: attestation.superseded_at ?? null,
              refresh_required_at: attestation.refresh_required_at ?? null,
            }
            : null,
        });
        const passportEnabled = surfaceMode === "passport_only"
          || await partnerPassportViewEnabled(admin);
        let passportView: unknown = null;
        if (passportEnabled && disclosure.disclosable) {
          passportView = await buildCasePassportView(admin, link.case_id, "partner");
        }

        // A workspace view that actually disclosed the record — procedure
        // content, the Passport document, or both — is an access, logged
        // exactly like a token redemption. One row per view, never two.
        if (grant && (dto.procedures || passportView)) {
          await admin.schema("aml").from("reliance_access_log").insert({
            grant_id: grant.id, case_id: link.case_id, action: "view_attestation",
            actor_label: `${partnerOrg.legal_name} — ${portalUserLabel ?? "portal user"}`,
            ip_address: ip,
            detail: {
              via: "partner_workspace", partner_case_link_id: link.id,
              attestation_version: attestation?.version ?? null,
              passport_disclosed: Boolean(passportView),
              procedures_disclosed: Boolean(dto.procedures),
            },
          });
        }
        return jr({
          workspace: dto,
          surface_mode: surfaceMode,
          passport: passportView,
          /* Said even when the document is withheld, and especially then: a
             page with nothing on it and no explanation is the failure this
             whole programme keeps finding. */
          passport_availability: passportEnabled
            ? { code: disclosure.code, message: disclosure.message }
            : { code: "not_enabled", message: "" },
          record_currency: portalCurrency
            ? {
              code: portalCurrency.reading.code,
              moved_forward: portalCurrency.reading.movedForward,
              issued_against_version: portalCurrency.reading.issuedAgainstVersion,
              message: portalCurrency.reading.message,
            }
            : null,
        });
      }

      if (op === "request_cdd_records") {
        // Phase 9 action flag: partner writes roll out one capability at a
        // time, enforced here — not by hidden buttons.
        if (!(await flagEnabled(admin, "aml_partner_records_requests_write"))) {
          return jr({ error: "Records requests are not enabled yet for this environment.", code: "records_requests_write_disabled" }, 409);
        }
        const link = await loadScopedPartnerLink(admin, String(body.partner_case_link_id ?? ""), partnerOrg.id, surface);
        if (!link) return jr({ error: "Not found" }, 404);
        if (link.state !== "active") {
          return jr({ error: "This link is no longer active.", code: "link_inactive" }, 409);
        }
        const codes: string[] = Array.isArray(body.record_codes)
          ? [...new Set<string>((body.record_codes as unknown[]).map((c) => String(c)))] : [];
        const rationale = String(body.rationale ?? "").trim();
        if (codes.length === 0) return jr({ error: "record_codes required" }, 400);
        if (rationale.length < 10) return jr({ error: "rationale must be at least 10 characters — record why the records are necessary" }, 400);

        const { data: agreementRow } = link ? await admin.schema("aml").from("reliance_agreements")
          .select("scope_record_classes").eq("partner_org_id", partnerOrg.id)
          .eq("status", "active").order("created_at", { ascending: false }).limit(1).maybeSingle() : { data: null };
        const evaluation = evaluateRecordsRequestScope(codes, agreementRow?.scope_record_classes ?? null);
        const prohibited = evaluation.filter((e) => e.scope === "prohibited");
        if (prohibited.length > 0) {
          return jr({
            error: `These record codes are not available through this channel: ${prohibited.map((p) => p.code).join(", ")}. Only the controlled record classes can be requested.`,
            code: "record_codes_prohibited",
            prohibited_codes: prohibited.map((p) => p.code),
          }, 400);
        }
        const dueAt = String(body.due_at ?? "");
        if (dueAt && !/^\d{4}-\d{2}-\d{2}$/.test(dueAt)) return jr({ error: "due_at must be YYYY-MM-DD" }, 400);

        const { grant, attestation } = await loadOrgGrantAndAttestation(admin, link.case_id, partnerOrg.id);
        const { data: request, error } = await admin.schema("aml").from("partner_records_requests").insert({
          tenant_id: link.tenant_id ?? "default",
          case_id: link.case_id,
          partner_case_link_id: link.id,
          partner_org_id: partnerOrg.id,
          grant_id: grant?.id ?? null,
          attestation_id: attestation?.id ?? null,
          requested_record_codes: codes,
          rationale: rationale.slice(0, 2000),
          scope_evaluation: evaluation,
          requested_by_source: source,
          requested_by_id: portalUserId,
          requested_by_label: portalUserLabel,
          due_at: dueAt || null,
        }).select("id, requested_record_codes, status, requested_at, due_at, origin_response_message").single();
        if (error) throw error;

        await appendCaseEvent(admin, link.case_id, "system",
          `Partner records request from ${partnerOrg.legal_name} (${codes.length} record class${codes.length === 1 ? "" : "es"})`,
          {
            partner_records_request_id: request.id, partner_case_link_id: link.id,
            requested_record_codes: codes,
            note: "Controlled records request. Nothing is delivered without an origin review decision.",
          }, null, `${partnerOrg.legal_name} — ${portalUserLabel ?? "portal user"}`);
        return jr({ request });
      }

      if (op === "list_partner_records_requests") {
        const link = await loadScopedPartnerLink(admin, String(body.partner_case_link_id ?? ""), partnerOrg.id, surface);
        if (!link) return jr({ error: "Not found" }, 404);
        const { data, error } = await admin.schema("aml").from("partner_records_requests")
          .select("id, requested_record_codes, rationale, scope_evaluation, status, requested_at, due_at, approved_record_codes, denied_record_codes, origin_response_message, reviewed_at")
          .eq("partner_case_link_id", link.id).order("requested_at", { ascending: false }).limit(100);
        if (error) throw error;
        return jr({ requests: data ?? [] });
      }

      if (op === "record_partner_determination") {
        // Phase 9 action flag (server-side, like every write gate).
        if (!(await flagEnabled(admin, "aml_partner_determinations_write"))) {
          return jr({ error: "Recording determinations is not enabled yet for this environment.", code: "determinations_write_disabled" }, 409);
        }
        const link = await loadScopedPartnerLink(admin, String(body.partner_case_link_id ?? ""), partnerOrg.id, surface);
        if (!link) return jr({ error: "Not found" }, 404);
        if (link.state !== "active") {
          return jr({ error: "This link is no longer active.", code: "link_inactive" }, 409);
        }
        const outcome = String(body.outcome ?? "");
        const decisionBasis = String(body.decision_basis ?? "").trim();
        const responsibilityAcknowledged = body.responsibility_acknowledged === true;
        const { grant, attestation } = await loadOrgGrantAndAttestation(admin, link.case_id, partnerOrg.id);
        const currentHash = attestation && !attestation.superseded_at ? attestation.payload_sha256 : null;

        const validation = validatePartnerDetermination({
          outcome, decisionBasis, responsibilityAcknowledged,
          complianceRole: membership.compliance_role ?? null,
          attestationSha256: currentHash,
        });
        if (!validation.ok) return jr({ error: validation.message, code: validation.code }, 403);

        // Append-only: a new determination row, never an update of history.
        const { data: assessment, error } = await admin.schema("aml").from("independent_assessments").insert({
          grant_id: grant?.id ?? null,
          case_id: link.case_id,
          agreement_id: grant?.agreement_id ?? null,
          partner_org_id: partnerOrg.id,
          partner_case_link_id: link.id,
          assessor_user_source: source,
          assessor_user_id: portalUserId,
          membership_id: membership.id,
          assessor_name: (portalUserLabel ?? "partner compliance officer").slice(0, 200),
          assessor_role: membership.compliance_role,
          responsibility_acknowledged: true,
          decision_basis: decisionBasis.slice(0, 4000),
          conditions: String(body.conditions ?? "").slice(0, 4000) || null,
          based_on_attestation_sha256: currentHash,
          status: outcome,
          decision_notes: decisionBasis.slice(0, 4000),
          decided_at: new Date().toISOString(),
        }).select("id, status, decided_at, based_on_attestation_sha256").single();
        if (error) throw error;

        if (grant) {
          await admin.schema("aml").from("reliance_access_log").insert({
            grant_id: grant.id, case_id: link.case_id,
            action: outcome === "records_requested" ? "records_request" : "independent_assessment",
            actor_label: `${partnerOrg.legal_name} — ${portalUserLabel ?? "portal user"}`,
            ip_address: ip,
            detail: { assessment_id: assessment.id, status: outcome, via: "partner_workspace" },
          });
        }
        // Phase 6: a fresh determination discharges the open refresh
        // obligation for this link. Idempotent — re-recording matches zero
        // open rows; with no Phase 6 data the update matches nothing.
        await admin.schema("aml").from("partner_refresh_obligations").update({
          status: "completed", completed_at: new Date().toISOString(),
          completed_by_source: source, completed_by_id: portalUserId,
          completed_against_attestation_hash: currentHash,
          determination_id: assessment.id,
        }).eq("partner_case_link_id", link.id).eq("partner_org_id", partnerOrg.id)
          .eq("status", "open").eq("required_action", "review_and_redetermine");
        await appendCaseEvent(admin, link.case_id, "system",
          `Independent assessment by ${partnerOrg.legal_name}: ${outcome.replace(/_/g, " ")}`,
          {
            assessment_id: assessment.id, partner_case_link_id: link.id,
            based_on_attestation_sha256: currentHash,
            note: "Partner determination under its own AML/CTF obligations. Does not alter this case's status or service gate.",
          }, null, partnerOrg.legal_name);
        return jr({ assessment });
      }

      if (op === "list_partner_evidence_deliveries") {
        const link = await loadScopedPartnerLink(admin, String(body.partner_case_link_id ?? ""), partnerOrg.id, surface);
        if (!link) return jr({ error: "Not found" }, 404);
        const { data, error } = await admin.schema("aml").from("partner_evidence_deliveries")
          .select("id, request_id, record_code, safe_label, delivered_version, delivered_sha256, delivered_at, expires_at, revoked_at")
          .eq("partner_case_link_id", link.id).order("delivered_at", { ascending: false }).limit(100);
        if (error) throw error;
        return jr({ deliveries: data ?? [] });
      }

      if (op === "get_partner_evidence_delivery_access") {
        // Controlled, expiring, audited access to ONE approved P3 evidence
        // object (Stage B). The partner organisation comes from the session
        // resolver above — the body cannot name an organisation or tenant.
        // Every attempt, approved or denied, lands in the access log with a
        // safe result code; the signed URL is returned once and never
        // persisted anywhere.
        const deliveryId = String(body.delivery_id ?? "");
        const retrievalReason = String(body.retrieval_reason ?? "").trim();
        const link = await loadScopedPartnerLink(admin, String(body.partner_case_link_id ?? ""), partnerOrg.id, surface);

        const logAttempt = async (
          result: "approved" | "denied" | "failed",
          detailExtra: Record<string, unknown>,
          grantId: string | null = null,
          caseId: string | null = link?.case_id ?? null,
        ) => {
          if (!caseId) return; // nothing safe to anchor the log to
          await admin.schema("aml").from("reliance_access_log").insert({
            grant_id: grantId, case_id: caseId, action: "evidence_access",
            actor_label: `${partnerOrg.legal_name} — ${portalUserLabel ?? "portal user"}`,
            ip_address: ip,
            detail: {
              via: "partner_workspace", portal: surface,
              membership_id: membership.id,
              partner_case_link_id: link?.id ?? null,
              delivery_id: deliveryId || null,
              retrieval_reason: retrievalReason ? retrievalReason.slice(0, 500) : null,
              result, ...detailExtra,
            },
          });
        };
        const deny = async (
          status: number, code: string, message: string,
          detailExtra: Record<string, unknown> = {}, grantId: string | null = null,
        ) => {
          await logAttempt("denied", { denial_code: code, ...detailExtra }, grantId);
          return jr({ error: message, code }, status);
        };

        if (!link) return jr({ error: "Not found" }, 404);
        if (!(await flagEnabled(admin, "aml_partner_evidence_delivery_write"))) {
          return deny(409, "evidence_access_disabled",
            "Evidence access is not enabled for this environment.");
        }
        if (link.state !== "active") {
          return deny(409, "link_inactive", "This link is no longer active.");
        }
        if (membership.compliance_role !== "compliance_officer") {
          return deny(403, "compliance_role_required",
            "Only your organisation's compliance role can retrieve delivered evidence.");
        }
        if (!deliveryId) return jr({ error: "delivery_id required" }, 400);
        if (retrievalReason.length < 10) {
          return jr({ error: "retrieval_reason must be at least 10 characters — record why access is necessary now", code: "retrieval_reason_required" }, 400);
        }

        // Rate limit: attempts (any outcome) by this membership in the last
        // minute, from the same access log the attempt lands in.
        const { count: recentAttempts } = await admin.schema("aml").from("reliance_access_log")
          .select("id", { count: "exact", head: true })
          .eq("action", "evidence_access")
          .eq("detail->>membership_id", membership.id)
          .gte("created_at", new Date(Date.now() - 60_000).toISOString());
        if ((recentAttempts ?? 0) >= EVIDENCE_ACCESS_RATE_LIMIT) {
          return deny(429, "rate_limited", "Too many access attempts. Try again shortly.");
        }

        // Runtime catalogue tripwire: the classification correction must be
        // present and coherent, or nothing is served (fail closed).
        const { data: catalogueRow } = await admin.schema("aml").from("record_class_catalogue")
          .select("information_classification").eq("record_code", "raw_id_document_copy").maybeSingle();
        if (!catalogueRow || catalogueRow.information_classification !== "P3") {
          return deny(503, "catalogue_inconsistent",
            "Evidence access is unavailable while the record catalogue is inconsistent. Contact the issuing organisation.");
        }

        const { data: delivery } = await admin.schema("aml").from("partner_evidence_deliveries")
          .select("*").eq("id", deliveryId)
          .eq("partner_case_link_id", link.id).eq("partner_org_id", partnerOrg.id)
          .maybeSingle();
        if (!delivery) return deny(404, "delivery_not_found", "Not found");
        if (delivery.revoked_at) {
          return deny(403, "delivery_revoked", "Access to this record has been withdrawn.",
            { record_code: delivery.record_code });
        }
        if (new Date(delivery.expires_at).getTime() <= Date.now()) {
          return deny(403, "delivery_expired", "Access to this record has expired.",
            { record_code: delivery.record_code });
        }

        // The delivery must trace to an approved request covering EXACTLY
        // this record code on this link for this organisation.
        const { data: request } = await admin.schema("aml").from("partner_records_requests")
          .select("*").eq("id", delivery.request_id).maybeSingle();
        if (!request || request.partner_org_id !== partnerOrg.id
          || request.partner_case_link_id !== link.id || request.case_id !== link.case_id) {
          return deny(403, "request_mismatch", "This record is not available.",
            { record_code: delivery.record_code });
        }
        if (!["approved", "partly_approved", "delivered"].includes(request.status)) {
          return deny(403, "request_not_approved", "This record's request is not approved.",
            { record_code: delivery.record_code });
        }
        if (!(request.approved_record_codes ?? []).includes(delivery.record_code)) {
          return deny(403, "record_code_not_approved",
            "That record code was not approved on this request.",
            { record_code: delivery.record_code });
        }

        // Delivery-class rule: the object channel serves ONLY the closed P3
        // evidence catalogue. P1/P2 metadata, P4 reviewer material, P5
        // prohibited and P6 biometric classes are refused categorically.
        const classDecision = evaluateEvidenceObjectDelivery(
          delivery.record_code, REQUESTABLE_RECORD_CLASSES);
        if (!classDecision.ok) {
          return deny(403, classDecision.code, classDecision.message,
            { record_code: delivery.record_code });
        }

        // Legal route / arrangement: reliance-route sharing requires the
        // written arrangement to still stand. (Independent-CDD and
        // information-share links rest on the origin's explicit per-request
        // approval recorded above.)
        const { grant } = await loadOrgGrantAndAttestation(admin, link.case_id, partnerOrg.id);
        if (link.legal_route === "reliance" || link.legal_route === "outsourced_cdd") {
          const agreementId = grant?.agreement_id ?? request.grant_id ?? null;
          const { data: agreement } = agreementId
            ? await admin.schema("aml").from("reliance_agreements")
              .select("status").eq("id", agreementId).maybeSingle()
            : await admin.schema("aml").from("reliance_agreements")
              .select("status").eq("partner_org_id", partnerOrg.id)
              .eq("status", "active").limit(1).maybeSingle();
          if (!agreement || agreement.status !== "active") {
            return deny(403, "arrangement_inactive",
              "The arrangement between the organisations is not active.",
              { record_code: delivery.record_code }, grant?.id ?? null);
          }
        }
        // Disclosure manifest: where one exists for the current grant, a
        // REVOKED manifest is a kill switch for every disclosure channel.
        if (grant) {
          const { data: manifest } = await admin.schema("aml").from("disclosure_manifests")
            .select("revoked_at, expires_at").eq("grant_id", grant.id).maybeSingle();
          if (manifest?.revoked_at) {
            return deny(403, "manifest_revoked", "Access to this disclosure has been revoked.",
              { record_code: delivery.record_code }, grant.id);
          }
        }

        // Disclosure hold: any active legal hold touching the case or this
        // delivery withholds release with GENERIC wording — the existence
        // and reason of a hold are never disclosed to a partner.
        const { data: holds } = await admin.schema("aml").from("legal_holds")
          .select("id").is("released_at", null)
          .or(`case_id.eq.${link.case_id},and(entity_type.eq.partner_evidence_delivery,entity_id.eq.${delivery.id})`)
          .limit(1);
        if ((holds ?? []).length > 0) {
          return deny(409, "evidence_temporarily_unavailable",
            "This record is temporarily unavailable. Contact the issuing organisation if it remains needed.",
            { record_code: delivery.record_code }, grant?.id ?? null);
        }

        // The opaque object reference. Metadata-only deliveries (no linked
        // object) answer a safe unavailable state — nothing is fabricated.
        if (!delivery.evidence_document_id) {
          return deny(409, "evidence_object_unavailable",
            "No retrievable document is attached to this delivery. The delivery record itself remains valid metadata.",
            { record_code: delivery.record_code }, grant?.id ?? null);
        }
        const { data: doc } = await admin.schema("aml").from("documents")
          .select("id, case_id, filename, mime_type, storage_path, status")
          .eq("id", delivery.evidence_document_id).maybeSingle();
        if (!doc || doc.case_id !== link.case_id || doc.status !== "accepted" || !doc.storage_path) {
          return deny(409, "evidence_object_unavailable",
            "The underlying document is not available for release.",
            { record_code: delivery.record_code, evidence_document_id: delivery.evidence_document_id },
            grant?.id ?? null);
        }

        // Authorised: mint the short-lived signed URL through the existing
        // secure mechanism. The bucket name and permanent path never leave
        // this block; the URL is never written anywhere.
        const { data: signed, error: signErr } = await admin.storage
          .from("aml-documents")
          .createSignedUrl(doc.storage_path, EVIDENCE_ACCESS_TTL_SECONDS, { download: doc.filename });
        if (signErr || !signed?.signedUrl) {
          await logAttempt("failed", {
            denial_code: "storage_resolution_failed",
            record_code: delivery.record_code,
            evidence_document_id: delivery.evidence_document_id,
          }, grant?.id ?? null);
          return jr({
            error: "The document could not be retrieved. The attempt has been recorded — contact the issuing organisation.",
            code: "evidence_access_failed",
          }, 502);
        }

        const expiresAt = new Date(Date.now() + EVIDENCE_ACCESS_TTL_SECONDS * 1000).toISOString();
        await logAttempt("approved", {
          record_code: delivery.record_code,
          request_id: delivery.request_id,
          evidence_document_id: delivery.evidence_document_id,
          signed_expiry: expiresAt,
        }, grant?.id ?? null);
        await appendCaseEvent(admin, link.case_id, "system",
          `Evidence access by ${partnerOrg.legal_name}: ${delivery.record_code}`,
          {
            delivery_id: delivery.id, partner_case_link_id: link.id,
            record_code: delivery.record_code, signed_expiry: expiresAt,
            note: "Controlled P3 evidence retrieval under the written arrangement. Short-lived access; the URL is not retained.",
          }, null, `${partnerOrg.legal_name} — ${portalUserLabel ?? "portal user"}`);

        return jr({
          access: {
            url: signed.signedUrl,
            filename: doc.filename,
            mime_type: doc.mime_type ?? null,
            expires_at: expiresAt,
            record_code: delivery.record_code,
            safe_label: delivery.safe_label,
          },
        });
      }

      if (op === "list_partner_refresh_obligations") {
        // Safe fields ONLY: the internal trigger classification
        // (internal_trigger_codes, trigger_source) never leaves the origin.
        const link = await loadScopedPartnerLink(admin, String(body.partner_case_link_id ?? ""), partnerOrg.id, surface);
        if (!link) return jr({ error: "Not found" }, 404);
        const { data, error } = await admin.schema("aml").from("partner_refresh_obligations")
          .select("id, required_action, safe_reason_code, status, due_at, created_at, completed_at")
          .eq("partner_case_link_id", link.id).eq("partner_org_id", partnerOrg.id)
          .order("created_at", { ascending: false }).limit(50);
        if (error) throw error;
        return jr({ obligations: data ?? [] });
      }

      if (op === "list_partner_notifications") {
        // Fixed safe copy written by the outbox worker; org-scoped from the
        // resolved session, never from a body identifier.
        const { data, error } = await admin.schema("aml").from("partner_notifications")
          .select("id, partner_case_link_id, event_type, safe_reason_code, title, body, created_at, read_at")
          .eq("partner_org_id", partnerOrg.id)
          .order("created_at", { ascending: false }).limit(100);
        if (error) throw error;
        return jr({ notifications: data ?? [] });
      }

      if (op === "get_partner_audit_receipt") {
        const link = await loadScopedPartnerLink(admin, String(body.partner_case_link_id ?? ""), partnerOrg.id, surface);
        if (!link) return jr({ error: "Not found" }, 404);
        const [{ data: tenantRow }, { data: attestations }, { data: grants }, { data: determinations }, { data: requests }, { data: deliveries }] = await Promise.all([
          admin.schema("aml").from("tenant_settings")
            .select("display_name").eq("tenant_id", link.tenant_id ?? "default").maybeSingle(),
          admin.schema("aml").from("compliance_attestations")
            .select("version, payload_sha256, issued_at, superseded_at")
            .eq("case_id", link.case_id).order("version", { ascending: false }).limit(20),
          admin.schema("aml").from("reliance_grants")
            .select("id, granted_at, expires_at, revoked_at")
            .eq("case_id", link.case_id).eq("partner_org_id", partnerOrg.id),
          admin.schema("aml").from("independent_assessments")
            .select("status, decided_at, based_on_attestation_sha256, decision_basis, conditions, assessor_name, assessor_role, created_at")
            .eq("case_id", link.case_id).eq("partner_org_id", partnerOrg.id)
            .order("created_at", { ascending: false }).limit(50),
          admin.schema("aml").from("partner_records_requests")
            .select("id, requested_record_codes, status, requested_at, approved_record_codes, denied_record_codes, reviewed_at")
            .eq("partner_case_link_id", link.id).order("requested_at", { ascending: false }).limit(50),
          admin.schema("aml").from("partner_evidence_deliveries")
            .select("record_code, safe_label, delivered_version, delivered_sha256, delivered_at, expires_at, revoked_at")
            .eq("partner_case_link_id", link.id).order("delivered_at", { ascending: false }).limit(100),
        ]);
        const grantIds = (grants ?? []).map((g: any) => g.id);
        let accessEntries: any[] = [];
        if (grantIds.length > 0) {
          const { data: accessLog } = await admin.schema("aml").from("reliance_access_log")
            .select("action, created_at").in("grant_id", grantIds)
            .order("created_at", { ascending: false }).limit(200);
          accessEntries = accessLog ?? [];
        }
        const receipt = {
          generated_at: new Date().toISOString(),
          origin_organisation: tenantRow?.display_name ?? "Issuing organisation",
          partner_organisation: partnerOrg.legal_name,
          link_reference: {
            id: link.id, relationship_role: link.relationship_role,
            legal_route: link.legal_route, state: link.state,
            purchase_file_id: link.purchase_file_id ?? null,
            legal_matter_id: link.legal_matter_id ?? null,
          },
          attestations: (attestations ?? []).map((a: any) => ({
            version: a.version, sha256: a.payload_sha256,
            issued_at: a.issued_at, superseded_at: a.superseded_at,
          })),
          access_events: accessEntries,
          records_requests: requests ?? [],
          evidence_deliveries: deliveries ?? [],
          determinations: determinations ?? [],
          responsibility_notice:
            "This receipt records your organisation's own reliance activity and determinations. It does not contain, and must not be read as, the issuing organisation's internal assessment.",
        };
        const violations = findRestrictedKeys(receipt);
        if (violations.length > 0) {
          return jr({ error: "Receipt blocked by an integrity check." }, 500);
        }
        return jr({ receipt });
      }
    }

    /* ── partner ops: bearer token, no staff session ─────────────────────── */

    /* ── direct partner acknowledgement: link token, no session ──────────
       A partner outside the portals reviews and accepts the SAME AML/CTF
       Compliance Passport Agreement the portals execute at sign-up. The
       token in the emailed link is the only credential, and it is matched
       by hash — nothing here reads a session, and nothing here discloses
       the customer: at this point the partner has been granted nothing. */

    if (op === "ack_view" || op === "ack_accept" || op === "ack_decline") {
      const rawToken = String(body.ack_token ?? "");
      if (rawToken.length < 20) return jr({ error: "Invalid link" }, 401);
      const tokenHash = await hashAckToken(rawToken);
      const { data: ack } = await admin.schema("aml")
        .from("direct_partner_acknowledgements")
        .select("*, partner_organisations:partner_org_id(legal_name)")
        .eq("token_hash", tokenHash).maybeSingle();
      if (!ack) return jr({ error: "Invalid link" }, 401);

      // The organisation named on the page this link opens: the same one the
      // email that carried the link names (see emailIdentity.pure.ts).
      const identity = await getEmailIdentity(admin);
      const { data: terms } = await admin.from("portal_terms_versions")
        .select("id, version, title, content_markdown, document_hash")
        .eq("id", ack.terms_version_id).maybeSingle();

      // A link that lapsed unaccepted is STAMPED as expired the moment it is
      // read, so the register stops describing it as outstanding.
      let status = String(ack.status);
      if ((status === "sent" || status === "viewed") && !isAckLive(status, ack.expires_at)) {
        await admin.schema("aml").from("direct_partner_acknowledgements")
          .update({ status: "expired", updated_at: new Date().toISOString() })
          .eq("id", ack.id);
        status = "expired";
      }

      const publicView = {
        status,
        organisation_name: (ack as any).partner_organisations?.legal_name ?? null,
        recipient_name: ack.recipient_name,
        recipient_email: ack.recipient_email,
        expires_at: ack.expires_at,
        accepted_at: ack.accepted_at,
        // The signatory's own name, so the accepted page can show them what
        // was recorded rather than only that something was.
        accepted_by_name: ack.accepted_by_name,
        declined_at: ack.declined_at,
        issuer_name: identity.organisationName,
        // The instrument itself, exactly as stored — never re-typed here.
        terms: terms
          ? { version: terms.version, title: terms.title, content_markdown: terms.content_markdown }
          : null,
        acknowledgements: PORTAL_TERMS_ACKNOWLEDGEMENTS,
      };

      if (op === "ack_view") {
        if (status === "sent") {
          await admin.schema("aml").from("direct_partner_acknowledgements")
            .update({ status: "viewed", viewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq("id", ack.id);
          publicView.status = "viewed";
        }
        return jr({ acknowledgement: publicView });
      }

      // Both write paths are terminal-once: a link that has been accepted,
      // declined, expired or superseded cannot be replayed into a second
      // outcome. This is what stops one emailed link binding twice.
      if (!isAckLive(status, ack.expires_at)) {
        return jr({
          error: status === "accepted"
            ? "This agreement has already been accepted."
            : status === "declined"
              ? "This request was declined. Ask the issuing organisation to send a new one."
              : "This link is no longer valid. Ask the issuing organisation to send a new one.",
          code: status,
        }, 409);
      }

      /* ── from here the link WRITES ────────────────────────────────────
         Everything below records something, and the person doing it has no
         account here, no session and nobody to tell. The generic 500 this
         handler otherwise returns is written for an operator who can raise a
         ticket; to a partner it is a dead end, and — worse — it is a SILENT
         one, because the only party who knows the acceptance failed is the
         party with no way to report it. So an unexpected fault on this path
         is answered in words the partner can act on AND raised in the
         Command Centre, where somebody can see it and re-issue. */
      try {
        const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
        const ua = req.headers.get("user-agent") ?? null;
        const hashOrNull = async (v: string | null) => (v ? await hashAckToken(v) : null);
        const now = new Date();

        if (op === "ack_decline") {
          await admin.schema("aml").from("direct_partner_acknowledgements").update({
            status: "declined", declined_at: now.toISOString(),
            decline_reason: String(body.reason ?? "").slice(0, 2000) || null,
            ip_hash: await hashOrNull(ip), user_agent_hash: await hashOrNull(ua),
            updated_at: now.toISOString(),
          }).eq("id", ack.id);

          await appendCaseEvent(admin, ack.case_id, "system",
            `Partner declined the AML/CTF Compliance Passport Agreement: ${(ack as any).partner_organisations?.legal_name ?? "partner"}`,
            {
              direct_acknowledgement_id: ack.id, partner_org_id: ack.partner_org_id,
              note: "No arrangement is recorded. The passport cannot be granted to this partner.",
            }, null, ack.recipient_email);
          await notifyCommandCentre(admin,
            "Partner declined the compliance agreement",
            `${(ack as any).partner_organisations?.legal_name ?? "A partner"} declined the AML/CTF Compliance Passport Agreement. No passport can be issued to them.`,
            ack.case_id);
          return jr({ acknowledgement: { ...publicView, status: "declined" } });
        }

        /* ── acceptance ────────────────────────────────────────────────── */
        // The SAME mandatory acknowledgements the portals enforce, read by the
        // SAME module. An acceptance missing any of them claims assent nobody
        // gave, so it is refused rather than stored partially.
        const check = readAcknowledgements(body as Record<string, unknown>);
        if (check.missing.length > 0) {
          return jr({ error: ACKNOWLEDGEMENTS_INCOMPLETE_ERROR, missing: check.missing }, 400);
        }
        const signerName = String(body.accepted_by_name ?? "").trim();
        if (signerName.length < 2) {
          return jr({ error: "Enter the full name of the person accepting on behalf of the organisation." }, 400);
        }

        // The arrangement IS the acceptance. `grant_access` already refuses
        // without an active arrangement whose review is current, so writing
        // this row here is what opens the passport gate — there is no second
        // rule to keep in step.
        const draft = arrangementDraftFromAcceptance(now);
        const { data: org } = await admin.schema("aml").from("partner_organisations")
          .select("id, legal_name, organisation_type, abn").eq("id", ack.partner_org_id).maybeSingle();

        /* ── who the arrangement belongs to on OUR side ───────────────────
           `reliance_agreements.created_by` is NOT NULL, and rightly so: an
           arrangement under section 37A is entered into by this business, and
           a record of one with no responsible officer is not a record of
           anything. Every other path fills it with the staff member making
           the request.

           This path has no staff member in the request at all — the actor is
           the partner, over a public link, and there is deliberately no
           session to read. Omitting the column was therefore not an oversight
           about a value that was available; it was the one path where the
           obvious source does not exist, and Postgres refused every acceptance
           with 23502 while the partner was shown "Internal error".

           The answer is the officer who ISSUED the request. They chose this
           partner, this case and this address, and sending the agreement is
           the act that commits this business to the arrangement the partner's
           acceptance completes. `sent_by` is written from an authenticated
           staff op and the column is NOT NULL, so it is always there — but
           this refuses rather than throwing if it ever is not, because a
           partner who has read and ticked everything deserves a sentence they
           can act on rather than a 500. */
        if (!ack.sent_by) {
          return jr({
            error: "This request cannot be completed because the record of who issued it is incomplete. "
              + "Nothing has been recorded. Please ask the organisation that sent this link to issue a new one.",
            code: "issuer_unknown",
          }, 409);
        }

        const { data: agreement, error: agreementError } = await admin.schema("aml")
          .from("reliance_agreements").insert({
            partner_org_name: org?.legal_name ?? ack.recipient_name,
            partner_org_type: org?.organisation_type ?? "other",
            partner_abn: org?.abn ?? null,
            partner_org_id: ack.partner_org_id,
            agreement_reference: draft.agreement_reference,
            executed_on: draft.executed_on,
            next_review_due: draft.next_review_due,
            notes: `Accepted by ${signerName} (${ack.recipient_email}) through a one-time acknowledgement link.`,
            created_by: ack.sent_by,
          }).select("*").single();
        if (agreementError) throw agreementError;

        const { error: ackError } = await admin.schema("aml")
          .from("direct_partner_acknowledgements").update({
            status: "accepted", accepted_at: now.toISOString(),
            accepted_by_name: signerName.slice(0, 200),
            acknowledgements: check.acknowledgements,
            ip_hash: await hashOrNull(ip), user_agent_hash: await hashOrNull(ua),
            agreement_id: agreement.id, updated_at: now.toISOString(),
          }).eq("id", ack.id);
        if (ackError) throw ackError;

        await appendCaseEvent(admin, ack.case_id, "system",
          `Partner acknowledged the AML/CTF Compliance Passport Agreement: ${org?.legal_name ?? "partner"}`,
          {
            direct_acknowledgement_id: ack.id, partner_org_id: ack.partner_org_id,
            agreement_id: agreement.id, terms_version_id: ack.terms_version_id,
            acknowledgements: check.acknowledgements, accepted_by_name: signerName,
            note: "Accepted through a one-time link. The arrangement is recorded and the passport may now be granted.",
          }, null, ack.recipient_email);
        await notifyCommandCentre(admin,
          "Partner acknowledged the compliance agreement",
          `${org?.legal_name ?? "A partner"} accepted the AML/CTF Compliance Passport Agreement. The passport can now be issued to them.`,
          ack.case_id);

        return jr({
          acknowledgement: {
            ...publicView, status: "accepted",
            accepted_at: now.toISOString(), accepted_by_name: signerName,
          },
        });
      } catch (e) {
        return await publicLinkFailure(
          admin, e, ack.case_id,
          op === "ack_decline" ? "A partner's decline" : "A partner's acceptance",
        );
      }
    }


    /* A partner whose link has EXPIRED asking for a replacement.
       They mint nothing: the request is recorded and lands in the Command
       Centre for a person to act on. Deliberately refused for a revoked or
       suspended grant — revocation is a safety action, and inviting its
       subject to self-renew would undo the act it was taken for. */
    if (op === "request_passport_link") {
      const resolved = await resolveGrant(admin, String(body.access_token ?? ""));
      if (!resolved) return jr({ error: "Invalid access token" }, 401);
      if (!mayRequestReplacementLink(resolved.denied)) {
        return jr({
          error: resolved.denied
            ? "This access cannot be renewed from here. Contact the issuing organisation."
            : "This access is still valid — no new link is needed.",
          code: resolved.denied ?? "not_expired",
        }, 409);
      }
      const grant = resolved.grant;
      const agreement = (grant as any).reliance_agreements;
      const { error: stampError } = await admin.schema("aml").from("reliance_grants").update({
        link_requested_at: new Date().toISOString(),
        link_request_count: (grant.link_request_count ?? 0) + 1,
      }).eq("id", grant.id);
      if (stampError) console.warn("[aml-reliance] link request stamp skipped:", stampError.message);

      await admin.schema("aml").from("reliance_access_log").insert({
        grant_id: grant.id, case_id: grant.case_id, action: "view_attestation",
        actor_label: agreement?.partner_org_name ?? "Partner", ip_address: ip,
        detail: { requested_replacement_link: true },
      });
      await appendCaseEvent(admin, grant.case_id, "system",
        `${agreement?.partner_org_name ?? "A partner"} requested a new Compliance Passport link`,
        {
          grant_id: grant.id,
          note: "Their previous link expired. Nothing was issued — re-issue from the case workspace.",
        }, null, agreement?.partner_org_name ?? null);
      await notifyCommandCentre(admin,
        "Partner asked for a new Passport link",
        `${agreement?.partner_org_name ?? "A partner"}'s Compliance Passport link expired and they have asked for a new one. Re-issue it from the case's Gate & Passport stage.`,
        grant.case_id);

      return jr({
        requested: true,
        message: "Your request has been sent to the issuing organisation. They will send a new link.",
      });
    }

    if (op === "redeem_attestation" || op === "record_independent_assessment") {
      const resolved = await resolveGrant(admin, String(body.access_token ?? ""));
      if (!resolved) return jr({ error: "Invalid access token" }, 401);
      if (resolved.denied) {
        return jr({ error: `Access ${resolved.denied.replace("_", " ")}`, code: resolved.denied }, 403);
      }
      const grant = resolved.grant;
      const agreement = (grant as any).reliance_agreements;

      /* ── one living record ────────────────────────────────────────────
         The version the holder reads is the case's CURRENT one, not the one
         their grant was minted against. `currency` carries what changed so
         the page can say it: a partner who relied on v1 and is now reading
         v2 has to be able to see that, because what they may rely on is the
         record in front of them and not the one they remember. */
      const currency = await attestationForGrantRead(admin, grant);
      const attestation = currency.reading.serve ?? (grant as any).compliance_attestations;

      if (op === "redeem_attestation") {
        if (!currency.reading.serve) {
          // Known-wrong beats known-old: a refresh in flight has nothing
          // correct to serve, and that is not the same as supersession.
          await admin.schema("aml").from("reliance_access_log").insert({
            grant_id: grant.id, case_id: grant.case_id, action: "view_attestation",
            actor_label: agreement.partner_org_name, ip_address: ip,
            detail: { denied: currency.reading.code },
          });
          return jr({
            error: currency.reading.message,
            code: currency.reading.code === "refresh_required"
              ? "attestation_refresh_required" : "attestation_unavailable",
            refresh_required: currency.reading.code === "refresh_required",
          }, 409);
        }
        const schemaVersion = attestation.schema_version ?? 1;

        // Schema-aware reading. v1 historical grants behave exactly as
        // before. v2 is manifest-controlled: superseded content is never
        // served, expiry/revocation are checked at read time, and the
        // response is BUILT by intersecting the payload with the manifest —
        // denied classes override allowed codes, server-side.
        if (schemaVersion === 2) {
          const logDenied = async (code: string) => {
            await admin.schema("aml").from("reliance_access_log").insert({
              grant_id: grant.id, case_id: grant.case_id, action: "view_attestation",
              actor_label: agreement.partner_org_name, ip_address: ip,
              detail: { attestation_version: attestation.version, denied: code },
            });
          };
          /* Supersession and refresh are settled BEFORE this branch by
             `resolveAttestationForRead`: what reaches here is the case's
             current, unflagged version or nothing at all. The belt stays on
             — a superseded document must never be served, and asserting it
             here costs nothing and would catch a future resolver that
             regressed. */
          if (attestation.superseded_at || attestation.refresh_required_at) {
            await logDenied("attestation_not_current");
            return jr({
              error: "This record is being updated. It will be available here without a new link.",
              code: "attestation_refresh_required", refresh_required: true,
            }, 409);
          }
          /* The manifest for THIS version. A grant now accumulates one per
             attestation it has been carried forward onto, so the lookup is
             scoped by both — an unscoped `.maybeSingle()` would fail outright
             on the second version. */
          const { data: manifest } = await admin.schema("aml").from("disclosure_manifests")
            .select("*").eq("grant_id", grant.id).eq("attestation_id", attestation.id)
            .order("created_at", { ascending: false }).limit(1).maybeSingle();
          const manifestDecision = evaluateManifestForRead(manifest ?? null, new Date());
          if (!manifestDecision.ok) {
            await logDenied(manifestDecision.code);
            return jr({ error: manifestDecision.message, code: manifestDecision.code }, 403);
          }
          let disclosed: Record<string, unknown>;
          try {
            disclosed = intersectPayloadWithManifest(attestation.payload, manifest);
          } catch (_integrity) {
            // The stored payload tripped the restricted-key tripwire —
            // refuse to serve anything rather than risk over-disclosure.
            await logDenied("integrity_check_failed");
            return jr({ error: "Disclosure blocked by an integrity check. Contact the issuing organisation.", code: "integrity_check_failed" }, 500);
          }
          await admin.schema("aml").from("reliance_access_log").insert({
            grant_id: grant.id, case_id: grant.case_id, action: "view_attestation",
            actor_label: agreement.partner_org_name, ip_address: ip,
            detail: {
              attestation_version: attestation.version,
              schema_version: 2,
              manifest_version: manifest.version,
            },
          });
          return jr({
            attestation: disclosed,
            // The DOCUMENT, from the same assembler and the same composer the
            // Command Centre uses. Built for the partner audience, which
            // carries the due-diligence outcomes and none of the reasoning —
            // `assertPartnerSafe` throws rather than serve a widened one.
            passport: await buildCasePassportView(admin, grant.case_id, "partner"),
            /* Where else this record lives. A link is a delivery; a portal is
               a place you go back to — and a partner who holds a portal
               account should not have to keep an email to re-read a record
               they may rely on. Offered only when the page exists AND
               somebody could sign in and reach it. */
            portal_handoff: await resolvePortalHandoff(
              admin, grant, agreement, req.headers.get("origin")),
            /* One living record: which version this is, and whether it moved
               since the access was issued. Stated rather than hidden. */
            record_currency: {
              code: currency.reading.code,
              moved_forward: currency.reading.movedForward,
              issued_against_version: currency.reading.issuedAgainstVersion,
              message: currency.reading.message,
            },
            attestation_sha256: attestation.payload_sha256,
            schema_version: 2,
            // The version this grant is bound to. The Command Centre prints
            // its credential as `AUX-<case>-V<n>`, and a partner comparing
            // their copy with the issuer's must not have to work out whether
            // two differently-spelled identifiers name one instrument.
            attestation_version: attestation.version ?? null,
            issued_at: attestation.issued_at,
            agreement: {
              partner_org_name: agreement.partner_org_name,
              agreement_reference: agreement.agreement_reference,
              scope: agreement.scope,
            },
            notice: "You may rely on the customer identification procedures described here under your written CDD arrangement (AML/CTF Act Pt 2 Div 7). Your organisation remains responsible for its own AML/CTF compliance. To make your own determination without re-approaching the customer, record an independent assessment.",
          });
        }

        await admin.schema("aml").from("reliance_access_log").insert({
          grant_id: grant.id, case_id: grant.case_id, action: "view_attestation",
          actor_label: agreement.partner_org_name, ip_address: ip,
          detail: { attestation_version: attestation.version },
        });
        return jr({
          attestation: attestation.payload,
          passport: await buildCasePassportView(admin, grant.case_id, "partner"),
          portal_handoff: await resolvePortalHandoff(
            admin, grant, agreement, req.headers.get("origin")),
          /* One living record: which version this is, and whether it moved
               since the access was issued. Stated rather than hidden. */
          record_currency: {
            code: currency.reading.code,
            moved_forward: currency.reading.movedForward,
            issued_against_version: currency.reading.issuedAgainstVersion,
            message: currency.reading.message,
          },
          attestation_sha256: attestation.payload_sha256,
          attestation_version: attestation.version ?? null,
          issued_at: attestation.issued_at,
          agreement: {
            partner_org_name: agreement.partner_org_name,
            agreement_reference: agreement.agreement_reference,
            scope: agreement.scope,
          },
          // The statutory position, restated at the point of use so a partner
          // integration cannot claim it was not told.
          notice: "You may rely on the customer identification procedures described here under your written CDD arrangement (AML/CTF Act Pt 2 Div 7). Your organisation remains responsible for its own AML/CTF compliance. To make your own determination without re-approaching the customer, record an independent assessment.",
        });
      }

      // record_independent_assessment — the partner's OWN determination,
      // made against internally-held records. Never touches our case status
      // or service gate: their compliance is theirs, ours is ours.
      const assessorName = String(body.assessor_name ?? "").trim();
      const status = String(body.status ?? "");
      const notes = String(body.decision_notes ?? "").trim();
      if (!assessorName) return jr({ error: "assessor_name is required" }, 400);
      if (!["satisfied", "not_satisfied", "records_requested"].includes(status)) {
        return jr({ error: 'status must be "satisfied", "not_satisfied" or "records_requested"' }, 400);
      }
      if (notes.length < 10) return jr({ error: "decision_notes must be at least 10 characters" }, 400);

      const { data: assessment, error } = await admin.schema("aml")
        .from("independent_assessments").insert({
          grant_id: grant.id, case_id: grant.case_id, agreement_id: agreement.id,
          assessor_name: assessorName.slice(0, 200),
          assessor_role: String(body.assessor_role ?? "").slice(0, 200) || null,
          based_on_attestation_sha256: attestation.payload_sha256,
          status, decision_notes: notes,
          decided_at: new Date().toISOString(),
        }).select("*").single();
      if (error) throw error;

      await admin.schema("aml").from("reliance_access_log").insert({
        grant_id: grant.id, case_id: grant.case_id,
        action: status === "records_requested" ? "records_request" : "independent_assessment",
        actor_label: `${agreement.partner_org_name} — ${assessorName}`, ip_address: ip,
        detail: { assessment_id: assessment.id, status },
      });
      await appendCaseEvent(admin, grant.case_id, "system",
        `Independent assessment by ${agreement.partner_org_name}: ${status.replace("_", " ")}`,
        {
          assessment_id: assessment.id, agreement_id: agreement.id,
          based_on_attestation_sha256: attestation.payload_sha256,
          // Explicit in the audit trail: this decision is the partner's.
          note: "Partner determination under its own AML/CTF obligations. Does not alter this case's status or service gate.",
        }, null, agreement.partner_org_name);

      return jr({
        assessment: { id: assessment.id, status: assessment.status, decided_at: assessment.decided_at },
        message: status === "records_requested"
          ? "Your records request has been logged. The MLRO will respond under the CDD arrangement."
          : "Your independent assessment has been recorded against the attestation you reviewed.",
      });
    }

    /* ── staff ops ───────────────────────────────────────────────────────── */

    const auth = await verifyAuth(admin, req.headers, body);
    if (auth.error || !auth.userId || auth.userId === "service_role") {
      return jr({ error: auth.error || "Authentication required" }, 401);
    }
    const userId = auth.userId;
    const userEmail = auth.username ?? null;
    const { data: hasAny } = await admin.rpc("has_any_aml_role", { _user_id: userId });
    if (!hasAny) return jr({ error: "AML role required" }, 403);
    const { data: roleRows } = await admin.schema("aml").from("role_assignments")
      .select("role").eq("user_id", userId).is("revoked_at", null);
    const roles = new Set<string>((roleRows ?? []).map((r: any) => r.role));
    const isMlro = roles.has("mlro");

    switch (op) {
      case "list_agreements": {
        const { data, error } = await admin.schema("aml").from("reliance_agreements")
          .select("*").order("created_at", { ascending: false });
        if (error) throw error;
        return jr({ agreements: data ?? [] });
      }

      case "create_agreement": {
        // Cross-entity disclosure machinery is MLRO-only, like every other
        // outward-facing restricted operation in this module.
        if (!isMlro) return jr({ error: "MLRO role required" }, 403);
        const name = String(body.partner_org_name ?? "").trim();
        const type = String(body.partner_org_type ?? "");
        const ref = String(body.agreement_reference ?? "").trim();
        const executed = String(body.executed_on ?? "");
        const review = String(body.next_review_due ?? "");
        if (!name) return jr({ error: "partner_org_name is required" }, 400);
        if (!["finance", "builder", "developer", "solicitor_conveyancer", "other"].includes(type)) {
          return jr({ error: "partner_org_type must be finance, builder, developer, solicitor_conveyancer or other" }, 400);
        }
        // No written agreement, no s 37A. Not a formality.
        if (!ref) return jr({ error: "agreement_reference is required — reliance without a written CDD arrangement is not available under Pt 2 Div 7" }, 400);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(executed)) return jr({ error: "executed_on must be YYYY-MM-DD" }, 400);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(review)) return jr({ error: "next_review_due must be YYYY-MM-DD — the arrangement must be reviewed regularly" }, 400);
        /* ── the pointer that was never written ────────────────────────
           An arrangement recorded only a free-text `partner_org_name`, so
           the written arrangement and the canonical organisation were two
           records that never pointed at each other. `grant_access` stamps
           `partner_org_id` on a grant only `if (agreement.partner_org_id)`,
           so every grant the onboarding wizard produced carried NULL — and
           the partner's own portal looks its grant up BY organisation. The
           Passport was correct, current and unreachable from the portal it
           was issued for.

           It is validated, never trusted: the organisation must exist and
           be active, and its type must match the arrangement's, because an
           arrangement that names one kind of partner and points at another
           is a mapping error that would surface as a disclosure. */
        const orgId = String(body.partner_org_id ?? "").trim();
        let boundOrgId: string | null = null;
        if (orgId) {
          const { data: org } = await admin.schema("aml").from("partner_organisations")
            .select("id, status, organisation_type, legal_name").eq("id", orgId).maybeSingle();
          if (!org) return jr({ error: "Partner organisation not found", code: "organisation_missing" }, 404);
          if (org.status !== "active") {
            return jr({ error: `Partner organisation is ${org.status}`, code: "organisation_not_active" }, 409);
          }
          if (org.organisation_type !== type) {
            return jr({
              error: `Type mismatch: the arrangement records "${type}" but ${org.legal_name} is "${org.organisation_type}". Correct whichever record is wrong.`,
              code: "organisation_type_mismatch",
            }, 409);
          }
          boundOrgId = org.id;
        }
        const insertRow: Record<string, unknown> = {
          partner_org_name: name.slice(0, 200), partner_org_type: type,
          partner_abn: String(body.partner_abn ?? "").slice(0, 20) || null,
          agreement_reference: ref.slice(0, 200), executed_on: executed,
          next_review_due: review, notes: String(body.notes ?? "").slice(0, 2000) || null,
          created_by: userId,
        };
        if (boundOrgId) insertRow.partner_org_id = boundOrgId;
        const { data, error } = await admin.schema("aml").from("reliance_agreements")
          .insert(insertRow).select("*").single();
        if (error) throw error;
        return jr({ agreement: data });
      }

      /* ── binding an existing arrangement to its organisation ──────────
         The repair for arrangements written before `create_agreement`
         accepted an organisation. It is an EXPLICIT act by the MLRO — the
         operator selected both records — and never a name match: two
         organisations may lawfully share a name, and the mapping review
         exists precisely because guessing between them is not allowed.

         Bind once, never re-point, exactly as the portal binding does. An
         arrangement that already names a different organisation is a
         mapping error to be corrected at the source, not overwritten here:
         re-pointing it silently moves every grant it has ever issued. */
      case "bind_agreement_organisation": {
        if (!isMlro) return jr({ error: "MLRO role required — partner identity is outward-facing configuration" }, 403);
        const agreementId = String(body.agreement_id ?? "");
        const orgId = String(body.partner_org_id ?? "");
        if (!agreementId || !orgId) {
          return jr({ error: "agreement_id and partner_org_id are required" }, 400);
        }
        const { data: agreementRow } = await admin.schema("aml").from("reliance_agreements")
          .select("id, partner_org_id, partner_org_type, partner_org_name")
          .eq("id", agreementId).maybeSingle();
        if (!agreementRow) return jr({ error: "Agreement not found" }, 404);
        const { data: orgRow } = await admin.schema("aml").from("partner_organisations")
          .select("id, status, organisation_type, legal_name").eq("id", orgId).maybeSingle();
        if (!orgRow) return jr({ error: "Partner organisation not found", code: "organisation_missing" }, 404);
        if (orgRow.status !== "active") {
          return jr({ error: `Partner organisation is ${orgRow.status}`, code: "organisation_not_active" }, 409);
        }
        if (orgRow.organisation_type !== agreementRow.partner_org_type) {
          return jr({
            error: `Type mismatch: the arrangement records "${agreementRow.partner_org_type}" but ${orgRow.legal_name} is "${orgRow.organisation_type}". Correct whichever record is wrong.`,
            code: "organisation_type_mismatch",
          }, 409);
        }
        if (agreementRow.partner_org_id && String(agreementRow.partner_org_id) !== orgId) {
          return jr({
            error: `${agreementRow.partner_org_name} is already bound to a different partner organisation. Re-pointing it would move every grant this arrangement has issued — correct the records rather than re-binding.`,
            code: "agreement_org_conflict",
          }, 409);
        }
        if (agreementRow.partner_org_id) {
          return jr({ agreement: agreementRow, bound: "already" });
        }
        const { data: updated, error: bindErr } = await admin.schema("aml")
          .from("reliance_agreements")
          .update({ partner_org_id: orgId, updated_at: new Date().toISOString() })
          .eq("id", agreementId).select("*").single();
        if (bindErr) throw bindErr;
        return jr({ agreement: updated, bound: "set" });
      }

      case "review_agreement": {
        if (!isMlro) return jr({ error: "MLRO role required" }, 403);
        const id = String(body.agreement_id ?? "");
        const nextDue = String(body.next_review_due ?? "");
        const outcome = String(body.outcome ?? "");
        if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(nextDue)) {
          return jr({ error: "agreement_id and next_review_due (YYYY-MM-DD) are required" }, 400);
        }
        if (!["continue", "suspend", "terminate"].includes(outcome)) {
          return jr({ error: 'outcome must be "continue", "suspend" or "terminate"' }, 400);
        }
        const { data, error } = await admin.schema("aml").from("reliance_agreements").update({
          last_reviewed_at: new Date().toISOString(), last_reviewed_by: userId,
          next_review_due: nextDue,
          status: outcome === "continue" ? "active" : outcome === "suspend" ? "suspended" : "terminated",
          updated_at: new Date().toISOString(),
        }).eq("id", id).select("*").single();
        if (error) throw error;
        return jr({ agreement: data });
      }

      case "issue_attestation": {
        if (!isMlro) return jr({ error: "MLRO role required — an attestation is an outward statement of this entity's procedures" }, 403);
        const caseId = String(body.case_id ?? "");
        if (!caseId) return jr({ error: "case_id required" }, 400);
        const { data: caseRow } = await admin.schema("aml").from("cases")
          .select("*").eq("id", caseId).maybeSingle();
        if (!caseRow) return jr({ error: "Case not found" }, 404);

        const payload = await buildAttestationPayload(admin, caseRow);
        // Refuse to attest to nothing: an attestation with zero verified
        // parties is a passport for a process that has not happened.
        if (!payload.customer_identification.parties.some((p: any) => p.verified)) {
          return jr({
            error: "No verified parties on this case — complete identity verification before issuing an attestation.",
            code: "nothing_to_attest",
          }, 409);
        }

        // Schema v2 (flag-gated): anchored to the EXPLICIT authorised gate
        // decision, hashed canonically, with a material-input hash so
        // supersession is deterministic. v1 issuance below is byte-identical
        // to the pre-Phase-3 behaviour while the flag is off.
        const v2 = await attestationV2Enabled(admin);
        let payloadToStore: Record<string, unknown> = payload as Record<string, unknown>;
        let payloadSha: string;
        const insertExtra: Record<string, unknown> = {};
        let materialHash: string | null = null;
        if (v2) {
          if (!["approved", "approved_with_controls"].includes(String(caseRow.service_gate_status ?? ""))) {
            return jr({
              error: "A v2 attestation requires an explicit approved or approved-with-controls service gate on this case.",
              code: "service_gate_not_approved",
            }, 409);
          }
          const { data: gateDecision } = await admin.schema("aml").from("service_gate_decisions")
            .select("id, status").eq("case_id", caseId)
            .in("status", ["approved", "approved_with_controls"])
            .order("created_at", { ascending: false }).limit(1).maybeSingle();
          if (!gateDecision) {
            return jr({
              error: "No recorded service-gate decision exists for this case. A v2 attestation anchors to the explicit decision record, not a status string.",
              code: "service_gate_decision_missing",
            }, 409);
          }
          payloadToStore = toV2Payload(payload as Record<string, unknown>);
          const violations = findRestrictedKeys(payloadToStore);
          if (violations.length > 0) {
            // Fail closed and loudly: never store, never serve.
            return jr({
              error: `Refusing to issue: restricted vocabulary in the assembled payload (${violations.join(", ")}).`,
              code: "restricted_keys_in_payload",
            }, 500);
          }
          materialHash = await materialInputHash({
            subject: (payload as any).subject ?? null,
            subject_type: (payload as any).subject_type ?? null,
            parties: (payload as any).customer_identification.parties,
            consents_held: (payload as any).customer_identification.consents_held,
            screening: (payload as any).screening,
            service_gate_decision_id: gateDecision.id,
            limitations: (payload as any).limitations,
            questionnaire_version: (payload as any).customer_identification.questionnaire_version ?? null,
          });
          payloadSha = await sha256HexCanonical(payloadToStore);
          insertExtra.schema_version = 2;
          insertExtra.material_input_hash = materialHash;
          insertExtra.service_gate_decision_id = gateDecision.id;
        } else {
          payloadSha = await sha256Hex(JSON.stringify(payloadToStore));
        }

        const { data: last } = await admin.schema("aml").from("compliance_attestations")
          .select("*").eq("case_id", caseId)
          .order("version", { ascending: false }).limit(1).maybeSingle();
        const version = (last?.version ?? 0) + 1;
        if (v2) {
          const requested = String(body.issued_reason_code ?? "");
          insertExtra.issued_reason_code =
            ["initial_issue", "material_change", "scheduled_refresh", "correction", "other"].includes(requested)
              ? requested
              : !last ? "initial_issue"
              : (last.material_input_hash && last.material_input_hash !== materialHash)
                ? "material_change" : "other";
        }
        if (last) {
          const supersedePatch: Record<string, unknown> = { superseded_at: new Date().toISOString() };
          if (v2) {
            supersedePatch.superseded_reason_code =
              insertExtra.issued_reason_code === "material_change" ? "material_change" : "new_version_issued";
          }
          await admin.schema("aml").from("compliance_attestations")
            .update(supersedePatch).eq("id", last.id);
        }
        const { data: att, error } = await admin.schema("aml").from("compliance_attestations")
          .insert({
            case_id: caseId, version, payload: payloadToStore, payload_sha256: payloadSha,
            issued_by: userId, issued_by_email: userEmail,
            ...insertExtra,
          }).select("*").single();
        if (error) throw error;
        if (v2 && last) {
          await admin.schema("aml").from("compliance_attestations")
            .update({ superseded_by_id: att.id }).eq("id", last.id);
        }

        /* ── carry every live authorisation onto the new version ───────
           This is what made re-issuing revoke everybody. A v2 grant reads
           through a disclosure manifest scoped to ONE attestation, and
           issuing a new version wrote the version and nothing else — so
           every partner's next read failed `manifest_missing`, or (before
           the currency resolver) `attestation_superseded`. Either way a
           routine re-issue silently cut off every partner who already held
           the Passport, and the only repair was to re-send it to each of
           them by hand.

           It is ADDITIVE and it widens nothing: one new manifest row per
           live grant, with the record classes, denied classes and expiry
           copied from the manifest it succeeds. A partner's authorisation
           after a re-issue is exactly what it was before it. A grant whose
           predecessor had no manifest gets none — absence of evidence is
           not authority, and it will fail closed on read as it should. */
        let carriedForward = 0;
        if (v2 && (att.schema_version ?? 1) === 2) {
          const { data: liveGrants } = await admin.schema("aml").from("reliance_grants")
            .select("id, revoked_at, expires_at, partner_org_id, partner_case_link_id, consent_id")
            .eq("case_id", caseId).is("revoked_at", null);
          const carry = grantsNeedingForwardManifest(liveGrants ?? [], {
            schemaVersion: att.schema_version ?? 1,
          });
          for (const g of carry) {
            const { data: previous } = await admin.schema("aml").from("disclosure_manifests")
              .select("*").eq("grant_id", g.id)
              .order("created_at", { ascending: false }).limit(1).maybeSingle();
            if (!previous) continue;
            const { data: already } = await admin.schema("aml").from("disclosure_manifests")
              .select("id").eq("grant_id", g.id).eq("attestation_id", att.id).maybeSingle();
            if (already) continue;
            const manifestScope = {
              allowed_attribute_codes: previous.allowed_attribute_codes ?? [],
              allowed_record_classes: previous.allowed_record_classes ?? [],
              denied_classes: previous.denied_classes ?? [],
            };
            const manifestSha = await sha256HexCanonical({
              ...manifestScope, attestation_id: att.id, grant_id: g.id, version: 1,
            });
            const { error: carryError } = await admin.schema("aml")
              .from("disclosure_manifests").insert({
                attestation_id: att.id, grant_id: g.id,
                partner_org_id: g.partner_org_id ?? null,
                partner_case_link_id: g.partner_case_link_id ?? null,
                purpose: previous.purpose,
                consent_id: previous.consent_id ?? g.consent_id ?? null,
                ...manifestScope,
                manifest_sha256: manifestSha,
                expires_at: previous.expires_at,
                created_by: userId,
              });
            if (carryError) {
              // Never fatal to the issue itself — the version is the
              // compliance act. A grant that could not be carried forward
              // fails CLOSED on read, which is the safe direction.
              console.warn("[aml-reliance] manifest carry-forward skipped:", carryError.message);
            } else {
              carriedForward += 1;
            }
          }
        }

        /* ── Issuing the Passport ARMS ongoing CDD ────────────────────
           Issuance is the moment the record becomes something a partner may
           rely on, and it is therefore the moment the obligation to keep it
           current begins. That obligation had to be scheduled by hand from a
           card at the foot of the last stage, and once scheduled it appeared
           on that card and nowhere else — not on the Reminders hub, which is
           the screen the Command Centre has for exactly this.

           So issuance now books the first periodic review if none is open,
           and puts it on the customer's reminders. Two rules: it never
           moves a review that already exists (a scheduled obligation is not
           re-scheduled by re-issuing a document), and it never fails the
           issuance — the attestation is the compliance act, the reminder is
           a prompt. */
        const ongoing = await armOngoingCdd(admin, {
          caseId, version, userId, userLabel: userEmail,
        });

        await appendCaseEvent(admin, caseId, "mlro_decision",
          `Compliance attestation v${version} issued (sha ${payloadSha.slice(0, 12)})`,
          {
            attestation_id: att.id, version, payload_sha256: payloadSha,
            schema_version: v2 ? 2 : 1,
            material_input_hash: materialHash,
            issued_reason_code: (insertExtra.issued_reason_code as string | undefined) ?? null,
            grants_carried_forward: carriedForward,
            next_periodic_review_at: ongoing.nextReviewAt,
            reminder_written: ongoing.reminderWritten,
          }, userId, userEmail);
        /* Reported, because it is the answer to "what did issuing just do to
           the partners who already hold this?" — which used to be "cut them
           off" and was said nowhere. */
        return jr({
          attestation: att, grants_carried_forward: carriedForward,
          ongoing_cdd: ongoing,
        });
      }

      case "list_attestations": {
        if (!body.case_id) return jr({ error: "case_id required" }, 400);
        const { data, error } = await admin.schema("aml").from("compliance_attestations")
          .select("*").eq("case_id", body.case_id).order("version", { ascending: false });
        if (error) throw error;
        return jr({ attestations: data ?? [] });
      }

      /* ── Passport partner distribution (Phase 1) ────────────────────────
         Readiness and distribution are SERVER-DERIVED. The body names a case
         and, optionally, which partners to consider; it can never assert that
         a partner is eligible, that an arrangement is current, that consent
         exists or that the Passport is issued — every one of those is read
         from the database here and decided by
         `passportDistribution.pure.ts`.

         The distribution flag gates the WRITE path and the readiness answer.
         With it off these operations report `distribution_disabled` and
         nothing else in this function changes behaviour. */

      case "get_passport_distribution_readiness":
      case "get_passport_distribution_status":
      case "share_passport_to_partner":
      case "share_passport_to_partners": {
        if (!isMlro) return jr({ error: "MLRO role required" }, 403);
        const distributionEnabled = await flagEnabled(admin, "aml_passport_partner_distribution");
        const isWrite = op === "share_passport_to_partner" || op === "share_passport_to_partners";
        if (!distributionEnabled && isWrite) {
          return jr({
            error: "Passport partner distribution is not enabled for this environment.",
            code: "distribution_disabled",
          }, 409);
        }

        const caseId = String(body.case_id ?? "");
        if (!caseId) return jr({ error: "case_id is required" }, 400);

        const { data: caseRow } = await admin.schema("aml").from("cases")
          .select("id, subject_type, status, service_gate_status")
          .eq("id", caseId).maybeSingle();
        if (!caseRow) return jr({ error: "Case not found" }, 404);
        const caseTenant = tenantForCase(String(caseRow.id));

        // Current, non-superseded attestation — the exact version distribution
        // pins to (§15). Never taken from the body.
        const { data: att } = await admin.schema("aml").from("compliance_attestations")
          .select("id, version, payload_sha256, issued_at, superseded_at, schema_version")
          .eq("case_id", caseId).is("superseded_at", null)
          .order("version", { ascending: false }).limit(1).maybeSingle();

        const { data: consentRow } = await admin.schema("aml").from("consents")
          .select("id").eq("case_id", caseId).eq("kind", "compliance_sharing")
          .order("accepted_at", { ascending: false }).limit(1).maybeSingle();

        const { count: openRefresh } = await admin.schema("aml")
          .from("partner_refresh_obligations")
          .select("id", { count: "exact", head: true })
          .eq("case_id", caseId).eq("status", "open");

        // Every field `PassportAttestationFact` declares, not only the three
        // the state machine reads first. `schema_version` in particular is not
        // decoration: `PassportStateInput.material_inputs_current` documents
        // that `null` means "not assessable (v1 attestation)", so the version
        // is how a v1 attestation is told apart from a v2 one. The query above
        // already selects both, so carrying them costs nothing.
        const attestations = att
          ? [{
            version: att.version,
            issued_at: att.issued_at,
            superseded_at: att.superseded_at,
            payload_sha256: att.payload_sha256,
            schema_version: att.schema_version,
          }]
          : [];
        const passportState = derivePassportState({
          attestations,
          service_gate_status: caseRow.service_gate_status,
          case_status: caseRow.status,
          material_inputs_current: true,
          open_refresh_obligations: openRefresh ?? 0,
        });

        // Candidate partners are the ACTIVE links on this case. A body may
        // narrow the set but never widen it — an organisation with no link
        // cannot be introduced by naming it.
        const { data: linkRows } = await admin.schema("aml").from("partner_case_links")
          .select("id, case_id, tenant_id, partner_org_id, portal_type, relationship_role, legal_route, purpose, state")
          .eq("case_id", caseId);
        const requested: string[] = Array.isArray(body.partner_org_ids)
          ? body.partner_org_ids.map((v: unknown) => String(v))
          : typeof body.partner_org_id === "string" ? [body.partner_org_id] : [];
        const orgIds = [...new Set((linkRows ?? []).map((l: any) => l.partner_org_id).filter(Boolean))]
          .filter((id) => requested.length === 0 || requested.includes(String(id)));

        const distCtx: DistributionContext = {
          caseId, caseTenantId: caseTenant,
          caseSubjectType: caseRow.subject_type ?? null,
          sharingConsentId: consentRow?.id ?? null,
          passport: {
            attestation: att ?? null,
            stateCode: passportState.code,
            openRefreshObligations: openRefresh ?? 0,
            serviceGateStatus: caseRow.service_gate_status ?? null,
          },
          distributionEnabled,
          now: new Date(),
        };

        const evaluations: Array<{ candidate: DistributionCandidate; readiness: any; agreementId: string | null }> = [];
        for (const orgId of orgIds) {
          const links = (linkRows ?? []).filter((l: any) => l.partner_org_id === orgId);
          const primary = links.find((l: any) => l.state === "active") ?? links[0];

          const { data: org } = await admin.schema("aml").from("partner_organisations")
            .select("id, legal_name, status, classification_status")
            .eq("id", orgId).maybeSingle();

          const { data: membership } = await admin.schema("aml").from("partner_portal_memberships")
            .select("id, partner_org_id, portal_type, portal_user_source, portal_user_id, status")
            .eq("partner_org_id", orgId).eq("status", "active")
            .limit(1).maybeSingle();

          const { data: agreement } = await admin.schema("aml").from("reliance_agreements")
            .select("id, status, next_review_due, eligibility_classification, scope_procedures, scope_customer_types, effective_from, expires_on, partner_org_id")
            .eq("partner_org_id", orgId).eq("status", "active")
            .order("created_at", { ascending: false }).limit(1).maybeSingle();

          const { data: assessment } = agreement
            ? await admin.schema("aml").from("arrangement_assessments")
              .select("decision, next_due_at, status")
              .eq("agreement_id", agreement.id).eq("status", "operative").maybeSingle()
            : { data: null };

          const { data: grant } = await admin.schema("aml").from("reliance_grants")
            .select("id, attestation_id, expires_at, revoked_at, refresh_required_at, partner_org_id")
            .eq("case_id", caseId).eq("partner_org_id", orgId)
            .order("granted_at", { ascending: false }).limit(1).maybeSingle();

          const { count: manifestCount } = att && grant
            ? await admin.schema("aml").from("disclosure_manifests")
              .select("id", { count: "exact", head: true })
              .eq("attestation_id", att.id).eq("grant_id", grant.id).is("revoked_at", null)
            : { count: 0 };

          const [docs, checks, owners, txns, deliveries] = await Promise.all([
            admin.schema("aml").from("documents").select("id", { count: "exact", head: true })
              .eq("case_id", caseId).eq("status", "accepted"),
            admin.schema("aml").from("verification_checks").select("id", { count: "exact", head: true })
              .eq("case_id", caseId).eq("status", "passed"),
            admin.schema("aml").from("beneficial_owners").select("id", { count: "exact", head: true })
              .eq("entity_id", caseRow.id),
            admin.schema("aml").from("transactions").select("id", { count: "exact", head: true })
              .eq("case_id", caseId),
            admin.schema("aml").from("partner_evidence_deliveries").select("id", { count: "exact", head: true })
              .eq("case_id", caseId).eq("partner_org_id", orgId).is("revoked_at", null),
          ]);

          const candidate: DistributionCandidate = {
            partnerOrgId: String(orgId),
            partnerOrgName: org?.legal_name ?? null,
            portalType: primary?.portal_type ?? null,
            legalRoute: primary?.legal_route ?? null,
            relationshipRole: primary?.relationship_role ?? null,
            purpose: primary?.purpose ?? null,
            partnerOrg: org ? { id: org.id, status: org.status } : null,
            classificationStatus: org?.classification_status ?? null,
            links: (links ?? []).map((l: any) => ({
              id: l.id, case_id: l.case_id, tenant_id: l.tenant_id,
              partner_org_id: l.partner_org_id, legal_route: l.legal_route, state: l.state,
            })),
            membership: membership ?? null,
            arrangement: agreement
              ? {
                id: agreement.id, status: agreement.status,
                next_review_due: agreement.next_review_due,
                eligibility_classification: agreement.eligibility_classification ?? "unassessed",
                scope_procedures: agreement.scope_procedures ?? null,
                scope_customer_types: agreement.scope_customer_types ?? null,
                effective_from: agreement.effective_from ?? null,
                expires_on: agreement.expires_on ?? null,
                partner_org_id: agreement.partner_org_id ?? null,
              }
              : null,
            assessment: assessment ?? null,
            existingGrant: grant ?? null,
            manifestPresent: (manifestCount ?? 0) > 0,
            evidence: {
              identityDocumentsAccepted: docs.count ?? 0,
              verificationPassed: checks.count ?? 0,
              addressEvidenceAccepted: 0,
              entityEvidenceAccepted: caseRow.subject_type === "individual" ? 0 : (docs.count ?? 0),
              ownershipRecords: owners.count ?? 0,
              authorityRecords: 0,
              transactionRecords: txns.count ?? 0,
              deliveriesToPartner: deliveries.count ?? 0,
            },
          };
          evaluations.push({
            candidate,
            readiness: evaluateDistribution(distCtx, candidate),
            agreementId: agreement?.id ?? null,
          });
        }

        if (op === "get_passport_distribution_readiness" || op === "get_passport_distribution_status") {
          return jr({
            enabled: distributionEnabled,
            passport: {
              attestation_id: att?.id ?? null,
              version: att?.version ?? null,
              payload_sha256: att?.payload_sha256 ?? null,
              issued_at: att?.issued_at ?? null,
              state: passportState,
            },
            partners: evaluations.map((e) => e.readiness),
            summary: summariseBatch(evaluations.map((e) => e.readiness)),
          });
        }

        /* Write path. Each partner is executed independently: one failure
           never reports another as shared, and an ALREADY_CURRENT partner is
           a no-op rather than a duplicate grant (§10). */
        const outcomes: any[] = [];
        for (const e of evaluations) {
          const r = e.readiness;
          if (!r.ready) {
            outcomes.push({
              partner_org_id: r.partner.org_id, state: r.state, shared: false,
              blockers: r.blockers, messages: r.messages,
            });
            continue;
          }
          if (r.state === "ALREADY_CURRENT") {
            outcomes.push({
              partner_org_id: r.partner.org_id, state: "ALREADY_CURRENT", shared: false,
              grant_id: e.candidate.existingGrant?.id ?? null,
              note: "This partner already holds the current Passport version.",
            });
            continue;
          }
          if (!e.agreementId) {
            // Non-reliance routes carry no arrangement, so there is no grant
            // to create here. Phase 2 wires their portal surface; Phase 1
            // reports the readiness rather than inventing a record.
            outcomes.push({
              partner_org_id: r.partner.org_id, state: r.state, shared: false,
              code: "route_not_grant_backed",
              note: `The ${r.legal_route} route does not create a reliance grant. Readiness is recorded; portal delivery follows in Phase 2.`,
            });
            continue;
          }

          const { data: existing } = await admin.schema("aml").from("reliance_grants")
            .select("id").eq("case_id", caseId)
            .eq("partner_org_id", r.partner.org_id)
            .eq("attestation_id", att!.id).is("revoked_at", null)
            .limit(1).maybeSingle();
          if (existing) {
            outcomes.push({
              partner_org_id: r.partner.org_id, state: "ALREADY_CURRENT",
              shared: false, grant_id: existing.id,
            });
            continue;
          }

          const rawToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
          const grantInsert: Record<string, unknown> = {
            case_id: caseId, agreement_id: e.agreementId, attestation_id: att!.id,
            consent_id: distCtx.sharingConsentId,
            access_token_hash: await sha256Hex(rawToken),
            granted_by: userId,
            expires_at: new Date(Date.now() + GRANT_TTL_DAYS * 864e5).toISOString(),
            partner_org_id: r.partner.org_id,
          };
          const activeLink = e.candidate.links.find((l) => l.state === "active");
          if (activeLink) grantInsert.partner_case_link_id = activeLink.id;
          const { data: grant, error: grantError } = await admin.schema("aml")
            .from("reliance_grants").insert(grantInsert).select("*").single();
          if (grantError) {
            outcomes.push({
              partner_org_id: r.partner.org_id, state: "ACTION_REQUIRED", shared: false,
              code: "grant_write_failed",
            });
            continue;
          }

          if ((att!.schema_version ?? 1) === 2 && await attestationV2Enabled(admin)) {
            const manifestScope = {
              allowed_attribute_codes: DEFAULT_ALLOWED_ATTRIBUTE_CODES,
              allowed_record_classes: [] as string[],
              denied_classes: DEFAULT_DENIED_CLASSES,
            };
            const manifestSha = await sha256HexCanonical({
              ...manifestScope, attestation_id: att!.id, grant_id: grant.id, version: 1,
            });
            await admin.schema("aml").from("disclosure_manifests").insert({
              attestation_id: att!.id, grant_id: grant.id,
              partner_org_id: r.partner.org_id,
              partner_case_link_id: activeLink?.id ?? null,
              purpose: "passport_distribution",
              consent_id: distCtx.sharingConsentId,
              ...manifestScope,
              manifest_sha256: manifestSha,
              expires_at: grant.expires_at,
              created_by: userId,
            });
          }

          await appendCaseEvent(admin, caseId, "mlro_decision",
            `Passport v${att!.version} distributed to ${r.partner.org_name} (${r.legal_route})`,
            {
              grant_id: grant.id, agreement_id: e.agreementId,
              attestation_id: att!.id, attestation_version: att!.version,
              partner_org_id: r.partner.org_id, legal_route: r.legal_route,
              evidence_classes: r.evidence.available,
            }, userId, userEmail);

          outcomes.push({
            partner_org_id: r.partner.org_id, state: "CURRENTLY_SHARED", shared: true,
            grant_id: grant.id, attestation_version: att!.version,
            access_token: rawToken,
            evidence_classes: r.evidence.available,
          });
        }

        return jr({
          passport: { attestation_id: att?.id ?? null, version: att?.version ?? null },
          outcomes,
          summary: {
            total: outcomes.length,
            shared: outcomes.filter((o) => o.shared).length,
            already_current: outcomes.filter((o) => o.state === "ALREADY_CURRENT").length,
            blocked: outcomes.filter((o) => !o.shared && o.state !== "ALREADY_CURRENT").length,
          },
        });
      }

      case "get_passport_view": {
        // Command Centre Passport projection — read-only, any AML role.
        // The view is BUILT server-side by the shared pure assembler
        // (`_shared/aml/passport/passportView.pure.ts`): one credential
        // format, one state derivation, one stamp vocabulary for every
        // portal. Nothing here writes; nothing here re-decides.
        if (!(await flagEnabled(admin, "aml_passport_command_view"))) {
          return jr({ error: "The Compliance Passport view is not available.", code: "passport_disabled" }, 404);
        }
        const caseId = String(body.case_id ?? "");
        if (!caseId) return jr({ error: "case_id required" }, 400);
        const view = await buildCasePassportView(admin, caseId, "command");
        if (!view) return jr({ error: "Case not found" }, 404);
        return jr({ passport: view });
      }

      case "grant_access": {
        if (!isMlro) return jr({ error: "MLRO role required" }, 403);
        // Phase 9 action flag: NEW grants only — revoke_grant below is
        // deliberately ungated (revocation is a safety action).
        if (!(await flagEnabled(admin, "aml_partner_grants_write"))) {
          return jr({ error: "Issuing new reliance grants is not enabled yet for this environment.", code: "grants_write_disabled" }, 409);
        }
        const caseId = String(body.case_id ?? "");
        const agreementId = String(body.agreement_id ?? "");
        if (!caseId || !agreementId) return jr({ error: "case_id and agreement_id are required" }, 400);

        const { data: agreement } = await admin.schema("aml").from("reliance_agreements")
          .select("*").eq("id", agreementId).maybeSingle();
        if (!agreement) return jr({ error: "Agreement not found" }, 404);
        if (agreement.status !== "active") {
          return jr({ error: `Agreement is ${agreement.status}` }, 409);
        }
        // s 37A: regular review is a condition of the arrangement, so an
        // overdue review suspends NEW grants until the review is done.
        if (new Date(agreement.next_review_due).getTime() < Date.now()) {
          return jr({
            error: "This CDD arrangement's review is overdue. Review the agreement before issuing new grants.",
            code: "review_overdue",
          }, 409);
        }

        // Client consent is a precondition of disclosure (APP 6), and the
        // grant row carries the consent id so the authority is traceable.
        const { data: consent } = await admin.schema("aml").from("consents")
          .select("id, version, accepted_at").eq("case_id", caseId)
          .eq("kind", "compliance_sharing")
          .order("accepted_at", { ascending: false }).limit(1).maybeSingle();
        if (!consent) {
          return jr({
            error: "The client has not consented to sharing their completed verification. Ask them to accept the sharing consent in their portal — or the partner must approach them directly.",
            code: "sharing_consent_missing",
          }, 403);
        }

        const { data: att } = await admin.schema("aml").from("compliance_attestations")
          .select("*").eq("case_id", caseId).is("superseded_at", null)
          .order("version", { ascending: false }).limit(1).maybeSingle();
        if (!att) return jr({ error: "Issue an attestation for this case first", code: "no_attestation" }, 409);

        // Canonical partner identity (Phase 1). The organisation is resolved
        // from the STORED agreement row — a body-supplied partner_org_id is
        // never authority. With the aml_partner_identity flag on, a new
        // grant additionally requires an ACTIVE partner-case link with
        // legal_route = reliance for this exact case; with the flag off the
        // legacy behaviour is unchanged and the canonical ids are stamped
        // only when they already exist.
        const enforced = await partnerIdentityEnforced(admin);
        let partnerOrgRow: any = null;
        let linkForGrant: any = null;
        if (agreement.partner_org_id) {
          const { data: orgRow } = await admin.schema("aml").from("partner_organisations")
            .select("id, status").eq("id", agreement.partner_org_id).maybeSingle();
          partnerOrgRow = orgRow ?? null;
        }
        {
          const { data: caseRowForLink } = await admin.schema("aml").from("cases")
            .select("id, subject_type").eq("id", caseId).maybeSingle();
          const caseTenant = tenantForCase(String(caseId));
          let linkRows: any[] = [];
          if (partnerOrgRow) {
            const { data: links } = await admin.schema("aml").from("partner_case_links")
              .select("id, case_id, tenant_id, partner_org_id, legal_route, state")
              .eq("case_id", caseId).eq("partner_org_id", partnerOrgRow.id);
            linkRows = links ?? [];
          }
          const decision = evaluatePartnerLinkForReliance({
            caseId, caseTenantId: caseTenant,
            partnerOrg: partnerOrgRow, links: linkRows,
          });
          if (decision.ok) {
            linkForGrant = decision.link;
          } else if (enforced) {
            // Partner-safe code, operator-facing message. Independent CDD
            // remains available — this blocks the reliance grant only.
            return jr({ error: decision.message, code: decision.code }, 409);
          }

          // Arrangement governance (Phase 2, flag-gated). The full guard —
          // eligibility recorded, arrangement in force and in scope,
          // operative + current + suitable assessment — sits on top of the
          // legacy checks above; those stay for byte-identical behaviour
          // while the flag is off.
          if (await arrangementGovernanceEnforced(admin)) {
            const { data: assessRow } = await admin.schema("aml")
              .from("arrangement_assessments")
              .select("decision, next_due_at, status")
              .eq("agreement_id", agreementId).eq("status", "operative")
              .maybeSingle();
            const arrangementDecision = evaluateArrangementForReliance({
              arrangement: {
                id: agreement.id, status: agreement.status,
                next_review_due: agreement.next_review_due,
                eligibility_classification: agreement.eligibility_classification ?? "unassessed",
                scope_procedures: agreement.scope_procedures ?? null,
                scope_customer_types: agreement.scope_customer_types ?? null,
                effective_from: agreement.effective_from ?? null,
                expires_on: agreement.expires_on ?? null,
                partner_org_id: agreement.partner_org_id ?? null,
              },
              assessment: assessRow ?? null,
              requiredProcedure: "customer_identification",
              caseCustomerType: caseRowForLink?.subject_type ?? null,
              now: new Date(),
            });
            if (!arrangementDecision.ok) {
              return jr({ error: arrangementDecision.message, code: arrangementDecision.code }, 409);
            }
          }
        }

        // Raw token is shown exactly once; only its hash persists.
        const rawToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
        const grantInsert: Record<string, unknown> = {
          case_id: caseId, agreement_id: agreementId, attestation_id: att.id,
          consent_id: consent.id,
          access_token_hash: await sha256Hex(rawToken),
          granted_by: userId,
          expires_at: new Date(Date.now() + GRANT_TTL_DAYS * 864e5).toISOString(),
        };
        if (agreement.partner_org_id) grantInsert.partner_org_id = agreement.partner_org_id;
        if (linkForGrant) grantInsert.partner_case_link_id = linkForGrant.id;
        let grant: any; let grantError: any;
        {
          const first = await admin.schema("aml").from("reliance_grants")
            .insert(grantInsert).select("*").single();
          grant = first.data; grantError = first.error;
          // Contract-first deploy tolerance (same convention as aml-cases):
          // if the Phase 1 columns are not applied in this environment yet,
          // retry without them rather than failing the legacy path.
          if (grantError && /partner_org_id|partner_case_link_id/.test(String(grantError.message ?? ""))) {
            delete grantInsert.partner_org_id;
            delete grantInsert.partner_case_link_id;
            const retry = await admin.schema("aml").from("reliance_grants")
              .insert(grantInsert).select("*").single();
            grant = retry.data; grantError = retry.error;
          }
        }
        if (grantError) throw grantError;

        // v2 grants are manifest-controlled: the manifest is WHAT this
        // partner is authorised to receive from this attestation version.
        // If this insert fails the grant remains unusable for v2 reading
        // (manifest_missing at redemption) — fail closed, never open.
        if ((att.schema_version ?? 1) === 2 && await attestationV2Enabled(admin)) {
          const manifestScope = {
            allowed_attribute_codes: DEFAULT_ALLOWED_ATTRIBUTE_CODES,
            allowed_record_classes: (agreement.scope_record_classes ?? []) as string[],
            denied_classes: DEFAULT_DENIED_CLASSES,
          };
          const manifestSha = await sha256HexCanonical({
            ...manifestScope, attestation_id: att.id, grant_id: grant.id, version: 1,
          });
          const { error: manifestError } = await admin.schema("aml").from("disclosure_manifests").insert({
            attestation_id: att.id, grant_id: grant.id,
            partner_org_id: agreement.partner_org_id ?? null,
            partner_case_link_id: linkForGrant?.id ?? null,
            purpose: linkForGrant
              ? "reliance_disclosure_under_partner_case_link"
              : "reliance_disclosure",
            consent_id: consent.id,
            ...manifestScope,
            manifest_sha256: manifestSha,
            expires_at: grant.expires_at,
            created_by: userId,
          });
          if (manifestError) throw manifestError;
        }

        /* ── delivery, and re-issue ──────────────────────────────────────
           The token is shown once and stored only as a hash, so a link can
           never be re-read: RE-ISSUING therefore means minting a new grant
           and revoking the old one. Doing that here rather than in a second
           operation is deliberate — every precondition above (arrangement
           active and its review current, client sharing consent, an issued
           attestation, the partner link) is re-run by construction, so a
           re-issue can never be a weaker act than the original grant. */
        const deliverTo = String(body.deliver_to ?? "").trim().toLowerCase();
        const passportLink = passportLinkFor(rawToken);
        let linkEmailSent = false;
        let linkEmailError: string | null = null;
        if (deliverTo) {
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(deliverTo)) {
            return jr({ error: "deliver_to must be a valid email address" }, 400);
          }
          const resendApiKey = Deno.env.get("RESEND_API_KEY");
          // Sent as this deployment: its name, its sender, replies to its own contact.
          const identity = await getEmailIdentity(admin);
          const orgName = identity.organisationName;
          const orgHtml = escapeHtml(orgName);
          const orgLabel = String(agreement.partner_org_name).replace(/[<>]/g, "");
          const expiryLabel = new Date(grant.expires_at).toLocaleDateString("en-AU");
          /* The second route to the same record, in the email itself — this
             is the moment a recipient decides whether to keep the message.
             `resolvePortalHandoff` returns `available: false` unless the page
             exists and somebody could sign in and reach it, so this never
             advertises a door that refuses. The absolute URL is built from
             the same origin the Passport link uses rather than the request's,
             because the request here is the Command Centre's. */
          const handoff = await resolvePortalHandoff(
            admin, grant, agreement, passportLink.replace(/\/passport\/.*$/, ""));
          const subject = `${orgName} — Compliance Passport access for ${orgLabel}`;
          const textBody = [
            `Your organisation has been given access to a Compliance Passport issued by ${orgName}.`,
            "",
            "No account or password is needed — open the link below:",
            passportLink,
            "",
            ...(handoff.available && handoff.url
              ? [
                `You can also read it in your ${handoff.label}, on your AML/CTF Compliance page, whenever you need it:`,
                handoff.url,
                "",
              ]
              : []),
            `This access expires on ${expiryLabel}. If the link stops working, you can request a new one from the page itself.`,
            "",
            `— ${orgName}`,
          ].join("\n");
          const htmlBody = `
            <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;">
              <p style="color:#475569;font-size:15px;line-height:1.6;">
                <strong>${orgLabel}</strong> has been given access to a Compliance Passport issued by
                ${orgHtml}. It describes the customer identification procedures that were
                performed — it does not contain their risk assessment.
              </p>
              <p style="color:#475569;font-size:15px;line-height:1.6;">
                No account or password is needed.
              </p>
              <p style="margin:24px 0;">
                <a href="${passportLink}" style="background:#1d4ed8;color:#ffffff;padding:12px 20px;border-radius:6px;text-decoration:none;font-size:15px;">
                  Open the Compliance Passport
                </a>
              </p>
              ${handoff.available && handoff.url ? `
              <p style="color:#475569;font-size:14px;line-height:1.6;border-top:1px solid #e2e8f0;padding-top:16px;">
                You also hold a <strong>${handoff.label}</strong> account. The same Passport is on your
                <strong>AML/CTF Compliance</strong> page there — signed in, with no link to keep.
                <br/>
                <a href="${handoff.url}" style="color:#1d4ed8;">Open it in your ${handoff.label}</a>
              </p>` : ""}
              <p style="color:#64748b;font-size:13px;line-height:1.6;">
                This access expires on ${expiryLabel}. If the link stops working, you can request a new
                one from the page itself.
              </p>
              <p style="color:#64748b;font-size:13px;">— ${orgHtml}</p>
            </div>`;
          if (resendApiKey) {
            try {
              const emailRes = await meteredFetch("https://api.resend.com/emails", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${resendApiKey}` },
                body: JSON.stringify({
                  ...resendAddressing(identity, "Admin"), to: [deliverTo],
                  subject, html: htmlBody, text: textBody,
                  tags: [{ name: "category", value: "aml_passport_link" }],
                }),
              });
              const raw = await emailRes.text();
              if (emailRes.ok) linkEmailSent = true;
              else linkEmailError = `Resend ${emailRes.status}: ${raw}`;
            } catch (e: any) {
              linkEmailError = e?.message ?? String(e);
            }
          } else {
            linkEmailError = "RESEND_API_KEY not configured";
          }
          if (linkEmailError) console.error("[aml-reliance] passport link email failed:", linkEmailError);

          // Recorded AFTER the grant exists, and tolerantly: an environment
          // without the delivery columns still issues the grant.
          const { error: stampError } = await admin.schema("aml").from("reliance_grants")
            .update({ delivered_to_email: deliverTo, delivered_at: new Date().toISOString() })
            .eq("id", grant.id);
          if (stampError) console.warn("[aml-reliance] delivery stamp skipped:", stampError.message);
        }

        // Re-issue: the predecessor is revoked only once the replacement
        // exists, so a failure above leaves the partner with working access
        // rather than none.
        const reissueOf = String(body.reissue_of ?? "");
        if (reissueOf) {
          const { error: revokeError } = await admin.schema("aml").from("reliance_grants").update({
            revoked_at: new Date().toISOString(), revoked_by: userId,
            revoke_reason: "superseded_by_reissue",
            reissued_by_grant_id: grant.id,
          }).eq("id", reissueOf).is("revoked_at", null);
          if (revokeError) console.warn("[aml-reliance] reissue revoke skipped:", revokeError.message);
        }

        await appendCaseEvent(admin, caseId, "mlro_decision",
          `Reliance access ${reissueOf ? "re-issued" : "granted"} to ${agreement.partner_org_name} (attestation v${att.version})`,
          {
            grant_id: grant.id, agreement_id: agreementId,
            consent_id: consent.id, expires_at: grant.expires_at,
            partner_org_id: agreement.partner_org_id ?? null,
            partner_case_link_id: linkForGrant?.id ?? null,
            reissue_of: reissueOf || null,
            delivered_to_email: deliverTo || null,
            link_email_sent: deliverTo ? linkEmailSent : null,
          }, userId, userEmail);

        return jr({
          grant: { id: grant.id, expires_at: grant.expires_at, attestation_version: att.version },
          access_token: rawToken,
          // The link is returned whether or not the email sent, so a mail
          // outage never costs the operator the one-time credential.
          passport_link: passportLink,
          delivered_to: deliverTo || null,
          link_email_sent: deliverTo ? linkEmailSent : null,
          link_email_error: linkEmailError,
          note: "This token is shown once. Deliver it to the partner organisation through their portal channel.",
        });
      }

      case "revoke_grant": {
        if (!isMlro) return jr({ error: "MLRO role required" }, 403);
        const reason = String(body.reason ?? "").trim();
        if (!body.grant_id) return jr({ error: "grant_id required" }, 400);
        if (reason.length < 10) return jr({ error: "reason must be at least 10 characters" }, 400);
        const { data, error } = await admin.schema("aml").from("reliance_grants").update({
          revoked_at: new Date().toISOString(), revoked_by: userId, revoke_reason: reason,
        }).eq("id", body.grant_id).is("revoked_at", null).select("*").single();
        if (error) throw error;
        await appendCaseEvent(admin, data.case_id, "mlro_decision",
          "Reliance access revoked", { grant_id: data.id, reason }, userId, userEmail);
        return jr({ grant: data });
      }

      case "list_grants": {
        if (!body.case_id) return jr({ error: "case_id required" }, 400);
        const { data, error } = await admin.schema("aml").from("reliance_grants")
          .select("id, agreement_id, attestation_id, granted_at, expires_at, revoked_at, revoke_reason, delivered_to_email, delivered_at, link_requested_at, link_request_count, reissued_by_grant_id, reliance_agreements:agreement_id(partner_org_name, partner_org_type, status)")
          .eq("case_id", body.case_id).order("granted_at", { ascending: false });
        if (error) throw error;
        // The token hash never leaves the database, even to staff.
        return jr({ grants: data ?? [] });
      }

      case "list_assessments": {
        if (!body.case_id) return jr({ error: "case_id required" }, 400);
        const { data, error } = await admin.schema("aml").from("independent_assessments")
          .select("*, reliance_agreements:agreement_id(partner_org_name)")
          .eq("case_id", body.case_id).order("created_at", { ascending: false });
        if (error) throw error;
        return jr({ assessments: data ?? [] });
      }

      case "list_access_log": {
        if (!body.case_id) return jr({ error: "case_id required" }, 400);
        const { data, error } = await admin.schema("aml").from("reliance_access_log")
          .select("*").eq("case_id", body.case_id)
          .order("created_at", { ascending: false }).limit(200);
        if (error) throw error;
        return jr({ access_log: data ?? [] });
      }

      /* ── canonical partner identity (Phase 1) ─────────────────────────── */
      // The organisation record is CONFIGURATION plus evidence, never a
      // legal conclusion: classification values are controlled strings an
      // authorised human records, and a reliance-capable classification is
      // impossible without recorded evidence (DB CHECK). A link is the
      // access root — creating one grants no passport and no reliance by
      // itself; grant_access still requires agreement, review currency,
      // consent and a current attestation on top.

      case "list_partner_organisations": {
        const { data, error } = await admin.schema("aml").from("partner_organisations")
          .select("*").order("legal_name", { ascending: true });
        if (error) throw error;
        return jr({ partner_organisations: data ?? [] });
      }

      case "upsert_partner_organisation": {
        if (!isMlro) return jr({ error: "MLRO role required — partner identity is outward-facing configuration" }, 403);
        const legalName = String(body.legal_name ?? "").trim();
        const orgType = String(body.organisation_type ?? "");
        if (!legalName && !body.partner_org_id) return jr({ error: "legal_name is required" }, 400);
        if (!body.partner_org_id && !PARTNER_ORG_TYPES.includes(orgType)) {
          return jr({ error: `organisation_type must be one of: ${PARTNER_ORG_TYPES.join(", ")}` }, 400);
        }
        const patch: Record<string, unknown> = {};
        if (legalName) patch.legal_name = legalName.slice(0, 300);
        if (orgType && PARTNER_ORG_TYPES.includes(orgType)) patch.organisation_type = orgType;
        if (body.trading_name !== undefined) patch.trading_name = String(body.trading_name ?? "").slice(0, 300) || null;
        if (body.abn !== undefined) patch.abn = String(body.abn ?? "").replace(/\s+/g, "").slice(0, 20) || null;
        if (body.registration_reference !== undefined) patch.registration_reference = String(body.registration_reference ?? "").slice(0, 200) || null;
        if (body.registration_country !== undefined) patch.registration_country = String(body.registration_country ?? "AU").slice(0, 2).toUpperCase();
        if (Array.isArray(body.portal_types)) {
          const portals = body.portal_types.map(String).filter((p: string) => PARTNER_PORTAL_TYPES.includes(p));
          patch.portal_types = portals;
        }
        if (body.status !== undefined) {
          const status = String(body.status);
          if (!["active", "suspended", "ended"].includes(status)) return jr({ error: "status must be active, suspended or ended" }, 400);
          patch.status = status;
        }
        // Classification fields change ONLY through classify_partner_organisation.
        if (body.partner_org_id) {
          const { data, error } = await admin.schema("aml").from("partner_organisations")
            .update(patch).eq("id", String(body.partner_org_id)).select("*").single();
          if (error) throw error;
          return jr({ partner_organisation: data });
        }
        const { data, error } = await admin.schema("aml").from("partner_organisations")
          .insert({ ...patch, created_by: userId }).select("*").single();
        if (error) {
          if (String(error.code) === "23505") {
            return jr({ error: "An active partner organisation with this ABN already exists. Use it, or end it first — organisations are never merged automatically.", code: "duplicate_abn" }, 409);
          }
          throw error;
        }
        return jr({ partner_organisation: data });
      }

      case "classify_partner_organisation": {
        if (!isMlro) return jr({ error: "MLRO role required — classification is a recorded legal determination, not a system inference" }, 403);
        const orgId = String(body.partner_org_id ?? "");
        const classification = String(body.reporting_entity_classification ?? "");
        if (!orgId) return jr({ error: "partner_org_id required" }, 400);
        if (!PARTNER_CLASSIFICATIONS.includes(classification)) {
          return jr({ error: `reporting_entity_classification must be one of: ${PARTNER_CLASSIFICATIONS.join(", ")}` }, 400);
        }
        const evidence = String(body.classification_evidence_reference ?? "").trim();
        const relianceCapable = ["eligible_relying_reporting_entity", "eligible_foreign_equivalent"].includes(classification);
        if (relianceCapable && !evidence) {
          return jr({
            error: "A reliance-capable classification requires a classification evidence reference (the legal advice / determination it rests on).",
            code: "classification_evidence_required",
          }, 400);
        }
        const { data, error } = await admin.schema("aml").from("partner_organisations").update({
          reporting_entity_classification: classification,
          classification_status: classification === "unclassified" ? "unclassified" : "classified",
          classification_evidence_reference: evidence || null,
          classification_notes: String(body.classification_notes ?? "").slice(0, 2000) || null,
          regulator_reference: String(body.regulator_reference ?? "").slice(0, 200) || null,
          verified_by: userId,
          verified_at: new Date().toISOString(),
        }).eq("id", orgId).select("*").single();
        if (error) throw error;
        return jr({ partner_organisation: data });
      }

      case "list_partner_memberships": {
        if (!body.partner_org_id) return jr({ error: "partner_org_id required" }, 400);
        const { data, error } = await admin.schema("aml").from("partner_portal_memberships")
          .select("*").eq("partner_org_id", String(body.partner_org_id))
          .order("created_at", { ascending: false });
        if (error) throw error;
        return jr({ memberships: data ?? [] });
      }

      case "upsert_partner_membership": {
        if (!isMlro) return jr({ error: "MLRO role required" }, 403);
        const orgId = String(body.partner_org_id ?? "");
        const source = String(body.portal_user_source ?? "");
        const portalUserId = String(body.portal_user_id ?? "");
        const portalType = String(body.portal_type ?? "");
        if (!orgId || !source || !portalUserId) {
          return jr({ error: "partner_org_id, portal_user_source and portal_user_id are required" }, 400);
        }
        if (!PARTNER_USER_SOURCES.includes(source)) {
          return jr({ error: `portal_user_source must be one of: ${PARTNER_USER_SOURCES.join(", ")}` }, 400);
        }
        if (source === "builder_portal_users") {
          // Recognised, and moved: the builder portal's identity tables left
          // with the portal (network extraction Phase 7). Refusing here, by
          // name, beats the "portal user not found" a read against a dropped
          // table would fabricate.
          return jr({
            error: "The builder portal moved to the Builders Network — there is no builder portal identity here to enrol. Builder partners read the Compliance Passport through the emailed link.",
            code: "portal_moved",
          }, 410);
        }
        if (!PARTNER_PORTAL_TYPES.includes(portalType)) {
          return jr({ error: `portal_type must be one of: ${PARTNER_PORTAL_TYPES.join(", ")}` }, 400);
        }
        // The portal user must actually exist in its home table — a
        // membership maps a REAL portal identity, it never mints one.
        const { data: portalUser } = await admin.from(source)
          .select("id").eq("id", portalUserId).maybeSingle();
        if (!portalUser) return jr({ error: "Portal user not found in the named portal user table" }, 404);
        const { data: org } = await admin.schema("aml").from("partner_organisations")
          .select("id, status").eq("id", orgId).maybeSingle();
        if (!org) return jr({ error: "Partner organisation not found" }, 404);
        const status = String(body.status ?? "invited");
        if (!["invited", "active", "suspended", "ended"].includes(status)) {
          return jr({ error: "status must be invited, active, suspended or ended" }, 400);
        }
        const row = {
          partner_org_id: orgId, portal_type: portalType,
          portal_user_source: source, portal_user_id: portalUserId,
          organisation_role: String(body.organisation_role ?? "member").slice(0, 100),
          compliance_role: ["compliance_officer", "operations", "read_only"].includes(String(body.compliance_role)) ? String(body.compliance_role) : null,
          status,
          activated_at: status === "active" ? new Date().toISOString() : null,
          suspended_at: status === "suspended" ? new Date().toISOString() : null,
          ended_at: status === "ended" ? new Date().toISOString() : null,
          created_by: userId,
        };
        const { data, error } = await admin.schema("aml").from("partner_portal_memberships")
          .upsert(row, { onConflict: "portal_user_source,portal_user_id,partner_org_id" })
          .select("*").single();
        if (error) throw error;
        return jr({ membership: data });
      }

      /* ── enrolling a portal identity for the compliance surface ───────
         The act that did not exist, and whose absence made every in-portal
         Passport unreachable however correct everything else was.

         `resolvePartnerPortalContext` walks portal session → membership →
         canonical organisation, and cross-checks that organisation against
         the portal organisation on the session. In production BOTH ends of
         that walk were empty: `partner_portal_memberships` had zero rows,
         and `builder_organisation_id` / `solicitor_firm_id` /
         `finance_agent_contact_id` were null on every canonical
         organisation — declared by the Phase 1 migration and written by
         nothing, ever. A partner with a working portal login, an active
         arrangement, a live grant and a linked matter still met
         `membership_missing`, and if that were fixed alone, then
         `partner_org_unmapped`.

         They are one act, so this is one operation: a membership without the
         organisation binding is still a locked door, and binding without a
         membership is a mapping nobody can use. Doing them separately is two
         ways to half-succeed.

         Two rules it enforces.

         **A portal identity is never minted here.** The user must already
         exist in its own portal's table — this maps a real identity, it does
         not create one, and authentication stays with the portal.

         **A cross-reference is bound once and never silently re-pointed.**
         If the canonical organisation already names a different portal
         organisation, this refuses and says so. Re-pointing it would move
         which partner an existing portal account speaks for, retroactively,
         across every matter they hold — the same "never guess between
         organisations" rule the session resolver applies at read time. */
      case "enrol_partner_portal_access": {
        if (!isMlro) return jr({ error: "MLRO role required — partner portal enrolment is outward-facing configuration" }, 403);
        const orgId = String(body.partner_org_id ?? "");
        const source = String(body.portal_user_source ?? "");
        const portalUserId = String(body.portal_user_id ?? "");
        const portalType = String(body.portal_type ?? "");
        if (!orgId || !source || !portalUserId || !portalType) {
          return jr({ error: "partner_org_id, portal_user_source, portal_user_id and portal_type are required" }, 400);
        }
        if (!PARTNER_USER_SOURCES.includes(source)) {
          return jr({ error: `portal_user_source must be one of: ${PARTNER_USER_SOURCES.join(", ")}` }, 400);
        }
        if (source === "builder_portal_users") {
          // Recognised, and moved — same refusal the workspace session
          // resolver gives, so enrolment cannot fabricate "portal user not
          // found" from a read against a table Phase 7 dropped.
          return jr({
            error: "The builder portal moved to the Builders Network — there is no builder portal identity here to enrol. Builder partners read the Compliance Passport through the emailed link.",
            code: "portal_moved",
          }, 410);
        }
        if (!PARTNER_PORTAL_TYPES.includes(portalType)) {
          return jr({ error: `portal_type must be one of: ${PARTNER_PORTAL_TYPES.join(", ")}` }, 400);
        }
        const { data: org } = await admin.schema("aml").from("partner_organisations")
          .select("id, status, legal_name, builder_organisation_id, solicitor_firm_id, finance_agent_contact_id")
          .eq("id", orgId).maybeSingle();
        if (!org) return jr({ error: "Partner organisation not found" }, 404);
        if (org.status !== "active") {
          return jr({ error: `Partner organisation is ${org.status}`, code: "organisation_not_active" }, 409);
        }

        // The portal user must exist in its home table.
        const { data: portalUser } = await admin.from(source)
          .select("*").eq("id", portalUserId).maybeSingle();
        if (!portalUser) {
          return jr({ error: "Portal user not found in the named portal user table", code: "portal_user_missing" }, 404);
        }

        /* The portal ORGANISATION this identity belongs to, read from the
           portal's own records rather than taken from the request — a body
           that could name the organisation could bind a partner to one they
           do not belong to. */
        let column: "builder_organisation_id" | "solicitor_firm_id" | "finance_agent_contact_id";
        let portalOrgId: string | null = null;
        let portalOrgLabel = "portal organisation";
        if (source === "builder_portal_users") {
          column = "builder_organisation_id";
          portalOrgLabel = "builder organisation";
          const explicit = String(body.builder_organisation_id ?? "");
          /* The SAME membership table `resolveBuilderSession` walks, filtered
             the same way — an organisation this account cannot actually
             select is not one it may be bound to. */
          const { data: memberships } = await admin.from("builder_organisation_memberships")
            .select("organisation_id, is_primary, status, revoked_at")
            .eq("builder_user_id", portalUserId)
            .eq("status", "active").is("revoked_at", null);
          const rows: any[] = memberships ?? [];
          if (explicit) {
            // An explicitly named organisation is accepted only when the
            // user is actually a member of it.
            portalOrgId = rows.some((r) => String(r.organisation_id) === explicit) ? explicit : null;
            if (!portalOrgId) {
              return jr({ error: "That builder organisation is not one this portal user belongs to", code: "portal_org_not_member" }, 409);
            }
          } else {
            const primary = rows.find((r) => r.is_primary) ?? rows[0];
            portalOrgId = primary ? String(primary.organisation_id) : null;
          }
        } else if (source === "solicitor_portal_users") {
          column = "solicitor_firm_id";
          portalOrgLabel = "legal practice";
          portalOrgId = portalUser.firm_id ? String(portalUser.firm_id) : null;
        } else {
          column = "finance_agent_contact_id";
          portalOrgLabel = "finance contact";
          portalOrgId = portalUser.finance_contact_id ? String(portalUser.finance_contact_id) : null;
        }
        if (!portalOrgId) {
          return jr({
            error: `This portal account is not attached to a ${portalOrgLabel} yet, so there is nothing to map it to. Complete their portal setup first.`,
            code: "portal_org_unresolved",
          }, 409);
        }

        // Bind once; never re-point.
        const existingBinding = org[column] ? String(org[column]) : null;
        let bound: "already" | "set" = "already";
        if (existingBinding && existingBinding !== portalOrgId) {
          return jr({
            error: `${org.legal_name} is already mapped to a different ${portalOrgLabel}. Re-pointing it would change which partner every existing portal account speaks for — correct the records rather than re-mapping.`,
            code: "portal_org_conflict",
          }, 409);
        }
        if (!existingBinding) {
          const { error: bindError } = await admin.schema("aml").from("partner_organisations")
            .update({ [column]: portalOrgId }).eq("id", orgId);
          if (bindError) throw bindError;
          bound = "set";
        }

        /* The membership. `active` immediately: the MLRO has already decided
           this partner may rely, and an `invited` state nothing ever
           promotes is one more way to be silently locked out of a page. */
        const status = ["invited", "active", "suspended", "ended"].includes(String(body.status ?? ""))
          ? String(body.status)
          : "active";
        const nowIso = new Date().toISOString();
        const { data: membershipRow, error: membershipError } = await admin.schema("aml")
          .from("partner_portal_memberships")
          .upsert({
            partner_org_id: orgId, portal_type: portalType,
            portal_user_source: source, portal_user_id: portalUserId,
            organisation_role: String(body.organisation_role ?? "member").slice(0, 100),
            compliance_role: ["compliance_officer", "operations", "read_only"].includes(String(body.compliance_role))
              ? String(body.compliance_role) : null,
            status,
            activated_at: status === "active" ? nowIso : null,
            created_by: userId,
          }, { onConflict: "portal_user_source,portal_user_id,partner_org_id" })
          .select("*").single();
        if (membershipError) throw membershipError;

        /* The organisation must also DECLARE the portal, or the directory
           read filters this partner's own matters out of their own page. */
        const declared: string[] = Array.isArray((org as any).portal_types) ? (org as any).portal_types : [];
        if (!declared.includes(portalType)) {
          const { error: portalTypesError } = await admin.schema("aml").from("partner_organisations")
            .update({ portal_types: [...declared, portalType] }).eq("id", orgId);
          if (portalTypesError) console.warn("[aml-reliance] portal_types not updated:", portalTypesError.message);
        }

        return jr({
          membership: membershipRow,
          organisation_binding: { column, portal_organisation_id: portalOrgId, bound },
          /* Enrolment is necessary and not sufficient: the surface flags
             decide whether the page exists at all, and this reports that
             plainly rather than implying the partner can now see something. */
          surface_enabled: (await flagEnabled(admin, "aml_partner_compliance_workspace"))
            && (await flagEnabled(admin, WORKSPACE_PORTAL_FLAGS[portalType === "developer" ? "builder" : portalType] ?? "")),
          passport_view_enabled: await partnerPassportViewEnabled(admin),
        });
      }

      case "list_partner_acknowledgements": {
        if (!body.case_id) return jr({ error: "case_id required" }, 400);
        const { data, error } = await admin.schema("aml")
          .from("direct_partner_acknowledgements")
          .select("id, case_id, partner_org_id, recipient_name, recipient_email, status, sent_at, resend_count, viewed_at, accepted_at, declined_at, decline_reason, expires_at, agreement_id, accepted_by_name, partner_organisations:partner_org_id(legal_name)")
          .eq("case_id", String(body.case_id))
          .order("sent_at", { ascending: false });
        if (error) throw error;
        // The token hash never leaves the server, and there is no column here
        // that could reconstruct the link.
        return jr({ acknowledgements: data ?? [] });
      }

      case "send_partner_acknowledgement": {
        // Sending an agreement for execution is an outward-facing act, like
        // every other instrument in this module.
        if (!isMlro) {
          return jr({ error: "MLRO role required — this sends an agreement for execution" }, 403);
        }
        const caseId = String(body.case_id ?? "");
        const orgId = String(body.partner_org_id ?? "");
        const recipientName = String(body.recipient_name ?? "").trim();
        const recipientEmail = String(body.recipient_email ?? "").trim().toLowerCase();
        if (!caseId || !orgId) return jr({ error: "case_id and partner_org_id are required" }, 400);
        if (!recipientName) return jr({ error: "recipient_name is required" }, 400);
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipientEmail)) {
          return jr({ error: "A valid recipient email is required — the link is the only way in" }, 400);
        }

        const { data: org } = await admin.schema("aml").from("partner_organisations")
          .select("id, legal_name, status").eq("id", orgId).maybeSingle();
        if (!org) return jr({ error: "Partner organisation not found" }, 404);
        if (org.status !== "active") return jr({ error: `Partner organisation is ${org.status}` }, 409);

        // Already acknowledged: say so rather than sending a second
        // instrument for an arrangement that already exists.
        const { data: existingAccepted } = await admin.schema("aml")
          .from("direct_partner_acknowledgements")
          .select("id, accepted_at, agreement_id").eq("case_id", caseId)
          .eq("partner_org_id", orgId).eq("status", "accepted").maybeSingle();
        if (existingAccepted && body.force !== true) {
          return jr({
            error: "This partner has already acknowledged the agreement for this case.",
            code: "already_accepted",
            agreement_id: existingAccepted.agreement_id,
          }, 409);
        }

        const { data: terms } = await admin.from("portal_terms_versions")
          .select("id, version, title")
          .eq("portal", "direct").is("retired_at", null)
          .order("effective_at", { ascending: false }).limit(1).maybeSingle();
        if (!terms) {
          return jr({
            error: "No direct-channel agreement version is published, so there is nothing to send.",
            code: "terms_unavailable",
          }, 503);
        }

        // Re-issuing SUPERSEDES the live request rather than editing it: the
        // previous link stops working, and the register keeps both rows so
        // the history shows every address it was sent to.
        const { data: live } = await admin.schema("aml")
          .from("direct_partner_acknowledgements")
          .select("id, status, resend_count").eq("case_id", caseId).eq("partner_org_id", orgId)
          .in("status", ["sent", "viewed"]).maybeSingle();

        /* ── ORDER MATTERS, and it is the opposite of the grant's ─────────
           `dpa_one_live_request` permits ONE live (sent|viewed) request per
           partner per case — that guard is what stops two links both being
           accepted into two arrangements. So the predecessor must be stood
           down BEFORE the replacement is written, or the insert collides
           with the index and the re-send fails outright. It did: every
           re-send against a live request answered 23505, surfaced as
           "Internal error".

           The grant re-issue mints first and revokes second, deliberately,
           because nothing there forbids two live grants and a failure must
           not leave a partner with no access. Here the invariant forbids
           the overlap, so the order flips — and the rollback below restores
           the predecessor if the replacement cannot be written, which keeps
           the same promise by a different route. */
        if (live) {
          const { error: standDownError } = await admin.schema("aml")
            .from("direct_partner_acknowledgements")
            .update({ status: "superseded", updated_at: new Date().toISOString() })
            .eq("id", live.id);
          if (standDownError) throw standDownError;
        }

        const token = mintAckToken();
        const expiresAt = new Date(Date.now() + ACK_LINK_TTL_DAYS * 864e5).toISOString();
        const { data: created, error: insertError } = await admin.schema("aml")
          .from("direct_partner_acknowledgements").insert({
            tenant_id: tenantForCase(caseId),
            case_id: caseId, partner_org_id: orgId,
            terms_version_id: terms.id,
            recipient_name: recipientName.slice(0, 200),
            recipient_email: recipientEmail,
            token_hash: await hashAckToken(token),
            expires_at: expiresAt,
            sent_by: userId,
            resend_count: live ? (live.resend_count ?? 0) + 1 : 0,
          }).select("*").single();

        if (insertError) {
          // The replacement could not be written, so the partner keeps the
          // link they already have rather than being left with none.
          if (live) {
            await admin.schema("aml").from("direct_partner_acknowledgements")
              .update({ status: live.status, updated_at: new Date().toISOString() })
              .eq("id", live.id);
          }
          // A collision here means another live request appeared between the
          // stand-down and the insert. That is a conflict, not a fault, and
          // it must not read as an internal error.
          if (String((insertError as any).code) === "23505") {
            return jr({
              error: "Another request for this partner was created at the same moment. Reload the case and send again.",
              code: "concurrent_request",
            }, 409);
          }
          throw insertError;
        }

        if (live) {
          // The chain is stamped once the successor exists, so a superseded
          // row always names what replaced it.
          await admin.schema("aml").from("direct_partner_acknowledgements").update({
            superseded_by_id: created.id, updated_at: new Date().toISOString(),
          }).eq("id", live.id);
        }

        const link = acknowledgementLinkFor(token);
        // Sent as this deployment: its name, its sender, replies to its own contact.
        const identity = await getEmailIdentity(admin);
        const orgName = identity.organisationName;
        const orgHtml = escapeHtml(orgName);
        const resendApiKey = Deno.env.get("RESEND_API_KEY");
        const safeName = recipientName.replace(/[<>]/g, "");
        const subject = `${orgName} — AML/CTF Compliance Passport Agreement for your acceptance`;
        const textBody = [
          `Hi ${safeName},`,
          "",
          `${orgName} has asked you to review and accept the AML/CTF Compliance Passport Agreement on behalf of ${org.legal_name}.`,
          "",
          "You do not need an account. Open the link below to read the agreement and accept it:",
          link,
          "",
          `This link expires in ${ACK_LINK_TTL_DAYS} days. If it lapses, ask us to send a new one.`,
          "",
          `— ${orgName}`,
        ].join("\n");
        const htmlBody = `
          <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;">
            <p style="color:#0f172a;font-size:16px;">Hi ${safeName},</p>
            <p style="color:#475569;font-size:15px;line-height:1.6;">
              ${orgHtml} has asked you to review and accept the
              <strong>AML/CTF Compliance Passport Agreement</strong> on behalf of
              <strong>${String(org.legal_name).replace(/[<>]/g, "")}</strong>.
            </p>
            <p style="color:#475569;font-size:15px;line-height:1.6;">
              You do not need an account or a password — the link below opens the agreement itself.
            </p>
            <p style="margin:24px 0;">
              <a href="${link}" style="background:#1d4ed8;color:#ffffff;padding:12px 20px;border-radius:6px;text-decoration:none;font-size:15px;">
                Review &amp; accept the agreement
              </a>
            </p>
            <p style="color:#64748b;font-size:13px;line-height:1.6;">
              This link expires in ${ACK_LINK_TTL_DAYS} days. If it lapses, ask us to send a new one.
            </p>
            <p style="color:#64748b;font-size:13px;">— ${orgHtml}</p>
          </div>`;

        let emailSent = false;
        let emailError: string | null = null;
        if (resendApiKey) {
          try {
            const emailRes = await meteredFetch("https://api.resend.com/emails", {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${resendApiKey}` },
              body: JSON.stringify({
                ...resendAddressing(identity, "Admin"), to: [recipientEmail],
                subject, html: htmlBody, text: textBody,
                tags: [{ name: "category", value: "aml_partner_acknowledgement" }],
              }),
            });
            const raw = await emailRes.text();
            if (emailRes.ok) emailSent = true;
            else emailError = `Resend ${emailRes.status}: ${raw}`;
          } catch (e: any) {
            emailError = e?.message ?? String(e);
          }
        } else {
          emailError = "RESEND_API_KEY not configured";
        }
        if (emailError) console.error("[aml-reliance] acknowledgement email failed:", emailError);

        await appendCaseEvent(admin, caseId, "system",
          `AML/CTF Compliance Passport Agreement sent to ${org.legal_name} for acceptance`,
          {
            direct_acknowledgement_id: created.id, partner_org_id: orgId,
            recipient_email: recipientEmail, expires_at: expiresAt,
            superseded_id: live?.id ?? null, email_sent: emailSent,
            note: "No arrangement is recorded until the partner accepts.",
          }, userId, userEmail);

        // The link is returned so an operator can deliver it by hand when
        // the mail provider is down — the request is real either way, and a
        // failed send must not look like a failed request.
        return jr({
          acknowledgement: {
            id: created.id, status: created.status, expires_at: created.expires_at,
            recipient_email: recipientEmail, resend_count: created.resend_count,
          },
          email_sent: emailSent,
          email_error: emailError,
          link,
        });
      }

      case "list_partner_case_links": {
        if (!body.case_id) return jr({ error: "case_id required" }, 400);
        const { data, error } = await admin.schema("aml").from("partner_case_links")
          .select("*, partner_organisations:partner_org_id(legal_name, organisation_type, classification_status, status)")
          .eq("case_id", String(body.case_id)).order("linked_at", { ascending: false });
        if (error) throw error;
        return jr({ links: data ?? [] });
      }

      case "link_partner_to_case": {
        // Creating an access root is a reviewer/MLRO act. It grants nothing
        // by itself: no passport, no reliance, no data flow.
        if (!(isMlro || roles.has("reviewer"))) {
          return jr({ error: "Reviewer or MLRO role required" }, 403);
        }
        const caseId = String(body.case_id ?? "");
        const orgId = String(body.partner_org_id ?? "");
        const portalType = String(body.portal_type ?? "");
        const relationshipRole = String(body.relationship_role ?? "").trim();
        const legalRoute = String(body.legal_route ?? "");
        const purpose = String(body.purpose ?? "").trim();
        if (!caseId || !orgId) return jr({ error: "case_id and partner_org_id are required" }, 400);
        if (![...PARTNER_PORTAL_TYPES, "other"].includes(portalType)) {
          return jr({ error: `portal_type must be one of: ${[...PARTNER_PORTAL_TYPES, "other"].join(", ")}` }, 400);
        }
        if (!relationshipRole) return jr({ error: "relationship_role is required" }, 400);
        if (!(LEGAL_ROUTES as readonly string[]).includes(legalRoute)) {
          return jr({ error: `legal_route must be one of: ${LEGAL_ROUTES.join(", ")} — the route is a recorded legal decision, never inferred from portal type` }, 400);
        }
        if (purpose.length < 10) return jr({ error: "purpose must be at least 10 characters — record why this organisation may access this matter" }, 400);

        const { data: caseRow } = await admin.schema("aml").from("cases")
          .select("id, client_id, purchase_file_id").eq("id", caseId).maybeSingle();
        if (!caseRow) return jr({ error: "Case not found" }, 404);
        const { data: org } = await admin.schema("aml").from("partner_organisations")
          .select("id, status, legal_name").eq("id", orgId).maybeSingle();
        if (!org) return jr({ error: "Partner organisation not found" }, 404);
        if (org.status !== "active") return jr({ error: `Partner organisation is ${org.status}` }, 409);

        // Deal-context validation: a supplied purchase file must belong to
        // this case's client and not contradict the case's own binding
        // (same rule as aml-finance import_from_purchase_file).
        const pfId = body.purchase_file_id ? String(body.purchase_file_id) : null;
        if (pfId) {
          const { data: pf } = await admin.from("purchase_files")
            .select("id, client_id").eq("id", pfId).maybeSingle();
          if (!pf) return jr({ error: "Purchase file not found" }, 404);
          if (caseRow.client_id && String(pf.client_id) !== String(caseRow.client_id)) {
            return jr({ error: "Purchase file is not linked to this AML case client" }, 403);
          }
          if (caseRow.purchase_file_id && String(caseRow.purchase_file_id) !== pfId) {
            return jr({ error: "Purchase file is not the one linked to this AML case" }, 403);
          }
        }
        const matterId = body.legal_matter_id ? String(body.legal_matter_id) : null;
        if (matterId) {
          const { data: matter } = await admin.from("legal_matters")
            .select("id").eq("id", matterId).maybeSingle();
          if (!matter) return jr({ error: "Legal matter not found" }, 404);
        }

        const { data: link, error } = await admin.schema("aml").from("partner_case_links").insert({
          tenant_id: tenantForCase(String(caseRow.id)),
          case_id: caseId,
          client_id: caseRow.client_id ?? null,
          purchase_file_id: pfId,
          legal_matter_id: matterId,
          partner_org_id: orgId,
          portal_type: portalType,
          relationship_role: relationshipRole.slice(0, 100),
          legal_route: legalRoute,
          purpose: purpose.slice(0, 2000),
          linked_by: userId,
        }).select("*").single();
        if (error) {
          if (String(error.code) === "23505") {
            return jr({ error: "An active link already exists for this partner and role on this case." , code: "link_exists" }, 409);
          }
          throw error;
        }
        await appendCaseEvent(admin, caseId, "system",
          `Partner linked: ${org.legal_name} (${legalRoute.replace(/_/g, " ")})`,
          {
            partner_case_link_id: link.id, partner_org_id: orgId,
            portal_type: portalType, relationship_role: relationshipRole,
            legal_route: legalRoute,
            note: "A link is an access root only. No passport, reliance or disclosure follows from it by itself.",
          }, userId, userEmail);
        return jr({ link });
      }

      case "set_partner_case_link_state": {
        if (!(isMlro || roles.has("reviewer"))) {
          return jr({ error: "Reviewer or MLRO role required" }, 403);
        }
        const linkId = String(body.link_id ?? "");
        const state = String(body.state ?? "");
        if (!linkId) return jr({ error: "link_id required" }, 400);
        if (!["suspended", "ended", "active"].includes(state)) {
          return jr({ error: "state must be active, suspended or ended" }, 400);
        }
        const endReason = body.end_reason_code ? String(body.end_reason_code) : null;
        if (state === "ended" && !["completed", "withdrawn", "superseded", "client_declined", "other"].includes(endReason ?? "")) {
          return jr({ error: "end_reason_code must be completed, withdrawn, superseded, client_declined or other" }, 400);
        }
        const patch: Record<string, unknown> = { state };
        const nowIso = new Date().toISOString();
        if (state === "suspended") { patch.suspended_at = nowIso; patch.suspended_by = userId; }
        if (state === "ended") { patch.ended_at = nowIso; patch.ended_by = userId; patch.end_reason_code = endReason; }
        if (state === "active") { patch.suspended_at = null; patch.suspended_by = null; }
        const { data: link, error } = await admin.schema("aml").from("partner_case_links")
          .update(patch).eq("id", linkId).select("*").single();
        if (error) throw error;
        await appendCaseEvent(admin, link.case_id, "system",
          `Partner link ${state}${endReason ? ` (${endReason})` : ""}`,
          { partner_case_link_id: link.id, partner_org_id: link.partner_org_id, state, end_reason_code: endReason },
          userId, userEmail);
        return jr({ link });
      }

      case "list_partner_mappings": {
        const { data, error } = await admin.schema("aml").from("partner_org_name_mappings")
          .select("*").order("created_at", { ascending: true });
        if (error) throw error;
        return jr({ mappings: data ?? [] });
      }

      case "resolve_partner_mapping": {
        if (!isMlro) return jr({ error: "MLRO role required — mapping a legal identity is a reviewed decision" }, 403);
        const mappingId = String(body.mapping_id ?? "");
        const action = String(body.action ?? "map");
        if (!mappingId) return jr({ error: "mapping_id required" }, 400);
        const { data: mapping } = await admin.schema("aml").from("partner_org_name_mappings")
          .select("*").eq("id", mappingId).maybeSingle();
        if (!mapping) return jr({ error: "Mapping not found" }, 404);
        if (mapping.status !== "pending") return jr({ error: `Mapping already ${mapping.status}` }, 409);

        if (action === "reject") {
          const { data, error } = await admin.schema("aml").from("partner_org_name_mappings").update({
            status: "rejected", mapped_by: userId, mapped_at: new Date().toISOString(),
            note: String(body.note ?? "").slice(0, 2000) || null,
          }).eq("id", mappingId).select("*").single();
          if (error) throw error;
          return jr({ mapping: data });
        }

        const orgId = String(body.partner_org_id ?? "");
        if (!orgId) return jr({ error: "partner_org_id required to map" }, 400);
        const { data: org } = await admin.schema("aml").from("partner_organisations")
          .select("id, status, organisation_type, legal_name").eq("id", orgId).maybeSingle();
        if (!org) return jr({ error: "Partner organisation not found" }, 404);
        // Exact review, no fuzzy tolerance: an org-type mismatch between the
        // historical agreement and the canonical record must be resolved by
        // fixing one of them, not waved through.
        if (org.organisation_type !== mapping.original_org_type) {
          return jr({
            error: `Type mismatch: agreement recorded "${mapping.original_org_type}" but the organisation is "${org.organisation_type}". Correct whichever record is wrong, then map.`,
            code: "mapping_type_mismatch",
          }, 409);
        }
        const nowIso = new Date().toISOString();
        const { data: updatedMapping, error: mapErr } = await admin.schema("aml")
          .from("partner_org_name_mappings").update({
            status: "mapped", proposed_partner_org_id: orgId,
            mapped_by: userId, mapped_at: nowIso,
            note: String(body.note ?? "").slice(0, 2000) || null,
          }).eq("id", mappingId).select("*").single();
        if (mapErr) throw mapErr;
        const { error: agErr } = await admin.schema("aml").from("reliance_agreements")
          .update({ partner_org_id: orgId, updated_at: nowIso })
          .eq("id", mapping.agreement_id);
        if (agErr) throw agErr;
        return jr({ mapping: updatedMapping });
      }

      /* ── arrangement governance (Phase 2) ─────────────────────────────── */
      // The assessment history is immutable: re-assessment supersedes, it
      // never edits. Eligibility is a recorded determination with its own
      // preconditions — the system never concludes that an organisation is
      // legally eligible, it records that an authorised human did.

      case "list_arrangement_assessments": {
        if (!body.agreement_id) return jr({ error: "agreement_id required" }, 400);
        const { data, error } = await admin.schema("aml").from("arrangement_assessments")
          .select("*").eq("agreement_id", String(body.agreement_id))
          .order("assessment_version", { ascending: false });
        if (error) throw error;
        return jr({ assessments: data ?? [] });
      }

      case "record_arrangement_assessment": {
        if (!isMlro) return jr({ error: "MLRO role required — an arrangement assessment is a governance decision" }, 403);
        const agreementId = String(body.agreement_id ?? "");
        const trigger = String(body.trigger ?? "");
        const decision = String(body.decision ?? "");
        const nextDue = String(body.next_due_at ?? "");
        const findings = String(body.findings ?? "").trim();
        if (!agreementId) return jr({ error: "agreement_id required" }, 400);
        if (!["initial", "scheduled", "significant_change", "incident", "other"].includes(trigger)) {
          return jr({ error: "trigger must be initial, scheduled, significant_change, incident or other" }, 400);
        }
        if (!["suitable", "suitable_with_conditions", "unsuitable"].includes(decision)) {
          return jr({ error: "decision must be suitable, suitable_with_conditions or unsuitable" }, 400);
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDue)) {
          return jr({ error: "next_due_at must be YYYY-MM-DD — regular review is a statutory condition" }, 400);
        }
        if (decision !== "suitable" && findings.length < 10) {
          return jr({ error: "findings of at least 10 characters are required when the decision is not plainly suitable" }, 400);
        }
        const { data: agreement } = await admin.schema("aml").from("reliance_agreements")
          .select("id").eq("id", agreementId).maybeSingle();
        if (!agreement) return jr({ error: "Agreement not found" }, 404);

        const { data: last } = await admin.schema("aml").from("arrangement_assessments")
          .select("id, assessment_version, status").eq("agreement_id", agreementId)
          .order("assessment_version", { ascending: false }).limit(1).maybeSingle();
        const version = (last?.assessment_version ?? 0) + 1;
        // Supersede-then-insert keeps the one-operative-per-agreement
        // invariant. If the insert fails after the supersede, the agreement
        // has NO operative assessment — which fails closed, never open.
        if (last && last.status === "operative") {
          await admin.schema("aml").from("arrangement_assessments")
            .update({ status: "superseded", superseded_at: new Date().toISOString() })
            .eq("id", last.id);
        }
        const conditions = String(body.conditions ?? "").trim();
        const evidence = Array.isArray(body.evidence_references)
          ? body.evidence_references.map((e: unknown) => String(e).slice(0, 500)).slice(0, 50)
          : [];
        const { data: assessment, error } = await admin.schema("aml")
          .from("arrangement_assessments").insert({
            agreement_id: agreementId, assessment_version: version,
            assessed_by: userId, assessed_by_label: userEmail,
            trigger, decision,
            findings: findings.slice(0, 4000) || null,
            conditions: conditions.slice(0, 4000) || null,
            evidence_references: evidence,
            next_due_at: nextDue,
          }).select("*").single();
        if (error) throw error;
        if (last && last.status === "operative") {
          await admin.schema("aml").from("arrangement_assessments")
            .update({ superseded_by_id: assessment.id }).eq("id", last.id);
        }
        await admin.schema("aml").from("reliance_agreements")
          .update({ current_assessment_id: assessment.id, updated_at: new Date().toISOString() })
          .eq("id", agreementId);
        return jr({ assessment });
      }

      case "update_agreement_scope": {
        if (!isMlro) return jr({ error: "MLRO role required" }, 403);
        const agreementId = String(body.agreement_id ?? "");
        if (!agreementId) return jr({ error: "agreement_id required" }, 400);
        const { data: agreement } = await admin.schema("aml").from("reliance_agreements")
          .select("*").eq("id", agreementId).maybeSingle();
        if (!agreement) return jr({ error: "Agreement not found" }, 404);

        const patch: Record<string, unknown> = {};
        const strArray = (v: unknown) =>
          Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, 50) : null;
        if (body.scope_customer_types !== undefined) patch.scope_customer_types = strArray(body.scope_customer_types);
        if (body.scope_procedures !== undefined) patch.scope_procedures = strArray(body.scope_procedures);
        if (body.scope_record_classes !== undefined) patch.scope_record_classes = strArray(body.scope_record_classes);
        if (body.record_availability_sla_hours !== undefined) {
          const sla = Number(body.record_availability_sla_hours);
          patch.record_availability_sla_hours = Number.isFinite(sla) && sla > 0 ? Math.round(sla) : null;
        }
        if (body.jurisdiction !== undefined) patch.jurisdiction = String(body.jurisdiction ?? "").slice(0, 100) || null;
        if (body.cross_border_terms !== undefined) patch.cross_border_terms = String(body.cross_border_terms ?? "").slice(0, 2000) || null;
        if (body.executed_document_reference !== undefined) patch.executed_document_reference = String(body.executed_document_reference ?? "").slice(0, 300) || null;
        if (body.effective_from !== undefined) {
          const d = String(body.effective_from ?? "");
          if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return jr({ error: "effective_from must be YYYY-MM-DD" }, 400);
          patch.effective_from = d || null;
        }
        if (body.expires_on !== undefined) {
          const d = String(body.expires_on ?? "");
          if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return jr({ error: "expires_on must be YYYY-MM-DD" }, 400);
          patch.expires_on = d || null;
        }
        if (body.eligibility_classification !== undefined) {
          const cls = String(body.eligibility_classification ?? "");
          if (!["unassessed", "eligible_reporting_entity", "eligible_foreign_equivalent", "not_eligible"].includes(cls)) {
            return jr({ error: "eligibility_classification must be unassessed, eligible_reporting_entity, eligible_foreign_equivalent or not_eligible" }, 400);
          }
          // An eligible determination on the ARRANGEMENT presupposes an
          // eligible-classified canonical PARTNER — the two records must
          // agree, and neither is ever guessed.
          if (cls === "eligible_reporting_entity" || cls === "eligible_foreign_equivalent") {
            if (!agreement.partner_org_id) {
              return jr({
                error: "Map this agreement to a canonical partner organisation before recording an eligible determination.",
                code: "partner_org_unresolved",
              }, 409);
            }
            const { data: org } = await admin.schema("aml").from("partner_organisations")
              .select("reporting_entity_classification").eq("id", agreement.partner_org_id).maybeSingle();
            const orgCls = org?.reporting_entity_classification ?? "unclassified";
            if (!["eligible_relying_reporting_entity", "eligible_foreign_equivalent"].includes(orgCls)) {
              return jr({
                error: "The canonical partner organisation is not classified as reliance-capable. Record the partner classification (with evidence) first.",
                code: "partner_classification_required",
              }, 409);
            }
          }
          patch.eligibility_classification = cls;
        }
        if (Object.keys(patch).length === 0) return jr({ error: "No recognised fields to update" }, 400);
        patch.agreement_version = (agreement.agreement_version ?? 1) + 1;
        patch.updated_at = new Date().toISOString();
        const { data, error } = await admin.schema("aml").from("reliance_agreements")
          .update(patch).eq("id", agreementId).select("*").single();
        if (error) throw error;
        return jr({ agreement: data });
      }

      /* ── partner workspace: Command Center support (Phase 4) ──────────── */
      // Origin review of controlled records requests and the delivery read
      // model. Requests never auto-approve; delivering restricted classes
      // is an MLRO decision; the response message is partner-safe wording
      // authored by staff, never internal notes.

      case "staff_list_partner_records_requests": {
        if (!body.case_id) return jr({ error: "case_id required" }, 400);
        const [{ data: requests, error: reqErr }, { data: deliveries }] = await Promise.all([
          admin.schema("aml").from("partner_records_requests")
            .select("*, partner_organisations:partner_org_id(legal_name, organisation_type)")
            .eq("case_id", String(body.case_id)).order("requested_at", { ascending: false }).limit(100),
          admin.schema("aml").from("partner_evidence_deliveries")
            .select("*").eq("case_id", String(body.case_id))
            .order("delivered_at", { ascending: false }).limit(200),
        ]);
        if (reqErr) throw reqErr;
        return jr({ requests: requests ?? [], deliveries: deliveries ?? [] });
      }

      case "review_partner_records_request": {
        if (!isMlro) return jr({ error: "MLRO role required — releasing CDD records to a partner is a restricted disclosure decision" }, 403);
        const requestId = String(body.request_id ?? "");
        const decision = String(body.decision ?? "");
        if (!requestId) return jr({ error: "request_id required" }, 400);
        if (!["under_review", "approved", "partly_approved", "denied"].includes(decision)) {
          return jr({ error: "decision must be under_review, approved, partly_approved or denied" }, 400);
        }
        const { data: request } = await admin.schema("aml").from("partner_records_requests")
          .select("*").eq("id", requestId).maybeSingle();
        if (!request) return jr({ error: "Request not found" }, 404);
        if (!["submitted", "under_review"].includes(request.status)) {
          return jr({ error: `Request is already ${request.status}` }, 409);
        }
        const responseMessage = String(body.response_message ?? "").trim();
        const patch: Record<string, unknown> = { status: decision };
        if (decision !== "under_review") {
          const requested: string[] = request.requested_record_codes ?? [];
          const approved: string[] = Array.isArray(body.approved_record_codes)
            ? [...new Set<string>((body.approved_record_codes as unknown[]).map((c) => String(c)))]
              .filter((c) => requested.includes(c))
            : [];
          if (decision === "approved" && approved.length !== requested.length) {
            return jr({ error: "Full approval must approve every requested code — otherwise use partly_approved." }, 400);
          }
          if (decision === "partly_approved" && (approved.length === 0 || approved.length === requested.length)) {
            return jr({ error: "Partial approval needs a non-empty strict subset of the requested codes." }, 400);
          }
          if (decision === "denied" && approved.length > 0) {
            return jr({ error: "A denial approves nothing." }, 400);
          }
          if (responseMessage.length < 10) {
            return jr({ error: "response_message of at least 10 characters is required — it is the partner-safe explanation of the decision" }, 400);
          }
          patch.approved_record_codes = decision === "denied" ? [] : approved;
          patch.denied_record_codes = requested.filter((c) => !(patch.approved_record_codes as string[]).includes(c));
          patch.origin_response_message = responseMessage.slice(0, 2000);
          patch.reviewed_by = userId;
          patch.reviewed_by_label = userEmail;
          patch.reviewed_at = new Date().toISOString();
        }
        const { data: updated, error } = await admin.schema("aml").from("partner_records_requests")
          .update(patch).eq("id", requestId).select("*").single();
        if (error) throw error;
        await appendCaseEvent(admin, request.case_id, "mlro_decision",
          `Partner records request ${decision.replace(/_/g, " ")}`,
          {
            partner_records_request_id: requestId, decision,
            approved_record_codes: (patch.approved_record_codes as string[]) ?? null,
          }, userId, userEmail);
        return jr({ request: updated });
      }

      case "record_partner_evidence_delivery": {
        if (!isMlro) return jr({ error: "MLRO role required" }, 403);
        // Phase 9 action flag: same flag as partner object access — one
        // capability, one switch.
        if (!(await flagEnabled(admin, "aml_partner_evidence_delivery_write"))) {
          return jr({ error: "Evidence delivery is not enabled yet for this environment.", code: "evidence_delivery_write_disabled" }, 409);
        }
        const requestId = String(body.request_id ?? "");
        const recordCode = String(body.record_code ?? "");
        const safeLabel = String(body.safe_label ?? "").trim();
        if (!requestId || !recordCode || !safeLabel) {
          return jr({ error: "request_id, record_code and safe_label are required" }, 400);
        }
        const { data: request } = await admin.schema("aml").from("partner_records_requests")
          .select("*").eq("id", requestId).maybeSingle();
        if (!request) return jr({ error: "Request not found" }, 404);
        if (!["approved", "partly_approved", "delivered"].includes(request.status)) {
          return jr({ error: "Only an approved request can receive a delivery." }, 409);
        }
        if (!(request.approved_record_codes ?? []).includes(recordCode)) {
          return jr({ error: "That record code was not approved on this request." }, 403);
        }
        const days = Math.min(Math.max(Number(body.expires_days ?? 14) || 14, 1), 90);
        // Stage B: a delivery may carry an OPAQUE reference to the accepted
        // evidence document that backs it. Validated against the request's
        // own case — a document from another case can never be attached.
        let evidenceDocumentId: string | null = null;
        if (body.evidence_document_id) {
          const { data: doc } = await admin.schema("aml").from("documents")
            .select("id, case_id, status").eq("id", String(body.evidence_document_id)).maybeSingle();
          if (!doc) return jr({ error: "Evidence document not found." }, 404);
          if (doc.case_id !== request.case_id) {
            return jr({ error: "That document belongs to a different case.", code: "evidence_case_mismatch" }, 403);
          }
          if (doc.status !== "accepted") {
            return jr({ error: "Only an accepted (reviewed) document can back a delivery.", code: "evidence_not_accepted" }, 409);
          }
          evidenceDocumentId = doc.id;
        }
        const { data: delivery, error } = await admin.schema("aml").from("partner_evidence_deliveries").insert({
          request_id: requestId,
          case_id: request.case_id,
          partner_case_link_id: request.partner_case_link_id,
          partner_org_id: request.partner_org_id,
          record_code: recordCode,
          safe_label: safeLabel.slice(0, 300),
          delivered_sha256: String(body.delivered_sha256 ?? "").slice(0, 64) || null,
          evidence_document_id: evidenceDocumentId,
          delivered_by: userId,
          delivered_by_label: userEmail,
          expires_at: new Date(Date.now() + days * 864e5).toISOString(),
        }).select("*").single();
        if (error) throw error;

        // Once every approved code has at least one live delivery, the
        // request itself reads delivered.
        const { data: allDeliveries } = await admin.schema("aml").from("partner_evidence_deliveries")
          .select("record_code").eq("request_id", requestId).is("revoked_at", null);
        const deliveredCodes = new Set((allDeliveries ?? []).map((d: any) => d.record_code));
        if ((request.approved_record_codes ?? []).every((c: string) => deliveredCodes.has(c))) {
          await admin.schema("aml").from("partner_records_requests")
            .update({ status: "delivered" }).eq("id", requestId);
        }
        await appendCaseEvent(admin, request.case_id, "mlro_decision",
          `Evidence delivery recorded: ${safeLabel}`,
          {
            partner_records_request_id: requestId, delivery_id: delivery.id,
            record_code: recordCode, expires_at: delivery.expires_at,
          }, userId, userEmail);
        return jr({ delivery });
      }

      /* ── reliable events, invalidation and refresh (Phase 6) ──────────── */

      case "apply_material_change": {
        // Central material-change invalidation (§6.5). The evaluator
        // recomputes the Phase 3 material-input hash from live case data and
        // compares it, group by group, with the inputs reconstructed from
        // the stored v2 payload. Presentation-only changes cannot register.
        // Consequences apply in ONE database transaction
        // (aml.apply_partner_material_change); the origin service gate,
        // risk assessment and case outcome are never touched.
        if (!isMlro) return jr({ error: "MLRO role required — invalidation changes what partners may rely on" }, 403);
        if (!(await flagEnabled(admin, "aml_partner_event_outbox"))) {
          return jr({
            error: "Material-change invalidation is part of the partner event outbox, which is not enabled.",
            code: "events_disabled",
          }, 409);
        }
        const caseId = String(body.case_id ?? "");
        if (!caseId) return jr({ error: "case_id required" }, 400);
        const mode = body.mode === "revoke" ? "revoke" : "refresh";
        const { data: caseRow } = await admin.schema("aml").from("cases")
          .select("*").eq("id", caseId).maybeSingle();
        if (!caseRow) return jr({ error: "Case not found" }, 404);
        const { data: att } = await admin.schema("aml").from("compliance_attestations")
          .select("*").eq("case_id", caseId).is("superseded_at", null)
          .order("version", { ascending: false }).limit(1).maybeSingle();
        if (!att) return jr({ error: "No current attestation on this case." }, 404);
        if ((att.schema_version ?? 1) !== 2 || !att.material_input_hash) {
          return jr({
            error: "Material-change invalidation requires a v2 attestation with a material-input hash. Re-issue under aml_attestation_v2 first.",
            code: "attestation_v2_required",
          }, 409);
        }

        const payload = await buildAttestationPayload(admin, caseRow);
        const { data: gateDecision } = await admin.schema("aml").from("service_gate_decisions")
          .select("id").eq("case_id", caseId)
          .in("status", ["approved", "approved_with_controls"])
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        const nextInputs = materialInputsFromV2Payload(
          toV2Payload(payload as Record<string, unknown>),
          gateDecision?.id ?? att.service_gate_decision_id ?? null);
        const previousInputs = materialInputsFromV2Payload(
          att.payload, att.service_gate_decision_id ?? null);
        const evaluation = await evaluateMaterialChange(previousInputs, nextInputs);

        if (!evaluation.material) {
          return jr({
            material: false, changed_groups: [],
            message: "No material change: the current attestation's inputs are unchanged. Nothing was invalidated.",
          });
        }

        const { data: applied, error } = await admin.schema("aml").rpc("apply_partner_material_change", {
          _case_id: caseId,
          _attestation_id: att.id,
          _new_material_hash: evaluation.next_hash,
          _changed_groups: evaluation.changed_groups,
          _safe_reason_code: evaluation.safe_reason_code,
          _mode: mode,
          _actor_user_id: userId,
        });
        if (error) throw error;

        await appendCaseEvent(admin, caseId, "mlro_decision",
          `Material change recorded — attestation v${att.version} flagged for refresh`,
          {
            attestation_id: att.id,
            changed_groups: evaluation.changed_groups,
            mode,
            summary: applied,
            note: "Partner-facing surfaces stop serving the flagged content and receive safe refresh wording only. The service gate, risk assessment and case outcome are unchanged by this action.",
          }, userId, userEmail);
        return jr({ material: true, changed_groups: evaluation.changed_groups, applied });
      }

      case "staff_list_refresh_obligations": {
        const q = admin.schema("aml").from("partner_refresh_obligations")
          .select("*, partner_organisations:partner_org_id(legal_name)")
          .order("created_at", { ascending: false }).limit(200);
        if (body.case_id) q.eq("case_id", String(body.case_id));
        if (body.status) q.eq("status", String(body.status));
        const { data, error } = await q;
        if (error) throw error;
        return jr({ obligations: data ?? [] });
      }

      case "get_partner_events_health": {
        // Narrow Phase 6 ops visibility (§6.8). Every figure is read live
        // from the database, and the underlying rows travel with the counts
        // so the card can show the filtered records themselves. Flag state
        // is reported as recorded configuration — nothing here claims the
        // worker is deployed or scheduled.
        const nowIso = new Date().toISOString();
        const [flagOn, pending, retrying, dead, obligations, flaggedAttestations, agreementsDue] = await Promise.all([
          flagEnabled(admin, "aml_partner_event_outbox"),
          admin.from("integration_outbox")
            .select("id, event_type, occurred_at, attempts, last_error", { count: "exact" })
            .like("event_type", "aml.%").is("processed_at", null)
            .order("occurred_at", { ascending: true }).limit(20),
          admin.from("integration_outbox")
            .select("id", { count: "exact", head: true })
            .like("event_type", "aml.%").is("processed_at", null).gt("attempts", 0),
          admin.from("integration_dead_letters")
            .select("id, event_type, failed_at, attempts", { count: "exact" })
            .like("event_type", "aml.%").is("replayed_at", null)
            .order("failed_at", { ascending: false }).limit(20),
          admin.schema("aml").from("partner_refresh_obligations")
            .select("id, case_id, partner_case_link_id, safe_reason_code, required_action, status, due_at, created_at", { count: "exact" })
            .eq("status", "open").order("created_at", { ascending: true }).limit(20),
          admin.schema("aml").from("compliance_attestations")
            .select("id, case_id, version, refresh_required_at", { count: "exact" })
            .not("refresh_required_at", "is", null).is("superseded_at", null)
            .order("refresh_required_at", { ascending: true }).limit(20),
          admin.schema("aml").from("reliance_agreements")
            .select("id, partner_org_name, next_review_due", { count: "exact" })
            .eq("status", "active")
            .lte("next_review_due", new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10))
            .order("next_review_due", { ascending: true }).limit(20),
        ]);
        const overdueObligations = (obligations.data ?? [])
          .filter((o: any) => o.due_at && o.due_at < nowIso).length;
        return jr({
          health: {
            outbox_enabled: flagOn,
            pending_count: pending.count ?? 0,
            retrying_count: retrying.count ?? 0,
            dead_letter_count: dead.count ?? 0,
            oldest_pending_at: pending.data?.[0]?.occurred_at ?? null,
            open_obligation_count: obligations.count ?? 0,
            overdue_obligation_count: overdueObligations,
            refresh_required_attestation_count: flaggedAttestations.count ?? 0,
            arrangement_reviews_due_count: agreementsDue.count ?? 0,
            pending_events: pending.data ?? [],
            dead_letters: dead.data ?? [],
            open_obligations: obligations.data ?? [],
            refresh_required_attestations: flaggedAttestations.data ?? [],
            arrangement_reviews_due: agreementsDue.data ?? [],
            generated_at: nowIso,
          },
        });
      }

      /* ── operations, reporting and readiness (Phase 8) ────────────────── */

      case "get_partner_operations_dashboard": {
        // Compliance queues over the partner domain. Every count carries the
        // register + filter it deep-links into, so the number always leads
        // to the records behind it. Restricted queues are OMITTED for
        // callers without the capability — never zeroed or placeholdered.
        if (!(await flagEnabled(admin, "aml_partner_operations_reporting"))) {
          return jr({ error: "Partner operations reporting is not enabled.", code: "operations_disabled" }, 409);
        }
        const caps: OperationsCapabilities = {
          view: true,
          investigate: isMlro || roles.has("reviewer") || roles.has("analyst"),
          mlro: isMlro,
        };
        const now = new Date();
        const nowIso = now.toISOString();
        const soonIso = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
        const todayIso = nowIso.slice(0, 10);
        const staleIso = new Date(Date.now() - 7 * 864e5).toISOString();

        const oldest = (rows: any[] | null, col: string) =>
          rows && rows.length > 0 ? rows[0][col] ?? null : null;
        const q = async (builder: any, col: string): Promise<QueueCount> => {
          const { data, count } = await builder;
          return { count: count ?? 0, oldestAt: oldest(data, col) };
        };

        const [pendingRequests, awaitingDelivery, openObligations, dueArrangements,
          overdueArrangements, unclassified, awaitingApproval, failedItems,
          retrying, deadLetters, staleSyncs] = await Promise.all([
          q(admin.schema("aml").from("partner_records_requests")
            .select("requested_at", { count: "exact" }).in("status", ["submitted", "under_review"])
            .order("requested_at", { ascending: true }).limit(1), "requested_at"),
          q(admin.schema("aml").from("partner_records_requests")
            .select("reviewed_at", { count: "exact" }).in("status", ["approved", "partly_approved"])
            .order("reviewed_at", { ascending: true }).limit(1), "reviewed_at"),
          q(admin.schema("aml").from("partner_refresh_obligations")
            .select("created_at", { count: "exact" }).eq("status", "open")
            .order("created_at", { ascending: true }).limit(1), "created_at"),
          q(admin.schema("aml").from("reliance_agreements")
            .select("next_review_due", { count: "exact" }).eq("status", "active")
            .gte("next_review_due", todayIso).lte("next_review_due", soonIso)
            .order("next_review_due", { ascending: true }).limit(1), "next_review_due"),
          q(admin.schema("aml").from("reliance_agreements")
            .select("next_review_due", { count: "exact" }).eq("status", "active")
            .lt("next_review_due", todayIso)
            .order("next_review_due", { ascending: true }).limit(1), "next_review_due"),
          q(admin.schema("aml").from("partner_organisations")
            .select("created_at", { count: "exact" })
            .in("classification_status", ["unclassified", "pending_review"]).eq("status", "active")
            .order("created_at", { ascending: true }).limit(1), "created_at"),
          q(admin.schema("aml").from("retention_scans")
            .select("created_at", { count: "exact" }).eq("status", "awaiting_approval")
            .order("created_at", { ascending: true }).limit(1), "created_at"),
          q(admin.schema("aml").from("retention_scan_items")
            .select("processed_at", { count: "exact" }).eq("disposition", "failed")
            .order("processed_at", { ascending: true }).limit(1), "processed_at"),
          q(admin.from("integration_outbox")
            .select("occurred_at", { count: "exact" }).like("event_type", "aml.%")
            .is("processed_at", null).gt("attempts", 0)
            .order("occurred_at", { ascending: true }).limit(1), "occurred_at"),
          q(admin.from("integration_dead_letters")
            .select("failed_at", { count: "exact" }).like("event_type", "aml.%")
            .is("replayed_at", null).order("failed_at", { ascending: true }).limit(1), "failed_at"),
          q(admin.schema("aml").from("sanctions_list_syncs")
            .select("completed_at", { count: "exact" }).eq("status", "succeeded")
            .lt("completed_at", staleIso).order("completed_at", { ascending: true }).limit(1), "completed_at"),
        ]);

        // Determinations outstanding: open obligations requiring
        // re-determination are the partner-owned follow-up we can count
        // reliably; the same rows back both partner-owned queues.
        const counts: Record<string, QueueCount> = {
          partner_records_requests_pending: pendingRequests,
          evidence_delivery_approval: awaitingDelivery,
          partner_determination_pending: openObligations,
          partner_refresh_required: openObligations,
          arrangement_assessment_due: dueArrangements,
          arrangement_assessment_overdue: overdueArrangements,
          partner_classification_pending: unclassified,
          retention_approval: awaitingApproval,
          disposal_failure: failedItems,
          outbox_retry: retrying,
          outbox_failed: deadLetters,
          sanctions_freshness: staleSyncs,
        };

        const { data: targetRows } = await admin.schema("aml").from("partner_sla_targets")
          .select("queue_key, warn_hours, escalate_hours").eq("active", true);
        const targets: Record<string, SlaTarget> = { ...DEFAULT_SLA_TARGETS };
        for (const t of targetRows ?? []) {
          targets[t.queue_key] = { warnHours: t.warn_hours, escalateHours: t.escalate_hours };
        }

        return jr({
          queues: buildQueueSummary(counts, caps, targets, now),
          sla_note: SLA_TARGET_NOTE,
          generated_at: nowIso,
        });
      }

      case "list_partner_register": {
        // Filtered operational registers. Capability boundaries come from
        // the shared register catalogue; a register the caller may not see
        // answers 403, and every result set is the same one the queue counts
        // were computed from (same filters), so deep-links reproduce it.
        if (!(await flagEnabled(admin, "aml_partner_operations_reporting"))) {
          return jr({ error: "Partner operations reporting is not enabled.", code: "operations_disabled" }, 409);
        }
        const caps: OperationsCapabilities = {
          view: true,
          investigate: isMlro || roles.has("reviewer") || roles.has("analyst"),
          mlro: isMlro,
        };
        const register = String(body.register ?? "");
        if (!REGISTER_DEFS[register]) return jr({ error: "Unknown register" }, 400);
        if (!registerAllowed(register, caps)) {
          return jr({ error: "This register requires a capability your role does not hold.", code: "capability_required" }, 403);
        }
        const status = String(body.status ?? "");
        const limit = Math.min(Number(body.limit ?? 100) || 100, 200);
        const nowIso = new Date().toISOString();
        const todayIso = nowIso.slice(0, 10);
        const soonIso = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
        const aml = admin.schema("aml");

        let rows: any[] = [];
        if (register === "partner_organisations") {
          let qb = aml.from("partner_organisations")
            .select("id, legal_name, organisation_type, reporting_entity_classification, classification_status, status, created_at")
            .order("created_at", { ascending: true }).limit(limit);
          if (status === "unclassified") qb = qb.in("classification_status", ["unclassified", "pending_review"]).eq("status", "active");
          rows = (await qb).data ?? [];
        } else if (register === "partner_case_links") {
          let qb = aml.from("partner_case_links")
            .select("id, case_id, partner_org_id, portal_type, relationship_role, legal_route, state, linked_at, ended_at")
            .order("linked_at", { ascending: false }).limit(limit);
          if (status) qb = qb.eq("state", status);
          rows = (await qb).data ?? [];
        } else if (register === "arrangements") {
          let qb = aml.from("reliance_agreements")
            .select("id, partner_org_name, partner_org_type, status, eligibility_classification, next_review_due, last_reviewed_at, current_assessment_id")
            .order("next_review_due", { ascending: true }).limit(limit);
          if (status === "review_due") qb = qb.eq("status", "active").gte("next_review_due", todayIso).lte("next_review_due", soonIso);
          else if (status === "overdue") qb = qb.eq("status", "active").lt("next_review_due", todayIso);
          else if (status) qb = qb.eq("status", status);
          rows = (await qb).data ?? [];
        } else if (register === "attestations") {
          const qb = aml.from("compliance_attestations")
            .select("id, case_id, version, schema_version, payload_sha256, issued_at, superseded_at, refresh_required_at")
            .order("issued_at", { ascending: false }).limit(limit);
          rows = (await qb).data ?? [];
        } else if (register === "records_requests") {
          let qb = aml.from("partner_records_requests")
            .select("id, case_id, partner_org_id, requested_record_codes, status, requested_at, reviewed_at, due_at, approved_record_codes, denied_record_codes")
            .order("requested_at", { ascending: true }).limit(limit);
          if (status === "pending_review") qb = qb.in("status", ["submitted", "under_review"]);
          else if (status === "awaiting_delivery") qb = qb.in("status", ["approved", "partly_approved"]);
          else if (status) qb = qb.eq("status", status);
          rows = (await qb).data ?? [];
        } else if (register === "evidence_deliveries") {
          let qb = aml.from("partner_evidence_deliveries")
            .select("id, case_id, partner_org_id, record_code, safe_label, delivered_at, expires_at, revoked_at")
            .order("delivered_at", { ascending: false }).limit(limit);
          if (status === "live") qb = qb.is("revoked_at", null).gt("expires_at", nowIso);
          rows = (await qb).data ?? [];
        } else if (register === "determinations") {
          const qb = aml.from("independent_assessments")
            .select("id, case_id, partner_org_id, status, decided_at, based_on_attestation_sha256, refresh_required_at, created_at")
            .order("created_at", { ascending: false }).limit(limit);
          rows = (await qb).data ?? [];
        } else if (register === "refresh_obligations") {
          let qb = aml.from("partner_refresh_obligations")
            .select("id, case_id, partner_org_id, partner_case_link_id, safe_reason_code, required_action, status, due_at, created_at, completed_at")
            .order("created_at", { ascending: true }).limit(limit);
          if (status) qb = qb.eq("status", status);
          rows = (await qb).data ?? [];
        } else if (register === "integration_events") {
          if (status === "dead_letter") {
            rows = (await admin.from("integration_dead_letters")
              .select("id, event_type, aggregate_type, attempts, failed_at, replayed_at")
              .like("event_type", "aml.%").is("replayed_at", null)
              .order("failed_at", { ascending: true }).limit(limit)).data ?? [];
          } else {
            let qb = admin.from("integration_outbox")
              .select("id, event_type, aggregate_type, occurred_at, processed_at, attempts, last_error")
              .like("event_type", "aml.%").order("occurred_at", { ascending: true }).limit(limit);
            if (status === "retrying") qb = qb.is("processed_at", null).gt("attempts", 0);
            else if (status === "pending") qb = qb.is("processed_at", null);
            rows = (await qb).data ?? [];
          }
        } else if (register === "retention_candidates") {
          const qb = aml.from("retention_triggers")
            .select("id, entity_type, entity_id, case_id, record_category, trigger_kind, minimum_retention_date, legal_basis")
            .is("superseded_at", null).lte("minimum_retention_date", nowIso)
            .order("minimum_retention_date", { ascending: true }).limit(limit);
          rows = (await qb).data ?? [];
        } else if (register === "legal_holds") {
          // MLRO-only (capability gate above): hold REASONS stay inside the
          // Command Center; this register never feeds a partner surface.
          let qb = aml.from("legal_holds")
            .select("id, entity_type, entity_id, case_id, reason, imposed_at, imposed_by_label, released_at")
            .order("imposed_at", { ascending: false }).limit(limit);
          if (status === "active") qb = qb.is("released_at", null);
          rows = (await qb).data ?? [];
        } else if (register === "disposal_actions") {
          let qb = aml.from("retention_scans")
            .select("id, scope, status, requested_by_label, approved_by_label, approved_at, executed_at, candidates_count, held_count, disposed_count, skipped_count, created_at")
            .order("created_at", { ascending: false }).limit(limit);
          if (status === "awaiting_approval") qb = qb.eq("status", "awaiting_approval");
          else if (status === "failed") qb = qb.eq("status", "failed");
          rows = (await qb).data ?? [];
          if (status === "failed") {
            const { data: failedItems } = await aml.from("retention_scan_items")
              .select("id, scan_id, entity_type, entity_id, disposition, note, processed_at")
              .eq("disposition", "failed").order("processed_at", { ascending: true }).limit(limit);
            rows = [...rows, ...(failedItems ?? [])];
          }
        } else if (register === "sanctions_sources") {
          const qb = aml.from("sanctions_list_syncs")
            .select("id, list_code, status, completed_at")
            .order("completed_at", { ascending: false }).limit(limit);
          rows = (await qb).data ?? [];
        }
        return jr({ register, status: status || null, rows, generated_at: nowIso });
      }

      case "get_partner_management_report": {
        // Tenant-scoped management measures over the partner domain (§8.4).
        // This deployment is single-tenant ('default'); every partner-domain
        // table carries tenant_id for the day that changes.
        if (!(await flagEnabled(admin, "aml_partner_operations_reporting"))) {
          return jr({ error: "Partner operations reporting is not enabled.", code: "operations_disabled" }, 409);
        }
        const from = /^\d{4}-\d{2}-\d{2}$/.test(String(body.from ?? "")) ? String(body.from) : null;
        const to = /^\d{4}-\d{2}-\d{2}$/.test(String(body.to ?? "")) ? String(body.to) : null;
        const aml = admin.schema("aml");
        const nowIso = new Date().toISOString();
        const todayIso = nowIso.slice(0, 10);
        const ranged = (qb: any, col: string) => {
          if (from) qb = qb.gte(col, from);
          if (to) qb = qb.lte(col, `${to}T23:59:59Z`);
          return qb;
        };
        const count = async (qb: any) => (await qb).count ?? 0;

        const [linksByRoute, grantsActive, grantsRevoked, grantsExpired, accesses,
          requestsByStatus, deliveries, determinationsByStatus, refreshRequired,
          arrangementsOverdue, eligibility, triggers, holdsActive, dueItems,
          blockedItems, scanApprovals, scanFailures, receipts] = await Promise.all([
          ranged(aml.from("partner_case_links").select("legal_route", { count: "exact" }), "linked_at"),
          count(aml.from("reliance_grants").select("id", { count: "exact", head: true })
            .is("revoked_at", null).gt("expires_at", nowIso)),
          count(ranged(aml.from("reliance_grants").select("id", { count: "exact", head: true })
            .not("revoked_at", "is", null), "granted_at")),
          count(aml.from("reliance_grants").select("id", { count: "exact", head: true })
            .is("revoked_at", null).lte("expires_at", nowIso)),
          count(ranged(aml.from("reliance_access_log").select("id", { count: "exact", head: true }), "created_at")),
          ranged(aml.from("partner_records_requests").select("status", { count: "exact" }), "requested_at"),
          count(ranged(aml.from("partner_evidence_deliveries").select("id", { count: "exact", head: true }), "delivered_at")),
          ranged(aml.from("independent_assessments").select("status", { count: "exact" }), "created_at"),
          count(aml.from("partner_refresh_obligations").select("id", { count: "exact", head: true }).eq("status", "open")),
          count(aml.from("reliance_agreements").select("id", { count: "exact", head: true })
            .eq("status", "active").lt("next_review_due", todayIso)),
          aml.from("reliance_agreements").select("eligibility_classification", { count: "exact" }),
          count(ranged(aml.from("retention_triggers").select("id", { count: "exact", head: true })
            .is("superseded_at", null), "created_at")),
          count(aml.from("legal_holds").select("id", { count: "exact", head: true }).is("released_at", null)),
          count(aml.from("retention_triggers").select("id", { count: "exact", head: true })
            .is("superseded_at", null).lte("minimum_retention_date", nowIso)),
          count(aml.from("retention_scan_items").select("id", { count: "exact", head: true })
            .eq("disposition", "blocked")),
          count(ranged(aml.from("retention_scans").select("id", { count: "exact", head: true })
            .not("approved_at", "is", null), "created_at")),
          count(aml.from("retention_scan_items").select("id", { count: "exact", head: true })
            .eq("disposition", "failed")),
          count(aml.from("retention_scan_items").select("id", { count: "exact", head: true })
            .eq("disposition", "disposed")),
        ]);
        const tally = (rows: any[] | null, col: string) => {
          const out: Record<string, number> = {};
          for (const r of rows ?? []) out[r[col]] = (out[r[col]] ?? 0) + 1;
          return out;
        };
        return jr({
          report: {
            tenant_id: "default",
            range: { from, to },
            partners: {
              links_by_legal_route: tally(linksByRoute.data, "legal_route"),
              grants_active: grantsActive,
              grants_revoked: grantsRevoked,
              grants_expired: grantsExpired,
              access_events: accesses,
              records_requests_by_status: tally(requestsByStatus.data, "status"),
              evidence_deliveries: deliveries,
              determinations_by_outcome: tally(determinationsByStatus.data, "status"),
              refresh_required_open: refreshRequired,
            },
            arrangements: {
              overdue_reviews: arrangementsOverdue,
              eligibility_states: tally(eligibility.data, "eligibility_classification"),
            },
            records: {
              operative_triggers: triggers,
              active_legal_holds: holdsActive,
              retention_due_items: dueItems,
              blocked_disposals: blockedItems,
              scan_approvals: scanApprovals,
              disposal_failures: scanFailures,
              disposal_evidence_receipts: receipts,
            },
            generated_at: nowIso,
          },
        });
      }

      case "get_partner_readiness": {
        // Readiness + read-only preflight (§8.5, §8.6). Deliberately NOT
        // gated by the reporting flag: this is the check an operator runs
        // BEFORE enabling anything. Every item reports only what the
        // database can evidence — structures present, recorded flag values,
        // backlog and freshness thresholds — plus this function answering.
        // Worker scheduling, function deployment and source-side checks
        // cannot be verified from here and are reported as unknown.
        // Read-only by construction: nothing below writes.
        const items: ReadinessItem[] = [];
        const probe = async (key: string, label: string, table: string, schema = "aml") => {
          const client = schema === "aml" ? admin.schema("aml") : admin;
          const { error } = await client.from(table).select("*", { count: "exact", head: true }).limit(0);
          items.push(normaliseReadinessItem({
            key, label,
            state: error ? "missing" : "applied",
            evidence: error
              ? `probe of ${schema}.${table} failed: structure absent or not readable`
              : `${schema}.${table} answered a head-only probe`,
          }));
        };
        await probe("phase1_partner_identity", "Phase 1 — partner identity structures", "partner_organisations");
        await probe("phase2_arrangements", "Phase 2 — arrangement governance structures", "arrangement_assessments");
        await probe("phase3_manifests", "Phase 3 — disclosure manifest structures", "disclosure_manifests");
        await probe("phase4_workspace", "Phase 4 — partner workspace structures", "partner_records_requests");
        await probe("phase6_events", "Phase 6 — refresh obligation structures", "partner_refresh_obligations");
        await probe("phase6_outbox_envelope", "Phase 6 — platform outbox", "integration_outbox", "public");
        await probe("phase7_record_catalogue", "Phase 7 — record class catalogue", "record_class_catalogue");
        await probe("phase8_sla_targets", "Phase 8 — operational target configuration", "partner_sla_targets");

        const FLAG_KEYS = [
          "aml_partner_identity", "aml_arrangement_governance", "aml_attestation_v2",
          "aml_partner_compliance_workspace", "aml_partner_workspace_finance",
          "aml_partner_workspace_builder", "aml_partner_workspace_developer",
          "aml_partner_workspace_solicitor", "aml_partner_event_outbox",
          "aml_partner_records_retention", "aml_partner_operations_reporting",
        ];
        for (const key of FLAG_KEYS) {
          const { data: flagRow } = await admin.from("feature_flags")
            .select("key").eq("key", key).maybeSingle();
          const on = flagRow ? await flagEnabled(admin, key) : false;
          items.push(normaliseReadinessItem({
            key: `flag_${key}`, label: `Flag ${key}`,
            state: !flagRow ? "missing" : on ? "enabled" : "disabled",
            evidence: flagRow
              ? `recorded value in public.feature_flags — configuration, not deployment state`
              : "no row in public.feature_flags",
          }));
        }

        const { count: backlog, data: oldestPending } = await admin.from("integration_outbox")
          .select("occurred_at", { count: "exact" }).like("event_type", "aml.%")
          .is("processed_at", null).order("occurred_at", { ascending: true }).limit(1);
        const oldestAgeHours = oldestPending?.[0]
          ? (Date.now() - new Date(oldestPending[0].occurred_at).getTime()) / 3_600_000 : 0;
        items.push(normaliseReadinessItem({
          key: "outbox_backlog", label: "Partner event backlog",
          state: (backlog ?? 0) === 0 ? "healthy" : oldestAgeHours > 12 ? "action_required" : "attention",
          evidence: `${backlog ?? 0} unprocessed aml.* events; oldest ${Math.round(oldestAgeHours)}h. A growing backlog means no consumer is being invoked — consumer scheduling cannot be verified from here.`,
        }));

        const { data: lastScan } = await admin.schema("aml").from("retention_scans")
          .select("created_at, status").order("created_at", { ascending: false }).limit(1).maybeSingle();
        items.push(normaliseReadinessItem({
          key: "retention_scan_recency", label: "Retention scan recency",
          state: !lastScan ? "unknown"
            : (Date.now() - new Date(lastScan.created_at).getTime()) < 35 * 864e5 ? "healthy" : "attention",
          evidence: lastScan
            ? `last scan ${lastScan.created_at} (${lastScan.status})`
            : "no retention scan recorded — recency not verifiable",
        }));

        const { data: lastSync } = await admin.schema("aml").from("sanctions_list_syncs")
          .select("completed_at, list_code").eq("status", "succeeded")
          .order("completed_at", { ascending: false }).limit(1).maybeSingle();
        items.push(normaliseReadinessItem({
          key: "sanctions_freshness", label: "Sanctions list freshness",
          state: !lastSync ? "unknown"
            : (Date.now() - new Date(lastSync.completed_at).getTime()) < 7 * 864e5 ? "healthy" : "attention",
          evidence: lastSync
            ? `latest successful sync ${lastSync.completed_at} (${lastSync.list_code})`
            : "no successful sync recorded — freshness not verifiable",
        }));

        items.push(normaliseReadinessItem({
          key: "function_aml_reliance", label: "aml-reliance function",
          state: "responding", evidence: "produced this response",
        }));
        for (const [key, label] of [
          ["function_outbox_worker", "cross-portal-outbox-worker scheduling"],
          ["security_registry", "Security registry currency (source-side check)"],
          ["required_tests", "Required test suites (source-side check)"],
        ] as const) {
          items.push(normaliseReadinessItem({
            key, label, state: "unknown",
            evidence: "not verifiable from the database — source presence is not deployment truth; verify in the deployment pipeline",
          }));
        }

        return jr({
          readiness: {
            preflight: true,
            read_only: true,
            items,
            notice: "States report database-verifiable facts and recorded configuration only. Nothing here asserts deployment, scheduling or production state.",
            generated_at: new Date().toISOString(),
          },
        });
      }

      default:
        return jr({ error: `Unknown op: ${op}` }, 400);
    }
  } catch (e: any) {
    console.error("[aml-reliance] error", e);
    return jr({ ...internalError(e, 'aml-reliance') }, 500);
  }
});

// CORS-CREDENTIALS: rewrite the wildcard origin into an allowlisted one.
Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));

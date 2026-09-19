/**
 * Portal ↔ Command Center integration contracts (PR #1939).
 *
 * Source contracts pin the load-bearing properties of the canonical
 * verification pipeline so they cannot be silently reintroduced: canonical
 * writes, transactional outbox emission, attempt accounting, client-safe
 * readiness, closed action vocabulary, versioned responses, worker
 * idempotency and risk integration.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  canonicalOutcome,
} from "../../../supabase/functions/_shared/aml/verificationOutcome.pure.ts";

const portalFn = readFileSync("supabase/functions/aml-client-portal/index.ts", "utf8");
const verificationFn = readFileSync("supabase/functions/aml-verification/index.ts", "utf8");
const riskFn = readFileSync("supabase/functions/aml-risk/index.ts", "utf8");
const workerIndex = readFileSync("supabase/functions/cross-portal-outbox-worker/index.ts", "utf8");
const consumer = readFileSync("supabase/functions/cross-portal-outbox-worker/verificationConsumer.ts", "utf8");
const canonicalMigration = readFileSync("supabase/migrations/20260831000000_aml_canonical_verification_model.sql", "utf8");
const outboxMigration = readFileSync("supabase/migrations/20260831000100_aml_verification_outbox_and_request_notifications.sql", "utf8");

const idvBlock = portalFn.slice(portalFn.indexOf("case 'submit_verification'"), portalFn.indexOf("case 'request_verification_upload_url'"));

describe("case-access tenant resolution (found by production browser run)", () => {
  const verifyFn = readFileSync("supabase/functions/aml-verification/index.ts", "utf8");

  it("hasCaseAccess does not depend on a column aml.cases never had", () => {
    // `aml.cases` has no `tenant_id` column and no migration adds one. The
    // gate used to `.select("tenant_id")` and `return false` on the resulting
    // PostgREST error, so it denied EVERY caller on EVERY case — making the
    // documentary route permanently 403 behind an enabled "Record sighting"
    // button. It must resolve the tenant the way the rest of the file does.
    const fn = verifyFn.slice(
      verifyFn.indexOf("async function hasCaseAccess"),
      verifyFn.indexOf("import { reserveTokens"),
    );
    expect(fn).toContain("await resolveTenantId(admin, caseId)");
    expect(fn).not.toMatch(/from\("cases"\)\s*\n?\s*\.select\("tenant_id"\)/);
    expect(fn).not.toContain("caseRow?.tenant_id");
  });

  it("authorisation still rests solely on the tenant-scoped AML role RPCs", () => {
    // The fix must not widen access: the RPCs remain the only grant path.
    const fn = verifyFn.slice(
      verifyFn.indexOf("async function hasCaseAccess"),
      verifyFn.indexOf("import { reserveTokens"),
    );
    expect(fn).toContain("has_any_tenant_aml_role");
    expect(fn).toContain("has_tenant_aml_role");
    expect(fn).toContain('for (const role of ["analyst", "reviewer", "mlro"])');
    // No unconditional success path.
    expect(fn.trimEnd().endsWith("return false;\n}")).toBe(true);
  });
});

describe("canonical verification model", () => {
  it("portal submission writes verification_checks, never identity_checks", () => {
    expect(idvBlock).toContain("from('verification_checks').insert");
    expect(idvBlock).not.toContain("identity_checks");
  });
  it("migration keeps identity_checks untouched as read-only history", () => {
    // Executable statements only — the documented ROLLBACK header is comment.
    const executable = canonicalMigration.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
    expect(executable).not.toMatch(/(ALTER|UPDATE|DROP|INSERT INTO|DELETE FROM)\s+(TABLE\s+)?aml\.identity_checks/i);
    expect(executable).not.toMatch(/\bDROP TABLE\b|\bDELETE FROM\b/);
  });
  it("adjudicated legacy electronic rows keep their consumed-attempt meaning", () => {
    expect(canonicalMigration).toContain("attempt_consumed = true");
    expect(canonicalMigration).toContain("IN ('passed','failed','referred','exhausted')");
  });
});

describe("attempt accounting", () => {
  it("the server counter counts only consumed, non-simulated, non-superseded attempts", () => {
    expect(canonicalMigration).toContain("AND attempt_consumed");
    expect(canonicalMigration).toContain("AND execution_mode <> 'simulation'");
    expect(canonicalMigration).toContain("AND superseded_at IS NULL");
  });
  it("the portal asks the RPC first and keeps MAX(attempt_number) only as legacy fallback", () => {
    const helper = portalFn.slice(portalFn.indexOf("async function verificationAttemptsUsed"), portalFn.indexOf("async function activeProcessingCheck"));
    expect(helper).toContain(".rpc('verification_attempts_used'");
    expect(helper.indexOf(".rpc(")).toBeLessThan(helper.indexOf("attempt_number"));
  });
  it("the worker consumes an attempt only on an authoritative outcome", () => {
    // The decision moved into verificationOutcome.pure.ts so the staff re-run
    // in aml-verification obeys the same rules — the two writers of this row
    // had drifted, and the staff path was never setting attempt_consumed at
    // all. The behaviour itself is covered by verificationOutcome.test.ts;
    // what is asserted here is that the worker defers to that contract rather
    // than deciding for itself.
    const authoritativeBlock = consumer.slice(consumer.indexOf("Authoritative outcome"));
    expect(authoritativeBlock).toContain("attempt_consumed: outcome.attemptConsumed");
    expect(consumer).toContain("canonicalOutcome(result,");
    expect(consumer, "never a hardcoded consumption").not.toContain("attempt_consumed: true");

    // And the contract it defers to only consumes on an authoritative outcome.
    expect(canonicalOutcome({ status: "failed" }, { attemptsConsumed: 0, maxAttempts: 3 })
      .attemptConsumed).toBe(true);
    expect(canonicalOutcome({ status: "pending" }, { attemptsConsumed: 0, maxAttempts: 3 })
      .attemptConsumed).toBe(false);
  });
  it("unusable captures and technical failures never touch status or attempts", () => {
    const unusable = consumer.slice(consumer.indexOf("capture_unusable"), consumer.indexOf("Authoritative outcome"));
    expect(unusable).not.toContain("attempt_consumed: true");
    const technical = consumer.slice(consumer.indexOf("const technical"), consumer.indexOf("try {"));
    expect(technical).toContain("processing_status: 'technical_failure'");
    expect(technical).not.toMatch(/\bstatus:\s*'/);
  });
});

describe("transactional outbox pipeline", () => {
  it("the event is emitted by an AFTER trigger in the same transaction", () => {
    expect(outboxMigration).toContain("AFTER INSERT ON aml.verification_checks");
    expect(outboxMigration).toContain("'aml.verification.requested'");
    expect(outboxMigration).toContain("ON CONFLICT (idempotency_key) DO NOTHING");
  });
  it("event payloads carry identifiers only — no PII, paths or images", () => {
    const payload = outboxMigration.slice(outboxMigration.indexOf("tg_emit_verification_requested"), outboxMigration.indexOf("trg_aml_verification_outbox"));
    expect(payload).not.toMatch(/storage_path|document_reference|party_label|email|image/);
  });
  it("the portal stamps a stable per-capture idempotency key and collapses duplicates", () => {
    expect(idvBlock).toContain("idempotency_key");
    expect(idvBlock).toContain("'23505'");
    expect(idvBlock).toContain("already_processing");
    expect(canonicalMigration).toContain("uq_aml_verification_idempotency");
  });
  it("the worker routes verification events to a dedicated consumer with eligibility and claim guards", () => {
    expect(workerIndex).toContain("aml_verification");
    expect(workerIndex).toContain("processVerificationEvent");
    expect(consumer).toContain("check.status !== 'pending'");
    expect(consumer).toContain("check.superseded_at");
    expect(consumer).toContain(".in('processing_status', ['submitted', 'queued', 'retry_scheduled'])");
  });
  it("the worker never logs or emits image bytes or secrets", () => {
    expect(consumer).not.toMatch(/console\.log\([^)]*(image|b64|token|secret)/i);
  });
});

describe("client-safe readiness", () => {
  it("the portal exposes only the closed client vocabulary", () => {
    const helper = portalFn.slice(portalFn.indexOf("clientSafeIdvAvailability"), portalFn.indexOf("/* ─"));
    for (const internal of ["ready_live", "simulator_non_production", "not_configured", "misconfigured", "secrets"]) {
      expect(helper).not.toContain(`'${internal}'`);
    }
    expect(portalFn).toContain("'temporarily_unavailable'");
    expect(portalFn).toContain("'manual_verification_required'");
  });
  it("the selfie upload URL is gated on availability, attempts and no active processing", () => {
    const uploadBlock = portalFn.slice(portalFn.indexOf("case 'request_verification_upload_url'"), portalFn.indexOf("case 'list_requirements'"));
    // `clientSafeIdvState` resolves availability AND which flow is active; the
    // gate is the same one, now also answering "does NPC capture at all?".
    expect(uploadBlock).toContain("clientSafeIdvState");
    expect(uploadBlock).toContain("availability !== 'available'");
    expect(uploadBlock).toContain("attempts_exhausted");
    expect(uploadBlock).toContain("already_processing");
    // A hosted provider owns the capture, so NPC must not collect a second
    // copy of the customer's face (APP 3).
    expect(uploadBlock).toContain("hosted_verification_required");
  });
  it("submission itself re-checks availability server-side", () => {
    expect(idvBlock).toContain("clientSafeIdvAvailability");
  });
});

describe("actionable requests and responses", () => {
  it("only the closed action vocabulary projects to the client, with whitelisted routing fields", () => {
    // The vocabulary moved again — from this function into
    // `_shared/aml/clientRequestContract.pure.ts` — so the writer
    // (`aml-cases`), the reader (this function) and the router
    // (`portalRequestRoute`) share one list instead of three. A code the
    // writer accepted and the reader dropped reached the client as a request
    // with no button, and nothing reported it.
    //
    // Same guarantee, asserted at the single source: closed code vocabulary,
    // whitelisted routing fields, never a URL.
    expect(portalFn).toContain("sanitiseActionCode(r.action_code)");
    expect(portalFn).toContain("sanitiseActionTarget(r.action_target)");

    const contract = readFileSync(
      "supabase/functions/_shared/aml/clientRequestContract.pure.ts", "utf8");
    // The target is built field by field from allow-list tests — there is no
    // spread of the input, so an unrecognised key cannot survive.
    expect(contract).toContain("export function sanitiseActionTarget");
    expect(contract).not.toMatch(/\.\.\.\s*t\b/);
    const sanitiser = contract.slice(
      contract.indexOf("export function sanitiseActionTarget"),
      contract.indexOf("export function sanitiseActionCode"));
    expect(sanitiser).not.toMatch(/url|href|link/i);
    for (const field of ["target_step", "requirement_id", "section_code"]) {
      expect(sanitiser).toContain(field);
    }
  });
  it("the migration constrains action codes and adds notification state", () => {
    expect(outboxMigration).toContain("'complete_identity_verification'");
    expect(outboxMigration).toContain("notification_status");
  });
  it("a client request writes its portal notification and event transactionally", () => {
    expect(outboxMigration).toContain("AFTER INSERT ON aml.client_requests");
    expect(outboxMigration).toContain("client_portal_notifications");
    expect(outboxMigration).toContain("'aml.client_request.created'");
  });
  it("responses are written as the versioned v1 contract after validation", () => {
    const respond = portalFn.slice(portalFn.indexOf("case 'respond_client_request'"), portalFn.indexOf("case 'submit_for_review'"));
    expect(respond).toContain("version: 1");
    expect(respond).toContain("response_version: 1");
    expect(respond).toContain("completed_action");
  });
});

describe("risk integration", () => {
  it("canonical failures feed mandatory inputs only when authoritative and consumed", () => {
    const canonical = riskFn.slice(riskFn.indexOf("failedCanonicalIdv"), riskFn.indexOf("confirmedSanctions"));
    expect(canonical).toContain('.eq("authoritative", true)');
    expect(canonical).toContain('.eq("attempt_consumed", true)');
    expect(canonical).toContain('.is("superseded_at", null)');
  });
  it("canonical completions mark the assessment stale", () => {
    expect(riskFn).toContain("canonicalIdv");
    expect(riskFn).toContain('gt("completed_at", since)');
  });
});

describe("staff technical retry", () => {
  it("retries only technical failures and dead letters, never authoritative outcomes", () => {
    const retry = verificationFn.slice(verificationFn.indexOf('case "retry_verification_processing"'), verificationFn.indexOf('case "provider_readiness"'));
    expect(retry).toContain('["technical_failure", "dead_lettered"]');
    expect(retry).toContain("retry_not_eligible");
    expect(retry).not.toContain("attempt_consumed: true");
  });
});

describe("server-derived journey", () => {
  // The journey moved to `_shared/aml/portalJourney.pure.ts` so it could be
  // tested as behaviour rather than as source text (see portalJourney.test.ts)
  // — the same move `projectParty` made, and for the same reason: a defect
  // here is a defect the client sees in four places at once.
  const journeyModule = readFileSync(
    "supabase/functions/_shared/aml/portalJourney.pure.ts", "utf8");

  it("verified wording requires actual party verification state", () => {
    expect(journeyModule).toContain("verificationJourneyStatus");
    expect(journeyModule).toContain("'You are verified.'");
    expect(journeyModule).toContain("Your adviser is reviewing your information.");
    expect(journeyModule).not.toContain("reuses it");
  });
  it("overview returns the journey computed server-side", () => {
    expect(portalFn).toContain("journey: buildJourney({");
    expect(portalFn).toContain('from "../_shared/aml/portalJourney.pure.ts"');
  });
  it("documents completion reads what arrived, not only what was asked for", () => {
    // `docsDone` used to require `requiredReqs.length > 0`, so a case with no
    // formal requirements could never complete its documents step however
    // much the client uploaded.
    expect(portalFn).toContain("documents: documentFacts ?? []");
    expect(portalFn).toMatch(/from\('documents'\)\s*\n?\s*\.select\('requirement_id,status'\)/);
    expect(journeyModule).toContain("documentsJourneyStatus");
  });
  it("only unanswered requests count as a client action", () => {
    // A `responded` request is waiting on the adviser. Counting it kept the
    // journey telling the client their adviser had asked for something after
    // they had already answered.
    expect(portalFn).toMatch(/openRequestCount:[\s\S]{0,200}filter\(\(r: any\) => r\.status === 'open'\)/);
  });
  it("the journey never learns a score, a provider or a reviewer", () => {
    // Code only — the header explains what it is forbidden to see, and would
    // otherwise trip its own rule.
    const codeOnly = journeyModule.split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    expect(codeOnly).not.toMatch(/risk_|score|threshold|mlro|didit|provider_/i);
  });
});

/* ── Continuation coverage: staff surfaces, portal actions, evidence ── */
const casesFn = readFileSync("supabase/functions/aml-cases/index.ts", "utf8");
const reviewPure = readFileSync("supabase/functions/_shared/aml/submissionReview.ts", "utf8");
const completionMigration = readFileSync("supabase/migrations/20260901000000_aml_integration_completion.sql", "utf8");
const reviewPanel = readFileSync("src/components/aml/SubmissionReviewPanel.tsx", "utf8");
const legacyPanel = readFileSync("src/components/aml/LegacyVerificationHistoryPanel.tsx", "utf8");
const partyPanel = readFileSync("src/components/aml/PartyVerificationPanel.tsx", "utf8");
const screeningPanel = readFileSync("src/components/aml/PartyScreeningPanel.tsx", "utf8");
const workspace = readFileSync("src/pages/aml/AmlCaseWorkspace.tsx", "utf8");
const workspaceLabels = readFileSync("src/components/aml/workspace/workspaceLabels.ts", "utf8");
const workspaceViewModel = readFileSync("src/lib/aml/workspaceViewModel.ts", "utf8");
const portalPage2 = readFileSync("src/pages/portal/PortalAml.tsx", "utf8");

describe("submission review", () => {
  it("returns an immutable package and never writes the snapshot", () => {
    // The package is composed once, in `composeSubmissionReview` — the same
    // composition answers the screen and renders the stored record
    // (SUBMISSION_RECORD.md), so the pins read the composer.
    const block = casesFn.slice(
      casesFn.indexOf("async function composeSubmissionReview"),
      casesFn.indexOf("const __corsWrappedHandler"));
    for (const key of ["consent_evidence", "differences", "missing_mandatory", "risk", "related_parties", "verification", "screening"]) {
      expect(block).toContain(key);
    }
    expect(casesFn).toContain("case 'get_submission_review'");
    expect((casesFn.match(/await composeSubmissionReview\(/g) ?? []).length).toBe(2);
    const decide = casesFn.slice(casesFn.indexOf("case 'accept_submission'"), casesFn.indexOf("case 'review_document_v2'"));
    expect(decide).not.toMatch(/update\(\{[^}]*snapshot/s);
    expect(decide).toContain("service_gate_unchanged: true");
    expect(decide).not.toMatch(/service_gate_status:/);
  });
  it("gates accept/escalate on reviewer or MLRO and requires reasons elsewhere", () => {
    const decide = casesFn.slice(casesFn.indexOf("case 'accept_submission'"), casesFn.indexOf("case 'review_document_v2'"));
    expect(decide).toContain("roles.has('reviewer') || roles.has('mlro')");
    expect(decide).toContain("reason.length < 10");
  });
  it("changes requests create the client request that triggers the notification", () => {
    const decide = casesFn.slice(casesFn.indexOf("case 'accept_submission'"), casesFn.indexOf("case 'review_document_v2'"));
    expect(decide).toContain("from('client_requests').insert");
    expect(decide).toContain("action_code: actionCode");
  });
  it("diffing is pure, field-level and flags material sections", () => {
    expect(reviewPure).toContain("export function diffSubmissions");
    expect(reviewPure).toContain("MATERIAL_SECTIONS");
    expect(reviewPure).toMatch(/'personal_details', 'entity_details', 'related_parties', 'funding'/);
  });
  it("the UI is its own workspace section and shows the gate read-only", () => {
    // Submission review is still a first-class section with its own key, its
    // own label and its own place in the information architecture. The
    // workspace redesign moved where the label and the area mapping are
    // declared — the guarantee is unchanged, so the assertions follow it.
    expect(workspace).toContain('"submission-review"');
    expect(workspaceLabels).toContain('"submission-review": "Submission review"');
    expect(workspaceViewModel).toContain('"submission-review",');
    expect(workspaceViewModel).toMatch(
      /transaction: \[[^\]]*"submission-review"[^\]]*\]/,
    );
    expect(reviewPanel).toContain("Service gate (read-only)");
    expect(reviewPanel).toContain("does not approve the service gate");
  });
  it("the review UI has loading, error-retry and empty states", () => {
    expect(reviewPanel).toContain("Try again");
    expect(reviewPanel).toContain("has not submitted their onboarding yet");
    expect(reviewPanel).toContain('aria-busy="true"');
  });
});

describe("document rejection and replacement", () => {
  it("rejection requires a client-safe code and an internal note, kept separate", () => {
    const block = casesFn.slice(casesFn.indexOf("case 'review_document_v2'"), casesFn.indexOf("case 'list_party_reconciliation'"));
    expect(block).toContain("isClientSafeRejectionReason");
    expect(block).toContain("An internal review reason is required");
    expect(block).toContain("client_safe_rejection_reason: safeCopy");
    expect(block).toContain("internal_review_note: internalNote");
  });
  it("rejection raises a replacement request and keeps the rejected document", () => {
    const block = casesFn.slice(casesFn.indexOf("case 'review_document_v2'"), casesFn.indexOf("case 'list_party_reconciliation'"));
    expect(block).toContain("action_code: 'upload_document'");
    expect(block).not.toMatch(/\.delete\(\)/);
  });
  it("lineage columns exist and internal notes are staff-only in the review package", () => {
    expect(completionMigration).toContain("previous_document_id");
    expect(completionMigration).toContain("replacement_document_id");
    // The masking rule lives in the shared composition; the caller decides
    // who counts as internal (staff writer or auditor) at the call site.
    const block = casesFn.slice(
      casesFn.indexOf("async function composeSubmissionReview"),
      casesFn.indexOf("const __corsWrappedHandler"));
    expect(block).toContain("includeInternalNotes ? d.internal_review_note : null");
    expect(casesFn).toContain("canWrite || roles.has('auditor')");
  });
});

describe("P3 evidence and P6 biometric governance", () => {
  it("evidence references govern the object without duplicating it", () => {
    expect(completionMigration).toContain("aml.idv_evidence_references");
    expect(completionMigration).toContain("information_classification text NOT NULL");
    expect(completionMigration).toContain("CHECK (information_classification IN ('P3','P6'))");
    expect(completionMigration).toContain("legal_hold boolean NOT NULL DEFAULT false");
    expect(completionMigration).toContain("disposal_evidence jsonb");
  });
  it("retention registers every new record type with necessity-based raw classes", () => {
    for (const t of ["verification_check", "idv_evidence_reference", "biometric_capture",
      "submission_review_decision", "document_version", "document_review_decision",
      "client_request_notification", "party_reconciliation_item", "party_field_provenance",
      "party_screening_subject", "party_verification_link"]) {
      expect(completionMigration).toContain(`'${t}'`);
    }
    expect(completionMigration).toMatch(/\('idv_evidence_reference',\s*0,/);
    expect(completionMigration).toMatch(/\('biometric_capture',\s*0,/);
  });
});

describe("party reconciliation", () => {
  it("never merges automatically and demands a rationale", () => {
    const block = casesFn.slice(casesFn.indexOf("case 'resolve_party_reconciliation'"), casesFn.indexOf("case 'list_party_verification_links'"));
    expect(block).toContain("A rationale is required");
    expect(block).toContain("cross_case_denied");
    expect(block).toContain("from('party_field_provenance').insert");
  });
  it("similarity is suggestion-only in the pure resolver", () => {
    expect(reviewPure).toContain("requires_confirmation: true");
    expect(reviewPure).toMatch(/exact = stable[\s\S]{0,200}stable_identifier/);
    expect(reviewPure).toContain("basis: 'name_similarity'");
  });
  it("screening work is created only after resolution", () => {
    const block = casesFn.slice(casesFn.indexOf("case 'resolve_party_reconciliation'"), casesFn.indexOf("case 'list_party_verification_links'"));
    expect(block).toContain("['linked', 'created'].includes(resolution) && item.screening_required");
    expect(block).toContain("from('party_screening_subjects').insert");
  });
});

describe("party verification links", () => {
  it("refuses cross-case and non-authoritative evidence and requires an unlink reason", () => {
    const block = casesFn.slice(casesFn.indexOf("case 'link_party_verification'"), casesFn.indexOf("case 'list_party_screening'"));
    expect(block).toContain("cross_case_denied");
    expect(block).toContain("not_authoritative");
    expect(block).toContain("An unlink reason is required");
  });
  it("the UI derives state and never sets a verified flag directly", () => {
    expect(partyPanel).toContain("derived from the canonical check");
    expect(partyPanel).not.toMatch(/verification_state\s*[:=]/);
  });
});

describe("party screening orchestration", () => {
  it("dedupes inside the freshness window and restricts adjudication", () => {
    const block = casesFn.slice(casesFn.indexOf("case 'queue_party_screening'"), casesFn.indexOf("      default:"));
    expect(block).toContain("within_freshness_window");
    expect(block).toContain("roles.has('reviewer') || roles.has('mlro')");
    expect(block).toContain("An adjudication note is required");
  });
  it("the panel states screening follows reconciliation and hides detail from clients", () => {
    expect(screeningPanel).toContain("screening follows");
    expect(screeningPanel).toContain("Clients never see screening detail");
  });
});

describe("unified staff verification surface", () => {
  it("mounts one canonical surface plus a collapsed legacy panel", () => {
    expect(workspace).toContain("<VerificationSection");
    expect(workspace).toContain("<LegacyVerificationHistoryPanel");
    expect(workspace).not.toMatch(/<VerificationTab[\s\S]{0,400}<VerificationSection/);
    const identity = workspace.slice(workspace.indexOf('section === "identity"'), workspace.indexOf('section === "submission-review"'));
    expect(identity).not.toContain("<VerificationTab");
  });
  it("legacy history is read-only with simulator labelling", () => {
    expect(legacyPanel).toContain("Test simulation — not compliance evidence");
    expect(legacyPanel).toContain("Nothing here can be retried or promoted");
    // No executable action: the only "retry" mention is the doc comment
    // stating that nothing here can be retried.
    const code = legacyPanel.split("\n").filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("/*") && !l.trimStart().startsWith("//")).join("\n");
    expect(code).not.toMatch(/initiateIdv|retryVerification|onClick=\{[^}]*retry/i);
  });
});

describe("client portal request actions", () => {
  it("routes internally through the closed vocabulary with no URLs", () => {
    // The vocabulary moved to `src/lib/aml/portalRequestRoute.ts` so the
    // resolver could be unit-tested as behaviour rather than as source text
    // (see portalRequestRoute.test.ts). The page must consume it, not
    // reimplement it.
    //
    // It has now moved once further, into the shared contract, so the SERVER
    // shares it too. The router derives its table rather than restating it —
    // asserted here, because a second literal list is exactly the drift this
    // consolidation removes.
    expect(portalPage2).toContain("resolveRequestStep");
    const routeModule = readFileSync("src/lib/aml/portalRequestRoute.ts", "utf8");
    expect(routeModule).toContain("REQUEST_ACTIONS");
    expect(routeModule).toContain("clientRequestContract.pure");
    expect(routeModule).toContain("CLIENT_ACTIONS");

    const contract = readFileSync(
      "supabase/functions/_shared/aml/clientRequestContract.pure.ts", "utf8");
    const CODES = ["complete_identity_verification", "upload_document",
      "update_questionnaire_section", "review_consent", "provide_clarification",
      "review_and_submit"];
    for (const code of CODES) expect(contract).toContain(code);

    // …and the router must not restate the TABLE.
    //
    // `TARGET_STEPS` is excluded first: it is a different vocabulary that
    // happens to share the spelling `upload_document` with an action code —
    // one is where a request OPENS, the other is what it ASKS FOR, and
    // conflating them is how a narrowing assertion starts failing on correct
    // code. What remains may contain exactly one action literal:
    // `complete_identity_verification` is genuinely special-cased, being the
    // only action whose destination depends on provider readiness.
    const withoutTargetSteps = routeModule.replace(
      /export const TARGET_STEPS[\s\S]*?as const;/, "");
    const restated = CODES.filter((c) => withoutTargetSteps.includes(`'${c}'`));
    expect(restated).toEqual(["complete_identity_verification"]);
    const nav = portalPage2.slice(portalPage2.indexOf("onNavigate={(target"), portalPage2.indexOf("/>", portalPage2.indexOf("onNavigate={(target")));
    expect(nav).not.toMatch(/action_url|window\.location|href/);
  });
  it("unknown or unavailable targets fail safe", () => {
    expect(portalPage2).toContain("That step is not available yet");
  });
  it("responses use the versioned v1 contract", () => {
    expect(portalPage2).toContain("version: 1");
    expect(portalPage2).toContain("completed_action: 'provide_clarification'");
  });
  it("request status is shown in client-safe language", () => {
    expect(portalPage2).toContain("Action required");
    expect(portalPage2).toContain("Response sent");
  });
});

describe("notification category regression (found by staging browser E2E)", () => {
  const fix = readFileSync("supabase/migrations/20260901000100_aml_notification_category_fix.sql", "utf8");
  it("widens the category CHECK so the request trigger can write 'aml'", () => {
    expect(fix).toContain("client_portal_notifications_category_check");
    expect(fix).toMatch(/CHECK \(category IN \('general','deal','document','message','property','aml'\)\)/);
    expect(fix).toContain("did not converge");
  });
  it("the trigger's category is inside the widened vocabulary", () => {
    const category = /category[^,]*,\s*$/m.test(outboxMigration) || outboxMigration.includes("'info', 'aml'");
    expect(category).toBe(true);
    expect(fix).toContain("'aml'");
  });
  it("the fix is a separate additive migration, not an edit to the applied one", () => {
    expect(fix).toContain("not an edit to 20260831000100");
    expect(fix).not.toMatch(/\bDROP TABLE\b|\bDELETE FROM\b/);
  });
});

/** Source with comments removed, so a note describing a removed symbol cannot
 *  satisfy or fail an assertion about the code itself. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("browser-journey regressions (found by real Chromium against staging)", () => {
  const terminology = readFileSync("src/lib/aml/useAmlTerminology.ts", "utf8");
  const workspace = readFileSync("src/pages/aml/AmlCaseWorkspace.tsx", "utf8");
  const verificationSection = readFileSync("src/components/aml/VerificationSection.tsx", "utf8");
  const verificationApi = readFileSync("src/lib/aml/amlVerificationApi.ts", "utf8");
  const portalFn = readFileSync("supabase/functions/aml-client-portal/index.ts", "utf8");
  const mobileHeader = readFileSync("src/components/layout/MobileHeader.tsx", "utf8");
  const bell = readFileSync("src/components/layout/NotificationsDropdown.tsx", "utf8");

  // DEF-B1 — the no-case empty state read like a fault.
  it("the no-case message is client-facing copy, not an API status line", () => {
    expect(portalFn).not.toContain("message: 'No AML onboarding case yet.'");
    expect(portalFn).toContain("hasn’t opened an identity and compliance case");
    expect(portalFn).toContain("nothing for you to do now");
  });

  // DEF-B2 — a terminology payload without the expected key white-screened
  // every AML surface through AmlLayout's ErrorBoundary.
  it("terminology overrides are coerced so a missing key cannot crash AmlLayout", () => {
    expect(terminology).toContain("function asOverrideMap");
    expect(terminology).toMatch(/writeCache\(next: unknown\)/);
    expect(terminology).toContain("overrides?.[label] ?? label");
    // readCache must sanitise what it parses out of sessionStorage too.
    expect(terminology).toContain("asOverrideMap(JSON.parse(raw))");
  });

  // DEF-B3 / DEF-B7 — "Invalid Date" was rendered to compliance staff, in the
  // workspace header and in the legacy verification history.
  it("date formatting lives in one shared helper that never returns Invalid Date", () => {
    const helper = readFileSync("src/lib/aml/displayDate.ts", "utf8");
    expect(helper).toContain("export function displayDate");
    expect(helper).toContain("export function displayDateTime");
    expect(helper).toContain("Number.isNaN(parsed.getTime())");
    // A bad value degrades to the fallback, never to the literal string: the
    // helper must not construct that text itself.
    const executableHelper = helper
      .split("\n").filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("/*")).join("\n");
    expect(executableHelper).not.toContain("Invalid Date");
  });
  it("every AML surface this change touches uses the helper, not raw Date formatting", () => {
    const files = [
      "src/pages/aml/AmlCaseWorkspace.tsx",
      "src/components/aml/LegacyVerificationHistoryPanel.tsx",
      "src/components/aml/PartyVerificationPanel.tsx",
      "src/components/aml/PartyScreeningPanel.tsx",
      "src/components/aml/SubmissionReviewPanel.tsx",
      "src/components/aml/VerificationSection.tsx",
    ];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      const executable = src
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("*") && !line.trimStart().startsWith("//"))
        .join("\n");
      expect(src, `${file} must import the shared helper`)
        .toContain('from "@/lib/aml/displayDate"');
      expect(executable, `${file} must not format a date directly`)
        .not.toMatch(/new Date\([^)]*\)\.toLocale(Date)?String\(\)/);
    }
    void workspace;
  });

  // DEF-B4 — "attempt undefined of 3".
  it("an absent attempt number omits the clause instead of printing undefined", () => {
    expect(verificationSection).toContain("Number.isFinite(Number(c.attempt_number))");
  });

  // DEF-B5 — canonical processing state and its retry had no staff UI at all.
  it("the staff panel surfaces processing status separately from the identity outcome", () => {
    expect(verificationSection).toContain("PROCESSING_LABELS");
    for (const state of ["capture_unusable", "technical_failure", "retry_scheduled", "dead_lettered"]) {
      expect(verificationSection).toContain(state);
    }
    expect(verificationSection).toContain("No client attempt was used.");
    expect(verificationSection).toContain("Test simulation — not compliance evidence");
  });
  it("retry processing is wrapped, offered only when eligible, and claims no new attempt", () => {
    expect(verificationApi).toContain("retryVerificationProcessing");
    expect(verificationApi).toContain('op: "retry_verification_processing"');
    expect(verificationApi).toContain("RETRYABLE_PROCESSING_STATUSES");
    // Exactly the two states the server accepts, and no others.
    const list = verificationApi.slice(
      verificationApi.indexOf("RETRYABLE_PROCESSING_STATUSES"),
      verificationApi.indexOf("isRetryableProcessingStatus"),
    );
    expect(list).toContain("technical_failure");
    expect(list).toContain("dead_lettered");
    expect(list).not.toContain("completed");
    expect(list).not.toContain("capture_unusable");
    expect(verificationSection).toContain("isRetryableProcessingStatus(c.processing_status)");
    expect(verificationSection).toContain("No further client attempt was used.");
  });
  it("provider readiness is shown so staff do not chase an unprocessable capture", () => {
    expect(verificationSection).toContain("providerReadiness()");
    expect(verificationSection).toContain("Electronic verification:");
    // Readiness now names the route staff should take instead of only saying
    // the provider is down, and still promises no attempt is spent.
    expect(verificationSection).toContain("Electronic verification is currently unavailable.");
    expect(verificationSection).toContain("Request documents and complete manual ");
    expect(verificationSection).toContain("no customer attempt is consumed");
  });

  /* ── the verification surface defect ─────────────────────────────────── */

  it("the case workspace tab mounts the canonical surface, not the legacy one", () => {
    // CaseWorkspaceTabs used to mount `VerificationTab` (aml.identity_checks).
    // Two competing primary panels is the defect; there must be exactly one.
    const tabs = readFileSync("src/components/aml/CaseWorkspaceTabs.tsx", "utf8");
    expect(tabs).toContain("<VerificationSection");
    expect(tabs).toContain("<LegacyVerificationHistoryPanel");
    // Checked against comment-stripped source: the removal is documented in a
    // comment that names the component it removed, and that note must not be
    // what fails the test guarding the removal.
    const tabsCode = stripComments(tabs);
    expect(tabsCode).not.toMatch(/<VerificationTab[\s/>]/);
    expect(tabsCode).not.toMatch(/export function VerificationTab\b/);
  });

  it("requesting verification is not gated on provider readiness", () => {
    // The legacy panel disabled the request whenever the provider was not
    // ready_live, which blocked verification in precisely the case where the
    // manual document route is the only way forward. The request creates a
    // workflow item; it does not run the provider.
    expect(verificationSection).toContain("const requestVerification");
    const btn = verificationSection.slice(verificationSection.indexOf("Request identity verification") - 600);
    expect(btn).toContain('disabled={busy === "request" || Boolean(openRequest)}');
    expect(btn).not.toMatch(/disabled=\{[^}]*ready_live/);
  });

  it("a second request is prevented while one is unresolved", () => {
    expect(verificationSection).toContain("IDENTITY_VERIFICATION_ACTION");
    expect(verificationSection).toContain('r?.status !== "resolved"');
    // And the disabled state explains itself rather than reading as broken.
    expect(verificationSection).toContain("Identity verification already requested.");
  });

  it("readiness selects the client's route rather than blocking the request", () => {
    expect(verificationSection).toContain('action_code: IDENTITY_VERIFICATION_ACTION');
    expect(verificationSection).toContain('target_step: electronic ? "identity_verification" : "upload_document"');
    // The canonical code, not a second spelling invented at the call site.
    expect(verificationSection).toContain('"complete_identity_verification"');
    // No synthetic pass may be manufactured when the provider is unavailable.
    // `initiateIdv` is the simulator entry point the legacy panel called; the
    // canonical surface must never call it. It may still *label* a simulation
    // row that already exists, which is why only the call is forbidden.
    expect(verificationSection).not.toContain("initiateIdv");
    expect(verificationSection).toContain("Test simulation — not compliance evidence");
  });

  // DEF-B6 — icon-only shell controls had no accessible name at 360×800.
  it("icon-only shell controls carry an accessible name", () => {
    for (const label of ["Open navigation menu", "Search", "Change theme", "Account menu", "Close search"]) {
      expect(mobileHeader).toContain(`aria-label="${label}"`);
    }
    expect(bell).toContain("aria-label={unreadCount > 0 ?");
    expect(bell).toContain("'Notifications'");
  });
});

describe("capture-row identity regression (found by the production-shaped DB rehearsal)", () => {
  const migration = readFileSync(
    "supabase/migrations/20260901000200_aml_capture_row_identity.sql", "utf8");
  const portalFn = readFileSync("supabase/functions/aml-client-portal/index.ts", "utf8");
  const partyPanel = readFileSync("src/components/aml/PartyVerificationPanel.tsx", "utf8");

  it("row identity moves to capture_sequence and the attempt_number cap is lifted", () => {
    expect(migration).toContain("DROP INDEX IF EXISTS aml.uq_aml_verification_attempt");
    expect(migration).toContain("uq_aml_verification_capture");
    expect(migration).toMatch(/CHECK \(attempt_number >= 1\)/);
    expect(migration).toMatch(/CHECK \(capture_sequence >= 1\)/);
    // The allowance must not move back onto a column CHECK. Assert on the
    // executable statements only — the ROLLBACK header quotes the old cap.
    const executableDdl = migration
      .split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
    expect(executableDdl).not.toMatch(/attempt_number <= \d/);
  });
  it("it backfills capture_sequence rather than deleting or rewriting rows", () => {
    expect(migration).toContain("row_number() OVER");
    const executable = migration
      .split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
    expect(executable).not.toMatch(/\bDROP TABLE\b|\bDELETE FROM\b|\bTRUNCATE\b/);
  });
  it("it carries a rollback block and converges", () => {
    expect(migration).toContain("ROLLBACK:");
    expect(migration).toContain("did not converge");
  });

  it("the portal derives the capture row number from rows, not from consumed attempts", () => {
    expect(portalFn).toContain("async function nextCaptureSequence");
    expect(portalFn).toContain("const captureSequence = await nextCaptureSequence(");
    expect(portalFn).toContain("attempt_number: captureSequence");
    expect(portalFn).toContain("capture_sequence: captureSequence");
    // The defective formula must be gone from the submission path.
    expect(portalFn).not.toContain("attempt_number: used + 1");
    expect(portalFn).not.toContain("capture_sequence: used + 1");
  });
  it("only an idempotency-key collision reports already_processing", () => {
    expect(portalFn).toContain("const onIdempotencyKey = /idempotency/i.test(");
    expect(portalFn).toContain("const retrySequence = await nextCaptureSequence(");
    // The allowance still comes from the consumed-attempt counter.
    expect(portalFn).toContain("attempts_remaining: MAX_VERIFICATION_ATTEMPTS - used");
  });

  it("the party-type picker offers exactly the nine types the CHECK allows", () => {
    const list = partyPanel.slice(
      partyPanel.indexOf("const PARTY_TYPES = ["),
      partyPanel.indexOf("];", partyPanel.indexOf("const PARTY_TYPES = [")),
    );
    for (const t of ["case_subject", "co_purchaser", "director", "trustee", "beneficial_owner",
      "authorised_representative", "donor", "private_lender", "other"]) {
      expect(list).toContain(t);
    }
    // "beneficiary" is not in the CHECK — offering it produced a server error.
    expect(list).not.toContain("beneficiary");
  });
});

describe("staging-retarget tooling safety", () => {
  const plugin = readFileSync("vite-staging-target.ts", "utf8");
  const config = readFileSync("vite.config.ts", "utf8");

  it("only `--mode staging` can retarget, so a .env.local cannot alter a default build", () => {
    // Gating on the variables alone was not enough: loadEnv reads the dotenv
    // FILE, so a plain build on a machine with a .env.local produced a
    // staging-pointing bundle carrying a STAGING banner.
    expect(plugin).toContain('export const STAGING_MODE = "staging"');
    expect(plugin).toContain("if (mode !== STAGING_MODE)");
    expect(config).toContain("stagingTargetPlugin(mode,");
  });
  it("it refuses to run rather than silently target production", () => {
    expect(plugin).toContain("points at the production project");
    expect(plugin).toContain("Refusing to start");
    // A staging mode with no configuration must throw, not fall through.
    expect(plugin).toContain("Refusing to start rather than");
  });
  it("a retargeted page carries a visible STAGING indicator and a machine marker", () => {
    expect(plugin).toContain("npc-staging-banner");
    expect(plugin).toContain("not production");
    expect(plugin).toContain("window.__SUPABASE_TARGET__");
  });
  it("no staging credential is committed", () => {
    expect(plugin).not.toContain("yncczbrmicjebjepfave");
    const gitignore = readFileSync(".gitignore", "utf8");
    expect(gitignore).toContain(".env.*");
  });
});

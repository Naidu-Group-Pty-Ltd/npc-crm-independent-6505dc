import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Source contracts for the AML screening repair (Defects A–H).
 *
 * House style: the edge functions are Deno code, so these tests hold the
 * source to its contract — the behavioural halves live in
 * localListsScreening.test.ts and partyScreeningProjection.test.ts against
 * the pure modules the functions import.
 */

const root = join(__dirname, "../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const verification = read("supabase/functions/aml-verification/index.ts");
const cases = read("supabase/functions/aml-cases/index.ts");
const risk = read("supabase/functions/aml-risk/index.ts");
const monitoring = read("supabase/functions/aml-monitoring/index.ts");
const worker = read("supabase/functions/cross-portal-outbox-worker/index.ts");
const screeningConsumer = read("supabase/functions/_shared/aml/screeningConsumer.ts");
const providers = read("supabase/functions/_shared/aml/providers/index.ts");
const migration = read("supabase/migrations/20260807120000_aml_screening_repair.sql");
const refreshWorkflow = read(".github/workflows/aml-sanctions-refresh.yml");
const clientPortal = read("supabase/functions/aml-client-portal/index.ts");
const financePortal = read("supabase/functions/aml-finance/index.ts");
const evidenceModule = read("supabase/functions/_shared/aml/pepEvidence.pure.ts");

describe("Defect B — provider selection is server-side only", () => {
  it("run_screening never passes a request-controlled provider hint", () => {
    const op = verification.slice(
      verification.indexOf('case "run_screening"'),
      verification.indexOf('case "list_screening"'));
    expect(op).not.toContain("preferred");
    expect(op).not.toContain("body.provider");
    expect(op).toContain("getScreeningProvider({ resolved, admin })");
  });

  it("defaults the scope to the provider's declared coverage, not a wish-list", () => {
    const op = verification.slice(
      verification.indexOf('case "run_screening"'),
      verification.indexOf('case "list_screening"'));
    expect(op).not.toContain('["pep", "sanctions", "adverse_media"];');
    expect(op).toContain("provider.supportedScopes");
  });

  it("stale list data is recorded as screening-incomplete, never as an outcome", () => {
    const op = verification.slice(
      verification.indexOf('case "run_screening"'),
      verification.indexOf('case "list_screening"'));
    expect(op).toContain("list_data_unavailable");
    expect(op).toContain('status: "pending"');
  });
});

describe("Defect C — queueing a party creates real, idempotent screening work", () => {
  it("the migration emits aml.screening.requested transactionally on the queued transition", () => {
    expect(migration).toContain("aml.tg_emit_party_screening_requested");
    expect(migration).toContain("'aml.screening.requested'");
    expect(migration).toContain("NEW.state = 'queued'");
    expect(migration).toContain("OLD.state IS DISTINCT FROM NEW.state");
    expect(migration).toContain("ON CONFLICT (idempotency_key) DO NOTHING");
    // Identifiers only — no name, DOB or match content in the outbox payload.
    expect(migration).toContain("'party_screening_subject_id', NEW.id");
    expect(migration).not.toMatch(/payload[\s\S]{0,200}screened_name/);
  });

  it("the worker routes the event to the screening consumer, ahead of the aml.* catch-all", () => {
    expect(worker).toContain(
      "import { processScreeningEvent } from '../_shared/aml/screeningConsumer.ts'",
    );
    const routing = worker.indexOf("event.event_type==='aml.screening.requested'");
    const catchAll = worker.indexOf("startsWith('aml.')");
    expect(routing).toBeGreaterThan(-1);
    expect(routing).toBeLessThan(catchAll);
  });

  it("the consumer claims through the shared rule: duplicates succeed, in-flight deliveries retry", () => {
    expect(screeningConsumer).toContain("screeningClaimDecision");
    // A terminal-state duplicate succeeds silently; an in-flight subject
    // throws so the event is retried — succeeding would mark the event
    // processed and orphan a dead worker's 'processing' subject forever.
    expect(screeningConsumer).toContain("if (decision === 'obsolete') return");
    expect(screeningConsumer).toContain("screening_in_flight");
    expect(screeningConsumer).not.toMatch(/if \(!claimed\) return;/);
    expect(screeningConsumer).toMatch(/state\.in\.\(queued,error\)/);
  });

  it("candidate inserts are keyed for redelivery idempotency", () => {
    expect(screeningConsumer).toContain("matchDedupKey");
  });

  it("executes through the canonical engine — provider factory, metrics, screening_checks, screening_matches", () => {
    expect(screeningConsumer).toContain("resolveTenantProvider");
    expect(screeningConsumer).toContain("getScreeningProvider({ resolved, admin: db })");
    expect(screeningConsumer).toContain("runWithMetrics");
    expect(screeningConsumer).toContain("from('screening_checks')");
    expect(screeningConsumer).toContain("from('screening_matches')");
  });

  it("passes every identifying detail the party carries — DOB, aliases, country — inventing none", () => {
    expect(screeningConsumer).toContain("date_of_birth");
    expect(screeningConsumer).toContain("aliases: subject.aliases");
    expect(screeningConsumer).toContain("country");
  });

  it("projects the party from canonical matches and links the check with list evidence", () => {
    expect(screeningConsumer).toContain("projectPartyScreeningState");
    expect(screeningConsumer).toContain("screening_check_id: args.checkId");
    expect(screeningConsumer).toContain("list_version");
    expect(screeningConsumer).toContain("refresh_due_at: computeRefreshDueAt");
  });

  it("a terminal check is resumed from durable state — decided BEFORE any provider resolution", () => {
    expect(screeningConsumer).toContain("checkReuseDecision");
    expect(screeningConsumer).toContain("resumableFromDurableState");
    expect(screeningConsumer).toContain("completeCanonicalPersistence");
    const resumeAt = screeningConsumer.indexOf("checkReuseDecision(linked, subject)");
    const providerAt = screeningConsumer.indexOf("resolveTenantProvider(db, tenantId");
    expect(resumeAt).toBeGreaterThan(-1);
    expect(resumeAt).toBeLessThan(providerAt);
  });

  it("candidates are persisted BEFORE the terminal status, so a terminal check is always resumable", () => {
    const body = screeningConsumer.slice(screeningConsumer.indexOf("let result;"));
    const matchesAt = body.indexOf("from('screening_matches').insert");
    const terminalAt = body.indexOf("status: result.status");
    expect(matchesAt).toBeGreaterThan(-1);
    expect(matchesAt).toBeLessThan(terminalAt);
    // The durable summary carries the list versions recovery needs.
    expect(body).toContain("list_versions: (result.raw as any)?.list_versions");
  });

  it("technical failure projects to error — retried and dead-lettered, never clear", () => {
    expect(screeningConsumer).toContain("state: 'error'");
    expect(screeningConsumer).toContain("error_category: category");
    expect(screeningConsumer).toContain("list_data_unavailable");
    // Re-thrown so the platform outbox applies backoff / dead-lettering.
    expect(screeningConsumer).toMatch(/throw err;/);
    expect(screeningConsumer).not.toContain("state: 'completed',\n      error_category");
  });
});

describe("Defect D — one authoritative adjudication mechanism", () => {
  const adjudicateOp = cases.slice(
    cases.indexOf("case 'adjudicate_party_screening'"),
    cases.indexOf("case 'list_pep_determinations'"));

  it("party adjudication resolves the canonical match with a hash-chained resolution", () => {
    expect(adjudicateOp).toContain("match_id");
    expect(adjudicateOp).toContain("match_resolutions");
    expect(adjudicateOp).toContain("prev_hash");
    expect(adjudicateOp).toContain("from('screening_matches')");
  });

  it("a subject with no canonical screening cannot be adjudicated into a finding", () => {
    expect(adjudicateOp).toContain("no_canonical_screening");
    expect(adjudicateOp).toContain("canonical_match_required");
  });

  it("party state is derived from the canonical match set, not asserted", () => {
    expect(adjudicateOp).toContain("projectPartyScreeningState");
    expect(adjudicateOp).not.toContain("state: outcome");
  });

  it("resolve_match in aml-verification reprojects linked party subjects the same way", () => {
    const resolveOp = verification.slice(
      verification.indexOf('case "resolve_match"'),
      verification.indexOf("list_verification_checks"));
    expect(resolveOp).toContain("projectPartyScreeningState");
    expect(resolveOp).toContain("party_screening_subjects");
  });

  it("adjudication stays human: reviewer or MLRO only", () => {
    expect(adjudicateOp).toContain("roles.has('reviewer') || roles.has('mlro')");
  });
});

describe("Defect E — auditable PEP determination", () => {
  const pepOp = cases.slice(cases.indexOf("case 'record_pep_determination'"));

  it("records subject, result, classification, methods, rationale, who and when, hash-chained", () => {
    for (const needle of [
      "subject_name", "result", "pep_type", "pep_relationship",
      "methods", "rationale", "determined_by", "determined_at",
      "row_hash", "review_due_at",
    ]) expect(pepOp).toContain(needle);
  });

  it("the evidence is judged by the shared contract, not by a literal in this handler", () => {
    // The rule moved to `_shared/aml/pepEvidence.pure.ts` so the dialog that
    // ASKS for the evidence and the endpoint that ACCEPTS it cannot drift into
    // two standards. A determination with no sources, with only the customer's
    // own declaration, or with a source that recorded no result is refused
    // there — a guess is still not a determination.
    expect(pepOp).toContain("normalisePepMethods");
    expect(pepOp).toContain("assessPepEvidence");
    expect(pepOp).toContain("pep_evidence_insufficient");
    // The handler must not re-implement the judgement it delegates.
    expect(pepOp).not.toContain("methods.length === 0 ?");
  });

  it("a sanctions register is refused as a source of political-exposure information", () => {
    // Absence from the DFAT consolidated list is not evidence that somebody is
    // not a PEP; it was the dialog's own worked example, which is how the
    // record came to rest on it.
    expect(evidenceModule).toContain("namesSanctionsRegister");
    expect(evidenceModule).toContain("dfat consolidated");
    expect(evidenceModule).toContain("sanctions list");
    expect(evidenceModule).toContain("ofac");
  });

  it("at least one source independent of the customer, and a searched source says what came back", () => {
    expect(evidenceModule).toContain("independentMethods");
    expect(evidenceModule).toContain("At least one source independent of the customer");
    expect(evidenceModule).toContain("A source with no result is");
  });

  it("the office-holder index can surface a candidate and never a clearance", () => {
    const searchOp = cases.slice(
      cases.indexOf("case 'search_pep_officeholders'"),
      cases.indexOf("case 'defer_pep_determination'"));
    expect(searchOp.length).toBeGreaterThan(0);
    // Reviewer or MLRO, and the identity is derived like a determination's.
    expect(searchOp).toContain("roles.has('reviewer') || roles.has('mlro')");
    expect(searchOp).toContain("party_screening_subject_id does not belong to this case");
    // The verdict is the shared module's, so a caller cannot get a bare
    // candidate list with no coverage beside it.
    expect(searchOp).toContain("searchVerdict");
    expect(searchOp).toContain("describeCoverage");
    // Coverage is gathered BEFORE the search and returned on every branch,
    // including the empty one — which is the branch that needs it.
    expect(searchOp.indexOf("describeCoverage"))
      .toBeLessThan(searchOp.indexOf("overlaps('normalised_names'"));
    // A database fault is never returned as "nothing found".
    expect(searchOp).toContain("pep_index_search_failed");
    // Read-only: it writes no determination, no source and no event.
    expect(searchOp).not.toContain(".insert(");
    expect(searchOp).not.toContain("appendCaseEvent");
  });

  it("names are searched with the SAME normalisation the index is written with", () => {
    // A query that normalised differently from the loader would match
    // nothing, which looks exactly like an index that works.
    const searchOp = cases.slice(
      cases.indexOf("case 'search_pep_officeholders'"),
      cases.indexOf("case 'defer_pep_determination'"));
    expect(searchOp).toContain("normaliseName(searchName)");
    expect(cases).toContain('from "../_shared/aml/matching.ts"');
  });

  it("a deferral records no determination — it is not a third outcome", () => {
    const deferOp = cases.slice(
      cases.indexOf("case 'defer_pep_determination'"),
      cases.indexOf("case 'defer_pep_determination'") + 4000);
    expect(cases).toContain("case 'defer_pep_determination'");
    expect(deferOp).toContain("assessPepDeferral");
    expect(deferOp).toContain("determination_recorded: false");
    expect(deferOp).not.toContain("from('pep_determinations').insert");
    expect(deferOp).toContain("roles.has('reviewer') || roles.has('mlro')");
  });

  it("a pep result requires the AUSTRAC classification", () => {
    expect(pepOp).toContain("foreign|domestic|international_organisation");
    expect(pepOp).toContain("self|family_member|close_associate");
  });

  it("subject identity is derived from the canonical record, never asserted by the caller", () => {
    expect(pepOp).toContain("subject_identity_mismatch");
    expect(pepOp).toContain("subject_name: derivedName");
    expect(pepOp).toContain("party_type: derivedPartyType");
  });

  it("supersession is atomic — a BEFORE INSERT trigger plus a one-current unique index, not an app-side update", () => {
    expect(pepOp).not.toContain(".update({ superseded_at");
    expect(pepOp).toContain("concurrent_determination");
    expect(migration).toContain("trg_aml_pep_det_supersede");
    expect(migration).toContain("BEFORE INSERT ON aml.pep_determinations");
    expect(migration).toContain("idx_aml_pep_det_one_current");
    expect(migration).toContain("pep_result_requires_classification");
    expect(migration).toContain("idx_aml_pep_det_review");
    expect(migration).toContain("'pep_determination', 7, 'AML/CTF Act s 107'");
  });

  it("the supersession self-reference is checked at COMMIT, not inside the trigger's UPDATE", () => {
    // The BEFORE INSERT trigger stamps the closing row's
    // superseded_by_determination_id with NEW.id while NEW is not yet
    // inserted. With an immediately-checked FK that UPDATE fails 23503, so
    // recording ANY superseding determination errors — found by applying the
    // migration to a real database and inserting a second determination.
    // Deferring the check to commit (the new row exists by then) is the fix;
    // the convergence block asserts it so a re-generated table cannot regress.
    expect(migration).toMatch(
      /superseded_by_determination_id uuid REFERENCES aml\.pep_determinations\(id\)\s*\n\s*DEFERRABLE INITIALLY DEFERRED/,
    );
    expect(migration).toContain(
      "ALTER CONSTRAINT pep_determinations_superseded_by_determination_id_fkey",
    );
    expect(migration).toMatch(/condeferrable AND condeferred/);
  });

  it("EDD, SoF/SoW and senior-manager approval are linked to the current determination", () => {
    const inputs = risk.slice(
      risk.indexOf("async function authoritativeMandatoryInputs"),
      risk.indexOf("function blockingHolds"));
    expect(inputs).toContain("pepEvidenceSatisfied");
    expect(inputs).toContain("latestPepDeterminedAt");
    expect(inputs).toContain("source_of_funds");
    expect(inputs).toContain("source_of_wealth");
    const resolveOp = risk.slice(risk.indexOf('op === "resolve_approval"'), risk.indexOf("list_senior_managers"));
    expect(resolveOp).toContain("no_current_pep_determination");
    expect(resolveOp).toContain("pep_determination_ids");
  });
});

describe("Risk integration — PEP feeds risk without becoming a rejection", () => {
  it("authoritative PEP inputs come from the recorded determination, EDD case and approvals queue", () => {
    const fn = risk.slice(risk.indexOf("async function authoritativeMandatoryInputs"));
    expect(fn).toContain("pep_determinations");
    expect(fn).toContain("pepControlsRequired");
    expect(fn).toContain("edd_cases");
    expect(fn).toContain("pep_service_approval");
  });

  it("PEP is represented separately from sanctions — never as a sanctions match", () => {
    const fn = risk.slice(
      risk.indexOf("async function authoritativeMandatoryInputs"),
      risk.indexOf("function blockingHolds"));
    expect(fn).toContain('inputs.pep = ');
    // The sanctions input remains keyed on canonical confirmed sanctions
    // matches only; the pep inputs never touch inputs.screening.
    expect(fn).toContain('.eq("match_type", "sanctions")');
    expect(fn).not.toMatch(/inputs\.screening[^\n]*pep/);
  });

  it("clearance blocks on incomplete, unresolved and stale required screening — and on missing PEP work", () => {
    const fn = risk.slice(
      risk.indexOf("async function screeningCompletenessReasons"),
      risk.indexOf("async function clearanceBlockReasons"));
    expect(fn).toContain("partyScreeningOutstanding");
    expect(fn).toContain("party_screening_incomplete");
    expect(fn).toContain("party_screening_unresolved");
    expect(fn).toContain("party_screening_stale");
    expect(fn).toContain("unadjudicated_screening_matches");
    expect(fn).toContain("case_screening_missing");
    expect(fn).toContain("pep_determination_outstanding");
  });

  it("PEP EDD and senior-manager approval gate clearance explicitly", () => {
    const fn = risk.slice(
      risk.indexOf("async function clearanceBlockReasons"),
      risk.indexOf("* Tenant-scoped authorization"));
    expect(fn).toContain("pep_edd_outstanding");
    expect(fn).toContain("pep_senior_manager_approval_outstanding");
    expect(fn).toContain("screeningCompletenessReasons");
  });

  it("the seeded triggers keep PEP a hold, not a sanctions-style block", () => {
    expect(migration).toContain("'pep_edd_outstanding'");
    expect(migration).toContain("'pep_approval_outstanding'");
    expect(migration).toMatch(/'pep_edd_outstanding'[\s\S]{0,400}'hold'/);
    expect(migration).not.toMatch(/pep[\s\S]{0,200}sanctioned/i);
  });

  it("straight-through auto-clearance cannot bypass the completeness gate", () => {
    const op = risk.slice(risk.indexOf('if (op === "evaluate")'), risk.indexOf('if (op === "list_assessments")'));
    expect(op).toContain("stBlockers");
    expect(op).toContain("clearanceBlockReasons");
    expect(op).toContain("stEligible && stBlockers.length === 0");
  });

  it("senior manager is not silently the MLRO — resolution requires a recorded designation", () => {
    const op = risk.slice(risk.indexOf('op === "resolve_approval"'), risk.indexOf("list_senior_managers"));
    expect(op).toContain("senior_manager_designations");
    expect(op).toContain("senior_manager_designation_required");
    expect(migration).toContain("senior_manager_designations");
  });
});

describe("missing_mandatory — every non-final state is outstanding", () => {
  it("get_submission_review uses the shared outstanding rule, not a two-state list", () => {
    // The review is composed once in `composeSubmissionReview`, which both
    // `get_submission_review` and `store_submission_record` call.
    const op = cases.slice(
      cases.indexOf("async function composeSubmissionReview"),
      cases.indexOf("const __corsWrappedHandler"));
    expect(op).toContain("isPartyScreeningMissing");
    expect(op).not.toContain("['not_started', 'possible_match'].includes(s.state)");
  });
});

describe("Defect H — ongoing screening is party-aware", () => {
  it("the scheduled scan queues never-screened and refresh-overdue required parties through the same canonical path", () => {
    const fn = monitoring.slice(monitoring.indexOf("async function runScheduledScans"));
    expect(fn).toContain("party_screening_subjects");
    expect(fn).toContain('.eq("required", true).eq("state", "not_started")');
    expect(fn).toContain('lt("refresh_due_at"');
    expect(fn).toContain('state: "queued"');
    // No second screening implementation: the scan only flips state; the
    // outbox trigger + worker execute it.
    expect(fn).not.toContain("getScreeningProvider");
  });

  it("ended relationships stay excluded from every party pass", () => {
    const fn = monitoring.slice(monitoring.indexOf("async function runScheduledScans"));
    const partySection = fn.slice(fn.indexOf("Party-aware screening currency"));
    expect(partySection.split("isEnded(").length).toBeGreaterThanOrEqual(4);
  });

  it("PEP determinations due for review are surfaced", () => {
    const fn = monitoring.slice(monitoring.indexOf("async function runScheduledScans"));
    expect(fn).toContain("pep_determinations");
    expect(fn).toContain("PEP determination review due");
  });

  it("the case monitoring summary reflects the most urgent required party state", () => {
    const op = monitoring.slice(monitoring.indexOf('op === "case_monitoring_summary"'));
    expect(op).toContain("party_screening_subjects");
    expect(op).toContain("most_urgent_state");
    expect(op).toContain("next_refresh_due_at");
  });
});

describe("Nightly sanctions refresh failure mode", () => {
  it("a scheduled run without write credentials fails loudly instead of dry-running", () => {
    expect(refreshWorkflow).toContain("exit 1");
    expect(refreshWorkflow).toContain("::error::");
    expect(refreshWorkflow).not.toContain("running a dry run only");
  });

  it("an explicit dry run remains available and needs no credentials", () => {
    expect(refreshWorkflow).toContain("Dry run (explicitly requested)");
    expect(refreshWorkflow).toContain("github.event.inputs.dry_run == 'true'");
    // The credential check is skipped for a deliberate dry run.
    expect(refreshWorkflow).toMatch(/id: creds\n\s+if: github\.event\.inputs\.dry_run != 'true'/);
  });

  it("does not weaken the parser tests, hashing or prune protections", () => {
    expect(refreshWorkflow).toContain("npm run test:aml-sanctions");
    const loader = read("scripts/aml/load-sanctions-lists.mjs");
    expect(loader).toContain("PRUNE_SHRINK_FLOOR");
    expect(loader).toContain("sha256");
    expect(loader).toContain("refusing to publish an empty list");
  });
});

describe("Privacy — screening detail stays out of the portals", () => {
  it.each([
    ["client portal", clientPortal],
    ["finance portal", financePortal],
  ])("the %s never reads screening matches, party screening or PEP determinations", (_label, source) => {
    expect(source).not.toContain("screening_matches");
    expect(source).not.toContain("party_screening_subjects");
    expect(source).not.toContain("pep_determinations");
    expect(source).not.toContain("match_resolutions");
    expect(source).not.toContain("senior_manager_designations");
  });

  it("the outbox event carries identifiers only", () => {
    expect(migration).not.toMatch(/jsonb_build_object\([\s\S]{0,200}(screened_name|date_of_birth|match)/);
  });
});

describe("CI and security inventory", () => {
  const ci = read(".github/workflows/ci.yml");
  const pkg = read("package.json");

  it("CI runs the AML suites, parser tests and both boundary inventories", () => {
    expect(ci).toContain("npx vitest run src/lib/aml src/components/aml src/pages/aml");
    expect(ci).toContain("npm run test:aml-sanctions");
    expect(ci).toContain("npm run security:edd-boundary");
    expect(ci).toContain("npm run security:screening-boundary");
  });

  it("the screening/PEP boundary inventory is a registered script", () => {
    expect(pkg).toContain('"security:screening-boundary": "node scripts/security/check-aml-screening-boundary.mjs"');
  });
});

describe("Sanctions freshness — round 2 hardening", () => {
  it("a failed latest sync attempt fails closed in its own right", () => {
    expect(providers).toContain('attemptStatus === "failed"');
    expect(providers).toContain("latest sync attempt failed");
  });

  it("freshness reads are per-list, so a noisy list cannot hide a quiet one's state", () => {
    expect(providers).toContain("latestSuccessFor");
    expect(providers).toContain("latestAttemptFor");
    expect(providers).toMatch(/eq\("list_code", code\)/);
  });

  it("a zero-entry 'success' is not screening data", () => {
    expect(providers).toContain("Number(success.entry_count ?? 0) > 0");
  });
});

describe("KYC / IDV is untouched by this repair", () => {
  it("the IDV provider path and verification consumer keep their shape", () => {
    // The IDV factory still refuses simulators in production and the
    // verification consumer still owns identity outcomes — this repair is
    // screening-only.
    expect(providers).toContain("getIdvProvider");
    expect(providers).toContain("makeSelfHostedIdvProvider");
    const verificationConsumer = read("supabase/functions/cross-portal-outbox-worker/verificationConsumer.ts");
    expect(verificationConsumer).toContain("processVerificationEvent");
    expect(verificationConsumer).toContain("attempt_consumed");
  });
});

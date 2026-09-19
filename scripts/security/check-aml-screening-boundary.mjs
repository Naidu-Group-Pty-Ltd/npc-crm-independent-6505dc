#!/usr/bin/env node
/**
 * AML screening/PEP authorization boundary inventory.
 *
 * Companion to check-aml-edd-mlro-boundary.mjs. Every privileged screening or
 * PEP operation added by the screening repair is inventoried here with the
 * boundary it must keep, so a refactor that loosens one fails CI rather than
 * shipping. Source-text checks, deliberately: these are Deno modules and this
 * script must run in plain Node with no dependencies.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const cases = readFileSync("supabase/functions/aml-cases/index.ts", "utf8");
const risk = readFileSync("supabase/functions/aml-risk/index.ts", "utf8");
const verification = readFileSync("supabase/functions/aml-verification/index.ts", "utf8");
const consumer = readFileSync(
  "supabase/functions/_shared/aml/screeningConsumer.ts", "utf8");
const migration = readFileSync(
  "supabase/migrations/20260807120000_aml_screening_repair.sql", "utf8");

const slice = (source, from, to) => {
  const start = source.indexOf(from);
  assert.ok(start >= 0, `expected to find ${JSON.stringify(from)}`);
  const end = to ? source.indexOf(to, start) : source.length;
  assert.ok(end > start, `expected ${JSON.stringify(to)} after ${JSON.stringify(from)}`);
  return source.slice(start, end);
};

/* ── Party adjudication: canonical, human, reviewer/MLRO ─────────────────── */
const adjudicate = slice(cases, "case 'adjudicate_party_screening'", "case 'list_pep_determinations'");
assert.match(adjudicate, /roles\.has\('reviewer'\) \|\| roles\.has\('mlro'\)/,
  "adjudicate_party_screening must require reviewer or MLRO");
assert.match(adjudicate, /canonical_match_required/,
  "adjudication without a canonical match id must be refused");
assert.match(adjudicate, /from\('match_resolutions'\)\.insert/,
  "adjudication must write the hash-chained canonical resolution");
assert.match(adjudicate, /projectPartyScreeningState/,
  "party state must be derived from canonical matches");
assert.doesNotMatch(adjudicate, /state:\s*outcome/,
  "party state must never be set directly from the caller's outcome");

/* ── PEP determination: reviewer/MLRO, derived identity, trigger supersession ── */
const pepOp = slice(cases, "case 'record_pep_determination'", "default:");
assert.match(pepOp, /roles\.has\('reviewer'\) \|\| roles\.has\('mlro'\)/,
  "record_pep_determination must require reviewer or MLRO");
assert.match(pepOp, /subject_identity_mismatch/,
  "a caller-supplied subject name that mismatches the canonical identity must be refused");
assert.match(pepOp, /subject_name: derivedName/,
  "the determination's subject identity must be derived, never asserted");
assert.match(pepOp, /party_type: derivedPartyType/,
  "the determination's party linkage must come from the subject row");
assert.doesNotMatch(pepOp, /\.update\(\{ superseded_at/,
  "supersession must be the migration trigger's job (atomic), not an app-side update");
assert.match(pepOp, /concurrent_determination/,
  "a concurrent duplicate current determination must surface as a conflict");
/*
 * The evidence rule moved into `_shared/aml/pepEvidence.pure.ts`, which the
 * dialog renders from and this endpoint enforces — one module, so what an
 * operator is asked for and what the server accepts cannot become two
 * standards. The literal that used to be asserted here lived in the handler.
 *
 * `assessPepEvidence` refuses a determination with no sources, one resting
 * only on the customer's own declaration, one whose searched source recorded
 * no result, and one naming a SANCTIONS register as a source of political-
 * exposure information. A guess is still not a determination.
 */
assert.match(pepOp, /normalisePepMethods/,
  "recorded methods must be normalised before they are judged");
assert.match(pepOp, /assessPepEvidence/,
  "a determination's evidence must be judged by the shared contract");
assert.match(pepOp, /pep_evidence_insufficient/,
  "a determination whose evidence does not reach the standard must be refused");

const evidence = readFileSync(
  "supabase/functions/_shared/aml/pepEvidence.pure.ts", "utf8");
assert.match(evidence, /Record at least one source that was checked/,
  "a determination without recorded methods must be refused");
assert.match(evidence, /At least one source independent of the customer/,
  "the customer's own declaration can never be the whole of the evidence");
assert.match(evidence, /namesSanctionsRegister/,
  "a sanctions register must be refused as a source of PEP information");

/* ── Deferral: a method, never a third outcome ───────────────────────────── */
const deferOp = slice(cases, "case 'defer_pep_determination'", "default:");
assert.match(deferOp, /roles\.has\('reviewer'\) \|\| roles\.has\('mlro'\)/,
  "defer_pep_determination must require reviewer or MLRO");
assert.match(deferOp, /determination_recorded: false/,
  "a deferral must state in the record that no determination was reached");
assert.doesNotMatch(deferOp, /from\('pep_determinations'\)\.insert/,
  "a deferral must write no determination row — it is not a third outcome");

/* ── The office-holder index can surface a candidate, never a clearance ──── */
const indexOp = slice(cases, "case 'search_pep_officeholders'", "case 'defer_pep_determination'");
assert.match(indexOp, /roles\.has\('reviewer'\) \|\| roles\.has\('mlro'\)/,
  "search_pep_officeholders must require reviewer or MLRO");
assert.match(indexOp, /party_screening_subject_id does not belong to this case/,
  "the searched identity must be derived from the case, never asserted");
assert.match(indexOp, /searchVerdict/,
  "the search must return the shared verdict, so coverage travels with it");
assert.match(indexOp, /pep_index_search_failed/,
  "a search fault must be a technical condition, never an empty result");
assert.doesNotMatch(indexOp, /\.insert\(/,
  "searching the index must write nothing");

/* ── The screening engine screens; it never determines ──────────────────── */
const runOp = slice(cases, "case 'run_pep_screening'", "case 'review_pep_screening_candidate'");
assert.match(runOp, /roles\.has\('reviewer'\) \|\| roles\.has\('mlro'\)/,
  "run_pep_screening must require reviewer or MLRO");
assert.match(runOp, /from\('pep_screening_runs'\)\.insert/,
  "a screening run must be recorded as a run");
assert.doesNotMatch(runOp, /from\('pep_determinations'\)/,
  "a screening run must never write a determination — it screens, it does not determine");
assert.match(runOp, /determination_recorded: false/,
  "the record must state that no determination was reached");
assert.match(runOp, /party_screening_subject_id does not belong to this case/,
  "the screened identity must be derived from the case, never asserted");

const engine = readFileSync(
  "supabase/functions/_shared/aml/pepScreeningEngine.pure.ts", "utf8");
/*
 * The verdict vocabulary and the determination vocabulary must stay disjoint.
 * If a run could ever spell `not_pep`, a search would become a conclusion by
 * vocabulary alone — which is the exact failure this whole stage is built to
 * prevent, arriving through the back door of an automated result.
 */
for (const forbidden of ["'not_pep'", "'pep'", "'clear'", "'cleared'", "'pass'"]) {
  const verdictUnion = engine.slice(
    engine.indexOf("export type PepScreeningVerdict"),
    engine.indexOf("export interface PepScreeningRun"));
  assert.ok(!verdictUnion.includes(forbidden),
    `a screening verdict must never spell ${forbidden} — a search is not a determination`);
}

const reviewOp = slice(cases, "case 'review_pep_screening_candidate'",
  "case 'list_pep_screening_runs'");
assert.match(reviewOp, /roles\.has\('reviewer'\) \|\| roles\.has\('mlro'\)/,
  "reviewing a screening candidate must require reviewer or MLRO");
assert.match(reviewOp, /candidate_reason_required/,
  "a candidate decision with no reason must be refused");
assert.match(reviewOp, /candidate_not_in_run/,
  "a candidate that is not part of the run must be refused");

/* ── Senior manager: explicit designation, MLRO-managed, linked approvals ── */
const designate = slice(risk, 'op === "designate_senior_manager"', 'op === "revoke_senior_manager"');
assert.match(designate, /if \(!isMlro\)/, "designating a senior manager must be MLRO-only");
const revoke = slice(risk, 'op === "revoke_senior_manager"', "─── Conditions");
assert.match(revoke, /if \(!isMlro\)/, "revoking a senior manager must be MLRO-only");
const resolveApproval = slice(risk, 'op === "resolve_approval"', 'op === "list_senior_managers"');
assert.match(resolveApproval, /senior_manager_designations/,
  "resolving a PEP service approval must check the designation register");
assert.match(resolveApproval, /senior_manager_designation_required/,
  "an undesignated resolver must be refused, MLRO or not");
assert.match(resolveApproval, /no_current_pep_determination/,
  "approving with no current PEP determination must be refused");
assert.match(resolveApproval, /pep_determination_ids/,
  "the approval must record which determinations it covered");

/* ── PEP evidence linkage in the risk inputs ─────────────────────────────── */
const riskInputs = slice(risk, "async function authoritativeMandatoryInputs", "function blockingHolds");
assert.match(riskInputs, /pepEvidenceSatisfied/,
  "PEP EDD/approval satisfaction must go through the shared linkage rule");
assert.match(riskInputs, /source_of_funds/, "PEP EDD must consult verified source of funds");
assert.match(riskInputs, /source_of_wealth/, "PEP EDD must consult verified source of wealth");
assert.match(riskInputs, /latestPepDeterminedAt/,
  "EDD and approvals must be linked to the current determination's timestamp");
assert.match(riskInputs, /verifiedSofEddCaseIds/,
  "verified SoF must be tied to its EDD case, not counted case-wide");
assert.match(riskInputs, /verifiedSowEddCaseIds/,
  "verified SoW must be tied to its EDD case, not counted case-wide");
assert.match(riskInputs, /select\("edd_case_id"\)/,
  "SoF/SoW reads must carry the EDD linkage column");

/* ── Provider selection stays server-side ────────────────────────────────── */
const runScreening = slice(verification, 'case "run_screening"', 'case "list_screening"');
assert.doesNotMatch(runScreening, /preferred/,
  "run_screening must not pass a caller-controlled provider hint");
assert.match(runScreening, /getScreeningProvider\(\{ resolved, admin \}\)/,
  "the provider must resolve from tenant + capability + provider_configs only");

/* ── Worker consumer: projection-only writer, honest retries ─────────────── */
assert.doesNotMatch(consumer, /from\('(decisions|service_gate_decisions|case_conditions|approvals)'\)/,
  "the screening consumer must never write decisions, conditions, approvals or the gate");
assert.match(consumer, /screeningClaimDecision/,
  "claim eligibility must go through the shared rule");
assert.match(consumer, /screening_in_flight/,
  "an in-flight subject must retry the event, never silently succeed");
assert.match(consumer, /matchDedupKey/,
  "candidate inserts must be keyed for redelivery idempotency");
assert.match(consumer, /state: 'error'/, "technical failure must project to error");
assert.doesNotMatch(consumer, /state:\s*'completed'\s*,\s*\n\s*error_category/,
  "a technical failure must never project to completed");
assert.match(consumer, /checkReuseDecision/,
  "a terminal check must be resumed, never re-executed or duplicated");
assert.ok(
  consumer.indexOf("checkReuseDecision(linked, subject)") <
    consumer.indexOf("resolveTenantProvider(db, tenantId"),
  "recovery must be decided before any provider resolution");

/* ── Migration invariants ────────────────────────────────────────────────── */
assert.match(migration, /trg_aml_pep_det_supersede/,
  "PEP supersession must be a BEFORE INSERT trigger (atomic with the insert)");
assert.match(migration, /idx_aml_pep_det_one_current/,
  "a partial unique index must enforce one current determination per subject scope");
assert.match(migration, /aml_pep_determinations_service_only/,
  "pep_determinations must be service-role only");
assert.match(migration, /aml_senior_manager_designations_service_only/,
  "senior_manager_designations must be service-role only");
assert.match(migration, /ON CONFLICT \(idempotency_key\) DO NOTHING/,
  "the screening outbox emission must be idempotency-keyed");

console.log("AML screening/PEP authorization boundary checks passed");

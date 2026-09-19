# Passport Partner Distribution — Phase 1 Implementation Report

**Scope:** partner distribution, section 37A readiness and backend orchestration
for the Aurixa AML/CTF Compliance Passport.
**Baseline inspected:** `main` at `d5b2c53411e6e4f31e82d6539b1fae63d7b698f6`.
**Branch:** `claude/aurixa-passport-integration-review-toqwn3`.
**Posture:** additive. No existing AML/CTF verification, screening, reliance,
document, audit or portal behaviour was changed, and nothing was rebuilt.

---

## 1. What Phase 1 does

The Command Centre can now ask, per case and per connected partner, whether an
**issued** Passport may be distributed to that partner's portal — and, when the
answer is yes, record the distribution. Both halves are decided on the server.

Distribution is not a new capability bolted beside reliance. It is the existing
reliance architecture answering a question it already had all the facts for:
partner organisations, partner-case links, portal memberships, reliance
agreements, arrangement assessments, reliance grants, disclosure manifests, the
controlled evidence-access mechanism and the hash-chained case event log. Phase
1 adds the *decision*, not the data.

## 2. Architecture reused rather than rebuilt

| Concern | Existing component | How Phase 1 uses it |
| --- | --- | --- |
| s 37A partner eligibility | `_shared/aml/relianceEligibility.ts` → `evaluatePartnerLinkForReliance` | **Composed, not reimplemented.** Its denial codes are mapped onto distribution blockers. |
| CDD arrangement currency | `_shared/aml/relianceEligibility.ts` → `evaluateArrangementForReliance` | **Composed, not reimplemented.** Agreement status, effective/expiry dates, review currency, eligibility classification, scope and the operative assessment all remain its decision. |
| Passport currency | `_shared/aml/passport/passportState.pure.ts` → `derivePassportState` | Called with the same facts the Command view uses, so the two surfaces cannot disagree about whether a Passport is current. |
| Evidence delivery | existing partner evidence-delivery / records-request mechanism | Phase 1 **classifies availability only**. It moves no bytes and creates no request. |
| Audit | `appendCaseEvent` | The only writer used. No ad-hoc SQL touches the hash-chained history. |
| Access grant | `aml.reliance_grants` | The existing grant row is the distribution record. No parallel table. |
| Disclosure record | `aml.disclosure_manifests` | The existing manifest is what pins the disclosure. No parallel table. |

**Zero new tables. Zero migrations that alter schema or data.** The one migration
added seeds a feature flag row.

## 3. Files

### New

| File | Lines | Purpose |
| --- | --- | --- |
| `supabase/functions/_shared/aml/passport/passportDistribution.pure.ts` | 534 | The canonical readiness engine. Pure, deterministic, no IO. |
| `src/lib/aml/passport/passportDistribution.test.ts` | 447 | 34 behavioural tests over the engine (§20 battery). |
| `src/lib/aml/passport/passportDistributionOps.contract.test.ts` | 154 | 16 source contracts over the edge-function block. |
| `supabase/migrations/20260914090000_aml_passport_partner_distribution_flag.sql` | 33 | Seeds the flag `false`. No schema, no data. |
| `docs/aml/passport-distribution/PHASE_1_IMPLEMENTATION_REPORT.md` | — | This report. |

### Modified

| File | Change |
| --- | --- |
| `supabase/functions/aml-reliance/index.ts` | One new `switch` block (316 lines) carrying four operations, plus one import of `derivePassportState`. No existing operation altered. |
| `src/lib/aml/passport/index.ts` | Re-export block for the new pure module, by relative path (no `@/` alias — the module must parse under Deno). |

## 4. Server operations

Four operations on `aml-reliance`, sharing one code path:

| Operation | Kind | Behaviour |
| --- | --- | --- |
| `get_passport_distribution_readiness` | read | Evaluates every ACTIVE partner link on the case (or the subset the body names) and returns per-partner readiness, blockers, legal route, evidence classes and state. |
| `get_passport_distribution_status` | read | Same evaluation, reported against existing grants and manifests. |
| `share_passport_to_partner` | write | Distributes to one partner, if and only if the engine marks it ready. |
| `share_passport_to_partners` | write | Bulk. Per-partner outcomes; one failure never reports the others as successful. |

All four require the **MLRO** role. Reads answer with `enabled: false` when the
flag is off; writes answer `409 distribution_disabled`.

## 5. Feature flag

`aml_passport_partner_distribution` — **default `false`**, seeded by
`20260914090000_aml_passport_partner_distribution_flag.sql` with
`ON CONFLICT (key) DO NOTHING`.

Enforcement is **server-side**, read inside the function with
`flagEnabled(admin, …)`. The browser cannot turn it on and cannot route around
it. With the flag off, `grant_access`, `revoke_grant`, the Compliance Sharing
panel and the Partner Compliance Workspace behave exactly as they did before.

The flag gates **distribution only**. It never relaxes a prerequisite: with it
on, every s 37A condition the existing engine already enforced still has to be
satisfied, because the readiness engine composes those evaluators rather than
reimplementing them.

## 6. Security decisions

### 6.1 A connected partner is not an eligible partner

Finance does not equal s 37A reliance. Solicitor does not equal s 37A reliance.
Builder/Developer does not equal s 37A reliance. The legal route is **read off
the partner-case link** (`legalRoute: primary?.legal_route ?? null`) and never
inferred from partner type, portal or connection. Only `reliance` and
`outsourced_cdd` are treated as reliance routes; `independent_cdd` and
`information_share_only` are distributable as information without ever being
reported as statutory reliance.

A route is never silently upgraded or downgraded. A partner whose link records
no route yields `LEGAL_ROUTE_NOT_RECORDED` and is not ready.

### 6.2 Fail closed — unknown is deny

Every blocker is a positive finding of a satisfied condition's absence, not an
optimistic default. A missing organisation, missing membership, missing
agreement, missing assessment, missing consent, missing attestation or unparsable
date all produce a blocker. `ready` is `hardBlockers.length === 0`, and hard
blockers are everything except the two reportable classes
(`DISCLOSURE_CONFIGURATION_REQUIRED`, `EVIDENCE_AVAILABILITY_INCOMPLETE`).

Blocker vocabulary: `PASSPORT_NOT_ISSUED`, `PASSPORT_REFRESH_REQUIRED`,
`PASSPORT_SUSPENDED`, `PASSPORT_SUPERSEDED`, `PARTNER_LINK_REQUIRED`,
`PARTNER_CLASSIFICATION_REQUIRED`, `PORTAL_MEMBERSHIP_REQUIRED`,
`CLIENT_SHARING_CONSENT_REQUIRED`, `CDD_ARRANGEMENT_REQUIRED`,
`ARRANGEMENT_ASSESSMENT_REQUIRED`, `ARRANGEMENT_REVIEW_OVERDUE`,
`DISCLOSURE_CONFIGURATION_REQUIRED`, `EVIDENCE_AVAILABILITY_INCOMPLETE`,
`LEGAL_ROUTE_NOT_RECORDED`, `DISTRIBUTION_NOT_ENABLED`.

### 6.3 The body is never the authority

The request names a case and, optionally, which partners to consider. It cannot
state a conclusion. The contract suite asserts the block never reads
`body.partner_is_eligible`, `body.section_37a`, `body.agreement_current`,
`body.client_compliant`, `body.passport_current`, `body.legal_route`,
`body.attestation_id`, `body.consent_id`, `body.grant_id`, `body.ready` or
`body.blockers`.

A body may **narrow** the partner set and never widen it: candidates start from
the ACTIVE links on *this* case, and a requested id filters that set. Naming an
unlinked organisation cannot introduce it.

### 6.4 Portal acceptance is not statutory reliance

Portal terms and the CDD arrangement stay distinct inputs. A partner who has
accepted portal terms but has no operative, in-scope, in-date arrangement is
`CDD_ARRANGEMENT_REQUIRED` and not ready. Acceptance alone never creates
eligibility.

### 6.5 Nothing restricted crosses the boundary

`NEVER_DISCLOSABLE` names the classes that must never appear in a distribution
result: SMR and suspicious-matter material, internal suspicion, MLRO
investigation, analyst and reviewer reasoning, risk scores and methodology,
sanctions candidate matches and dismissed matches, law-enforcement and
AUSTRAC-restricted material, provider secrets and raw provider payloads,
biometric media, liveness and face-match scores. A test walks the full serialised
result of every scenario and asserts none of those tokens appears.

### 6.6 Document bytes are never duplicated

Evidence is **classified**, not copied. `classifyEvidence` reports which of seven
classes are available (`IDENTITY_KYC_AVAILABLE`, `VERIFICATION_DATA_AVAILABLE`,
`ADDRESS_EVIDENCE_AVAILABLE`, `ENTITY_EVIDENCE_AVAILABLE`,
`OWNERSHIP_EVIDENCE_AVAILABLE`, `AUTHORITY_EVIDENCE_AVAILABLE`,
`TRANSACTION_EVIDENCE_AVAILABLE`) from counts the case already holds. The
contract suite asserts the block contains no `storage.from`, `createSignedUrl`,
`storage_path`, `download(`, `copy(` or `upload(`. There are no permanent public
URLs and no raw storage paths. Availability is never fabricated: a class is
reported only when the underlying records exist.

### 6.7 No fabricated records requests

The origin does not manufacture a `partner_records_requests` row to simulate
sharing. The contract suite asserts no insert into that table.

### 6.8 Writes are minimal and audited canonically

The write path inserts into exactly two tables — `reliance_grants` and
`disclosure_manifests` — asserted as an exhaustive set. The block performs **zero**
`.update(`, `.upsert(` and `.delete(` calls, and every reference to `cases`,
`verification_checks`, `documents`, `consents` and `transactions` is a `.select`.
Audit goes through `appendCaseEvent(admin, caseId, "mlro_decision", …)`; no
statement writes `case_events` directly.

### 6.9 Version pinning

A grant is pinned to the exact current attestation (`attestation_id: att!.id`),
which carries the version and hash. If v2 supersedes v1, the v1 partner decision
is **not** rewritten — the engine reports `NEW_VERSION_AVAILABLE` against the
existing grant and leaves it intact.

### 6.10 Idempotency

`distributionStateFor` resolves an existing grant to one of `ALREADY_CURRENT`,
`NEW_VERSION_AVAILABLE`, `GRANT_EXPIRED`, `GRANT_REVOKED` or `REFRESH_REQUIRED`.
`ALREADY_CURRENT` is a no-op. Before inserting, the write path re-checks the
database directly (`eq("attestation_id", att!.id).is("revoked_at", null)`) rather
than trusting the evaluation, so two concurrent calls cannot both write.

Readiness evaluation is **evaluation, never mutation** — a test asserts the engine
does not alter its inputs.

### 6.11 Isolation

Cross-case, cross-tenant and cross-organisation isolation are each covered by a
test. A link belonging to another case, tenant or organisation is not a candidate
and cannot be made one by the body.

## 7. Readiness model

```
evaluateDistribution(ctx, candidate) → {
  ready, state, blockers, hardBlockers, legalRoute, relianceEligible,
  evidence: { classes, complete }, passport: { attestationId, version, hash },
  partner: { orgId, orgType, portal }
}
```

`evaluateDistributionBatch` maps it over candidates; `summariseBatch` reports
totals. Nothing in React decides eligibility — the browser renders the server's
answer.

## 8. Test results

All commands run at `f287170` on the working branch.

| Check | Result |
| --- | --- |
| `npx tsc --noEmit -p tsconfig.json` | clean |
| `npx vitest run src/lib/aml src/components/aml src/pages/aml` | **98 files, 1898 passed, 4 skipped, 0 failed** |
| `npx vitest run src/lib/security` | 9 files, 98 passed |
| `npm run test:aml-sanctions` | pass |
| `npm run security:edd-boundary` | pass |
| `npm run security:screening-boundary` | pass |
| `npm run security:registry` | pass |
| `npm run security:static` | pass |
| `npm run security:cors-contract` | pass |
| `npm run security:edge-check` | **not run** — requires Deno, absent from this container (`spawnSync deno ENOENT`). Environmental; unaffected by this change. Runs in CI. |
| `npm run lint` | 45 errors / 2372 warnings — **unchanged from baseline**; none in any file this phase touched |
| `npm run audit:style` | under baseline, 0 new violations |
| `npm run build` | ✓ built in 1m 13s |
| `npx esbuild supabase/functions/aml-reliance/index.ts` | parses |

Baseline before Phase 1 was 96 files / 1848 passed / 4 skipped / 0 failed. The
delta is **+2 files and +50 tests** — exactly the two files added here. **No
existing test was modified, relaxed or removed.**

### 8.1 The one thing that broke, and why the fix was in this code

`passportOps.contract.test.ts` asserts `get_passport_view` is read-only. It slices
that block as *everything between `case "get_passport_view"` and
`case "grant_access"`* — a hardcoded next-op boundary that several suites in this
repo use. The distribution block was first placed inside that span, so a
write-bearing block silently landed inside a read-only assertion and the test
failed. Correctly: the guarantee it protects had genuinely stopped holding for
the text it was reading.

The fix was to **move the distribution block**, to sit between
`list_attestations` and `get_passport_view`, so no existing suite's span changes
at all. The alternative — retargeting the existing test's boundary — would have
edited a security assertion to accommodate new code, which this programme does
not do. The reasoning is recorded in the new contract suite's header so the
placement is not "tidied" later.

## 9. Infrastructure deliberately left untouched

- No existing operation on `aml-reliance` or any other function was modified.
- No existing table, column, index, constraint, policy or trigger was altered.
- No historical migration was edited.
- No AML table was renamed and no data was duplicated.
- No new storage bucket; no change to evidence delivery, records requests or the
  controlled access mechanism.
- No change to screening, EDD, risk, monitoring, attestation issue, grant or
  revoke behaviour.
- No change to any Passport projection, stamp, seal or booklet surface.
- No UI was added in this phase.

## 10. Deferred to Phase 2

- Command Centre surface for readiness and distribution (the operations exist and
  are exercised by tests; nothing renders them yet).
- Partner-side presentation of a distributed Passport in the Finance, Solicitor/
  Conveyancer and Builder/Developer portals.
- Turning the flag on in any environment.
- Notification of the partner on distribution.

## 11. Deployment status

**Coded and committed, not deployed.** `aml-reliance` has not been redeployed and
the migration has not been applied. The flag defaults `false`, so applying the
migration alone changes no behaviour.

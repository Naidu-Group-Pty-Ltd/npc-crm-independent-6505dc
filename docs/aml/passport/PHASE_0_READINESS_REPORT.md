# Passport Phase 0 Readiness Report

Phase 0B deliverable. States the **verified** deployment position of every piece
of infrastructure the Aurixa AML/CTF Compliance Passport depends on, as of
2026-08-13, measured directly against the production Supabase project
(`dduzbchuswwbefdunfct`, "NPC Property Dashboard") — not inferred from docs.

Verification method: read-only Management API / SQL inspection (edge-function
listing, `information_schema`, `storage.buckets`, `cron.job`,
`public.feature_flags`, row counts). No production data was modified.

## 1. Status ladder, per dependency

Legend: **SRC** source implemented · **LOC** locally tested · **PROD-D**
production deployed · **PROD-V** production verified in use.

| Dependency | SRC | LOC | PROD-D | PROD-V | Evidence |
|---|---|---|---|---|---|
| `aml` schema (case spine, journey, documents, consents) | ✓ | ✓ | ✓ | ✓ (5 cases, 27 case events) | 106 tables present in prod `information_schema` |
| Canonical verification model (`verification_checks` + `processing_status` + capture-retention columns, `party_verification_links`) | ✓ | ✓ | ✓ | ✓ (6 checks) | Columns/tables confirmed in prod |
| Didit Standalone pipeline (`aml-verification-processor`, `didit-webhook`) | ✓ | ✓ | ✓ | ✓ (cron `aml-verification-processor-1min` live) | Function list + `cron.job` |
| Reliance/Passport tables (`reliance_agreements`, `compliance_attestations`, `reliance_grants`, `independent_assessments`, `reliance_access_log`, `disclosure_manifests`, `partner_organisations`, `partner_portal_memberships`, `partner_case_links`, `arrangement_assessments`) | ✓ | ✓ | ✓ | **✗ — deployed but unused: 0 attestations, 0 grants** | All 10 tables present in prod |
| `aml-reliance` edge function | ✓ | ✓ | ✓ | ✗ (flags off) | Deployed function list |
| All 22 `aml-*` edge functions | ✓ | ✓ | ✓ | partial | Deployed function list (428 functions total) |
| Attestation v2 column (`schema_version`) + disclosure manifests | ✓ | ✓ | ✓ (schema) | ✗ (flag `aml_attestation_v2` = false → issuance would be v1) | Column + table confirmed; flag read |
| Verification outbox trigger (`trg_aml_verification_outbox`) | ✓ | ✓ | ✓ | ✓ | Trigger present in prod |
| Storage buckets `aml-documents`, `aml-biometrics`, `partner-agreements` | n/a | n/a | ✓ (all private) | ✓ | `storage.buckets` |
| Crons (`aml-idv-retention-daily`, `aml-monitoring-hourly`, `aml-verification-processor-1min`) | ✓ | ✓ | ✓ | ✓ | `cron.job` |
| Partner Compliance Workspace (frontend + `aml-reliance` workspace ops) | ✓ | ✓ | ✓ (code ships in bundle/functions) | ✗ (all workspace flags false → server answers 404 `workspace_disabled`) | Flag read |
| V3 Command workspace (`aml_v3_case_workspace` etc.) | ✓ | ✓ | ✓ (code) | ✗ (all `aml_v3_*` flags false) | Flag read |
| Portal terms stack (`portal_terms_versions` / acceptances, incl. the "AML/CTF Compliance Passport Agreement") | ✓ | ✓ | ✓ | ✓ | Table confirmed |

**Correction to `docs/aml/compliance-passport.md` Phase 9 note:** that document
states "staging is not deployed … production is not deployed". Measured today,
the reliance schema and functions **are** in production. They remain **dark**
(every gating flag false, zero attestations/grants ever issued,
`aml.tenant_settings.rollout_stage = 'admin_limited'`). The statement that no
UAT/sign-off has occurred still stands — deployment ≠ verification.

## 2. Live production flag state (project `dduzbchuswwbefdunfct`)

| Flag | Value |
|---|---|
| `aml_ctf` | **enabled** |
| `aml_partner_identity`, `aml_arrangement_governance`, `aml_attestation_v2` | false |
| `aml_partner_compliance_workspace` + `aml_partner_workspace_{finance,solicitor,builder,developer}` | false |
| `aml_partner_grants_write`, `aml_partner_determinations_write`, `aml_partner_records_requests_write`, `aml_partner_evidence_delivery_write`, `aml_partner_service_blocking`, `aml_partner_event_outbox`, `aml_partner_records_retention`, `aml_partner_operations_reporting` | false |
| `aml_v3_*` (7 flags) | false |
| `aml_purchase_ready_gate`, `aml_settlement_gate` | false |

## 3. Consequences for the Passport build

1. **The Passport can be built against production-shaped infrastructure.** No
   blocking schema or function gap exists. All work proceeds behind new flags.
2. **Attestations will be schema v1 until `aml_attestation_v2` is enabled.**
   The projection layer must therefore handle both v1 (no manifest) and v2
   attestations; the partner Passport presentation requires v2 + manifests and
   ships in Phase 4, which is contingent on the flag-enable decision anyway.
3. **Partner Passport surfaces cannot be exposed as production-ready** until
   the reliance flag family is enabled through the documented rollout
   (`docs/aml/rollout/`), which requires the sign-offs that have not been
   obtained. Phase 4 code lands flag-gated and dark, exactly like the
   workspace it extends.
4. **Migration-registry drift:** production's
   `supabase_migrations.schema_migrations` high-water mark is
   `20260825000100`, yet objects from later repo migrations (through
   `20260913000000`) exist — later migrations were applied out-of-band without
   registering. Any new Passport migration must be applied the same way the
   team currently applies migrations (by hand, migration-first-then-functions
   per `docs/agreements/DEPLOYMENT.md`) and should not assume `supabase db
   push` reconciles cleanly. Flagged for the team; not remediated here.
5. **Edge function deploys are manual** (`SUPABASE_ACCESS_TOKEN` unset in CI).
   New/changed functions in this programme require a manual deploy step,
   documented per phase.
6. **Environment note:** this workspace has no Deno toolchain, so
   `security:edge-check`, `typecheck:builder-edge` and the Didit e2e harness
   cannot run here; they are recorded as not-executed in the baseline and must
   run in CI.

## 4. Feature-flag plan for the Passport

| Flag | Default | Gates |
|---|---|---|
| `aml_passport_command_view` | **false** | Command Centre passport section (Phase 2) |
| `aml_passport_client_view` | **false** | Client Portal passport view + milestone messaging (Phase 3) |
| (reuse) `aml_partner_compliance_workspace` + per-portal workspace flags | existing, false | Partner passport presentation (Phase 4) — no new partner flag |

Acceptance rule: **with both new flags OFF, the application must behave
byte-for-byte as before this programme** (asserted by the non-regression
baseline reruns each phase).

## 5. Go decision

Phase 1 (pure projection modules + server ops, everything flag-gated and
side-effect-free) is **cleared to proceed**. Phase 4 partner exposure remains
conditional on the reliance rollout decisions outside this programme's scope.

# Passport Phase 1 Implementation Report — Projection Foundation

Phase 1 of the Aurixa AML/CTF Compliance Passport integration: the pure
projection/state/stamp foundation and the two flag-gated server projections.
**No UI ships in this phase.** Everything is additive, read-only and dark by
default.

## What was inspected

- The latest Claude Design (reconciliation: `PASSPORT_DESIGN_RECONCILIATION.md`).
- `aml-reliance` (attestation payload builder, staff auth, op dispatch,
  `apply_material_change` material-currency mechanics), `aml-client-portal`
  (session custody, `resolveCase`, `overview` assembly, questionnaire field
  vocabulary in `questionnaireValidation.ts`).
- Production column shapes for every table the projections select
  (verified read-only against the live project; see the readiness report).
- The pinned AML contract suites (`amlPortalContracts.test.ts`,
  `amlScreeningRepair.contract.test.ts`) that constrain what the client
  portal function may even read.

## What was built

### Pure modules — `supabase/functions/_shared/aml/passport/`

| Module | Responsibility |
|---|---|
| `passportCredential.pure.ts` | The ONE credential format: `AUX-<case_reference>[-V<n>]`, derived, never stored; `passportVersionLabel`; `shortFingerprint` (dot-grouped SHA-256 display) |
| `passportState.pure.ts` | The ONE lifecycle derivation: `not_issued → ready_for_issuance → issued_current → superseded / refresh_required → suspended / revoked → completed_retained`, derived from attestation rows + service gate + case closure + refresh signals. No stored status exists. Precedence pinned by tests |
| `passportStamps.pure.ts` | Closed stamp vocabulary (21 codes, §16 of the execution prompt); stamps derive from records (consents, verification checks, documents, screening subjects, owners, SoF/SoW, EDD, attestations, grants, assessments, refresh obligations, transactions), each carrying `source {kind, id}`, actor, portal, timestamp and attestation-version binding. `buildClientStampInput` assembles the CLIENT stamp facts — restricted families come from the issued, sanitised attestation payload, never from case tables |
| `passportView.pure.ts` | The audience assembler (`command` / `client`). Client view is BUILT from allow-lists (questionnaire identity fields exclude the `pep`/`adverse` self-declarations by design), client history is CONSTRUCTED from stamps + the client's own requests (raw event summaries never ship), state reasons are stripped, and `assertClientSafe` deep-scans the finished view and THROWS on restricted vocabulary — fail closed |

Browser mirror: `src/lib/aml/passport/index.ts` re-exports the same modules
(the `identityDocuments` pattern), so browser and server cannot drift.

### Server ops (both read-only, both 404 `passport_disabled` when flagged off)

- **`get_passport_view`** on `aml-reliance` — Command audience. Staff auth +
  any AML role (the existing gate before the op switch); flag
  `aml_passport_command_view`. Assembles case, attestation register,
  consents, verification checks, documents+requirements, screening summary,
  PEP determination (current row, result + date only), list freshness,
  owners (via `entity_case_links`, two-step read), SoF/SoW/EDD summaries,
  transactions, partner links + grants + last-view + assessments, hash-chain
  events (Command history), client requests, tenant identity — then
  delegates every shape decision to the pure assembler. Material currency
  reads the canonical `compliance_attestations.refresh_required_at` signal
  (stamped by `apply_partner_material_change`); nothing is recomputed.
- **`get_passport`** on `aml-client-portal` — client audience. Portal
  session; flag `aml_passport_client_view`; case resolved strictly through
  the existing client-scoped `resolveCase`. **Reads none of the restricted
  families** — post-issuance milestone facts derive from the issued
  attestation payload via `buildClientStampInput`.

### Migration

`20260913100000_aml_passport_flags.sql` — seeds the two flags, `false`,
`ON CONFLICT DO NOTHING`. No schema, no data, no new tables (V1 database
policy: **zero new Passport record tables** — honoured).

### Browser API wrappers

`amlRelianceApi.getPassportView(case_id)`; `amlPortalApi.getPassport(case_id?)`.

## The contract collision that shaped the client op (worth reading)

The first cut of `get_passport` read `party_screening_subjects` (for the
client-safe "screening completed" stamp) and `beneficial_owners` (ownership
stamp). Four pinned contract tests failed:
`amlPortalContracts` "never selects risk or screening fields", "keeps
ownership internals out of the client portal entirely", "ships the
portal-safe status token", and `amlScreeningRepair` "the client portal never
reads screening matches, party screening or PEP determinations".

Per the execution prompt (§4), the tests were **not** weakened — the
implementation changed: the client portal function now never touches those
tables at all, and the client's post-issuance stamps derive from the
**issued attestation payload** (the MLRO's sanitised outward statement).
This is strictly better: what the client sees post-issuance is exactly what
the Passport attests, and the client-portal function's read surface stays as
small as it was before this phase. Consequences: the client earns the
screening stamp only once a Passport is issued, and ownership/SoF/SoW/EDD
stamps are Command-only until the attestation payload carries those facts
(a deliberate, documented narrowing — not a defect).

## Security acceptance (Phase 1 battery, §39)

Proven by `src/lib/aml/passport/passportViewContracts.test.ts` (adversarial
fixtures), `passportOps.contract.test.ts` (source contracts), and the
existing pinned suites:

- Client cannot receive sanctions/screening candidate data, internal risk
  data, MLRO/reviewer notes, partner internal assessment detail, or raw
  case-event summaries — asserted against adversarially-populated inputs,
  plus the fail-closed tripwire test (restricted key smuggled → throws).
- Client identity fields are the allow-list and only the allow-list
  (`pep`/`adverse` self-declarations excluded).
- Client view structurally lacks screening/funding/partner sections.
- Passport state derives deterministically (same input → same view, pinned).
- Stamps derive only from records; no timestamp → no stamp; the vocabulary
  is closed; EDD is the one stamp never shown to a client.
- Credential format is one helper, pinned.
- Both ops are flag-gated **before** any case read, and read-only (no
  inserts/updates/event appends) — source-contract-pinned.
- Partner ops were not touched: partner disclosure continues to be built by
  `intersectPayloadWithManifest` under grant + manifest + expiry/revocation.
  (Grant-expiry/revocation bypass tests remain the existing reliance
  suites'; this phase added no partner pathway.)
- No duplicate AML truth: no new tables, no stored state, no stored stamps.

## Non-regression rerun (vs `BASELINE_NON_REGRESSION_REPORT.md`)

| Check | Baseline | After Phase 1 |
|---|---|---|
| vitest (src/lib/aml scope) | all passing | **all passing + 61 new** (5 new files) |
| vitest (full) | 26 failed files / 34 failed tests | unchanged failures — same files, none AML (full log archived per evidence rule) |
| `npm run lint` (new files) | 45 errors repo-wide | **0 findings in new files**; repo-wide unchanged |
| `npm run audit:style` | +36 / +20 / 2 (already regressed) | **identical deltas — no new violations** |
| `npm run build` | pass | **pass** |
| `typecheck:portals` | 5 pre-existing errors | **same 5, no new** |
| `test:aml-sanctions` | 13/13 | n/a to this change; re-run pre-push |
| `security:edd-boundary` / `screening-boundary` | pass | re-run pre-push |

## Deployment requirements

- Apply `20260913100000_aml_passport_flags.sql` (migration-first), then
  deploy `aml-reliance` and `aml-client-portal` (manual — CI does not deploy
  functions). Until both happen, the new ops answer `unknown op` /
  the flags simply don't exist — nothing user-visible changes either way.
- Deno toolchain checks (`deno check`) must run in CI; this workspace has no
  Deno. The new edge-function code paths are exercised indirectly via the
  source contracts and the pure-module tests; a CI deno check is the
  compile-level gate.

## Deliberately not done (deferred per reconciliation)

Partner projection changes (Phase 4 rides the existing workspace payload),
any UI, QR verification, biometric portrait, per-document partner ACLs,
composite suspend/revoke ops, unmask-with-reason op, printable PDF.

## Next phase readiness

Phase 2 (Command Centre UI) can start: it consumes
`amlRelianceApi.getPassportView` behind `aml_passport_command_view`, renders
all states (not issued / ready / current / superseded / refresh / suspended /
revoked / retained / loading / empty / error / unauthorised / disabled), and
touches no server code beyond what this phase shipped.

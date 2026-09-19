# Passport Baseline Non-Regression Report

Recorded **before** any Passport implementation code, on branch
`claude/aurixa-passport-integration-review-toqwn3` at `9818b6e` (2026-08-13).
Every failure below is **pre-existing** and is the reference point each
Passport phase re-runs against. The rule: a phase is complete only when these
numbers have not worsened and no new failure appears that the phase cannot
explain.

Branch note: the branch base equals `main@9818b6e`; `origin/main` has since
advanced to `e3a9cdc`. Some suites compare file content against
`origin/main` and therefore fail on any branch cut before that commit —
called out below where it applies.

## 1. Suites executed

| Suite | Command | Result |
|---|---|---|
| Unit/contract (vitest) | `npx vitest run` | **707 files: 26 failed / 679 passed / 2 skipped · 13,288 tests: 34 failed / 13,243 passed / 11 skipped** (duration 391 s) |
| Lint | `npm run lint` | Exit non-clean: **45 errors, 2,369 warnings** (top rules: `ban-ts-comment` ×21, `no-unused-expressions` ×11, `no-regex-spaces` ×3, `no-var` ×2, `no-useless-catch` ×2) |
| Style ratchet | `npm run audit:style` | **FAILS at baseline**: `hexLiterals 800 → 836 (+36)`, `inlineColorStyles 320 → 340 (+20)`, `cssHexOutsideTokens 2` — the committed baselines are already exceeded on this branch |
| Build | `npm run build` | **PASS** |
| Portal strict typecheck | `npm run typecheck:portals` | **FAILS (pre-existing)**: `ImportMeta.env` errors in `TransactionCasesPanel.tsx`, `clientLegalWorkspace.ts`, `SolicitorMatterDetail.tsx`; a `string \| null` assign in `SolicitorMatterDetail.tsx:806`; `node:fs` types in `SolicitorPipeline.security.test.ts` |
| AML sanctions | `npm run test:aml-sanctions` | **13/13 PASS** |
| Cross-portal contracts | `npm run test:cross-portal-contracts` | **27/28** — 1 pre-existing failure: `partner-agreement-records.test.mjs` "the copy contains the agreement, not a summary of it" (regex `if (markdown.truncated)` not found) |
| Solicitor portal | `npm run test:solicitor-portal` | **131/133** — pre-existing: "all five Solicitor resource functions use the shared matter resolver", "login and recovery have per-IP and per-email rate limits" |
| Builder portal | `npm run test:builder-portal` | **814/823** — 9 pre-existing failures. Six are the phase-freeze presentation tests in `portal-presentation.test.mjs` that diff/compare against `origin/main`; they fail because main moved ahead of this branch's base, not because of local changes (local diff to merge-base is empty). Plus: "generated Supabase types cover every Phase 1 builder table", the two navigation-linking assertions |
| Security (chain) | `npm run security:test` | **Aborts at first gate (pre-existing)**: `security:registry` — `aml-idv-retention` and `aml-verification-processor` exist on disk but are missing from `SECURITY_REGISTRY.json`; `verify_jwt` drift for `mcp` (registry true, config resolves false) |
| Security (individually) | `security:static`, `security:edd-boundary`, `security:screening-boundary`, `security:gates-wired` | **PASS** (static scan 902 files; both AML boundaries pass; 47 gates wired) |
| Migration security | `npm run security:migrations` | **Pre-existing finding**: `20260911000000` — `aml.tg_emit_verification_requested` is SECURITY DEFINER without `REVOKE EXECUTE FROM PUBLIC` |

## 2. Failing vitest files (pre-existing, 26)

`src/App.security.test.ts`,
`src/components/commercial/assessment/__tests__/clientCreateAndLink.test.tsx`,
`src/components/commercial/calculators/CommercialIndustrialOverviewCard.test.tsx`,
`src/components/commercial/calculators/GstCalculatorCard.test.tsx`,
`src/components/industrial/calculators/industrialMetricCascade.test.tsx`,
`src/components/market-updates/marketUpdatesUi.contract.test.ts`,
`src/components/reports/report-view/__tests__/investmentGradeResolution.spec.ts`,
`src/components/templateBuilder/__tests__/PreviewQADialog.security.spec.ts`,
`src/lib/__tests__/notificationsAuthContract.test.ts`,
`src/lib/__tests__/pushNotificationsContract.test.ts`,
`src/pages/admin/AgentQuality.security.test.ts`,
`src/pages/admin/BcSegmentEngineAdmin.security.test.ts`,
`src/pages/admin/__tests__/TemplateBuilderEdit.presence.security.spec.ts`,
`src/pages/solicitor/SolicitorPipeline.security.test.ts`,
`src/security/financePortalBatch6Authz.security.test.ts`,
`src/security/googleMapsProxies.security.test.ts`,
`src/security/solicitorPortalCommsAuthz.security.test.ts`,
`src/security/solicitorPortalComplianceAuthz.security.test.ts`,
`src/security/solicitorPortalMatters.security.test.ts`,
`src/security/solicitorPortalMattersAuthz.security.test.ts`,
`src/security/solicitorPortalNotificationAuthz.security.test.ts`,
`src/test/financePortalVoiceTranscriptionSecurity.test.ts`,
`src/utils/__tests__/scenarioDeltaEngine.test.ts`,
`src/utils/commercial/__tests__/commercialAssessmentEngine.test.ts`,
`src/utils/commercial/__tests__/scenarioModellingEngine.test.ts`,
`src/utils/commercial/__tests__/tenYearCashFlow.test.ts`
(+ ordering differences account for the count; the authoritative list is the
vitest output archived in the Phase 1 report evidence.)

**None of these touch the AML module.** The AML-specific suites relevant to
the Passport — `src/lib/aml/amlPortalContracts.test.ts`,
`amlPortalIntegration.test.ts`, `portalJourney.test.ts`,
`portalStepPresentation.test.ts`, `hostedIdvRetired.test.ts`,
`diditStandalone.test.ts`, `identityDocumentSession.test.ts`, the workspace
redesign source tests and the AML primitives tests — **all pass at baseline**.

## 3. Suites not executable in this environment

| Suite | Reason | Where it must run |
|---|---|---|
| `security:edge-check`, `typecheck:builder-edge` | Deno not installed here | CI |
| `test:didit-webhook` (e2e harness), `test:didit-migration` | Deno + live env | CI / staging |
| Playwright e2e (`test:e2e*`) | No browser-served app/database fixtures in this session | CI |
| `pdf-import:*`, market-updates deployment validators | Out of scope for AML; environment-bound | CI |

## 4. Non-regression rule for every Passport phase

After each phase: re-run vitest (full), lint, `audit:style`, build,
`typecheck:portals`, `test:aml-sanctions`, `test:cross-portal-contracts`,
`security:static`, `security:edd-boundary`, `security:screening-boundary`,
`security:gates-wired`, `security:migrations`.

Acceptance:
- vitest failures ≤ 26 files / 34 tests, and **zero new failing files**;
- lint errors ≤ 45; style ratchet deltas **no worse** than +36/+20/2;
- build passes; portal typecheck introduces **no new** errors;
- both AML security boundaries stay green;
- with `aml_passport_command_view` and `aml_passport_client_view` OFF, no
  behavioural change is observable anywhere in the product.

No existing test may be weakened, no security assertion removed, and no
expected value changed to accommodate Passport code.

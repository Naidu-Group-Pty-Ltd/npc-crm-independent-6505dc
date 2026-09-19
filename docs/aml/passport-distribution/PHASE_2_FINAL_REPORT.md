# Passport Partner Distribution — Phase 2 Final Report

**Scope:** Command Centre distribution UX, partner-portal cascade and
end-to-end completion for the Aurixa AML/CTF Compliance Passport.
**Branch:** `claude/aurixa-passport-integration-review-toqwn3`.
**Phase 1 baseline:** `main` at `d5b2c53`; Phase 1 committed at `93c135f`.
**Posture:** additive. No existing AML/CTF verification, screening, reliance,
document, audit or portal behaviour was changed, and nothing was rebuilt.

---

## 1. Phase 1 foundation used (verified before UI work)

Phase 1 was re-inspected and its tests re-run before a line of UI was written.

| Requirement | Status |
| --- | --- |
| Readiness engine exists | `_shared/aml/passport/passportDistribution.pure.ts` |
| Server-side orchestration | four ops on `aml-reliance`, MLRO-only |
| Legal-route gating | route read off the partner-case link, never inferred |
| Idempotency | `ALREADY_CURRENT` no-op + DB re-check before insert |
| Version/hash authoritative | grants pin to the current attestation id |
| Evidence readiness | seven classes, derived from canonical counts |
| Feature flag | `aml_passport_partner_distribution`, default false |
| Security tests pass | 9 files / 161 tests green at re-run |

Phase 2 built **on** that engine. It re-implements none of it.

## 2. What Phase 2 adds

Three things, and nothing else:

1. **A Command Centre distribution surface** inside the existing Passport, on
   the Partner Access page.
2. **A guided seven-step Link & Share workflow** over the Phase 1 write ops.
3. **The legal basis, stated on the partner's own Passport strip** in all three
   portals.

Everything else the specification asks for was found to exist already, and is
recorded below under §6 rather than rebuilt.

## 3. Files

### New

| File | Purpose |
| --- | --- |
| `src/lib/aml/passport/distributionPresentation.pure.ts` | Pure translation of engine codes into compliance language. No decisions. |
| `src/components/aml/passport/design/PartnerDistribution.tsx` | Readiness cards + cross-partner matrix. |
| `src/components/aml/passport/design/LinkAndShareDialog.tsx` | The seven-step guided workflow. |
| `src/lib/aml/passport/distributionPresentation.test.ts` | 41 tests over the translation. |
| `src/components/aml/passport/design/partnerDistribution.test.tsx` | 16 component tests. |
| `src/lib/aml/passport/distributionUx.contract.test.ts` | 24 source contracts over the new UI. |
| `src/lib/aml/passport/distributionEndToEnd.test.ts` | 20 tests — the §25 scenario. |
| `docs/aml/passport-distribution/PHASE_2_FINAL_REPORT.md` | This report. |

### Modified

| File | Change |
| --- | --- |
| `supabase/functions/_shared/aml/passport/passportDistribution.pure.ts` | One hardening: the arrangement must belong to the candidate organisation (§5.2 below). |
| `src/lib/aml/amlRelianceApi.ts` | Four client methods + two response types. |
| `src/components/aml/passport/design/pagesRecord.tsx` | Mounts the distribution section above the existing grant list. |
| `src/components/aml/passport/design/pagesJourney.tsx` | Three optional props on `PassportPageProps`. |
| `src/components/aml/passport/design/PassportWorkspace.tsx` | Passes case id, MLRO standing and a refetch to the active page. |
| `src/components/partner-compliance/PartnerPassportStrip.tsx` | States the legal route (§13). |

**No migration.** Phase 2 adds no schema, no table, no column and no flag.

## 4. Command Centre work completed

### 4.1 Partner readiness cards (§5)

One card per linked partner organisation, showing: organisation, portal,
relationship role, distribution state, and a checklist covering portal
connection, classification, matter link, client sharing consent, CDD
arrangement, arrangement assessment, arrangement review, Passport currency,
evidence package, legal route and current distribution.

Outstanding items are listed with the server's own sentence. Advisory findings
(`EVIDENCE_AVAILABILITY_INCOMPLETE`, `DISCLOSURE_CONFIGURATION_REQUIRED`) are
shown under "Worth knowing" rather than as blockers, matching how the engine
treats them.

Every status carries a **word** as well as a tone, so nothing is communicated by
colour alone.

### 4.2 Distribution matrix (§6)

A cross-partner table: portal, link, connection, Passport, arrangement,
assessment, all seven evidence categories, legal route and distribution state.
It scrolls inside its own container rather than the page.

Each cell is read from a readiness object. There is no permission logic in the
table.

### 4.3 The guided workflow (§7)

Seven steps: Passport → Partners → Relationship → Legal route → Evidence →
Confirm → Result.

- **Step 1** shows version, issue date, state and evidence fingerprint, and says
  the partner review is pinned to them.
- **Step 2** offers "Select all eligible", where eligible is the server's answer
  (narrowed — see §5.1).
- **Step 3** confirms the existing link; no relationship is created.
- **Step 4** shows the route per partner and, when reliance is unavailable, says
  exactly what is missing. It never substitutes a different legal basis.
- **Step 5** previews the evidence package per partner.
- **Step 6** confirms, then calls one canonical server operation.
- **Step 7** reports **every partner individually**, naming the route each was
  shared under, and shows a newly issued partner token once.

### 4.4 Language (§8, §23)

No grant id, attestation id, `partner_org_id`, manifest row or membership row
appears on the operator surface. A test enumerates the entire presentation
vocabulary and fails on any of them, and on the §23 forbidden claims
("AML compliant for all partners", "fully approved client", "guarantees
compliance").

## 5. Two defects this phase found and fixed

### 5.1 A bulk share could silently reinstate revoked access

The engine reports a revoked grant as `GRANT_REVOKED` while leaving the partner
`ready` — correct, because an MLRO who withdrew access may restore it. But the
first cut of "Share with all eligible partners" included those partners, so a
single click could have undone a deliberate revocation without the operator
ever naming that partner.

Fixed by making the bulk set **narrower** than the per-card one:
`isBulkEligible = canShare(r) && state !== 'GRANT_REVOKED'`. Reinstatement stays
a deliberate single-partner act, and the card's button says
**"Reinstate & share Passport"** rather than "Link & Share Passport".

This is the UI being stricter than the server, which is always allowed. A
contract test asserts `isBulkEligible` is defined in terms of `canShare`, so no
future edit can make it wider.

### 5.2 The engine could not see a borrowed arrangement

`evaluateDistribution` did not check that the CDD arrangement belonged to the
candidate organisation. In production the binding always holds — the edge
function selects the agreement by `partner_org_id` — but a pure engine that
cannot see the mismatch is one refactor away from granting section 37A reliance
on another organisation's written arrangement.

A mismatch now denies. A **null** does not: legacy agreement rows predate the
column, and failing them here would revoke reliance lawfully in force today for
a fact the caller's query already guarantees.

### 5.3 A third defect, in the UI's own lifecycle

Refreshing readiness after a share unmounted the section — and with it the
open dialog — destroying the per-partner result screen before the operator
could read which partners actually received the Passport. Only the first load
now blanks the surface, and a failed refresh no longer discards readiness
already on screen.

## 6. Portal integration — what already existed

The specification asked for Finance, Solicitor/Conveyancer and Builder/Developer
integration. **All three already mount one shared component** —
`PartnerComplianceWorkspace` — with a per-portal adapter supplying wording and
optional panels. There is no fork, and Phase 2 did not create one.

| §  | Requirement | Where it already lives |
| --- | --- | --- |
| 10–12 | One workspace, three portals | `PartnerComplianceWorkspace` + `adapters.ts`; mounted by `FinancePortalComplianceWorkspace`, `SolicitorCompliance`, `BuilderCompliance` |
| 13 | Passport presentation | `PartnerPassportStrip` — issuer, version, issue date, fingerprint, state |
| 14 | Evidence navigation | `ProcedureEvidenceViewer`, manifest-intersected server-side |
| 15 | Secure document access | `EvidenceDeliveriesPanel` over the existing delivery mechanism |
| 16 | Partner determination | `IndependentAssessmentForm`, append-only, validated server-side |
| 17 | Partner stamps | Derived in `PartnerPassportStrip` from a genuine `satisfied` determination, pinned to organisation, version and decision date |
| 18 | Version awareness | `RefreshBanner` + `determination.refresh_required` |
| 19 | Material change / refresh | Existing refresh-obligation architecture |
| 20 | Revocation / suspension | `RefreshBanner` revoked/expired states, safe wording, no internal reason |
| 21 | Notifications | Outbox → `cross-portal-outbox-worker` → `partner_notifications` |

**The one gap Phase 2 closed** was §13's legal basis: the strip showed version,
state and fingerprint but never said whether the partner could *rely*. The route
was already in the DTO the portal lawfully receives (`link.legal_route`), so
naming it discloses nothing new. It now reads "Section 37A reliance available",
"Outsourced CDD — written arrangement", "Independent CDD" or "Information
sharing only", from the same vocabulary the Command Centre uses. An
unrecognised or absent route reads "Legal basis not recorded" — never rounded to
the nearest route in either direction.

## 7. Notifications cascade without new code (§21)

A distribution notification is a **consequence of the grant row**, not something
the caller remembers to send:

```
insert aml.reliance_grants
  → trg_aml_emit_grant_events  (AFTER INSERT)
  → aml.partner_access.created, idempotency key 'aml.partner_access.created:<grant_id>'
  → cross-portal-outbox-worker
  → partner_notifications  (upsert on outbox_event_id, ignoreDuplicates)
```

Two independent guarantees make a repeated share silent rather than duplicated:
an `ALREADY_CURRENT` partner writes no row at all, so no event exists; and the
worker's upsert is keyed on the originating event. Revocation emits
`aml.partner_access.revoked` carrying identifiers only — the migration comments
that the free-text revoke reason is deliberately excluded.

Distribution writes no notification of its own; a contract test asserts it never
touches `partner_notifications` or `enqueue_partner_event`.

## 8. Security review

| Concern | Position |
| --- | --- |
| Eligibility in React | None. A contract test bans local readiness derivation, `blockers.length === 0`, and any route inferred from portal or partner type. |
| One route vocabulary | `isRelianceRoute` exists once; surfaces import it and are banned from comparing against `outsourced_cdd` themselves. |
| Body-supplied claims | The four client methods send only `case_id` and `partner_org_ids`; a test enumerates the forbidden field names. |
| Op surface | The UI calls exactly three canonical ops; a test asserts the set exhaustively. |
| Document bytes | No surface contains `storage_path`, `createSignedUrl`, `storage.from`, `download(`, `blob:` or `URL.createObjectURL`. |
| Restricted classes | No `NEVER_DISCLOSABLE` term appears in any new UI source or in any presentation output. |
| Command-only sections | The partner strip touches no `view.screening`, `view.funding`, `edd_cases` or `case_events`. |
| Fail-closed presentation | No attestation → the strip renders nothing. |
| Feature off | The section says distribution is not enabled and offers no action; writes still 409 server-side. |
| Non-MLRO | The section explains the restriction and issues no request at all. |

## 9. Tests

**101 new tests, all passing. Zero existing tests changed, relaxed or removed.**

| Suite | Tests |
| --- | --- |
| `distributionPresentation.test.ts` | 41 |
| `distributionUx.contract.test.ts` | 24 |
| `distributionEndToEnd.test.ts` (§25) | 20 |
| `partnerDistribution.test.tsx` | 16 |

The §25 scenario runs as one narrative: Client A cleared, Passport v1 issued,
three partners on three footings (Finance reliance, Solicitor reliance, Builder
information-only), differing evidence packages, then v2 supersession, then
revocation. It asserts the transitions — that v2 does not rewrite the v1
decision, that an already-current partner is a no-op, that a revoked grant is
never swept into a bulk share, and that no partner inherits another's package.

§24 cross-portal isolation is covered at the engine boundary: wrong case, wrong
tenant, borrowed arrangement, missing membership, missing consent, feature off.

## 10. Non-regression (§26)

| Check | Result |
| --- | --- |
| AML + partner suites (`src/lib/aml`, `src/components/aml`, `src/pages/aml`, `src/components/partner-compliance`) | **106 files, 2015 passed, 4 skipped, 0 failed** |
| `tsc --noEmit` | clean |
| `test:aml-sanctions`, `security:edd-boundary`, `security:screening-boundary`, `security:registry`, `security:static`, `security:cors-contract` | pass |
| `security:edge-check` | not run — requires Deno, absent from this container. Runs in CI. |
| `lint` | 45 errors / 2372 warnings — unchanged from baseline; **none in any file this phase touched** |
| `audit:style` | under baseline, 0 new violations |
| `build` | ✓ |

### The full-suite comparison, stated plainly

| | Test files | Tests |
| --- | --- | --- |
| Clean tree (stashed) | 26 failed / 742 passed | 34 failed / 14,299 passed |
| With Phase 2 | 26 failed / 746 passed | 34 failed / 14,400 passed |

**The 34 failures are identical before and after** — they pre-exist on this
branch's base and sit in unrelated areas (property calculators, borrowing
capacity, investor mode, a client-permissions filter). Phase 2 neither caused
nor fixed them; they are outside this work's scope and are reported here rather
than left implied. The delta is +4 files and +101 tests, all passing.

## 11. Migrations and flags

**No new migration in Phase 2.** The Phase 1 migration
(`20260914090000_aml_passport_partner_distribution_flag.sql`) seeds
`aml_passport_partner_distribution` as `false` and changes nothing else.

Enforcement stays server-side. With the flag off: reads report
`enabled: false` and the surface says so, writes answer `409
distribution_disabled`, and `grant_access`, `revoke_grant`, Compliance Sharing
and the Partner Compliance Workspace behave exactly as before.

## 12. Deployment

1. Apply `20260914090000_aml_passport_partner_distribution_flag.sql`. Seeds one
   flag row as `false`; no schema or data change; safe to apply ahead of code.
2. Deploy `aml-reliance` (Phase 1 ops + the §5.2 hardening).
3. Deploy the frontend.
4. Leave the flag **off**. Nothing changes for any user.
5. For staging UAT, set `aml_passport_partner_distribution` to `true` in that
   environment only.

**Rollback:** set the flag to `false`. The surface reverts to a one-line notice
and writes refuse; no data is written or removed by turning it off. Grants
already created remain valid, exactly as grants created through Compliance
Sharing do — they are the same rows.

## 13. Staging UAT requirements

Before enabling anywhere real, on staging:

1. A cleared case with an issued Passport and `compliance_sharing` consent.
2. Three partner organisations — one finance with an active in-scope written
   arrangement and operative assessment, one solicitor likewise, one builder on
   an `information_share_only` link with no arrangement.
3. Active portal memberships for all three.
4. Confirm the three cards show three different routes and packages.
5. Share to all eligible; confirm three individual outcomes and one token each.
6. Sign in to each portal; confirm each sees its own authorised view, its route
   headline, and no other partner's information.
7. Record a determination in Finance; confirm the stamp appears pinned to the
   reviewed version.
8. Issue a new Passport version; confirm both reliance partners see refresh
   required and the earlier determinations remain as history.
9. Revoke one grant; confirm that portal fails closed with safe wording, and
   that the partner is excluded from "share with all eligible" while remaining
   individually reinstatable.

## 14. Deferred

- **§22 — the client-facing sharing summary.** Deliberately deferred. `view.partners`
  is command-only and the client branch of `buildPassportView` ends in
  `assertClientSafe`, so telling a client which partners hold their Passport
  means adding a new client-safe disclosure class to the projection — with its
  own flag, its own `assertClientSafe` allowance and its own tests. §22 itself
  says to gate it separately rather than compromise the core integration, and
  the standing default-deny rule says an unclassified field is not disclosed.
  Nothing about the client's existing journey was touched.
- **§4 — automatic partner discovery from transaction free text.** The surface
  reports unmatched parties as needing a mapping and sends the operator to
  partner administration. Minting an organisation from a name on a transaction
  is explicitly out of scope and stays out.
- Turning the flag on in any environment.
- Deploying `aml-reliance` and applying the migration.

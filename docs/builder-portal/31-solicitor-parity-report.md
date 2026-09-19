# Builder Portal — Solicitor Parity Review (Step 3)

The current Solicitor Portal is the canonical construction template. This review compares the
Builder Portal against it and classifies each item. Where Builder diverges, the divergence is
either a **correction of a known Solicitor defect** (desirable) or a **gap** (recorded).

Legend: ✅ mirrored · 🟢 shared implementation reused · 🔵 deliberate correction · ⚠️ gap ·
➖ not applicable with reason

---

## 1. Routing and structure

| Item | Status | Notes |
|---|---|---|
| Separate external route tree | ✅ | `/builder/*`, mirroring `/solicitor/*`. Never linked from internal navigation (ADR 018) |
| Provider structure | ✅ | `BuilderPortalProvider` mirrors the Solicitor provider |
| Protected-route structure | ✅ | `BuilderPortalProtectedRoute` |
| Governance ordering | 🔵 | `builderGovernanceError()` enforces auth → password rotation → organisation selection → terms → onboarding, **server-side**. Browser route guards mirror it for the journey; the server is the control. Solicitor's ordering is less explicit |
| Layout construction | ✅ | Shared page shell |
| Session-resolution pattern | 🔵 | `resolveBuilderSession` is the single entry point, **cookie-only**. Solicitor still accepts a legacy header/body carrier — deliberately not copied (NOCOPY) |
| Edge Function family | ✅ | `builder-portal-*` external + `builder-*-admin` internal, exactly mirroring `solicitor-portal-*` / `legal-*-admin` |
| Internal administration separation | ✅ | `/admin/builder-portal` is a separate tree; no function accepts both a staff JWT and a portal cookie |
| Shared service usage | 🟢 | `_shared/auth.ts`, `_shared/authz.ts`, `_shared/csrfGuard.ts`, `record_portal_operational_event` |

## 2. Portal chrome

| Item | Status |
|---|---|
| Branded desktop sidebar | ✅ |
| Mobile drawer | ✅ |
| Sticky top bar | ✅ |
| Account menu | ✅ |
| Notification entry | ✅ |
| Back navigation | ✅ |
| Sign-out | ✅ |
| Session security | ✅ |
| Route transitions | ✅ |
| Document title / metadata | ✅ |
| White-label branding | ✅ |
| Reduced-motion support | ✅ |
| Skip-to-content | ✅ |
| Keyboard accessibility | ✅ |

All asserted by `tests-e2e/builder-portal/phase2-portal-shell.e2e.ts` (91/91 E2E passing).

## 3. Governance experience

| Item | Status | Notes |
|---|---|---|
| Login | 🔵 | Enumeration-safe; dummy-password verification; no account-state-specific message |
| Password rotation | ✅ | `must_change_password` gate |
| Organisation selection | 🔵 | Reach resolved **server-side** from memberships; a browser-supplied organisation id is never authority |
| Terms wall | ✅ | Version-exact — a new version re-gates |
| Mandatory onboarding | ✅ | `builder_ensure_onboarding_steps` |
| Settings / Security | ✅ | |
| Permission-denied state | ✅ | |
| Session-expired state | ✅ | |

## 4. Page experience

Shared page shell, page headers, loading, empty, error, retry, permission-denied, responsive
layout, mobile behaviour, accessible labels and focus management: **all ✅**, asserted across
the eight domain E2E specs.

One deliberate Builder improvement (🔵): the workspace dashboard distinguishes *"zero because
you may not see it"* from *"zero because there is none"* — E2E test *"the dashboard says a zero
is a permission answer, not a fact"*. Solicitor renders a bare zero.

## 5. Onboarding tour — ⚠️ gap found, **now closed**

`SolicitorOnboardingTour` exists (`src/components/solicitor-portal/SolicitorOnboardingTour.tsx`),
is mounted in `SolicitorPortalLayout`, and has a replay control in `SolicitorSettings.tsx` that
dispatches a `solicitor:start-tour` event. It is itself a mirror of `PortalOnboardingTour`
(Client) and `FinanceOnboardingTour`.

**The Builder Portal had none.** `BuilderOnboarding.tsx` is the mandatory *governance* checklist
(confirm profile, organisation, contact, security) — a gate, not a product tour.

### Closed on this branch

`src/components/builder-portal/BuilderOnboardingTour.tsx` mirrors the Solicitor construction:
same `localStorage` completion key shape (`builder_tour_completed_v1`), same 900 ms first-login
delay, same welcome card, same step card with progress dots and `n/N` counter, same
Escape-to-dismiss, same close control, same replay event, same centring fallback when the
destination is not visible.

Two divergences, both forced by the Builder chrome rather than by taste — the tour was **not**
redesigned and no Builder-specific design system was introduced:

1. **Positioning.** Builder navigates from a horizontal top bar, not a sidebar. The step card is
   placed *below* the destination rather than to its right, and the stacking-context fix targets
   `closest('header')` instead of `closest('aside')`. The left offset is clamped so a destination
   near the right edge cannot push the card off-screen.
2. **Reduced motion is honoured.** `motion-reduce:animate-none` / `motion-reduce:transition-none`
   mean a user with the OS preference set gets the same tour without animation. The Solicitor tour
   does not do this; this is a correction, not a divergence in construction, and should be
   back-ported.

Terminology and destinations are entirely Builder: dashboard, projects, inventory, transactions,
construction, documents, messages, tasks, notifications, settings. **Ten steps.** A test asserts
no step mentions matters, conveyancing, firms, settlement, requisitions or disbursements.

Replay control: `BuilderSettings.tsx` → *Portal help* card → **Replay portal tour**, dispatching
`builder:start-tour`, exactly mirroring the Solicitor settings card.

**Coverage:** 14 new E2E tests in `tests-e2e/builder-portal/onboarding-tour.e2e.ts`, all passing
— first-visit appearance, full ten-step walk, no legal terminology, completion persistence,
non-reappearance after reload, skip, Escape, close control, returning user, replay from settings,
mobile centring within the viewport, reduced motion, ARIA dialog labelling, and that every
`data-tour` anchor is a real `/builder` link.

---

## 6. Solicitor defects deliberately NOT copied

Carried forward from the Phase 0 NOCOPY register and re-verified on this branch:

| Ref | Solicitor defect | Builder position |
|---|---|---|
| NOCOPY-01 | Default-allow permission keys and OR-merged permissions | Deny-by-default `builder_resolve_permission`; no OR-merge |
| NOCOPY-02 | Session token accepted from header/body | Cookie-only; `__Host-builder_session_token` |
| NOCOPY-03 | Plaintext session columns | Hashed only; no plaintext column exists |
| NOCOPY-04 | `logSolicitorActivity()` swallows failures | `builder_log_activity` **raises**, so a failed audit rolls the mutation back |
| NOCOPY-05 | Client-level authorization | Explicit project/unit/transaction/case scoping |
| NOCOPY-06 | `select('*')` | Explicit column allow-lists throughout |
| NOCOPY-07 | Account-state-specific login messages | Uniform response |
| **NOCOPY-R1** | Approvals `.upsert()`ed directly from the Edge Function | Guarded command |
| **NOCOPY-R2** | Audit written after the RPC commits | Audit inside the transaction |
| **NOCOPY-R3** | No optimistic concurrency on the rollout row | `expected_version` enforced |
| **NOCOPY-R4** | No approval revocation path | `revoke_cross_portal_approval_for` |
| **NOCOPY-R5** | Readiness hardcoded to Solicitor evidence | Portal-aware `get_builder_cutover_readiness` |

R1–R5 are **new** on this branch and are enforced by `tests/builder-portal/release-control.test.mjs`.

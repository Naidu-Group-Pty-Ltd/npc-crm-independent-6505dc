# Passport Orchestration — Current State Audit

**Inspected:** `main` at `e3c5e8288fb8e0a9aad6e5829f8507c654b90e23` (2026-08-15).
**Baseline tests:** AML + partner + portal suites — **110 files, 2094 passed, 4 skipped, 0 failed**.

This is the Phase 0 record: what existed before this stage, and the divergences
found between the brief and the repository.

---

## 1. Divergence from the brief

The brief asks to "confirm PR #2103 or its equivalent partner-distribution
implementation is present" and to open a new PR at the end.

**PR #2103 was merged** at 2026-08-14T19:30:09Z, into `main` at `d5b2c53`.
`main` has since advanced to `e3c5e82`. So:

- the partner-distribution engine, its four operations, the readiness cards and
  Link & Share are **on `main`** and were inspected there, not on a branch;
- the working branch was restarted from `e3c5e82`, which makes this stage a
  genuinely new pull request rather than more commits on a merged one.

`main` also carries `7c7f57e fix(aml): the Passport state read supplies every
attestation field it declares` — a fix in this area by someone else, after the
merge. Nothing in this stage touches that path.

## 2. What already exists and is reused unchanged

| Concern | Where | Verdict |
| --- | --- | --- |
| Partner distribution engine | `_shared/aml/passport/passportDistribution.pure.ts` | Present, reused |
| Distribution operations | `aml-reliance` — 4 ops | Present, reused |
| Readiness cards / matrix / Link & Share | `design/PartnerDistribution.tsx`, `design/LinkAndShareDialog.tsx` | Present, reused |
| Passport page 09 "Partner Access" | `design/pageRegister.tsx` | Present — already mounts `PartnerDistribution` |
| Client requests | `aml.client_requests`, `create_client_request`, `respond_client_request` | Present, reused |
| Portal request routing | `src/lib/aml/portalRequestRoute.ts`, `OpenRequestsCard` | Present, reused |
| IDV fallback (provider unavailable → manual) | `resolveRequestStep` | Present, untouched |
| Submission review requests | `SubmissionReviewPanel` → `request_submission_*` | Present, reused |
| Partner workspace (all three portals) | `PartnerComplianceWorkspace` + adapters | Present, one implementation |
| Notifications | trigger → outbox → `cross-portal-outbox-worker` | Present, untouched |

**No second AML system, Passport system, request system or distribution system
was found, and none was created.**

## 3. Defects found

### 3.1 The Passport's two headline controls did nothing

`PassportControls.tsx` rendered both **Share Passport** and **Request client
information** as:

```tsx
<Button asChild><a href="#compliance-sharing">…</a></Button>
```

`#compliance-sharing` is an element of the **case workspace**
(`ReliancePassportSection`). The dedicated Passport page — `/admin/aml/passports`,
which is the surface these controls actually live on, and the one in the
supplied screenshots — does not contain it. Clicking either button on that page
scrolled nowhere and opened nothing.

This is the defect the brief names, and it is worse than a missing feature: a
control that silently no-ops reads as a broken product rather than as an absent
one.

### 3.2 `section_code` was dropped by the generic request path

The Client Portal routes questionnaire amendments by `action_target.section_code`
— `PortalAml` matches it against the server-driven step list, and
`aml-client-portal` projects it. The **submission review** path writes one.

But `create_client_request` sanitised the target to:

```ts
const actionTarget = {
  target_step: …, requirement_id: …,   // section_code absent
};
```

So a questionnaire request created from anywhere except Submission Review
reached the client with no section and fell back to the generic respond box.

### 3.3 …and accepted, unvalidated, by the path that kept it

The mirror image, in `request_submission_*`:

```ts
if (body.section_code) actionTarget.section_code = String(body.section_code);
```

Any string at all. A routing value that is not validated is a routing value the
caller chooses.

### 3.4 The action vocabulary existed three times

The same six codes were written out independently in:

- `supabase/functions/aml-cases/index.ts` (the writer),
- `supabase/functions/aml-client-portal/index.ts` (the reader),
- `src/lib/aml/portalRequestRoute.ts` (the router's labels and steps).

Three copies of a closed vocabulary is three chances for the writer to accept a
code the reader drops — and the symptom is not an error anybody sees, it is a
client receiving a request with no button.

### 3.5 The Passport never said what was blocking it

`PassportControls` disabled **Issue Passport** with a `title` tooltip. Nothing
on the surface answered "what prevents this Passport from being issued?", and
nothing connected an incomplete page (Verification showing three components
`NOT PERFORMED`) to the action that would resolve it.

## 4. Deliberately left alone

- **The AML engine.** Verification, screening, PEP, ownership, SoF/SoW, EDD,
  risk, analyst/reviewer/MLRO decisions, the service gate, monitoring,
  retention and the hash-chained audit are untouched.
- **Didit and verification outcomes.** No provider behaviour, attempt handling
  or outcome authority is changed. The manual-fallback route is reused as-is.
- **Issuance.** `issue_attestation` remains the only issuance operation.
- **Partner distribution.** The PR #2103 engine and UI are reused, not rewritten.
- **The partner portals.** One `PartnerComplianceWorkspace`, three adapters,
  unchanged.
- **`ReliancePassportSection` / Compliance Sharing.** The advanced governance
  surface stays exactly where it is; the Passport now navigates rather than
  pointing at it with an anchor.

## 5. Architectural separation confirmed

The four surfaces are distinct and stay distinct:

```
CASE WORKSPACE     compliance work is performed
CLIENT PORTAL      the client supplies information
COMPLIANCE PASSPORT  the record that work produced
PARTNER ACCESS     the current record is distributed
```

Nothing was collapsed into one page. What this stage adds is deliberate
navigation *between* them, plus the one thing none of them stated: whose move it
is next.

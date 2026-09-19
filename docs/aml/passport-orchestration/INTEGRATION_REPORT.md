# Passport Orchestration — Integration Report

**Base:** `main` at `e3c5e8288fb8e0a9aad6e5829f8507c654b90e23`.
**Posture:** additive orchestration and UX integration. No AML/CTF verification,
screening, reliance, document, audit or portal capability was rewritten.
**Zero new tables. Zero migrations. Zero new feature flags.**

---

## 1. What was connected

Four things, all of which joined surfaces that already existed.

### 1.1 The Passport's headline controls now go somewhere

**Share Passport** and **Request client information** were `<a href="#compliance-sharing">`.
That anchor names an element of the case workspace; the dedicated Passport page
does not contain it, so on the surface these controls actually live on, both did
nothing at all.

They are now callbacks the surface supplies:

- **Share Passport** → `setPageId("partners")`, selecting the Partner Access
  page that already holds the readiness cards, the distribution matrix and Link
  & Share. No second share modal was created.
- **Request client information** → opens the composer described below.

`PassportControls` no longer contains an `href` at all. A source contract
asserts it, with comments stripped first so the file can still record why the
anchor went.

### 1.2 A request composer that starts from what is missing

`RequestClientInformationDialog` opens on the **outstanding compliance items**
derived from the projection — identity verification incomplete, a required
document with nothing accepted against it, evidence awaiting review, requests
already sent, and the Passport's own state. Selecting one prepopulates the
action code, the destination and a client-safe message the MLRO can edit.

The operator never has to leave the Verification page, remember which component
was missing, open Requests and retype it in the client's words. That was the
§30 complaint and it is what this closes.

Every send goes through `create_client_request` — the canonical operation, with
its existing idempotency (one unresolved request per action per case).

### 1.3 The Passport says what is blocking it

`ComplianceActionSummary` sits above the page content on the Command audience
and answers "what prevents this Passport from being issued?" with the outstanding
items, **whose move each one is** (client / staff / MLRO), and the two actions
that resolve them: *Request from client*, *Open compliance case*.

Derived every render from `PassportView`. No stored readiness, no second
progress number, no mutation.

### 1.4 Bridges to where the work is done

The summary links each item to the Passport page that shows the facts, and the
page offers *Open compliance case* → `/admin/aml/cases/:caseId`.

Routing belongs to the **page**, not the shell: `PassportWorkspace` takes an
optional `onOpenCase` and renders fine without a Router. Putting `useNavigate`
inside the shell turned a presentation component into one that throws outside a
Router — it broke five existing tests, which was the correct signal.

## 2. The routing contract (details in `CLIENT_REQUEST_CONTRACT.md`)

`_shared/aml/clientRequestContract.pure.ts` is now the single definition of the
action codes, the questionnaire sections, the target steps and the sanitiser.
Four call sites were consolidated onto it.

**Two defects fixed on the way:**

- `create_client_request` **dropped `section_code`**, so a questionnaire request
  created anywhere except Submission Review reached the client with nowhere to
  go and fell back to the generic respond box.
- `request_submission_*` accepted `String(body.section_code)` — **any string at
  all**. An unvalidated routing value is a routing value the caller chooses.

Both now pass through one whitelist. `sanitiseActionTarget` builds its result
field by field, with no spread of the input, so an unrecognised key cannot
survive; `requirement_id` is uuid-shape-checked; a URL in any position produces
three nulls.

## 3. Security

| Property | How |
| --- | --- |
| No new request store | Composer calls `create_client_request`; a test bans `passport_requests` / `mlro_requests` / `client_compliance_actions` |
| Closed action vocabulary | One contract; edge functions asserted not to restate it as a literal list |
| No arbitrary route | `sanitiseActionTarget` allow-lists three fields; hostile inputs (`href`, `url`, `javascript:`, `../`) all produce nulls |
| Section targeting is whitelist-only | Validated against the questionnaire vocabulary; `salary_details`, `FUNDING`, `../../etc/passwd` all drop |
| Client messages carry no internal reason | Derived defaults asserted free of risk / CDD / screening / PEP / EDD / SMR / MLRO / escalation vocabulary |
| Affordance is not authorisation | The composer is offered on the Passport; `create_client_request` still requires the write role server-side |
| Derivation, never mutation | `outstandingItems.pure.ts` asserted to contain no `insert`/`update`/`upsert`/`fetch`/`invoke` |
| No blanket compliance claim | Headline asserted free of "AML compliant", "fully approved", "guarantees" |

## 4. Tests

**28 new tests** in `src/lib/aml/passport/passportOrchestration.test.ts`,
covering the routing contract, both server call sites, the navigation repair,
the outstanding-item derivation and the composer.

### Existing tests changed — and why

**Two assertions in `src/lib/aml/amlPortalIntegration.test.ts` were retargeted.**
Both asserted the guarantee *via its old location* — one required the literal
`CLIENT_ACTION_CODES.includes(String(r.action_code` in `aml-client-portal`, the
other required the six codes to appear in `portalRequestRoute.ts`. Consolidating
that location is the deliverable, and the second test's own comment records the
same move one level earlier ("The vocabulary moved to
`src/lib/aml/portalRequestRoute.ts` … The page must consume it, not reimplement
it").

They now assert the same guarantees at the single source, **and more**: that the
sanitiser contains no spread of its input, that it names all three whitelisted
fields, that neither edge function restates the vocabulary as a literal list,
and that the router derives its table rather than copying it. No assertion was
removed or weakened.

This is the only existing-test change in this stage.

## 5. Non-regression

| Check | Baseline | After |
| --- | --- | --- |
| AML + partner + portal suites | 110 files / 2094 passed / 0 failed | **111 files / 2122 passed / 0 failed** |
| `tsc --noEmit` | clean | clean |
| `test:aml-sanctions` | pass | pass |
| `security:edd-boundary` | pass | pass |
| `security:screening-boundary` | pass | pass |
| `security:registry` | pass | pass |
| `security:static` | pass | pass |
| `security:cors-contract` | pass | pass |
| `lint` | 45 errors | 45 errors — **none in any file this stage touched** |
| `audit:style` | under baseline | under baseline, 0 new violations |
| `build` | ✓ | ✓ 1m 08s |

`security:edge-check` requires Deno, absent from this container; it runs in CI.
Both modified edge functions were parsed with esbuild instead.

## 6. Migrations and flags

**None.** No schema, no data, no new flag. The orchestration is presentation
over operations that already existed, so there is nothing to gate that is not
already gated: `aml_passport_command_view` still controls whether the Passport
surface renders at all, and `aml_passport_partner_distribution` still controls
distribution.

This is a deliberate departure from §44, which offered
`aml_passport_compliance_orchestration`. A flag whose "off" state restores a
pair of buttons that navigated nowhere is not a safety control — it is a switch
for reinstating a defect. The behaviour behind every new affordance is an
existing, already-gated, already-authorised operation.

## 7. Deployment

1. Deploy `aml-cases` and `aml-client-portal` (both changed).
2. Deploy the frontend.

No migration to apply, no flag to set. `aml-reliance` is unchanged by this
stage.

**Order matters one way only:** the frontend may ship before the functions
without harm — the composer sends `section_code`, and an un-updated server drops
it exactly as it does today. Shipping the functions first is also safe.

## 8. Rollback

Revert the commit. There is no data to unwind: no table was created, no column
written that did not exist, and no request created through the new composer is
distinguishable from one created in the case workspace — they are the same rows,
made by the same operation.

## 9. Deferred

Named explicitly rather than implied:

- **§13 lifecycle states / §35 server-derived completion.** `respond_client_request`
  and its existing transitions were inspected and left alone. Deriving
  "responded → awaiting review" server-side from the requested action's result
  is a change to request semantics that deserves its own stage and its own
  tests; the derivation here reports what the projection already publishes.
- **§14 per-page request status** (a request badge on Verification / Evidence).
  The summary states it at the top of the Passport; putting it on each page
  needs the request-to-page mapping to be canonical, which is the same work as
  the item above.
- **§27 connected-portal card states** beyond what the strip already shows.
- **§31's fuller Compliance Action Centre** — this stage delivers the summary
  and the two actions, not the complete surface.
- **§32 responsive re-layout.** The summary improves hierarchy at the top of the
  page; the wider control-rail redesign is not attempted here.
- **Client Portal remediation copy (§33/§34).** `OpenRequestsCard` already
  routes correctly and shows request state; its wording was not changed.

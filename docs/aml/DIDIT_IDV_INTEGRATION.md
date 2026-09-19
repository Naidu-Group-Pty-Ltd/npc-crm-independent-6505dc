# Didit hosted identity verification

Didit is an **identity verification** provider and nothing else in this
codebase. It performs three checks — ID Verification, Face Match 1:1 and
Passive Liveness — and its result lands in the existing canonical record,
`aml.verification_checks`, as an ordinary `electronic_idv` row.

Read this before touching `_shared/aml/providers/didit*`, `didit-webhook/`, or
the hosted branch of `aml-client-portal`.

**The provider is a short errand inside an NPC journey, not a page NPC hosts.**
It used to run in an iframe in the Client Portal, which put another product's
chrome, language and errors inside NPC's own page — and handed it the first two
screens (country, then document) whose answers NPC already knew. NPC now asks
which document, says what to have ready, opens the capture in a **separate
top-level window**, and takes the customer back to an NPC page when it closes.
The provider architecture underneath is unchanged: the same Workflow session,
the same signed webhook, the same server-to-server decision. See "The capture
runs in its own window" and "Which screens the customer sees".

---

## What this is NOT

- **Not a second KYC source of truth.** There is no Didit-owned table. The
  canonical record is `aml.verification_checks`, exactly as before.
- **Not AML screening.** Didit's AML module, PEP screening, sanctions, adverse
  media and transaction monitoring are **not enabled and must not be**. NPC
  screens against its own DFAT/UN/OFAC copies (`local_lists`), determines PEP
  status itself, and gates service on a human decision. `diditAmlScope.test.ts`
  fails the build if any of that changes.
- **Not a clearance.** A Didit approval means *identity verified*. It does not
  clear the case, and nothing in this integration writes to `aml.cases`,
  screening, risk, holds or the service gate.

## Why it needed a new flow rather than a new adapter

The existing IDV pipeline is **capture-flow**: the Client Portal photographs a
document and a selfie into NPC's private buckets, the outbox worker downloads
them, and `runIdv()` is a synchronous call carrying two base64 images.

Didit is **hosted-session**: it owns the capture UI, the customer completes it
there, and the outcome arrives later on a signed webhook. Forcing that through
`runIdv()` would have meant NPC collecting a customer's images and posting them
to a provider that never asked for them — a second copy of the most sensitive
data we hold, moved for nothing.

So `IdvFlow` is declared explicitly (`capture` | `hosted_session`) and the two
registries are separate. `getIdvProvider()` **throws** if the resolved provider
is hosted, which is what stops the outbox worker picking one up.

```
capture flow (selfhosted, unchanged)     hosted flow (didit)
─────────────────────────────────────    ──────────────────────────────────
portal camera → NPC storage              portal → server creates session
submit_verification                      start_hosted_verification
verification_checks (document_reference) verification_checks (no document)
  ↓ trigger emits                          ↓ trigger does NOT emit
aml.verification.requested                 (nothing enters the outbox)
  ↓                                        ↓
outbox worker downloads captures         customer completes on Didit's UI
runIdv() → canonicalOutcome()              ↓
                                         signed webhook → didit-webhook
                                           ↓ server re-reads the decision
                                         applyDiditDecision() → canonicalOutcome()
```

Both paths converge on the same `canonicalOutcome()`, so attempt accounting,
exhaustion and the technical-vs-identity boundary behave identically.

## Keeping Didit checks out of the self-hosted worker

This is the defect most likely to be reintroduced. The worker downloads
`check.document_reference`; a Didit check has none, so it would throw
`storage_unreadable:document` and stamp a technical failure on a check whose
real outcome is already on its way.

Three locks, deliberately:

1. **The database trigger** (`20260908000000`) emits
   `aml.verification.requested` only when `document_reference IS NOT NULL`.
   Written as the consumer's actual precondition rather than a provider name,
   so any future hosted provider is covered without editing it.
2. **The worker** returns before claiming when `idvFlowFor(check.provider)` is
   `hosted_session`, and again when `document_reference` is null. This catches
   a legacy event already in the outbox from before the migration.
3. **`getIdvProvider()`** throws on a hosted key, so even a direct call cannot
   run one through the capture path.

## Required-feature validation — the rule that matters

An `Approved` session is **not** a pass on its own. NPC requires all three
modules to have actually executed and returned a decisive result:

| Situation | NPC outcome | Attempt consumed |
|---|---|---|
| Approved, all three modules Approved | `passed` | yes |
| Approved, a module missing / `Not Finished` | `referred` | yes |
| Approved, a module `In Review` | `referred` | yes |
| A module `Declined` (any session status) | `failed` | yes |
| `Declined` | `failed` (or `exhausted`) | yes |
| `In Review` | `referred` | yes |
| Unrecognised status | `referred` | yes |
| `Not Started`/`In Progress`/`Awaiting User`/`Resubmitted` | no change | **no** |
| `Expired`/`Abandoned`/`Kyc Expired` | no change, slot released | **no** |
| Didit API/webhook failure | no change, technical | **no** |

Unknown never becomes passed.

### Three V3 facts that break the obvious implementation

Read off the live account, not from memory:

- **Results are arrays**: `id_verifications`, `liveness_checks`, `face_matches`
  — plural, and `null` until that feature has run. `decision.face_match.status`
  is `undefined`, which a naive mapper turns into a pass.
- **The ID module has two names**: `OCR` in the workflow graph,
  `ID_VERIFICATION` on the session and decision. Validation runs against the
  decision, so it uses the latter.
- **Feature and session vocabularies differ.** A feature is `Not Finished |
  Approved | Declined | In Review`. A session adds `Not Started`,
  `In Progress`, `Awaiting User`, `Expired`, `Abandoned`, `Kyc Expired`,
  `Resubmitted`. Collapsing them loses the difference between "walked away"
  (free retry) and "we looked and said no" (consumed attempt).

## Webhook security

`didit-webhook` runs with `verify_jwt = false` because Didit's servers cannot
carry a Supabase JWT. **The HMAC is the authentication boundary.**

- `X-Signature`: HMAC-SHA256 over the **exact raw bytes**, hex, constant-time
  compared. The body is read as text and verified *before* `JSON.parse`, because
  parse→stringify does not round-trip byte-for-byte.
- `X-Timestamp`: rejected when `|now − ts| > 300`. Absolute, so a
  far-future timestamp is refused too.
- Missing secret ⇒ `not_configured` ⇒ rejected. Never accepted in the clear.
- Verification happens **before** a service-role client is constructed.

### The body is not the decision

The payload carries a `decision` object and it is ignored. The signature proves
the event is real; it does not make the body safe to derive an identity outcome
from. The authoritative decision is re-read over an authenticated
server-to-server call, then checked for correlation: session id, the configured
workflow id, and `vendor_data` matching this case and party. Any mismatch is an
integration fault — recorded, never a customer outcome.

### Idempotency, and why de-duplication is not what protects the customer

`aml.provider_events (provider, dedup_key)` de-duplicates on Didit's `event_id`,
which their retries reuse. But de-dup can be raced, and a crash can land between
the event insert and the row update.

So the real guarantee is the **conditional UPDATE**: settling is filtered on
`attempt_consumed = false AND processing_status IN ('submitted','queued','processing')`.
The second writer matches zero rows and reports `already_applied`. An attempt
cannot be consumed twice however many times the handler runs.

The event row is recorded **before** processing and marked `processed_at` only
after. A delivery that crashes in between is re-processed rather than
short-circuited as a replay — the failure mode of "dedupe first, process
second", which silently drops the outcome and strands the customer.

## Sessions

### `POST /v3/session/` is an upsert, not a create

**It deduplicates on `workflow_id + vendor_data`.** Measured against the live
API rather than inferred, and re-measured on 2026-08-14: two calls with the same
pair returned byte-identical `session_id`, `session_token`, `url` and
`session_number`, and merely overwrote `metadata`. Changing one character of
`vendor_data` returned a genuinely new session.

### The key is the PERSON: `npc:<case>:<party|primary>`

**Didit groups sessions into a Directory user by that exact string**, so the key
decides whether an applicant is one person or several in the Business Console.
It was briefly scoped to the attempt (`…:<capture-sequence>`) to break the dedup
on purpose, so a customer pinned to a session minted before a workflow change
could be given a new one. That worked, and it cost something nobody had
measured: production case `8c58cc07…` exists in Didit as **two** Directory
users, `:primary` and `:primary:3`.

The attempt is therefore gone from the key again, and the dedup it restores is
now load-bearing rather than merely tolerated:

- one NPC applicant is one Didit user, and every session they run aggregates
  under it — which is the whole reason this flow was reactivated (below);
- a refresh, a double-click or a second tab return the **same** unstarted
  session rather than buying another. That is the outermost duplicate-charge
  guard, outside NPC's own database.

**What it costs, stated plainly:** a key that no longer varies cannot force a
fresh session. `config.workflow_revised_at` still detects a stale session and
still releases NPC's row, but while the provider's session is alive (7 days,
`session_expiration_time`) a re-mint returns that same session. A settled or
expired session is replaced normally. Reconfiguration latency was traded for
provider-side identity, deliberately.

Because a session id can now legitimately be referenced by more than one NPC row
(a released row, and the live one that replaced it), `didit-webhook` selects the
**un-superseded, most recent** row rather than `maybeSingle()` — which fails
outright on a second row and would turn a real customer's outcome into a 500 and
then, once Didit stopped retrying, into no outcome at all.

`parseVendorData` accepts both the three-part and four-part forms, and
`vendorDataMatches` compares the attempt only when both sides carry one.
Four-part sessions minted during the attempt-scoped window stay valid for seven
days, and refusing to parse them would strand a live customer's decision.

### This flow is NOT active — read this before switching to it

`20260911000300` retired it on a product decision: no customer is sent to a
verification vendor's page. **That decision stands.** The code below is
complete, tested and reachable, but no tenant resolves it —
`didit_standalone` is the active provider row and `didit` is not, and
`start_hosted_verification` answers `409 temporarily_unavailable` for a tenant
that is not on a hosted provider.

It was briefly reactivated on 2026-08-14 on the reasoning that the Standalone
APIs could not produce a provider-side record. That reasoning was wrong about
the cause: the Standalone calls were sending `save_api_request=false`, and
Didit's published contract for that flag is that nothing is stored. Setting it
to `true` persists each request as an API-type session, visible in the Business
Console under **Manual Checks** — which is the record the business needed,
without moving anybody off NPC's own camera. See
[`DIDIT_STANDALONE_IDV.md`](./DIDIT_STANDALONE_IDV.md).

So the two consoles answer two different questions, and it is worth being
precise about which:

| Screen | Populated by |
| --- | --- |
| Verifications → **User Verifications**, Directory → **Users** | `POST /v3/session/` — the hosted flow below |
| **Manual Checks** | the three Standalone endpoints with `save_api_request=true` |

Activating this flow would need a migration flipping the two provider rows, and
that migration deliberately does not exist in the tree.

### Stale configuration

A session is created against the workflow as it stood at that instant. Combined
with the dedup above, a customer who pressed Start before a workflow change was
pinned to the old configuration until the session expired — a reconfiguration
that never reached the people it was made for. That is what left customers on
the cross-device QR screen after `is_desktop_allowed` had already been
corrected.

Didit's version number cannot tell you this happened. Measured on this
account: changing a **setting** (`is_desktop_allowed`) left the published
workflow at version 1, while editing the **graph** (`documents_allowed`)
created version 2. So a session and the live workflow can report the same
version across a change that matters. There is no version comparison that
answers the question.

So the marker is NPC's. `aml.provider_configs.config.workflow_revised_at` is an
ISO-8601 instant, **set by whoever changes the Didit workflow**:

```sql
UPDATE aml.provider_configs
   SET config = jsonb_set(config, '{workflow_revised_at}',
                          to_jsonb('<the workflow's updated_at>'::text), true)
 WHERE tenant_id = 'default' AND capability = 'idv' AND provider_key = 'didit';
```

`start_hosted_verification` releases any in-flight session created before it and
mints a fresh one. That release is a **technical supersede**: `status` and
`attempt_consumed` are untouched, no identity outcome is written, and the
timeline entry is categorised `technical`. Forgetting to set the marker is safe
in the boring direction — the guard does nothing, which is how it behaved
before it existed.

### One session per party

At most one in-flight hosted session per party, enforced by a partial unique
index (`uq_aml_verification_active_hosted_session`) rather than by check-then-insert,
because every lost race is a real session NPC pays for.

The attempt scope does not weaken this. Repeated requests for the *same*
attempt still produce the same key and therefore the same session, so a
double-click cannot buy two. Only a new attempt gets a new key.

A double-click, refresh, second tab or backend timeout all land on the same
session: the portal reconciles the existing check against Didit and returns the
customer to it. **The hosted URL is never stored** — it embeds the session token
— so it is re-read from the decision endpoint each time and passed straight
through to that customer's browser.

An abandoned or expired session is released (`processing_status = 'cancelled'`,
`superseded_at` set) leaving `status` and `attempt_consumed` untouched: not
finishing is not failing.

## What NPC stores, and what it deliberately does not

`outcome_detail.didit` is built by **allow-list** (`summariseDiditDecision`),
not by removing known-bad keys — a deny-list over someone else's versioned
payload is an invitation to persist a field that did not exist when the list was
written.

Stored: session id, workflow id/version, session status, environment, mapped
outcome, reason, per-feature status/score/warning-categories, timestamps.

**Never stored:** the API key, the webhook secret, the session URL or token
(the URL *is* a credential), any image or video reference (`front_image`,
`portrait_image`, `reference_image`, `video_url`, …), or the identity data read
off the document (document number, MRZ, DOB, name, address). Didit returns
signed URLs to the customer's ID photograph and liveness video; NPC never
fetches or persists them. Not holding a duplicate copy of the biometrics is the
point of using a hosted provider.

## The workflow flag that decides whether the customer uses one device or two

**`is_desktop_allowed` defaults to `false` on a newly created workflow, and it
is the single most consequential setting on it.**

With it off, Didit refuses desktop capture outright. The customer does not get
a camera — they get a full-screen QR code and "continue on another device" as
the *primary* experience, with same-device capture nowhere. That is what
production shipped with, and it is not diagnosable from this repo: the portal
code is identical either way, the session is created normally, the API returns
200, and the only difference is what the provider's own page decides to render.
The second "I have finished"-style button customers reported was the handoff
screen's own control, not a duplicate of ours.

Read it back after any workflow change:

```
didit_workflow_get → { "is_desktop_allowed": true, "status": "published" }
```

Both the live and sandbox `NPC Identity Verification` workflows are set to
`true`. Do not create a replacement workflow without setting it.

### The capture runs in its own window, not in an NPC iframe

The provider's flow used to be embedded in an iframe inside the portal. It is
now opened as a **separate top-level window**, the way a payment authorisation
is: NPC owns the whole journey either side of it, and the provider owns only
the minute in which a document is photographed and a face is matched.

That removed the class of failure this section used to be about. The provider
decides a device "cannot capture" from what actually works inside the frame, so
a withheld iframe capability became a silent device handoff — which is why the
old embed had to delegate the full documented `allow` set and refuse to
sandbox. A top-level window asks for the camera in its own right, under its own
origin, in a permission prompt that names whose page is asking. There is no
`allow` list to get wrong and no frame to sandbox.

What replaces those rules:

- **The window is opened synchronously inside the customer's click**, before
  the session request — `window.open('', target, features)`, then
  `startHostedVerification`, then `win.location.replace(url)`. A window opened
  after an `await` is an unsolicited popup and is blocked on default settings
  in Safari and Firefox. Getting this order wrong does not degrade the flow, it
  ends it.
- **A blocked window still creates the session.** Its URL is held in memory —
  never storage — so recovery is one press rather than another round trip the
  browser would block in turn.
- **A closed window is never a failure.** It says nothing about what happened
  inside it; the customer may have finished. The portal stops claiming the
  check is in progress, re-reads the server, and offers Continue.
- **The window is named**, so a double-click, a second tab or a re-open reuses
  the one window instead of stacking them.

### Which screens the customer sees

NPC now asks which document **before** any session exists, on its own screen,
and passes the answer down as a session-level restriction:

```jsonc
"expected_details": {
  "id_country": "AUS",                    // ISO 3166-1 alpha-3, always
  "expected_document_types": ["DL"]       // P | DL | ID | RP
}
```

Those are the documented values for `expected_details` on `POST /v3/session/`
(the field is case-insensitive; the full enum also includes `HIC`, `TC` and
`SSC`, and NPC has no value that reaches them — a Medicare, health or
concession card is not an identity document here). The mapping lives in
`providers/didit.pure.ts` and nowhere else, so the browser never carries the
provider's vocabulary; it sends `passport` / `driver_licence` / `identity_card`
/ `residence_permit` and the server translates.

`id_country` is emitted on **every** session, declared document or not. The
customer is never asked which country they are in, because there is only one
answer and asking it was one of the two screens that made the old flow feel
like somebody else's product.

The provider's Start screen remains **mandatory** — there is no supported way
to remove it, and white label only rebrands it. It is now the first thing the
customer sees in the provider's window rather than an unexplained page inside
NPC's, which is a different proposition entirely. Capture-review and
OCR-data-review screens stay off
(`is_image_capture_review_screen_enabled`,
`is_ocr_id_verification_data_review_enabled`).

The official web SDK (`@didit-protocol/sdk-web`) is an iframe wrapper around
the same session URL and is therefore the thing this design deliberately does
not use.

### The return page is a receipt, not a result

Sessions are created with a `callback` pointing at
`/client/aml/identity-return` on NPC's own origin, and `callback_method: both`
so a customer who handed the check to a phone also finishes on an NPC page
rather than the provider's end screen.

The origin comes from `PUBLIC_APP_URL` or a compiled-in constant and **never**
from the request — a callback taken from a caller would be an open redirect
minted by NPC's own server and handed to a customer mid-verification.

Didit appends `verificationSessionId` and `status` to that URL. **Nothing reads
them.** The page does not parse the query string at all; it says "Verification
received", tells its opener a bare `{ type: 'npc:identity-return' }` at this
origin, and offers to close itself. A redirect is authored by whatever the
browser was last pointed at, so trusting one would mean anybody who can type a
URL could mark themselves verified. The identity decision still arrives only on
the signed webhook, and is still re-fetched server-to-server before it settles
anything.

### Changing document mid-flight

A session minted for a passport restricts the provider to a passport, so a
customer who comes back and picks their licence would otherwise meet a picker
that will not offer it. If the reconciled session is still `Not Started`, it is
released and replaced; once they are `In Progress` or `Awaiting User` the
session in their hands wins whatever they picked on this screen. The release is
a technical supersede — `status` and `attempt_consumed` untouched — because
changing your mind about which card to hold up is not a failed identity check.

### The flag is necessary, not sufficient

Correcting the workflow does not reach a customer who already has a session.
See "Stale configuration" under **Sessions** — the session is pinned to the
configuration it was minted under, and the provider will hand the same session
back for the same `vendor_data`. After changing the workflow, set
`config.workflow_revised_at`; without it the fix reaches nobody who had already
pressed Start.

One more to rule out if same-device capture still fails: a
`Permissions-Policy: camera=()` response header. This used to be checkable on
the portal's own document, because the portal was what framed the capture; it
is now a header on the **provider's** document and outside NPC's control. What
is worth ruling out on our side is that the customer is looking at the
provider's own permission prompt at all — the window is top-level, so the
browser's address bar names the origin that is asking.

## Configuration

Provider selection is **server-side only**. The browser is told `capture` or
`hosted` and nothing more — never a provider key, never the workflow id.

Server-side secrets (Supabase Edge Function environment):

| Name | Purpose |
|---|---|
| `DIDIT_API_KEY` | server-to-server API calls (`x-api-key`) |
| `DIDIT_WEBHOOK_SECRET` | HMAC verification of inbound webhooks |
| `DIDIT_WORKFLOW_ID` | fallback if not set in provider config |

Readiness requires **all three**. A deployment holding only the API key would
create chargeable sessions whose results could never be accepted.

The workflow id is preferably set in tenant config
(`aml.provider_configs.config.workflow_id`) so it can change without a deploy.
The migration seeds the `didit` provider row **inactive**; switching NPC onto it
is a deliberate operator action:

```sql
UPDATE aml.provider_configs
   SET active = true,
       config = jsonb_set(config, '{workflow_id}', '"<workflow-uuid>"')
 WHERE tenant_id = 'default' AND capability = 'idv' AND provider_key = 'didit';
-- and deactivate the previous IDV provider if it should no longer take traffic.
```

The webhook destination is configured in the Didit console (or via MCP) as
**v3**, subscribed to `status.updated` and `data.updated`, pointing at
`https://<project-ref>.supabase.co/functions/v1/didit-webhook`.

## Tests

| File | Covers |
|---|---|
| `src/lib/aml/diditDecision.test.ts` | status vocabulary, required-feature validation, correlation, sanitisation, and a **verbatim real payload** from the live sandbox |
| `src/lib/aml/diditWebhookSecurity.test.ts` | signature, replay window, constant-time compare, receiver ordering, routing safety, session gates |
| `src/lib/aml/diditIdempotency.test.ts` | the ugly cases — duplicate/concurrent/crashed/out-of-order deliveries — run functionally against the real settling logic |
| `src/lib/aml/diditAmlScope.test.ts` | Didit AML never enabled, no case/screening writes, portal privacy boundary, no credential under `src/` |
| `src/components/portal/IdentityVerificationStep.test.tsx` | the secure check rendered for real — the document question before any session exists, the window opened synchronously before the session call, a blocked window recovered in one press without an attempt, a closed window that is not a failure, and neither a return message nor any other browser event asserting an outcome |
| `src/lib/aml/identityDocumentSession.test.ts` | the closed list of documents, the provider mapping and its Australia-only country, the server-controlled callback origin, the bytes actually posted to `/v3/session/`, and that no standalone verification endpoint exists anywhere |
| `src/pages/portal/PortalIdentityReturn.test.tsx` | the return page renders identically whatever the provider put in the query string, claims receipt and never a verdict, and sends its opener a payload with no status field |
| `src/lib/aml/idvAdapterReadiness.test.ts` | wiring comes from the registry, not a hardcoded key — hosted and capture providers both report correctly, `wired` stays distinct from `configured`, and readiness never carries a credential |
| `src/lib/aml/diditSessionLifecycle.test.ts` | a session minted under superseded configuration is not returned, a new attempt gets a genuinely new session while the same attempt stays idempotent, correlation still resolves case/party/attempt, and superseding costs no attempt and writes no outcome |

Two harnesses go further than unit tests, because the failures that matter most
here are wiring failures — and wiring is invisible to a unit test:

| Command | What it actually runs |
|---|---|
| `npm run test:didit-webhook` | boots the REAL `didit-webhook` function as a Deno process and drives it over HTTP with genuinely signed requests against an in-memory PostgREST + Didit stand-in. 20 scenarios, 75 assertions: duplicate/concurrent/crashed/out-of-order deliveries, bad signatures, stale timestamps, tampered bodies, wrong workflow, wrong party, every status, and a decision API outage. |
| `npm run test:didit-migration` | applies the migration chain to a throwaway PostgreSQL and asserts the behaviour the SQL exists for: a selfhosted check still emits `aml.verification.requested`, a hosted check emits nothing, a second active hosted session is refused with 23505, releasing an abandoned one frees the slot, and re-applying is a no-op. |

Neither needs credentials or network access to Didit.

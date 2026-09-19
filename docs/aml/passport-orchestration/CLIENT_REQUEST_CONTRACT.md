# The client-request contract

One definition of what the Command Centre may ask a client to do, and where
that request lands in the Client Portal.

**Module:** `supabase/functions/_shared/aml/clientRequestContract.pure.ts`
Pure, dependency-free, no `@/` alias, explicit `.ts` on imports — it must parse
under Deno and in the browser.

---

## Why it exists

The same six action codes were written out in three files that never compared
notes: the writer (`aml-cases`), the reader (`aml-client-portal`) and the router
(`src/lib/aml/portalRequestRoute.ts`). A code the writer accepted and the reader
dropped produced no error anywhere — it produced a client staring at a request
with no button.

## The vocabularies

### Action codes

| Code | Client button | Opens | `client_requests.kind` |
| --- | --- | --- | --- |
| `complete_identity_verification` | Complete identity verification | verify | `additional_info` |
| `upload_document` | Upload requested document | documents | `new_document` |
| `update_questionnaire_section` | Update information | questionnaire | `additional_info` |
| `review_consent` | Review updated consent | consent | `re_consent` |
| `provide_clarification` | Respond | respond | `clarification` |
| `review_and_submit` | Review and submit | review | `additional_info` |

Mirrored by the CHECK constraint in `20260831000100`. Adding a code here without
adding it there stores nothing; adding it there without adding it here routes
nothing.

`kind` and `action_code` are two columns that must agree — `kindForAction`
derives one from the other, which is what stops a "document" request arriving
with a "review consent" button.

### Questionnaire sections

`purchasing_structure` · `personal_details` · `entity_details` ·
`related_parties` · `purchase_profile` · `funding`

Which of these a given client sees is computed per case from their purchasing
structure and funding sources — the applicable set is a **subset** of this list,
never a value outside it. `aml-client-portal` now derives its `ALL_SECTIONS`
from here, so a section it will accept a write for is exactly a section a
request may route to.

### Target steps

`identity_verification` · `upload_document` · `documents` · `questionnaire` ·
`consent` · `review` · `respond`

A superset of every value any code path writes.

## The rules

1. **Closed vocabularies only.** An unrecognised action code, target step or
   section code becomes `null`. Nothing is stored that the reader cannot
   resolve.
2. **No URLs, ever.** `action_target` is a set of named fields, never a
   location. `sanitiseActionTarget` builds its result field by field from
   allow-list tests — there is no spread of the input, so an unrecognised key
   cannot survive. `requirement_id` is uuid-shape-checked.
3. **A dropped field beats a trusted one.** Where a value fails validation the
   request is still created without the routing hint, and the portal falls back
   to the route that always works.

## What changed at the call sites

| Site | Before | After |
| --- | --- | --- |
| `create_client_request` | hand-rolled sanitiser; **dropped `section_code`** | `sanitiseActionCode` + `sanitiseActionTarget` |
| `request_submission_*` | `String(body.section_code)`, unvalidated | same sanitiser |
| `aml-client-portal` projection | own literal list + own field copying | same sanitiser |
| `portalRequestRoute.ts` | own `REQUEST_ACTIONS` table | derived from `CLIENT_ACTIONS` |

`portalRequestRoute.TARGET_STEPS` deliberately stays narrower than the
contract's: it decides electronic capture versus manual upload, and every other
value — including a perfectly valid `documents` — must fall to manual, which is
what `null` does there. Widening it would silently stop unknown targets falling
back.

## The one name collision worth knowing

`upload_document` is both an **action code** (what the request asks for) and a
**target step** (where it opens). They are different vocabularies that happen
to share a spelling. A test that greps for "the action list is not restated"
has to exclude the `TARGET_STEPS` declaration first, or it fails on correct
code — which it did, once.

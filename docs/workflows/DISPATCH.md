# Workflow Playground — how a live workflow actually runs

Read this before touching the run engine, the trigger capture triggers, the
dispatcher, or anything that decides what a saved graph means.

## The three ways a workflow runs, and the one engine underneath

| Started by | Engine runs in | Performer | Mode |
|---|---|---|---|
| **Test run** (a person) | the browser | `simulate` — sends nothing | `test` |
| **Run live** (a person) | the browser | `createServerPerformer` → `execute-workflow-step`, one call per step | `live` |
| **A captured event** (nobody) | `dispatch-workflow-triggers` | `executeStep`, in process | `live` |

All three call the same `runWorkflow` from
`supabase/functions/_shared/workflow/engine.pure.ts`. That location is the
point: the engine decides branch ordering, which paths a filter skips, and when
a run halts, and a second implementation of those rules would diverge from the
first on the day somebody reports a bug about a branch. The browser imports it
through one-line shims under `src/lib/workflow/` — see `types.ts`, `graph.ts`,
`catalog.ts`, `runtime/engine.ts`, `runtime/expressions.ts`,
`runtime/triggerMatch.ts`, `runtime/sampleData.ts`, none of which contain any
logic of their own.

Two consequences worth knowing:

- **`_shared/workflow/*.pure.ts` must parse under Deno.** No `@/` aliases, and
  explicit `.ts` extensions on relative imports. `types.pure.ts` restates the
  integration-category union rather than importing the registry for exactly this
  reason; `catalog.spec.ts` asserts the restatement still matches.
- **`uncoveredIntegrations()` stays in `src/lib/workflow/catalog.ts`.** It is the
  only thing in the catalog's surface that reads the integration registry, and
  the registry is a browser module.

## Capture → dispatch

```
row trigger on clients / generated_reports / purchase_files
   └─ enqueue_workflow_trigger_event(type, dedupe_key, payload)
        └─ workflow_trigger_is_live(type)?  ── no ──▶ dropped, deliberately
             └─ INSERT … ON CONFLICT (dedupe_key) DO NOTHING
                  └─ status = 'pending'
                       └─ pg_cron, every minute
                            └─ dispatch-workflow-triggers
                                 ├─ claim_workflow_trigger_events()   FOR UPDATE SKIP LOCKED
                                 ├─ matchTrigger(event, live workflows)
                                 ├─ runWorkflow(...)  →  workflow_runs + workflow_run_steps
                                 └─ release_workflow_trigger_event(...)
```

**Nothing is captured unless a live workflow listens for it.** That is
`workflow_trigger_is_live`, and it is why the events table reads empty on a
deployment with no live workflows — which is correct, not broken. Verified
against production in a rolled-back transaction: with one live
`platform.client_created` workflow present, inserting a client captures exactly
one event whose payload matches the catalog node's declared outputs.

## The four rules the dispatcher exists to get right

They live in `_shared/workflow/dispatch.pure.ts` and are tested in
`src/lib/workflow/__tests__/dispatch.spec.ts`, because every one of them is
wrong *quietly*.

1. **A run the engine reports as `failed` is not retried.** It ran; its steps are
   in the history saying why. Re-dispatching would repeat every side effect the
   steps before the failure already had. Only a failure to dispatch *at all* —
   the engine throwing, or the run not being recordable — is retried, **and only
   when nothing else ran for that event**. There is no per-workflow state on an
   event, so a retry re-runs every workflow the event matched; when one already
   succeeded, retrying would send its message twice. Duplicated client-facing
   side effects are worse than a run that did not happen and said so, so a
   partial failure is recorded on the event (red in the run panel) and can be
   started by hand from the canvas.
2. **An event no live workflow matches is `processed`, not failed.** Most events
   happen while nothing is listening.
3. **The claim counts an attempt up front**, so an event that kills the
   dispatcher still walks up to `MAX_ATTEMPTS` and stops instead of being
   re-claimed for ever. An event put back *untried* — the batch ran out of wall
   clock, or the workflows table could not be read — gets the attempt refunded
   (`p_refund_attempt`), or a busy five minutes would exhaust its retries before
   anything had ever been dispatched for it.
4. **The batch stops taking work while a whole event still fits**, not while any
   time remains. Beginning an event with four seconds left is how a workflow gets
   killed between its third and fourth step with the first two already committed.

`FOR UPDATE SKIP LOCKED` is the other half: pg_cron does not wait for the
previous run, and a workflow dispatched twice sends the message twice.

## What live execution can actually perform

**Derived from the catalog, never listed.** `liveCapability.pure.ts` computes
the answer once and all three callers read it — the browser (to refuse locally
with a useful message rather than take a 400), the executor, and the dispatcher.
It used to be two hand-maintained lists kept honest by a test comparing them,
which holds right up until somebody adds an integration and updates one.

A step is runnable for one of two reasons:

1. **It declares a `request` descriptor.** This is the scalable half — see
   `httpRequest.pure.ts`. The difference between "send an SMS" and "post to
   Slack" is a URL, an auth style, a body shape and where the id comes back;
   none of that needs a function, so the catalog carries it as data and one
   executor performs all of it. Adding a vendor is a declaration beside the
   operation.
2. **It has a hand-written executor**, for the few a descriptor cannot express:
   `core.http` and `core.graphql` (generic protocols the author pointed
   somewhere themselves, SSRF-guarded by `assertCallableUrl` — no private
   ranges, no cloud metadata, 30s and 512KB ceilings), `core.notify_team`
   (writes our own `notifications`), and the four `mcp.*` steps (JSON-RPC).

`core.webhook_respond` is client-only: it shapes the reply the *caller* of an
inbound webhook is holding open, so there is nothing for a server to do. A
dispatched run records it as succeeded with a note saying there was no caller.

Everything else simulates, and says so on the step.

### The template language, and the three things it exists for

`{{name}}` reads resolved config, `{{secret.KEY}}` a saved credential. Beyond
that there are exactly three forms, each because leaving it out forces every
descriptor to work around it:

| Form | Why |
|---|---|
| `{{name\|object}}` | a `keyValue` field is edited as `{key,value}[]` and APIs want an object — Airtable's `fields` cannot be expressed without it |
| `{ $first: [a, b] }` | a per-step override falling back to an integration default (Twilio's sending number). Named rather than a bare array because inside a body an array is a JSON array |
| `{ $when: x, … }` | drops a whole object, not just an empty key — `{ role: 'system' }` with no content is rejected by every model API |

A template that is exactly one reference yields the **value**, not a string, so a
webhook body stays an object and `max_tokens` stays a number.

Two rules the builder enforces that are otherwise silent failures: a blank
optional field is **omitted**, never sent as `""` (several APIs validate the
presence of a key rather than its content), and an unresolved reference never
interpolates the text `undefined` into a customer's message.

### Vendors that answer 200 for a failure

Slack replies `{"ok": false, "error": "channel_not_found"}` with HTTP 200. A
descriptor declares `okPath`/`errorPath` so a message that never appeared is
recorded as failed rather than sent. Any vendor with the same habit needs the
same two lines.

### Metering

Every described call goes through `_shared/meteredFetch.ts`, which resolves the
credential from the host and logs the call itself — so a vendor added by
declaration is billed without anybody remembering to say so. A host absent from
`_shared/apiUsageBilling.pure.ts` is metered and **never billed**; see
`docs/integrations/API_USAGE_METERING.md` before adding one whose key the prime
supplies.

### `core.poll` is deliberately not implemented

Its `until` field defaults to `{{poll.body.status}}` — a reference to the step's
*own* output. The engine resolves a step's config before running it, so that
reference cannot resolve, and the field has no defined meaning at the moment it
is needed. Implementing it would mean inventing the semantics rather than
honouring them. It also asks for waits up to 15 minutes by default, which no
Edge invocation can hold. Both need a product decision first.

## Identity

A dispatched run has no operator. Steps run under `workflows.created_by`, which
`authenticated-data` stamps on INSERT only (`insertOwnerColumn` — deliberately
not `ownerColumn`, which would also scope reads and would rewrite authorship
whenever a colleague saved an edit). A workflow with no recorded author can
still be built and test-run; it simply cannot address anyone unattended, and
`core.notify_team` fails with that as its message rather than writing a
notification with a null `target_user_id` that nobody would ever see.

## Deploy order

The cron job calls an Edge Function, so **the function must be deployed before
the migration is applied**. `deploy-supabase-functions.yml` ships functions on
push to `main`; migrations are applied out of band (CI does not apply them).
Applying `20260816000000_dispatch_workflow_trigger_events.sql` first is not
harmful — `net.http_post` just 404s once a minute — but it is noise for no
reason.

## Delays

`honourDelays: false` everywhere, including dispatch. A `core.delay` records the
pause and the run continues. Real waiting needs a scheduler holding the run's
state between ticks, not an Edge invocation sleeping — nothing here provides
that, and a workflow whose delay matters should not be relied on yet.

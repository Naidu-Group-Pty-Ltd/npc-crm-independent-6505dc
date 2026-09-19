# WP-18 — A 5xx must not hand the caller the exception

Phase 3 of the 20-item app-security programme. Checklist item **17**
("stack traces in production").

## What was wrong

329 catch blocks across 275 edge functions returned the caught error verbatim —
`error.message`, `String(err)`, and in `manage-partner-agreements` an
`err.stack`.

A Postgres error message is not prose, it is schema:

```
null value in column "password_hash" of relation "custom_users" violates not-null constraint
permission denied for table client_income_sources
duplicate key value violates unique constraint "partner_agreement_records_acceptance_id_key"
```

Table names, column names, constraint names — and the second one confirms both
that a table exists and that it is guarded, which is exactly what someone
mapping the database wants to know. Across a few hundred endpoints that is a
readable schema dump, and provoking a 500 is usually no harder than sending a
malformed body. Fetch failures name internal hosts; stack traces name file
paths.

Nothing gated it.

## What replaces it

`supabase/functions/_shared/errorResponse.ts`:

```ts
} catch (error) {
  return new Response(
    JSON.stringify(internalError(error, 'send-email-reply')),
    { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
}
```

The caller gets `{ error: 'Internal error', code: 'internal_error',
correlation_id }`. The log gets everything — name, message, stack, and any
`cause`, which is where a wrapped driver error keeps its useful half.

**The correlation id is the point.** An opaque error nobody can trace is a worse
product than a leaky one; support has to be able to take a code a user quotes
and find the failure. Logging is deliberately a side effect of building the body
rather than a second call, because the second call is the one that gets
forgotten — and a forgotten log turns this from a fix into an outage with no
evidence.

`securityJsonError` in `_shared/requestSecurity.ts` already covers deliberate
denials, and its status union is `400 | 401 | 403 | 413 | 429 | 503` — it has no
500. That omission is why this is a separate module rather than another arm on
that one.

## Scope, and what was deliberately left alone

Rewritten: **249 object literals in 245 files**, every one of them inside a
`catch` block, feeding a client response body (the argument of `JSON.stringify`
or one of the local `json`/`jsonResponse` helpers), at a **5xx** status.

Left alone, on purpose:

- **`console.error(JSON.stringify({ … error.message }))`.** The log is where the
  detail belongs. Ten such sites match the same shape as a response body and
  rewriting one would delete the evidence this change exists to preserve, so the
  codemod and the gate both exclude them explicitly rather than by luck.
- **Internal result objects.** `_shared/llmRouter.ts` returns a Response-*shaped*
  object (`{ ok, status, json(), text() }`) to callers inside the same function;
  the provider error never leaves the process on its own. `ai-dashboard-agent`
  puts the failure in a tool-result `content` string fed back to the model — a
  tool that failed silently would have the model report success.
- **4xx a user is meant to act on.** "Your password has appeared in a breach",
  "that file is too large", a validation message, "that URL could not be read".
  Those are answers, not leaks.

Sixteen non-5xx sites that still echo a caught error are listed in the gate's
`ERROR_DISCLOSURE_EXEMPTIONS` with a reason each. The rule for adding one is
that the message must be something the person reading it can act on — a DocuSign
credential expiry a staff operator can renew, a GHL fetch failure that explains
an empty panel, a webhook ack that tells the *provider* their payload was
malformed.

## Preserving contracts

The spread goes **first**:

```ts
return json({ ...internalError(err, 'manage-loan-writer-undertakings'), error: 'internal_error' }, cors, 500);
```

Several sites paired the leak with a machine-readable constant the frontend
switches on. Spreading last would have quietly rewritten `error: 'internal_error'`
to `error: 'Internal error'` and broken those checks. The leaked key is already
removed, so there is nothing left for the spread to need to override.

Checked directly: the two places the frontend branches on an error string
(`ClientTracker.tsx` on `'No GHL opportunity linked'`) read values returned
from deliberate business paths at lines 142 and 208 of
`update-ghl-opportunity-stage`, not from its catch block. Untouched.

## The gate

`scripts/security/check-error-disclosure.mjs`, wired into `ci.yml` and
`npm run security:test`. Zero tolerance at 5xx — the codemod took the count to
zero, so there is no baseline to ratchet.

It parses rather than greps: brace-matched catch bodies, brace-matched object
literals, top-level comma splitting that respects strings and nesting, and the
enclosing call's arguments to find the status. The status can be `{ status: 500 }`
on `new Response`, or a positional argument on a local helper — and this repo has
both `json(body, 500, cors)` and `json(body, cors, 500)`, so the arguments are
parsed rather than matched by position.

## Verification

```
node scripts/security/check-error-disclosure.mjs        # 863 files, 0 leaks at 5xx
node scripts/security/check-security-gate-negatives.mjs # 23 removed, 23 failed as required
node scripts/security/check-edge-functions.mjs          # 384 (was 426)
npm run security:test && npm run build                  # green
```

## A side effect worth recording

The Deno type-check went from **426 errors to 384** — the codemod removed 42
pre-existing ones without being aimed at them. They were `TS18046`: `error.message`
on a catch variable that TypeScript types as `unknown`. Every one of those was a
site where the leaked expression was *also* a latent runtime fault — a non-Error
throw would have produced `undefined` in the response body rather than a message.

Baseline rebanked at 384.

## Residual

- The `describe()` helper logs `err.stack` in full. That is correct — it is a
  log — but if log shipping ever leaves this project, stacks go with it.
- 4xx bodies are unchanged in bulk. A validation message that happens to quote a
  constraint name would still leak, and no gate catches that; it needs the
  schema work in WP-21 rather than a string rule.

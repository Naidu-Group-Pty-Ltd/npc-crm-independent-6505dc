# WP-19 — One CORS contract, and a rule that notices the next wildcard

Phase 4 of the 20-item app-security programme. Checklist item **12**
("CORS set to star").

## The shape of the problem

126 edge functions contain a hardcoded `'Access-Control-Allow-Origin': '*'`.
That number on its own says nothing, because 87 of them **also** build their real
headers with `createCorsHeaders(origin)` or wrap the handler in
`withRequestOrigin` — the literal is dead, overwritten before the response
leaves.

The 39 that never call a shared-origin helper are the actual set, and they are
not one problem. Sorted by the exposure class the registry already records:

| Class | Count | Does a browser session reach it? |
|---|---|---|
| `human-authenticated` | 5 | **yes** |
| `portal-authenticated` | 4 | **yes** |
| `public-auth` | 1 | **yes** |
| `public` | 7 | browser, but no credentials |
| `cron-worker` | 12 | no |
| `internal-service` | 4 | no |
| `webhook` / `webhook-secret` / `webhook-clientstate` | 6 | no |

Only the first ten are broken. The Fetch spec requires a browser to **reject** a
credentialed response carrying a wildcard origin, and to do it opaquely — the
caller sees `TypeError: Failed to fetch` and cannot tell it from the function
being down. Phase 0 found three push endpoints failing exactly this way; these
ten are the rest of that set.

## What changed

**Ten functions wrapped** in `withRequestOrigin` (`_shared/corsOrigin.ts`),
which rewrites the origin per request from the same `ALLOWED_ORIGINS` allowlist
every other function uses. This *tightens* the policy — a wildcard becomes an
allowlist — it does not loosen it.

`agent-skill-marketplace`, `aml-client-portal`, `bc-scenario-agent`,
`check-model-availability`, `client-portal-batch6`, `client-portal-finance-hub`,
`diagnose-ghl-attribution`, `market-qa-share`, `market-updates-voice-transcribe`,
`template-share`.

**The other 29 keep their wildcard, deliberately.** The seven `public` ones serve
open data to any origin and must; the rest are server-to-server, where CORS is
never evaluated at all. Rewriting them would be churn with a regression surface
and no security gain. What matters is that the choice is now *enforced* rather
than incidental — see the gate below.

## Two things in `_shared/auth.ts` that contradicted their own comment

**Preview origins were trusted unconditionally.** `lovablePreviewSuffixAllowed`
is gated behind `CORS_ALLOW_LOVABLE_PREVIEW` and says so plainly: *"Production
leaves this unset, so suffix origins are NOT trusted for credentialed
responses."* But two **exact** Lovable preview URLs sat in
`credentialedOriginAllowlist()` with no flag at all, so they could read a
response carrying the staff session cookie in production. Both forms now answer
to the same flag.

**An unset `ALLOWED_ORIGINS` fell through to hardcoded hostnames** behind a
`console.warn`. Two problems: missing configuration stayed invisible, because
the app worked and nobody set the variable; and trust stayed pinned to two
hostnames in source, which keep being trusted after the app moves off them. It
now fails closed.

> **Deployment note.** If `ALLOWED_ORIGINS` is currently unset on the deployed
> project, this change stops trusting `command-centre.npcservices.com.au` and
> `npc-property-dashbord.lovable.app` for credentialed responses. Set
> `ALLOWED_ORIGINS` before deploying — or set
> `CORS_ALLOW_LEGACY_FALLBACK_ORIGINS=true` as a temporary bridge. This cannot
> be verified from the repository, so it needs checking against the project's
> secrets before this phase ships.

Failing closed means an unlisted origin gets the same deliberate ACAO mismatch
any other unlisted origin gets — the browser refuses it. It is not a crash, and
`https://origin.invalid` (RFC 2606) keeps the allowlist non-empty so the
mismatch value is always a defined string rather than `undefined`.

## The gate

`check-cors-contract.mjs` gains a rule that asks the question from the other
side.

The existing credentialed-wildcard rule works by tracing
`invokeSecureFunction('name')` call sites through `src/`. That is precise but it
only sees what it can trace — a name held in a variable, a portal wrapper, a call
added later, and it misses the function entirely. All 39 functions above were
invisible to it.

The new rule reads the exposure class from `SECURITY_REGISTRY.json` instead: if
the class means *a browser talks to this while logged in*, a hardcoded wildcard
with no shared-origin helper is an error. The classes that are absent from that
set — `public`, `cron-worker`, `internal-service`, the webhook classes — are
where a wildcard is legitimate, and the registry is already reviewed and
drift-gated, so the exemption is a fact about the endpoint rather than a list
somebody maintains by hand.

A new function that lands as `human-authenticated` with a copy-pasted wildcard
header now fails CI on the first run.

## Verification

```
node scripts/security/check-cors-contract.mjs            # green
node scripts/security/check-security-gate-negatives.mjs  # 24 removed, 24 failed as required
node scripts/security/check-edge-functions.mjs           # 384, at baseline
npx vitest run src/lib/auth                              # 44 passed
npm run security:test                                    # green
```

Two negative tests cover the two rules independently — one unwraps a push
endpoint (transport tracing), one unwraps `template-share` (registry class) —
because a single case passing would not tell you which rule was doing the work.

## Residual

- The wrapped handlers keep their now-dead wildcard literal in the module-scope
  `corsHeaders` object, matching the pattern `aml-cases` and the other 87
  already use. It reads oddly at a glance; the alternative is editing every
  header object and the response construction that spreads it, which is a larger
  diff for a value that is overwritten on the way out.
- `withRequestOrigin` rewrites the origin but not `Access-Control-Allow-Headers`,
  so a wrapped function still answers its own snapshot of the header list. The
  contract gate already checks those lists are supersets of what the client
  sends, which is what stops that going stale.

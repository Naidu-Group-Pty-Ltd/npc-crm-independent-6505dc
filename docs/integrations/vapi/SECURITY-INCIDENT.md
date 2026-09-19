# Two secrets were committed to this repository

Found 2026-08-18 while running an exhaustive fetch check on the assistants. Recorded here
because the values reached a pushed branch and **rotation is the only real remedy**.

## What leaked

| Secret | Value shape | Files | Commits |
| --- | --- | ---: | ---: |
| Vapi webhook secret — `x-vapi-webhook-secret` header on 13 assistants and 1 phone number | `vapi_wh_…`, 72 chars, **one distinct value** | 42 | 5 |
| Vapi `serverUrlSecret` — in assistant version history | `vg-…` / `vg_…`, 23 chars, **two distinct values** | 2 | 1 |

Commits: `9d15f79`, `dec6310`, `59ae872`, `b0282ab`, `b4acc63` — all pushed to
`claude/export-make-blueprints-fz0gfs`.

**Not affected.** The Airtable PAT, the GoHighLevel PIT token, the Twilio Account SIDs and
the Vapi API key were all correctly redacted and appear in **0** files and **0** commits.

## Why the redaction missed them

The rule was a regex anchored on the whole key:

```
^(authorization|apikey|api_key|token|secret|password|twilioAuthToken)$
```

`x-vapi-webhook-secret` and `serverUrlSecret` both *contain* "secret" but neither *is*
"secret", so neither matched. The rule was written against the keys that happened to be
visible in the tool payloads and was never checked against the full set of keys in the data.

## What replaced it

An exact match on the lowercased key against a fixed set — derived by enumerating **every**
credential-adjacent key across every payload first, rather than guessing:

```
authorization · x-vapi-webhook-secret · serverurlsecret · twilioaccountsid
twilioauthtoken · apikey · api_key · x-api-key · password · token · secret · privatekey
```

Exact matching matters in both directions: it catches the two that leaked, and it does **not**
catch `maxTokens`, `promptCacheKey`, `isServerUrlSecretSet`, or the static-body-field `key`,
all of which are ordinary configuration that must stay readable.

A second, value-based sweep now runs over the whole tree after every rebuild and replaces any
`vapi_wh_…` or `vg[-_]…` shaped string it finds. The working tree is clean: **0 files** match
any of the five secret patterns.

## What still needs doing

1. **Rotate the Vapi webhook secret.** It is one value shared by 13 assistants and a phone
   number, and it is in pushed history. Rotating it in Vapi updates every consumer at once.
2. **Rotate both `serverUrlSecret` values.**
3. **Decide about history.** The working tree is clean but the values remain in five commits.
   The branch is unmerged, so a `filter-repo` rewrite and force-push is available and would
   remove them — at the cost of rewriting shared history. Rotation makes the exposure
   harmless either way; the rewrite is defence in depth, not a substitute.

Nothing was rewritten unilaterally: that is a destructive, force-push operation on a pushed
branch and it is the repository owner's call.

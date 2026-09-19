# Loading the sanctions lists

`aml.sanctions_entries` is the register every sanctions screening matches
against. An empty or stale one is a live compliance failure, and the provider
is written to fail closed on it — a required list that is absent, stale beyond
72 hours, or whose **latest sync attempt failed** raises
`sanctions_list_unavailable`, which is recorded as a technical condition and
can never read as a customer outcome.

DFAT is the only **required** list (`DEFAULT_REQUIRED_SANCTIONS_LISTS`): it is
the legally operative Australian source. UN and OFAC are supplemental — their
staleness is reported in the screening summary and blocks nothing, because
entries persist between syncs.

## The two routes, and what each is for

| | `.github/workflows/aml-sanctions-refresh.yml` | AML Verification → **Sanctions list health** |
| --- | --- | --- |
| runs | daily, 18:10 UTC | when an MLRO uploads the workbook |
| needs | repository secret `SUPABASE_SERVICE_ROLE_KEY` | an MLRO session, nothing else |
| fetches | DFAT/UN/OFAC itself | the person already downloaded it |
| maps + normalises | `scripts/aml/sanctionsParsers.mjs` | `_shared/aml/sanctionsIngest.pure.ts` |
| promotes the provider | **no** | yes, via `decideProviderPromotion` |

The two mapping implementations are held together by
`dfatParserParity.test.ts`. Normalisation must never move to the browser:
names are indexed with the same function the screening query uses, and a
client that normalised differently would write entries no query can ever
match — a list that silently matches nobody looks exactly like one that works.

## What was actually wrong (2026-08-19)

The register had been empty since the platform was built. **Four** independent
faults, each of which explained it on its own, and each hidden behind the one
before it.

**1. The refresh had never had write credentials.** Every scheduled run since
the workflow was added failed at the credentials check — the repository secret
does not exist. The workflow is deliberately written to fail loudly rather
than downgrade itself to a dry run, so this was visible as 12 consecutive red
runs and nothing else. The one green run in that window was an explicit
`dry_run=true` dispatch, which skips the check.

**2. The prune step could not run at all — and failed the whole load.** On a
MUTATION, PostgREST resolves the columns named inside a logical `or=(…)`
against the RETURNING projection rather than against the table. So

```js
.delete().eq('list_code', list).or(`sync_id.is.null,sync_id.neq.${sync.id}`).select('id')
```

answers `42703 column sanctions_entries.sync_id does not exist` on a table
that plainly has the column, while the identical filter on a `GET`, and the
same `.neq` outside an `or()`, both succeed. The fix is to name `sync_id` in
the projection; dropping the `or()` is the tempting wrong answer, because a
bare `.neq` never matches a NULL `sync_id` and would leave rows that predate
sync tracking unprunable forever.

This is the fault that would have survived fixing the secret. The loader
records the run as **failed**, and the provider fails closed on a required
list whose latest attempt failed — so a complete, current DFAT list would have
sat in the table while every screening refused to run, with the schedule red
every night for a reason that had nothing to do with the data.

**3. The refresh could not construct a database client.** `@supabase/supabase-js`
builds a `RealtimeClient` inside `createClient`, and that constructor demands a
**native WebSocket** — which arrived in Node 22. The workflow pinned Node 20,
like every other workflow here, so the loader died before reading a byte of any
list:

```
Error: Node.js detected but native WebSocket not found.
  at createClient (@supabase/supabase-js)
  at main (scripts/aml/load-sanctions-lists.mjs:201)
```

Invisible for the same reason as everything else here: the job died one step
earlier, at the credential check, on every run this workflow had ever had. The
secret was added on 2026-08-19 and the very next run failed here, in zero
seconds. The loader uses no realtime feature at all — the requirement comes from
the client constructor, so it cannot be dodged by not subscribing to anything.
This workflow now pins Node 22; nothing else in the repository calls
`createClient` from a workflow.

**4. DFAT does not serve a scripted client reliably.** The landing page
answers 403, and the published file's own address answered 403 to Node's
`fetch` and then timed out under `curl` from the same host minutes after a
plain `curl` had fetched it successfully. The loader already carries
`--dfat-url` and `--dfat-file` for this, and the browser-upload route exists
because a person with a browser is blocked by none of it.

## Current state

DFAT loaded 2026-08-19: **3,846 entries**, `payload_sha256 515f1f58…`, newest
listing in the file **2026-07-21**, from
`https://www.dfat.gov.au/sites/default/files/Australian_Sanctions_Consolidated_List.xlsx`.
`pep_sanctions` / `local_lists` promoted `simulator` → `live` under
`decideProviderPromotion`'s rule (DFAT, entries actually written, active, out
of simulator only).

UN and OFAC are **not loaded**. Nothing is blocked by that, and the daily
refresh will load them once it can write.

## The rules

- **A green scheduled run is the only thing that keeps this current.** Without
  the repository secret the list goes stale in 72 hours and screening starts
  refusing — correctly, and with no signal on this side.
- **Never publish a list that parsed to zero entries.** A broken download is
  not a mass delisting, and screening against an empty list clears everybody.
  The loader refuses it; so does the ingest operation.
- **Freshness of the LOAD is not currency of the DATA.** `assessListRecency`
  reads the file's own Control Dates because every other control here measures
  when we synced — and a four-year-old file uploaded today passes all of them.
- **A shrink is a truncated download until a person says otherwise.**
  `PRUNE_SHRINK_FLOOR` keeps the old entries and exits non-zero.

# Final coverage sweep — every read path, accounted for

The last pass before the push leg: every `GET` in the OpenAPI document
(`https://api.vapi.ai/api-json`), plus every live-but-unspecified path found earlier,
checked against what this snapshot holds. **Verdict: nothing configuration-shaped remains
unfetched.** Reads only — no writes were made.

## Collection endpoints

| Endpoint | Result | Disposition |
| --- | --- | --- |
| `/assistant` `/tool` `/squad` `/phone-number` `/workflow` | 28 / 20 / 3 / 6 / 1 | Captured in full, with versions. |
| `/structured-output` | 6 | Captured. |
| `/observability/scorecard` | 1 | Captured (empty `metrics`). |
| `/reporting/insight` | 6 org-authored | Captured. See materialisation note below. |
| `/reporting/board` | 1 | Captured ("Default Dashboard", empty). |
| `/file` | 90 | Metadata for all 90; bytes for the two NPC documents. |
| `/test-suite` | 2 | Captured. |
| `/credential` | 7 | Captured; values never returned by the API. |
| `/session`, `/chat`, `/campaign`, `/v2/campaign` | **0 items each** | Empty — confirmed this sweep. |
| `/v2/phone-number` | same 6 ids as `/phone-number`, byte-identical records | Adds nothing — confirmed this sweep. |
| `/eval`, `/eval/run`, `/eval/simulation`, `…/scenario`, `…/run`, `…/suite` | 0 | Empty. |
| `/eval/simulation/personality` | 7 platform defaults (`a0000000-…`, foreign `orgId`) | Nothing to migrate. |
| `/knowledge-base`, `/template` | 0 | Empty — assistants carry `provider: google` file lists inline instead. |

## Endpoints that are data, not configuration

- `/call` and `/call/{id}/*` (recordings, logs, pcap) — call history. There is no API that
  writes call history into another org, so it **cannot migrate by construction**. The
  aggregate is kept in [`call-volume.json`](./call-volume.json); the old account remains
  the archive until it is closed.
- `/logs` — Vapi's own API access log (1,198 entries, the most recent being this
  snapshot's reads). Not configuration.
- `/analytics` — a query endpoint (`POST` with a query body), not stored state.
- `/provider/{provider}/{resourceName}` — browses provider libraries (voices, models).
  Org-independent catalogue data; nothing to migrate.
- `/eval/simulation/concurrency` — requires a simulation id; no simulations exist.

## `/org` is not readable with this key

`GET /org` answers **401** ("you may be using the private key instead of the public key,
or vice versa") to the same private key every other endpoint accepts. Org-level settings —
concurrency limits, billing, org display name — are therefore outside what this snapshot
can capture, and outside what a `POST` clone could carry anyway: they are set in the new
account's dashboard by hand.

## ⚠️ A read materialised platform furniture (disclosed, not a config change)

`GET /reporting/board/default/metrics-overview` lazily **created** Vapi's default
"Metrics Overview" board the moment it was first read — its `createdAt` is this sweep's
own timestamp — and with it three `systemKey` insights (`Call Volume`,
`Total Call Minutes`, `Reason Call Ended`). `/reporting/insight` then returned 9 where it
had returned 6.

This is Vapi's server-side lazy default, triggered by any first visit to the dashboard's
metrics page; no request in this programme sent a write verb. It is recorded here because
"don't change the account" was the standing rule and the object list did change — by
platform behaviour, not by an instruction we sent. Consequences:

- The three `systemKey` insights and the "Metrics Overview" board are **platform
  furniture, not user configuration** — the new account will materialise its own on first
  dashboard visit. They are excluded from the clone set.
- The six org-authored insights (no `systemKey`) remain the only reporting configuration
  to migrate, exactly as captured.
- The materialised board is kept for the record at
  [`reporting/board.metrics-overview.SYSTEM-MATERIALISED.json`](./reporting/board.metrics-overview.SYSTEM-MATERIALISED.json).

## Where this leaves the ledger

Every path in the spec is now fetched, empty, data-not-config, or credential-gated — and
every live-but-unspecified path (`/workflow`, `/test-suite`, `/credential`,
`/knowledge-base`, `/template`, `/logs`, the three version endpoints) was fetched from the
live probing side. The two sources still disagree about what exists; the union is what
this snapshot holds. The next leg is the push: [`../clone-kit/`](../clone-kit/).

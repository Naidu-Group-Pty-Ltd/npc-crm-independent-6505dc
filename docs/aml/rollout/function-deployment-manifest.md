# Function deployment manifest — release candidate

Source commit: `7ee5005` (branch
`claude/aml-ctf-remediation-and-controlled-rollout`). Source hashes are
sha256 (first 16 hex) of the entry file at that commit. "Deployed hash"
stays **unknown — not deployed** until an operator records direct evidence
from the target environment. Deno `check` = 0 errors for every entry.

| Function | Source hash | Registry entry | verify_jwt | Deployed (staging) | Deployed (production) |
|---|---|---|---|---|---|
| `aml-reliance` | `b60b189c398644e2` | public-auth, reviewed | false (session/token auth in-function) | **not deployed** | **not deployed** |
| `aml-records` | `964826bfae7f6925` | pre-existing entry unchanged | per registry | **not deployed** | **not deployed** |
| `cross-portal-outbox-worker` | `cf8fd37b7efe2e82` | cron-worker, reviewed | false (`x-worker-secret`) | **not deployed** | **not deployed** |

Shared modules ride with each deploy: `_shared/aml/attestationV2.ts`,
`relianceEligibility.ts`, `partnerWorkspace.ts`, `partnerEvents.ts`,
`partnerRetention.ts`, `partnerOperations.ts`.

Boundary controls verified at source (registry/static/CORS/CSRF suites, all
at baseline): security registry 14 known findings (none new); CORS wildcard
rewrite via `withRequestOrigin`; CSRF guard on both AML functions; rate
limit on evidence access (10/min/membership); safe error handling (no
secrets, truncated errors). Worker schedule: **not configured** — owner and
cadence to be recorded at staging deployment.

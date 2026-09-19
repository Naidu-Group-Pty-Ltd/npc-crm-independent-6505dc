# Vapi clone kit — the push leg, staged but not fired

Everything needed to `POST` the NPC estate into the new Vapi account, built from the
read-only snapshot. **Nothing in this directory has been executed.** `push.py` refuses
every write without `--execute`, and every write additionally requires
`VAPI_TARGET_TOKEN` — a key that does not exist yet, because the new account does not.

## What is here

| File | What it is |
| --- | --- |
| `payloads/` | 49 generated POST bodies in ten dependency-ordered phases: 2 files, 12 tools, 6 structured outputs, 1 scorecard, 15 assistants, 1 squad, 1 workflow, 4 phone numbers, and (optional) 6 insights + 1 board. |
| `index.json` | Per payload: the Create DTO it targets, its endpoint, every cross-reference as a JSON pointer (104 create-time + 13 deferred), the env vars it needs, and its warnings. |
| `build_payloads.py` | Regenerates all of the above from `../npc-services` and `../snapshot`. Deterministic, offline, validates every payload against `create-dtos.json` and exits non-zero on any mismatch. |
| `create-dtos.json` | The 38 Create DTO top-level shapes distilled from the pinned OpenAPI document by `distill_spec.py` — so validation works without the 2 MB spec. |
| `push.py` | The executor. Dry-run (`plan`) by default; `probe`, `run`, `verify` subcommands. |
| `url-map.template.json` | The 12 legacy `hook.eu2.make.com` URLs the tool payloads carry, ready to be filled with their us2 replacements. |

## The order of operations at cutover

1. **Rotate first.** `VAPI_WEBHOOK_SECRET` must be the **new** secret, minted after the
   rotation `../SECURITY-INCIDENT.md` requires. Pushing the leaked value into the new
   account would launder the incident into the clean environment.
2. **Create the new account**, mint a private API key, `export VAPI_TARGET_TOKEN=…`.
3. **Re-authorise the seven provider credentials by hand** (Vapi never returns their
   values). The `make` credential must target team `2731020` / `us2`, not the legacy
   `528268` / `eu2`. Nothing references a `credentialId`, so skipping this fails at call
   time, not create time.
4. **`python3 push.py probe --execute`** — settles the contested-field question
   (`CLONE-CONTRACT.md` in `../snapshot/`): creates one throwaway assistant and one
   throwaway `transferCall` tool carrying the nine + three fields the spec omits, prints
   an accepted/dropped verdict per field, deletes both. If fields come back DROPPED,
   decide their modern replacements (`backgroundSpeechDenoisingPlan`, `keypadInputPlan`,
   `server.url`, `artifactPlan.recordingEnabled`) **before** step 6 — two live NPC
   assistants depend on `backgroundDenoisingEnabled`.
5. **Fill `url-map.json`** (copy the template) once the us2 Make scenarios have webhook
   URLs — or deliberately skip it, in which case the cloned tools keep calling the
   legacy eu2 webhooks until Make cutover, which keeps working but couples the two
   migrations. `push.py` refuses a map with unfilled entries.
6. **`python3 push.py run --execute [--url-map url-map.json] [--include-optional]`** —
   creates everything in dependency order, remaps all 104 create-time references onto the
   new ids as they are minted, substitutes secrets from the environment in memory only,
   and read-back-diffs every create. After the assistants exist it **backfills** the 13
   deferred reverse references (`assistantIds` on the structured outputs and the
   scorecard) with a PATCH each — those form a cycle with the assistants that forward-
   reference them, so they cannot ride on the create. Resumable: `clone-state.json` records progress and a
   re-run skips what exists. `--strict` aborts on any dropped field.
   For the two Twilio numbers, also `export TWILIO_ACCOUNT_SID=…` (both share one SID)
   and optionally `TWILIO_AUTH_TOKEN`.
7. **`python3 push.py verify`** — re-reads every created object and asserts every
   cross-reference resolves in the target org.
8. **Re-point what the clone cannot carry:** the two vapi-provider numbers get **new
   `sipUri`s** (anything dialling the old URIs must be updated); the Twilio numbers stay
   owned by Twilio and re-attach by SID; call history stays in the old account.

## Safety properties (tested offline)

- **Wrong-account guard**: before the first write, the target is fingerprinted — any
  assistant carrying the source `orgId` (`c9015cd5…`) or any id from this snapshot
  aborts the run.
- **Remap + substitution exercised against all 47 JSON payloads** with a fake id map:
  every reference pointer rewrites, and no `{{REDACTED:*}}` placeholder, legacy Make
  URL, or source-org id survives into a request body.
- **Topology asserted**: every create-time reference points at a strictly earlier phase,
  every deferred reference resolves within the set, no core payload references an
  optional one, and the three dangling toolIds appear nowhere. The final sweep caught the
  one violation — `assistantIds` on phases 02/03 pointing forward at phase 04 would have
  aborted a live run mid-flight; it is now the deferred backfill above, and `verify`
  checks the backfilled field too.
- **A missing env var aborts** before anything is sent; secrets never touch disk —
  `clone-state.json` holds only ids and timestamps.

## What is deliberately NOT in the payloads

- The three dangling `toolIds` (deleted in the source org) — dropped loudly, recorded in
  `index.json` warnings, on `NPC Discovery Call Follow Up` and `…Test 2`.
- `sipUri` on the two vapi-provider numbers — minted per org.
- The lazily-materialised "Metrics Overview" board and its three `systemKey` insights —
  platform furniture the new account grows on its own (`../snapshot/FINAL-SWEEP.md`).
- The 13 excluded assistants, their tools, and the two unreferenced tools carrying the
  Airtable PAT / GHL PIT.
- The duplicate `Zoom Call Booked` structured output (`468022e7…`) is built but marked
  `optional`; nothing references it.

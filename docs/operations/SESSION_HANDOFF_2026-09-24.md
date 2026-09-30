# Session handoff — 24 Sep 2026

Written for whoever picks this up next. The owner is continuing in **another
Claude account**, so assume nothing from this conversation is available to you
except this file, the repository and the tools. Like the 22 and 23 Sep
handoffs, it records **state**, not recollection:

- every production figure was read back from GitHub Actions runs,
  `function_logs` or the deploy logs;
- every claim about a fix was executed, as a spec, in CI or on a local
  reproduction;
- anything else is marked **PENDING** or **BLOCKED** in those words.

Written at 14:45 UTC. This file arrives on its own docs-only pull request from
branch **`claude/adoring-hopper-g02tdt`**. That branch was restarted from
`main` at **`ffe1890d5`** (#2761) because its previous pull request had merged.
The pull request merges only on the owner's confirmation; until then, read the
file from the branch.

---

## 0 · If you read one thing

**Everything the owner approved today is live, and nothing has used it yet.**
The owner's next act is to regenerate the reports. Yours is to prove, from the
production logs, what each regenerated report was placed by and where its
planning was read (§4).

What went live today, in order (all times UTC):

| | What | Evidence |
|---|---|---|
| 13:59 | **#2761 merged** as `ffe1890d5`: geocoding precision carried end to end, and the address service. | 9 of 9 checks green on `c43c4d159` |
| 14:00 | Migration **`20261220090000`** applied. It widens `geocode_cache_provider_check` to admit `photon` and `gnaf`. | `apply-migration.yml` run 36009553840: *"Recorded 20261220090000 in schema_migrations, with its body."* |
| 14:00 | **Frontend publish** submitted | Lovable deployment `ed921c69-971f-4baf-b467-e09d92c4be66`. Lovable reported `latest_commit_sha` = `ffe1890d5` first. The publish answered `pending`; **PENDING**: not checked on the live site |
| 14:15 | **Address service live on Fly.** App `aurixa-address-service`, one machine `78111d62a60168` in `syd`. The door and chain proofs both passed on Fly. | `address-service.yml` run 36009586032 |
| 14:15 | **Geocoding chain repointed.** The run wrote `GEOCODER_GNAF_URL`, `GEOCODER_PHOTON_URL` and `AUTOCOMPLETE_PHOTON_URL` to the project's secrets. There was no `GEOCODER_PROVIDERS` override, so the default order `gnaf, nominatim, photon, abs_locality` applies. | same run: `written: GEOCODER_GNAF_URL GEOCODER_PHOTON_URL AUTOCOMPLETE_PHOTON_URL` |
| 14:21 | **Edge functions deployed.** Every function redeployed, because `_shared` changed; the CORS contract check passed. | `deploy-supabase-functions.yml` run 36009505162: `location-intelligence-service`, `generate-investment-report`, `google-places-autocomplete` and `investment-scoring-service` each logged `Deployed Functions on project dduzbchuswwbefdunfct` |

**The proof that matters, from the Fly machine itself before the repoint:**
the real geocoding chain placed **all eight of the owner's report addresses at
the address itself, from G-NAF** (table in §3). A log search from 14:15 to
14:35 found no geocode through the new service. **The first production report
placed by G-NAF is therefore still PENDING**, and the owner's regeneration is
what settles it.

---

## 1 · Standing constraints — read these before doing anything

These are from the owner, carried verbatim from the 22 and 23 Sep handoffs,
and **still in force**.

- **No direct SQL.** `mcp__Supabase__execute_sql` is *not* approved. The two
  reviewed migration workflows — `apply-migration.yml` and
  `migration-drift.yml` — are the authorised route to the database, and a
  queued Lovable "Query Database" request was explicitly **not** approved.
  Reading production **logs** through the Supabase MCP (`query_logs`, project
  `dduzbchuswwbefdunfct`) is log inspection and *is* permitted.
- **Do not bypass access controls**, or substitute server responses, replay
  renders, or publication confirmations for application acceptance.
- **Record unperformed checks as BLOCKED or PENDING, never PASS.**
- **Do not substitute manually patched data, fixtures or stored-report replays**
  for a real measurement.
- **Do not request credentials, JWTs, service-role keys or internal secrets.**
- **Do not break existing functionality.**
- **Do not touch the builder portals, AML/CTF compliance, or agreements.**
- **Do not introduce new infrastructure or destructive migrations** without
  separate approval, and do not repeat completed template migrations.
- **Open pull requests when they are necessary, and confirm with the owner
  before merging and before publishing** (a deploy, or a migration dispatch).
  In the owner's words: *"open Pull Requests when they are necessary, the only
  one thing i ask is confirm before merging and publishing"*.
- Authorised spend for the acceptance exercise is **A$25** including paid
  retries; track it and pause before exceeding it. **Spent so far: A$0.00.**

Also in force, from the owner's earlier instructions:

- work on an isolated branch;
- do not deploy, change live data, run destructive migrations or distribute
  reports without explicit approval;
- where access or tooling prevents verification, state exactly what remains
  unverified and the required next action;
- never print, commit or ask for a credential, and never build a diagnostic
  path to read one;
- preserve the working Perplexity and Lovable configuration.

**The two infrastructure approvals given today**, so nobody re-asks for them:

- 10:37 UTC, on running our own lookup service and loading G-NAF: *"in
  relation to your feedback my thoughts is that you porceed with both as they
  showcase value and further accuracy"*.
- 13:10 UTC: *"Please proceed with the two decisions to merge and publish one
  green and proceed with fly deploy i want to then geneerate the reports again
  so we can put this to rest and move on"*.

That approved one always-on Fly machine at **≈ A$19–24 a month**. This is a
running cost the owner approved, not spend against the A$25 test budget.
Anything beyond that one machine (a second machine, a bigger one, a volume)
is a new decision for the owner.

The owner's standing brief: *take full ownership of the programme, think
outside the box, and always keep in mind the end user receiving the report —
the quality and presentation, and how content is placed within the report so a
client can read it easily.*

---

## 2 · What today changed, and why (24 Sep)

Six pull requests from this branch merged today. Others merged from other
branches (#2750, #2752, #2754, #2755, #2758, #2759); they are not this
session's, so do not attribute their changes here.

| PR | Merged (UTC) | What it did |
|---|---|---|
| #2751 | 01:23 | Docs (the 23 Sep close-out). |
| #2753 | 03:40 | **One evidence basis per generation.** The location call gets the time it needs, and the sections and the score on a row come from one basis. See `INVESTMENT_REPORT_RESUME.md` §11. |
| #2756 | 04:54 | **The grade letter is the band of the score**, and A+ starts at 80 (eligibility 5.0.0). A higher score never prints a lower letter. See `SCORING_V2_METHODOLOGY.md`, section *5.0.0*. |
| #2757 | 07:19 | **A failed read is not a failed report.** A 3-second Supabase outage had stamped a finished 60 Lawley Street report *Failed*. Each section is now told what it is (its contract rides the system message), which is why the risk register appears. See `INVESTMENT_REPORT_RESUME.md` §12 and `INVESTMENT_STRUCTURE.md`. |
| #2760 | 09:27 | **An address the chain can read, and a listing's facts in every section.** The suburb was dropped from *Schofields Farm Road, Schofields*. `(tallawong)` was read as the suburb. `1408/5` was read as the postcode. *Victoria Street, Brisbane* was read as VIC. Beds and baths reached only sections 1–5. See `GEOCODING_WITHOUT_GOOGLE.md` §16 and `INVESTMENT_REPORT_RESUME.md` §13. |
| #2761 | 13:59 | **Precision carried end to end, and our own address service (G-NAF + Photon).** See §3 below, `GEOCODING_WITHOUT_GOOGLE.md` §17 and `ADDRESS_SERVICE.md`. |

**Why #2761 existed.** From **07:51:29 UTC** the public OpenStreetMap
Nominatim answered **HTTP 403** to every request from the production egress.
The chain fell to the ABS suburb centroid, which is correct as a floor. Then
four things went wrong:

- it cached that centroid as the address's permanent answer;
- the location service dropped the answer's precision;
- the planning read was stamped `address`;
- Blacktown's 14th-floor apartment was reported as *R2 — Low Density
  Residential*.

#2761 fixes the chain:

- floor answers are provisional and re-asked after an hour;
- a refusal pauses its provider, and its words are logged;
- precision travels on the point;
- planning is read only at address or street precision;
- a stored point with no recorded precision is re-acquired.

It also adds two street-level providers that cannot refuse us: **G-NAF** (the
national address register, 15.9M addresses) and **our own Photon**. They run
together on one Fly machine behind one token.

---

## 3 · The address service — what is proved

Read `docs/integrations/ADDRESS_SERVICE.md` before touching any of it. It
records all three CI runs and the deploy. In short:

- **The register** is the AUG 2026 GDA2020 release. It holds 15,949,543 current
  addresses, served as 12,872,133 rows across 2,652 postal-area files (168 MB),
  and builds in **313 s** in a GitHub runner, one postal area at a time.
- **Self-check:** of 1,996 sampled asks in each form, 99.90% were found at their
  own point and **none at the wrong place**.
- **The image** is 3.15 GB. The Photon index is 2.4 GB, with its lock files
  deleted in its own layer, and the image was healthy in 10 s.
- **The chain proof on the Fly machine** used only the service's two providers,
  so no answer could have come from anywhere else:

| Owner's report address | Answered by | Precision | Matched |
|---|---|---|---|
| 1408/5 SECOND AVE, Blacktown NSW 2148 | gnaf | address | 5 Second Avenue, Blacktown NSW 2148 (the building; `PC`) |
| 93 Schofields Farm Road (tallawong), Schofields NSW 2762 | gnaf | address | 93 Schofields Farm Road, **Tallawong** NSW 2762 (`PC`) |
| 60 Lawley Street, Spalding WA 6530 | gnaf | address | same (`PC`) |
| 9 Hollow Street, Golden Square VIC 3555 | gnaf | address | same (`FCS`) |
| 97 Poole Road, Kellyville NSW 2155 | gnaf | address | same (`PC`) |
| 18 Annabelle Crescent, Kellyville NSW 2155 | gnaf | address | same (`PC`) |
| 262 Pallas Street, Maryborough QLD 4650 | gnaf | address | same (`PC`) |
| 291 Stone Mason Drive, Kellyville NSW 2155 | gnaf | address | same (`BC`) |
| *10 Leakes Road, Truganina VIC 3029 (a test address, not a report)* | photon | street | Leakes Road, Truganina VIC 3029 — G-NAF has no number 10 there |

Note what G-NAF says about Schofields: the register files number 93 under
**Tallawong**, which is what the listing's `(tallawong)` note was trying to say.

---

## 4 · The next step: the owner regenerates, you verify from the logs

### 4.1 Which reports

| Address | Latest report id (UTC) | State before today's fix | Regenerate? |
|---|---|---|---|
| 93 Schofields Farm Road (tallawong), Schofields NSW 2762 | `bf2698c6-d7b4-42f4-9012-d59ffc33c1fd` (10:16) | B 61, QA passed, but **placed at the suburb centroid**: planning, location and grade unreliable | **Yes** |
| 1408/5 SECOND AVE, Blacktown NSW 2148 | `4f8bc0d0-389d-4c5f-b457-05b8def99b21` (10:19) | D 35, QA passed, but **placed at the suburb centroid**: *R2* is wrong for a 14th-floor apartment | **Yes** |
| 60 Lawley Street, Spalding WA 6530 | `5d8bc97e-9305-49a4-bb3d-5cd2a7a0d82d` (10:19) | A+ 89, QA passed. Its location was placed before the outage | Optional: it would gain G-NAF provenance |
| 9 Hollow Street, Golden Square VIC 3555 | `5f7fb137-fc6b-4e7c-97aa-54d936afc8e0` (05:23) | regenerated for the grade comparison under #2756 | Optional |

Earlier ids for the same addresses:

- `79d677d6-b00b-4585-a3c0-834af057aa6e` is Schofields at 07:46. Its QA failed
  and its grade was withheld; it predates #2760.
- `de783a4b-1c20-4fcd-b53a-cff763b28105` is Blacktown at 07:51, when unit 1408
  was read as the postcode.

**Why a regeneration will not simply reuse the bad points.** Each of these is
enforced by code on `main`:

- a remembered suburb-centre answer is provisional, and after an hour the
  street-level providers are asked again (`geocodeChainPolicy.pure.ts`);
- a stored enrichment whose point recorded no precision is re-acquired;
- a planning answer that records no point is asked again (`enrichmentPoint.pure.ts`,
  `locationEnrichmentReuse.pure.ts`, and `planningPointIsRecorded` in
  `acquisitionReuse.pure.ts`).

All three rows above were written before #2761, so none of their points
recorded a precision.

### 4.2 What to read, and what good looks like

Use `mcp__Supabase__query_logs` (read-only, permitted), project
`dduzbchuswwbefdunfct`. Always pass `iso_timestamp_start` and
`iso_timestamp_end` for the regeneration window. Do not loop on it.

1. **Find the runs:**
   ```sql
   select timestamp, log_attributes['execution_id'] as exec, substring(event_message,1,200) as msg
   from logs where source='function_logs'
     and (event_message like 'Report ID:%' or event_message like 'Property address:%')
   order by timestamp asc limit 50
   ```
2. **Where each property was placed.** The deployed code logs exactly these lines:
   ```sql
   select timestamp, substring(event_message,1,300) as msg from logs
   where source='function_logs'
     and (event_message like '%placed at % precision by %' or event_message like '[geocoder]%')
   order by timestamp asc limit 100
   ```
   - **Good:** `[location-intelligence-service] placed at address precision by gnaf`
     and `[geocoder] location-intelligence-service/geocode: gnaf address for "…"`.
   - **Acceptable, disclosed on the page:** `… by photon` at `street`. That is
     the Leakes Road case: an address G-NAF does not hold.
   - **A problem:** `abs_locality` / `locality` for any report address.
     `[geocoder] … gnaf answered 5xx` or a timeout means the service was not
     reachable. `… answered 403 … paused until …` is a refusal, and the
     refusal's own words follow it; they are still unrecorded for Nominatim,
     so capture them (§6).
3. **Completion and QA:** look for each run's final section and its QA line in
   the same function logs. The 23 Sep handoff §5 has query shapes used before.
   The report page itself is the acceptance.
4. **On the page:**
   - the planning section should say its registers were *"retrieved
     automatically at the property’s own address point"*;
   - it should carry **"Where the address point comes from. The national
     address register, G-NAF."** followed by the G-NAF licence sentence
     (`planningFacts.pure.ts`);
   - a street-level point must say it was read on the street, not the lot;
   - an area-centre point must read no planning at all.

**Blacktown's zone:** do not predict it. It will now be read at the
building's own point (5 Second Avenue), and whatever the register answers
there is the answer.

### 4.3 If a report is not placed by G-NAF

Read the `[geocoder]` line's detail first. It says whether the register was
not asked, answered no match, or failed. `no_match` is a statement about the
address. `unavailable`, `refused` and `budget` are ours (`GEOCODING_WITHOUT_GOOGLE.md`).

Then check the machine by effect: the last `address-service.yml` run's
proofs, or a new dispatch **only with the owner's confirmation**. This
sandbox's egress policy **refuses `*.fly.dev` and `fly.io`**, so you cannot
curl the machine from here. A GitHub runner can.

---

## 5 · Operating the address service

- **App** `aurixa-address-service`, organisation `personal` (the workflow's
  default, because the `FLY_ORG` variable is unset). One `shared-cpu-2x` / 2 GB
  machine in `syd`, always on, bluegreen deploys, no volume.
- **URL** `https://aurixa-address-service.fly.dev`. `/healthz` is the only door
  without the token and reveals nothing but up or down. Every other path needs
  the path token.
- **The token** is derived, never minted: an HMAC of `address-service:<app>`
  under `FLY_API_TOKEN`. It lives in the Fly secret `ADDRESS_SERVICE_TOKEN`
  and inside the three Supabase secrets above. **Never print it, log it or
  ask for it**; the workflow masks it. Rotating `FLY_API_TOKEN` rotates it,
  and a redeploy with `repoint: true` follows.
- **Refresh.** G-NAF releases in Feb, May, Aug and Nov, and the Photon index is
  rebuilt upstream weekly. A refresh is Actions → *Address service (G-NAF +
  Photon)* → Run workflow on `main` with `deploy: true`. That is a deploy, so
  **confirm with the owner first**. A failed build changes nothing, because
  the live machine keeps serving.
- **Stopping the chain from asking it** (rollback lever, owner's decision):
  remove `GEOCODER_GNAF_URL`, `GEOCODER_PHOTON_URL` and
  `AUTOCOMPLETE_PHOTON_URL` in the Supabase dashboard (Edge Functions →
  Secrets). An unset `GEOCODER_GNAF_URL` makes the chain skip G-NAF without a
  request. Stopping the cost means stopping or destroying the Fly app in its
  dashboard. **Neither is something to do on your own initiative.**

---

## 6 · Open items, PENDING and follow-ups

In order of how soon they matter:

1. **PENDING: the first production report placed by G-NAF.** The owner's
   regeneration settles it (§4).
2. **PENDING: the frontend publish** of `ffe1890d5` (Lovable deployment
   `ed921c69…`). Lovable accepted it and answered `pending`. It has not been
   checked on the live site, which this sandbox cannot load. The frontend
   changes are small: shared geocoding and planning modules the pages import.
3. **Photon's first answers after a restart.** The first lookup on the new
   machine took 7.1 s, measured from a US runner, against the chain's 6 s
   allowance for a provider. Until the cache warms, such a lookup falls to the
   next provider. G-NAF is asked before Photon and answered every report
   address, so this matters only for addresses G-NAF lacks. Measure from the
   edge (the functions run near the machine) before changing anything. Two
   possible fixes, neither built:
   - a warm-up query in `start.sh` once `/status` answers;
   - a longer allowance for the self-hosted base only.
4. **Memory.** A 2.4 GB index sits behind 2 GB of RAM. Watch the answer times
   for a week before proposing 4 GB, which is a cost change for the owner.
5. **The public Nominatim is still refusing** (403 since 07:51 UTC). The chain
   now pauses it for 30 minutes after each refusal and logs the refusal's own
   words. **PENDING**: read those words from the next refusal line and record
   them in `GEOCODING_WITHOUT_GOOGLE.md` §17.
6. **Housekeeping: the applied-body manifest.** Run 36009553840 reported *"2
   file(s) now match and are not recorded yet — run `npm run
   migrations:body-digests` to add them"*. That is a small PR, and it merges
   only on the owner's confirmation. See `APPLIED_MIGRATION_BODIES.md`.
7. **The matcher cannot read a lettered number prefix.** Examples are `L1
   Ikartuka Terrace, Oodnadatta` and `M508 Longs Hill Road, Glen Park`: 2 of
   1,996 in the self-check (0.1%). They are reported as not found, never as
   the wrong place. A small reader change in `gnafShard.pure.ts` if it ever
   matters.
8. **Interpolated points.** 0.7% of rows (`GG`, placed between known points
   on the street) count as `address` precision, because G-NAF places them at
   the address. This is disclosed in `ADDRESS_SERVICE.md` §10. Whether a
   planning read should treat them as street-level is an owner-level judgement
   call, not yet raised.
9. **Carried from 22–23 Sep, unchanged** (23 Sep handoff §9 and
   `REPORT_PRESENTATION_PROGRAMME.md` §7):
   - the land-use register's five rows where the code says thirteen;
   - the owner's decisions on `market_sources` seeding, the Risk dimension's
     ceiling (four of five scored is the honest maximum) and Tasmania's
     projection terms;
   - a brand-colour test failing on `main` since 21 Sep, which CI does not run
     (noted on #2760).

---

## 7 · Where the environment lies to you

Carried from 23 Sep, plus today's:

- `npm run lint` and `tsc -p tsconfig.app.json` are **red on `main` before you
  touch anything** (pre-existing). Lint and type-check the files you change,
  and compare against a clean worktree.
- **Deno is not installed and `deno.land` is refused**, so
  `scripts/security/check-edge-functions.mjs` runs only in CI's `security`
  job. Every other `scripts/security/check-*.mjs` runs locally.
- **The Docker client is installed but no daemon runs.** As root, though, an
  `overlay` mount works. That is how the Photon lock-file failure was
  reproduced exactly (see `ADDRESS_SERVICE.md` §5). A real Photon 1.3.0 jar
  and a synthetic index were in that session's scratchpad, which you do not
  have. The jar's URL and sha256 are pinned in `address-service/Dockerfile`.
- **Egress refuses** `download1.graphhopper.com`, `fly.io`, `*.fly.dev` and
  `community.fly.io`. GitHub's runners reach all of them, so measure there.
- **The GitHub MCP's `get_job_logs` answers 404 for a job still running.**
  Read the step list with `actions_get` → `get_workflow_job`, and fetch the
  logs once it completes. A large `tail_lines` is saved to a file; parse it
  with Python rather than paging it.
- **A green CI run proves the code; a deploy run proves the deploy.** Read the
  deploy run's own per-function `Deployed Functions` lines, as §0 does.

---

## 8 · Corrections — do not re-make them

1. **A service that has exited is not a slow one.** The first image run died
   seven seconds in, and the health loop waited out five minutes before
   saying so. The loop now stops the moment the container is gone.
2. **Never ship an index's lock files in an image layer.** Opening a file
   from an image layer for writing gives it a new creation time. Lucene
   compares creation times and refuses (*"Underlying file changed by an
   external force"*).
3. **The builder's tallies count differently.** `site_rows`, `unit_rows`,
   `rows_by_state` and `by_geocode_type` include Other Territories (3,374
   rows), and `rows_written` does not. Do not add one to the other.
4. **Migration `20261220090000`'s comment says G-NAF is "loaded into this
   project".** It is not: the register is served by the Fly machine, never
   the database (`ADDRESS_SERVICE.md` §2). The migration has run, so its
   bytes stay as they are (`APPLIED_MIGRATION_BODIES.md`). This note is the
   correction.
5. **The rule this programme keeps paying for: read the effect, never the
   intent.** Today's version: the address service's CI "health" step was
   green in intent (the loop existed) and failed in effect, because the
   process it waited on had already exited.

---

## 9 · Next steps, in order

1. **Owner:** assess this handoff; confirm the merge of its pull request (docs
   only, deploys nothing).
2. **Owner:** regenerate **93 Schofields Farm Road** and **1408/5 Second Ave,
   Blacktown**. Optionally also 60 Lawley Street and 9 Hollow Street, to see
   G-NAF provenance on reports that were already placed correctly.
3. **You:** live-check with §4.2 and report plainly, per report:
   - who placed it, at what precision;
   - where planning was read, and what the page says about it;
   - the grade and QA.

   Anything that did not happen is **PENDING**, not assumed.
4. **You:** close out §6 items 2 and 5 from the same logs and the live site
   when you can. Offer item 6 (the digest housekeeping PR) to the owner.
5. The previous session had scheduled a check-in for 15:15 UTC. **It was
   cancelled** when this handoff was written, so two sessions do not act on
   the same regenerations.

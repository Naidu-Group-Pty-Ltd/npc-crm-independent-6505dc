# The render service, and what a 503 — or a 500 — from it means

**Read this before touching `weasyprintClient.ts`, `render-template-pdf`,
`render-cash-flow-pdf`, `routeReportThroughTemplate.ts`,
`renderFailure.pure.ts` or the WeasyPrint deploy workflow.**

## What happened on 15 September 2026

Every report generated for 291 Stone Mason Drive, Kellyville that morning
came out in the standard (pdf-lib) layout, with a toast reading *"Your chosen
template was not used for this document … The renderer could not produce the
document."* The 10 Year Cash Flow — which has no standard-layout fallback —
failed outright, and its toast printed 400 characters of an HTML page:

```
WeasyPrint render failed (503): <html><head>…<title>503 Server Error</title>
…The service you requested is not available yet. Please try again in 30
seconds.…
```

That page is Cloud Run's own front door, not WeasyPrint's. It is what Cloud
Run serves when a request reaches the service and **no instance is ready to
take it** — a container still starting, a revision whose container failed its
health check, or a service with no serving revision at all.

Three things were true at once and each was invisible from the product:

1. **The failure was the same on every format.** Every template route and the
   cash-flow route call the same service; nothing in the product said so.
   The template path swallowed the status into one generic sentence, and the
   cash-flow path printed the raw body.
2. **The service has never been deployed by its workflow.**
   `deploy-weasyprint-service.yml` has run three times and every run skipped
   build, stage, verify and promote, because its gate requires three
   repository variables (`GCP_PROJECT_ID`, `GCP_WORKLOAD_IDENTITY_PROVIDER`,
   `GCP_DEPLOY_SERVICE_ACCOUNT`) that have never been set. Whatever revision
   is serving was deployed by hand. `CONTAINER_RELEASE.md` records the manual
   path.
3. **The service scales to zero** (`--min-instances 0`) and declares **no
   startup probe**, so the first request after idle is a cold start, and a
   revision whose container cannot boot answers every request 503 rather
   than being refused promotion.

The metered ledger shows the last successful WeasyPrint calls on
8 September 2026 (128 calls, all successful). Nothing in the repository
records what changed between then and the 15th.

## What the code does now

`_shared/renderFailure.pure.ts` classifies a service answer once, and both
render functions and both browser clients read it:

| Upstream | `code` | HTTP from the function | Retried |
| --- | --- | --- | --- |
| 502, 503, 504, network failure | `engine_unavailable` | 503 | once, after 5 s |
| **Any 5xx that is the host's own page** (HTML, `NNN Server Error`, no `X-WeasyPrint-Version`) | `engine_unavailable` | 503 | once, after 5 s |
| 4xx / a 5xx the engine itself answered (JSON, under its version header) | `render_failed` | 502 | no |
| Storage or signing after the render | `store_failed` | 502 | no |

The second row is the afternoon of the same day (next section). `classifyServiceAnswer`
reads the SHAPE of the answer, not the digit: the engine's own answers are JSON
and carry `X-WeasyPrint-Version`; Cloud Run's page is HTML with neither.

- `weasyprintClient.ts` retries an unavailable answer once and throws a
  `WeasyPrintServiceError` carrying the kind, the upstream status and a
  one-line summary of the body (the `<title>` and headings of an HTML page,
  never the page itself).
- `render-template-pdf` and `render-cash-flow-pdf` answer
  `{ error, code, upstreamStatus, retriable }` with the classified status.
- `routeReportThroughTemplate.ts` records `engine_unavailable` as its own
  refusal, and `templateDocument.ts` relays the engine's status and words in
  the fallback notice: *"The print engine did not answer. HTTP 503 from the
  render service: 503 Server Error — The service you requested is not
  available yet."*
- `requestCashFlowPdf.ts` throws the operator's sentence rather than the
  service's body.

None of that makes the service answer. It makes the product say what
happened.

## The second episode: the 500 (15 Sep 2026, from 00:46 UTC)

The service came back for nobody. Measured from the production ledger
(`template_render_jobs`, `api_usage_log`) on the 15th:

| When (UTC) | Call | Answer | Time to answer |
| --- | --- | --- | --- |
| 8 Sep 08:42 | last successful render (Private Banking — Chancery) | 200, 307 KB | 3.9 s |
| 15 Sep 00:46 → 01:31 | six template renders, one cash-flow render | Cloud Run **500** page ×6, **503** page ×2 | 130–330 ms each |
| 15 Sep 06:03 | template render after the fix of the morning deployed | Cloud Run **500** page, now reported as `engine_failed` | 284 ms |

Two things distinguish this from the morning's 503:

- **The answer is the host's, not the engine's.** The body is Cloud Run's own
  page (`<title>500 Server Error</title>`, "The server encountered an error
  and could not complete your request. Please try again in 30 seconds.",
  `Server: Google Frontend`) with no `X-WeasyPrint-Version`. The engine's
  own errors are JSON. A page from the host means **no container instance
  took the request**.
- **It answers in under 350 ms, to anything.** A cold start that fails takes
  seconds; a render that crashes takes at least the parse. To rule out the
  document, the service's root was asked from the one vantage point this
  repository's tooling has into its network — the production database, via
  `pg_net`, at 06:25 UTC:

  ```sql
  select net.http_get(url := 'https://<service>.a.run.app/', timeout_milliseconds := 20000);
  select status_code, left(content, 200), headers->>'server' from net._http_response where id = <id>;
  ```

  `GET /` — which `app.py` answers with a JSON listing, no token and no
  engine — came back **500, the same page, `Server: Google Frontend`**.
  (`GET /healthz` came back Google's generic 404, which is the frontend's
  own reserved-path answer rather than the container's; it says nothing
  either way.) So the document is not at fault, the token is not at fault
  (a bad token is a JSON 401 from the app), and it is not a cold start still
  warming (five hours).

  That probe wrote two transient rows to `net._http_response` and nothing
  else. It is the only write this investigation made.

What was NOT measurable from here — and therefore what the operator must
read first — is **why** the revision cannot serve. Cloud Run answers this
page for a handful of instance-level faults, and the revision's own logs
name which:

| Log line (`resource.type="cloud_run_revision"`, severity ≥ ERROR) | Meaning | Remedy |
| --- | --- | --- |
| *The request failed because the instance could not be started* | The container did not come up: an image that can no longer be pulled, a runtime service account that was deleted or disabled, or a crash at boot (the warm-up render runs under `--preload` before gunicorn listens; a fontconfig or WeasyPrint import failure lands here) | Roll back to the previous ready revision, or redeploy the image as a new revision (below) |
| *Memory limit of 2048 MiB exceeded* | An instance was killed at boot or on the first request | Redeploy with `--memory 4Gi`; then find what grew |
| *The request failed because either the HTTP response was malformed or connection to the instance had an error* | A worker crashed mid-request (a segfault in the render stack) | Redeploy; if it recurs on one document, that document |
| No error lines at all, and no request lines either | The requests never reached the service's revision — traffic is routed to a revision that no longer exists, or the service itself is in a failed state | `gcloud run services describe` (step 1 below); redeploy |

Nothing in this repository changed the container between the 8th and the
15th (`weasyprint-service/` last changed on the 11th and has never been
deployed by its workflow), so this is the platform's state, not this code.

## Runbook: the render service answers 503 or 500

Run from a machine with `gcloud` authenticated to the production project.

```bash
REGION=australia-southeast1
SERVICE=weasyprint-service

# 0. Is the front door answering for the container, or for itself?
#    `/` needs no token and no engine: a JSON listing means the app is up; an
#    HTML "Server Error" page in under half a second means no instance took it.
URL=$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')
curl -sS -o /dev/null -w '%{http_code} %{time_total}s\n' "$URL/"

# 1. Is there a serving revision, and is it ready?
gcloud run services describe "$SERVICE" --region "$REGION" \
  --format='yaml(status.conditions,status.traffic,status.latestReadyRevisionName,status.latestCreatedRevisionName)'
gcloud run revisions list --service "$SERVICE" --region "$REGION"

# 2. Does the container boot? (unauthenticated on purpose — see app.py)
curl -sS -o /dev/null -w '%{http_code}\n' "$URL/healthz"

# 3. What did the last requests see, and why? (the table above reads these)
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'"$SERVICE"'" AND severity>=ERROR' \
  --limit 50 --freshness 3d --format='value(timestamp,textPayload)'
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'"$SERVICE"'" AND httpRequest.status>=500' \
  --limit 20 --format='value(timestamp,httpRequest.status,textPayload)'

# 4. Redeploy the image the service already runs, as a new revision. This
#    recreates instances and is the remedy for every row of the table above
#    except the memory one (add --memory 4Gi there). The image digest is on
#    the serving revision:
IMAGE=$(gcloud run revisions describe "$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.latestReadyRevisionName)')" \
  --region "$REGION" --format='value(spec.containers[0].image)')
gcloud run deploy "$SERVICE" --image "$IMAGE" --region "$REGION" --platform managed \
  --allow-unauthenticated --memory 2Gi --cpu 2 --concurrency 4 --timeout 600 \
  --min-instances 0 --max-instances 10
#    (CONTAINER_RELEASE.md carries the same command with --no-traffic and a
#    tag, for staging a NEW image; for the same image, cutting over is the point.)
```

Read the answers in this order:

- **No ready revision / `latestReadyRevisionName` behind `latestCreated`** —
  the last deploy's container did not become healthy. Roll traffic back to
  the previous ready revision (`gcloud run services update-traffic
  "$SERVICE" --to-revisions <prev>=100`), then fix the image.
- **`/healthz` answers 503 for more than a minute** — the container is
  crash-looping; the revision's logs (step 3) say why. A missing font
  package, a WeasyPrint import error or an engine pin the image lacks all
  present this way.
- **`/healthz` answers 200 and the product still fails** — the product's
  token or URL is wrong: `WEASYPRINT_SERVICE_URL` / `WEASYPRINT_SERVICE_TOKEN`
  in the Supabase project's secrets must match the service and its
  `RENDER_TOKEN`. A 401/403 from the engine is `render_failed`, not
  `engine_unavailable`; a 503 is never an auth problem.
- **Only the first request after idle fails** — a cold start. The one retry
  in `weasyprintClient.ts` covers a boot that finishes within five seconds;
  a slower boot needs the change below.
- **`GET /` answers the host's page in under half a second, for hours** —
  the 15 Sep afternoon. No instance is taking requests; the revision's own
  logs (step 3) say why, and step 4 is the remedy for all but the memory
  case.

## Leave Cloud Run: the same container on Fly.io

On 15 Sep 2026 the owner declined to deploy on Cloud Run again — the last
change there had cost over $1,200 — and asked for another way to full
functionality. There is one, and it was always true: the container has
never depended on Cloud Run. `weasyprint-service/README.md` has said from
the start that any host that runs the Dockerfile works, and the edge
functions locate the engine by exactly two secrets, `WEASYPRINT_SERVICE_URL`
and `WEASYPRINT_SERVICE_TOKEN`. The same image on another host gives
identical documents: same engine, same fonts, same PDF/UA output.

`.github/workflows/deploy-render-fly.yml` is that move, made runnable with
no terminal. It builds the Dockerfile on Fly's remote builder, runs **one**
machine in Sydney (`weasyprint-service/fly.toml`: `performance-1x`, one
dedicated CPU, 2 GB,
stopped when idle and started by the first request), proves it — the front
door, the pinned engine version, the capability reconciliation, a real
report rendered whole and tagged — and only then writes the two secrets into
the Supabase project, so every render route uses it from its next cold
start. The bearer token is minted on the runner, masked, written to both
sides in the same run and never printed.

**The build context is the service directory.** The first dispatch (run 1,
15 Sep 2026 09:52 UTC) failed in thirty seconds at the build, before a
machine existed and before anything was repointed: `flyctl deploy` uploads
the directory it runs in, and run from the repository root it shipped the
whole repository — 541 MB across 8,342 files, `supabase/` and `.git/`
included — so the Dockerfile's relative `COPY fonts/`, `COPY
requirements.txt` and `COPY app.py selfcheck.py` found nothing. `ci.yml`
builds `./weasyprint-service` and Cloud Build submits that directory; the
step now runs there too (`working-directory: weasyprint-service`), and
`renderServiceFlyWorkflow.spec.ts` pins it.

What the owner does, once, with clicks:

1. Create a Fly.io account and add a payment method.
2. Fly dashboard → **Account → Access Tokens → Create** (an org-scoped
   deploy token is enough). Copy it.
3. GitHub → **Settings → Secrets and variables → Actions → New repository
   secret** `FLY_API_TOKEN`, paste. (`SUPABASE_ACCESS_TOKEN` is already
   present — the functions deploy uses it.)

Then **Actions → Deploy the render container to Fly.io → Run workflow**,
by a person or by an agent with repository access. The job summary names the
URL; the proof by effect is a report generated with a chosen template
(the browser-stand-in toast must not appear) and a `weasyprint/render` row
in `api_usage_log` whose host is the Fly URL.

**What it can cost, and why it cannot run away.** One machine: the ceiling
is that machine's hourly price for a whole month — of the order of ten to
fifteen dollars at Fly's published shared-CPU rates, check the current page
— and near zero while stopped. There is no autoscaling to multiply it.
For comparison, the two Cloud Run services' recorded work is small: the
render ledger holds 128 calls on 8 Sep and 8 failed ones on the 15th, and
`pdf_import_jobs` holds 0.3 hours of sidecar time across 70 days — whatever
cost $1,200 there was not this traffic, which is one more reason to prefer
a host whose bill is a machine rather than a meter.

Afterwards the Cloud Run service is unused and can be deleted from its
console; nothing in the product names it.

## Choosing the machine plan (commercial use)

Prices below are Fly.io's published shared-CPU and performance rates as last
read; the page at <https://fly.io/docs/about/pricing/> is the authority and
should be re-read before deciding. What does not change with the page is
the shape of the decision.

**What a render costs the machine.** One render is one CPU-bound WeasyPrint
run: a 53-page Investment Compass took 6–14 s on Cloud Run's 2 vCPU and
peaked well under 2 GB; a Cash Flow document took 4–9 s. The container runs
two gunicorn workers, so two renders proceed at once and a third queues
behind them. Memory, not CPU, is what fails a render (an image-heavy report
that exceeds the limit is killed); CPU only makes it slower.

**Three configurations, and what each buys.**

| | Leanest | Recommended for a sales team | Highest output |
| --- | --- | --- | --- |
| Machine | `shared-cpu-2x`, 2 GB | `shared-cpu-2x`, 2 GB | `performance-1x`, 2 GB (dedicated CPU) |
| Machines | 1 | 2 (`machines: 2`) | 2 |
| Always warm | none (`min_machines_running = 0`) | one (`min_machines_running = 1`) | one |
| First render after a quiet spell | ~10 s boot, then normal | immediate | immediate |
| Concurrent renders before queuing | 2 | 4 (the second machine starts itself) | 4, each ~1.5–2× faster |
| Monthly ceiling (every machine running all month) | ≈ $11 | ≈ $23 | ≈ $31 + $11 |
| Typical month (renders are seconds; idle machines stop) | ≈ $1–4 | ≈ $12–14 | ≈ $32–35 |

The ceiling is real: Fly bills per machine-second while a machine runs, a
stopped machine costs only its rootfs (cents), and there is no autoscaling
beyond the count set here — so the worst month is the count times the
machine's monthly price. Outbound data is a few cents (a report is ~300 KB;
Sydney egress is priced per GB). A shared IPv4 and TLS certificates are
included; a dedicated IPv4 is not needed. The remote builder runs only while
building and stops.

**Why the middle column.** A sales conversation waits on the document, so
the cold boot is the cost that matters: one always-warm machine removes it
for about eleven dollars a month, and a second, stopped machine absorbs two
advisers rendering at once for nothing until it is needed. Dedicated CPU
(`performance-1x`) is worth its price only once the ledger shows renders
routinely over ~15 s or more than two in flight at once — read
`api_usage_log.response_time_ms` for `weasyprint/render` before paying for
it, not after.

**Decided 15 September 2026.** The owner set the machine at the
right-hand column's — `performance-1x`, 2 GB, a dedicated CPU — and
`fly.toml` ships it. The count and the warm machine were not chosen with
it: the workflow still deploys one machine, stopped when idle
(`min_machines_running = 0`), and `machines: 2` at dispatch and
`min_machines_running = 1` in `fly.toml` remain the way to add them. At
that size the ceiling is one machine's monthly price (≈ $31 at the rates
above) and a typical month is a few dollars, because a stopped machine
costs only its rootfs.

**Which Fly.io plan.** *Pay As You Go* (no monthly fee, community support)
is the right one to start on: everything above is usage, and the support
plans (*Launch*, *Scale*) sell response-time commitments rather than
capacity. Move to *Launch* only when a client-facing commitment needs email
support with a response target; whether its fee is credited against usage
is stated on the plans page and should be checked at the time.

**Guardrails.** Set `machines` to the ceiling you accept and leave it; buy
prepaid credit if a fixed monthly outlay is preferred to a card on file;
review the Fly usage page and the ledger monthly. Two limits to know:
Fly's proxy closes an HTTP response idle for 60 s (a render is seconds, so
this is far away, and the client's own 600 s budget is unchanged), and a
machine at its memory limit is killed rather than slowed — if the revision
logs ever say so, `memory = "4096mb"` in `fly.toml` is the fix, at roughly
double the machine price.

## Redeploy without a terminal

Two routes need neither gcloud nor Cloud Shell.

**In the console, now (two clicks).** Open <https://console.cloud.google.com/run>,
sign in to the account that owns the project, open `weasyprint-service`,
click **Edit & deploy new revision**, change nothing, click **Deploy**. That
is `gcloud run deploy` with the image and environment the service already
has: a new revision, instances recreated, traffic sent to it. The **Logs**
tab on the same page shows the error lines the table above reads. Then the
proof by effect: `GET /` on the service URL answers a JSON listing.

**From the deploy workflow, every time after (one secret, once).** Create a
service-account key in the console and paste it into the repository secret
`GCP_SA_KEY` — the steps are in `CONTAINER_RELEASE.md` under *Without a
terminal*. From then on `Deploy the render container → Run workflow` with
`mode: redeploy` does the redeploy, shows the front door before, the error
lines, and the front door after, and fails loudly if the service still does
not serve — and it can be dispatched by an agent with repository access.

## Redeploy from Cloud Shell — no local tooling

Nothing in this repository can reach Cloud Run: the deploy workflows all
authenticate by Workload Identity Federation through three repository
variables that have never been set, and a session of this product's tooling
holds no Google credential. So the redeploy is a person's act, and the
shortest path is the browser: open <https://console.cloud.google.com>, sign
in to the account that owns the project, click **Activate Cloud Shell** (the
terminal icon, top right), and paste the block below. It is
`scripts/render-service/redeploy.sh` verbatim — `renderServiceRedeployScript.spec.ts`
fails if the two ever differ — and it asks before it deploys.

```bash
cat > redeploy.sh <<'REDEPLOY'
#!/usr/bin/env bash
# Redeploy the render container (weasyprint-service) on Cloud Run — from Cloud
# Shell, with nothing installed locally.
#
# What it does, in order: finds the project that holds the service, shows what
# the front door answers RIGHT NOW (an HTML "Server Error" page in under half a
# second means no instance is taking requests — 15 Sep 2026), lists the
# revisions and the service's conditions, prints the last error lines from the
# revision logs (docs/reports/RENDER_SERVICE_AVAILABILITY.md maps each line to
# its remedy), then — after asking — deploys the image the service already runs
# as a NEW revision and sends it traffic, and finally asks the front door again.
#
# `gcloud run deploy` keeps the service's existing environment variables
# (WEASYPRINT_SERVICE_TOKEN among them) when none are named, so the token the
# edge functions hold stays valid. Nothing here touches Supabase.
#
# Usage (Cloud Shell): bash redeploy.sh
#   CONFIRM=1 bash redeploy.sh        # no question
#   MEMORY=4Gi bash redeploy.sh       # when the logs say "Memory limit ... exceeded"
#   PROJECT_ID=... bash redeploy.sh   # when more than one project you can see holds the service
set -euo pipefail

SERVICE="${SERVICE:-weasyprint-service}"
REGION="${REGION:-australia-southeast1}"
MEMORY="${MEMORY:-2Gi}"
say() { printf '\n== %s\n' "$*"; }

# 0. Which project holds the service? The configured one if it does, else search.
PROJECT="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
if [ -z "$PROJECT" ] || ! gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format='value(metadata.name)' >/dev/null 2>&1; then
  say "Looking for a project that holds $SERVICE in $REGION"
  PROJECT=""
  for p in $(gcloud projects list --format='value(projectId)'); do
    if gcloud run services describe "$SERVICE" --project "$p" --region "$REGION" --format='value(metadata.name)' >/dev/null 2>&1; then
      PROJECT="$p"; break
    fi
  done
  if [ -z "$PROJECT" ]; then
    echo "No project you can see holds $SERVICE in $REGION. Re-run with PROJECT_ID=<project>." >&2
    exit 1
  fi
fi
say "Project: $PROJECT"

URL=$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format='value(status.url)')
say "Service URL: $URL"
echo "(WEASYPRINT_SERVICE_URL in the Supabase project's secrets must equal this.)"

say "Front door, before — GET / needs no token and no engine"
echo "JSON means the app is up; an HTML 'Server Error' page means no instance took the request."
curl -sS -o /tmp/render-root-before.txt -w 'HTTP %{http_code} in %{time_total}s\n' "$URL/" || true
head -c 300 /tmp/render-root-before.txt; echo

say "Revisions"
gcloud run revisions list --service "$SERVICE" --project "$PROJECT" --region "$REGION" \
  --format='table(metadata.name,status.conditions[0].status:label=READY,spec.containers[0].image,metadata.creationTimestamp)'

say "Service conditions and traffic"
gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" \
  --format='yaml(status.conditions,status.traffic,status.latestReadyRevisionName,status.latestCreatedRevisionName)'

say "Last error lines from the revision logs — the runbook's table says what each means"
gcloud logging read "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"$SERVICE\" AND severity>=ERROR" \
  --project "$PROJECT" --limit 30 --freshness 3d --format='value(timestamp,textPayload)' || true

READY_REV=$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format='value(status.latestReadyRevisionName)')
if [ -z "$READY_REV" ]; then
  READY_REV=$(gcloud run revisions list --service "$SERVICE" --project "$PROJECT" --region "$REGION" --format='value(metadata.name)' --limit 1)
fi
IMAGE=$(gcloud run revisions describe "$READY_REV" --project "$PROJECT" --region "$REGION" --format='value(spec.containers[0].image)')
say "Image on $READY_REV: $IMAGE"

if [ "${CONFIRM:-}" != "1" ]; then
  read -r -p "Deploy this image as a new revision (memory $MEMORY) and send it traffic? [y/N] " answer
  case "$answer" in
    y|Y|yes|YES) ;;
    *) echo "Not deploying. Re-run with CONFIRM=1 to skip the question."; exit 0 ;;
  esac
fi

say "Deploying"
gcloud run deploy "$SERVICE" --project "$PROJECT" --image "$IMAGE" --region "$REGION" --platform managed \
  --allow-unauthenticated --memory "$MEMORY" --cpu 2 --concurrency 4 --timeout 600 \
  --min-instances 0 --max-instances 10

say "Front door, after"
code=000
for i in 1 2 3 4 5 6; do
  code=$(curl -sS -o /tmp/render-root-after.txt -w '%{http_code}' "$URL/" || echo 000)
  if [ "$code" = "200" ]; then break; fi
  echo "GET / answered $code; waiting 10s ($i/6)"; sleep 10
done
echo "GET /        -> HTTP $code"; head -c 300 /tmp/render-root-after.txt; echo
echo "GET /healthz -> HTTP $(curl -sS -o /dev/null -w '%{http_code}' "$URL/healthz" || echo 000)"
if [ "$code" = "200" ]; then
  echo
  echo "The service answers. Now generate one report with a chosen template:"
  echo "the toast 'Your chosen template was drawn in the browser' must NOT appear, and"
  echo "api_usage_log must show a weasyprint/render row with status = 'success'."
else
  echo
  echo "Still not serving. Read the log lines above; the runbook's table maps each to its remedy"
  echo "(for 'Memory limit ... exceeded', re-run with MEMORY=4Gi)."
  exit 1
fi
REDEPLOY
bash redeploy.sh
```

Read its output in this order: the **front door before** (the HTML page is
the fault being fixed), the **error lines** (the table above says what each
one means — `MEMORY=4Gi bash redeploy.sh` for the memory one), then the
**front door after**: a JSON listing from `GET /` and `200` from `/healthz`
mean the service is serving again, and the toast *"Your chosen template was
drawn in the browser"* stops appearing on the next report.

## What the product does while the engine is down

None of the above makes the service answer, and on the 15th nobody with
`gcloud` was at hand, so the product now degrades in a way that still
delivers the chosen template:

- **The host's page is classified as the engine not answering**
  (`classifyServiceAnswer`), under a 500 as under a 503: retried once,
  answered 503 by the function, and reported as "The print engine did not
  answer (HTTP 500 from the render service) … check the Cloud Run service".
- **The chosen template is drawn by the in-tab renderer** when the engine
  did not draw it (`browserStandInFor` in `routeReportThroughTemplate.ts`).
  That renderer drew every template for a year before the print engine
  became the final renderer; it draws the same schema with the same bound
  data, and it is refused only where a block would render as a placeholder
  (`judgeBrowserProductionExport`). The document is delivered marked
  (`degradedFrom`, `renderer: browser_template_jspdf`), the person is told
  in its own words ("Your chosen template was drawn in the browser …
  typefaces are substituted and it is not the final PDF/UA document"), and
  the delivery never remembers it as the finalisation — the next request
  asks the engine again. A refusal (credentials, a 409 from the
  client-readiness gate) is never stood in for: the browser would ship the
  same document the engine declined.
- The standard pdf-lib layout remains the fallback where no template can be
  drawn at all, exactly as before.

`routeBrowserStandIn.spec.ts` pins what may stand in and what may not.

## Two changes that need a decision

Neither is made on this branch, because both change what production runs.

1. **Set the three repository variables and let the workflow deploy.** Until
   then every revision is hand-built and nothing verifies a revision before
   traffic reaches it. The workflow already stages with `--no-traffic` and
   verifies on a tagged URL; it only needs credentials.
2. **Give the service a startup probe and, if cold starts are the cause, a
   floor of one instance.** `--startup-probe httpGet.path=/healthz` makes
   Cloud Run refuse to route to a container that has not booted, so a broken
   image fails the deploy instead of every report. `--min-instances 1` costs
   money continuously and removes the cold start; it is a spend decision.

## Verifying after the fix

The purge rule applies here too: **assert by effect, never by
configuration.** A green deploy is not a rendered report. After any change:

1. `curl "$URL/healthz"` answers 200.
2. Generate one report with a chosen template and confirm the toast does
   NOT appear and the download is the templated document (its Producer is
   the WeasyPrint engine, not "NPC Command Centre").
3. Generate one 10 Year Cash Flow and confirm a PDF downloads.
4. `api_usage_log` shows the `weasyprint/render` rows with `status = 'success'`
   and `response_time_ms` in the seconds, not the hundreds of milliseconds.
5. The toast *"Your chosen template was drawn in the browser"* stops
   appearing: the stand-in is the sign the engine is still down.

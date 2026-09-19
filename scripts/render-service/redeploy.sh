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

#!/usr/bin/env bash
# Safe Cloud Run release helper for npc-property-dashbord/pdf-parse-service.
#
# Typical use:
#   cp pdf_sidecar_deploy.env.example .pdf-sidecar.env
#   ${EDITOR:-nano} .pdf-sidecar.env
#   bash deploy_pdf_sidecar.sh release
#   bash deploy_pdf_sidecar.sh promote 5
#   bash deploy_pdf_sidecar.sh promote 100
#   bash deploy_pdf_sidecar.sh rollback
#
# The release command performs inventory -> build -> no-traffic canary -> smoke
# tests. It never sends production traffic to the new revision automatically.

set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${PDF_SIDECAR_CONFIG:-$SCRIPT_DIR/.pdf-sidecar.env}"
if [[ -f "$CONFIG_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$CONFIG_FILE"
fi

PROJECT_ID="${PROJECT_ID:-${GCP_PROJECT:-}}"
SERVICE="${SERVICE:-pdf-parse-service}"
REGION="${REGION:-}"
REPO_ROOT="${REPO_ROOT:-$(pwd)}"
SIDECAR_DIR="${SIDECAR_DIR:-pdf-parse-service}"
STATE_ROOT="${STATE_ROOT:-$HOME/.pdf-sidecar-releases}"
IMAGE_REPO="${IMAGE_REPO:-}"
CANARY_TAG="${CANARY_TAG:-}"
TOKEN_SECRET_NAME="${TOKEN_SECRET_NAME:-}"
SMOKE_PDF_URL="${SMOKE_PDF_URL:-}"
SMOKE_MODE="${SMOKE_MODE:-hybrid}"
RUN_PARSE_SMOKE="${RUN_PARSE_SMOKE:-0}"
SIDECAR_TEST_CMD="${SIDECAR_TEST_CMD:-}"
ALLOW_DIRTY="${ALLOW_DIRTY:-0}"
DRY_RUN="${DRY_RUN:-0}"

RELEASE_DIR="${RELEASE_DIR:-}"
RELEASE_ID="${RELEASE_ID:-}"
STATE_FILE="${STATE_FILE:-}"
CURRENT_IMAGE="${CURRENT_IMAGE:-}"
IMAGE="${IMAGE:-}"
IMAGE_DIGEST="${IMAGE_DIGEST:-}"
SERVICE_URL="${SERVICE_URL:-}"
CANARY_URL="${CANARY_URL:-}"
AUTH_HEADER_FILE="${AUTH_HEADER_FILE:-}"
CANARY_REVISION="${CANARY_REVISION:-}"
PREVIOUS_REVISION="${PREVIOUS_REVISION:-}"
ORIGINAL_TRAFFIC="${ORIGINAL_TRAFFIC:-}"
ORIGINAL_TRAFFIC_COUNT="${ORIGINAL_TRAFFIC_COUNT:-0}"

COLOR_RESET='\033[0m'
COLOR_BLUE='\033[1;34m'
COLOR_GREEN='\033[1;32m'
COLOR_YELLOW='\033[1;33m'
COLOR_RED='\033[1;31m'

log()  { printf '%b[%s]%b %s\n' "$COLOR_BLUE" "sidecar" "$COLOR_RESET" "$*"; }
ok()   { printf '%b[ok]%b %s\n' "$COLOR_GREEN" "$COLOR_RESET" "$*"; }
warn() { printf '%b[warn]%b %s\n' "$COLOR_YELLOW" "$COLOR_RESET" "$*" >&2; }
die()  { printf '%b[error]%b %s\n' "$COLOR_RED" "$COLOR_RESET" "$*" >&2; exit 1; }

need() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

run_mutation() {
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '[dry-run]'
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi
  "$@"
}

shell_quote() {
  printf '%q' "$1"
}

write_state() {
  [[ -n "$RELEASE_DIR" ]] || return 0
  STATE_FILE="$RELEASE_DIR/state.env"
  umask 077
  {
    printf 'PROJECT_ID=%s\n' "$(shell_quote "$PROJECT_ID")"
    printf 'SERVICE=%s\n' "$(shell_quote "$SERVICE")"
    printf 'REGION=%s\n' "$(shell_quote "$REGION")"
    printf 'REPO_ROOT=%s\n' "$(shell_quote "$REPO_ROOT")"
    printf 'SIDECAR_DIR=%s\n' "$(shell_quote "$SIDECAR_DIR")"
    printf 'RELEASE_ID=%s\n' "$(shell_quote "$RELEASE_ID")"
    printf 'RELEASE_DIR=%s\n' "$(shell_quote "$RELEASE_DIR")"
    printf 'STATE_FILE=%s\n' "$(shell_quote "$STATE_FILE")"
    printf 'CURRENT_IMAGE=%s\n' "$(shell_quote "$CURRENT_IMAGE")"
    printf 'IMAGE=%s\n' "$(shell_quote "$IMAGE")"
    printf 'IMAGE_DIGEST=%s\n' "$(shell_quote "$IMAGE_DIGEST")"
    printf 'IMAGE_REPO=%s\n' "$(shell_quote "$IMAGE_REPO")"
    printf 'SERVICE_URL=%s\n' "$(shell_quote "$SERVICE_URL")"
    printf 'CANARY_TAG=%s\n' "$(shell_quote "$CANARY_TAG")"
    printf 'CANARY_URL=%s\n' "$(shell_quote "$CANARY_URL")"
    printf 'CANARY_REVISION=%s\n' "$(shell_quote "$CANARY_REVISION")"
    printf 'PREVIOUS_REVISION=%s\n' "$(shell_quote "$PREVIOUS_REVISION")"
    printf 'ORIGINAL_TRAFFIC=%s\n' "$(shell_quote "$ORIGINAL_TRAFFIC")"
    printf 'ORIGINAL_TRAFFIC_COUNT=%s\n' "$(shell_quote "$ORIGINAL_TRAFFIC_COUNT")"
    printf 'TOKEN_SECRET_NAME=%s\n' "$(shell_quote "$TOKEN_SECRET_NAME")"
    printf 'SMOKE_PDF_URL=%s\n' "$(shell_quote "$SMOKE_PDF_URL")"
    printf 'SMOKE_MODE=%s\n' "$(shell_quote "$SMOKE_MODE")"
  } > "$STATE_FILE"
  chmod 600 "$STATE_FILE"
  mkdir -p "$STATE_ROOT"
  ln -sfn "$RELEASE_DIR" "$STATE_ROOT/latest"
}

load_latest_state() {
  local requested="${RELEASE_DIR:-}"
  if [[ -z "$requested" ]]; then
    if [[ -L "$STATE_ROOT/latest" || -d "$STATE_ROOT/latest" ]]; then
      requested="$(cd "$STATE_ROOT/latest" && pwd)"
    else
      die "No prior release state found under $STATE_ROOT. Run 'release' or 'inventory' first."
    fi
  fi
  local file="$requested/state.env"
  [[ -f "$file" ]] || die "State file not found: $file"
  # shellcheck disable=SC1090
  source "$file"
  STATE_FILE="$file"
}

ensure_tools() {
  need gcloud
  need jq
  need curl
  need git
  need python3
  need diff

  local account
  account="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' | head -n1)"
  [[ -n "$account" ]] || die "No active gcloud account. Run: gcloud auth login"

  if [[ -z "$PROJECT_ID" ]]; then
    PROJECT_ID="$(gcloud config get-value project 2>/dev/null || true)"
  fi
  [[ -n "$PROJECT_ID" && "$PROJECT_ID" != "(unset)" ]] \
    || die "PROJECT_ID is unset. Put it in .pdf-sidecar.env or run gcloud config set project PROJECT_ID."

  if [[ -z "$REGION" ]]; then
    REGION="$(gcloud run services list \
      --project "$PROJECT_ID" \
      --platform managed \
      --filter="metadata.name=$SERVICE" \
      --format='value(region)' 2>/dev/null | head -n1 || true)"
  fi
  if [[ -z "$REGION" ]]; then
    REGION="$(gcloud run services list \
      --project "$PROJECT_ID" \
      --platform managed \
      --filter="metadata.name=$SERVICE" \
      --format='value(location)' 2>/dev/null | head -n1 || true)"
  fi
  [[ -n "$REGION" ]] \
    || die "Could not discover the Cloud Run region for $SERVICE. Set REGION in .pdf-sidecar.env."

  gcloud run services describe "$SERVICE" \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --platform managed \
    --format='value(metadata.name)' >/dev/null
}

service_json() {
  local output="$1"
  gcloud run services describe "$SERVICE" \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --platform managed \
    --format=json > "$output"
  chmod 600 "$output"
}

redact_service_config() {
  local input="$1"
  local output="$2"
  jq '
    def important_annotations:
      with_entries(select(
        .key == "autoscaling.knative.dev/minScale" or
        .key == "autoscaling.knative.dev/maxScale" or
        .key == "run.googleapis.com/vpc-access-connector" or
        .key == "run.googleapis.com/vpc-access-egress" or
        .key == "run.googleapis.com/cloudsql-instances" or
        .key == "run.googleapis.com/cpu-throttling" or
        .key == "run.googleapis.com/startup-cpu-boost" or
        .key == "run.googleapis.com/execution-environment" or
        .key == "run.googleapis.com/ingress"
      ));
    {
      service: .metadata.name,
      serviceAccount: .spec.template.spec.serviceAccountName,
      timeoutSeconds: .spec.template.spec.timeoutSeconds,
      containerConcurrency: .spec.template.spec.containerConcurrency,
      resources: .spec.template.spec.containers[0].resources,
      ports: .spec.template.spec.containers[0].ports,
      env: ([.spec.template.spec.containers[0].env[]? | {
        name: .name,
        source: (if .valueFrom then "secret" else "literal-redacted" end),
        secretName: (.valueFrom.secretKeyRef.name // null),
        secretKey: (.valueFrom.secretKeyRef.key // null)
      }] | sort_by(.name)),
      templateAnnotations: ((.spec.template.metadata.annotations // {}) | important_annotations),
      serviceAnnotations: ((.metadata.annotations // {}) | important_annotations)
    }
  ' "$input" > "$output"
  chmod 600 "$output"
}

derive_image_repo() {
  local ref="$1"
  ref="${ref%@*}"
  local last="${ref##*/}"
  if [[ "$last" == *:* ]]; then
    ref="${ref%:*}"
  fi
  printf '%s' "$ref"
}

inventory() {
  ensure_tools

  RELEASE_ID="${RELEASE_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
  RELEASE_DIR="${RELEASE_DIR:-$STATE_ROOT/$RELEASE_ID}"
  mkdir -p "$RELEASE_DIR"
  chmod 700 "$RELEASE_DIR"

  local tmp
  tmp="$(mktemp)"
  trap 'rm -f "$tmp"; unset PDF_PARSE_SERVICE_TOKEN 2>/dev/null || true' EXIT
  service_json "$tmp"

  redact_service_config "$tmp" "$RELEASE_DIR/service-config-before.json"

  CURRENT_IMAGE="$(jq -r '.spec.template.spec.containers[0].image // empty' "$tmp")"
  SERVICE_URL="$(jq -r '.status.url // empty' "$tmp")"
  ORIGINAL_TRAFFIC="$(jq -r '[.status.traffic[]? | select((.percent // 0) > 0) | "\(.revisionName)=\(.percent)"] | join(",")' "$tmp")"
  ORIGINAL_TRAFFIC_COUNT="$(jq -r '[.status.traffic[]? | select((.percent // 0) > 0)] | length' "$tmp")"
  PREVIOUS_REVISION="$(jq -r '[.status.traffic[]? | select((.percent // 0) > 0) | .revisionName][0] // empty' "$tmp")"

  if [[ -z "$TOKEN_SECRET_NAME" ]]; then
    TOKEN_SECRET_NAME="$(jq -r '.spec.template.spec.containers[0].env[]? | select(.name == "PDF_PARSE_SERVICE_TOKEN") | .valueFrom.secretKeyRef.name // empty' "$tmp" | head -n1)"
  fi

  if [[ -z "$CANARY_TAG" ]]; then
    CANARY_TAG="path100-${RELEASE_ID,,}"
    CANARY_TAG="$(printf '%s' "$CANARY_TAG" | tr -cd 'a-z0-9-' | cut -c1-63)"
  fi

  [[ -n "$CURRENT_IMAGE" ]] || die "Could not read the current Cloud Run image."
  [[ -n "$SERVICE_URL" ]] || die "Could not read the Cloud Run service URL."
  [[ -n "$ORIGINAL_TRAFFIC" ]] || warn "The service has no positive traffic entry; rollback will require manual inspection."

  gcloud run revisions list \
    --project "$PROJECT_ID" \
    --service "$SERVICE" \
    --region "$REGION" \
    --platform managed \
    --sort-by='~metadata.creationTimestamp' \
    --format='table(metadata.name,status.conditions[0].status,spec.containers[0].image,metadata.creationTimestamp)' \
    > "$RELEASE_DIR/revisions-before.txt"

  curl -fsS "$SERVICE_URL/healthz" | jq . > "$RELEASE_DIR/health-before.json"

  write_state

  log "Project:           $PROJECT_ID"
  log "Region:            $REGION"
  log "Service:           $SERVICE"
  log "Current image:     $CURRENT_IMAGE"
  log "Serving revision:  ${PREVIOUS_REVISION:-unknown}"
  log "Original traffic:  ${ORIGINAL_TRAFFIC:-unknown}"
  log "Evidence/state:    $RELEASE_DIR"
  if [[ -n "$TOKEN_SECRET_NAME" ]]; then
    log "Token secret ref:  $TOKEN_SECRET_NAME (value not displayed)"
  else
    warn "PDF_PARSE_SERVICE_TOKEN is not bound through Secret Manager, or its secret name could not be discovered."
  fi
  ok "Inventory captured without printing secret values."
}

ensure_release_state() {
  if [[ -z "$RELEASE_DIR" || -z "$STATE_FILE" || ! -f "${STATE_FILE:-/nonexistent}" ]]; then
    load_latest_state
  fi
  ensure_tools
}

build_image() {
  ensure_release_state

  local root sidecar_path dirty commit tag
  root="$(cd "$REPO_ROOT" && git rev-parse --show-toplevel)"
  REPO_ROOT="$root"
  sidecar_path="$REPO_ROOT/$SIDECAR_DIR"
  [[ -f "$sidecar_path/Dockerfile" ]] || die "Dockerfile not found: $sidecar_path/Dockerfile"
  [[ -f "$sidecar_path/app.py" ]] || die "app.py not found: $sidecar_path/app.py"

  dirty="$(git -C "$REPO_ROOT" status --porcelain)"
  if [[ -n "$dirty" && "$ALLOW_DIRTY" != "1" ]]; then
    printf '%s\n' "$dirty" >&2
    die "The repository is dirty. Commit/stash changes or set ALLOW_DIRTY=1 deliberately."
  fi

  commit="$(git -C "$REPO_ROOT" rev-parse HEAD)"
  printf '%s\n' "$commit" > "$RELEASE_DIR/deploy-commit.txt"
  python3 -m py_compile "$sidecar_path/app.py"

  if [[ -n "$SIDECAR_TEST_CMD" ]]; then
    log "Running sidecar tests: $SIDECAR_TEST_CMD"
    (cd "$REPO_ROOT" && bash -lc "$SIDECAR_TEST_CMD")
  fi

  if [[ -z "$IMAGE_REPO" ]]; then
    IMAGE_REPO="$(derive_image_repo "$CURRENT_IMAGE")"
  fi
  [[ -n "$IMAGE_REPO" ]] || die "IMAGE_REPO is empty and could not be derived."

  tag="path100-${RELEASE_ID,,}-$(git -C "$REPO_ROOT" rev-parse --short=12 HEAD)"
  IMAGE="$IMAGE_REPO:$tag"

  log "Building immutable image: $IMAGE"
  run_mutation gcloud builds submit "$sidecar_path" \
    --project "$PROJECT_ID" \
    --tag "$IMAGE" \
    --quiet

  if [[ "$DRY_RUN" != "1" ]]; then
    if [[ "$IMAGE" == *-docker.pkg.dev/* ]]; then
      IMAGE_DIGEST="$(gcloud artifacts docker images describe "$IMAGE" \
        --project "$PROJECT_ID" \
        --format='value(image_summary.digest)' 2>/dev/null || true)"
    elif [[ "$IMAGE" == gcr.io/* || "$IMAGE" == *.gcr.io/* ]]; then
      IMAGE_DIGEST="$(gcloud container images describe "$IMAGE" \
        --project "$PROJECT_ID" \
        --format='value(image_summary.digest)' 2>/dev/null || true)"
    fi
  fi

  printf '%s\n' "$IMAGE" > "$RELEASE_DIR/new-image.txt"
  [[ -z "$IMAGE_DIGEST" ]] || printf '%s\n' "$IMAGE_DIGEST" > "$RELEASE_DIR/new-image-digest.txt"
  write_state
  ok "Image build completed."
}

deploy_canary() {
  ensure_release_state
  [[ -n "$IMAGE" ]] || die "No built IMAGE in state. Run: $0 build"

  log "Deploying tagged revision with 0% production traffic."
  run_mutation gcloud run deploy "$SERVICE" \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --platform managed \
    --image "$IMAGE" \
    --no-traffic \
    --tag "$CANARY_TAG" \
    --quiet

  if [[ "$DRY_RUN" == "1" ]]; then
    warn "Dry-run mode: canary URL and revision were not discovered."
    return 0
  fi

  local tmp
  tmp="$(mktemp)"
  trap 'rm -f "$tmp"; unset PDF_PARSE_SERVICE_TOKEN 2>/dev/null || true' EXIT
  service_json "$tmp"
  redact_service_config "$tmp" "$RELEASE_DIR/service-config-canary.json"

  CANARY_URL="$(jq -r --arg tag "$CANARY_TAG" '.status.traffic[]? | select(.tag == $tag) | .url' "$tmp" | head -n1)"
  CANARY_REVISION="$(jq -r --arg tag "$CANARY_TAG" '.status.traffic[]? | select(.tag == $tag) | .revisionName' "$tmp" | head -n1)"

  [[ -n "$CANARY_URL" && "$CANARY_URL" != "null" ]] || die "Canary URL not found after deployment."
  [[ -n "$CANARY_REVISION" && "$CANARY_REVISION" != "null" ]] || die "Canary revision not found after deployment."

  if ! diff -u "$RELEASE_DIR/service-config-before.json" "$RELEASE_DIR/service-config-canary.json" \
    > "$RELEASE_DIR/service-config-diff.txt"; then
    cat "$RELEASE_DIR/service-config-diff.txt" >&2
    die "Unexpected service configuration drift detected. Production traffic was not changed. Review before proceeding."
  fi

  write_state
  log "Canary revision: $CANARY_REVISION"
  log "Canary URL:      $CANARY_URL"
  ok "Canary deployed at 0% traffic; critical service configuration is unchanged."
}

load_sidecar_token() {
  if [[ -n "${PDF_PARSE_SERVICE_TOKEN:-}" ]]; then
    return 0
  fi
  if [[ -n "$TOKEN_SECRET_NAME" ]]; then
    PDF_PARSE_SERVICE_TOKEN="$(gcloud secrets versions access latest \
      --project "$PROJECT_ID" \
      --secret "$TOKEN_SECRET_NAME")"
    return 0
  fi
  return 1
}

clear_sidecar_credentials() {
  if [[ -n "${AUTH_HEADER_FILE:-}" ]]; then
    rm -f -- "$AUTH_HEADER_FILE"
    AUTH_HEADER_FILE=""
  fi
  unset PDF_PARSE_SERVICE_TOKEN 2>/dev/null || true
}

smoke_canary() {
  ensure_release_state
  [[ -n "$CANARY_URL" ]] || die "No CANARY_URL in state. Run: $0 canary"

  log "Checking canary health."
  curl -fsS "$CANARY_URL/healthz" | jq -e '.ok == true' \
    > "$RELEASE_DIR/health-canary.json"

  if load_sidecar_token; then
    AUTH_HEADER_FILE="$(mktemp)"
    chmod 600 "$AUTH_HEADER_FILE"
    printf 'Authorization: Bearer %s\n' "$PDF_PARSE_SERVICE_TOKEN" > "$AUTH_HEADER_FILE"
    trap clear_sidecar_credentials EXIT
    log "Checking authenticated capabilities endpoint."
    curl -fsS "$CANARY_URL/capabilities" \
      -H "@$AUTH_HEADER_FILE" \
      | jq -e '.engine_version != null' \
      > "$RELEASE_DIR/capabilities-canary.json"

    if [[ -n "$SMOKE_PDF_URL" ]]; then
      log "Checking Plan V2 contract against the approved smoke PDF."
      jq -n --arg url "$SMOKE_PDF_URL" --arg mode "$SMOKE_MODE" \
        '{url:$url, mode:$mode}' \
        > "$RELEASE_DIR/plan-request.json"

      curl -fsS "$CANARY_URL/plan" \
        -H "@$AUTH_HEADER_FILE" \
        -H 'Content-Type: application/json' \
        --data-binary @"$RELEASE_DIR/plan-request.json" \
        | tee "$RELEASE_DIR/plan-canary.json" \
        | jq -e '
          (.page_count | type == "number" and . > 0) and
          (.recommended_mode | type == "string" and length > 0) and
          (.recommended_lane | type == "string" and length > 0) and
          (.recommended_chunk_size | type == "number" and . > 0)
        ' >/dev/null

      if [[ "$RUN_PARSE_SMOKE" == "1" ]]; then
        log "Running the optional synchronous parse smoke test."
        jq -n --arg url "$SMOKE_PDF_URL" --arg mode "$SMOKE_MODE" \
          '{url:$url, mode:$mode, include_doctags:false, include_markdown:false}' \
          > "$RELEASE_DIR/parse-request.json"

        curl -fsS "$CANARY_URL/parse" \
          -H "@$AUTH_HEADER_FILE" \
          -H 'Content-Type: application/json' \
          --data-binary @"$RELEASE_DIR/parse-request.json" \
          | jq '{engine_version, page_count, summary, extractor_lane, lane_policy}' \
          > "$RELEASE_DIR/parse-canary-summary.json"
      fi
    else
      warn "SMOKE_PDF_URL is empty. Health and capabilities passed; /plan was skipped."
    fi
  else
    warn "No token available. Health passed, but authenticated capabilities and /plan checks were skipped."
    warn "Set TOKEN_SECRET_NAME or export PDF_PARSE_SERVICE_TOKEN in the current shell."
  fi

  ok "Canary smoke checks completed."
}

show_status() {
  ensure_release_state
  gcloud run services describe "$SERVICE" \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --platform managed \
    --format='table(status.traffic[].revisionName,status.traffic[].percent,status.traffic[].tag,status.traffic[].url)'
  echo
  gcloud run revisions list \
    --project "$PROJECT_ID" \
    --service "$SERVICE" \
    --region "$REGION" \
    --platform managed \
    --sort-by='~metadata.creationTimestamp' \
    --limit=8 \
    --format='table(metadata.name,status.conditions[0].status,spec.containers[0].image,metadata.creationTimestamp)'
}

promote() {
  local percentage="${1:-}"
  [[ "$percentage" =~ ^[0-9]+$ ]] || die "Usage: $0 promote PERCENTAGE"
  (( percentage >= 1 && percentage <= 100 )) || die "Percentage must be between 1 and 100."

  ensure_release_state
  [[ -n "$CANARY_REVISION" ]] || die "No canary revision in state."

  local targets
  if (( percentage == 100 )); then
    targets="$CANARY_REVISION=100"
  else
    if [[ "$ORIGINAL_TRAFFIC_COUNT" != "1" || -z "$PREVIOUS_REVISION" ]]; then
      die "Gradual promotion currently requires one previously serving revision. Current saved count: $ORIGINAL_TRAFFIC_COUNT. Use 'status' and set traffic explicitly."
    fi
    targets="$CANARY_REVISION=$percentage,$PREVIOUS_REVISION=$((100 - percentage))"
  fi

  log "Updating Cloud Run traffic: $targets"
  run_mutation gcloud run services update-traffic "$SERVICE" \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --platform managed \
    --to-revisions "$targets" \
    --quiet

  if [[ "$DRY_RUN" != "1" ]]; then
    gcloud run services describe "$SERVICE" \
      --project "$PROJECT_ID" \
      --region "$REGION" \
      --platform managed \
      --format='table(status.traffic[].revisionName,status.traffic[].percent,status.traffic[].tag,status.traffic[].url)' \
      | tee "$RELEASE_DIR/traffic-after-${percentage}.txt"
  fi
  ok "Traffic update submitted."
}

rollback() {
  ensure_release_state
  [[ -n "$ORIGINAL_TRAFFIC" ]] || die "No original traffic split was captured. Use 'status' and roll back manually."

  log "Restoring original traffic: $ORIGINAL_TRAFFIC"
  run_mutation gcloud run services update-traffic "$SERVICE" \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --platform managed \
    --to-revisions "$ORIGINAL_TRAFFIC" \
    --quiet

  if [[ "$DRY_RUN" != "1" ]]; then
    gcloud run services describe "$SERVICE" \
      --project "$PROJECT_ID" \
      --region "$REGION" \
      --platform managed \
      --format='table(status.traffic[].revisionName,status.traffic[].percent,status.traffic[].tag,status.traffic[].url)' \
      | tee "$RELEASE_DIR/traffic-after-rollback.txt"
  fi
  ok "Rollback traffic update submitted."
}

remove_canary_tag() {
  ensure_release_state
  [[ -n "$CANARY_TAG" ]] || die "No canary tag in state."
  run_mutation gcloud run services update-traffic "$SERVICE" \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --platform managed \
    --remove-tags "$CANARY_TAG" \
    --quiet
  ok "Canary tag removal submitted."
}

release() {
  inventory
  build_image
  deploy_canary
  smoke_canary
  cat <<EOF

Canary is ready at 0% production traffic.

Review the evidence in:
  $RELEASE_DIR

Then use:
  bash $0 promote 5
  bash $0 status
  bash $0 promote 100

Emergency rollback:
  bash $0 rollback
EOF
}

guided_release() {
  release
  printf '\nPromote the canary to 5%% now? Type PROMOTE5 to continue: '
  local answer
  read -r answer
  if [[ "$answer" == "PROMOTE5" ]]; then
    promote 5
  else
    warn "Stopped safely with the canary at 0% traffic."
    return 0
  fi

  printf '\nAfter reviewing live health and logs, type PROMOTE100 to send 100%% traffic: '
  read -r answer
  if [[ "$answer" == "PROMOTE100" ]]; then
    promote 100
  else
    warn "Stopped with the canary at 5% traffic. Use '$0 promote 100' or '$0 rollback' later."
  fi
}

usage() {
  cat <<EOF
Usage: $0 COMMAND [ARG]

Commands:
  release             Inventory, build, deploy 0%-traffic canary, and smoke-test.
  guided              Same as release, then interactively offer 5% and 100% promotion.
  inventory           Capture current service config and rollback state.
  build               Build and push an immutable image from pdf-parse-service/.
  canary              Deploy the built image with --no-traffic and a revision tag.
  smoke               Test /healthz, /capabilities, and optionally /plan.
  promote PERCENT     Send PERCENT traffic to the canary revision (1-100).
  rollback            Restore the exact traffic split captured during inventory.
  status              Show current traffic and recent revisions.
  remove-tag          Remove the saved canary revision tag.
  menu                Open an interactive command menu.
  help                 Show this help.

Configuration:
  Copy pdf_sidecar_deploy.env.example to .pdf-sidecar.env beside this script,
  or set PDF_SIDECAR_CONFIG=/path/to/file.

Safety:
  'release' never promotes production traffic. Use 'guided' only when you want
  explicit typed confirmations for 5% and 100% promotion.
EOF
}

menu() {
  PS3='Choose an action: '
  select choice in \
    'Release to 0% canary' \
    'Guided release (0% -> 5% -> 100%)' \
    'Show status' \
    'Promote to 5%' \
    'Promote to 100%' \
    'Rollback' \
    'Remove canary tag' \
    'Exit'; do
    case "$REPLY" in
      1) release; break ;;
      2) guided_release; break ;;
      3) show_status; break ;;
      4) promote 5; break ;;
      5) promote 100; break ;;
      6) rollback; break ;;
      7) remove_canary_tag; break ;;
      8) break ;;
      *) warn "Choose a number from 1 to 8." ;;
    esac
  done
}

main() {
  local command="${1:-menu}"
  case "$command" in
    release) release ;;
    guided) guided_release ;;
    inventory) inventory ;;
    build) build_image ;;
    canary) deploy_canary ;;
    smoke) smoke_canary ;;
    promote) promote "${2:-}" ;;
    rollback) rollback ;;
    status) show_status ;;
    remove-tag) remove_canary_tag ;;
    menu) menu ;;
    help|-h|--help) usage ;;
    *) usage; die "Unknown command: $command" ;;
  esac
}

main "$@"

#!/usr/bin/env bash
#
# PDF Import Phase 11A Local Rollout Readiness Check
#
# Runs local, read-only rollout readiness checks. It does NOT touch the
# production database, Supabase, or GCP, does NOT start the preview server, and
# NEVER deletes files.
#
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT" || exit 1

FAILS=0
note() { printf '\n=== %s ===\n' "$1"; }
ok()   { printf '  [ok]   %s\n' "$1"; }
miss() { printf '  [MISS] %s\n' "$1"; FAILS=$((FAILS + 1)); }

check_file() { if [ -f "$1" ]; then ok "$1"; else miss "$1"; fi; }
check_dir()  { if [ -d "$1" ]; then ok "$1"; else miss "$1"; fi; }

note "Branch"
git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "  (not a git repo?)"

note "Git status (short)"
git status --short || true

note "Phase 10H lock files"
for f in \
  docs/pdf-import/phase-10h-production-intelligence-lock.md \
  docs/pdf-import/phase-10-completion-checklist.md \
  scripts/regression/pdf-import-phase-10-final-check.sql
do check_file "$f"; done

note "Phase 11A docs"
for f in \
  docs/pdf-import/phase-11a-production-rollout-readiness-review.md \
  docs/pdf-import/phase-11a-rollout-risk-register.template.md \
  docs/pdf-import/phase-11a-rollout-readiness-report.template.md \
  docs/pdf-import/phase-11a-initial-rollout-scope.template.md
do check_file "$f"; done

note "Phase 11A SQL"
check_file "scripts/regression/pdf-import-phase-11a-rollout-readiness-check.sql"

note "rolloutReadiness source directory"
check_dir "src/lib/reportTemplate/ingestion/rolloutReadiness"

note "Phase 11A tests"
for f in \
  src/lib/reportTemplate/__tests__/rolloutReadinessChecklist.spec.ts \
  src/lib/reportTemplate/__tests__/rolloutReadinessEvaluator.spec.ts \
  src/lib/reportTemplate/__tests__/rolloutReadinessDisplay.spec.ts
do check_file "$f"; done

note "Private/staged artifact scan"
PRIVATE="$(git status --porcelain | grep -iE '\.(pdf|png|jpg|jpeg|webp|log|env)$|audit-output/|supabase/config\.toml\.before-' || true)"
if [ -n "$PRIVATE" ]; then
  printf '  [MISS] private artifacts detected:\n%s\n' "$PRIVATE"; FAILS=$((FAILS + 1))
else
  ok "no private/staged artifacts detected"
fi

note "Run Phase 11A tests"
npx vitest run \
  src/lib/reportTemplate/__tests__/rolloutReadinessChecklist.spec.ts \
  src/lib/reportTemplate/__tests__/rolloutReadinessEvaluator.spec.ts \
  src/lib/reportTemplate/__tests__/rolloutReadinessDisplay.spec.ts || FAILS=$((FAILS + 1))

note "Build"
npm run build || FAILS=$((FAILS + 1))

note "Reminder"
echo "  Run scripts/regression/pdf-import-phase-11a-rollout-readiness-check.sql in the Supabase SQL Editor."

note "Result"
if [ "$FAILS" -eq 0 ]; then
  echo "  Local rollout readiness checks passed."
  exit 0
else
  echo "  Local rollout readiness checks reported $FAILS issue(s)."
  exit 1
fi

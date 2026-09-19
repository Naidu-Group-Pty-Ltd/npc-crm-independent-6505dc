#!/usr/bin/env bash
#
# PDF Import Phase 10 Final Local Check (Phase 10H)
#
# Runs local, read-only final checks for the Phase 10 production intelligence
# lock. It does NOT touch the production database, Supabase, or GCP, does NOT
# start the preview server, and NEVER deletes files.
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

note "Required Phase 10 docs"
for f in \
  docs/pdf-import/phase-10a-production-hardening-audit.md \
  docs/pdf-import/phase-10b-import-intelligence-profile.md \
  docs/pdf-import/phase-10c-repair-pattern-library.md \
  docs/pdf-import/phase-10d-adaptive-reconciliation.md \
  docs/pdf-import/phase-10e-self-healing-retry-orchestration.md \
  docs/pdf-import/phase-10f-performance-cost-optimization.md \
  docs/pdf-import/phase-10g-production-operator-controls.md \
  docs/pdf-import/phase-10h-production-intelligence-lock.md \
  docs/pdf-import/phase-10-completion-checklist.md \
  docs/pdf-import/phase-10-final-smoke-test.md
do check_file "$f"; done

note "Required Phase 10 SQL"
for f in \
  scripts/regression/pdf-import-phase-10a-hardening-check.sql \
  scripts/regression/pdf-import-phase-10b-import-profile-check.sql \
  scripts/regression/pdf-import-phase-10c-repair-pattern-check.sql \
  scripts/regression/pdf-import-phase-10d-adaptive-reconciliation-check.sql \
  scripts/regression/pdf-import-phase-10e-self-healing-check.sql \
  scripts/regression/pdf-import-phase-10f-performance-check.sql \
  scripts/regression/pdf-import-phase-10g-operator-controls-check.sql \
  scripts/regression/pdf-import-phase-10-final-check.sql
do check_file "$f"; done

note "Required Phase 10 schemas"
for f in \
  docs/pdf-import/import-intelligence-profile.schema.json \
  docs/pdf-import/repair-pattern-analysis.schema.json \
  docs/pdf-import/adaptive-reconciliation-policy.schema.json \
  docs/pdf-import/self-healing-retry-audit.schema.json \
  docs/pdf-import/performance-cost-audit.schema.json \
  docs/pdf-import/production-operator-control-audit.schema.json
do check_file "$f"; done

note "Required source module directories"
for d in \
  src/lib/reportTemplate/ingestion/hardening \
  src/lib/reportTemplate/ingestion/importIntelligence \
  src/lib/reportTemplate/ingestion/repairPatterns \
  src/lib/reportTemplate/ingestion/reconciliation \
  src/lib/reportTemplate/ingestion/selfHealing \
  src/lib/reportTemplate/ingestion/performance \
  src/lib/reportTemplate/ingestion/operatorControls \
  src/lib/reportTemplate/ingestion/phase10Lock
do check_dir "$d"; done

note "Private/staged artifact scan"
PRIVATE="$(git status --porcelain | grep -iE '\.(pdf|png|jpg|jpeg|webp|log|env)$|audit-output/|supabase/config\.toml\.before-' || true)"
if [ -n "$PRIVATE" ]; then
  printf '  [MISS] private artifacts detected:\n%s\n' "$PRIVATE"; FAILS=$((FAILS + 1))
else
  ok "no private/staged artifacts detected"
fi

note "Phase 10H tests"
npx vitest run \
  src/lib/reportTemplate/__tests__/phase10ProductionLockChecklist.spec.ts \
  src/lib/reportTemplate/__tests__/phase10ProductionLockEvaluator.spec.ts \
  src/lib/reportTemplate/__tests__/phase10ProductionLockDisplay.spec.ts || FAILS=$((FAILS + 1))

note "Full Phase 10 test suites (command)"
echo "  npx vitest run src/lib/reportTemplate"

note "Build"
npm run build || FAILS=$((FAILS + 1))

note "Reminder"
echo "  Run scripts/regression/pdf-import-phase-10-final-check.sql in the Supabase SQL Editor."
echo "  Run the production preview smoke test per docs/pdf-import/phase-10-final-smoke-test.md."

note "Result"
if [ "$FAILS" -eq 0 ]; then
  echo "  Local final checks passed."
  exit 0
else
  echo "  Local final checks reported $FAILS issue(s)."
  exit 1
fi

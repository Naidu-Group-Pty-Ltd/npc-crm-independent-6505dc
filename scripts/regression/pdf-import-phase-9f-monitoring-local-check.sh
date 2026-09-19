#!/usr/bin/env bash
#
# PDF Import Phase 9F — local monitoring-readiness check.
#
# Confirms the Phase 9F monitoring docs + TypeScript modules exist, runs the
# monitoring + release-gate tests, runs the build, and prints a reminder to run
# the Phase 9F SQL in the Supabase SQL Editor. It does NOT run database SQL and
# requires no credentials.

set -euo pipefail

FAIL=0
fail() { echo "  [FAIL] $1"; FAIL=1; }
ok()   { echo "  [ok]   $1"; }
section() { echo; echo "== $1 =="; }

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

section "Required monitoring files"
REQUIRED=(
  "docs/pdf-import/phase-9f-monitoring-alert-readiness.md"
  "docs/pdf-import/phase-9f-monitoring-runbook.md"
  "scripts/regression/pdf-import-phase-9f-monitoring-check.sql"
  "src/lib/reportTemplate/ingestion/monitoring/pdfImportMonitoringTypes.ts"
  "src/lib/reportTemplate/ingestion/monitoring/pdfImportMonitoringRules.ts"
  "src/lib/reportTemplate/ingestion/monitoring/pdfImportMonitoringEvaluator.ts"
  "src/lib/reportTemplate/ingestion/monitoring/index.ts"
)
for f in "${REQUIRED[@]}"; do
  if [ -f "$f" ]; then ok "$f"; else fail "missing: $f"; fi
done

section "Monitoring + release gate tests"
TESTS=(
  "src/lib/reportTemplate/__tests__/pdfImportMonitoringRules.spec.ts"
  "src/lib/reportTemplate/__tests__/pdfImportMonitoringEvaluator.spec.ts"
  "src/lib/reportTemplate/__tests__/pdfImportReleaseGateEvaluator.spec.ts"
)
# Include the display spec when present.
if [ -f "src/lib/reportTemplate/__tests__/pdfImportMonitoringDisplay.spec.ts" ]; then
  TESTS+=("src/lib/reportTemplate/__tests__/pdfImportMonitoringDisplay.spec.ts")
fi
if npm run test -- "${TESTS[@]}"; then ok "monitoring + release gate tests passed"; else fail "tests failed"; fi

section "Build"
if npm run build; then ok "npm run build passed"; else fail "npm run build failed"; fi

section "Manual SQL reminder (run in Supabase SQL Editor)"
echo "  - scripts/regression/pdf-import-phase-9f-monitoring-check.sql"
echo "  - scripts/regression/pdf-import-phase-9e-release-gate-check.sql"

section "Result"
if [ "$FAIL" -eq 0 ]; then
  echo "  Phase 9F local monitoring checks: PASS"
  exit 0
else
  echo "  Phase 9F local monitoring checks: FAIL"
  exit 1
fi

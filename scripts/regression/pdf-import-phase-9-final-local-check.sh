#!/usr/bin/env bash
#
# PDF Import Phase 9G — final local production-rollout lock check.
#
# Confirms the Phase 9G lock deliverables exist, then reuses the Phase 9E
# release check for the heavy automated gates (required files, JSON validity,
# required tests, build, private-artifact staging). It additionally runs the
# monitoring tests and prints the manual SQL + browser checklists needed for
# the final production rollout decision.
#
# It does NOT run any database SQL, needs no credentials/secrets, launches no
# preview server, and does not depend on lsof.
#
# Exit code: 0 when all automated gates pass, non-zero otherwise.

set -euo pipefail

FAIL=0
fail() { echo "  [FAIL] $1"; FAIL=1; }
ok()   { echo "  [ok]   $1"; }
section() { echo; echo "==================================================================="; echo "== $1"; echo "==================================================================="; }

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

section "Repository"
echo "  root:   $ROOT"
echo "  branch: $(git branch --show-current 2>/dev/null || echo '(detached)')"
echo "  commit: $(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')"

# ---------------------------------------------------------------------------
# 1. Required Phase 9G lock deliverables
# ---------------------------------------------------------------------------
section "Phase 9G lock deliverables"

REQUIRED=(
  "docs/pdf-import/phase-9-completion-checklist.md"
  "docs/pdf-import/phase-9-final-smoke-test.md"
  "docs/pdf-import/phase-9-production-rollout-notes.md"
  "scripts/regression/pdf-import-phase-9-final-check.sql"
  "scripts/regression/pdf-import-phase-9-release-check.sh"
  "docs/pdf-import/phase-9f-monitoring-alert-readiness.md"
  "docs/pdf-import/phase-9f-monitoring-runbook.md"
  "scripts/regression/pdf-import-phase-9f-monitoring-check.sql"
)
for f in "${REQUIRED[@]}"; do
  if [ -f "$f" ]; then ok "$f"; else fail "missing: $f"; fi
done

# ---------------------------------------------------------------------------
# 2. Phase 9E automated release gates (reused)
# ---------------------------------------------------------------------------
section "Phase 9E automated release gates (reused)"

if [ -x "scripts/regression/pdf-import-phase-9-release-check.sh" ] || [ -f "scripts/regression/pdf-import-phase-9-release-check.sh" ]; then
  if bash scripts/regression/pdf-import-phase-9-release-check.sh; then
    ok "release check passed"
  else
    fail "release check failed"
  fi
else
  fail "missing: scripts/regression/pdf-import-phase-9-release-check.sh"
fi

# ---------------------------------------------------------------------------
# 3. Monitoring tests
# ---------------------------------------------------------------------------
section "Monitoring tests"

MON_TESTS=()
for t in \
  "src/lib/reportTemplate/__tests__/pdfImportMonitoringRules.spec.ts" \
  "src/lib/reportTemplate/__tests__/pdfImportMonitoringEvaluator.spec.ts" \
  "src/lib/reportTemplate/__tests__/pdfImportMonitoringDisplay.spec.ts"
do
  if [ -f "$t" ]; then MON_TESTS+=("$t"); fi
done

if [ "${#MON_TESTS[@]}" -gt 0 ]; then
  if npm run test -- "${MON_TESTS[@]}"; then ok "monitoring tests passed"; else fail "monitoring tests failed"; fi
else
  echo "  SKIP no monitoring tests found"
fi

# ---------------------------------------------------------------------------
# 4. Manual SQL checklist (NOT executed here)
# ---------------------------------------------------------------------------
section "Manual SQL checklist (run in Supabase SQL Editor)"
cat <<'SQLEOF'
  - scripts/regression/pdf-import-phase-9e-release-gate-check.sql
  - scripts/regression/pdf-import-phase-9f-monitoring-check.sql
  - scripts/regression/pdf-import-phase-9-final-check.sql   (section 10 = final decision)
SQLEOF

# ---------------------------------------------------------------------------
# 5. Manual browser checklist (NOT automated here)
# ---------------------------------------------------------------------------
section "Manual browser checklist (see phase-9-final-smoke-test.md)"
cat <<'BROWSEREOF'
  - open /admin/pdf-golden-regression   (console loads, no errors)
  - corpus selector loads
  - run Evaluate Only                    (result / gates / triage panels)
  - run Evaluate + Persist (only if safe)(history + baseline comparison)
  - verify export parity automation result (only if safe)
  - open /admin/template-import-quality  (still loads, deep-link works)
  - confirm no console errors
BROWSEREOF

# ---------------------------------------------------------------------------
# Result
# ---------------------------------------------------------------------------
section "Result"
if [ "$FAIL" -eq 0 ]; then
  echo "  Phase 9G final local checks: PASS (pending manual SQL + browser smoke)"
  exit 0
else
  echo "  Phase 9G final local checks: FAIL"
  exit 1
fi

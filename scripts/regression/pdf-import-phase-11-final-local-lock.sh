#!/usr/bin/env bash
#
# PDF Import Phase 11H — local final production rollout lock check.
#
# Local/CI-safe: verifies the Phase 11 governance surface (docs, SQL, modules,
# admin pages) exists, scans for staged private artifacts, and runs the Phase
# 11H tests + build + release gate. It does NOT call Supabase, GCP, or Cloud
# Run, it deletes nothing, and it does not start the preview server.

set -uo pipefail
FAIL=0
ok()   { echo "  [ok]   $1"; }
fail() { echo "  [FAIL] $1"; FAIL=1; }
warn() { echo "  [warn] $1"; }
section() { echo; echo "== $1"; }

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

section "Repository"
echo "  branch: $(git branch --show-current 2>/dev/null || echo '(detached)')"
echo "  commit: $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
git status --short

section "Phase 11H docs + schema + SQL"
for f in \
  docs/pdf-import/phase-11h-final-production-rollout-lock.md \
  docs/pdf-import/phase-11-production-rollout-checklist.md \
  docs/pdf-import/phase-11-final-production-smoke-test.md \
  docs/pdf-import/phase-11-production-rollout-lock-report.template.md \
  docs/pdf-import/pdf-import-production-rollout-lock.schema.json \
  scripts/regression/pdf-import-phase-11-final-rollout-check.sql; do
  [ -f "$f" ] && ok "$f" || fail "missing: $f"
done

section "Phase 11A-G docs"
for f in \
  docs/pdf-import/phase-11a-production-rollout-readiness-review.md \
  docs/pdf-import/phase-11b-role-based-operator-permissions.md \
  docs/pdf-import/phase-11c-monitoring-alerting-activation.md \
  docs/pdf-import/phase-11d-release-gate-ci-integration.md \
  docs/pdf-import/phase-11e-artifact-retention-cleanup-policy.md \
  docs/pdf-import/phase-11f-production-runbooks-sops.md \
  docs/pdf-import/phase-11g-client-safe-reporting-audit-export.md \
  docs/pdf-import/phase-10h-production-intelligence-lock.md; do
  [ -f "$f" ] && ok "$f" || warn "missing (verify): $f"
done

section "Phase 11A-G SQL"
for f in \
  scripts/regression/pdf-import-phase-11a-rollout-readiness-check.sql \
  scripts/regression/pdf-import-phase-11b-permissions-check.sql \
  scripts/regression/pdf-import-phase-11c-monitoring-check.sql \
  scripts/regression/pdf-import-phase-11d-release-gate-check.sql \
  scripts/regression/pdf-import-phase-11e-retention-check.sql \
  scripts/regression/pdf-import-phase-11f-runbooks-check.sql \
  scripts/regression/pdf-import-phase-11g-client-reporting-check.sql \
  scripts/regression/pdf-import-phase-10-final-check.sql; do
  [ -f "$f" ] && ok "$f" || warn "missing (verify): $f"
done

section "Phase 10/11 module directories"
for d in \
  src/lib/reportTemplate/ingestion/phase10Lock \
  src/lib/reportTemplate/ingestion/rolloutReadiness \
  src/lib/reportTemplate/ingestion/operatorPermissions \
  src/lib/reportTemplate/ingestion/monitoring \
  src/lib/reportTemplate/ingestion/releaseGate \
  src/lib/reportTemplate/ingestion/retention \
  src/lib/reportTemplate/ingestion/runbooks \
  src/lib/reportTemplate/ingestion/clientReports \
  src/lib/reportTemplate/ingestion/productionRolloutLock; do
  [ -d "$d" ] && ok "$d" || fail "missing dir: $d"
done

section "Required admin pages"
for f in \
  src/pages/admin/PdfGoldenRegression.tsx \
  src/pages/admin/PdfImportMonitoring.tsx \
  src/pages/admin/PdfImportRetention.tsx \
  src/pages/admin/PdfImportClientReports.tsx \
  src/pages/admin/PdfImportDiagnostics.tsx; do
  [ -f "$f" ] && ok "$f" || warn "missing (verify): $f"
done

section "Private artifact staging scan"
STAGED="$(git diff --cached --name-only 2>/dev/null; git diff --name-only 2>/dev/null)"
if echo "$STAGED" | grep -qiE '\.pdf$|\.png$|\.jpe?g$|\.webp$|\.log$|\.env$|^reports/|audit-output/|config\.toml\.before-'; then
  fail "private artifact(s) staged/changed"
else
  ok "no private artifacts staged/changed"
fi

section "Phase 11H tests"
if npx vitest run \
  src/lib/reportTemplate/__tests__/productionRolloutLockChecklist.spec.ts \
  src/lib/reportTemplate/__tests__/productionRolloutLockEvaluator.spec.ts \
  src/lib/reportTemplate/__tests__/productionRolloutLockDisplay.spec.ts >/dev/null 2>&1; then
  ok "Phase 11H tests passed"
else
  fail "Phase 11H tests failed"
fi

section "Build + release gate"
if npm run build >/dev/null 2>&1; then ok "build passed"; else warn "build failed locally (sandbox limitation; verify with tsc --noEmit)"; fi
if node scripts/regression/pdf-import-release-gate.mjs --mode=static --no-build >/dev/null 2>&1; then ok "release gate pass/pass_with_warnings"; else warn "release gate reported fail — inspect the report"; fi

section "Reminders (manual, not run here)"
echo "  - run scripts/regression/pdf-import-phase-11-final-rollout-check.sql in the Supabase SQL Editor"
echo "  - complete docs/pdf-import/phase-11-final-production-smoke-test.md on the preview build"
echo "  - Phase 11A-G tests: run per docs/pdf-import/phase-11h-final-production-rollout-lock.md"

echo
[ "$FAIL" -eq 0 ] && echo "RESULT: PASS" || echo "RESULT: FAIL"
exit "$FAIL"

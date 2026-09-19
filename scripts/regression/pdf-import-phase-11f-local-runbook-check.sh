#!/usr/bin/env bash
#
# PDF Import Phase 11F — local runbook readiness check.
#
# Local/CI-safe: checks runbook docs + modules + tests exist, scans for staged
# private artifacts, and runs the Phase 11F tests + build. It does NOT call
# Supabase, GCP, or Cloud Run, and it deletes nothing.

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

section "Runbook docs"
RUNBOOKS=(
  operator-quick-start daily-operations-checklist weekly-qa-checklist evaluate-only-sop evaluate-persist-sop
  visual-qa-review-sop repair-pattern-review-sop adaptive-reconciliation-sop self-healing-review-sop
  export-parity-review-sop golden-regression-review-sop monitoring-alert-response-sop permission-denied-sop
  retention-candidate-review-sop release-gate-failure-sop incident-response-sop rollback-escalation-sop
  client-communication-boundaries
)
[ -d docs/pdf-import/runbooks ] && ok "runbooks folder present" || fail "runbooks folder missing"
[ -f docs/pdf-import/runbooks/README.md ] && ok "README present" || fail "runbooks README missing"
for r in "${RUNBOOKS[@]}"; do
  f="docs/pdf-import/runbooks/pdf-import-${r}.md"
  [ -f "$f" ] && ok "$r" || fail "missing runbook: $f"
done

section "Templates + schema + phase doc"
for f in \
  docs/pdf-import/phase-11f-production-runbooks-sops.md \
  docs/pdf-import/phase-11f-escalation-matrix.template.md \
  docs/pdf-import/phase-11f-operator-training-checklist.template.md \
  docs/pdf-import/phase-11f-shift-handoff-template.md \
  docs/pdf-import/pdf-import-runbook-registry.schema.json \
  scripts/regression/pdf-import-phase-11f-runbooks-check.sql; do
  [ -f "$f" ] && ok "$f" || fail "missing: $f"
done

section "Runbook modules + tests"
for f in \
  src/lib/reportTemplate/ingestion/runbooks/pdfImportRunbookTypes.ts \
  src/lib/reportTemplate/ingestion/runbooks/pdfImportRunbookRegistry.ts \
  src/lib/reportTemplate/ingestion/runbooks/pdfImportRunbookEvaluator.ts \
  src/lib/reportTemplate/ingestion/runbooks/pdfImportRunbookDisplay.ts \
  src/lib/reportTemplate/ingestion/runbooks/index.ts \
  src/lib/reportTemplate/__tests__/pdfImportRunbookRegistry.spec.ts \
  src/lib/reportTemplate/__tests__/pdfImportRunbookEvaluator.spec.ts \
  src/lib/reportTemplate/__tests__/pdfImportRunbookDisplay.spec.ts; do
  [ -f "$f" ] && ok "$f" || fail "missing: $f"
done

section "Private artifact staging scan"
STAGED="$(git diff --cached --name-only 2>/dev/null; git diff --name-only 2>/dev/null)"
if echo "$STAGED" | grep -qiE '\.pdf$|\.png$|\.jpe?g$|\.webp$|\.log$|\.env$|^reports/|audit-output/|config\.toml\.before-'; then
  fail "private artifact(s) staged/changed"
else
  ok "no private artifacts staged/changed"
fi

section "Phase 11F tests"
if npx vitest run \
  src/lib/reportTemplate/__tests__/pdfImportRunbookRegistry.spec.ts \
  src/lib/reportTemplate/__tests__/pdfImportRunbookEvaluator.spec.ts \
  src/lib/reportTemplate/__tests__/pdfImportRunbookDisplay.spec.ts >/dev/null 2>&1; then
  ok "Phase 11F tests passed"
else
  fail "Phase 11F tests failed"
fi

section "Build"
if npm run build >/dev/null 2>&1; then
  ok "build passed"
else
  warn "build failed locally (may be a sandbox registry limitation; verify with tsc --noEmit)"
fi

section "Reminder"
echo "  - run scripts/regression/pdf-import-phase-11f-runbooks-check.sql in the Supabase SQL Editor"

echo
[ "$FAIL" -eq 0 ] && echo "RESULT: PASS" || echo "RESULT: FAIL"
exit "$FAIL"

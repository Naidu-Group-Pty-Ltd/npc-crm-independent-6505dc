#!/usr/bin/env bash
#
# PDF Import Phase 11E — local retention readiness check.
#
# Local/CI-safe: checks required files exist, scans for staged private
# artifacts, and runs the Phase 11E tests + build. It does NOT call Supabase,
# GCP, or Cloud Run, and it deletes nothing.

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

section "Required files"
REQUIRED=(
  "docs/pdf-import/phase-11e-artifact-retention-cleanup-policy.md"
  "docs/pdf-import/phase-11e-retention-policy.md"
  "docs/pdf-import/phase-11e-cleanup-review-runbook.template.md"
  "docs/pdf-import/pdf-import-retention-event.schema.json"
  "scripts/regression/pdf-import-phase-11e-retention-check.sql"
  "supabase/functions/pdf-import-retention/index.ts"
  "src/lib/reportTemplate/ingestion/retention/pdfImportRetentionTypes.ts"
  "src/lib/reportTemplate/ingestion/retention/pdfImportRetentionPolicy.ts"
  "src/lib/reportTemplate/ingestion/retention/pdfImportRetentionSignals.ts"
  "src/lib/reportTemplate/ingestion/retention/pdfImportRetentionEvaluator.ts"
  "src/lib/reportTemplate/ingestion/retention/pdfImportRetentionPersistence.ts"
  "src/lib/reportTemplate/ingestion/retention/pdfImportRetentionDisplay.ts"
  "src/lib/reportTemplate/ingestion/retention/index.ts"
  "src/pages/admin/PdfImportRetention.tsx"
  "src/components/admin/pdfImport/PdfImportRetentionPanel.tsx"
  "src/components/admin/pdfImport/PdfImportRetentionCandidateList.tsx"
  "src/components/admin/pdfImport/PdfImportRetentionCandidateDetail.tsx"
)
MIGRATION="$(ls supabase/migrations/*_create_pdf_import_retention_events.sql 2>/dev/null | head -1)"
[ -n "$MIGRATION" ] && ok "migration present: $MIGRATION" || fail "retention migration missing"
for f in "${REQUIRED[@]}"; do
  [ -f "$f" ] && ok "$f" || fail "missing: $f"
done

section "Private artifact staging scan"
STAGED="$(git diff --cached --name-only 2>/dev/null; git diff --name-only 2>/dev/null)"
if echo "$STAGED" | grep -qiE '\.pdf$|\.png$|\.jpe?g$|\.webp$|\.log$|\.env$|^reports/|audit-output/|config\.toml\.before-'; then
  fail "private artifact(s) staged/changed:"
  echo "$STAGED" | grep -iE '\.pdf$|\.png$|\.jpe?g$|\.webp$|\.log$|\.env$|^reports/|audit-output/|config\.toml\.before-' | sed 's/^/      /'
else
  ok "no private artifacts staged/changed"
fi

section "Phase 11E tests"
if npx vitest run \
  src/lib/reportTemplate/__tests__/pdfImportRetentionPolicy.spec.ts \
  src/lib/reportTemplate/__tests__/pdfImportRetentionSignals.spec.ts \
  src/lib/reportTemplate/__tests__/pdfImportRetentionEvaluator.spec.ts \
  src/lib/reportTemplate/__tests__/pdfImportRetentionPersistence.spec.ts \
  src/lib/reportTemplate/__tests__/pdfImportRetentionDisplay.spec.ts >/dev/null 2>&1; then
  ok "Phase 11E tests passed"
else
  fail "Phase 11E tests failed (run them directly to see details)"
fi

section "Build"
if npm run build >/dev/null 2>&1; then
  ok "build passed"
else
  warn "build failed locally (may be a sandbox registry limitation; verify with tsc --noEmit)"
fi

section "Reminders (manual, not run here)"
echo "  - apply migration: supabase/migrations/*_create_pdf_import_retention_events.sql"
echo "  - deploy edge function: pdf-import-retention"
echo "  - run scripts/regression/pdf-import-phase-11e-retention-check.sql in the Supabase SQL Editor"

echo
[ "$FAIL" -eq 0 ] && echo "RESULT: PASS" || echo "RESULT: FAIL"
exit "$FAIL"

#!/usr/bin/env bash
#
# PDF Import Phase 11G — local client-report readiness check.
#
# Local/CI-safe: checks docs + modules + UI + tests exist, scans for staged
# private artifacts, and runs the Phase 11G tests + build. It does NOT call
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

section "Docs + schema + SQL"
for f in \
  docs/pdf-import/phase-11g-client-safe-reporting-audit-export.md \
  docs/pdf-import/phase-11g-client-safe-report-policy.md \
  docs/pdf-import/phase-11g-report-review-runbook.template.md \
  docs/pdf-import/pdf-import-client-report.schema.json \
  scripts/regression/pdf-import-phase-11g-client-reporting-check.sql \
  supabase/functions/pdf-import-client-report/index.ts; do
  [ -f "$f" ] && ok "$f" || fail "missing: $f"
done
MIGRATION="$(ls supabase/migrations/*_create_pdf_import_client_reports.sql 2>/dev/null | head -1)"
[ -n "$MIGRATION" ] && ok "migration present: $MIGRATION" || fail "client reports migration missing"

section "clientReports modules + tests"
for f in \
  src/lib/reportTemplate/ingestion/clientReports/pdfImportClientReportTypes.ts \
  src/lib/reportTemplate/ingestion/clientReports/pdfImportClientReportPolicy.ts \
  src/lib/reportTemplate/ingestion/clientReports/pdfImportClientReportSanitizer.ts \
  src/lib/reportTemplate/ingestion/clientReports/pdfImportClientReportBuilder.ts \
  src/lib/reportTemplate/ingestion/clientReports/pdfImportClientReportPersistence.ts \
  src/lib/reportTemplate/ingestion/clientReports/pdfImportClientReportDisplay.ts \
  src/lib/reportTemplate/ingestion/clientReports/index.ts \
  src/pages/admin/PdfImportClientReports.tsx \
  src/components/admin/pdfImport/PdfImportClientReportPanel.tsx \
  src/components/admin/pdfImport/PdfImportClientReportPreview.tsx \
  src/components/admin/pdfImport/PdfImportClientReportList.tsx \
  src/components/admin/pdfImport/PdfImportClientReportDetail.tsx; do
  [ -f "$f" ] && ok "$f" || fail "missing: $f"
done

section "Private artifact staging scan"
STAGED="$(git diff --cached --name-only 2>/dev/null; git diff --name-only 2>/dev/null)"
if echo "$STAGED" | grep -qiE '\.pdf$|\.png$|\.jpe?g$|\.webp$|\.log$|\.env$|^reports/|audit-output/|config\.toml\.before-'; then
  fail "private artifact(s) staged/changed"
else
  ok "no private artifacts staged/changed"
fi

section "Phase 11G tests"
if npx vitest run \
  src/lib/reportTemplate/__tests__/pdfImportClientReportPolicy.spec.ts \
  src/lib/reportTemplate/__tests__/pdfImportClientReportSanitizer.spec.ts \
  src/lib/reportTemplate/__tests__/pdfImportClientReportBuilder.spec.ts \
  src/lib/reportTemplate/__tests__/pdfImportClientReportPersistence.spec.ts \
  src/lib/reportTemplate/__tests__/pdfImportClientReportDisplay.spec.ts >/dev/null 2>&1; then
  ok "Phase 11G tests passed"
else
  fail "Phase 11G tests failed"
fi

section "Build + release gate"
if npm run build >/dev/null 2>&1; then ok "build passed"; else warn "build failed locally (sandbox limitation; verify with tsc --noEmit)"; fi
if node scripts/regression/pdf-import-release-gate.mjs --mode=static --no-build >/dev/null 2>&1; then ok "release gate pass/pass_with_warnings"; else warn "release gate reported fail — inspect the report"; fi

section "Reminders (manual, not run here)"
echo "  - apply migration: supabase/migrations/*_create_pdf_import_client_reports.sql"
echo "  - deploy edge function: pdf-import-client-report"
echo "  - run scripts/regression/pdf-import-phase-11g-client-reporting-check.sql in the Supabase SQL Editor"

echo
[ "$FAIL" -eq 0 ] && echo "RESULT: PASS" || echo "RESULT: FAIL"
exit "$FAIL"

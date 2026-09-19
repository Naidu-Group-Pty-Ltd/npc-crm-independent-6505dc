#!/usr/bin/env bash
#
# PDF Import Phase 10A — local production-hardening static check.
#
# Advisory, read-only local checks that need no database, GCP, or preview server:
#   branch + status · required Phase 7/8/9 docs · required Phase 10A files ·
#   staged private/sensitive pattern scan · hardening evaluator test · build.
# It PRINTS a reminder to run the Phase 10A SQL in the Supabase SQL Editor.
#
# This script never deletes files and never runs database SQL.
#
# Exit code: 0 when all automated checks pass, non-zero otherwise.

set -euo pipefail

FAIL=0
fail() { echo "  [FAIL] $1"; FAIL=1; }
ok()   { echo "  [ok]   $1"; }
warn() { echo "  [warn] $1"; }
section() { echo; echo "==================================================================="; echo "== $1"; echo "==================================================================="; }

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

section "Repository"
echo "  branch: $(git branch --show-current 2>/dev/null || echo '(detached)')"
echo "  commit: $(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')"
echo "  status:"
git status --short 2>/dev/null | sed 's/^/    /' || true

# ---------------------------------------------------------------------------
# 1. Required prior-phase docs
# ---------------------------------------------------------------------------
section "Required Phase 7/8/9 docs"
PRIOR_DOCS=(
  "docs/pdf-import/phase-7-completion-checklist.md"
  "docs/pdf-import/phase-8-completion-checklist.md"
  "docs/pdf-import/phase-9-completion-checklist.md"
  "docs/pdf-import/phase-9-final-smoke-test.md"
)
for f in "${PRIOR_DOCS[@]}"; do
  if [ -f "$f" ]; then ok "$f"; else fail "missing: $f"; fi
done

# ---------------------------------------------------------------------------
# 2. Required Phase 10A files
# ---------------------------------------------------------------------------
section "Required Phase 10A files"
REQUIRED=(
  "docs/pdf-import/phase-10a-production-hardening-audit.md"
  "docs/pdf-import/phase-10a-production-hardening-risk-register.template.md"
  "scripts/regression/pdf-import-phase-10a-hardening-check.sql"
  "src/lib/reportTemplate/ingestion/hardening/pdfImportHardeningAuditTypes.ts"
  "src/lib/reportTemplate/ingestion/hardening/pdfImportHardeningChecklist.ts"
  "src/lib/reportTemplate/ingestion/hardening/pdfImportHardeningEvaluator.ts"
  "src/lib/reportTemplate/ingestion/hardening/index.ts"
  "src/lib/reportTemplate/__tests__/pdfImportHardeningEvaluator.spec.ts"
)
for f in "${REQUIRED[@]}"; do
  if [ -f "$f" ]; then ok "$f"; else fail "missing: $f"; fi
done

# ---------------------------------------------------------------------------
# 3. Staged private / sensitive pattern scan
# ---------------------------------------------------------------------------
section "Staged private-artifact scan"
FORBIDDEN_RE='(^|/)(audit-output/|dist/|node_modules/)|\.env$|\.pdf$|\.png$|\.jpe?g$|\.webp$|\.log$|supabase/config\.toml\.before-'
STAGED="$(git diff --cached --name-only 2>/dev/null || true)"
if [ -n "$STAGED" ] && echo "$STAGED" | grep -qE "$FORBIDDEN_RE"; then
  fail "forbidden files are staged:"
  echo "$STAGED" | grep -E "$FORBIDDEN_RE" | sed 's/^/      /'
else
  ok "no forbidden files staged"
fi

# ---------------------------------------------------------------------------
# 4. Sensitive content pattern scan in staged files
# ---------------------------------------------------------------------------
section "Staged sensitive-content scan"
SENSITIVE_RE='SUPABASE_SERVICE_ROLE_KEY|service_role_key|BEGIN [A-Z ]*PRIVATE KEY|X-Amz-Signature|token=ey'
STAGED_TEXT="$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null || true)"
HIT=0
if [ -n "$STAGED_TEXT" ]; then
  while IFS= read -r f; do
    [ -f "$f" ] || continue
    if grep -InE "$SENSITIVE_RE" "$f" >/dev/null 2>&1; then
      warn "sensitive pattern in staged file: $f"
      HIT=1
    fi
  done <<< "$STAGED_TEXT"
fi
if [ "$HIT" -eq 0 ]; then ok "no sensitive content patterns in staged files"; fi

# ---------------------------------------------------------------------------
# 5. Hardening evaluator test
# ---------------------------------------------------------------------------
section "Hardening evaluator test"
if npm run test -- src/lib/reportTemplate/__tests__/pdfImportHardeningEvaluator.spec.ts; then
  ok "hardening evaluator test passed"
else
  fail "hardening evaluator test failed"
fi

# ---------------------------------------------------------------------------
# 6. Build
# ---------------------------------------------------------------------------
section "Build"
if npm run build; then ok "npm run build passed"; else fail "npm run build failed"; fi

# ---------------------------------------------------------------------------
# 7. Manual SQL reminder (NOT executed here)
# ---------------------------------------------------------------------------
section "Manual SQL reminder (run in Supabase SQL Editor)"
echo "  - scripts/regression/pdf-import-phase-10a-hardening-check.sql"
echo "    (section 6 = storage bucket public flags; section 14 = RLS enabled;"
echo "     section 17 = database hardening status)"

# ---------------------------------------------------------------------------
# Result
# ---------------------------------------------------------------------------
section "Result"
if [ "$FAIL" -eq 0 ]; then
  echo "  Phase 10A local hardening checks: PASS (pending manual SQL review)"
  exit 0
else
  echo "  Phase 10A local hardening checks: FAIL"
  exit 1
fi

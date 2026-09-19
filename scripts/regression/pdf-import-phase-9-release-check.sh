#!/usr/bin/env bash
#
# PDF Import Phase 9E — local release gate check.
#
# Runs the CLASS 1 automated release gates (no database credentials, no secrets,
# no Supabase SQL, no browser automation, no lsof):
#   required files present · JSON validity · required tests · build ·
#   private-artifact staging check.
# It then PRINTS (does not run) the Class 2 SQL and Class 3 browser checklists.
#
# Exit code: 0 when all automated gates pass, non-zero otherwise.

set -euo pipefail

FAIL=0
fail() { echo "  [FAIL] $1"; FAIL=1; }
ok()   { echo "  [ok]   $1"; }
warn() { echo "  [warn] $1"; }
section() { echo; echo "==================================================================="; echo "== $1"; echo "==================================================================="; }

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

section "Repository"
echo "  root:   $ROOT"
echo "  branch: $(git branch --show-current 2>/dev/null || echo '(detached)')"
echo "  commit: $(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')"
echo "  status:"
git status --short 2>/dev/null | sed 's/^/    /' || true

# ---------------------------------------------------------------------------
# 1. Required files
# ---------------------------------------------------------------------------
section "Required files"

REQUIRED_DOCS=(
  "docs/pdf-import/phase-8-completion-checklist.md"
  "docs/pdf-import/phase-8-final-smoke-test.md"
  "docs/pdf-import/phase-9a-golden-corpus-orchestrator.md"
  "docs/pdf-import/phase-9b-operator-run-console.md"
  "docs/pdf-import/phase-9c-regression-history-baselines.md"
  "docs/pdf-import/phase-9d-automated-export-parity.md"
  "docs/pdf-import/phase-9e-ci-release-gates.md"
  "docs/pdf-import/phase-9e-release-checklist.md"
)
REQUIRED_SQL=(
  "scripts/regression/pdf-import-phase-8-final-check.sql"
  "scripts/regression/pdf-import-phase-9a-orchestrator-check.sql"
  "scripts/regression/pdf-import-phase-9b-console-check.sql"
  "scripts/regression/pdf-import-phase-9c-history-check.sql"
  "scripts/regression/pdf-import-phase-9d-export-parity-runner-check.sql"
  "scripts/regression/pdf-import-phase-9e-release-gate-check.sql"
)
REQUIRED_SRC=(
  "src/lib/reportTemplate/ingestion/goldenCorpus/goldenCorpusRegistry.ts"
  "src/lib/reportTemplate/ingestion/goldenCorpus/goldenCorpusOrchestrator.ts"
  "src/lib/reportTemplate/ingestion/goldenCorpus/goldenRunHistoryPersistence.ts"
  "src/lib/reportTemplate/ingestion/exportParity/exportParityRunner.ts"
  "src/lib/reportTemplate/ingestion/releaseGates/pdfImportReleaseGateEvaluator.ts"
  "src/pages/admin/PdfGoldenRegression.tsx"
)

for f in "${REQUIRED_DOCS[@]}" "${REQUIRED_SQL[@]}" "${REQUIRED_SRC[@]}"; do
  if [ -f "$f" ]; then ok "$f"; else fail "missing required file: $f"; fi
done

# ---------------------------------------------------------------------------
# 2. JSON validity
# ---------------------------------------------------------------------------
section "JSON validity"

JSON_FILES=(
  "docs/pdf-import/golden-corpus-registry.schema.json"
  "docs/pdf-import/golden-corpus-registry.template.json"
  "docs/pdf-import/golden-corpus-run.template.json"
)
if command -v node >/dev/null 2>&1; then
  for jf in "${JSON_FILES[@]}"; do
    if [ ! -f "$jf" ]; then
      fail "missing JSON file: $jf"
    elif node -e "JSON.parse(require('fs').readFileSync('$jf','utf8'));" >/dev/null 2>&1; then
      ok "valid JSON: $jf"
    else
      fail "invalid JSON: $jf"
    fi
  done
else
  warn "node not available; skipping JSON validation"
fi

# ---------------------------------------------------------------------------
# 3. Required tests
# ---------------------------------------------------------------------------
section "Required tests"

REQUIRED_TESTS=(
  "src/lib/reportTemplate/__tests__/goldenCorpusRegistry.spec.ts"
  "src/lib/reportTemplate/__tests__/goldenCorpusRunEvaluator.spec.ts"
  "src/lib/reportTemplate/__tests__/pdfImportQualityGateEvaluator.spec.ts"
  "src/lib/reportTemplate/__tests__/goldenRegressionSummary.spec.ts"
  "src/lib/reportTemplate/__tests__/goldenRegressionPersistence.spec.ts"
  "src/lib/reportTemplate/__tests__/pdfImportFailureTriageEvaluator.spec.ts"
  "src/lib/reportTemplate/__tests__/goldenCorpusImportSnapshot.spec.ts"
  "src/lib/reportTemplate/__tests__/goldenCorpusOrchestrator.spec.ts"
  "src/lib/reportTemplate/__tests__/goldenCorpusConsoleState.spec.ts"
  "src/lib/reportTemplate/__tests__/goldenRunHistorySummary.spec.ts"
  "src/lib/reportTemplate/__tests__/goldenRunHistoryPersistence.spec.ts"
  "src/lib/reportTemplate/__tests__/goldenRunBaselineComparison.spec.ts"
  "src/lib/reportTemplate/__tests__/exportParityScore.spec.ts"
  "src/lib/reportTemplate/__tests__/exportParityEvidence.spec.ts"
  "src/lib/reportTemplate/__tests__/exportParityRunner.spec.ts"
  "src/lib/reportTemplate/__tests__/pdfImportReleaseGateEvaluator.spec.ts"
)

PRESENT_TESTS=()
for t in "${REQUIRED_TESTS[@]}"; do
  if [ -f "$t" ]; then PRESENT_TESTS+=("$t"); else fail "missing required test: $t"; fi
done

if [ "${#PRESENT_TESTS[@]}" -gt 0 ]; then
  echo "  running ${#PRESENT_TESTS[@]} required test files..."
  if npm run test -- "${PRESENT_TESTS[@]}"; then
    ok "required tests passed"
  else
    fail "required tests failed"
  fi
fi

# ---------------------------------------------------------------------------
# 4. Optional tests (skip if missing)
# ---------------------------------------------------------------------------
section "Optional tests"

run_test_if_exists() {
  local file="$1"
  if [ -f "$file" ]; then
    if npm run test -- "$file"; then ok "optional passed: $file"; else fail "optional failed: $file"; fi
  else
    echo "  SKIP missing optional test: $file"
  fi
}

run_test_if_exists "src/lib/reportTemplate/__tests__/goldenRegressionDisplay.spec.ts"
run_test_if_exists "src/lib/reportTemplate/__tests__/pdfImportFailureTriageRules.spec.ts"

# ---------------------------------------------------------------------------
# 5. Build
# ---------------------------------------------------------------------------
section "Build"

if npm run build; then ok "npm run build passed"; else fail "npm run build failed"; fi

# ---------------------------------------------------------------------------
# 6. Private artifact staging check
# ---------------------------------------------------------------------------
section "Private artifact check"

FORBIDDEN_RE='(^|/)(audit-output/|dist/|node_modules/)|\.env$|\.pdf$|\.png$|\.jpe?g$|\.webp$|\.log$|supabase/config\.toml\.before-'

STAGED="$(git diff --cached --name-only 2>/dev/null || true)"
if [ -n "$STAGED" ] && echo "$STAGED" | grep -qE "$FORBIDDEN_RE"; then
  fail "forbidden files are staged:"
  echo "$STAGED" | grep -E "$FORBIDDEN_RE" | sed 's/^/      /'
else
  ok "no forbidden files staged"
fi

UNTRACKED="$(git ls-files --others --exclude-standard 2>/dev/null || true)"
if [ -n "$UNTRACKED" ] && echo "$UNTRACKED" | grep -qE "$FORBIDDEN_RE"; then
  warn "untracked private-looking files present (not staged — do not add):"
  echo "$UNTRACKED" | grep -E "$FORBIDDEN_RE" | sed 's/^/      /'
fi

# ---------------------------------------------------------------------------
# 7. Manual SQL checklist (NOT executed here)
# ---------------------------------------------------------------------------
section "Manual SQL checklist (run in Supabase SQL Editor)"
cat <<'SQLEOF'
  - scripts/regression/pdf-import-phase-8-final-check.sql
  - scripts/regression/pdf-import-phase-9a-orchestrator-check.sql
  - scripts/regression/pdf-import-phase-9b-console-check.sql
  - scripts/regression/pdf-import-phase-9c-history-check.sql
  - scripts/regression/pdf-import-phase-9d-export-parity-runner-check.sql
  - scripts/regression/pdf-import-phase-9e-release-gate-check.sql
SQLEOF

# ---------------------------------------------------------------------------
# 8. Manual browser checklist (NOT automated here)
# ---------------------------------------------------------------------------
section "Manual browser checklist"
cat <<'BROWSEREOF'
  - npm run preview -- --host 0.0.0.0 --port 8080
  - open /admin/pdf-golden-regression
  - open /admin/template-import-quality
  - run Evaluate Only
  - run Evaluate + Persist (only if safe)
  - verify export parity automation result (only if safe)
  - confirm no console errors
BROWSEREOF

# ---------------------------------------------------------------------------
# Result
# ---------------------------------------------------------------------------
section "Result"
if [ "$FAIL" -eq 0 ]; then
  echo "  Automated release gates: PASS (release_ready pending manual SQL/browser gates)"
  exit 0
else
  echo "  Automated release gates: FAIL (release_blocked)"
  exit 1
fi

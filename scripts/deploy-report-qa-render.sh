#!/usr/bin/env bash
set -euo pipefail

# Deploy the Report Q&A render route.
#
# `render-report-qa-pdf` is the only one of the seven migrated report formats
# whose function was never deployed, which is why "Typeset PDF (WeasyPrint)" in
# the Aurixa Intelligence Hub fails in the browser: an absent function is a 404
# from the Supabase gateway, and a gateway 404 carries no CORS headers, so the
# browser reports it as a network/CORS error rather than as "not found".
#
# Two steps, in this order — the route writes a row to `report_qa_renders`
# before it renders, so the table has to exist first.
#
#   1. supabase/migrations/20260820000000_report_qa_render_path.sql
#   2. the function itself
#
# The CLI resolves `../_shared/**` imports itself, which is why this is a CLI
# job and not an MCP one: the route pulls in 32 shared modules.

readonly EXPECTED_PROJECT_REF="dduzbchuswwbefdunfct"
readonly FUNCTION_NAME="render-report-qa-pdf"

fail() { printf 'Report Q&A render deployment refused: %s\n' "$*" >&2; exit 1; }

command -v supabase >/dev/null 2>&1 || fail "Supabase CLI is not installed"
[[ -n "${SUPABASE_ACCESS_TOKEN:-}" ]] || fail "SUPABASE_ACCESS_TOKEN is not present"
[[ -f "supabase/functions/${FUNCTION_NAME}/index.ts" ]] \
  || fail "run this from the repository root"

printf 'Migration state before mutation:\n'
supabase migration list --linked

# The migration is additive (one table, its indexes and an RLS policy) and is
# guarded with IF NOT EXISTS, but `CREATE POLICY` is not — so if the table was
# applied out-of-band, push will report it and this stops rather than guessing.
printf '\nApplying pending migrations.\n'
supabase db push --linked

printf '\nDeploying %s.\n' "$FUNCTION_NAME"
supabase functions deploy "$FUNCTION_NAME" --project-ref "$EXPECTED_PROJECT_REF"

printf '\nDeployed. Verify from the app: Aurixa Intelligence Hub → Export →\n'
printf 'Typeset PDF (WeasyPrint) → Structured report, on a conversation that\n'
printf 'has at least one exchange. The four raw exports are unaffected either way.\n'

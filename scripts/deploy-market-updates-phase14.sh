#!/usr/bin/env bash
set -euo pipefail

# Authorised Market Updates deployment entrypoint. It deliberately never prints
# credential values and refuses to deploy to a project other than the repository
# contract unless the script itself is reviewed and changed.
readonly EXPECTED_PROJECT_REF="dduzbchuswwbefdunfct"
readonly FUNCTIONS=(
  market-updates-ingest
  market-updates-digest
  market-updates-qa
  market-updates-source-admin
  market-updates-feed
  market-updates-status
  market-updates-archive
  market-news-archive-v2
)

fail() { printf 'Phase 14 deployment refused: %s\n' "$*" >&2; exit 1; }
command -v supabase >/dev/null 2>&1 || fail "Supabase CLI is not installed"
[[ -n "${SUPABASE_ACCESS_TOKEN:-}" ]] || fail "SUPABASE_ACCESS_TOKEN is not present"

linked_ref="$(node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('supabase/.temp/linked-project.json','utf8'));process.stdout.write(p.ref||'')")"
[[ "$linked_ref" == "$EXPECTED_PROJECT_REF" ]] || fail "linked project does not match the approved project"

printf 'Running repository release gate for project %s.\n' "$EXPECTED_PROJECT_REF"
npm run test:market-updates-phase13
npm run security:static
git diff --check

printf 'Inspecting linked migration state before mutation.\n'
supabase migration list --linked

if [[ "${MARKET_UPDATES_DEPLOY_CONFIRM:-}" != "DEPLOY_${EXPECTED_PROJECT_REF}" ]]; then
  fail "set MARKET_UPDATES_DEPLOY_CONFIRM=DEPLOY_${EXPECTED_PROJECT_REF} after reviewing migration output"
fi

printf 'Applying pending migrations to the approved linked project.\n'
supabase db push --linked --include-all

for function_name in "${FUNCTIONS[@]}"; do
  printf 'Deploying %s.\n' "$function_name"
  supabase functions deploy "$function_name" --project-ref "$EXPECTED_PROJECT_REF"
done

printf 'Post-deployment inventories (secret values are never requested).\n'
supabase migration list --linked
supabase functions list --project-ref "$EXPECTED_PROJECT_REF"
supabase secrets list --project-ref "$EXPECTED_PROJECT_REF"

cat <<'EOF'
Repository deployment completed. Production repair is NOT yet accepted.
An authorised operator must now execute and attach the Phase 14 live acceptance
sequence, including controlled ingestion, digest, grounded Q&A, RSS/ETag, RLS,
fallback, partial-failure and cron-history evidence.
EOF

# Generated Reports investment-library remediation

## Request-path audit and root cause

The audited path is `GeneratedReports.tsx` → `invokeSecureFunction` →
`get-investment-reports` → shared `verifyAuth` and module authorization → the
service-role PostgREST client → `public.investment_reports` → canonical package
grouping → library counters/cards.

The repository contract had two independently harmful defects:

1. the browser supplied an unrestricted projection containing
   `canonical_property_key`, while the deployed database can lag the committed
   migration. PostgREST therefore rejects the entire projection when that field is
   missing or absent from its schema cache; and
2. the page interpreted every rejected request as the initial empty array, while
   issuing the initial request twice and showing two possible failure toasts.

The linked project is `dduzbchuswwbefdunfct`. This environment did not provide a
Supabase CLI binary or an installable CLI package (`npm` returned HTTP 403), nor a
staff session/log API credential. Consequently the deployed log entry and its exact
PostgREST code/message could not be retrieved from this environment. The repaired
function explicitly maps the expected PostgreSQL `42703` and PostgREST `PGRST204`
schema-cache forms to `REPORT_SCHEMA_MISMATCH`, logs the complete server-side error
with a correlation ID, and exposes only the missing field in safe response details.
Deployment/live remediation must not be claimed until the checks below pass.

## Deployment and verification order

```bash
supabase link --project-ref dduzbchuswwbefdunfct
supabase migration list --linked
supabase db push --linked
supabase db query --linked "select canonical_property_key, count(*) from public.investment_reports group by 1 order by 2 desc;"
supabase functions deploy get-investment-reports --project-ref dduzbchuswwbefdunfct
supabase functions logs get-investment-reports --project-ref dduzbchuswwbefdunfct
```

After authenticating as a staff user with Generated Reports view permission, invoke
the function with `projection: "library"`, `page: 1`, and `pageSize: 50`. Confirm a
successful paginated response, no `report_content` in list rows, canonical keys on
existing identifiable rows, sibling variants in one package, and active/client-null
legacy behavior. Then deploy the frontend and verify active, filtered-empty, genuine
empty, archived, retry, stale-refresh, card/table, mobile, deep-link, and comparison
workflows in the browser network and console panels.

## Rollback

Revert the application/function commit and redeploy the prior Edge Function and
frontend. The migration is deliberately additive; do **not** drop or clear
`canonical_property_key` during application rollback. If the trigger itself must be
disabled during an incident, drop only
`set_investment_report_property_identity` and retain the column, index, functions,
backfilled values, report rows, payloads, versions, lineage, archives, timestamps,
scores, generator IDs, storage objects, and audit history.

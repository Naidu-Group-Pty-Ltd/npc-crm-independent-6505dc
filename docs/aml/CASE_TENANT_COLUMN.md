# The column that never existed

Read this before adding any `.select()` against `aml.cases`, and before
touching `_shared/aml/caseTenant.ts`.

## What was wrong

`aml.cases` has **no `tenant_id` column**. Thirty-seven columns, and never
that one. Eighteen call sites across five Edge Functions selected it anyway:

```ts
const { data: caseRow } = await admin.schema('aml').from('cases')
  .select('id, tenant_id, subject_display_name').eq('id', caseId).maybeSingle();
if (!caseRow) return jsonResponse({ error: 'Case not found' }, 404);
```

PostgREST answers `42703 column "tenant_id" does not exist`. The destructure
discards `error`. `data` is null. And the handler reports **"Case not
found"** about a case the operator has open in front of them.

Twelve of the eighteen failed exactly that way. Measured against production:

| | |
| --- | --- |
| `record_pep_determination` | 404 on every attempt — which is why `aml.pep_determinations` was **empty** from the day it was created, and why Stage 5's "Record PEP determination" appeared to do nothing at all |
| every ongoing-CDD op in `aml-monitoring` | unreachable; the workspace rendered it as *"Partial reading — monitoring summary could not be read"* |
| `hasCaseAccess` in `aml-verification` | returned false for every caller on every case, making the documentary evidence route permanently 403 behind an enabled button |

That last one had already been found and fixed **in place**, with a comment
recording what it cost. The other seventeen were left, and the helper it
called still issued the failing query on every request — falling through a
`||` to the default, which is not a fallback but a fault with a cushion.

## Why it survived

The select is valid TypeScript. The failure is a string a server returns at
runtime. And the discarded `error` turns a query that *cannot run* into a
plausible statement about the data.

It is the same shape as two defects this platform has already paid for: the
`sync_id` projection in the sanctions loader (`42703` again, reported as a
failed load) and the interpolated `.or()` claim predicate in the screening
consumer (never parsed, reported as losing a race). In each case a broken
query wore an outcome's clothes.

## The rules

**Never name a column the table does not have.** `readCase()` in
`_shared/aml/caseTenant.ts` **throws** if `columns` mentions `tenant_id` —
where a developer sees it, rather than producing a 42703 at the server and a
"Case not found" at the operator. `caseTenantColumn.contract.test.ts` scans
every Edge Function and fails on any `.select()` against `aml.cases` that
names it.

**A read that FAILED is not a row that is ABSENT.** They need different
answers: a missing case is `404` and final, a failed read is `503` and worth
retrying. `CaseRead` carries `failed` separately from `row` precisely so a
caller cannot collapse them.

**The tenant is a property of the deployment.** Every `tenant_id` in the
`aml` schema — role assignments, screening scopes, party subjects,
perimeters — is `default`, which is exactly why `aml.cases` has no such
column. `DEFAULT_AML_TENANT` and `tenantForCase()` are the one place that
knows it, so introducing a real per-case tenant is one edit rather than
eighteen. Authorisation is unchanged: the tenant-scoped AML role RPCs remain
the only thing that can grant access.

## An identifier that does not exist is never type debt

`defer_pep_determination` called `appendCaseEvent`. The function in that file
is `appendEvent`. It reached production, and the operator saw *"the server
refused it"* with nothing to act on.

The module **loads**, so this is not a boot failure — which is what makes it
worse than one. A boot failure is total and obvious; this ships a function
that serves every other operation perfectly and throws a `ReferenceError` on
one branch, discovered only when somebody exercises it.

`check-edge-functions.mjs` ratchets on error **counts** per file, and a count
can absorb a swapped-in defect — one goes, one arrives, the number holds. So
`TS2304`/`TS2552` are now **fatal and never baselineable**, alongside the
load-fatal codes. The occurrences that already existed are frozen in
`supabase/functions-registry/edge-missing-names.txt`, keyed by **file and
identifier** rather than by line: a line number moves with every edit above
it, so a positional key would either churn or silently start covering a
different defect.

Every line in that file is a live defect on some code path, several of them
in authorisation helpers, and each belongs to the programme that owns that
function. Shortening the list is always an improvement. `EdgeRuntime` is the
one exception and is not debt — it is a real Supabase Edge Runtime global
that Deno's declarations do not describe.

**The gate would have caught the original.** It ran, and it works: with the
fix reverted it reports a new error in a previously-clean file. It did not
block the merge because the pull request was merged before the check
finished.

## Where the tests are

| | |
| --- | --- |
| no Edge Function selects the column; failed ≠ absent | `src/lib/aml/caseTenantColumn.contract.test.ts` |
| the monitoring ops authorise through the resolver | `src/lib/aml/amlPortalContracts.test.ts` |
| the PEP determination stamps the resolved tenant | `src/lib/aml/amlScreeningRepair.contract.test.ts` |

# What the prime keeps for itself

Some of this repository belongs to the prime deployment alone and never reaches
a clone. Today that is one feature, the **GoHighLevel account migration**. Read
this before you touch any of its files or functions, add a reference to them
from anywhere else, change the migration route in `src/App.tsx`, or reconcile a
clone's `App.tsx`.

## The feature, and the decision

The account migration was built on the prime after a security breach, to move
the house's own data between two GoHighLevel accounts. It is an operation on the
prime's own accounts, not a product feature. No clone has those accounts or that
incident. The owner decided on 27 Sep 2026 that **no clone receives it, existing
or new**. Measured on prime@387feb03, it is:

| Part | What |
|---|---|
| Edge Functions | 28: `migration-dispatcher`, `migration-orchestrator`, `migration-job-control`, `migration-job-status`, `migration-upload-source`, the twelve `ghl-migrate-*` functions, the `ghl-legacy-*` and `ghl-marketing-*` functions, `ghl-account-preview`, `ghl-test-credentials`, `ghl-workflow-visualizer` and `backfill-opportunity-mappings` |
| Shared modules | `_shared/migration-jobs.ts`, `_shared/ghl-worker-fetch.ts`, `_shared/ghl-asset-harvester.ts`, imported only by the feature's own functions |
| UI | `src/pages/admin/GhlMigration.tsx` and six components in `src/components/admin/` |
| Cron | `migration-dispatcher-15s`, which calls `migration-dispatcher` every fifteen seconds |
| Storage | the `ghl-marketing-dump` bucket |

The complete list is **`scripts/lib/primeOnlyFeatures.mjs`**, and that file is the
authority. The table above is a summary of it.

## What travels to a clone anyway, and why

- **The schema and the migrations.** The feature's tables (`migration_jobs`,
  `migration_job_items`, `migration_uploaded_sources`, `ghl_id_mapping`,
  `legacy_wipe_jobs` and their siblings), its SQL functions, and the migrations
  that create them all reach every clone. Withholding a migration leaves a hole
  in the ledger, and `partitionByDependency` treats a hole as a barrier: every
  later migration would be held behind it. The tables sit empty on a clone.
- **The bucket.** `20260507171554` creates `ghl-marketing-dump` in the same file
  as the tables, so every clone holds it, private and empty. It is left exactly
  as it is and never deleted.
- **The cron job.** Seven migrations schedule the dispatcher, the last being
  `20260725000000_fix_migration_dispatcher_cron_auth.sql`, which schedules
  `migration-dispatcher-15s`. A clone's replay schedules it too, and Mission
  Control unschedules it again (below).
- **The register itself.** `scripts/**` is a repository invariant of every
  cascade, including the one clone whose scope is `modules`, so each clone's own
  checks know what it does not hold.

## The rules in this repository

`src/lib/__tests__/primeOnlyFeatures.spec.ts` holds three, and CI runs it by
name (a spec in `src/lib/__tests__/` is otherwise never run).

1. **Nothing a clone receives imports the feature.** A clone builds without the
   feature's files, so a static import of one breaks every clone's build the
   moment it is carried there. The prime's own build, where the file is present,
   can never see that. The spec parses every source file under `src`,
   `supabase/functions`, `scripts`, `tests` and `tests-e2e` and refuses any
   import, re-export, `import()` or `require()` that reaches a registered file or
   a registered function's directory. The one allowed form is `import.meta.glob`,
   which answers an empty record for a missing file.
2. **Nothing a clone receives invokes the feature's functions by name.** No clone
   holds them, so an invocation there answers 404, and no build or type check can
   see that either. Any string in `src` or `supabase/functions` that names one
   (`functions.invoke('migration-orchestrator')`, or a `/functions/v1/…` URL) is
   refused. A comment is not a string, and comments naming the workers already
   exist in the ordinary GoHighLevel conversation modules.
3. **On the prime, the register describes something real.** Every file and
   function it names is here, every jobname glob matches a job the migrations
   schedule, and every bucket is one a migration creates. A register naming
   nothing is a hold with no subject.

Rules 1 and 2 are strict on the prime, which is where new code is written and
where a mistake is carried from. On a clone they apply only to what the clone
does **not** hold (the next section explains why). Rule 3 stands down on a clone,
because there the register describes a tree the clone was never given.
`TREE_IS_PRIME` (`src/lib/testSupport/primeTree.ts`) decides which kind of tree a
run is in.

Two existing checks read the register:

- **`scripts/security/check-cron-caller-names.mjs`** fails on a scheduled job
  whose target function is not in the repository. A clone that has shed the
  feature still schedules `migration-dispatcher-15s` (the migrations travel), so
  a registered target that is absent is reported and passed. On the prime, rule 3
  keeps the exemption from hiding a function that went missing there.
- **`src/lib/__tests__/houseLabelsGuard.spec.ts`** skips the feature's files. A
  file no clone holds can never name the house to a clone. The two entries it
  used to record for `GhlMarketingRawDump.tsx` are gone for that reason.

## `src/App.tsx`, and why a clone's copy is reconciled by hand

The migration route is the one place outside the feature that reaches into it:

```tsx
const ghlMigrationPage = import.meta.glob<{ default: () => ReactElement }>('./pages/admin/GhlMigration.tsx');
const loadGhlMigration = ghlMigrationPage['./pages/admin/GhlMigration.tsx'];
const GhlMigration = loadGhlMigration ? lazyWithRetry(loadGhlMigration) : null;
// …
{GhlMigration && <Route path="integrations/ghl-migration" element={<InternalToolingGuard><GhlMigration /></InternalToolingGuard>} />}
```

Where the page exists the route renders exactly as before, still behind
`InternalToolingGuard`. Where it does not, the glob is empty, `GhlMigration` is
`null`, and React Router ignores the non-element child, so the tree builds and
the route simply does not exist.

Mission Control cascades `App.tsx` as **`manual_reconcile`**
(`DEFAULT_MIRROR_EXCLUSIONS`): a clone's copy is never overwritten, because each
clone keeps its own routing decisions. Three things follow.

- The glob form reaches a clone only when somebody reconciles that clone's
  `App.tsx` by hand. Each clone's removal pull request does it in the same change
  that deletes the feature's files.
- Until then, a clone carries the prime's earlier static import together with the
  page it imports. That is harmless, because the file is there. The spec is
  therefore lenient on a clone about anything the clone still holds, or every
  cascade pull request would go red until somebody reconciled the file.
- `primeDeployment.spec.ts` asserts the glob form on the prime only, and asserts
  the guard wherever the page exists.

## Mission Control's half

The cascade, provisioning and parity live in `aurixa-mission-control`, which
keeps **its own copy of the list** in `src/server/primeOnlyFeatures.pure.ts`.
Neither repository can read the other's source, so the list is a literal at each
end, like `BACKEND_DEPLOYED_BY`. A feature added to one must be added to the
other. Mission Control (#301):

- holds every cascade write to a registered path as `protected`, whatever a
  clone's own rules say;
- recomposes the files generated from the function set without the feature:
  `supabase/config.toml`, the security registry and inventory, the function-count
  ratchet in `auditRemediation.spec.ts` and `mobile/api-surface.json`;
- never deploys the feature's functions, never creates, reconfigures or copies
  into its bucket, and never schedules its cron;
- unschedules `migration-dispatcher*` from a clone after any migration pass that
  sent it something, and at the end of every provisioning cron step. It removes
  only what the register names, never on the prime, and never throws;
- plans no backend catch-up for a cascade that touched only the feature;
- reports the feature on its own line in parity, as withheld by policy (or still
  present, before a clone's removal), never as missing or extra.

## Removing the feature from a clone that already holds it

The order matters.

1. **Mission Control #301 is merged and deployed on Lovable first.** Otherwise
   the next cascade pass writes the 28 functions straight back.
2. **The clone's removal pull request** deletes the feature's files and function
   directories and reconciles `App.tsx` to the glob form above. Mission Control's
   pumps then recompose the generated files on the next cascade. The CRM
   (`sync_scope: modules`) is the same change against its own module set.
3. **Undeploying the 28 functions** from the clone's Supabase project is a
   separate, destructive step, taken only with the owner's approval. Nothing
   above deletes a deployed function, a table, a row or the bucket.

## Adding another prime-only feature

1. Add it to `scripts/lib/primeOnlyFeatures.mjs` **and** to Mission Control's
   `src/server/primeOnlyFeatures.pure.ts`, with the same key.
2. Run `npx vitest run src/lib/__tests__/primeOnlyFeatures.spec.ts` on the prime.
   Rule 3 fails if the register names something the prime does not hold, and
   rules 1 and 2 fail if anything outside the feature reaches into it.
3. Reach any page it adds through `import.meta.glob`, as `App.tsx` does above.

/**
 * The features that exist on the prime and nowhere else.
 *
 * The prime carries a GoHighLevel ACCOUNT MIGRATION: twenty-eight Edge
 * Functions, a dispatcher scheduled every fifteen seconds, a storage bucket of
 * raw marketing exports and an admin page. It was built here after a security
 * breach, to move the house's own data between two GoHighLevel accounts. It is
 * an operation on the prime's own accounts rather than a product feature, and
 * no clone receives it or needs it (the owner's decision, 27 Sep 2026).
 *
 * Aurixa Mission Control withholds it by CLASS rather than by per-clone
 * exclusion rows: the cascade never writes its files to a clone, provisioning
 * never deploys its functions, schedules its cron or creates its bucket, the
 * files generated from the function set are recomposed without it, and parity
 * never counts its absence. Mission Control's register is
 * `src/server/primeOnlyFeatures.pure.ts` in aurixa-mission-control. This file
 * is the same list for the checks that run in THIS repository. Neither
 * repository can read the other's source, so the list is a literal at each
 * end, like `BACKEND_DEPLOYED_BY`: a feature added to one is added to the
 * other.
 *
 * This file travels to every clone — `scripts/**` is a repository invariant of
 * every cascade, including the one clone whose scope is `modules` — so a
 * clone's own checks know what it does not hold, and why. What reads it:
 *
 *   - `scripts/security/check-cron-caller-names.mjs`. A migration still
 *     schedules the dispatcher on every clone, because the feature's schema
 *     and its migrations travel (a withheld migration is a ledger hole, and
 *     `partitionByDependency` treats a hole as a barrier). The function it
 *     calls does not travel, and Mission Control unschedules the job after
 *     every apply that sends a clone anything.
 *   - `src/lib/__tests__/houseLabelsGuard.spec.ts`. A file no clone holds can
 *     never name the house to a clone.
 *   - `src/lib/__tests__/primeOnlyFeatures.spec.ts`. What the register says is
 *     true of the prime's tree, and nothing a clone keeps reaches for what it
 *     does not hold.
 *   - `src/lib/__tests__/primeDeployment.spec.ts`. The migration page is found
 *     through `import.meta.glob`, and guarded wherever it is present.
 *
 * `docs/operations/PRIME_ONLY_FEATURES.md` is the whole account: what
 * travels anyway, why a clone's `App.tsx` is reconciled by hand, Mission
 * Control's half, and the order a clone's removal has to go in.
 *
 * What is deliberately NOT here:
 *
 *   - The ordinary GoHighLevel integration: `_shared/ghl-account.ts`,
 *     `_shared/ghl-rate-limiter.ts`, the calendar, webhook and conversation
 *     functions, the `sync-ghl-*` jobs and the Integrations card. Matching is
 *     by exact file and by function DIRECTORY, so `ghl-calendar` and a future
 *     `migration-dispatcher-v2` are not caught.
 *   - The feature's SCHEMA: eleven tables, their SQL functions, the migrations
 *     that create them, and the `ghl-marketing-dump` bucket that
 *     `20260507171554` creates in the same file as the tables. A clone holds
 *     those, empty, and nothing here deletes them.
 *
 * Measured on prime@387feb03: each function directory holds only `index.ts`,
 * and the only file outside the set that reaches into it is `src/App.tsx`,
 * which loads the page through `import.meta.glob` so that a tree without the
 * page still builds.
 *
 * Pure: no filesystem, no network. The checks and the specs import it
 * directly, and `primeOnlyFeatures.d.mts` types it for the specs.
 */

/** @type {ReadonlyArray<import('./primeOnlyFeatures.d.mts').PrimeOnlyFeature>} */
export const PRIME_ONLY_FEATURES = Object.freeze([
  Object.freeze({
    key: 'ghl-account-migration',
    title: 'GoHighLevel account migration',
    reason: "Prime-only: the GoHighLevel account migration is the house's own incident tooling and never reaches a clone.",
    files: Object.freeze([
      'docs/GHL_MIGRATION_CASCADE_INVESTIGATION_2026-04-25.md',
      'src/pages/admin/GhlMigration.tsx',
      'src/components/admin/GhlMarketingRawDump.tsx',
      'src/components/admin/GhlWorkflowVisualizer.tsx',
      'src/components/admin/LegacyAccountKillSwitch.tsx',
      'src/components/admin/MigrationAdvancedOptions.tsx',
      'src/components/admin/MigrationSourceUploader.tsx',
      'src/components/admin/WorkflowBlueprintEditor.tsx',
      'supabase/functions/_shared/ghl-asset-harvester.ts',
      'supabase/functions/_shared/ghl-worker-fetch.ts',
      'supabase/functions/_shared/migration-jobs.ts',
    ]),
    functions: Object.freeze([
      'backfill-opportunity-mappings',
      'ghl-account-preview',
      'ghl-legacy-backfill-gaps',
      'ghl-legacy-wipe-orchestrator',
      'ghl-legacy-wipe-worker',
      'ghl-marketing-dump-enqueue',
      'ghl-marketing-dump-export',
      'ghl-marketing-dump-worker',
      'ghl-marketing-raw-dump',
      'ghl-migrate-bookings-worker',
      'ghl-migrate-calendar-groups-worker',
      'ghl-migrate-calendars-worker',
      'ghl-migrate-contacts-worker',
      'ghl-migrate-conversations-replay-worker',
      'ghl-migrate-conversations-reset-phantoms',
      'ghl-migrate-conversations-worker',
      'ghl-migrate-notes-worker',
      'ghl-migrate-opportunities-worker',
      'ghl-migrate-workflow-enrollments-worker',
      'ghl-migrate-workflow-reenroll-worker',
      'ghl-migrate-workflows-snapshot-worker',
      'ghl-test-credentials',
      'ghl-workflow-visualizer',
      'migration-dispatcher',
      'migration-job-control',
      'migration-job-status',
      'migration-orchestrator',
      'migration-upload-source',
    ]),
    cronJobs: Object.freeze(['migration-dispatcher*']),
    buckets: Object.freeze(['ghl-marketing-dump']),
  }),
]);

const FUNCTIONS_PREFIX = 'supabase/functions/';

const byFile = new Map();
const byFunction = new Map();
const byBucket = new Map();
const cronRules = [];
for (const feature of PRIME_ONLY_FEATURES) {
  for (const file of feature.files) byFile.set(file, feature);
  for (const fn of feature.functions) byFunction.set(fn, feature);
  for (const bucket of feature.buckets) byBucket.set(bucket, feature);
  for (const glob of feature.cronJobs) cronRules.push({ rx: globToRegex(glob), feature });
}

/** A jobname glob as an anchored expression: `*` is any run, everything else is literal. */
function globToRegex(glob) {
  const body = glob
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}$`);
}

/** The function a repository path belongs to, when it sits inside a function's own directory. */
export function functionDirectoryOf(path) {
  if (typeof path !== 'string' || !path.startsWith(FUNCTIONS_PREFIX)) return null;
  const rest = path.slice(FUNCTIONS_PREFIX.length);
  const slash = rest.indexOf('/');
  // A trailing slash is required: `supabase/functions/<name>` alone is not a file in it.
  if (slash <= 0) return null;
  return rest.slice(0, slash);
}

/** The prime-only feature a repository path belongs to, or null. */
export function primeOnlyFeatureForPath(path) {
  const exact = byFile.get(path);
  if (exact) return exact;
  const fn = functionDirectoryOf(path);
  return fn ? (byFunction.get(fn) ?? null) : null;
}

export function isPrimeOnlyPath(path) {
  return primeOnlyFeatureForPath(path) !== null;
}

/** Every function the prime keeps for itself. */
export function primeOnlyFunctionNames() {
  return new Set(byFunction.keys());
}

export function isPrimeOnlyFunction(name) {
  return typeof name === 'string' && byFunction.has(name.trim());
}

/** Every file the prime keeps for itself, outside a function's own directory. */
export function primeOnlyFileNames() {
  return new Set(byFile.keys());
}

export function isPrimeOnlyBucket(id) {
  return typeof id === 'string' && byBucket.has(id.trim());
}

/** True when a pg_cron jobname belongs to a prime-only feature by its name alone. */
export function isPrimeOnlyCronJobName(jobname) {
  if (typeof jobname !== 'string' || jobname.trim() === '') return false;
  return cronRules.some((rule) => rule.rx.test(jobname.trim()));
}

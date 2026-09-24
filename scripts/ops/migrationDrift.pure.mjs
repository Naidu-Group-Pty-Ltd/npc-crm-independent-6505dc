/**
 * Which merged migrations have not reached the database — asserted by EFFECT.
 *
 * ## Why the ledger cannot answer this
 *
 * `supabase_migrations.schema_migrations` under-reports here by roughly two
 * orders of magnitude, which `apply-migration.yml`'s header measured on
 * 2026-08-13: the ledger called 133 files pending while all but one family of
 * the objects they declare already existed. Re-measured 21 Sep 2026: **832 of
 * 1,008 repo migrations carry no ledger row**, because migrations have been
 * applied through routes that record nothing.
 *
 * So "in the repo and not in the ledger" is not a backlog — it is noise with a
 * handful of real entries buried in it, and a report that prints 832 rows is a
 * report nobody reads. That is the whole reason a merged migration could sit
 * unapplied without anything saying so.
 *
 * This module answers the question the ledger cannot: **did the thing the
 * migration does actually happen?** It is the rule the retention purge, the
 * verification self-test and the urban-centre register already answer to —
 * asserted by effect, never by configuration.
 *
 * ## The three verdicts, and why the third one exists
 *
 * - `effect_present` — every object the file CREATEs exists. The ledger is
 *   simply behind; nothing is owed.
 * - `not_applied` — the file declares objects and at least one is missing.
 *   This is the real backlog.
 * - `unverifiable` — the file creates no object and declares no probe, so
 *   nothing here can tell. It is REPORTED rather than passed, because the
 *   defect this module was written for is exactly that shape: seed v18 renames
 *   the assessment table's heading with an INSERT, it merged to `main`, it
 *   never landed, and the document kept printing "Five dimensions, weighted"
 *   over three rows with nothing anywhere saying why.
 *
 * A file closes that last gap by stating its own effect in one line:
 *
 *     -- @effect: select 1 from public.template_library_entries where version = 18
 *
 * ## Two more verdicts, for files declared withdrawn
 *
 * - `withdrawn` — `MIGRATION_WITHDRAWN.json` declares the file deliberately
 *   absent, and every object it names as absent is absent. Not a backlog.
 * - `contradicted` — one of those objects exists, so the declaration is false.
 *   It fails the run the way NOT APPLIED does: in both cases the repository
 *   and the database disagree.
 *
 * ## What this module does not do
 *
 * It does not decide what to apply, and it must never grow that. The apply
 * path is one file per dispatch by human judgement, deliberately: `db push`
 * trusts the ledger, and trusting a ledger that under-reports by 832 would
 * replay data mutations where a second application is not a no-op. This
 * reports; a person decides.
 *
 * Pure: the database facts are passed in, so the credential stays in the
 * workflow and this stays testable.
 */

/** @typedef {'effect_present'|'not_applied'|'unverifiable'|'withdrawn'|'contradicted'} DriftVerdict */

/**
 * @param {object} args
 * @param {ReadonlyArray<{version: string, file: string, objects: ReadonlyArray<string>, probe: string|null}>} args.migrations
 *   Every migration in the repo, with the objects it creates and any `@effect`
 *   probe it declares.
 * @param {ReadonlySet<string>|ReadonlyArray<string>} args.appliedVersions
 *   Versions carrying a `schema_migrations` row.
 * @param {ReadonlySet<string>|ReadonlyArray<string>} args.existingObjects
 *   `"<class>:<qualified name>"` for every object the database actually holds.
 * @param {ReadonlyMap<string, boolean>|undefined} [args.probeResults]
 *   For each file that declared a probe, whether it was satisfied.
 * @param {ReadonlyMap<string, {absent: ReadonlyArray<string>}>|undefined} [args.withdrawn]
 *   Files `MIGRATION_WITHDRAWN.json` declares deliberately absent, by name.
 */
export function assessMigrationDrift({
  migrations,
  appliedVersions,
  existingObjects,
  probeResults = new Map(),
  withdrawn = new Map(),
}) {
  const applied = appliedVersions instanceof Set ? appliedVersions : new Set(appliedVersions ?? []);
  const present = existingObjects instanceof Set ? existingObjects : new Set(existingObjects ?? []);
  const probes = probeResults instanceof Map ? probeResults : new Map(Object.entries(probeResults ?? {}));
  const declared = withdrawn instanceof Map ? withdrawn : new Map(Object.entries(withdrawn ?? {}));

  const rows = [];
  for (const m of migrations ?? []) {
    /*
     * A withdrawn file is judged before the ledger is consulted, and by its
     * declaration alone. Its version can be recorded for a reason that says
     * nothing about it: `20260724000000` is shared with another file, and
     * recording that sibling would otherwise let a withdrawn index come back
     * with nothing reporting it. The declaration is a claim about the
     * database, so it is checked against the database on every run.
     */
    const withdrawal = declared.get(m.file);
    if (withdrawal) {
      const found = (withdrawal.absent ?? []).filter((o) => present.has(o));
      rows.push({
        ...m,
        verdict: found.length === 0 ? 'withdrawn' : 'contradicted',
        why: found.length === 0
          ? 'declared withdrawn in MIGRATION_WITHDRAWN.json, and what it would create is absent'
          : `declared withdrawn in MIGRATION_WITHDRAWN.json, but ${found.length} object(s) it declares absent exist`,
        missing: [],
        present: found,
      });
      continue;
    }

    if (applied.has(m.version)) continue;

    // A probe is the author's own statement of what is true once this ran, and
    // it outranks object counting: a file may both create an object and seed
    // rows, and the rows are the part object existence cannot see.
    if (m.probe) {
      const satisfied = probes.get(m.file);
      rows.push({
        ...m,
        verdict: satisfied === true ? 'effect_present' : 'not_applied',
        why: satisfied === true
          ? 'its declared @effect probe is satisfied'
          : satisfied === false
            ? 'its declared @effect probe is NOT satisfied'
            : 'its @effect probe was not run',
        missing: [],
      });
      continue;
    }

    const objects = m.objects ?? [];
    if (objects.length === 0) {
      rows.push({
        ...m,
        verdict: 'unverifiable',
        why: 'it creates no object and declares no @effect probe',
        missing: [],
      });
      continue;
    }

    const missing = objects.filter((o) => !present.has(o));
    rows.push({
      ...m,
      verdict: missing.length === 0 ? 'effect_present' : 'not_applied',
      why: missing.length === 0
        ? `all ${objects.length} object(s) it creates exist`
        : `${missing.length} of ${objects.length} object(s) it creates are absent`,
      missing,
    });
  }

  const by = (v) => rows.filter((r) => r.verdict === v);
  return {
    rows,
    notApplied: by('not_applied'),
    unverifiable: by('unverifiable'),
    effectPresent: by('effect_present'),
    withdrawn: by('withdrawn'),
    contradicted: by('contradicted'),
  };
}

/**
 * Is a declared probe safe to run?
 *
 * The probe is read from a file in the repository and handed to a database
 * connection that can write, so it is constrained rather than trusted: one
 * statement, opening with SELECT, no semicolon, and none of the words that
 * change anything. A file that states something else is refused and reported,
 * never executed and never quietly skipped.
 */
export function probeIsReadOnly(sql) {
  const s = String(sql ?? '').trim();
  if (!s) return false;
  if (s.includes(';')) return false;
  if (!/^select\b/i.test(s)) return false;
  return !/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|do|call)\b/i.test(s);
}

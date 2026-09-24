/**
 * Migrations whose effect is deliberately absent: the one reading of
 * `supabase/migrations/MIGRATION_WITHDRAWN.json`.
 *
 * ## Why a declaration and not a deletion
 *
 * Three files in this directory will never be applied, and each is correct to
 * leave alone: one was withdrawn at the owner's direction, and two were
 * superseded by later files whose work they would undo. Deleting them is not
 * available, because an applied migration's bytes are what
 * `applied-body-digests.txt` protects and a deleted file is a gap in the
 * record of what ran. Editing them is not available for the same reason.
 *
 * Left undeclared, each one does damage somewhere else. `migration-drift`
 * has reported all three as NOT APPLIED every night since 21 Sep 2026, so the
 * job is red for a reason nobody intends to act on. That is how a red check
 * stops meaning anything. And Mission Control counts each one as a hole on
 * every clone, which holds back every large file sorted after it. Measured
 * 23 Sep 2026: the withdrawn AML file held template seeds v16 to v18 back from
 * `npc-test-76b3b3` and `preflight-property-group`.
 *
 * ## What an entry asserts
 *
 * That every object in `absent` is absent. It is a claim about the database,
 * not only about intent, so it is asserted by effect like everything else
 * here: `migration-drift` checks it on every run and fails when a listed
 * object exists, because the declaration is then false.
 *
 * `migration-drift` and `check-migration-withdrawals.mjs` both read the file
 * through this module, so what the report accepts and what the gate enforces
 * cannot drift into two standards. Mission Control reads the same JSON from
 * the prime and needs only each entry's `file`.
 *
 * Pure: no filesystem, no database. The callers pass what they read.
 */

export const WITHDRAWALS_PATH = 'supabase/migrations/MIGRATION_WITHDRAWN.json';

const VERSIONED = /^(\d{14})_.+\.sql$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse the manifest text. Never throws on content: a malformed manifest is a
 * finding for the gate to report, not a crash that hides the rest.
 *
 * @param {string} text
 * @returns {{ entries: Array<{file: string, absent: string[], decided: string, reason: string,
 *   withdrawn_by?: string, superseded_by?: string, evidence?: string}>, errors: string[] }}
 */
export function parseWithdrawals(text) {
  let doc;
  try {
    doc = JSON.parse(String(text ?? ''));
  } catch (e) {
    return { entries: [], errors: [`not valid JSON: ${e.message}`] };
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { entries: [], errors: ['the manifest must be a JSON object'] };
  }
  if (doc.schema_version !== 1) {
    return { entries: [], errors: [`unknown schema_version ${JSON.stringify(doc.schema_version)}; this reader knows 1`] };
  }
  if (!Array.isArray(doc.withdrawn)) {
    return { entries: [], errors: ['"withdrawn" must be an array'] };
  }
  return { entries: doc.withdrawn, errors: [] };
}

/**
 * Check every entry against the repository.
 *
 * @param {ReadonlyArray<any>} entries
 * @param {object} repo
 * @param {ReadonlySet<string>|ReadonlyArray<string>} repo.files every migration file name
 * @param {(file: string) => ReadonlyArray<string>} repo.objectsOf the objects a file creates,
 *   in the drift report's spelling (`objectsCreatedIn` over the comment-free SQL)
 * @returns {string[]} one message per fault; empty when the manifest is sound
 */
export function validateWithdrawals(entries, { files, objectsOf }) {
  const errors = [];
  const known = files instanceof Set ? files : new Set(files ?? []);
  const seen = new Set();
  let previous = '';

  for (const [i, e] of (entries ?? []).entries()) {
    const at = `withdrawn[${i}]`;
    if (!e || typeof e !== 'object') {
      errors.push(`${at}: not an object`);
      continue;
    }
    const file = String(e.file ?? '');
    if (!VERSIONED.test(file)) {
      errors.push(`${at}: "${file}" is not a migration file name`);
      continue;
    }
    if (seen.has(file)) errors.push(`${file}: listed twice`);
    seen.add(file);
    if (file < previous) errors.push(`${file}: entries must be in file order; it sorts before ${previous}`);
    previous = file;

    if (!known.has(file)) {
      errors.push(`${file}: no such migration. A withdrawal names a file that stays in the tree as history.`);
      continue;
    }

    const absent = Array.isArray(e.absent) ? e.absent.map(String) : null;
    if (!absent || absent.length === 0) {
      errors.push(`${file}: "absent" must name at least one object the file creates. `
        + 'Without one, nothing can ever show the declaration to be false.');
    } else {
      const creates = new Set(objectsOf(file) ?? []);
      for (const o of absent) {
        if (!creates.has(o)) {
          errors.push(`${file}: "${o}" is not an object this file creates `
            + `(it creates: ${[...creates].join(', ') || 'nothing nameable'}).`);
        }
      }
    }

    if (!DAY.test(String(e.decided ?? ''))) errors.push(`${file}: "decided" must be a YYYY-MM-DD date`);
    if (String(e.reason ?? '').trim().length < 40) {
      errors.push(`${file}: "reason" must say why, in a sentence a reviewer can check`);
    }

    for (const key of ['withdrawn_by', 'superseded_by']) {
      if (e[key] === undefined) continue;
      const successor = String(e[key]);
      if (!known.has(successor)) errors.push(`${file}: ${key} names "${successor}", which does not exist`);
      else if (successor <= file) errors.push(`${file}: ${key} "${successor}" must run after the file it replaces`);
    }
  }
  return errors;
}

/**
 * The drift verdict for one listed file: `withdrawn` while every object it
 * declares absent is absent, `contradicted` the moment one exists.
 *
 * @param {{absent: ReadonlyArray<string>}} entry
 * @param {ReadonlySet<string>} existingObjects
 */
export function assessWithdrawal(entry, existingObjects) {
  const present = (entry?.absent ?? []).filter((o) => existingObjects.has(o));
  return present.length === 0
    ? { verdict: 'withdrawn', present }
    : { verdict: 'contradicted', present };
}

/** file -> entry, for callers that only need to look one up. */
export function withdrawalsByFile(entries) {
  return new Map((entries ?? []).filter((e) => e && e.file).map((e) => [String(e.file), e]));
}

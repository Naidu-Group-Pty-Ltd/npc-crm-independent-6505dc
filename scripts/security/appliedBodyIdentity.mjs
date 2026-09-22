// The one rule that decides whether the prime has already RUN a migration's
// bytes — shared by the guard that judges the manifest and the generator that
// writes it, so the two cannot come to disagree.
//
// It is a transcription of Mission Control's `migrationBodyIdentity.pure.ts`,
// which is what the cascade itself runs on. Transcribed rather than imported
// because that module lives in another repository and this check must run on
// every pull request with no network and no dependency on it.
//
// Two copies of one rule is how the two come to disagree, so the PROPERTIES
// the rule turns on — the four-case proof below, the dropped empty rung, the
// idempotence the proof rests on — are pinned by
// `src/lib/deploy/__tests__/appliedBodyDigests.spec.ts` here and by
// `migrationBodyIdentity.pure.test.ts` there. Neither repository imports the
// other. If a future edit widens or narrows one copy, the symptom is that
// Mission Control's reading of the fleet and this manifest describe different
// corpora; that is where to look.
//
// ## The rule
//
// A migration has been applied when the prime's ledger holds a body whose
// EXECUTABLE bytes are exactly its own. Bytes that cannot execute — trailing
// whitespace, a leading comment block — may differ, and nothing else may.
//
// ## Why over-normalising cannot promote anything
//
// Each rung removes only bytes that do not execute, so two bodies colliding
// anywhere on the ladder have identical executable bytes, for all inputs:
//
//   - rung 3 ≡ rung 3 — both are `executableBody`, equal by definition.
//   - rung 1 or 2 ≡ rung 3 — the left side EQUALS some body's executable form,
//     so its first line is neither blank nor a comment, so stripping again is
//     a no-op and `.trimEnd()` is idempotent.
//   - rung 1 or 2 ≡ rung 1 or 2 — they differ at most in trailing whitespace.
//
// Measured on this corpus: 9 digests are shared by more than one file and NONE
// of those groups differs in executable bytes.
import { createHash } from "node:crypto";

/** sha256 of the empty string. Never evidence that anything ran. */
export const EMPTY_BODY_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/**
 * The prime ledger's body digest, as ONE SQL expression.
 *
 * `statements` is a `text[]`; measured on this prime, every one of the 906 rows
 * that has a body has exactly one element — the whole file as the CLI sent it —
 * so the join is a formality that costs nothing and stays correct if that ever
 * stops being true.
 */
export const LEDGER_BODY_DIGEST_SQL =
  "encode(sha256(convert_to(array_to_string(statements, E'\\n'), 'UTF8')), 'hex')";

/** A body with every byte that cannot execute removed. */
export function executableBody(sql) {
  const lines = sql.split("\n");
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (t === "" || t.startsWith("--")) i += 1;
    else break;
  }
  return lines.slice(i).join("\n").trimEnd();
}

/**
 * Every form of one body that could be what the ledger stored, most literal
 * first — so the INDEX of a match is the rung that produced it, and
 * `bodyFormLabel` can name what actually differs.
 *
 * ## Why identical rungs are kept rather than deduped
 *
 * They were deduped once, and that made the index an index into a shorter
 * list. A body with a leading comment and no trailing whitespace has rung 1
 * equal to rung 0, so rung 1 vanished and a leading-comment match reported
 * itself at index 1 — "identical but for trailing whitespace", about a file
 * whose whitespace is identical. Measured on this corpus the day it was found:
 * 0 files affected, because every leading-comment match here happens also to
 * carry trailing whitespace. A reading that is true by coincidence is one this
 * repository has had to fix twice already, so the coincidence is removed
 * rather than relied on.
 *
 * Keeping them costs at most two extra sha256 over a file already read from
 * disk, and buys `index === rung` for every input.
 *
 * ## A rung that normalises to nothing is dropped, and that is safe
 *
 * An empty body is never evidence: a ledger row with no SQL and a file that is
 * nothing but comments hash to the same thing. Dropping empties cannot shift a
 * surviving rung's index, because an empty rung can only ever be followed by
 * empty rungs — rung 1 empty means the whole body is whitespace, and then
 * rung 2 is empty too.
 */
export function migrationBodyForms(sql) {
  return [sql, sql.trimEnd(), executableBody(sql)].filter((form) => form !== "");
}

// Rung 2 is `executableBody`, which discounts a leading comment block AND
// trailing whitespace, so it is named for what it asserts rather than for one
// of the two things it ignores.
export const BODY_FORM_LABELS = [
  "byte-identical",
  "identical but for trailing whitespace",
  "identical in what executes",
];

export function bodyFormLabel(index) {
  return BODY_FORM_LABELS[index] ?? "identical once non-executing bytes are discounted";
}

export const sha256Hex = (text) => createHash("sha256").update(text, "utf8").digest("hex");

/** Digests of every form, most literal first. */
export const bodyDigests = (sql) => migrationBodyForms(sql).map(sha256Hex);

/**
 * Which rung of `sql` hashes to `digest`, or -1.
 *
 * ANY rung, deliberately: this is the question the cascade asks, and a guard
 * that demanded the rung the manifest recorded would fail a file whose only
 * change was a trailing newline — which is not a change to what executes.
 */
export function formIndexFor(sql, digest) {
  return bodyDigests(sql).indexOf(digest);
}

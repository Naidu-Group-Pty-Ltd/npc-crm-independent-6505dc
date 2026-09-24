/**
 * The executable skeleton of a seeded-catalogue migration: every statement its
 * rows are poured into, with the rows themselves left out.
 *
 * ## Why this is here
 *
 * The template-library seeds are one INSERT of ~543 rows carrying ~40 MB of
 * schema JSON. Mission Control will not read a body that size to ask what a
 * migration creates and requires — it reads bodies under 256 KiB for that, and
 * the ceiling is right for a pass that touches the whole corpus every tick. So
 * the fleet sync knew nothing about the seeds' dependencies, held each one
 * behind every hole before it, and then held everything after the seed too,
 * because a migration nobody could read might create anything.
 *
 * What the dependency question needs is not the rows. It is the statements:
 * the header (every line through `VALUES`, which in v15 onward includes the
 * `template_library_release_baselines` table the refresh reads back), the
 * `ON CONFLICT` clause, and the trailing statements. That is a few tens of
 * kilobytes of a forty-megabyte file, and this repository — which holds the
 * file — can read it cheaply. `scripts/build-migration-seed-skeletons.mjs`
 * publishes it, pinned to the file's git blob, and Mission Control reads its
 * facts from that.
 *
 * ## It is Mission Control's reader, ported
 *
 * `src/server/seedChunking.pure.ts` in Mission Control is the definition: its
 * first pass (`readSeedShape`) is what finds these parts when the seed is SENT,
 * and its `seedSkeleton` is what the destructiveness gate assesses. This is
 * that first pass and that join, line for line, so the skeleton published here
 * is the skeleton Mission Control would derive from the same bytes — verified
 * byte-identical over every seed in the corpus (18 files, 23 Sep 2026) before
 * it was relied on. Every refusal is kept, because each is a way a wrong split
 * looks like a right one: a line that is exactly `  (` inside a dollar-quoted
 * JSON schema would be read as a tuple boundary, so the dollar-quote tags must
 * balance within every tuple; a tuple must end with `)`; text before the first
 * tuple is refused rather than absorbed.
 *
 * It recognises one shape and refuses every other by name. A large file that is
 * not this shape is published as refused, and Mission Control keeps treating
 * it as unread.
 *
 * Pure: it reads the chunks it is handed and nothing else.
 */

export class SeedShapeError extends Error {
  constructor(message) {
    super(message);
    this.name = "SeedShapeError";
  }
}

/** Split a stream of text into lines without their terminators. */
export async function* linesOf(chunks) {
  let rest = "";
  for await (const chunk of chunks) {
    rest += chunk;
    let at = rest.indexOf("\n");
    while (at !== -1) {
      yield rest.slice(0, at);
      rest = rest.slice(at + 1);
      at = rest.indexOf("\n");
    }
  }
  // A file that ends in a newline ends here with an empty remainder, which is
  // not a line. One that does not ends with a real last line, which is.
  if (rest.length > 0) yield rest;
}

/** Every dollar-quote tag in a tuple must open and close inside it. */
export function assertDollarQuotesBalanced(tuple, ordinal) {
  const counts = new Map();
  for (const tag of tuple.match(/\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$/g) ?? []) {
    counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  for (const [tag, n] of counts) {
    if (n % 2 !== 0) {
      throw new SeedShapeError(
        `tuple ${ordinal} splits inside a ${tag} string (${n} tags) — refusing to chunk`,
      );
    }
  }
}

/** Assembles tuples from region lines one at a time. Holds at most one tuple. */
class TupleAssembler {
  current = null;
  count = 0;

  feed(line) {
    if (line === "  (") {
      if (this.current) this.finish();
      this.current = [line];
      return;
    }
    if (!this.current) {
      if (line.trim() === "") return;
      throw new SeedShapeError(
        `text before the first tuple is not a row and cannot be chunked: ${JSON.stringify(line.slice(0, 60))}`,
      );
    }
    this.current.push(line);
  }

  end() {
    if (this.current) this.finish();
  }

  finish() {
    const body = this.current;
    this.current = null;
    while (body.length > 0 && body[body.length - 1].trim() === "") body.pop();
    if (body.length < 2) throw new SeedShapeError(`tuple ${this.count + 1} has no body`);
    const last = body.length - 1;
    let lastLine = body[last].replace(/\s+$/, "");
    if (lastLine.endsWith(",")) lastLine = lastLine.slice(0, -1);
    body[last] = lastLine;
    const tuple = body.join("\n");
    // The balance check runs first: a boundary that fell inside a quoted
    // string is the cause, and "does not end with ')'" would be its symptom.
    assertDollarQuotesBalanced(tuple, this.count + 1);
    if (!lastLine.endsWith(")")) {
      throw new SeedShapeError(`tuple ${this.count + 1} does not end with ')'`);
    }
    this.count += 1;
  }
}

/**
 * Everything but the rows: `{ header, onConflict, tail, tupleCount, target }`.
 *
 * `header` is every line through the line `VALUES`, verbatim. `onConflict` is
 * the clause that terminates the rows, verbatim and possibly several lines.
 * `tail` is every statement after it, trimmed — empty when there are none.
 * Validates every tuple on the way, holding one at a time.
 *
 * @param {AsyncIterable<string>} chunks the file's text, in any chunking
 */
export async function readSeedShape(chunks) {
  let phase = "header";
  const header = [];
  const conflict = [];
  const tail = [];
  const tuples = new TupleAssembler();

  for await (const line of linesOf(chunks)) {
    if (phase === "header") {
      header.push(line);
      if (line === "VALUES") {
        const head = header.join("\n");
        if (!/INSERT INTO\s+/i.test(head)) {
          throw new SeedShapeError(
            "VALUES reached with no INSERT INTO before it — not the recognised seed shape",
          );
        }
        phase = "region";
      }
      continue;
    }
    if (phase === "region") {
      if (line.startsWith("ON CONFLICT ")) {
        tuples.end();
        conflict.push(line);
        phase = line.replace(/\s+$/, "").endsWith(";") ? "tail" : "conflict";
        continue;
      }
      tuples.feed(line);
      continue;
    }
    if (phase === "conflict") {
      conflict.push(line);
      if (line.replace(/\s+$/, "").endsWith(";")) phase = "tail";
      continue;
    }
    tail.push(line);
  }

  if (phase === "header") {
    throw new SeedShapeError("no VALUES line — not the recognised seed shape");
  }
  if (phase === "region") {
    throw new SeedShapeError("no ON CONFLICT clause after the rows — not the recognised seed shape");
  }
  if (phase === "conflict") {
    throw new SeedShapeError("unterminated ON CONFLICT clause");
  }
  if (tuples.count === 0) throw new SeedShapeError("no tuples found between VALUES and ON CONFLICT");

  const head = header.join("\n");
  return {
    header: head,
    onConflict: conflict.join("\n"),
    tail: tail.join("\n").trim(),
    tupleCount: tuples.count,
    target: /INSERT INTO\s+((?:[a-z0-9_]+\.)?[a-z0-9_]+)/i.exec(head)?.[1] ?? null,
  };
}

/**
 * The executable skeleton: every statement the data is poured into, with one
 * marker line where the rows were. Rows are data and are not SQL anybody has
 * to read for a dependency.
 *
 * The join is Mission Control's `seedSkeleton`, character for character —
 * that is what makes a published skeleton the same text Mission Control would
 * derive, and what its reader is entitled to assume.
 */
export function seedSkeleton(shape) {
  return [shape.header, "  (…)", shape.onConflict, shape.tail].filter(Boolean).join("\n");
}

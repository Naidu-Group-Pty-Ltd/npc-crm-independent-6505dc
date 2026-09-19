import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Source-contract test for the screening claim predicate.
 *
 * ## The defect this pins
 *
 * The outbox worker claims a screening subject with a conditional UPDATE so
 * the provider runs at most once per delivery. That predicate was written as
 * one PostgREST `.or()` string with an ISO timestamp interpolated into it:
 *
 *     .or(`state.in.(queued,error),and(state.eq.processing,updated_at.lt.${cutoff})`)
 *
 * PostgREST could not parse it — a timestamp carries the `.` and `:` its
 * filter grammar treats as structural — so production answered
 * "column party_screening_subjects.state does not exist" and the claim
 * failed for every subject, every time, from the day it was written.
 *
 * It survived review because it reads correctly and because the consumer's
 * own test double implemented `.or()` by pulling the cutoff back out with a
 * regex. Both the code and its test agreed; only the server disagreed.
 *
 * ## What is asserted
 *
 * A filter may not be composed as a string, because a string is the only
 * form in which a value can silently corrupt the grammar around it. Typed
 * filters cannot: the client encodes each value for the position it is going
 * into. This is the same class as SQL string-building, and the remedy is the
 * same — never hand the parser a sentence you assembled yourself.
 */

const repo = join(__dirname, "../../..");
const read = (p: string) => readFileSync(join(repo, p), "utf8");

/** Comments explain the defect, so they are stripped before judging code. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const consumer = stripComments(read(
  "supabase/functions/_shared/aml/screeningConsumer.ts",
));

describe("the screening claim is composed of typed filters, never a string", () => {
  it("builds no PostgREST filter expression as a string", () => {
    expect(consumer).not.toMatch(/\.or\s*\(/);
  });

  it("interpolates no value into a filter argument", () => {
    // A template literal anywhere inside a filter call is the shape that
    // broke: the value is pasted into grammar rather than encoded for a slot.
    // Read to the end of the line rather than to the first `)`: the shape
    // that broke contained its own parentheses, so a lazy match stopped
    // inside the argument and saw nothing.
    const filterCalls = consumer.match(
      /\.(or|eq|in|lt|lte|gt|gte|neq|like|ilike|filter)\s*\(.*/g,
    ) ?? [];
    const interpolating = filterCalls.filter((c) => c.includes("${"));
    expect(interpolating).toEqual([]);
  });

  it("still claims on both branches — fresh work and a dead holder", () => {
    // The fix must not have narrowed the predicate. A subject left
    // `processing` by a worker that died has to become claimable again once
    // it is stale, or one crash strands that subject for ever.
    expect(consumer).toMatch(/\.in\(\s*['"]state['"]\s*,\s*\[\s*['"]queued['"]\s*,\s*['"]error['"]\s*\]/);
    expect(consumer).toMatch(/\.eq\(\s*['"]state['"]\s*,\s*['"]processing['"]\s*\)\s*\.lt\(\s*['"]updated_at['"]/);
  });

  it("still claims by conditional UPDATE, not by read-then-write", () => {
    // Atomicity is the property that makes this at-most-once. The predicate
    // must be evaluated by Postgres inside the UPDATE; a JS check followed by
    // an unconditional write would let two workers call the provider.
    const claim = consumer.slice(consumer.indexOf("const claimBase"));
    expect(claim.slice(0, 400)).toMatch(/\.update\(\s*\{[^}]*state:\s*['"]processing['"]/);
  });
});

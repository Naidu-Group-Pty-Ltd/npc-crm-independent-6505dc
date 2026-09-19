import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  canPerformScreeningAction, screeningActionDeniedNote,
} from "./screeningActionAccess";

/**
 * The client's idea of who may act, checked against the server's.
 *
 * This module exists because the card took one `canWrite` boolean and
 * offered an analyst work the server refuses. It then did the same thing
 * again: `record_pep` was left out of the reviewer list, so it fell through
 * to `canWrite` — and `record_pep_determination` answers a non-reviewer with
 * 403. On the reported case that was the ONE action Stage 5 was asking for.
 *
 * An allowlist that has to be remembered will be forgotten again, so this
 * reads the edge function's own role checks and compares them.
 */

const repo = join(__dirname, "../../..");
const casesFn = readFileSync(
  join(repo, "supabase/functions/aml-cases/index.ts"), "utf8");

/** The operation each Stage 5 action actually invokes. */
const ACTION_OPERATION: Record<string, string> = {
  classify_perimeter: "classify_screening_perimeter",
  adjudicate_match: "adjudicate_party_screening",
  record_pep: "record_pep_determination",
  run_screening: "queue_party_screening",
  screening_stalled: "retry_stalled_screening",
};

/** Whether the edge function's handler for `op` demands reviewer or MLRO. */
function serverRequiresReviewer(op: string): boolean {
  const at = casesFn.indexOf(`case '${op}':`);
  if (at < 0) throw new Error(`operation ${op} not found in aml-cases`);
  // The role guard is the first statement of the handler; read a short window
  // so a later, unrelated check cannot be mistaken for this one.
  const head = casesFn.slice(at, at + 600);
  return /roles\.has\('reviewer'\)/.test(head) && /roles\.has\('mlro'\)/.test(head);
}

const ANALYST = { canWrite: true, isReviewer: false, isMlro: false };
const REVIEWER = { canWrite: true, isReviewer: true, isMlro: false };
const MLRO = { canWrite: true, isReviewer: false, isMlro: true };

describe("the client offers exactly what the server accepts", () => {
  for (const [action, op] of Object.entries(ACTION_OPERATION)) {
    it(`${action} matches ${op}`, () => {
      const serverStrict = serverRequiresReviewer(op);
      expect(canPerformScreeningAction(action as never, ANALYST)).toBe(!serverStrict);
      // Both privileged roles may always do what a writer may.
      expect(canPerformScreeningAction(action as never, REVIEWER)).toBe(true);
      expect(canPerformScreeningAction(action as never, MLRO)).toBe(true);
    });
  }

  it("record_pep is one of the strict ones — the omission that prompted this", () => {
    expect(serverRequiresReviewer("record_pep_determination")).toBe(true);
    expect(canPerformScreeningAction("record_pep", ANALYST)).toBe(false);
  });

  it("names who can, rather than going quiet", () => {
    expect(screeningActionDeniedNote("record_pep"))
      .toMatch(/reviewer or the MLRO/i);
  });

  it("a manual screening stays MLRO-only, which is narrower than the server's op", () => {
    /*
     * `record_manual_screening` is MLRO-only in `aml-cases`; a reviewer may
     * adjudicate a candidate but may not record that a screening was
     * PERFORMED. Asserted separately because it is the one place the client
     * is deliberately stricter than "reviewer or MLRO".
     */
    expect(canPerformScreeningAction("complete_manually", REVIEWER)).toBe(false);
    expect(canPerformScreeningAction("complete_manually", MLRO)).toBe(true);
  });
});

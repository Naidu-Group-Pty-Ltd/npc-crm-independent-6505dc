/**
 * The closed-case notice, in the right rail.
 *
 * ── What it was, and why that went ────────────────────────────────────
 * This carried "Advance status": a free-text reason marked OPTIONAL and a
 * row of buttons that moved the case's lifecycle straight from the rail. It
 * was suppressed on Passport & Partners and Ongoing CDD first, because on a
 * cleared case it offered "Under review", and one click there regresses four
 * things at once — `status`, `case_stage`, `client_portal_status` and,
 * through `STATUS_TO_SERVICE_GATE`, `service_gate_status`, which flips a
 * live Passport to "Refresh required".
 *
 * It is gone from every stage now. The reasons it was wrong on those two
 * stages were never local to them: a case's lifecycle is the CONSEQUENCE of
 * decisions that carry their own recorded reasons, and a rail control that
 * restated them as one-click buttons was a second way to do something the
 * product already had a proper place for. Every state it could reach still
 * has one:
 *
 *   · `cleared`, `blocked`, `escalated_mlro` — the Decision stage's own
 *     control, with its rationale and its authority check.
 *   · `kyc_in_progress`, `kyc_complete` — the client's own submission moves
 *     these; they were never an operator's to set by hand.
 *   · `closed` — the case header's "Close case", which requires a reason and
 *     confirms before it writes. This comment used to claim closing was the
 *     header's job while nothing there did it; now it is true.
 *   · `under_review` — deliberately not offered. Re-deciding a cleared case
 *     is the Decision stage's act, with a rationale, not an undo button.
 *
 * Hiding a button was never authorisation. The server enforces every
 * transition exactly as before, `amlCasesApi.transition` is untouched, and
 * the legacy case dialog — the rollback path when the workspace flag is off
 * — still carries the panel it always had.
 *
 * ── What is left ──────────────────────────────────────────────────────
 * One card, and only on a closed case: the retained-record notice and the
 * single authorised way out of it. Reopening carries a reason and its own
 * authority check, so it is passed in rather than performed here, and it was
 * never an ordinary transition.
 *
 * ── Why it reads the CANONICAL lifecycle ──────────────────────────────
 * `closed` is read from `case_stage` as well as `status`. The two dimensions
 * can disagree, and did in production: `reopen_case` moved `status` to its
 * resumed value and left `case_stage` at `closed`, so the Live Position rail
 * said "Case stage: Closed" while this panel offered the advances of a live
 * case. The write defect is fixed in `aml-cases`; this still reads both,
 * because they deploy separately and the safe reading is the one that does
 * not treat a retained record as a case in progress.
 */

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { AmlCase } from "@/lib/aml/amlCasesApi";
import { caseStage } from "@/lib/aml/caseDimensions";

export interface AmlContextActionPanelProps {
  caseRow: AmlCase;
  canWrite: boolean;
  /**
   * Resume a closed case. Reopening is a separate, reason-bearing decision
   * and must never be reachable as an ordinary status transition, so it is
   * passed in rather than performed here.
   */
  onReopen?: () => void;
}

export function AmlContextActionPanel({
  caseRow,
  canWrite,
  onReopen,
}: AmlContextActionPanelProps) {
  const closed = caseStage(caseRow) === "closed" || caseRow.status === "closed";
  if (!closed) return null;

  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Case closed
        </p>
        <p className="text-xs text-muted-foreground">
          This AML/CTF record is retained for compliance purposes. The journey is not
          progressing and the ordinary status advances do not apply.
        </p>
        {canWrite && onReopen && (
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onReopen}>
            Reopen case to resume AML/CTF
          </Button>
        )}
        <p className="text-[11px] text-muted-foreground">
          Reopening restores the ability to work the case. It does not approve the
          service, revive a terminated service gate, or restore a revoked passport.
        </p>
      </CardContent>
    </Card>
  );
}

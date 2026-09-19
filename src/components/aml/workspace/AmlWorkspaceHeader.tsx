/**
 * The persistent case header.
 *
 * One line of identity at the top of every stage, so an analyst never has
 * to scroll to remember which case they are in. It answers three of the ten
 * questions on its own — what am I looking at, where is it, and what is the
 * risk and gate position — and hands the fourth (where in the process, and
 * what needs attention) to the journey rail immediately beneath it.
 *
 * Restraint is the point: one strong name, quiet metadata, and exactly two
 * badges. Risk and the service gate are the only two dimensions that earn a
 * badge here, and they are visually separated so that neither reads as
 * causing the other.
 *
 * The five-phase macro rail used to sit under this header. It was a lower
 * resolution reading of the same canonical state the ten-stage journey rail
 * now renders directly beneath — two rails saying the same thing at
 * different granularities is one rail too many, so this header stopped
 * drawing one. `deriveAmlMacroPhase` is untouched and still drives the
 * register's Phase column.
 */
import { ArrowLeft, RefreshCw, User } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { displayRelative } from "@/lib/aml/displayDate";
import { cn } from "@/lib/utils";
import type { AmlCase } from "@/lib/aml/amlCasesApi";

import { AmlGateBadge, AmlRiskBadge } from "@/components/aml/primitives";
import { caseStage, serviceGateStatus } from "@/lib/aml/caseDimensions";

const SUBJECT_TYPE_LABELS: Record<string, string> = {
  individual: "Individual",
  entity: "Entity / company",
  trust: "Trust",
};

export interface AmlWorkspaceHeaderProps {
  caseRow: AmlCase;
  /** Property or matter line, when the case has one loaded. */
  matterLabel?: string | null;
  className?: string;
}

export function AmlWorkspaceHeader({
  caseRow,
  matterLabel,
  className,
  live,
  onClose,
}: AmlWorkspaceHeaderProps & {
  /**
   * Live-refresh state. The case refetches itself, so the header says when it
   * last did — a screen that updates silently is indistinguishable from one
   * that has frozen, and this page's whole problem was staleness nobody could
   * see.
   */
  live?: { lastRefreshedAt: Date | null; refreshing: boolean; refreshNow: () => void };
  /**
   * Close the case.
   *
   * Absent for a reader without write access, and absent on a case that is
   * already closed — a terminal act offered on a terminal record is a button
   * that can only fail.
   *
   * It lives here, beside the case's own identity, because closing is a fact
   * about the CASE rather than about the stage somebody happens to be
   * looking at. It used to sit in the right rail among the ordinary status
   * advances, behind a reason marked optional; `closed` is terminal and the
   * record is retained from that point, so it is neither ordinary nor an
   * advance. The caller confirms and requires the reason.
   */
  onClose?: () => void;
}) {
  const gate = serviceGateStatus(caseRow);
  const closed = caseStage(caseRow) === "closed" || caseRow.status === "closed";
  const subjectType = SUBJECT_TYPE_LABELS[caseRow.subject_type] ?? caseRow.subject_type;

  return (
    <header className={cn(className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        {/* `basis-72` gives the row somewhere to wrap. Without it the badge
            group — which must not shrink — squeezed the whole identity
            block to four pixels on a phone and the case name disappeared. */}
        <div className="min-w-0 flex-1 basis-72">
          <div className="flex items-center gap-1.5">
            <Button asChild variant="ghost" size="sm" className="-ml-2 h-8 w-8 shrink-0 p-0">
              <Link to="/admin/aml/cases" aria-label="Back to the case register">
                <ArrowLeft aria-hidden className="h-4 w-4" />
              </Link>
            </Button>
            <h1 className="min-w-0 truncate text-xl font-semibold tracking-tight sm:text-2xl">
              {caseRow.subject_display_name}
            </h1>
          </div>

          {matterLabel && (
            <p className="mt-0.5 truncate pl-8 text-sm text-foreground/80" title={matterLabel}>
              {matterLabel}
            </p>
          )}

          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 pl-8 text-xs text-muted-foreground">
            <span className="font-medium text-foreground/70">{caseRow.case_reference}</span>
            <span aria-hidden>·</span>
            <span>{subjectType}</span>
            <span aria-hidden>·</span>
            <span>Updated {displayRelative(caseRow.updated_at)}</span>
            {live && (
              <>
                <span aria-hidden>·</span>
                <button
                  type="button"
                  onClick={live.refreshNow}
                  disabled={live.refreshing}
                  className="inline-flex items-center gap-1 underline-offset-2 hover:underline disabled:opacity-60"
                >
                  <RefreshCw
                    aria-hidden
                    className={cn("h-3 w-3", live.refreshing
                      && "animate-spin motion-reduce:animate-none")}
                  />
                  {live.refreshing
                    ? "Refreshing"
                    : live.lastRefreshedAt
                      ? `Live · ${displayRelative(live.lastRefreshedAt.toISOString())}`
                      : "Live"}
                </button>
              </>
            )}
            {/* Ownership of the work, without leaking internal identifiers. */}
            <span aria-hidden>·</span>
            <span>{caseRow.assigned_analyst_id ? "Analyst assigned" : "No analyst assigned"}</span>
            {caseRow.assigned_mlro_id && (
              <>
                <span aria-hidden>·</span>
                <span>MLRO assigned</span>
              </>
            )}
            {caseRow.client_id && (
              <>
                <span aria-hidden>·</span>
                <Link
                  className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
                  to={`/clients?clientId=${caseRow.client_id}`}
                >
                  <User aria-hidden className="h-3 w-3" /> Client record
                </Link>
              </>
            )}
          </div>
        </div>

        {/* Two badges, kept apart: an assessment and a decision, not a chain.

            NOT `shrink-0`. A flex item that cannot shrink keeps its
            max-content width — here the three controls in a single row,
            418px — so on a 390px screen the cluster hung 44px past the right
            edge and "Service gate: Under review" was cut in half, with the
            whole workspace scrolling sideways to reach it. The badges carry
            their own `whitespace-nowrap`, so nothing inside them is squeezed
            by letting the cluster shrink: it wraps onto a second line
            instead, which is what `flex-wrap` was always here to do. */}
        <div className="flex min-w-0 flex-wrap items-center gap-2" aria-label="Case position">
          {onClose && !closed && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
              onClick={onClose}
            >
              Close case
            </Button>
          )}
          <AmlRiskBadge risk={caseRow.risk_rating} prefix />
          <AmlGateBadge gate={gate} prefix />
        </div>
      </div>
    </header>
  );
}

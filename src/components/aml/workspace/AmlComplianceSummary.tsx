/**
 * One line per evidence stream: Identity, Screening, Ownership, Funds,
 * Documents, EDD, Monitoring.
 *
 * A compact status list rather than seven cards. Each row states the fact
 * (`3 of 4 verified`) rather than an adjective, and links to the section
 * that owns it. Rows whose underlying read failed say "Not available" — the
 * summary never fills a gap with a friendlier answer.
 *
 * These are evidence readings. They inform the service-gate decision; they
 * do not make it, and this component deliberately renders no gate state.
 */
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  EVIDENCE_STATE_LABELS,
  type AmlComplianceSummary as ComplianceSummary,
  type AmlWorkspaceSection,
} from "@/lib/aml/workspaceViewModel";

import { EVIDENCE_ICON, EVIDENCE_TEXT } from "./attentionTone";

export function AmlComplianceSummary({
  summary,
  loading,
  onOpenSection,
  className,
}: {
  summary: ComplianceSummary;
  loading?: boolean;
  onOpenSection: (section: AmlWorkspaceSection) => void;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardContent className="p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Compliance evidence
        </p>

        {loading ? (
          <div className="mt-3 space-y-2" role="status">
            <span className="sr-only">Loading the compliance summary</span>
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} aria-hidden className="h-8 w-full" />
            ))}
          </div>
        ) : (
          <ul className="mt-2 divide-y divide-border/50">
            {summary.rows.map((row) => {
              const Icon = EVIDENCE_ICON[row.state];
              return (
                <li key={row.key}>
                  <button
                    type="button"
                    onClick={() => onOpenSection(row.section)}
                    className="group flex w-full items-center gap-3 rounded-md px-1 py-2 text-left transition-colors hover:bg-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <Icon
                      aria-hidden
                      className={cn("h-4 w-4 shrink-0", EVIDENCE_TEXT[row.state])}
                    />
                    {/* The label never truncates — "Enhanced due dili…" is
                        not a status anybody can act on. The middle detail
                        column is the one that folds away, reappearing under
                        the label below sm. */}
                    <span className="min-w-0 flex-1 text-sm font-medium">{row.label}</span>
                    <span className="hidden min-w-0 flex-1 truncate text-right text-xs text-muted-foreground md:block">
                      {row.detail}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 text-right text-xs font-medium sm:w-32",
                        EVIDENCE_TEXT[row.state],
                      )}
                    >
                      {EVIDENCE_STATE_LABELS[row.state]}
                    </span>
                  </button>
                  {/* The detail column collapses under the label on narrow
                      screens rather than being dropped. */}
                  <p className="-mt-1 mb-1.5 pl-8 text-xs text-muted-foreground md:hidden">
                    {row.detail}
                  </p>
                </li>
              );
            })}
          </ul>
        )}

        {!loading && summary.unavailableFacts.length > 0 && (
          <p className="mt-3 border-t border-border/50 pt-3 text-xs text-muted-foreground">
            Not read for this case: {summary.unavailableFacts.join(", ")}. Those rows show as not
            available rather than as complete.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

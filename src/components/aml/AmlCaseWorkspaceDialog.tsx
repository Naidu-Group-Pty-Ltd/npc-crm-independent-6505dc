/**
 * Legacy AML case workspace — centred dialog.
 *
 * Replaces the old right-side `CaseDetailSheet` (a cramped `sm:max-w-2xl`
 * drawer) with a large centred compliance workspace:
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ Case header  (name · ref · stage/risk/gate)  │  fixed
 *   ├──────────────────────────────────────────────┤
 *   │ Case actions (grouped, destructive confirmed)│  fixed
 *   ├──────────────────────────────────────────────┤
 *   │ Tabs — persistent nav, scrollable content    │  fills remaining height
 *   └──────────────────────────────────────────────┘
 *
 * Desktop: min(94vw, 1240px) wide, capped at 92vh, centred. Mobile: a
 * full-screen dialog with the same structure. Presentation only — the
 * transition rules (`NEXT_STATUSES`), API calls, permissions and case data
 * contracts are byte-identical to the Sheet implementation this replaces.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { CaseWorkspaceTabs } from "@/components/aml/CaseWorkspaceTabs";
import {
  amlCasesApi, type AmlCase, type AmlCaseEvent, type AmlCaseStatus,
} from "@/lib/aml/amlCasesApi";
import {
  CASE_STAGE_LABELS, CASE_STATUS_LABELS, RISK_BADGE_CLASSES, SERVICE_GATE_LABELS,
  caseStage, serviceGateStatus,
} from "@/lib/aml/caseDimensions";
import { smartCapitalize } from "@/lib/nameUtils";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

const SUBJECT_TYPE_LABELS: Record<string, string> = {
  individual: "Individual", entity: "Entity / company", trust: "Trust",
};

/**
 * Legal transitions — UNCHANGED from the Sheet implementation (and mirrored by
 * the server): this map is presentation-side pre-filtering only.
 */
const NEXT_STATUSES: Record<AmlCaseStatus, AmlCaseStatus[]> = {
  draft: ["kyc_in_progress", "closed"],
  kyc_in_progress: ["kyc_complete", "edd_required", "blocked", "closed"],
  kyc_complete: ["under_review", "edd_required", "cleared", "closed"],
  edd_required: ["under_review", "escalated_mlro", "blocked", "closed"],
  under_review: ["cleared", "escalated_mlro", "edd_required", "blocked", "closed"],
  escalated_mlro: ["cleared", "blocked", "closed"],
  cleared: ["under_review", "closed"],
  blocked: ["under_review", "closed"],
  closed: [],
};

/**
 * Grouping is visual only — every entry still comes from NEXT_STATUSES.
 * Ordinary progression, attention-raising and destructive transitions get
 * distinct treatments so "Blocked" never sits camouflaged beside "Cleared".
 */
const ATTENTION_TRANSITIONS = new Set<AmlCaseStatus>(["edd_required"]);
const DESTRUCTIVE_TRANSITIONS = new Set<AmlCaseStatus>(["blocked", "closed"]);

const DESTRUCTIVE_COPY: Partial<Record<AmlCaseStatus, { title: string; body: string; action: string }>> = {
  blocked: {
    title: "Block this case?",
    body: "Blocking locks the service gate and stops the client's onboarding until the case is re-reviewed. Record why this case is being blocked — the reason is written to the tamper-evident audit trail.",
    action: "Block case",
  },
  closed: {
    title: "Close this case?",
    body: "Closing ends this AML/CTF case. A closed case cannot be advanced further. Record why this case is being closed — the reason is written to the tamper-evident audit trail.",
    action: "Close case",
  },
};

export interface AmlCaseWorkspaceDialogProps {
  caseId: string | null;
  onClose: () => void;
  onChanged: () => void;
  canWrite: boolean;
  canInvestigate: boolean;
  initialTab?: string;
}

export function AmlCaseWorkspaceDialog({
  caseId, onClose, onChanged, canWrite, canInvestigate, initialTab,
}: AmlCaseWorkspaceDialogProps) {
  const [caseRow, setCaseRow] = useState<AmlCase | null>(null);
  const [events, setEvents] = useState<AmlCaseEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [reason, setReason] = useState("");
  // Destructive transitions (Blocked / Closed) go through an explicit
  // confirmation dialog with a required reason.
  const [pendingDestructive, setPendingDestructive] = useState<AmlCaseStatus | null>(null);
  const [destructiveReason, setDestructiveReason] = useState("");
  const loadSeq = useRef(0);

  const load = async (id: string, { silent = false }: { silent?: boolean } = {}) => {
    const seq = ++loadSeq.current;
    if (!silent) setLoading(true);
    setLoadError(null);
    try {
      const res = await amlCasesApi.get(id);
      if (seq !== loadSeq.current) return;
      setCaseRow(res.case);
      setEvents(res.events);
    } catch (e: any) {
      if (seq !== loadSeq.current) return;
      setLoadError(e?.message ?? "Failed to load case");
      toast({ title: "Failed to load case", description: e.message, variant: "destructive" });
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (caseId) {
      load(caseId);
    } else {
      setCaseRow(null);
      setEvents([]);
      setReason("");
      setLoadError(null);
      setPendingDestructive(null);
      setDestructiveReason("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  const nextOptions = useMemo(
    () => (caseRow ? NEXT_STATUSES[caseRow.status] : []),
    [caseRow],
  );
  const progressOptions = nextOptions.filter(
    (s) => !ATTENTION_TRANSITIONS.has(s) && !DESTRUCTIVE_TRANSITIONS.has(s));
  const attentionOptions = nextOptions.filter((s) => ATTENTION_TRANSITIONS.has(s));
  const destructiveOptions = nextOptions.filter((s) => DESTRUCTIVE_TRANSITIONS.has(s));

  const transition = async (to: AmlCaseStatus, reasonText?: string) => {
    if (!caseRow) return;
    setTransitioning(true);
    try {
      await amlCasesApi.transition(caseRow.id, to, reasonText || undefined);
      toast({
        title: "Status updated",
        description: `${CASE_STATUS_LABELS[caseRow.status]} → ${CASE_STATUS_LABELS[to]}`,
      });
      setReason("");
      setPendingDestructive(null);
      setDestructiveReason("");
      // Reload the case in place (keeping the selected tab) and refresh the
      // register behind the dialog.
      await load(caseRow.id, { silent: true });
      onChanged();
    } catch (e: any) {
      toast({ title: "Transition failed", description: e.message, variant: "destructive" });
    } finally {
      setTransitioning(false);
    }
  };

  const stage = caseRow ? caseStage(caseRow) : null;
  const gate = caseRow ? serviceGateStatus(caseRow) : null;
  const destructiveCopy = pendingDestructive ? DESTRUCTIVE_COPY[pendingDestructive] : null;

  return (
    <Dialog open={!!caseId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        bareLayout
        data-testid="aml-case-workspace-dialog"
        className="inset-0 flex h-[100dvh] w-full max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:inset-auto sm:left-1/2 sm:top-1/2 sm:h-auto sm:max-h-[92vh] sm:w-[min(94vw,1240px)] sm:max-w-[1240px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border"
      >
        {/* ── Fixed case header ───────────────────────────────────────
            Identity first, then one primary state with its two supporting
            readings beneath it. The stage is the case's current state; risk
            and the service gate qualify it, so they read as a quieter second
            line rather than as two more pills of equal weight. Opened and
            updated stay on the header but drop to the lowest tier — they are
            reference, not state.

            `sm:pr-14` as well as `pr-14`: the shared `sm:px-6` resets the
            right padding at that breakpoint, which let the status column run
            under the dialog's close button on a desktop width. */}
        <DialogHeader className="shrink-0 gap-2 border-b border-border/60 px-4 py-4 pr-14 text-left sm:px-6 sm:pr-14">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-6 gap-y-3">
            <div className="min-w-0">
              <DialogTitle className="break-words text-xl font-semibold leading-tight tracking-tight sm:text-2xl">
                {caseRow ? smartCapitalize(caseRow.subject_display_name) : "AML case"}
              </DialogTitle>
              <DialogDescription className="mt-1 break-words text-sm text-muted-foreground">
                {caseRow ? (
                  <>
                    <span className="font-mono text-foreground">{caseRow.case_reference}</span>
                    {" · "}{SUBJECT_TYPE_LABELS[caseRow.subject_type] ?? caseRow.subject_type}
                  </>
                ) : (
                  "AML/CTF case workspace"
                )}
              </DialogDescription>
              {caseRow && (
                <p className="mt-1 break-words text-xs text-muted-foreground">
                  Opened {new Date(caseRow.opened_at).toLocaleDateString('en-AU')}
                  {" · Updated "}{new Date(caseRow.updated_at).toLocaleDateString('en-AU')}
                </p>
              )}
            </div>
            {caseRow && stage && gate && (
              <div
                className="flex shrink-0 flex-col items-start gap-1.5 sm:items-end"
                aria-label="Case status"
              >
                <Badge variant="secondary" className="px-2.5 py-1 text-sm font-semibold">
                  {CASE_STAGE_LABELS[stage]}
                </Badge>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs sm:justify-end">
                  {caseRow.risk_rating ? (
                    <Badge
                      variant="outline"
                      className={cn("px-2 py-0 text-[11px]", RISK_BADGE_CLASSES[caseRow.risk_rating])}
                    >
                      Risk: {caseRow.risk_rating.toUpperCase()}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">Risk: Unrated</span>
                  )}
                  <span aria-hidden className="text-muted-foreground/50">·</span>
                  {/* Same three-way gate treatment as everywhere else: a tone
                      only for approved and for locked/terminated. Everything
                      in between reads as full-strength foreground so the gate
                      never sinks into the muted metadata around it. */}
                  <span
                    className={cn(
                      "font-medium",
                      ["approved", "approved_with_controls"].includes(gate)
                        ? "text-success"
                        : ["locked", "terminated"].includes(gate)
                          ? "text-destructive"
                          : "text-foreground",
                    )}
                  >
                    Service: {SERVICE_GATE_LABELS[gate]}
                  </span>
                </div>
              </div>
            )}
          </div>
        </DialogHeader>

        {/* ── Case actions (fixed, compact) ─────────────────────────── */}
        {caseRow && !loading && canWrite && nextOptions.length > 0 && (
          <section
            aria-label="Case actions"
            className="shrink-0 border-b border-border/60 bg-muted/30 px-4 py-3 sm:px-6"
          >
            <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
                <span className="shrink-0 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Case actions
                </span>
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Reason (optional)"
                  aria-label="Transition reason"
                  className="h-9 w-full text-sm sm:w-64"
                  disabled={transitioning}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {progressOptions.map((s) => (
                  <Button
                    key={s} size="sm" variant="outline"
                    className="min-h-9"
                    disabled={transitioning}
                    onClick={() => transition(s, reason)}
                  >
                    {transitioning && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                    {CASE_STATUS_LABELS[s]}
                  </Button>
                ))}
                {attentionOptions.map((s) => (
                  <Button
                    key={s} size="sm" variant="outline"
                    className="min-h-9 border-warning/40 text-warning hover:bg-warning/10 hover:text-warning"
                    disabled={transitioning}
                    onClick={() => transition(s, reason)}
                  >
                    {CASE_STATUS_LABELS[s]}
                  </Button>
                ))}
                {destructiveOptions.length > 0 && (
                  <>
                    {/* Destructive transitions sit behind a divider and a
                        confirmation dialog — never one accidental tap away. */}
                    <div aria-hidden="true" className="hidden h-6 w-px bg-border sm:block" />
                    {destructiveOptions.map((s) => (
                      <Button
                        key={s} size="sm" variant="outline"
                        className="min-h-9 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        disabled={transitioning}
                        onClick={() => { setDestructiveReason(reason); setPendingDestructive(s); }}
                      >
                        {CASE_STATUS_LABELS[s]}
                      </Button>
                    ))}
                  </>
                )}
              </div>
            </div>
          </section>
        )}

        {/* ── Workspace body (tabs own the scrolling) ───────────────── */}
        <div className="flex min-h-0 flex-1 flex-col px-4 pt-3 sm:px-6">
          {loading ? (
            <div
              className="flex flex-1 items-center justify-center gap-2 py-16 text-sm text-muted-foreground"
              role="status"
            >
              <Loader2 className="h-5 w-5 animate-spin" /> Loading case…
            </div>
          ) : loadError || !caseRow ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center" role="alert">
              <AlertTriangle className="h-8 w-8 text-muted-foreground" />
              <p className="max-w-md text-sm text-muted-foreground">
                {loadError ?? "This case could not be loaded."}
              </p>
              {caseId && (
                <Button variant="outline" size="sm" onClick={() => load(caseId)}>
                  <RefreshCw className="mr-2 h-4 w-4" /> Try again
                </Button>
              )}
            </div>
          ) : (
            <CaseWorkspaceTabs
              caseRow={caseRow}
              events={events}
              canWrite={canWrite}
              canInvestigate={canInvestigate}
              initialTab={initialTab}
              fillHeight
              onChanged={() => { void load(caseRow.id, { silent: true }); onChanged(); }}
            />
          )}
        </div>
      </DialogContent>

      {/* ── Destructive-transition confirmation ─────────────────────── */}
      <AlertDialog
        open={!!pendingDestructive}
        onOpenChange={(o) => { if (!o) { setPendingDestructive(null); setDestructiveReason(""); } }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              {destructiveCopy?.title ?? "Confirm action"}
            </AlertDialogTitle>
            <AlertDialogDescription>{destructiveCopy?.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="aml-destructive-reason">Reason (required)</Label>
            <Textarea
              id="aml-destructive-reason"
              value={destructiveReason}
              onChange={(e) => setDestructiveReason(e.target.value)}
              rows={3}
              placeholder="Why is this case being blocked or closed?"
              disabled={transitioning}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={transitioning}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={transitioning || !destructiveReason.trim()}
              onClick={() => pendingDestructive && transition(pendingDestructive, destructiveReason.trim())}
            >
              {transitioning && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {destructiveCopy?.action ?? "Confirm"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

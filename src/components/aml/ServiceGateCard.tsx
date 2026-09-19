/**
 * The service gate — the Decision stage's full gate card.
 *
 * This is the ONE place every gate status can be recorded: the eight
 * choice cards, the suggestion grouping, the precondition hints and the
 * reason countdown. Stage 9 deliberately does NOT repeat it — a full copy
 * there read as a duplicate of the Decision stage, so Gate & Passport
 * carries only the one act it owes (approving a cleared case's gate) in
 * `GateApprovalCard`, and links here for everything else. The server's
 * `set_service_gate` still enforces every rule.
 */
import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { amlRiskApi, type AmlServiceGateContract } from "@/lib/aml/amlRiskApi";
import { gateChangeHint, reasonHint } from "@/lib/aml/decisionPath.pure";
import { gateOptionGroups, GATE_CHOICES, type GateChoice } from "@/lib/aml/gateOptions.pure";
import { cn } from "@/lib/utils";

const GATE_LABELS: Record<string, string> = Object.fromEntries(
  GATE_CHOICES.map((c) => [c.value, c.label]),
);

function ChoiceCard({ selected, label, meaning, onSelect }: {
  selected: boolean; label: string; meaning: string; onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "rounded-md border p-2.5 text-left transition-colors",
        selected ? "border-primary bg-primary/5" : "border-border/60 hover:border-primary/50",
      )}
    >
      <span className="block text-sm font-medium">{label}</span>
      <span className="block text-xs text-muted-foreground">{meaning}</span>
    </button>
  );
}

export function ServiceGateCard({
  caseId, gate, decisionOutcome, openConditionCount, canReview, isMlro,
  onChanged, onOpenSection, anchorId,
}: {
  caseId: string;
  gate: AmlServiceGateContract | null;
  decisionOutcome: string | null;
  openConditionCount: number;
  canReview: boolean;
  isMlro: boolean;
  onChanged: () => void | Promise<void>;
  onOpenSection?: (section: string) => void;
  anchorId: string;
}) {
  const [gateStatus, setGateStatus] = useState<string>("under_review");
  const [gateReason, setGateReason] = useState("");
  const [busy, setBusy] = useState(false);

  /*
   * ── Seed the select from the gate that IS ─────────────────────────────
   * Seeded once per case, from the loaded gate — and only when the loaded
   * status is one this operator may select (a non-MLRO cannot re-pick
   * locked/terminated).
   */
  const gateSeededFor = useRef<string | null>(null);
  useEffect(() => {
    if (!gate || gateSeededFor.current === caseId) return;
    gateSeededFor.current = caseId;
    const selectable = isMlro || (gate.status !== "locked" && gate.status !== "terminated");
    if (selectable && GATE_LABELS[gate.status]) setGateStatus(gate.status);
  }, [gate, caseId, isMlro]);

  const applyGate = async () => {
    setBusy(true);
    try {
      await amlRiskApi.setServiceGate({ case_id: caseId, status: gateStatus, reason: gateReason.trim() });
      toast({ title: "Service gate updated" });
      setGateReason("");
      await onChanged();
    } catch (e: any) { toast({ title: "Gate change failed", description: e.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };

  const gateReasonHint = reasonHint(gateReason);
  const gatePrecondition = gateChangeHint(gateStatus, {
    decisionOutcome, openConditions: openConditionCount, isMlro,
  });
  const approved = gate?.status === "approved" || gate?.status === "approved_with_controls";

  return (
    <Card id={anchorId} className="scroll-mt-24">
      <CardHeader><CardTitle className="text-sm">Service gate</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        {/* The state as a statement, not a ledger: what the gate IS, since
            when — and, when it grants the service, the door forward. */}
        {gate ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-lg font-semibold">
                {GATE_LABELS[gate.status] ?? gate.status.replace(/_/g, " ")}
              </span>
              <span className="text-xs text-muted-foreground">
                {gate.effective_at ? `Effective ${new Date(gate.effective_at).toLocaleString('en-AU')}` : "No explicit gate decision recorded yet"}
                {gate.policy_version ? ` · Policy ${gate.policy_version}` : ""}
              </span>
            </div>
            {gate.reason && <div className="rounded bg-muted/40 p-2 text-xs">{gate.reason}</div>}
            {gate.conditions.length > 0 && (
              <div>
                <div className="text-[11px] text-muted-foreground">Attached conditions</div>
                <ul className="mt-0.5 space-y-0.5 text-xs">
                  {gate.conditions.map((c, i) => <li key={c.id ?? i}>• {c.label}</li>)}
                </ul>
              </div>
            )}
            {approved && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-success/40 bg-success/5 p-2.5">
                <p className="text-xs text-success">
                  The service gate is {(GATE_LABELS[gate.status] ?? "approved").toLowerCase()} — the
                  case is service-ready and this cascades into Gate &amp; Passport.
                </p>
                {onOpenSection && (
                  <Button size="sm" className="h-7" onClick={() => onOpenSection("passport")}>
                    Continue to Gate &amp; Passport
                  </Button>
                )}
              </div>
            )}
          </div>
        ) : (
          <p className="text-muted-foreground">Gate state unavailable.</p>
        )}
        {canReview && (
          <div className="space-y-2 border-t border-border/50 pt-3">
            <div className="text-xs font-semibold uppercase text-muted-foreground">Change service gate</div>
            <p className="text-[11px] text-muted-foreground">
              The gate controls service entitlement separately from case stage and risk. Pick the
              new status, give the reason, and apply — the reason is recorded on the gate decision
              and the audit trail.
            </p>
            {/*
              Choices that read: what each status DOES, with the statuses
              the recorded decision already implies offered first. The
              production table held ZERO gate decisions — the old select
              plus far-away disabled button meant the act was never
              completed, and "nothing cascades" was nothing ever applied.
            */}
            {(() => {
              const groups = gateOptionGroups({
                decisionOutcome,
                currentGate: gate?.status ?? null,
                isMlro,
              });
              const renderChoice = (c: GateChoice) => (
                <ChoiceCard
                  key={c.value}
                  selected={gateStatus === c.value}
                  label={c.label}
                  meaning={c.meaning}
                  onSelect={() => setGateStatus(c.value)}
                />
              );
              return (
                <div role="radiogroup" aria-label="New service-gate status" className="space-y-2">
                  {groups.suggested.length > 0 && (
                    <>
                      <p className="text-[11px] uppercase tracking-wide text-primary">
                        Suggested by the recorded decision
                      </p>
                      <div className="grid gap-2 sm:grid-cols-2">{groups.suggested.map(renderChoice)}</div>
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">All statuses</p>
                    </>
                  )}
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{groups.other.map(renderChoice)}</div>
                </div>
              );
            })()}
            {/* The server's approval rules, read BEFORE the request instead
                of from its 409; the server still enforces every one. */}
            {gatePrecondition && (
              <p className="text-[11px] text-warning" aria-live="polite">{gatePrecondition}</p>
            )}
            <textarea
              className="min-h-[56px] w-full rounded-md border border-input bg-background p-2 text-sm"
              aria-label="Gate change reason"
              placeholder="Reason (required, minimum 10 characters) — recorded on the gate decision and audit trail."
              value={gateReason}
              onChange={(e) => setGateReason(e.target.value)}
            />
            {/* A silently disabled control is indistinguishable from a
                broken one — the hint names what enables it, counting down. */}
            {gateReasonHint && (
              <p className="text-[11px] text-muted-foreground" aria-live="polite">{gateReasonHint}</p>
            )}
            <Button
              size="sm"
              disabled={busy || gateReason.trim().length < 10}
              onClick={applyGate}
            >
              Apply gate change — {GATE_LABELS[gateStatus] ?? gateStatus.replace(/_/g, " ")}
            </Button>
          </div>
        )}
        {!canReview && (
          <p className="border-t border-border/50 pt-3 text-xs text-muted-foreground">
            Changing the service gate requires a reviewer or the MLRO.
          </p>
        )}
      </CardContent>
    </Card>
  );
}


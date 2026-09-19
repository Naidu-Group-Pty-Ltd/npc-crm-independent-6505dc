import { useState } from "react";
import { AlertTriangle, FileQuestion, Plus, Share2, ShieldOff, Slash } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { amlRelianceApi } from "@/lib/aml/amlRelianceApi";
import { amlRiskApi } from "@/lib/aml/amlRiskApi";
import type { PassportView } from "@/lib/aml/passport";

/**
 * Passport controls — the design's control rail, wired to the operations
 * that already own each action.
 *
 * Nothing here writes state directly. Issue calls `issue_attestation`,
 * suspend and revoke call `set_service_gate` — all MLRO-gated server-side,
 * all reason-bearing, all writing their own hash-chained case event. Sharing
 * and client requests are handed upward as callbacks: this rail presents the
 * action, the surface that owns navigation decides where it goes, and the
 * canonical operation still owns the write.
 *
 * Affordance is not authorisation: the buttons are shown to MLROs for
 * discoverability, and the server refuses anyone else regardless.
 */

const MIN_REASON = 10;

type RestrictedAction = {
  key: "suspend" | "revoke";
  title: string;
  description: string;
  confirmLabel: string;
  gateStatus: "locked" | "terminated";
};

const RESTRICTED: RestrictedAction[] = [
  {
    key: "suspend",
    title: "Suspend Passport",
    description:
      "A temporary restriction. New reliance and new partner access become unavailable while it is in force; partner decisions already recorded are not withdrawn.",
    confirmLabel: "Suspend",
    gateStatus: "locked",
  },
  {
    key: "revoke",
    title: "Revoke Passport",
    description:
      "Revocation makes the Passport unavailable for any new reliance. It remains a retained compliance record and is not deleted.",
    confirmLabel: "Revoke",
    gateStatus: "terminated",
  },
];

export function PassportControls({
  caseId, view, isMlro, onChanged, onShare, onRequestClientInformation,
}: {
  caseId: string;
  view: PassportView;
  isMlro: boolean;
  onChanged: () => void;
  /**
   * Open Partner Access. Supplied by the surface that owns Passport page
   * navigation, because this rail has no business knowing how pages are
   * selected — and a DOM anchor is not navigation.
   */
  onShare: () => void;
  /** Open the client-request composer over the canonical request operation. */
  onRequestClientInformation: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<RestrictedAction | null>(null);
  const [reason, setReason] = useState("");

  const state = view.header.state.code;
  const canIssue = state === "ready_for_issuance" || state === "superseded" || state === "refresh_required";

  async function issue() {
    setBusy("issue");
    try {
      await amlRelianceApi.issueAttestation(caseId);
      toast({
        title: "Passport issued",
        description: "A new version was sealed and fingerprinted. Partners holding an earlier version are told theirs is obsolete.",
      });
      onChanged();
    } catch (e: unknown) {
      toast({
        title: "The Passport was not issued",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  }

  async function confirmRestricted() {
    if (!pending || reason.trim().length < MIN_REASON) return;
    setBusy(pending.key);
    try {
      await amlRiskApi.setServiceGate({
        case_id: caseId,
        status: pending.gateStatus,
        reason: reason.trim(),
      });
      toast({
        title: pending.key === "suspend" ? "Passport suspended" : "Passport revoked",
        description: "Recorded with your reason on the case timeline. Connected partners see a controlled message only.",
      });
      setPending(null);
      setReason("");
      onChanged();
    } catch (e: unknown) {
      toast({
        title: "The action was not applied",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Card className="glass-panel">
        <CardContent className="space-y-4 py-4">
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Passport controls
            </h3>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!isMlro || !canIssue || busy !== null}
                onClick={() => void issue()}
                title={
                  !isMlro
                    ? "MLRO role required"
                    : canIssue
                      ? undefined
                      : "A new version is issued when the gate is approved or the current version has been superseded"
                }
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                {view.versions.length === 0 ? "Issue Passport" : "Issue new version"}
              </Button>

              {/* These used to be `<a href="#compliance-sharing">`. That anchor
                  names an element in the CASE workspace, and the dedicated
                  Passport page does not contain it — so on the surface these
                  buttons actually live on, both did nothing at all. A control
                  that silently no-ops is worse than one that is absent.

                  The parent now supplies the behaviour: sharing opens the
                  Partner Access page this Passport already has, and the client
                  request opens the composer over the canonical request
                  operation. Neither knows a DOM id. */}
              <Button size="sm" variant="outline" onClick={onShare} disabled={busy !== null}>
                <Share2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Share Passport
              </Button>
              <Button size="sm" variant="outline" onClick={onRequestClientInformation} disabled={busy !== null}>
                <FileQuestion className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Request client information
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Sharing opens Partner Access, where each partner's readiness and legal route are shown. A client
              request is created through the same operation the case workspace uses, and appears in both places.
            </p>
          </div>

          <div className="rounded-lg border border-dashed border-destructive/40 p-3">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> Restricted actions
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {RESTRICTED.map((a) => (
                <Button
                  key={a.key}
                  size="sm"
                  variant="outline"
                  className="border-destructive/40 text-destructive hover:bg-destructive/10"
                  disabled={!isMlro || busy !== null}
                  onClick={() => { setPending(a); setReason(""); }}
                  title={isMlro ? undefined : "MLRO role required"}
                >
                  {a.key === "suspend"
                    ? <Slash className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                    : <ShieldOff className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
                  {a.title}
                </Button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              MLRO only, and a reason is mandatory. Every action is written to Passport history with the actor and the
              reason; partner portals receive a controlled message and never the internal reason.
            </p>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={pending !== null} onOpenChange={(open) => { if (!open) setPending(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pending?.title}</AlertDialogTitle>
            <AlertDialogDescription>{pending?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="passport-restricted-reason">Reason (recorded on the case timeline)</Label>
            <Textarea
              id="passport-restricted-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why this action is being taken"
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              {reason.trim().length < MIN_REASON
                ? `At least ${MIN_REASON} characters.`
                : "This reason is internal and is never disclosed to a partner."}
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={reason.trim().length < MIN_REASON || busy !== null}
              onClick={(e) => { e.preventDefault(); void confirmRestricted(); }}
            >
              {pending?.confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, Loader2, RotateCcw, ShieldAlert, Trash2 } from "lucide-react";
import { amlCasesApi, type AmlClientResetResult } from "@/lib/aml/amlCasesApi";
import { toast } from "@/hooks/use-toast";

/**
 * Resetting a client's AML/CTF journey.
 *
 * ── Why deleting a client was not simply a delete ─────────────────────
 * `aml.cases.client_id` is `ON DELETE SET NULL`. Deleting a client through
 * the ordinary client API neither fails nor cascades — it ORPHANS the AML
 * case. The customer vanishes from the register while the case, its
 * screening subjects, its determinations and its event chain remain,
 * attached to nobody. Measured in production: one case in six is already in
 * that state.
 *
 * ── What this screen is, and is not ───────────────────────────────────
 * It is not a confirmation dialog bolted onto a delete. The server decides
 * what is permitted and this screen shows that decision:
 *
 *   RESTART  closes the open cases and revokes portal access. Deletes
 *            nothing, so it is always available — including on the cases a
 *            purge is refused for.
 *
 *   PURGE    removes the client and the AML rows that would be orphaned.
 *            Refused, by the server, whenever a case carries evidence that
 *            must be retained.
 *
 * The refusal is the useful part, so it is rendered in full: an operator who
 * is told "this cannot be deleted" and not WHICH record is holding it has
 * been given a dead end. Every blocker names its case reference.
 *
 * The typed confirmation gates both modes. Restarting closes real cases,
 * which is not something to do by mis-click either.
 */
export interface ResetClientJourneyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  /** Display only. The server resolves the authoritative name from the id. */
  clientName: string;
  onReset?: (result: AmlClientResetResult) => void;
}

type Mode = "restart" | "purge";

export function ResetClientJourneyDialog({
  open, onOpenChange, clientId, clientName, onReset,
}: ResetClientJourneyDialogProps) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>("restart");
  const [typed, setTyped] = useState("");
  const [preview, setPreview] = useState<AmlClientResetResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode("restart");
    setTyped("");
    setPreview(null);
  }, [open, clientId]);

  /*
   * The preview is the SERVER's decision, fetched with no confirmation
   * attached. That is deliberate: sending an empty confirmation is refused
   * before anything is touched, and the refusal carries the effects and the
   * blockers. So the operator reads what would happen, and what is stopping
   * it, from the same authority that will act — never from a second copy of
   * the rule living in the browser.
   */
  useEffect(() => {
    if (!open || !clientId) return;
    let cancelled = false;
    setBusy(true);
    amlCasesApi.resetClientJourney({ client_id: clientId, mode, confirmation: null })
      .then((r) => { if (!cancelled) setPreview(r); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [open, clientId, mode]);

  const blockers = preview?.blockers ?? [];
  const purgeRefused = mode === "purge"
    && preview?.code === "retention_evidence";
  const notPermitted = preview?.code === "role_required";

  const nameMatches = useMemo(() => {
    const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
    return norm(typed).length > 0 && norm(typed) === norm(clientName);
  }, [typed, clientName]);

  const canSubmit = nameMatches && !busy && !running && !purgeRefused && !notPermitted;

  const run = async () => {
    setRunning(true);
    try {
      const result = await amlCasesApi.resetClientJourney({
        client_id: clientId, mode, confirmation: typed,
      });
      if (result.error) {
        setPreview(result);
        toast({
          title: mode === "purge" ? "Client not deleted" : "Journey not restarted",
          description: result.error,
          variant: "destructive",
        });
        return;
      }
      toast({
        title: mode === "purge" ? "Client deleted" : "Journey restarted",
        description: result.summary,
      });
      // The register, the case list and any client query all now disagree
      // with the server. Invalidate broadly rather than guess which.
      await queryClient.invalidateQueries();
      onReset?.(result);
      onOpenChange(false);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-panel max-w-2xl">
        <DialogHeader>
          <DialogTitle>Reset {clientName || "this client"}</DialogTitle>
          <DialogDescription>
            Choose what happens to the existing AML/CTF record before a new journey begins.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <ModeCard
              active={mode === "restart"}
              onSelect={() => setMode("restart")}
              icon={<RotateCcw className="h-4 w-4" aria-hidden />}
              title="Restart the journey"
              detail="Close the open cases and revoke portal access. Nothing is deleted."
            />
            <ModeCard
              active={mode === "purge"}
              onSelect={() => setMode("purge")}
              icon={<Trash2 className="h-4 w-4" aria-hidden />}
              title="Delete permanently"
              detail="Remove the client and every AML record attached to them."
              destructive
            />
          </div>

          {busy && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Checking what this client is holding…
            </p>
          )}

          {notPermitted && (
            <Alert variant="destructive">
              <ShieldAlert className="h-4 w-4" aria-hidden />
              <AlertTitle>Not permitted for your role</AlertTitle>
              <AlertDescription>
                Resetting a client journey requires the MLRO or an administrator.
              </AlertDescription>
            </Alert>
          )}

          {purgeRefused && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" aria-hidden />
              <AlertTitle>This client cannot be deleted</AlertTitle>
              <AlertDescription className="space-y-2">
                <ul className="list-disc space-y-1 pl-4">
                  {blockers.map((b) => <li key={b}>{b}</li>)}
                </ul>
                <p>
                  Restart the journey instead — that closes the existing case and lets a
                  new one begin without destroying the record.
                </p>
              </AlertDescription>
            </Alert>
          )}

          {!purgeRefused && !notPermitted && (preview?.effects?.length ?? 0) > 0 && (
            <div className="rounded-lg border border-border/60 p-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                What this will do
              </h3>
              <ul className="list-disc space-y-1 pl-4 text-sm">
                {preview!.effects!.map((e) => <li key={e}>{e}</li>)}
              </ul>
            </div>
          )}

          {!purgeRefused && !notPermitted && (
            <div className="space-y-2">
              <Label htmlFor="reset-confirm">
                Type <span className="font-semibold">{clientName}</span> to confirm
              </Label>
              <Input
                id="reset-confirm"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                placeholder={clientName}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={running}>
            Cancel
          </Button>
          <Button
            variant={mode === "purge" ? "destructive" : "default"}
            onClick={run}
            disabled={!canSubmit}
          >
            {running && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            {mode === "purge" ? "Delete permanently" : "Restart journey"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ModeCard({
  active, onSelect, icon, title, detail, destructive,
}: {
  active: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  detail: string;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={`rounded-lg border p-4 text-left transition-colors ${
        active
          ? destructive
            ? "border-destructive bg-destructive/10"
            : "border-primary bg-primary/10"
          : "border-border/60 hover:border-border"
      }`}
    >
      <span className={`flex items-center gap-2 text-sm font-semibold ${
        destructive ? "text-destructive" : ""
      }`}>
        {icon}
        {title}
      </span>
      <span className="mt-1 block text-xs text-muted-foreground">{detail}</span>
    </button>
  );
}

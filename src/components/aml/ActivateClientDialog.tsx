import { useEffect, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertTriangle, CheckCircle2, Loader2, Mail, Phone, ShieldCheck,
} from "lucide-react";
import {
  amlCasesApi, type AmlActivationClient, type AmlCase,
} from "@/lib/aml/amlCasesApi";
import { amlTenantApi, type AmlActivationProgram } from "@/lib/aml/amlTenantApi";
import { AmlClientPicker, ClientStatusBadge } from "@/components/aml/AmlClientPicker";
import { AmlCreateClientForm } from "@/components/aml/AmlCreateClientForm";
import { toast } from "@/hooks/use-toast";

/**
 * Phase 3 — Activate Client for AML dialog.
 *
 * Enforces the "human-confirmed activation event" rule from AGENTS.md §2.
 * Model B is disabled in the UI until the tenant records legal approval +
 * a program version. Server enforces the same guardrail regardless.
 *
 * This form is the sanctioned place an authorised user confirms an existing
 * client is active and starts AML/CTF compliance: inactive clients are
 * searchable and selectable here, and confirming the form marks them active
 * atomically with case creation (server-side).
 */
export interface ActivateClientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Optional preselection when launched for a specific client (route handoff
   * or client record). Only the ID is trusted — the display name, contact
   * details and active status are loaded server-side from this ID.
   */
  clientId?: string;
  /** Optional display-only fallback while the authoritative record loads. */
  clientName?: string;
  onActivated?: (aCase: AmlCase) => void;
}

function SectionHeading({ title }: { title: string }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
      {title}
    </h3>
  );
}

export function ActivateClientDialog({
  open, onOpenChange, clientId, clientName, onActivated,
}: ActivateClientDialogProps) {
  const queryClient = useQueryClient();

  const [selected, setSelected] = useState<AmlActivationClient | null>(null);
  const [displayName, setDisplayName] = useState(clientName ?? "");
  const [nameDirty, setNameDirty] = useState(false);
  const [subjectType, setSubjectType] = useState<"individual" | "entity" | "trust">("individual");
  const [model, setModel] = useState<"A" | "B">("A");
  const [event, setEvent] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const [program, setProgram] = useState<AmlActivationProgram | null>(null);
  const [loadingProgram, setLoadingProgram] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Route/record handoff: the exact client is loaded and validated
  // server-side from its ID. The browser never supplies name or status.
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);

  // The client picker owns its own browsing, searching, filtering and paging
  // (`AmlClientPicker`). It reads the same AML-role-gated `search_clients` op
  // this dialog always used — the register is never duplicated here.
  //
  // `create` swaps that picker for a short new-client form. It is the same
  // step of the same dialog, not a second journey: whichever way the client
  // is arrived at, the activation event still has to be stated and confirmed
  // below before a case exists.
  const [mode, setMode] = useState<"pick" | "create">("pick");
  const modelBReady = Boolean(program?.legal_approval && program?.program_version?.trim());

  useEffect(() => {
    if (!open) return;
    setSelected(null);
    setDisplayName(clientName ?? "");
    setNameDirty(false);
    setSubjectType("individual");
    setModel("A");
    setEvent("");
    setReason("");
    setConfirmed(false);
    setSubmitAttempted(false);
    setSubmitError(null);
    setRouteError(null);
    setMode("pick");

    let alive = true;

    if (clientId) {
      setRouteLoading(true);
      amlCasesApi.getClientForActivation(clientId)
        .then((res) => {
          if (!alive) return;
          setSelected(res.client);
          // The subject display name comes from the authoritative record, not
          // from the URL or any caller-supplied label.
          setDisplayName(res.client.label);
        })
        .catch((e: any) => {
          if (!alive) return;
          setRouteError(e?.message ?? "This client could not be loaded.");
        })
        .finally(() => { if (alive) setRouteLoading(false); });
    } else {
      setRouteLoading(false);
    }

    setLoadingProgram(true);
    amlTenantApi.getActivationProgram()
      .then((p) => { if (alive) setProgram(p); })
      .catch(() => { if (alive) setProgram(null); })
      .finally(() => { if (alive) setLoadingProgram(false); });

    return () => { alive = false; };
  }, [open, clientId, clientName]);

  const selectClient = (c: AmlActivationClient) => {
    setSelected(c);
    if (!nameDirty || !displayName.trim()) setDisplayName(c.label);
    /*
     * Put the cursor on the next thing that is actually required. Choosing a
     * client is the visible half of this form; the activation event is the
     * half that decides whether the button works, and it sits below the
     * fold on a short window. Landing there is the difference between "two
     * steps left" being a hint and being a nudge.
     */
    requestAnimationFrame(() => {
      document.getElementById("ac-event")?.focus();
    });
  };

  const clearSelection = () => {
    setSelected(null);
    if (!nameDirty) setDisplayName("");
  };

  /**
   * What is still missing, in the order the form asks for it.
   *
   * ── Why this is a list and not a boolean ──────────────────────────────
   * `canSubmit` used to be the only expression of this, so the Activate
   * button was simply disabled — styled as the primary action, giving no
   * reason, pointing at nothing. An operator who had just created a client
   * pressed it, nothing happened, and the reasonable conclusion was "I
   * cannot create a client, and it stays inactive". That happened in
   * production: four identical clients were created in 45 minutes by
   * somebody trying to get past a button that never explained itself.
   *
   * The requirements are unchanged — a case still opens only after a
   * human-confirmed activation event (AGENTS.md §2). They are just SAID now.
   */
  const missing: string[] = [];
  if (!selected) missing.push("Select or create a client");
  else if (selected.has_open_case) missing.push("This client already has an open case");
  if (selected && !displayName.trim()) missing.push("Enter the subject display name");
  if (selected && event.trim().length < 3) missing.push("Name the activation event");
  if (selected && reason.trim().length < 10) {
    missing.push("Describe the reason and evidence (at least 10 characters)");
  }
  if (selected && model === "B" && !modelBReady) {
    missing.push("Pre-service activation is not approved for this tenant");
  }
  if (selected && !confirmed) missing.push("Tick the confirmation");

  const canSubmit =
    missing.length === 0 && !routeError && !routeLoading;

  /*
   * The primary action is never silently disabled — that is the whole point
   * of the note above. It stays pressable while requirements are
   * outstanding, and pressing it NAMES the first one and moves focus there.
   * Only an in-flight submission disables it.
   */
  const firstBlocker = routeLoading
    ? { id: "ac-client-section", message: "The client record is still loading." }
    : !selected
    ? { id: "ac-client-section", message: "Select or create a client before activating AML/CTF." }
    : selected.has_open_case
      ? { id: "ac-client-section", message: "This client already has an open AML/CTF case." }
      : !displayName.trim()
        ? { id: "ac-name", message: "Enter the AML subject's legal display name." }
        : event.trim().length < 3
          ? { id: "ac-event", message: "Enter the activation event that has occurred." }
          : reason.trim().length < 10
            ? { id: "ac-reason", message: "Record at least 10 characters of reason and evidence." }
            : model === "B" && !modelBReady
              ? { id: "ac-timing", message: "Model B requires legal approval and a program version." }
              : !confirmed
                ? { id: "ac-confirmation", message: "Confirm the activation event before continuing." }
                : null;

  const finishActivation = async (created: AmlCase, clientMarkedActive: boolean, note?: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["clients"] }),
      queryClient.invalidateQueries({ queryKey: ["client-details", selected?.id] }),
      queryClient.invalidateQueries({ queryKey: ["aml-client-summary", selected?.id] }),
      queryClient.invalidateQueries({ queryKey: ["secure-client-data", selected?.id] }),
      queryClient.invalidateQueries({ queryKey: ["secure-client", selected?.id] }),
    ]);

    const activatedNote = clientMarkedActive
      ? "The client record has been marked active. " : "";
    toast({
      title: "Client activated for AML",
      description: `${created.case_reference} opened. ${activatedNote}${note ?? ""}`.trim(),
    });
    onActivated?.(created);
    onOpenChange(false);
  };

  const handleSubmit = async (submitEvent?: FormEvent) => {
    submitEvent?.preventDefault();
    setSubmitAttempted(true);
    setSubmitError(null);
    if (!canSubmit || !selected) {
      if (firstBlocker) {
        setSubmitError(firstBlocker.message);
        requestAnimationFrame(() => {
          const target = document.getElementById(firstBlocker.id);
          if (typeof target?.scrollIntoView === "function") {
            target.scrollIntoView({ block: "center", behavior: "smooth" });
          }
          target?.focus({ preventScroll: true });
        });
      }
      return;
    }
    setSubmitting(true);
    try {
      const { case: created, client_activation, client_portal } =
        await amlCasesApi.activateClient({
          client_id: selected.id,
          subject_display_name: displayName.trim(),
          subject_type: subjectType,
          activation_model: model,
          activation_event: event.trim(),
          reason: reason.trim(),
          human_confirmed: true,
        });
      if (!created?.id || created.client_id !== selected.id) {
        throw new Error("The activation response did not contain the linked AML case.");
      }
      await finishActivation(created, Boolean(client_activation?.marked_active), client_portal?.note);
    } catch (e: any) {
      // The client+case transaction may have committed even if the response or
      // a later notification failed. Re-read the authoritative summary before
      // inviting a retry, otherwise a successful activation becomes a false
      // failure followed by a confusing duplicate-case error.
      try {
        const summary = await amlCasesApi.clientSummary(selected.id);
        if (summary.has_open_case && summary.case?.client_id === selected.id) {
          await finishActivation(
            summary.case,
            selected.is_active !== true,
            "The activation was confirmed from the client record after the original response was interrupted.",
          );
          return;
        }
      } catch {
        // Preserve and surface the original activation error below.
      }
      const message = e?.message ?? "Unknown error";
      setSubmitError(message);
      toast({ title: "Activation failed", description: message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const formUsable = !routeError;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="activate-client-dialog"
        className="flex max-h-[92vh] w-full flex-col gap-0 overflow-hidden p-0 pb-0 sm:max-h-[min(88vh,53rem)] sm:w-[min(calc(100vw-2rem),780px)] sm:max-w-[780px] sm:p-0"
      >
        <form className="contents" onSubmit={handleSubmit} noValidate>
        <DialogHeader className="shrink-0 border-b border-border/60 px-5 py-4 text-left sm:px-6">
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 shrink-0 text-primary" />
            Activate client for AML/CTF
          </DialogTitle>
          <DialogDescription>
            Cases open only for real clients after a human-confirmed activation
            event. Marketing leads never auto-generate a case.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overflow-x-hidden px-5 py-4 sm:px-6 sm:py-5">
          {routeError ? (
            <Alert variant="destructive" role="alert">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>This client could not be loaded</AlertTitle>
              <AlertDescription>
                {routeError} The activation form is unavailable until a valid,
                accessible client is selected. Close this dialog and try again
                from the client record.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              {/* 1 — Selected client */}
              <section id="ac-client-section" className="space-y-3" aria-label="Selected client" tabIndex={-1}>
                <SectionHeading title="1 · Selected client" />
                {routeLoading ? (
                  <div
                    className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-4 py-6 text-sm text-muted-foreground"
                    role="status"
                  >
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading client…
                  </div>
                ) : selected ? (
                  <div
                    className="space-y-2.5 rounded-lg border border-border/60 bg-muted/30 p-4"
                    data-testid="ac-selected-client"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 space-y-1">
                        <p className="break-words font-medium leading-tight">{selected.label}</p>
                        {selected.email && (
                          <p className="flex min-w-0 items-center gap-1.5 break-all text-xs text-muted-foreground">
                            <Mail className="h-3.5 w-3.5 shrink-0" /> {selected.email}
                          </p>
                        )}
                        {selected.mobile && (
                          <p className="flex min-w-0 items-center gap-1.5 break-words text-xs text-muted-foreground">
                            <Phone className="h-3.5 w-3.5 shrink-0" /> {selected.mobile}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <ClientStatusBadge active={selected.is_active} />
                        {!clientId && (
                          <Button
                            type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs"
                            onClick={clearSelection}
                          >
                            Change
                          </Button>
                        )}
                      </div>
                    </div>

                    {selected.is_active ? (
                      <p className="flex items-center gap-1.5 text-xs text-success">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> Active client
                      </p>
                    ) : (
                      <p className="flex items-start gap-1.5 text-xs text-warning">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        Inactive client — this client will be marked active when
                        AML/CTF activation is confirmed.
                      </p>
                    )}

                    {selected.has_open_case && (
                      <Alert variant="destructive" role="alert">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>Open case exists</AlertTitle>
                        <AlertDescription>
                          An open AML/CTF case already exists for this client.
                          {selected.open_case?.case_reference
                            ? ` (${selected.open_case.case_reference})` : ""}{" "}
                          A second open case cannot be started.
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                ) : mode === "create" ? (
                  <AmlCreateClientForm
                    disabled={submitting}
                    onCancel={() => setMode("pick")}
                    onCreated={(c) => { selectClient(c); setMode("pick"); }}
                    onUseExisting={(c) => { selectClient(c); setMode("pick"); }}
                  />
                ) : (
                  <AmlClientPicker
                    resetKey={open}
                    disabled={submitting}
                    onSelect={selectClient}
                    onCreateNew={() => setMode("create")}
                  />
                )}
              </section>

              {/* 2 — AML subject details */}
              <section className="space-y-3" aria-label="AML subject details">
                <SectionHeading title="2 · AML subject details" />
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="ac-name">Subject display name</Label>
                    <Input
                      id="ac-name"
                      value={displayName}
                      onChange={(e) => { setDisplayName(e.target.value); setNameDirty(true); }}
                      placeholder="Full legal name"
                      aria-invalid={submitAttempted && !displayName.trim()}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ac-subject-type">Subject type</Label>
                    <Select value={subjectType} onValueChange={(v: any) => setSubjectType(v)}>
                      <SelectTrigger id="ac-subject-type"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="individual">Individual</SelectItem>
                        <SelectItem value="entity">Entity / company</SelectItem>
                        <SelectItem value="trust">Trust</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </section>

              {/* 3 — Activation details */}
              <section className="space-y-3" aria-label="Activation details">
                <SectionHeading title="3 · Activation details" />
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="ac-timing">Activation timing</Label>
                    <Select value={model} onValueChange={(v: any) => setModel(v)}>
                      <SelectTrigger id="ac-timing" className="[&>span]:truncate"><SelectValue /></SelectTrigger>
                      <SelectContent className="max-w-[min(90vw,32rem)]">
                        <SelectItem value="A" className="whitespace-normal">
                          At service trigger — agreement in place
                        </SelectItem>
                        <SelectItem value="B" disabled={!modelBReady} className="whitespace-normal">
                          Before service — conditional agreement{modelBReady ? "" : " (not available)"}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ac-event">Activation event</Label>
                    <Input
                      id="ac-event"
                      value={event}
                      onChange={(e) => setEvent(e.target.value)}
                      placeholder="e.g. Signed engagement letter"
                      aria-invalid={submitAttempted && event.trim().length < 3}
                    />
                  </div>
                </div>

                {model === "B" && !modelBReady && !loadingProgram && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Pre-service activation is not available yet</AlertTitle>
                    <AlertDescription>
                      Starting compliance before the service requires recorded legal approval and a
                      program version in Configuration. Use the service-trigger option, or complete
                      the program setup first.
                    </AlertDescription>
                  </Alert>
                )}

                {model === "B" && modelBReady && (
                  <Alert>
                    <ShieldCheck className="h-4 w-4" />
                    <AlertTitle>Pre-service activation — program v{program?.program_version}</AlertTitle>
                    <AlertDescription>
                      Legal approval recorded{program?.approved_at ? ` on ${new Date(program.approved_at).toLocaleDateString('en-AU')}` : ""}.
                      The designated service stays locked until the compliance gate is approved.
                    </AlertDescription>
                  </Alert>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="ac-reason">Reason &amp; evidence (min 10 chars)</Label>
                  <Textarea
                    id="ac-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={3}
                    placeholder="Describe the trigger, evidence source and why AML activation is warranted."
                    aria-invalid={submitAttempted && reason.trim().length < 10}
                  />
                </div>
              </section>

              {/* 4 — Confirmation */}
              <section id="ac-confirmation" className="space-y-3" aria-label="Confirmation" tabIndex={-1}>
                <SectionHeading title="4 · Confirmation" />

                {selected && !selected.is_active && !selected.has_open_case && (
                  <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Inactive client</AlertTitle>
                    <AlertDescription>
                      This client is currently inactive. Confirming this form will
                      activate the client and start AML/CTF compliance.
                    </AlertDescription>
                  </Alert>
                )}

                <label className="flex items-start gap-2.5 text-sm">
                  <Checkbox
                    checked={confirmed}
                    onCheckedChange={(v) => setConfirmed(Boolean(v))}
                    className="mt-0.5"
                    aria-label="Confirm activation event"
                  />
                  <span className="text-muted-foreground">
                    I confirm this activation event has occurred and this is a real
                    client of the business. I understand a tamper-evident audit
                    record will be written.
                  </span>
                </label>
                {submitError && (
                  <Alert variant="destructive" role="alert" data-testid="ac-submit-error">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Activation needs attention</AlertTitle>
                    <AlertDescription>{submitError}</AlertDescription>
                  </Alert>
                )}
              </section>
            </>
          )}
        </div>

        <DialogFooter className="shrink-0 flex-col gap-3 border-t border-border/60 bg-background px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:pb-4">
          {/*
            The button says why it cannot be pressed, beside the button.
            Without this it was a primary-styled control that did nothing and
            explained nothing — which is what made "I still cannot create a
            client, and it shows inactive" the reasonable conclusion.
          */}
          <p
            id="ac-outstanding"
            className="order-2 min-w-0 text-xs text-muted-foreground sm:order-1"
            aria-live="polite"
          >
            {formUsable && missing.length > 0 ? (
              <>
                <span className="font-medium text-foreground">
                  {missing.length} step{missing.length === 1 ? "" : "s"} left:
                </span>{" "}
                {missing.join(" · ")}
              </>
            ) : formUsable ? (
              <span className="flex items-center gap-1.5 text-success">
                <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                Ready to activate
              </span>
            ) : null}
          </p>

          <div className="order-1 flex flex-col-reverse gap-2 sm:order-2 sm:flex-row sm:items-center">
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          {formUsable && (
            <Button
              type="submit"
              className="w-full sm:w-auto"
              onClick={handleSubmit}
              disabled={submitting}
              aria-describedby="ac-outstanding"
            >
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Activate client
            </Button>
          )}
          </div>
        </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

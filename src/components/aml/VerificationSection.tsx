import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, ShieldCheck, AlertTriangle, Eye, FileCheck2, RefreshCw } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  amlVerificationApi, isRetryableProcessingStatus,
  type AmlVerificationCheck, type AmlBiometricAccessEntry, type ProviderReadiness,
} from "@/lib/aml/amlVerificationApi";
import { usePromptDialog } from "@/components/aml/usePromptDialog";
import { displayDateTime } from "@/lib/aml/displayDate";
import { amlCasesApi } from "@/lib/aml/amlCasesApi";

/**
 * The canonical client-request action code for identity verification. The
 * Client Portal routes on this exact value; it is defined once so a second
 * spelling cannot be invented at a call site.
 */
export const IDENTITY_VERIFICATION_ACTION = "complete_identity_verification";

/** Minimal shape of a client request this surface reads. */
interface AmlClientRequest {
  id: string;
  status?: string | null;
  subject?: string | null;
  created_at?: string | null;
  viewed_at?: string | null;
  responded_at?: string | null;
  action_code?: string | null;
}

/**
 * Identity verification — command-centre surface for the self-hosted stack.
 *
 * Two things this deliberately does NOT do:
 *  - It does not move the service gate. A passed check is evidence for a
 *    decision, never the decision.
 *  - It does not render the biometric inline. The image is fetched only on an
 *    explicit, reasoned request, and every fetch is logged.
 */

const STATUS_STYLES: Record<string, string> = {
  passed: "text-success",
  failed: "text-destructive",
  referred: "text-warning",
  exhausted: "text-destructive",
  pending: "text-muted-foreground",
  in_progress: "text-muted-foreground",
  abandoned: "text-muted-foreground",
};

const STATUS_LABELS: Record<string, string> = {
  passed: "Verified",
  failed: "Failed",
  referred: "Needs review",
  exhausted: "Attempts exhausted",
  pending: "Awaiting adjudication",
  in_progress: "Running",
  abandoned: "Abandoned",
};

/**
 * Processing state is separate from the identity outcome and was invisible to
 * staff: a check stranded in `technical_failure` read as "Awaiting
 * adjudication", so nobody could tell an unreachable provider from a customer
 * waiting on a decision, and the `retry_verification_processing` op the server
 * already exposes had no control at all. Found by the staff browser journey.
 */
const PROCESSING_LABELS: Record<string, string> = {
  submitted: "Capture received",
  queued: "Queued for the provider",
  processing: "Running at the provider",
  completed: "Provider run complete",
  capture_unusable: "Capture unusable — new capture needed",
  technical_failure: "Provider or worker failure",
  retry_scheduled: "Retry scheduled",
  dead_lettered: "Processing dead-lettered",
  cancelled: "Processing cancelled",
};

const PROCESSING_STYLES: Record<string, string> = {
  capture_unusable: "text-warning",
  technical_failure: "text-destructive",
  dead_lettered: "text-destructive",
  retry_scheduled: "text-warning",
  processing: "text-muted-foreground",
  queued: "text-muted-foreground",
  submitted: "text-muted-foreground",
  completed: "text-muted-foreground",
  cancelled: "text-muted-foreground",
};

/** Neither an outage nor an unusable capture is the customer's fault. */
const NO_ATTEMPT_PROCESSING = new Set([
  "capture_unusable", "technical_failure", "retry_scheduled", "dead_lettered", "cancelled",
]);

export function VerificationSection({
  caseId, canWrite, onChanged,
}: { caseId: string; canWrite: boolean; onChanged?: () => void }) {
  const [checks, setChecks] = useState<AmlVerificationCheck[] | null>(null);
  const [accessLog, setAccessLog] = useState<AmlBiometricAccessEntry[]>([]);
  const [maxAttempts, setMaxAttempts] = useState(3);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<ProviderReadiness | null>(null);
  const [openRequest, setOpenRequest] = useState<AmlClientRequest | null>(null);
  const { prompt, dialog } = usePromptDialog();

  const refresh = useCallback(async () => {
    try {
      const [res, log, ready, requests] = await Promise.all([
        amlVerificationApi.listVerificationChecks(caseId),
        amlVerificationApi.listBiometricAccess(caseId).catch(() => ({ access_log: [] })),
        // Readiness is advisory: staff need to know an electronic check cannot
        // run right now before they chase the client for another capture. It
        // decides the *method*, never whether the workflow may be requested.
        amlVerificationApi.providerReadiness().catch(() => null),
        amlCasesApi.listClientRequests(caseId).catch(() => ({ requests: [] })),
      ]);
      setChecks(res.checks ?? []);
      setMaxAttempts(res.max_attempts ?? 3);
      setAccessLog(log.access_log ?? []);
      setReadiness(ready);
      // The one unresolved identity-verification request, if any. Its presence
      // is what prevents a second request — not the provider's state.
      setOpenRequest(
        (requests.requests ?? []).find(
          (r: AmlClientRequest) =>
            r?.action_code === IDENTITY_VERIFICATION_ACTION &&
            r?.status !== "resolved" && r?.status !== "cancelled",
        ) ?? null,
      );
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "Unable to load verification checks.");
      setChecks([]);
    }
  }, [caseId]);

  useEffect(() => { refresh(); }, [refresh]);

  /**
   * Ask the client to verify their identity.
   *
   * This creates a workflow request. It does NOT run the provider, which is
   * why provider readiness must not gate it: the legacy panel disabled this
   * button whenever the electronic provider was unavailable, which left staff
   * unable to start verification at all in exactly the situation where the
   * manual document route is the only way forward.
   *
   * Readiness decides the method the client is routed to, and the message
   * says which one they are getting. Nothing synthetic is created here and no
   * customer attempt is consumed.
   */
  const requestVerification = async () => {
    setBusy("request");
    try {
      const electronic = readiness?.idv?.state === "ready_live";
      // A hosted provider runs the capture itself, so the client is not asked
      // to upload anything — they complete it in the portal. Telling them to
      // "upload a document, no selfie needed" while the portal offers the photo
      // flow is the contradiction this distinction exists to avoid.
      const hosted = readiness?.idv?.idv_flow === "hosted_session";
      await amlCasesApi.createClientRequest({
        case_id: caseId,
        kind: "additional_info",
        subject: "Identity verification",
        message: electronic && hosted
          ? "Please complete identity verification in your client portal. You will be guided "
            + "through a secure identity check on your own device: photograph your identity "
            + "document, then your face. It only takes a minute."
          : electronic
            ? "Please complete identity verification in your client portal: you will be asked to "
              + "photograph your identity document and take a selfie. It only takes a few minutes."
            : "Please upload a current identity document (passport or driver licence) in your client "
              + "portal so we can verify your identity. You do not need to take a selfie.",
        // Canonical vocabulary (`CLIENT_ACTION_CODES`), not a free-text
        // payload: the portal only projects an action it recognises, and
        // `action_target.target_step` is the whitelisted routing field — no
        // URL is ever accepted. Readiness is resolved here, at request time,
        // so the client is never sent to a capture step that cannot run.
        action_code: IDENTITY_VERIFICATION_ACTION,
        action_target: { target_step: electronic ? "identity_verification" : "upload_document" },
      });
      toast({
        title: "Verification requested",
        description: electronic
          ? "The client will see the request in their portal. The result returns to this case for review."
          : "The client will be asked to upload an identity document. Record a sighting here once it arrives.",
      });
      await refresh();
      onChanged?.();
    } catch (e: any) {
      toast({
        title: "Could not request verification",
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const adjudicate = async (check: AmlVerificationCheck) => {
    setBusy(check.id);
    try {
      await amlVerificationApi.runVerification(check.id);
      toast({ title: "Verification adjudicated" });
      await refresh();
      onChanged?.();
    } catch (e: any) {
      toast({
        title: "Could not adjudicate",
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  /**
   * Re-run the provider after a technical failure. The server refuses anything
   * else with `retry_not_eligible`, and a retry never consumes a further
   * customer attempt — so this is safe to offer whenever it is enabled.
   */
  const retryProcessing = async (check: AmlVerificationCheck) => {
    setBusy(check.id);
    try {
      await amlVerificationApi.retryVerificationProcessing(check.id);
      toast({
        title: "Processing retried",
        description: "The provider will run again. No further client attempt was used.",
      });
      await refresh();
      onChanged?.();
    } catch (e: any) {
      toast({
        title: "Could not retry processing",
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const viewBiometric = async (check: AmlVerificationCheck) => {
    const values = await prompt({
      title: "View retained biometric",
      description:
        "This image is sensitive information. Your name, the time and the reason " +
        "below are written to the access log and to the case timeline.",
      confirmLabel: "View image",
      fields: [{
        name: "reason", label: "Reason for viewing", type: "textarea",
        required: true, minLength: 10,
        helpText: "At least 10 characters. Recorded permanently.",
        placeholder: "e.g. Manual face comparison after a referred automated check…",
      }],
    });
    if (!values) return;

    setBusy(check.id);
    try {
      const { url, expires_in_seconds } = await amlVerificationApi.getBiometricUrl(
        check.id, values.reason);
      window.open(url, "_blank", "noopener,noreferrer");
      toast({
        title: "Access recorded",
        description: `The link expires in ${expires_in_seconds} seconds.`,
      });
      await refresh();
    } catch (e: any) {
      toast({ title: "Could not open image", description: e?.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const recordSighting = async () => {
    const values = await prompt({
      title: "Record a document sighting",
      description:
        "The documentary path is primary evidence under the current design. " +
        "Record exactly what was sighted and by whom.",
      confirmLabel: "Record sighting",
      fields: [
        { name: "party_label", label: "Party verified", required: true,
          placeholder: "Full legal name…" },
        { name: "document_type", label: "Document sighted", required: true,
          placeholder: "e.g. Australian passport · NSW driver licence…" },
        { name: "sighting_kind", label: 'Original or certified copy ("original" / "certified_copy")',
          required: true, placeholder: "original" },
        { name: "certifier_name", label: "Certifier name (certified copies only)",
          placeholder: "Leave blank for an original…" },
        { name: "certifier_capacity", label: "Certifier capacity (certified copies only)",
          placeholder: "e.g. Justice of the Peace, pharmacist…" },
        { name: "notes", label: "What you sighted and how", type: "textarea",
          required: true, minLength: 10,
          helpText: "At least 10 characters. This is the evidence record." },
      ],
    });
    if (!values) return;

    const kind = values.sighting_kind?.trim().toLowerCase();
    if (kind !== "original" && kind !== "certified_copy") {
      toast({
        title: "Invalid sighting type",
        description: 'Enter "original" or "certified_copy".',
        variant: "destructive",
      });
      return;
    }

    setBusy("sighting");
    try {
      await amlVerificationApi.recordDocumentSighting({
        case_id: caseId,
        party_label: values.party_label,
        document_type: values.document_type,
        sighting_kind: kind,
        certifier_name: values.certifier_name || undefined,
        certifier_capacity: values.certifier_capacity || undefined,
        notes: values.notes,
      });
      toast({ title: "Document sighting recorded" });
      await refresh();
      onChanged?.();
    } catch (e: any) {
      toast({ title: "Could not record sighting", description: e?.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>What these checks do and do not establish</AlertTitle>
        <AlertDescription className="text-xs">
          Documents are <strong>not</strong> checked against the issuing authority — there is no
          DVS connection. Liveness is a heuristic signal, not proof. A passed check is evidence
          towards a decision; it never approves the service gate on its own. For higher-risk
          matters, sight an original or certified copy.
        </AlertDescription>
      </Alert>

      {/* Provider readiness. Without this staff could not tell "the provider
          refused to run" from "nobody has run it yet", and would chase the
          client for another capture that could not be processed either. */}
      {readiness?.idv && (() => {
        const ready = readiness.idv.state === "ready_live";
        return (
          <Alert variant={ready ? "default" : "destructive"}>
            <ShieldCheck className="h-4 w-4" />
            <AlertTitle className="text-sm">
              Electronic verification: {ready ? "available" : "not available"}
            </AlertTitle>
            <AlertDescription className="text-xs">
              {ready
                ? "The configured provider is live. Captures submitted by the client are processed automatically."
                : "Electronic verification is currently unavailable. Request documents and complete manual "
                  + "verification. Requesting verification still works — the client is routed to document "
                  + "upload instead of capture, and no customer attempt is consumed."}
              {` (${readiness.idv.state.replace(/_/g, " ")})`}
            </AlertDescription>
          </Alert>
        );
      })()}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" /> Identity verification
          </CardTitle>
          {canWrite && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={recordSighting} disabled={busy === "sighting"}>
                {busy === "sighting" && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                <FileCheck2 className="mr-1.5 h-3.5 w-3.5" /> Record sighting
              </Button>
              {/* Enabled whenever the user may write and no identity request is
                  still outstanding. Provider readiness is deliberately absent
                  from this condition — see `requestVerification`. */}
              <Button
                size="sm"
                onClick={requestVerification}
                disabled={busy === "request" || Boolean(openRequest)}
              >
                {busy === "request"
                  ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  : <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />}
                Request identity verification
              </Button>
            </div>
          )}
        </CardHeader>

        <CardContent className="space-y-3 text-sm">
          {/* Why the request button is disabled. A disabled control with no
              stated reason is indistinguishable from a broken one. */}
          {openRequest && (
            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs">
              <span className="font-medium">Identity verification already requested.</span>{" "}
              <span className="text-muted-foreground">
                Sent {displayDateTime(openRequest.created_at)}
                {openRequest.viewed_at ? ` · client viewed ${displayDateTime(openRequest.viewed_at)}` : " · not yet viewed"}
                {openRequest.responded_at ? ` · responded ${displayDateTime(openRequest.responded_at)}` : ""}
                . Resolve it before sending another.
              </span>
            </div>
          )}
          {error ? (
            <p className="text-muted-foreground">{error}</p>
          ) : checks === null ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : checks.length === 0 ? (
            <p className="text-muted-foreground">
              No verification attempts yet. The client is prompted for these in their portal,
              or you can record a document sighting.
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {checks.map((c) => (
                <li key={c.id} className="space-y-1.5 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-medium">{c.party_label}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {c.check_type === "document_sighting" ? "Document sighting" : "Electronic check"}
                        {/* An absent attempt number used to print
                            "attempt undefined of 3" to compliance staff.
                            `attempt_number` is nullable on rows created before
                            the canonical model, so omit the clause rather than
                            interpolate nothing. Found by the staff browser
                            journey. */}
                        {c.check_type === "electronic_idv" &&
                          Number.isFinite(Number(c.attempt_number)) &&
                          ` · attempt ${c.attempt_number} of ${maxAttempts}`}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {c.execution_mode === "simulation" && (
                        <Badge variant="outline" className="text-warning">
                          Test simulation — not compliance evidence
                        </Badge>
                      )}
                      {c.processing_status && c.processing_status !== "completed" && (
                        <Badge variant="outline" className={PROCESSING_STYLES[c.processing_status] ?? ""}>
                          {PROCESSING_LABELS[c.processing_status] ?? c.processing_status}
                        </Badge>
                      )}
                      <Badge variant="outline" className={STATUS_STYLES[c.status] ?? ""}>
                        {STATUS_LABELS[c.status] ?? c.status}
                      </Badge>
                    </div>
                  </div>

                  {/* Attempt accounting, stated rather than implied: an outage
                      or an unusable capture must be visibly free. */}
                  {c.check_type === "electronic_idv" && c.processing_status && (
                    <div className="text-xs text-muted-foreground">
                      {c.attempt_consumed
                        ? "This attempt counted towards the client's allowance."
                        : NO_ATTEMPT_PROCESSING.has(c.processing_status)
                          ? "No client attempt was used."
                          : "No client attempt has been used yet."}
                      {c.provider_error_category &&
                        ` · ${c.provider_error_category.replace(/_/g, " ")}`}
                      {c.processing_attempts != null && c.processing_attempts > 1 &&
                        ` · ${c.processing_attempts} processing attempts`}
                    </div>
                  )}

                  {c.check_type === "document_sighting" && c.outcome_detail && (
                    <div className="text-xs text-muted-foreground">
                      {c.outcome_detail.document_type}
                      {" · "}
                      {String(c.outcome_detail.sighting_kind ?? "").replace("_", " ")}
                      {c.outcome_detail.certifier_name &&
                        ` · certified by ${c.outcome_detail.certifier_name} (${c.outcome_detail.certifier_capacity})`}
                    </div>
                  )}

                  {Array.isArray(c.outcome_detail?.checks) && (
                    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                      {c.outcome_detail.checks.map((sub: any) => (
                        <li key={sub.name} className={
                          sub.status === "pass" ? "text-success"
                            : sub.status === "fail" ? "text-destructive" : "text-warning"
                        } title={sub.detail ?? ""}>
                          {sub.name.replace(/_/g, " ")}: {sub.status}
                        </li>
                      ))}
                    </ul>
                  )}

                  {/*
                    Hosted-provider evidence, read from the canonical row.
                    There is no separate Didit record to consult — the summary
                    written into `outcome_detail` IS the evidence, and it is
                    allow-listed at the boundary: statuses, scores and warning
                    categories only. No image, no session URL, no session
                    token, no document data.
                  */}
                  {c.outcome_detail?.didit && (
                    <DiditEvidence detail={c.outcome_detail.didit} reference={c.provider_reference} />
                  )}

                  {c.failure_reason && (
                    <div className="text-xs text-destructive">{c.failure_reason}</div>
                  )}

                  {canWrite && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {/*
                        "Run check" adjudicates NPC-held captures through the
                        self-hosted service. A hosted-provider check has none —
                        the customer captured on the provider's UI and NPC
                        stored no images — so pressing it could only produce a
                        storage error against a client whose verification is
                        proceeding normally somewhere else. Offer it only where
                        there is something to run.
                      */}
                      {["pending", "in_progress"].includes(c.status)
                        && c.check_type === "electronic_idv"
                        && c.provider !== "didit" && (
                        <Button size="sm" variant="outline" className="h-7 text-xs"
                          onClick={() => adjudicate(c)} disabled={busy === c.id}>
                          {busy === c.id && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
                          Run check
                        </Button>
                      )}
                      {isRetryableProcessingStatus(c.processing_status) && (
                        <Button size="sm" variant="outline" className="h-7 text-xs"
                          onClick={() => retryProcessing(c)} disabled={busy === c.id}>
                          {busy === c.id && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
                          <RefreshCw className="mr-1.5 h-3 w-3" /> Retry processing
                        </Button>
                      )}
                      {c.has_biometric && (
                        <Button size="sm" variant="ghost" className="h-7 text-xs"
                          onClick={() => viewBiometric(c)} disabled={busy === c.id}>
                          <Eye className="mr-1.5 h-3 w-3" /> View image (logged)
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {accessLog.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Biometric access log</CardTitle>
          </CardHeader>
          <CardContent className="text-xs">
            <ul className="divide-y divide-border/60">
              {accessLog.slice(0, 10).map((a) => (
                <li key={a.id} className="flex justify-between gap-3 py-2">
                  <span>
                    <span className="font-medium">{a.actor_label ?? "Unknown"}</span>
                    {" — "}{a.action}
                    {a.reason && <span className="text-muted-foreground"> · {a.reason}</span>}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {displayDateTime(a.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {dialog}
    </div>
  );
}

/* ──────────────────────── hosted-provider evidence ───────────────────────── */

/** Per-feature status → the tone staff read it in. */
const DIDIT_FEATURE_TONE: Record<string, string> = {
  Approved: "text-success",
  Declined: "text-destructive",
  "In Review": "text-warning",
  "Not Finished": "text-muted-foreground",
};

/**
 * What a hosted identity verification established, for the adjudicator.
 *
 * Shows the three modules NPC requires by name and states plainly when one did
 * not run — because that is precisely the case where an `Approved` session must
 * NOT read as a pass, and a reviewer looking at a referral needs to see why.
 *
 * Everything rendered here comes from the allow-listed summary written at the
 * webhook boundary. There is no code path from this component to a raw
 * provider payload, an image, or a session credential.
 */
function DiditEvidence({ detail, reference }: {
  detail: Record<string, any>;
  reference: string | null;
}) {
  const features: any[] = Array.isArray(detail.features) ? detail.features : [];
  const missing = features.filter((f) => !f.executed);

  return (
    <div className="space-y-1 text-xs">
      <div className="text-muted-foreground">
        Didit hosted verification
        {detail.session_status && ` · ${detail.session_status}`}
        {detail.environment === "sandbox" && (
          <span className="ml-1.5 text-warning">sandbox — not compliance evidence</span>
        )}
      </div>

      {features.length > 0 && (
        <ul className="flex flex-wrap gap-x-3 gap-y-1">
          {features.map((f) => (
            <li
              key={f.feature}
              className={f.executed
                ? (DIDIT_FEATURE_TONE[f.status] ?? "text-warning")
                : "text-warning"}
              title={(f.warnings ?? []).join(", ")}
            >
              {f.label ?? f.feature}: {f.executed ? f.status : "not run"}
              {typeof f.score === "number" && ` (${Math.round(f.score)})`}
            </li>
          ))}
        </ul>
      )}

      {missing.length > 0 && (
        <div className="text-warning">
          Required evidence incomplete — {missing.map((f) => f.label ?? f.feature).join(", ")}
          {" "}did not produce a result, so this cannot be recorded as a pass.
        </div>
      )}

      {reference && (
        <div className="text-muted-foreground">Provider session {reference}</div>
      )}

      {/* An identity result is not an AML outcome. Stated on the record the
          adjudicator actually reads, because "verified" is the word most
          likely to be mistaken for "cleared". */}
      <div className="text-muted-foreground">
        Identity evidence only — screening, PEP, EDD and risk are assessed separately.
      </div>
    </div>
  );
}

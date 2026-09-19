/**
 * Persistent AML/CTF summary on the master client record (directive §13,
 * tri-portal Phase 4). Standing status card: before activation it explains
 * eligibility and offers the direct activation action; after activation it
 * shows stage, portal status, service gate, progress and outstanding items
 * with a deep link into the case.
 *
 * Deliberately a summary — detailed AML processing stays in the dedicated
 * case workspace (§13.3). Renders nothing for users without AML access or
 * while the module flag is off.
 *
 * Activation hands off by ROUTE (`/admin/aml/cases?activateClientId=<id>`)
 * so there is exactly one activation dialog in the product, the AML Cases
 * page loads the client server-side, and the URL carries only the client ID.
 */
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useAmlAccess } from "@/hooks/useAmlAccess";
import { useAmlV3Flags } from "@/lib/aml/useAmlV3Flags";
import { amlCasesApi, type AmlCase } from "@/lib/aml/amlCasesApi";
import {
  CASE_STAGE_LABELS, CLIENT_PORTAL_STATUS_LABELS, caseStage, clientPortalStatus,
  serviceGateStatus,
} from "@/lib/aml/caseDimensions";

const GATE_LABELS: Record<string, string> = {
  not_activated: "Not activated",
  cdd_incomplete: "CDD incomplete",
  information_outstanding: "Information outstanding",
  under_review: "Under review",
  conditions_outstanding: "Conditions outstanding",
  approved_with_controls: "Approved with controls",
  approved: "Approved",
  locked: "Locked",
  terminated: "Terminated",
};

interface Props {
  clientId: string;
  clientName?: string;
  /** Real `clients.is_active` — drives the activation label only. */
  isActive?: boolean | null;
}

export function ClientAmlSummaryCard({ clientId, clientName, isActive }: Props) {
  const access = useAmlAccess();
  const { caseWorkspace } = useAmlV3Flags();
  const navigate = useNavigate();

  // The direct activation action is available whenever the AML module is
  // enabled and the user holds an AML write role. It is deliberately not
  // hidden behind the separate `startClientCompliance` rollout flag — the
  // server enforces the same permission checks regardless.
  const eligible = Boolean(
    !access.loading && access.flagEnabled && access.hasAnyRole && clientId,
  );

  const { data, isLoading } = useQuery({
    queryKey: ["aml-client-summary", clientId],
    queryFn: () => amlCasesApi.clientSummary(clientId),
    enabled: eligible,
  });

  if (!eligible) return null;

  const openCase = (c: AmlCase) => {
    if (caseWorkspace) navigate(`/admin/aml/cases/${c.id}`);
    else navigate(`/admin/aml/cases?open=${c.id}`);
  };

  // Route handoff carries the client ID only — never a name or email.
  const startActivation = () => navigate(`/admin/aml/cases?activateClientId=${clientId}`);

  const activateLabel = isActive === true ? "Start AML/CTF" : "Activate for AML/CTF";

  const c = data?.case ?? null;
  const hasOpenCase = Boolean(data?.has_open_case);
  const progress = data?.requirement_progress ?? null;
  const openRequests = data?.open_client_requests ?? 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div>
            <CardTitle className="text-sm">Identity &amp; compliance</CardTitle>
            <p className="text-xs text-muted-foreground">AML/CTF status for this client</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading || data === undefined ? (
          <Skeleton className="h-16 w-full" />
        ) : !c ? (
          <>
            <p className="text-sm text-muted-foreground">
              Compliance has not started{clientName ? ` for ${clientName}` : ""}.
              Activating opens a case, invites the client into their secure
              portal and starts identity checks — it needs a human-confirmed
              activation event.
            </p>
            {access.canWrite && (
              <Button size="sm" onClick={startActivation}>
                <ShieldCheck className="mr-2 h-4 w-4" /> {activateLabel}
              </Button>
            )}
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{CASE_STAGE_LABELS[caseStage(c)]}</Badge>
              <Badge variant="outline">
                Client portal: {CLIENT_PORTAL_STATUS_LABELS[clientPortalStatus(c)]}
              </Badge>
              <Badge
                variant="outline"
                className={
                  ["approved", "approved_with_controls"].includes(serviceGateStatus(c))
                    ? "border-success/40 text-success"
                    : serviceGateStatus(c) === "locked"
                      ? "border-destructive/40 text-destructive"
                      : "border-muted-foreground/30 text-muted-foreground"
                }
              >
                Service: {GATE_LABELS[serviceGateStatus(c)]}
              </Badge>
            </div>

            {progress && progress.total > 0 && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Required documents</span>
                  <span>{progress.completed} of {progress.total}</span>
                </div>
                <Progress
                  value={(progress.completed / progress.total) * 100}
                  aria-label="Required document progress"
                />
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                {c.case_reference}
                {openRequests > 0
                  ? ` · ${openRequests} open request${openRequests === 1 ? "" : "s"} with the client`
                  : ""}
              </span>
              <span>Updated {new Date(c.updated_at).toLocaleDateString('en-AU')}</span>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => openCase(c)}>
                Open AML case <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              {/* Duplicate prevention: a new activation is offered only when no
                  open case exists (cleared/blocked/closed cases don't block —
                  the backend permits a fresh case for those). */}
              {!hasOpenCase && access.canWrite && (
                <Button size="sm" variant="outline" onClick={startActivation}>
                  <ShieldCheck className="mr-2 h-4 w-4" /> Start new compliance case
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

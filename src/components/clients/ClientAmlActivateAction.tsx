/**
 * Direct AML/CTF activation action for the client details header.
 *
 * Renders one status-appropriate button:
 *  - inactive client, no open case → "Activate for AML/CTF"
 *  - active client, no open case   → "Start AML/CTF"
 *  - open case exists              → "Open AML Case" (navigates to the case)
 *
 * The activation buttons hand off by ROUTE (`/admin/aml/cases?activateClientId=
 * <client-id>`) so there is exactly one activation dialog in the product and
 * the URL carries only the client ID — never a name, email or status. The AML
 * Cases page loads and validates the client server-side before preselecting it.
 *
 * Visible whenever the AML module is enabled and the staff user holds an AML
 * write role. Deliberately NOT gated behind the `startClientCompliance`
 * rollout flag — that flag scopes the summary-card rollout, not the user's
 * authority to activate; the server enforces the same permission regardless.
 */
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAmlAccess } from "@/hooks/useAmlAccess";
import { useAmlV3Flags } from "@/lib/aml/useAmlV3Flags";
import { amlCasesApi } from "@/lib/aml/amlCasesApi";

interface Props {
  clientId: string;
  /** Authoritative `clients.is_active` — never derived from `is_favorite`. */
  isActive?: boolean | null;
  /** Compact labels for narrow toolbars. */
  compact?: boolean;
}

export function ClientAmlActivateAction({ clientId, isActive, compact }: Props) {
  const access = useAmlAccess();
  const { caseWorkspace } = useAmlV3Flags();
  const navigate = useNavigate();

  const enabled = Boolean(
    !access.loading && access.flagEnabled && access.hasAnyRole && access.canWrite && clientId,
  );

  const { data: summary } = useQuery({
    queryKey: ["aml-client-summary", clientId],
    queryFn: () => amlCasesApi.clientSummary(clientId),
    enabled,
    staleTime: 30_000,
  });

  if (!enabled || !summary) return null;

  if (summary.has_open_case && summary.case) {
    const caseId = summary.case.id;
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          navigate(caseWorkspace
            ? `/admin/aml/cases/${caseId}`
            : `/admin/aml/cases?open=${caseId}`)}
        title={`Open AML case ${summary.case.case_reference}`}
      >
        <ExternalLink className="h-4 w-4 mr-1.5" />
        <span className={compact ? "text-xs" : ""}>Open AML Case</span>
      </Button>
    );
  }

  const label = isActive === true ? "Start AML/CTF" : "Activate for AML/CTF";
  return (
    <Button
      variant="outline"
      size="sm"
      // Client ID only — no personal information in the URL.
      onClick={() => navigate(`/admin/aml/cases?activateClientId=${clientId}`)}
      title="Activate this client for AML/CTF compliance"
    >
      <ShieldCheck className="h-4 w-4 mr-1.5" />
      <span className={compact ? "text-xs" : ""}>{label}</span>
    </Button>
  );
}

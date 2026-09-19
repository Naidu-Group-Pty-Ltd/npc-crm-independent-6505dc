import { useMemo } from "react";
import { useFinancePortalAuth } from "@/hooks/useFinancePortalAuth";
import { PartnerComplianceWorkspace } from "@/components/partner-compliance";
import { financePortalAdapter } from "@/components/partner-compliance/adapters";
import { makePartnerWorkspaceClient } from "@/lib/partnerWorkspaceClient";

/**
 * Finance Portal mount of the SHARED Partner Compliance Workspace
 * (Phase 5). The existing funding request / reconciliation workflow is
 * untouched — this page complements it. Identity travels only through the
 * finance session; the server maps it to the canonical partner
 * organisation and enforces every flag and link check again.
 */
export default function FinancePortalComplianceWorkspace() {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const client = useMemo(
    () => makePartnerWorkspaceClient(invokeFinanceFunction, "finance"),
    [invokeFinanceFunction],
  );

  /* No client-side gate. The server refuses every workspace operation on
     its own — flags, membership, organisation mapping, link scope — and says
     so in its own words, which the workspace renders. Gating here as well
     put a SECOND authority in front of it, and that authority was asking a
     question a partner cannot ask: `feature_flags` grants SELECT `TO
     authenticated`, a portal user's browser client is anon, and RLS filters
     rather than erroring. The page announced itself unavailable while the
     server was ready to serve it. */
  return (
    <div className="p-4 md:p-6">
      <PartnerComplianceWorkspace adapter={financePortalAdapter} client={client} />
    </div>
  );
}

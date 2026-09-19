import { useMemo } from "react";
import { invokeSolicitorFunction } from "@/lib/solicitorPortal";
import { PartnerComplianceWorkspace } from "@/components/partner-compliance";
import { solicitorPortalAdapter } from "@/components/partner-compliance/adapters";
import { makePartnerWorkspaceClient } from "@/lib/partnerWorkspaceClient";

/**
 * Solicitor/Conveyancer Portal mount of the SHARED Partner Compliance
 * Workspace (Phase 5). Firm identity travels only through the solicitor
 * session cookie; the server maps it to the canonical partner organisation
 * (firm back-reference must match) and enforces every check again.
 * Privileged material never enters this surface: the workspace carries the
 * structured determinations the practice chooses to record, nothing from
 * matter files, notes or communications.
 */
export default function SolicitorCompliance() {
  const client = useMemo(
    () => makePartnerWorkspaceClient(invokeSolicitorFunction, "solicitor_conveyancer"),
    [],
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
      <PartnerComplianceWorkspace adapter={solicitorPortalAdapter} client={client} />
    </div>
  );
}

import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActivateClientDialog } from "@/components/aml/ActivateClientDialog";
import { useAmlAccess } from "@/hooks/useAmlAccess";
import { hasAmlCapability } from "@/lib/aml/permissions";
import { useAmlV3Flags } from "@/lib/aml/useAmlV3Flags";
import type { AmlCase } from "@/lib/aml/amlCasesApi";

interface StartClientComplianceButtonProps {
  clientId: string;
  clientName: string;
  size?: "sm" | "default";
  compact?: boolean;
  onActivated?: (aCase: AmlCase) => void;
}

/**
 * AML V3 Phase 2 — Directive 1: "Start Client Compliance".
 *
 * Command Center master-client-record entry point that opens the existing
 * human-confirmed activation dialog. Gated by:
 *   - feature flag `aml_v3_start_client_compliance` (off by default), and
 *   - the caller holding at least the `aml.view` capability.
 *
 * The dialog itself already enforces the tri-portal rules:
 *   · human_confirmed = true,
 *   · Model B blocked until legal_approval + program_version are recorded,
 *   · server-side idempotency + hash-chained audit on the resulting case.
 *
 * When the flag is off this component renders nothing — Command Center
 * behaviour is byte-identical to today.
 */
export function StartClientComplianceButton({
  clientId,
  clientName,
  size = "sm",
  compact = false,
  onActivated,
}: StartClientComplianceButtonProps) {
  const { startClientCompliance } = useAmlV3Flags();
  const { roles, loading } = useAmlAccess();
  const [open, setOpen] = useState(false);

  if (!startClientCompliance) return null;
  if (loading) return null;
  if (!hasAmlCapability(roles, "aml.view")) return null;
  if (!clientId) return null;

  return (
    <>
      <Button
        variant="outline"
        size={size}
        onClick={() => setOpen(true)}
        title="Open an AML/CTF case for this client (human-confirmed activation)"
        className="border-primary/40 text-primary hover:bg-primary/10"
      >
        <ShieldCheck className="h-4 w-4 mr-1.5" />
        <span className={compact ? "text-xs" : ""}>Start Client Compliance</span>
      </Button>
      <ActivateClientDialog
        open={open}
        onOpenChange={setOpen}
        clientId={clientId}
        clientName={clientName}
        onActivated={(created) => {
          setOpen(false);
          onActivated?.(created);
        }}
      />
    </>
  );
}

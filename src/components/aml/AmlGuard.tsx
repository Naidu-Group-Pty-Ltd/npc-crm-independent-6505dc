import { useState, useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { ShieldAlert, Loader2, RefreshCw } from "lucide-react";
import { useAmlAccess } from "@/hooks/useAmlAccess";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { hasAmlCapability, AML_STEP_UP_CAPABILITIES, type AmlCapability } from "@/lib/aml/permissions";
import { getStepUpToken, setStepUpToken } from "@/lib/aml/stepUpTokenStore";
import { StepUpAuthDialog } from "./StepUpAuthDialog";

interface AmlGuardProps {
  capability?: AmlCapability;
  children: React.ReactNode;
}

/**
 * Phase 2 guard for every AML surface.
 *
 * - Confirms the `aml_ctf` feature flag is enabled for the tenant.
 * - Confirms the user has at least one AML role.
 * - Confirms the user has the requested capability.
 * - Requires a step-up placeholder confirmation for AUSTRAC + configuration routes.
 */
export function AmlGuard({ capability = "aml.view", children }: AmlGuardProps) {
  const { loading, flagEnabled, roles, hasAnyRole, unavailable, refresh } = useAmlAccess();
  const location = useLocation();
  const requiresStepUp = AML_STEP_UP_CAPABILITIES.includes(capability);
  const stepUpKey = `aml_step_up_session:${capability}`;

  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [stepUpOk, setStepUpOk] = useState<boolean>(() => {
    if (!requiresStepUp) return true;
    return getStepUpToken(capability) !== null;
  });

  useEffect(() => {
    if (requiresStepUp && !stepUpOk && hasAnyRole && flagEnabled) {
      setStepUpOpen(true);
    }
  }, [requiresStepUp, stepUpOk, hasAnyRole, flagEnabled, location.pathname]);


  if (loading) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  /*
    ── "We could not check" is not "you do not have it" ────────────────
    A dropped connection, a timeout or a 5xx used to arrive here as
    `flagEnabled: false` with no roles, and this page then told the operator
    the module is not switched on for their organisation — about a module
    that is switched on. On a phone, where a request is far likelier to
    fail, that reads as a permanent verdict and sends somebody to their
    administrator over a lost signal.

    The reading and the reason are separate values now, and the one thing
    this state offers is the thing that actually helps: try again.
  */
  if (unavailable) {
    return (
      <div className="p-6">
        <Alert>
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>We couldn't check your access just now</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>
              This is a connection problem rather than an answer about your access — nothing
              about your permissions has changed. Try again in a moment.
            </p>
            <Button type="button" size="sm" variant="outline" onClick={() => { void refresh(); }}>
              <RefreshCw aria-hidden="true" className="mr-2 h-3.5 w-3.5" /> Try again
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!flagEnabled) {
    return (
      <div className="p-6">
        <Alert>
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>AML/CTF is not enabled</AlertTitle>
          <AlertDescription>
            The AML/CTF module isn't switched on for your organisation yet. Contact your
            administrator to enable it.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!hasAnyRole) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>You don't have access to this area yet</AlertTitle>
          <AlertDescription>
            Ask your compliance administrator to grant you AML access. This area appears
            automatically once access is granted.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!hasAmlCapability(roles, capability)) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>This area is restricted</AlertTitle>
          <AlertDescription>
            Your current access doesn't include this area. Ask your compliance administrator
            if you need it for your work.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (requiresStepUp && !stepUpOk) {
    return (
      <>
        <div className="p-6">
          <Alert>
            <Loader2 className="h-4 w-4 animate-spin" />
            <AlertTitle>Awaiting step-up confirmation</AlertTitle>
            <AlertDescription>
              This surface is restricted. Confirm the step-up prompt to continue.
            </AlertDescription>
          </Alert>
        </div>
        <StepUpAuthDialog
          open={stepUpOpen}
          capability={capability}
          onCancel={() => {
            setStepUpOpen(false);
          }}
          onConfirm={(payload) => {
            setStepUpToken(capability, payload);
            try {
              sessionStorage.setItem(stepUpKey, JSON.stringify({ expires_at: payload.expires_at }));
            } catch { /* ignore */ }
            setStepUpOk(true);
            setStepUpOpen(false);
          }}
        />

      </>
    );
  }

  return <>{children}</>;
}

// Small convenience: bounce unknown /admin/aml paths to the overview.
export function AmlNotFoundRedirect() {
  return <Navigate to="/admin/aml" replace />;
}

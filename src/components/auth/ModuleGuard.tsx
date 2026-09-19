import { Link } from 'react-router-dom';
import { useModulePermissions } from '@/hooks/useModulePermissions';
import { useWorkspaceEntitlements } from '@/hooks/useWorkspaceEntitlements';
import { getCapabilityDefinition } from '@/lib/entitlements';
import { isClientFacingDeployment, isPathVisibleInDeployment } from '@/lib/clientFacing';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CloudOff, Crown, Lock, Settings2, ShieldAlert } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

interface ModuleGuardProps {
  moduleKey: string;
  children: React.ReactNode;
  /** If true, requires canEdit permission instead of just canView */
  requireEdit?: boolean;
  /** If true, requires canDelete permission */
  requireDelete?: boolean;
}

/**
 * Entitlement-aware route guard.
 *
 * A module can be unavailable for very different reasons, and the screen has
 * to say which: the workspace has not bought it (subscription exclusion),
 * the user is not permitted (role denial), something it needs is not
 * configured, the product is not currently available, or entitlement simply
 * is not known yet. Conflating those — the old single "contact your
 * administrator" alert — sent people to an administrator who could not help.
 *
 * Commercially gated keys resolve through the capability decision, which
 * carries the workspace entitlement AND the capability's own user-permission
 * axis. Keys the registry does not describe fall back to the legacy
 * user-permission check unchanged.
 *
 * A superadministrator reaches every available module as the deployment's
 * operator. Where that is the ONLY thing opening the door, the page says so
 * in a line above itself: the alternative is an operator who cannot tell
 * their own view from the customer's, which is the failure mode the old
 * "superadmins do not bypass the plan" rule was written to avoid — and it
 * avoided it by locking operators out of add-on-only modules entirely.
 */
export function ModuleGuard({ moduleKey, children, requireEdit, requireDelete }: ModuleGuardProps) {
  const { canView, canEdit, canDelete, decision, loading } = useModulePermissions(moduleKey);
  const { refreshEntitlements, isRefreshing } = useWorkspaceEntitlements();

  const allowed = decision ? decision.enabled : canView;
  const status = decision?.status;

  if (loading || status === 'loading') {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!allowed) {
    if (status === 'plan_excluded') {
      // Both buttons land on /billing, which a client-facing deployment may
      // hide — its subscription is Aurixa's relationship with the workspace
      // rather than something the workspace administers. Offering a control
      // that lands on "not available on this dashboard" is worse than
      // offering none, so the buttons are drawn only where the page is.
      const billingReachable = isPathVisibleInDeployment('/billing', isClientFacingDeployment());
      return (
        <div className="p-6">
          <Alert>
            <Lock className="h-4 w-4" />
            <AlertTitle>Not included in your subscription</AlertTitle>
            <AlertDescription className="space-y-3">
              <p>This module is not currently included in your subscription.</p>
              {billingReachable ? (
                <div className="flex flex-wrap gap-2">
                  <Button asChild size="sm" variant="default">
                    <Link to="/billing">View Billing &amp; Usage</Link>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <Link to="/billing">Review Available Add-ons</Link>
                  </Button>
                </div>
              ) : (
                <p>Contact your workspace administrator to have it added.</p>
              )}
            </AlertDescription>
          </Alert>
        </div>
      );
    }

    if (status === 'dependency_missing') {
      return (
        <div className="p-6">
          <Alert>
            <Settings2 className="h-4 w-4" />
            <AlertTitle>Configuration required</AlertTitle>
            <AlertDescription>
              This module is included in your subscription but requires configuration before it
              can be used. Contact your workspace administrator.
            </AlertDescription>
          </Alert>
        </div>
      );
    }

    if (status === 'product_unavailable') {
      return (
        <div className="p-6">
          <Alert>
            <CloudOff className="h-4 w-4" />
            <AlertTitle>Not currently available</AlertTitle>
            <AlertDescription>This capability is not currently available.</AlertDescription>
          </Alert>
        </div>
      );
    }

    if (status === 'unknown') {
      return (
        <div className="p-6">
          <Alert>
            <CloudOff className="h-4 w-4" />
            <AlertTitle>Entitlements temporarily unavailable</AlertTitle>
            <AlertDescription className="space-y-3">
              <p>
                We could not confirm your subscription right now. Premium modules stay unavailable
                until entitlement is confirmed — no purchase is required to resolve this.
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={isRefreshing}
                onClick={() => void refreshEntitlements()}
              >
                {isRefreshing ? 'Checking…' : 'Try again'}
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      );
    }

    // permission_denied, or a legacy user-permission denial.
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Permission required</AlertTitle>
          <AlertDescription>
            This module is available to your business, but your user account does not have
            permission to access it. Contact your workspace administrator.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (requireEdit && !canEdit && !(decision && !decision.permissionKey)) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertDescription>
            You don't have edit permission for this module. Contact your administrator.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (requireDelete && !canDelete && !(decision && !decision.permissionKey)) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertDescription>
            You don't have delete permission for this module. Contact your administrator.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (decision?.operatorOnly) {
    return (
      <>
        <div className="px-6 pt-4">
          <Alert>
            <Crown className="h-4 w-4" />
            <AlertTitle>Open to you as a superadmin</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>
                This workspace's subscription does not include {moduleLabel(decision)}
                {decision.availableAddons?.length
                  ? ` — it is sold as the ${decision.availableAddons.join(' / ')} add-on.`
                  : '.'}{' '}
                Everyone without the superadmin role sees a "not included in your subscription"
                screen here.
              </p>
              <p>
                Premium server operations enforce the subscription separately, so some data on
                this page can still be refused until the workspace holds it.
              </p>
            </AlertDescription>
          </Alert>
        </div>
        {children}
      </>
    );
  }

  return <>{children}</>;
}

/** Human label for the capability behind a decision, for the operator notice. */
function moduleLabel(decision: NonNullable<ReturnType<typeof useModulePermissions>['decision']>): string {
  return getCapabilityDefinition(decision.capability)?.label ?? 'this module';
}

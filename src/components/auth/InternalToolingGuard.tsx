import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Wrench } from 'lucide-react';
import { isPrimeDeployment } from '@/lib/primeDeployment';

/**
 * Wraps a surface that is NPC's own operations tooling rather than product.
 *
 * Distinct from `ModuleGuard`, which answers a commercial question — has this
 * workspace bought the module — and deliberately opens every available module
 * to a superadmin as the deployment's operator. That is right for a feature
 * somebody could buy and wrong for a tool nobody can: a tenant's own
 * administrator IS a superadmin of their workspace, so an entitlement gate
 * would hide internal tooling from their staff and show it to the one person
 * most likely to go looking.
 *
 * The refusal says what it is rather than pretending the page does not exist.
 * A 404 for a route the navigation never offered would be tidier and would
 * also mean a tenant who found the URL is told nothing true; this reads as a
 * closed door with a label, which is what it is.
 */
export function InternalToolingGuard({ children }: { children: React.ReactNode }) {
  if (isPrimeDeployment()) return <>{children}</>;

  return (
    <div className="p-6">
      <Alert>
        <Wrench className="h-4 w-4" />
        <AlertTitle>Internal operations tooling</AlertTitle>
        <AlertDescription>
          <p>
            This page is part of NPC Services' own operations and is not available on this
            workspace. Nothing here is missing or misconfigured, and there is nothing to enable.
          </p>
        </AlertDescription>
      </Alert>
    </div>
  );
}

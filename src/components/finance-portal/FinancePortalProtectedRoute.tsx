import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { Loader2 } from 'lucide-react';

interface FinancePortalProtectedRouteProps {
  children: ReactNode;
}

/** Where the partner was heading before a gate interrupted them. */
interface GateState { from?: string }

const GATE_PATHS = ['/finance/terms', '/finance/onboarding'];

/**
 * Everything a finance partner must do before the portal opens, in order:
 * rotate a temporary password, accept the current agreement, complete
 * onboarding.
 *
 * Each step is a route rather than a modal stacked over the portal. It was a
 * modal, and the two consequences are the reason this guard exists: the
 * consent dialog inherited the shared dialog's `sm:max-h`/`sm:overflow-visible`
 * and could not scroll the agreement it was showing, and it shared a tree with
 * the welcome tour, which auto-starts on a timer at a higher z-index and so
 * appeared on top of terms nobody had read yet. Routing makes the order a
 * property of the URL instead of a race between two mounted components. The
 * Solicitor Portal has always worked this way (`SolicitorPortalProtectedRoute`).
 */
export function FinancePortalProtectedRoute({ children }: FinancePortalProtectedRouteProps) {
  const { user, loading } = useFinancePortalAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground text-sm">Loading Finance Portal...</p>
        </div>
      </div>
    );
  }

  // The destination survives the login too, not only the gates below.
  //
  // Terms and onboarding have always handed the partner back to where they
  // were going; sign-in threw it away, and sign-in is the gate that a link
  // from OUTSIDE the portal always hits first. Every agreement email we send
  // deep-links to `/finance/agreements/<id>`, so the one link the partner is
  // most likely to click was the one guaranteed to drop them on the dashboard
  // to go looking. Notifications are only as good as where they land.
  if (!user) {
    const intended = `${location.pathname}${location.search}`;
    return (
      <Navigate
        to="/finance/login"
        replace
        state={GATE_PATHS.includes(location.pathname) ? undefined : { from: intended }}
      />
    );
  }

  // Force temp-password users to change password before accessing the portal
  if (user.must_change_password) {
    return location.pathname === '/finance/change-password'
      ? <>{children}</>
      : (
        <Navigate
          to="/finance/change-password"
          replace
          state={{ from: `${location.pathname}${location.search}` }}
        />
      );
  }

  // Version-aware where the server can be: a partner who accepted a superseded
  // version has not accepted this one, and `has_accepted_terms` alone would let
  // an amended agreement go unread by everyone already through the door.
  //
  // But absent is not false. `finance-portal-verify` deploys on its own track,
  // so this bundle can be running against a deployment that predates versioned
  // acceptance and sends neither the field nor the agreement. Reading `undefined`
  // as "has not accepted" there blocks every finance partner behind a document
  // the old server cannot serve — which is exactly what happened when the
  // frontend shipped ahead of the function. Fall back to the flag that
  // deployment does send.
  const serverIsVersionAware = typeof user.has_accepted_current_terms === 'boolean';
  const needsTerms = serverIsVersionAware
    ? !user.has_accepted_current_terms
    : !user.has_accepted_terms;

  // A gate interrupts wherever the partner was going — an emailed AML snapshot
  // link, say. The modal it replaced dismissed in place and left them there;
  // a redirect would drop them on the dashboard instead, so the destination
  // travels with them and the last gate hands them back to it. Never a gate
  // path itself: that is how this becomes a loop.
  const onGatePath = GATE_PATHS.includes(location.pathname);
  const from = (location.state as GateState | null)?.from
    ?? (onGatePath ? undefined : `${location.pathname}${location.search}`);

  if (needsTerms) {
    return location.pathname === '/finance/terms'
      ? <>{children}</>
      : <Navigate to="/finance/terms" replace state={{ from }} />;
  }

  if (!user.has_completed_onboarding) {
    return location.pathname === '/finance/onboarding'
      ? <>{children}</>
      : <Navigate to="/finance/onboarding" replace state={{ from }} />;
  }

  // Both gate pages are deliberately chrome-less — no sidebar, no top bar, no
  // way out. A partner who has already cleared them (or who follows a stale
  // link) would otherwise be shown a blocking page with nothing to click.
  if (onGatePath) {
    return <Navigate to={from ?? '/finance'} replace />;
  }

  return <>{children}</>;
}

import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { usePortalAuth } from '@/hooks/usePortalAuth';
import { Loader2 } from 'lucide-react';

export function PortalProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = usePortalAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/client/login" replace />;
  }

  // Redirect to consent wall if terms not accepted
  if (!user.has_accepted_terms) {
    return <Navigate to="/client/consent" replace />;
  }

  return <>{children}</>;
}

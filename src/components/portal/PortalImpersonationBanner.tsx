import { useEffect, useState } from 'react';
import { Eye, ShieldAlert, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePortalAuth } from '@/hooks/usePortalAuth';
import { useNavigate } from 'react-router-dom';

const IMPERSONATION_FLAG_KEY = 'portal_impersonation_active';
const IMPERSONATION_READONLY_KEY = 'portal_impersonation_readonly';

const readFlag = (key: string): string | null => {
  try { return sessionStorage.getItem(key) || localStorage.getItem(key); }
  catch { return null; }
};
const clearFlag = (key: string) => {
  try { sessionStorage.removeItem(key); } catch {}
  try { localStorage.removeItem(key); } catch {}
};

/**
 * Banner shown at the top of the client portal when a finance partner is
 * impersonating a client via the Phase 7B SSO handoff. Provides a one-click exit
 * that ends the impersonation session and returns the partner to the finance portal.
 */
export function PortalImpersonationBanner() {
  const { signOut } = usePortalAuth();
  const navigate = useNavigate();
  const [active, setActive] = useState(false);
  const [readonly, setReadonly] = useState(false);

  useEffect(() => {
    setActive(readFlag(IMPERSONATION_FLAG_KEY) === '1');
    setReadonly(readFlag(IMPERSONATION_READONLY_KEY) === '1');
  }, []);

  if (!active) return null;

  const handleExit = async () => {
    try {
      await signOut();
    } catch { /* ignore */ }
    clearFlag(IMPERSONATION_FLAG_KEY);
    clearFlag(IMPERSONATION_READONLY_KEY);
    navigate('/finance/clients', { replace: true });
  };

  return (
    <div className="bg-warning/15 border-b border-warning/40 text-warning px-4 py-2 flex items-center justify-between gap-3 text-sm">
      <div className="flex items-center gap-2 min-w-0">
        <ShieldAlert className="h-4 w-4 shrink-0 text-warning" />
        <span className="font-medium">Partner impersonation</span>
        <span className="hidden sm:inline text-xs opacity-80 truncate">
          You are viewing this client's portal as a finance partner.
        </span>
        {readonly && (
          <span className="hidden md:inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-warning/25">
            <Eye className="h-3 w-3" /> Read-only
          </span>
        )}
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={handleExit}
        className="h-7 px-2 text-xs"
      >
        <X className="h-3.5 w-3.5 mr-1" /> Exit impersonation
      </Button>
    </div>
  );
}

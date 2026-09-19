import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, ShieldCheck, AlertTriangle, Eye } from 'lucide-react';
import { setPortalSessionToken } from '@/lib/portalSession';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/integrations/supabase/env';


const IMPERSONATION_FLAG_KEY = 'portal_impersonation_active';
const IMPERSONATION_READONLY_KEY = 'portal_impersonation_readonly';

// Impersonation display flags only — never the session token. These are
// tab-scoped so an impersonation banner cannot outlive the tab that started it;
// the session itself is carried by the HttpOnly cookie the redeem response
// sets. See src/lib/portalSession.ts.
const persist = (key: string, value: string) => {
  try { sessionStorage.setItem(key, value); } catch {}
  try { localStorage.removeItem(key); } catch {}
};

export default function PortalHandoff() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'pending' | 'success' | 'error'>('pending');
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ name?: string; readonly?: boolean } | null>(null);
  const ranRef = useRef(false);

  const token = searchParams.get('token');
  const portalUserId = searchParams.get('portalUserId');

  useEffect(() => {
    if (ranRef.current) return; // StrictMode double-effect guard — token is single-use
    ranRef.current = true;

    if (!token) {
      setStatus('error');
      setError('Missing handoff token in URL.');
      return;
    }

    (async () => {
      try {
        const response = await fetch(`${SUPABASE_URL}/functions/v1/finance-portal-handoff-redeem`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          },
          // The redeem response sets the HttpOnly client-portal session cookie.
          credentials: 'include',
          body: JSON.stringify({ token, portal_user_id: portalUserId }),
        });

        const data = await response.json();
        if (!response.ok || !data?.success) {
          throw new Error(data?.error || `Handoff failed (HTTP ${response.status})`);
        }

        // The session now lives in the HttpOnly cookie the redeem response set;
        // this in-memory copy only backs the legacy header/body carriers and
        // dies with the tab. It used to be written to `localStorage`, which left
        // a working impersonated client session on the machine indefinitely.
        setPortalSessionToken(data.session_token);
        persist(IMPERSONATION_FLAG_KEY, '1');
        persist(IMPERSONATION_READONLY_KEY, data.impersonation?.is_readonly ? '1' : '0');

        setMeta({
          name: data.user?.name,
          readonly: !!data.impersonation?.is_readonly,
        });
        setStatus('success');

        // Brief pause so the user sees the impersonation notice, then enter the portal
        setTimeout(() => {
          // Force a full reload so PortalAuthProvider picks up the new session token cleanly
          window.location.replace('/client');
        }, 1200);
      } catch (e: any) {
        setStatus('error');
        setError(e?.message || 'Could not redeem handoff token.');
      }
    })();
  }, [token]);

  return (
    <div className="client-portal-theme min-h-screen flex items-center justify-center p-6">
      <Card className="client-portal-soft-panel max-w-md w-full overflow-hidden">
        <CardHeader className="border-b border-border/50 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent">
          <CardTitle className="flex items-center gap-2">
            {status === 'pending' && <Loader2 className="h-5 w-5 animate-spin text-primary" />}
            {status === 'success' && <ShieldCheck className="h-5 w-5 text-success" />}
            {status === 'error' && <AlertTriangle className="h-5 w-5 text-destructive" />}
            {status === 'pending' && 'Opening client portal…'}
            {status === 'success' && 'Access granted'}
            {status === 'error' && 'Handoff failed'}
          </CardTitle>
          <CardDescription>
            {status === 'pending' && 'Verifying your secure handoff link.'}
            {status === 'success' && (
              <>
                Entering {meta?.name || 'client'}'s portal as a finance partner.
                {meta?.readonly && (
                  <span className="block mt-1 text-xs text-muted-foreground inline-flex items-center gap-1">
                    <Eye className="h-3 w-3" /> Read-only impersonation session.
                  </span>
                )}
              </>
            )}
            {status === 'error' && (error || 'The handoff link could not be redeemed. It may have expired or already been used.')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {status === 'success' && (
            <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
              All actions taken in this session are audited and attributed to you.
            </div>
          )}
          {status === 'error' && (
            <Button variant="outline" className="w-full" onClick={() => window.close()}>
              Close window
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

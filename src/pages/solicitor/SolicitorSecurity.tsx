import { useCallback, useEffect, useState } from 'react';
import { Laptop, Loader2, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SolicitorEmptyState } from '@/components/solicitor-portal/SolicitorEmptyState';
import { SolicitorPortalShell } from '@/components/solicitor-portal/SolicitorPortalShell';
import { useToast } from '@/hooks/use-toast';
import { invokeSolicitorFunction } from '@/lib/solicitorPortal';

interface PortalSession { id: string; device_label: string | null; last_used_at: string; revoked_at: string | null }
interface SessionsResponse { sessions?: PortalSession[]; current_session_id?: string | null }

export default function SolicitorSecurity() {
  const [rows, setRows] = useState<PortalSession[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const load = useCallback(async () => {
    const { data, error } = await invokeSolicitorFunction<SessionsResponse>('solicitor-portal-verify', { action: 'list_sessions' });
    if (error) toast({ title: 'Unable to load sessions', description: error.message, variant: 'destructive' });
    setRows(data?.sessions ?? []);
    setCurrent(data?.current_session_id ?? null);
    setLoading(false);
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const mutate = async (action: 'revoke_session' | 'revoke_other_sessions', sessionId?: string) => {
    setBusy(true);
    const { error } = await invokeSolicitorFunction('solicitor-portal-verify', { action, ...(sessionId ? { session_id: sessionId } : {}) });
    if (error) toast({ title: 'Session could not be revoked', description: error.message, variant: 'destructive' });
    await load();
    setBusy(false);
  };

  const active = rows.filter((session) => !session.revoked_at);

  return (
    <SolicitorPortalShell
      title="Session security"
      description="Review and revoke the devices signed into your Solicitor Portal account."
      actions={
        <Button
          variant="outline"
          size="sm"
          disabled={busy || active.length <= 1}
          onClick={() => void mutate('revoke_other_sessions')}
        >
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <ShieldCheck className="mr-2 h-4 w-4" aria-hidden />}
          Revoke all other devices
        </Button>
      }
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Signed-in devices</CardTitle>
          <CardDescription>
            Anything you do not recognise should be revoked immediately, then change your password.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Loading sessions" />
            </div>
          ) : rows.length === 0 ? (
            <SolicitorEmptyState
              icon={<Laptop className="h-6 w-6" aria-hidden />}
              title="No session history"
              description="No session history is available. Sign in again, or contact support if this is unexpected."
              className="border-0 shadow-none"
              hint="Sessions are recorded per device"
            />
          ) : rows.map((session) => (
            <div
              key={session.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/20 p-4"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10">
                  <Laptop className="h-4 w-4 text-primary" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="flex items-center gap-2 truncate text-sm font-medium text-foreground">
                    {session.device_label || 'Unknown device'}
                    {session.id === current ? <Badge variant="outline" className="font-medium">This device</Badge> : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Last used {new Date(session.last_used_at).toLocaleString('en-AU')} ·{' '}
                    {session.revoked_at ? 'Revoked' : 'Active'}
                  </p>
                </div>
              </div>
              {!session.revoked_at && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void mutate('revoke_session', session.id)}
                >
                  Revoke
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </SolicitorPortalShell>
  );
}

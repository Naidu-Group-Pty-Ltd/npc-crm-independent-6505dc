import { useEffect, useState } from 'react';
import { KeyRound, Loader2, ShieldCheck, Trash2, Fingerprint } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  listWebAuthnCredentials,
  deleteWebAuthnCredential,
  enrollWebAuthn,
  requestStepUpWithWebAuthn,
  webauthnSupported,
  type WebAuthnCredentialRow,
} from '@/lib/security/stepUp';

function formatDate(iso: string | null | undefined) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('en-AU'); } catch { return '—'; }
}

export function WebAuthnSettings({ disabled }: { disabled?: boolean }) {
  const [creds, setCreds] = useState<WebAuthnCredentialRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showEnroll, setShowEnroll] = useState(false);
  const [password, setPassword] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const supported = webauthnSupported();

  const refresh = async () => {
    setLoading(true); setError(null);
    const r = await listWebAuthnCredentials();
    setLoading(false);
    if (!r.ok) return setError(r.error);
    setCreds(r.credentials);
  };
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, []);

  const doEnroll = async () => {
    setBusy(true); setError(null); setStatus(null);
    const proof = creds.length > 0 ? await requestStepUpWithWebAuthn('mfa.manage', password) : null;
    if (proof && proof.ok === false) {
      setBusy(false);
      return setError(proof.error);
    }
    const r = await enrollWebAuthn(password, deviceName.trim() || undefined, proof && proof.ok ? proof.token : undefined);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setPassword(''); setDeviceName(''); setShowEnroll(false);
    setStatus('Security key registered.');
    refresh();
  };

  const doDelete = async (id: string) => {
    if (!confirm('Remove this security key? You will not be able to use it for step-up until re-enrolled.')) return;
    const currentPassword = prompt('Confirm your password to remove this security key:');
    if (!currentPassword) return;
    setBusy(true); setError(null);
    const proof = await requestStepUpWithWebAuthn('mfa.manage', currentPassword);
    if (proof.ok === false) {
      setBusy(false);
      return setError(proof.error);
    }
    const r = await deleteWebAuthnCredential(id, proof.token);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    refresh();
  };

  if (!supported) {
    return (
      <Alert>
        <AlertDescription>
          This browser doesn't support WebAuthn. Use a modern Chromium, Firefox, or Safari build to register a passkey or security key.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Register a passkey or hardware security key as a phishing-resistant second factor for high-risk actions.
      </p>

      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {status && <Alert><AlertDescription>{status}</AlertDescription></Alert>}

      {loading ? (
        <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : creds.length === 0 ? (
        <p className="text-sm text-muted-foreground">No security keys registered yet.</p>
      ) : (
        <ul className="space-y-2">
          {creds.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/25 px-3 py-2">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Fingerprint className="h-4 w-4 text-primary" />
                  <span className="truncate">{c.device_name || 'Unnamed key'}</span>
                  {c.backed_up ? <Badge variant="outline">Synced</Badge> : null}
                  {c.device_type ? <Badge variant="outline">{c.device_type}</Badge> : null}
                </div>
                <div className="text-xs text-muted-foreground">
                  Added {formatDate(c.created_at)} · Last used {formatDate(c.last_used_at)}
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => doDelete(c.id)} disabled={busy || disabled}>
                <Trash2 className="mr-1 h-4 w-4" /> Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      {!showEnroll ? (
        <Button type="button" onClick={() => setShowEnroll(true)} disabled={disabled}>
          <KeyRound className="mr-2 h-4 w-4" /> Register a security key
        </Button>
      ) : (
        <div className="space-y-3 rounded-lg border border-border/60 bg-muted/25 p-3">
          <div className="space-y-2">
            <Label htmlFor="webauthn-name">Device name (optional)</Label>
            <Input id="webauthn-name" placeholder="Work YubiKey / MacBook Touch ID" value={deviceName} onChange={(e) => setDeviceName(e.target.value)} disabled={busy} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="webauthn-password">Confirm password</Label>
            <Input id="webauthn-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} />
          </div>
          <div className="flex gap-2">
            <Button type="button" onClick={doEnroll} disabled={!password || busy}>
              {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Registering…</> : <><ShieldCheck className="mr-2 h-4 w-4" /> Register</>}
            </Button>
            <Button type="button" variant="ghost" onClick={() => { setShowEnroll(false); setPassword(''); setError(null); }} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

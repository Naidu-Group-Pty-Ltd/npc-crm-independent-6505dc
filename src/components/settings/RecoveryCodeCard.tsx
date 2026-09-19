import { useState } from 'react';
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { regenerateRecoveryCodes } from '@/lib/security/stepUp';

/** Replaces every recovery code after a password + current TOTP confirmation. */
export function RecoveryCodeCard({ disabled }: { disabled?: boolean }) {
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const replace = async () => {
    setBusy(true); setError(null);
    const result = await regenerateRecoveryCodes(password, mfaCode);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setPassword(''); setMfaCode(''); setCodes(result.recoveryCodes);
  };
  if (codes) return <div className="space-y-3"><Alert><AlertDescription><strong>Save your replacement recovery codes now.</strong> Your previous codes no longer work. These are shown once and are not stored in this browser.</AlertDescription></Alert><div className="grid gap-2 rounded-md bg-muted p-3 font-mono text-sm sm:grid-cols-2">{codes.map((code) => <code key={code}>{code}</code>)}</div><Button type="button" onClick={() => setCodes(null)}><ShieldCheck className="mr-2 h-4 w-4"/>I have saved these codes</Button></div>;
  return <div className="space-y-3"><p className="text-sm text-muted-foreground">Replace lost recovery codes. This invalidates every existing recovery code.</p><Label htmlFor="recovery-password">Confirm password</Label><Input id="recovery-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy || disabled}/><Label htmlFor="recovery-totp">Authenticator code</Label><Input id="recovery-totp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={mfaCode} onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, ''))} disabled={busy || disabled}/>{error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}<Button type="button" variant="outline" onClick={replace} disabled={!password || !/^\d{6}$/.test(mfaCode) || busy || disabled}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <KeyRound className="mr-2 h-4 w-4"/>}Replace recovery codes</Button></div>;
}

import { useState } from 'react';
import { Clipboard, KeyRound, Loader2, ShieldCheck, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { beginTotpEnrollment, confirmTotpEnrollment } from '@/lib/security/stepUp';
import { LocalOtpAuthQrCode } from '@/components/settings/LocalOtpAuthQrCode';

export function TotpEnrollmentCard({ disabled }: { disabled?: boolean }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState<{ token: string; secret: string; otpauthUri: string } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const begin = async () => {
    setBusy(true); setError(null);
    const result = await beginTotpEnrollment(password);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    const secret = new URL(result.otpauthUri).searchParams.get('secret');
    if (!secret) return setError('Unable to create authenticator setup.');
    setPassword(''); setPending({ token: result.enrollmentToken, secret, otpauthUri: result.otpauthUri });
  };
  const confirm = async () => { if (!pending || !/^\d{6}$/.test(code)) return; setBusy(true); setError(null); const result = await confirmTotpEnrollment(pending.token, code); setBusy(false); if (!result.ok) return setError(result.error); setPending(null); setCode(''); setRecoveryCodes(result.recoveryCodes); };
  if (recoveryCodes) return <div className="space-y-3"><Alert><AlertDescription><strong>Save your recovery codes now.</strong> Each code works once. They are not stored in this browser and cannot be shown again.</AlertDescription></Alert><div className="grid gap-2 rounded-md bg-muted p-3 font-mono text-sm sm:grid-cols-2">{recoveryCodes.map((recoveryCode) => <code key={recoveryCode}>{recoveryCode}</code>)}</div><Button type="button" onClick={() => setRecoveryCodes(null)}><ShieldCheck className="mr-2 h-4 w-4"/>I have saved these codes</Button></div>;
  if (!pending) return <div className="space-y-3"><p className="text-sm text-muted-foreground">Add an authenticator app for high-risk actions. Setup is bound to this staff session.</p><Label htmlFor="totp-enrol-password">Confirm password</Label><Input id="totp-enrol-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy || disabled}/>{error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}<Button type="button" onClick={begin} disabled={!password || busy || disabled}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <KeyRound className="mr-2 h-4 w-4"/>}Set up authenticator</Button></div>;
  const cancel = () => { setPending(null); setCode(''); setError(null); setCopied(false); };
  const copy = async () => {
    try { await navigator.clipboard.writeText(pending.secret); setCopied(true); }
    catch { setError('Copy the setup key manually.'); }
  };
  return <div className="space-y-3"><p className="text-sm text-muted-foreground">Scan this code with an RFC 6238 authenticator app, or enter the setup key manually. It is shown only during this setup.</p><LocalOtpAuthQrCode value={pending.otpauthUri}/><code className="block break-all rounded-md bg-muted p-3 text-sm">{pending.secret}</code><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={copy} disabled={busy}><Clipboard className="mr-2 h-4 w-4"/>{copied ? 'Copied' : 'Copy setup key'}</Button><Button type="button" variant="ghost" onClick={cancel} disabled={busy}><X className="mr-2 h-4 w-4"/>Cancel setup</Button></div><Label htmlFor="totp-enrol-code">Authenticator code</Label><Input id="totp-enrol-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} disabled={busy}/>{error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}<Button type="button" onClick={confirm} disabled={!/^\d{6}$/.test(code) || busy}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <ShieldCheck className="mr-2 h-4 w-4"/>}Verify and enable MFA</Button></div>;
}

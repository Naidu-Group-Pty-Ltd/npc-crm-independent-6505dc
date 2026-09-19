import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { SolicitorAuthShell } from '@/components/solicitor-portal/SolicitorAuthShell';
import { useSolicitorPortalAuth } from '@/hooks/useSolicitorPortalAuth';
import { invokeSolicitorFunction } from '@/lib/solicitorPortal';

interface InviteDetails {
  email: string;
  name: string;
  firm_name: string | null;
  position: string | null;
  already_active: boolean;
}

export default function SolicitorAcceptInvite() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();
  const { applySession } = useSolicitorPortalAuth();

  const [checking, setChecking] = useState(true);
  const [invite, setInvite] = useState<InviteDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!token) {
        setError('This invite link is missing its token. Please use the link from your invitation email.');
        setChecking(false);
        return;
      }
      const { data, error: fnError } = await invokeSolicitorFunction('solicitor-portal-accept-invite', {
        action: 'validate',
        token,
      });
      if (cancelled) return;
      if (fnError || !data?.valid) {
        setError((data as any)?.error || fnError?.message || 'This invite link is no longer valid.');
      } else {
        setInvite(data as InviteDetails);
      }
      setChecking(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (password.length < 10) {
      setError('Password must be at least 10 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    const { data, error: fnError } = await invokeSolicitorFunction('solicitor-portal-accept-invite', {
      action: 'accept',
      token,
      password,
    });
    setSubmitting(false);

    if (fnError || !data?.success) {
      setError((data as any)?.error || fnError?.message || 'Failed to activate your account.');
      return;
    }

    applySession(data.user);
    navigate('/solicitor', { replace: true });
  };

  if (checking) {
    return (
      <SolicitorAuthShell title="Checking your invite">
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
        </div>
      </SolicitorAuthShell>
    );
  }

  if (!invite) {
    return (
      <SolicitorAuthShell
        title="Invite unavailable"
        footer={
          <Link to="/solicitor/login" className="text-primary underline-offset-4 hover:underline">
            Back to sign in
          </Link>
        }
      >
        <Alert variant="destructive">
          <AlertDescription>{error || 'This invite link is no longer valid.'}</AlertDescription>
        </Alert>
      </SolicitorAuthShell>
    );
  }

  return (
    <SolicitorAuthShell
      title="Set up your account"
      description={
        invite.firm_name
          ? `Welcome, ${invite.name} — acting for ${invite.firm_name}.`
          : `Welcome, ${invite.name}.`
      }
      footer={
        <Link to="/solicitor/login" className="text-primary underline-offset-4 hover:underline">
          Already set up? Sign in
        </Link>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="rounded-lg border border-border/60 bg-muted/40 px-4 py-3 text-sm">
          <p className="flex items-center gap-2 text-foreground">
            <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden />
            {invite.email}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="invite-password">Create a password</Label>
          <PasswordInput
            id="invite-password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">Minimum 10 characters.</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="invite-confirm">Confirm password</Label>
          <PasswordInput
            id="invite-confirm"
            autoComplete="new-password"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </div>

        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Activate my account
        </Button>
      </form>
    </SolicitorAuthShell>
  );
}

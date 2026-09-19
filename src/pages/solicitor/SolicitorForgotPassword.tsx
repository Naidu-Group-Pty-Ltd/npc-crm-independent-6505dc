import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { SolicitorAuthShell } from '@/components/solicitor-portal/SolicitorAuthShell';
import { useSolicitorPortalAuth } from '@/hooks/useSolicitorPortalAuth';

type Step = 'request' | 'verify' | 'reset';

export default function SolicitorForgotPassword() {
  const { requestPasswordReset, verifyOtp, resetPassword } = useSolicitorPortalAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>('request');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleRequest = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const result = await requestPasswordReset(email);
    setSubmitting(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setStep('verify');
  };

  const handleVerify = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const result = await verifyOtp(email, otp);
    setSubmitting(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setStep('reset');
  };

  const handleReset = async (event: FormEvent) => {
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
    const result = await resetPassword(email, otp, password);
    setSubmitting(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    navigate('/solicitor/login', { replace: true });
  };

  return (
    <SolicitorAuthShell
      title="Reset your password"
      description={
        step === 'request'
          ? "Enter your email and we'll send you a six-digit reset code."
          : step === 'verify'
            ? 'Enter the six-digit code we emailed you.'
            : 'Choose a new password.'
      }
      footer={
        <Link to="/solicitor/login" className="text-primary underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      }
    >
      {error ? (
        <Alert variant="destructive" className="mb-5">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {step === 'request' ? (
        <form onSubmit={handleRequest} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="reset-email">Email address</Label>
            <Input
              id="reset-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@lawfirm.com.au"
            />
          </div>
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Send reset code
          </Button>
        </form>
      ) : null}

      {step === 'verify' ? (
        <form onSubmit={handleVerify} className="space-y-5">
          <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            <MailCheck className="mt-0.5 h-4 w-4 text-primary" aria-hidden />
            <span>If an account exists for {email}, a code is on its way. It expires in 15 minutes.</span>
          </div>
          <div className="space-y-2">
            <Label htmlFor="reset-otp">Reset code</Label>
            <Input
              id="reset-otp"
              inputMode="numeric"
              maxLength={6}
              required
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
              className="text-center text-lg tracking-[0.5em]"
            />
          </div>
          <Button type="submit" className="w-full" disabled={submitting || otp.length !== 6}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Verify code
          </Button>
        </form>
      ) : null}

      {step === 'reset' ? (
        <form onSubmit={handleReset} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="reset-password">New password</Label>
            <PasswordInput
              id="reset-password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Minimum 10 characters.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="reset-confirm">Confirm new password</Label>
            <PasswordInput
              id="reset-confirm"
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Update password
          </Button>
        </form>
      ) : null}
    </SolicitorAuthShell>
  );
}

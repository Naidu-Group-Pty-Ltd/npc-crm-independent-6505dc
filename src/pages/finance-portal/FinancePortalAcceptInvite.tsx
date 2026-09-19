import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertCircle, Building2, CheckCircle, Eye, EyeOff, Loader2,
} from 'lucide-react';
import { validatePassword } from '@/utils/passwordValidation';
import { PasswordStrengthMeter } from '@/components/ui/password-strength-meter';
import { useWhiteLabel } from '@/contexts/WhiteLabelContext';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { BrandLogo } from '@/components/branding/BrandAssets';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/integrations/supabase/env';


async function callPublic(fn: string, body: any) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
    credentials: 'omit',
    body: JSON.stringify(body),
  });
  const data = await r.json();
  return { ok: r.ok, data };
}

export default function FinancePortalAcceptInvite() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { settings } = useWhiteLabel();
  const { setSessionFromInvite } = useFinancePortalAuth();
  const token = params.get('token') || '';

  const [stage, setStage] = useState<
    'loading' | 'set_password' | 'already_active' | 'expired' | 'invalid' | 'success'
  >('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [email, setEmail] = useState('');
  const [contactName, setContactName] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [showPw2, setShowPw2] = useState(false);
  const [submitErr, setSubmitErr] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      if (!token) {
        setStage('invalid');
        setErrorMsg('Missing invite token.');
        return;
      }
      try {
        const { ok, data } = await callPublic('finance-portal-accept-invite', {
          action: 'validate', token,
        });
        if (!ok || !data?.valid) {
          if (data?.expired) {
            setStage('expired');
          } else {
            setStage('invalid');
          }
          setErrorMsg(data?.error || 'This invite link is invalid or has expired.');
          return;
        }
        setEmail(data.email || '');
        setContactName(data.name || '');
        setStage(data.already_active ? 'already_active' : 'set_password');
      } catch (err: any) {
        setStage('invalid');
        setErrorMsg(err?.message || 'Could not validate your invite.');
      }
    })();
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitErr('');
    if (pw !== pw2) {
      setSubmitErr('Passwords do not match');
      return;
    }
    const v = validatePassword(pw);
    if (!v.isValid) {
      setSubmitErr(v.error || 'Password does not meet requirements');
      return;
    }
    setSubmitting(true);
    const { ok, data } = await callPublic('finance-portal-accept-invite', {
      action: 'accept', token, password: pw,
    });
    setSubmitting(false);
    if (!ok || !data?.success) {
      setSubmitErr(data?.error || 'Failed to activate account');
      return;
    }
    // Auto-login: hydrate the shared auth provider so /finance recognises us immediately
    if (data.session_token && data.user) {
      setSessionFromInvite(data.session_token, {
        ...data.user,
        must_change_password: false,
      });
    }
    setStage('success');
    setTimeout(() => navigate('/finance', { replace: true }), 800);
  };

  if (stage === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          {settings.authLogo ? (
            <BrandLogo slot="auth" className="mx-auto h-16 max-w-[240px] object-contain" fallbackClassName="mx-auto h-12 w-12" />
          ) : (
            <Building2 className="h-12 w-12 text-primary mx-auto" />
          )}
          <Loader2 className="h-8 w-8 text-primary mx-auto animate-spin" />
          <p className="text-muted-foreground">Validating your invite…</p>
        </div>
      </div>
    );
  }

  if (stage === 'invalid' || stage === 'expired') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <AlertCircle className="h-16 w-16 text-destructive" />
            </div>
            <CardTitle className="text-2xl">
              {stage === 'expired' ? 'Invite Expired' : 'Invalid Invite'}
            </CardTitle>
            <CardDescription>
              {stage === 'expired'
                ? 'This invite link has expired. Please contact your administrator to request a new one.'
                : (errorMsg || 'This invite link is invalid or has already been used.')}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Button onClick={() => navigate('/finance/login')}>Go to Sign In</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (stage === 'already_active') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <CheckCircle className="h-16 w-16 text-success" />
            </div>
            <CardTitle className="text-2xl">Already Activated</CardTitle>
            <CardDescription>
              Your account is already set up{email ? ` for ${email}` : ''}. Sign in with your existing password.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Button onClick={() => navigate('/finance/login')}>Go to Sign In</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/30 p-4">
      <Card className="w-full max-w-md shadow-xl border-primary/10">
        <CardHeader className="text-center space-y-3">
          <div className="flex justify-center mb-2">
            {settings.authLogo ? (
              <BrandLogo slot="auth" className="h-16 max-w-[240px] object-contain" fallbackClassName="h-14 w-14" />
            ) : (
              <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
                <Building2 className="h-7 w-7 text-primary" />
              </div>
            )}
          </div>
          <CardTitle className="text-2xl">Set Up Your Account</CardTitle>
          <CardDescription>
            {contactName ? `Welcome, ${contactName}!` : 'Welcome!'} Create a password to access the {settings.companyName ? `${settings.companyName} ` : ''}Finance Partner Portal.
          </CardDescription>
          {email && (
            <p className="text-sm text-muted-foreground">
              Account: <span className="font-medium text-foreground">{email}</span>
            </p>
          )}
        </CardHeader>
        <CardContent>
          {submitErr && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{submitErr}</AlertDescription>
            </Alert>
          )}
          {stage === 'success' ? (
            <Alert className="border-success">
              <CheckCircle className="h-4 w-4 text-success" />
              <AlertDescription>Account activated! Redirecting you to the portal…</AlertDescription>
            </Alert>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="fp-pw">Password</Label>
                <div className="relative">
                  <Input
                    id="fp-pw"
                    type={showPw ? 'text' : 'password'}
                    value={pw}
                    onChange={(e) => setPw(e.target.value)}
                    placeholder="Create a password"
                    required
                    disabled={submitting}
                    className="pr-10"
                  />
                  <Button
                    type="button" variant="ghost" size="sm" tabIndex={-1}
                    className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                    onClick={() => setShowPw(s => !s)}
                  >
                    {showPw
                      ? <EyeOff className="h-4 w-4 text-muted-foreground" />
                      : <Eye className="h-4 w-4 text-muted-foreground" />}
                  </Button>
                </div>
                <PasswordStrengthMeter password={pw} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="fp-pw2">Confirm Password</Label>
                <div className="relative">
                  <Input
                    id="fp-pw2"
                    type={showPw2 ? 'text' : 'password'}
                    value={pw2}
                    onChange={(e) => setPw2(e.target.value)}
                    placeholder="Confirm your password"
                    required
                    disabled={submitting}
                    className="pr-10"
                  />
                  <Button
                    type="button" variant="ghost" size="sm" tabIndex={-1}
                    className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                    onClick={() => setShowPw2(s => !s)}
                  >
                    {showPw2
                      ? <EyeOff className="h-4 w-4 text-muted-foreground" />
                      : <Eye className="h-4 w-4 text-muted-foreground" />}
                  </Button>
                </div>
              </div>

              <Button type="submit" className="w-full gap-2" disabled={submitting}>
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Activate Account
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

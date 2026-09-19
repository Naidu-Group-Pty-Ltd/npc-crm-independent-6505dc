import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useWhiteLabel } from '@/contexts/WhiteLabelContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, Building2, CheckCircle, Eye, EyeOff, Loader2 } from 'lucide-react';
import { validatePassword } from '@/utils/passwordValidation';
import { PasswordStrengthMeter } from '@/components/ui/password-strength-meter';
import { BrandLogo } from '@/components/branding/BrandAssets';
import { setPortalSessionToken } from '@/lib/portalSession';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/integrations/supabase/env';



async function invokeFunction(functionName: string, body: Record<string, any>) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
    // `client-portal-accept-invite` answers with exact-origin CORS and sets the
    // HttpOnly `__Host-client_session_token` cookie, so the browser must be
    // allowed to keep it.
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) return { data, error: { message: data.error || `HTTP ${response.status}` } };
  return { data, error: null };
}

export default function PortalAcceptInvite() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();
  const { settings } = useWhiteLabel();

  const [validating, setValidating] = useState(true);
  const [inviteValid, setInviteValid] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [alreadyActive, setAlreadyActive] = useState(false);
  const [expiredInvite, setExpiredInvite] = useState(false);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!token) {
      setValidating(false);
      return;
    }
    validateToken();
  }, [token]);

  const validateToken = async () => {
    const { data, error } = await invokeFunction('client-portal-accept-invite', {
      action: 'validate',
      token,
    });

    if (error || !data?.valid) {
      setInviteValid(false);
      if (data?.expired) setExpiredInvite(true);
    } else {
      setInviteValid(true);
      setInviteEmail(data.email || '');
      setInviteName(data.name || '');
      if (data.already_active) setAlreadyActive(true);
    }
    setValidating(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    const validation = validatePassword(password);
    if (!validation.isValid) {
      setError(validation.error || 'Password does not meet requirements');
      return;
    }

    setError('');
    setIsSubmitting(true);

    const { data, error: fnError } = await invokeFunction('client-portal-accept-invite', {
      token,
      password,
    });

    if (fnError || !data?.success) {
      setError(data?.error || fnError?.message || 'Failed to activate account');
      setIsSubmitting(false);
      return;
    }

    // The session lives in the HttpOnly cookie the response set; this in-memory
    // copy only backs the legacy header/body carriers and dies with the tab. It
    // used to be written to localStorage, which left a working client session on
    // the machine indefinitely. See src/lib/portalSession.ts.
    if (data.session_token) {
      setPortalSessionToken(data.session_token);
    }

    setSuccess(true);
    setTimeout(() => navigate('/client', { replace: true }), 2000);
  };

  if (validating) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="h-10 w-10 text-primary mx-auto animate-spin" />
          <p className="text-muted-foreground">Validating your invite...</p>
        </div>
      </div>
    );
  }

  if (!token || !inviteValid) {
    return (
      <div className="client-portal-theme min-h-screen flex items-center justify-center p-4">
        <Card className="client-portal-soft-panel w-full max-w-md overflow-hidden">
          <CardHeader className="border-b border-border/50 bg-gradient-to-r from-destructive/10 via-destructive/5 to-transparent text-center">
            <div className="flex justify-center mb-4">
              <AlertCircle className="h-16 w-16 text-destructive" />
            </div>
            <CardTitle className="text-2xl">
              {expiredInvite ? 'Invite Expired' : 'Invalid Invite'}
            </CardTitle>
            <CardDescription>
              {expiredInvite
                ? 'This invite link has expired. Please contact your advisor to request a new one.'
                : 'This invite link is invalid or has already been used.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Button onClick={() => navigate('/client/login')}>Go to Login</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (alreadyActive) {
    return (
      <div className="client-portal-theme min-h-screen flex items-center justify-center p-4">
        <Card className="client-portal-soft-panel w-full max-w-md overflow-hidden">
          <CardHeader className="border-b border-border/50 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent text-center">
            <div className="flex justify-center mb-4">
                <CheckCircle className="h-16 w-16 text-primary" />
            </div>
            <CardTitle className="text-2xl">Already Activated</CardTitle>
            <CardDescription>Your account is already active. You can log in with your existing password.</CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Button onClick={() => navigate('/client/login')}>Go to Login</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="client-portal-theme min-h-screen flex items-center justify-center p-4">
      <Card className="client-portal-soft-panel w-full max-w-md overflow-hidden">
        <CardHeader className="space-y-2 text-center">
          <div className="flex justify-center mb-4">
            {settings.authLogo ? (
              <BrandLogo slot="auth" className="h-20 max-w-[280px] object-contain" fallbackClassName="h-16 w-16" />
            ) : (
              <Building2 className="h-16 w-16 text-primary" />
            )}
          </div>
          <CardTitle className="text-2xl">Set Up Your Account</CardTitle>
          <CardDescription>
            {inviteName ? `Welcome, ${inviteName}!` : 'Welcome!'} Create a password to access your Client Portal.
          </CardDescription>
          {inviteEmail && (
            <p className="text-sm text-muted-foreground">
              Account: <span className="font-medium text-foreground">{inviteEmail}</span>
            </p>
          )}
        </CardHeader>
        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {success ? (
            <Alert className="border-primary/30 bg-primary/5 text-primary">
              <CheckCircle className="h-4 w-4 text-primary" />
              <AlertDescription>Account activated! Redirecting to your portal...</AlertDescription>
            </Alert>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Create a password"
                    required
                    disabled={isSubmitting}
                    className="pr-10"
                  />
                  <Button type="button" variant="ghost" size="sm" className="absolute right-0 top-0 h-full px-3 hover:bg-transparent" onClick={() => setShowPassword(!showPassword)} tabIndex={-1}>
                    {showPassword ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                  </Button>
                </div>
                <PasswordStrengthMeter password={password} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm Password</Label>
                <div className="relative">
                  <Input
                    id="confirm-password"
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm your password"
                    required
                    disabled={isSubmitting}
                    className="pr-10"
                  />
                  <Button type="button" variant="ghost" size="sm" className="absolute right-0 top-0 h-full px-3 hover:bg-transparent" onClick={() => setShowConfirmPassword(!showConfirmPassword)} tabIndex={-1}>
                    {showConfirmPassword ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                  </Button>
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Activating...
                  </>
                ) : (
                  'Activate Account'
                )}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

import { useRef, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useWhiteLabel } from '@/contexts/WhiteLabelContext';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { logActivityDirect } from '@/hooks/useActivityLogger';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Database, Loader2, Mail, ArrowLeft, ShieldCheck, Eye, EyeOff, KeyRound,
  AlertCircle, CheckCircle, BarChart3, Users, Zap, User as UserIcon, Lock, Sparkles,
} from 'lucide-react';
import { validatePassword } from '@/utils/passwordValidation';
import { PasswordStrengthMeter } from '@/components/ui/password-strength-meter';
import { TurnstileWidget } from '@/components/auth/TurnstileWidget';
import { OtpInput } from '@/components/finance-portal/OtpInput';
import { motion, AnimatePresence } from 'framer-motion';
import { BrandLockup, BrandLogo } from '@/components/branding/BrandAssets';
import { ManageDevicesDialog } from '@/components/auth/ManageDevicesDialog';
import { GlassCard } from '@/components/aurixa/GlassCard';
import { cn } from '@/lib/utils';
import type { DeviceLimitInfo } from '@/hooks/useAuth';

const FEATURES = [
  { icon: BarChart3, title: 'Analytics & Reports', desc: 'Investment reports, market intelligence, and portfolio analytics.' },
  { icon: Users, title: 'Client Management', desc: 'Complete CRM with deal tracking, pipelines, and automation.' },
  { icon: Zap, title: 'AI-Powered Workflows', desc: 'Intelligent agent, automated tasks, and smart recommendations.' },
];

type Mode = 'login' | 'forgot' | 'otp' | 'reset';

const formVariants = {
  enter: { opacity: 0, x: 24 },
  center: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -24 },
};

/** Shared class for inputs with a leading icon slot. */
const iconInputCls = 'h-12 pl-10 pr-3 rounded-xl bg-[color:hsl(var(--aurixa-glass-bg)/0.55)] border-[color:var(--glass-hairline)] focus-visible:ring-2 focus-visible:ring-primary/40 transition-shadow';

export default function Auth() {
  const { signIn, user, loading, retryDeviceRegistration, cancelPendingSession } = useAuth();
  const { settings } = useWhiteLabel();
  const navigate = useNavigate();
  const formRef = useRef<HTMLDivElement>(null);

  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [otp, setOtp] = useState('');
  const [emailHint, setEmailHint] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  const [deviceLimit, setDeviceLimit] = useState<DeviceLimitInfo | null>(null);

  // The spinner below exists only to stop the form flashing in front of someone
  // who is already signed in — it is a courtesy, never a precondition. Sign-in
  // itself needs nothing from the session probe, so after a short grace period
  // the form is shown regardless of how that probe is getting on. Without this,
  // every future stall anywhere in `AuthProvider` becomes a login page that
  // never arrives; the redirect for a valid session still fires from the effect
  // below whenever the probe does answer.
  const [graceElapsed, setGraceElapsed] = useState(false);

  const clearTurnstileToken = useCallback(() => setTurnstileToken(null), []);

  useEffect(() => {
    const id = window.setTimeout(() => setGraceElapsed(true), 2500);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    if (user) navigate('/', { replace: true });
  }, [user, navigate]);

  if (loading && !graceElapsed) {
    return (
      <div className="aurixa-aurora-bg min-h-screen flex items-center justify-center" role="status" aria-label="Loading authentication">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3 }}>
          <div className="flex flex-col items-center gap-3">
            {settings.authLogo ? (
              <BrandLogo slot="auth" className="h-12 max-w-[200px] object-contain" fallbackClassName="h-12 w-12" />
            ) : (
              <div className="h-14 w-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center shadow-[var(--elevation-2)]">
                <Database className="h-7 w-7 text-primary" />
              </div>
            )}
            <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
            <span className="sr-only">Loading</span>
          </div>
        </motion.div>
      </div>
    );
  }

  const changeMode = (next: Mode) => {
    setMode(next);
    setError('');
    setSuccess('');
    setTimeout(() => {
      const firstInput = formRef.current?.querySelector<HTMLInputElement>('input:not([type=hidden])');
      firstInput?.focus();
    }, 250);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setDeviceLimit(null);
    if (!turnstileToken) { setError('Please complete the security check'); return; }
    setIsLoading(true);
    const result = await signIn(username, password, turnstileToken);
    if (result.deviceLimit) {
      setDeviceLimit(result.deviceLimit);
      setError(result.error || 'Device limit reached.');
    } else if (result.error) {
      setTurnstileToken(null);
      setError(result.error);
    } else {
      navigate('/', { replace: true });
    }
    setIsLoading(false);
  };

  const handleDeviceRevoked = async () => {
    const result = await retryDeviceRegistration();
    if (result.deviceLimit) {
      setDeviceLimit(result.deviceLimit);
      setError(result.error || 'Device limit still reached.');
      return;
    }
    if (result.error) {
      setError(result.error);
      return;
    }
    setDeviceLimit(null);
    setError('');
    navigate('/', { replace: true });
  };

  const handleDeviceDialogChange = async (open: boolean) => {
    if (!open) {
      setDeviceLimit(null);
      await cancelPendingSession();
      setTurnstileToken(null);
    }
  };


  const handleRequestOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      const { data } = await invokeSecureFunction('admin-password-reset', { action: 'request_otp', username });
      if (data?.success) {
        setEmailHint(data.email_hint || '');
        changeMode('otp');
        logActivityDirect({
          actionType: 'password_reset_initiated',
          entityType: 'user',
          entityName: username,
          metadata: { email_hint: data.email_hint },
        });
      } else {
        setError(data?.error || 'Failed to send OTP');
      }
    } catch {
      setError('Failed to send OTP');
    }
    setIsLoading(false);
  };

  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      const { data } = await invokeSecureFunction('admin-password-reset', { action: 'verify_otp', username, otp });
      if (data?.success) changeMode('reset');
      else setError(data?.error || 'Invalid OTP');
    } catch {
      setError('Failed to verify OTP');
    }
    setIsLoading(false);
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) { setError('Passwords do not match'); return; }
    const validation = validatePassword(newPassword);
    if (!validation.isValid) { setError(validation.error || 'Password does not meet requirements'); return; }
    setError('');
    setIsLoading(true);
    try {
      const { data } = await invokeSecureFunction('admin-password-reset', { action: 'reset_password', username, otp, new_password: newPassword });
      if (data?.success) {
        setSuccess('Password reset successful! Please login.');
        setTimeout(() => { changeMode('login'); setOtp(''); setNewPassword(''); setConfirmPassword(''); }, 2000);
      } else {
        setError(data?.error || 'Failed to reset password');
      }
    } catch {
      setError('Failed to reset password');
    }
    setIsLoading(false);
  };

  const modeTitle: Record<Mode, string> = {
    login: 'Welcome back',
    forgot: 'Reset password',
    otp: 'Verify your identity',
    reset: 'Set a new password',
  };

  const modeDesc: Record<Mode, string> = {
    login: settings.companyName
      ? `Sign in to the ${settings.companyName} Command Centre.`
      : 'Sign in to access the Command Centre.',
    forgot: 'Enter your username or email and we\'ll send a one-time reset code.',
    otp: emailHint ? `Enter the 6-digit code sent to ${emailHint}.` : 'Enter the 6-digit code we sent you.',
    reset: 'Choose a strong new password to secure your account.',
  };

  const goBack = () => {
    if (mode === 'otp' || mode === 'reset') changeMode('forgot');
    else changeMode('login');
  };

  return (
    <div className="aurixa-aurora-bg relative min-h-screen flex bg-background">
      {/* Decorative floating orbs (respect reduced motion via aurora-bg) */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] h-[420px] w-[420px] rounded-full bg-[hsl(var(--aurixa-aurora-1)/0.10)] blur-3xl" />
        <div className="absolute bottom-[-15%] right-[-10%] h-[520px] w-[520px] rounded-full bg-[hsl(var(--aurixa-aurora-2)/0.10)] blur-3xl" />
      </div>

      {/* ── Left branded panel (desktop only) ── */}
      <aside className="hidden lg:flex lg:w-[520px] xl:w-[560px] flex-col relative overflow-hidden border-r border-[color:var(--glass-hairline)]" aria-hidden="true">
        <div className="absolute top-0 right-0 w-px h-full bg-gradient-to-b from-transparent via-primary/40 to-transparent" />

        <div className="flex-1 flex flex-col justify-between p-10 xl:p-12 relative">
          <div>
            <BrandLockup
              slot="auth"
              meta="Command Centre"
              logoClassName="h-12 max-w-[220px] object-contain"
              fallbackClassName="h-11 w-11 border border-primary/20"
              companyClassName="text-lg font-bold tracking-tight"
              metaClassName="tracking-[0.2em]"
            />
          </div>

          <div className="space-y-10">
            <div>
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[color:var(--glass-hairline)] bg-[color:hsl(var(--aurixa-glass-bg)/0.55)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground backdrop-blur-md">
                <Sparkles className="h-3 w-3 text-primary" />
                <span>Aurixa · Property Intelligence</span>
              </div>
              <h2 className="text-[2.35rem] xl:text-5xl font-semibold tracking-[-0.035em] text-foreground leading-[1.05]">
                Intelligence-driven<br />
                property{' '}
                <span className="bg-gradient-to-r from-primary via-[hsl(var(--aurixa-aurora-1))] to-[hsl(var(--aurixa-aurora-2))] bg-clip-text text-transparent">
                  advisory
                </span>.
              </h2>
              <p className="text-muted-foreground mt-4 text-sm leading-relaxed max-w-md">
                Your centralised command centre for client management, investment analytics,
                automated workflows, and deal orchestration.
              </p>
            </div>

            <div className="space-y-3">
              {FEATURES.map((f, i) => (
                <motion.div
                  key={f.title}
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.4, delay: 0.25 + i * 0.1 }}
                >
                  <GlassCard
                    elevation={1}
                    className="flex items-start gap-3.5 px-4 py-3.5"
                  >
                    <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-gradient-to-br from-primary/15 to-[hsl(var(--aurixa-aurora-2)/0.15)] text-primary shrink-0 border border-primary/15">
                      <f.icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-foreground">{f.title}</div>
                      <div className="text-xs text-muted-foreground leading-relaxed mt-0.5">{f.desc}</div>
                    </div>
                  </GlassCard>
                </motion.div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60">
            <ShieldCheck className="h-3.5 w-3.5 text-primary/70" />
            <span className="tracking-wide">Secured platform · End-to-end encrypted · Audit logged</span>
          </div>
        </div>
      </aside>

      {/* ── Right form panel ── */}
      <main className="relative flex-1 flex items-center justify-center p-5 sm:p-8 md:p-10" role="main" aria-label="Dashboard authentication">
        <motion.div
          className="w-full max-w-md"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          {/* Mobile logo */}
          <div className="lg:hidden flex justify-center mb-6">
            {settings.authLogo ? (
              <img src={settings.authLogo} alt={settings.companyName || 'Dashboard'} className="h-14 max-w-[220px] object-contain" />
            ) : (
              <div className="flex flex-col items-center gap-3">
                <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-primary/20 to-[hsl(var(--aurixa-aurora-2)/0.20)] border border-primary/25 flex items-center justify-center shadow-[var(--elevation-2)]">
                  <Database className="h-7 w-7 text-primary" aria-hidden="true" />
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold tracking-tight">{settings.companyName || 'Dashboard'}</div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-[0.22em] font-medium">Command Centre</div>
                </div>
              </div>
            )}
          </div>

          <GlassCard elevation={3} className="px-6 py-7 sm:px-8 sm:py-8">
            {/* Header */}
            <div className="mb-5">
              {mode !== 'login' && (
                <button
                  type="button"
                  onClick={goBack}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded px-1 py-0.5"
                  aria-label={`Back to ${mode === 'otp' || mode === 'reset' ? 'forgot password' : 'sign in'}`}
                >
                  <ArrowLeft className="h-3 w-3" aria-hidden="true" />
                  Back
                </button>
              )}
              <h1
                className="text-2xl sm:text-[1.65rem] font-semibold tracking-[-0.02em] text-foreground"
                id="form-heading"
              >
                {modeTitle[mode]}
              </h1>
              <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed" id="form-description">
                {modeDesc[mode]}
              </p>
            </div>

            {/* Status messages */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                >
                  <Alert variant="destructive" className="mb-4" role="alert">
                    <AlertCircle className="h-4 w-4" aria-hidden="true" />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                </motion.div>
              )}
              {success && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                >
                  <Alert className="mb-4 border-success/50 bg-success/5" role="status">
                    <CheckCircle className="h-4 w-4 text-success" aria-hidden="true" />
                    <AlertDescription>{success}</AlertDescription>
                  </Alert>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Animated form swap */}
            <div ref={formRef}>
              <AnimatePresence mode="wait">
                <motion.div
                  key={mode}
                  variants={formVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: 0.2, ease: 'easeInOut' }}
                >
                  {mode === 'login' && (
                    <form onSubmit={handleLogin} className="space-y-4" aria-labelledby="form-heading" aria-describedby="form-description">
                      <div className="space-y-1.5">
                        <Label htmlFor="admin-username" className="text-xs font-medium">Username or email</Label>
                        <div className="relative">
                          <UserIcon aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                            id="admin-username"
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                            placeholder="Username or email address"
                            autoComplete="username"
                            required
                            disabled={isLoading}
                            className={iconInputCls}
                            aria-required="true"
                          />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex items-baseline justify-between">
                          <Label htmlFor="admin-password" className="text-xs font-medium">Password</Label>
                          <button
                            type="button"
                            className="text-[11px] text-muted-foreground hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded px-1"
                            onClick={() => changeMode('forgot')}
                            aria-label="Forgot your password? Request a reset code"
                          >
                            Forgot password?
                          </button>
                        </div>
                        <div className="relative">
                          <Lock aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                            id="admin-password"
                            type={showPassword ? 'text' : 'password'}
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            placeholder="Enter your password"
                            autoComplete="current-password"
                            required
                            disabled={isLoading}
                            className={cn(iconInputCls, 'pr-10')}
                            aria-required="true"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(v => !v)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
                            aria-label={showPassword ? 'Hide password' : 'Show password'}
                          >
                            {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                          </button>
                        </div>
                      </div>
                      <TurnstileWidget onVerify={setTurnstileToken} onExpire={clearTurnstileToken} onError={clearTurnstileToken} />
                      <Button
                        type="submit"
                        className="w-full h-12 gap-2 font-semibold text-sm rounded-xl shadow-[var(--elevation-2)] transition-transform active:scale-[0.99]"
                        disabled={isLoading || !turnstileToken}
                        aria-busy={isLoading}
                      >
                        {isLoading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                        Sign In
                      </Button>
                    </form>
                  )}

                  {mode === 'forgot' && (
                    <form onSubmit={handleRequestOTP} className="space-y-4" aria-labelledby="form-heading" aria-describedby="form-description">
                      <div className="space-y-1.5">
                        <Label htmlFor="forgot-admin-username" className="text-xs font-medium">Username or email</Label>
                        <div className="relative">
                          <UserIcon aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                            id="forgot-admin-username"
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                            placeholder="Username or email address"
                            required
                            disabled={isLoading}
                            className={iconInputCls}
                            aria-required="true"
                          />
                        </div>
                      </div>
                      <Button
                        type="submit"
                        className="w-full h-12 gap-2 font-semibold rounded-xl shadow-[var(--elevation-2)]"
                        disabled={isLoading}
                        aria-busy={isLoading}
                      >
                        {isLoading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                        <Mail className="h-4 w-4" aria-hidden="true" /> Send reset code
                      </Button>
                    </form>
                  )}

                  {mode === 'otp' && (
                    <form onSubmit={handleVerifyOTP} className="space-y-5" aria-labelledby="form-heading" aria-describedby="form-description">
                      <div className="space-y-3">
                        <Label className="text-xs font-medium block text-center">Verification code</Label>
                        <OtpInput value={otp} onChange={setOtp} length={6} disabled={isLoading} />
                        {emailHint && (
                          <p className="text-xs text-muted-foreground text-center" aria-live="polite">
                            Sent to <span className="font-medium text-foreground">{emailHint}</span>
                          </p>
                        )}
                      </div>
                      <Button
                        type="submit"
                        className="w-full h-12 gap-2 font-semibold rounded-xl shadow-[var(--elevation-2)]"
                        disabled={otp.length !== 6 || isLoading}
                        aria-busy={isLoading}
                      >
                        {isLoading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                        <KeyRound className="h-4 w-4" aria-hidden="true" /> Verify code
                      </Button>
                    </form>
                  )}

                  {mode === 'reset' && (
                    <form onSubmit={handleResetPassword} className="space-y-4" aria-labelledby="form-heading" aria-describedby="form-description">
                      <div className="space-y-1.5">
                        <Label htmlFor="admin-new-password" className="text-xs font-medium">New password</Label>
                        <div className="relative">
                          <Lock aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                            id="admin-new-password"
                            type={showNewPassword ? 'text' : 'password'}
                            value={newPassword}
                            onChange={e => setNewPassword(e.target.value)}
                            className={cn(iconInputCls, 'pr-10')}
                            placeholder="Create a strong password"
                            required
                            disabled={isLoading}
                            autoFocus
                            aria-required="true"
                            aria-describedby="admin-pw-strength"
                          />
                          <button
                            type="button"
                            onClick={() => setShowNewPassword(v => !v)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
                            aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                          >
                            {showNewPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                          </button>
                        </div>
                        <div id="admin-pw-strength" className="pt-1">
                          <PasswordStrengthMeter password={newPassword} />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="admin-confirm-password" className="text-xs font-medium">Confirm password</Label>
                        <div className="relative">
                          <Lock aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                            id="admin-confirm-password"
                            type={showConfirmPassword ? 'text' : 'password'}
                            value={confirmPassword}
                            onChange={e => setConfirmPassword(e.target.value)}
                            className={cn(iconInputCls, 'pr-10')}
                            placeholder="Re-enter your new password"
                            required
                            disabled={isLoading}
                            aria-required="true"
                          />
                          <button
                            type="button"
                            onClick={() => setShowConfirmPassword(v => !v)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
                            aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                          >
                            {showConfirmPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                          </button>
                        </div>
                      </div>
                      <Button
                        type="submit"
                        className="w-full h-12 gap-2 font-semibold rounded-xl shadow-[var(--elevation-2)]"
                        disabled={isLoading}
                        aria-busy={isLoading}
                      >
                        {isLoading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                        Reset password
                      </Button>
                    </form>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </GlassCard>

          {/* Bottom security note */}
          <div className="mt-6 flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground/60">
            <ShieldCheck className="h-3 w-3" aria-hidden="true" />
            <span className="tracking-wide">Secured · End-to-end encrypted · Audit logged</span>
          </div>
        </motion.div>
      </main>

      <ManageDevicesDialog
        open={Boolean(deviceLimit)}
        onOpenChange={handleDeviceDialogChange}
        devicesActive={deviceLimit?.devices_active ?? 0}
        deviceLimit={deviceLimit?.device_limit ?? 0}
        devices={deviceLimit?.devices ?? []}
        onDeviceRevoked={handleDeviceRevoked}
      />
    </div>
  );
}

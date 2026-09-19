import { useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePortalAuth } from '@/hooks/usePortalAuth';
import { useWhiteLabel } from '@/contexts/WhiteLabelContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Building2, Loader2, Mail, ArrowLeft, ShieldCheck, Eye, EyeOff, KeyRound,
  TrendingUp, FileText, BarChart3, AlertCircle, CheckCircle,
} from 'lucide-react';
import { validatePassword } from '@/utils/passwordValidation';
import { PasswordStrengthMeter } from '@/components/ui/password-strength-meter';
import { TurnstileWidget } from '@/components/auth/TurnstileWidget';
import { OtpInput } from '@/components/finance-portal/OtpInput';
import { motion, AnimatePresence } from 'framer-motion';
import { BrandLockup, BrandLogo } from '@/components/branding/BrandAssets';

const FEATURES = [
  { icon: TrendingUp, title: 'Deal Progress', desc: 'Track every stage of your property acquisition in real-time.' },
  { icon: BarChart3, title: 'Property Insights', desc: 'Detailed analytics and investment reports at your fingertips.' },
  { icon: FileText, title: 'Documents & Reports', desc: 'Secure access to all your property documents and financial reports.' },
];

type Mode = 'login' | 'forgot' | 'otp' | 'reset';

const formVariants = {
  enter: { opacity: 0, x: 24 },
  center: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -24 },
};

export default function PortalAuth() {
  const { signIn, user, loading, requestPasswordReset, verifyOTP, resetPassword } = usePortalAuth();
  const { settings } = useWhiteLabel();
  const navigate = useNavigate();
  const formRef = useRef<HTMLDivElement>(null);

  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  const clearTurnstileToken = useCallback(() => setTurnstileToken(null), []);

  if (user) {
    navigate('/client', { replace: true });
    return null;
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" role="status" aria-label="Loading authentication">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3 }}>
          <div className="flex flex-col items-center gap-3">
            <BrandLogo slot="auth" className="h-12 max-w-[200px] object-contain" fallbackClassName="h-12 w-12" />
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
    if (!turnstileToken) { setError('Please complete the security check'); return; }
    setIsLoading(true);
    const result = await signIn(email, password, turnstileToken);
    if (result.error) { setTurnstileToken(null); setError(result.error); }
    else navigate('/client', { replace: true });
    setIsLoading(false);
  };

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    const result = await requestPasswordReset(email);
    if (result.error) setError(result.error);
    else { setSuccess('If an account exists with this email, a reset code has been sent.'); changeMode('otp'); setSuccess('If an account exists with this email, a reset code has been sent.'); }
    setIsLoading(false);
  };

  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    const result = await verifyOTP(email, otp);
    if (result.error) setError(result.error);
    else changeMode('reset');
    setIsLoading(false);
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) { setError('Passwords do not match'); return; }
    const validation = validatePassword(newPassword);
    if (!validation.isValid) { setError(validation.error || 'Password does not meet requirements'); return; }
    setError('');
    setIsLoading(true);
    const result = await resetPassword(email, otp, newPassword);
    if (result.error) setError(result.error);
    else { setSuccess('Password reset successful! Please login.'); setTimeout(() => { changeMode('login'); setOtp(''); setNewPassword(''); setConfirmPassword(''); }, 2000); }
    setIsLoading(false);
  };

  const modeTitle: Record<Mode, string> = {
    login: 'Client Portal',
    forgot: 'Reset password',
    otp: 'Verify your identity',
    reset: 'New password',
  };

  const modeDesc: Record<Mode, string> = {
    login: 'Sign in to access your property portfolio.',
    forgot: 'Enter your email to receive a reset code.',
    otp: 'Enter the 6-digit code we emailed you.',
    reset: 'Choose a new secure password.',
  };

  const goBack = () => {
    if (mode === 'otp' || mode === 'reset') changeMode('forgot');
    else changeMode('login');
  };

  return (
    <div className="min-h-screen flex">
      {/* ── Left branded panel (desktop only) ── */}
      <aside className="hidden lg:flex lg:w-[480px] xl:w-[520px] flex-col relative bg-gradient-to-br from-card via-card to-primary/5 border-r border-border overflow-hidden" aria-hidden="true">
        <div className="absolute top-0 right-0 w-[2px] h-full bg-gradient-to-b from-transparent via-primary/30 to-transparent" />
        <div className="absolute -top-24 -left-24 w-72 h-72 rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute -bottom-32 -right-16 w-80 h-80 rounded-full bg-primary/5 blur-3xl" />

        <div className="flex-1 flex flex-col justify-between p-10 relative">
          <div>
            <BrandLockup
              slot="auth"
              meta="Secure Access"
              logoClassName="h-12 max-w-[220px] object-contain"
              fallbackClassName="h-11 w-11 border border-primary/20"
              companyClassName="text-lg font-bold tracking-tight"
              metaClassName="tracking-[0.2em]"
            />
          </div>

          <div className="space-y-8">
            <div>
              <h2 className="text-3xl font-bold tracking-tight text-foreground leading-tight">
                Your property journey,<br />
                one <span className="text-primary">dashboard</span>.
              </h2>
              <p className="text-muted-foreground mt-3 text-sm leading-relaxed max-w-sm">
                Track deal progress, view investment reports, manage documents, and stay connected with your advisory team.
              </p>
            </div>

            <div className="space-y-4">
              {FEATURES.map((f, i) => (
                <motion.div
                  key={f.title}
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.4, delay: 0.3 + i * 0.12 }}
                  className="flex items-start gap-3"
                >
                  <div className="flex items-center justify-center h-9 w-9 rounded-xl bg-primary/10 text-primary shrink-0 mt-0.5">
                    <f.icon className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-foreground">{f.title}</div>
                    <div className="text-xs text-muted-foreground leading-relaxed">{f.desc}</div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          <div className="text-[10px] text-muted-foreground/40 flex items-center gap-1.5">
            <ShieldCheck className="h-3 w-3" />
            <span>Secured portal · End-to-end encrypted · Audit logged</span>
          </div>
        </div>
      </aside>

      {/* ── Right form panel ── */}
      <main className="flex-1 flex items-center justify-center p-6 md:p-10" role="main" aria-label="Client Portal authentication">
        <motion.div
          className="w-full max-w-sm"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          {/* Mobile logo */}
          <div className="lg:hidden flex justify-center mb-8">
            {settings.authLogo ? (
              <img src={settings.authLogo} alt={settings.companyName || 'Client Portal'} className="h-14 max-w-[220px] object-contain" />
            ) : (
              <div className="flex flex-col items-center gap-3">
                <div className="h-14 w-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <Building2 className="h-7 w-7 text-primary" aria-hidden="true" />
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold tracking-tight">Client Portal</div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-[0.2em] font-medium">Secure Access</div>
                </div>
              </div>
            )}
          </div>

          {/* Header */}
          <div className="mb-6">
            {mode !== 'login' && (
              <button
                type="button"
                onClick={goBack}
                data-slot="touch-target"
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded px-1 py-0.5"
                aria-label={`Back to ${mode === 'otp' || mode === 'reset' ? 'forgot password' : 'sign in'}`}
              >
                <ArrowLeft className="h-3 w-3" aria-hidden="true" />
                Back
              </button>
            )}
            <h1 className="text-2xl font-bold tracking-tight" id="form-heading">{modeTitle[mode]}</h1>
            <p className="text-sm text-muted-foreground mt-1" id="form-description">{modeDesc[mode]}</p>
          </div>

          {/* Status messages */}
          {error && (
            <Alert variant="destructive" className="mb-4" role="alert">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {success && (
            <Alert className="mb-4 border-success" role="status">
              <CheckCircle className="h-4 w-4 text-success" aria-hidden="true" />
              <AlertDescription>{success}</AlertDescription>
            </Alert>
          )}

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
                      <Label htmlFor="portal-email" className="text-xs font-medium">Email</Label>
                      <Input
                        id="portal-email"
                        type="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        autoComplete="email"
                        required
                        disabled={isLoading}
                        className="h-11"
                        aria-required="true"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="portal-password" className="text-xs font-medium">Password</Label>
                      <div className="relative">
                        <Input
                          id="portal-password"
                          type={showPassword ? 'text' : 'password'}
                          value={password}
                          onChange={e => setPassword(e.target.value)}
                          autoComplete="current-password"
                          required
                          disabled={isLoading}
                          className="h-11 pr-10"
                          aria-required="true"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(v => !v)}
                          data-slot="touch-target"
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                        </button>
                      </div>
                    </div>
                    <TurnstileWidget onVerify={setTurnstileToken} onExpire={clearTurnstileToken} onError={clearTurnstileToken} />
                    <Button type="submit" className="w-full h-11 gap-2 font-semibold" disabled={isLoading || !turnstileToken} aria-busy={isLoading}>
                      {isLoading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                      Sign In
                    </Button>
                    <div className="text-center">
                      <button
                        type="button"
                        data-slot="touch-target"
                        className="text-xs text-muted-foreground hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded px-1 py-0.5"
                        onClick={() => changeMode('forgot')}
                        aria-label="Forgot your password? Request a reset code"
                      >
                        Forgot password?
                      </button>
                    </div>
                  </form>
                )}

                {mode === 'forgot' && (
                  <form onSubmit={handleRequestReset} className="space-y-4" aria-labelledby="form-heading" aria-describedby="form-description">
                    <div className="space-y-1.5">
                      <Label htmlFor="forgot-portal-email" className="text-xs font-medium">Email</Label>
                      <Input
                        id="forgot-portal-email"
                        type="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        required
                        disabled={isLoading}
                        className="h-11"
                        aria-required="true"
                      />
                    </div>
                    <Button type="submit" className="w-full h-11 gap-2 font-semibold" disabled={isLoading} aria-busy={isLoading}>
                      {isLoading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                      <Mail className="h-4 w-4" aria-hidden="true" /> Send Reset Code
                    </Button>
                  </form>
                )}

                {mode === 'otp' && (
                  <form onSubmit={handleVerifyOTP} className="space-y-5" aria-labelledby="form-heading" aria-describedby="form-description">
                    <div className="space-y-3">
                      <Label className="text-xs font-medium block text-center">Verification code</Label>
                      <OtpInput value={otp} onChange={setOtp} length={6} disabled={isLoading} />
                      <p className="text-xs text-muted-foreground text-center" aria-live="polite">
                        Sent to <span className="font-medium text-foreground">{email}</span>
                      </p>
                    </div>
                    <Button type="submit" className="w-full h-11 gap-2 font-semibold" disabled={otp.length !== 6 || isLoading} aria-busy={isLoading}>
                      {isLoading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                      <KeyRound className="h-4 w-4" aria-hidden="true" /> Verify Code
                    </Button>
                  </form>
                )}

                {mode === 'reset' && (
                  <form onSubmit={handleResetPassword} className="space-y-4" aria-labelledby="form-heading" aria-describedby="form-description">
                    <div className="space-y-1.5">
                      <Label htmlFor="portal-new-password" className="text-xs font-medium">New password</Label>
                      <div className="relative">
                        <Input
                          id="portal-new-password"
                          type={showNewPassword ? 'text' : 'password'}
                          value={newPassword}
                          onChange={e => setNewPassword(e.target.value)}
                          className="h-11 pr-10"
                          required
                          disabled={isLoading}
                          autoFocus
                          aria-required="true"
                          aria-describedby="portal-pw-strength"
                        />
                        <button
                          type="button"
                          onClick={() => setShowNewPassword(v => !v)}
                          data-slot="touch-target"
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                          aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                        >
                          {showNewPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                        </button>
                      </div>
                      <div id="portal-pw-strength">
                        <PasswordStrengthMeter password={newPassword} />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="portal-confirm-password" className="text-xs font-medium">Confirm password</Label>
                      <div className="relative">
                        <Input
                          id="portal-confirm-password"
                          type={showConfirmPassword ? 'text' : 'password'}
                          value={confirmPassword}
                          onChange={e => setConfirmPassword(e.target.value)}
                          className="h-11 pr-10"
                          required
                          disabled={isLoading}
                          aria-required="true"
                        />
                        <button
                          type="button"
                          onClick={() => setShowConfirmPassword(v => !v)}
                          data-slot="touch-target"
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                          aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                        >
                          {showConfirmPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                        </button>
                      </div>
                    </div>
                    <Button type="submit" className="w-full h-11 gap-2 font-semibold" disabled={isLoading} aria-busy={isLoading}>
                      {isLoading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                      Reset Password
                    </Button>
                  </form>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Bottom security note (mobile) */}
          <div className="lg:hidden mt-8 flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground/40">
            <ShieldCheck className="h-3 w-3" aria-hidden="true" />
            <span>Secured · End-to-end encrypted</span>
          </div>
        </motion.div>
      </main>
    </div>
  );
}

import { useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Gavel,
  KeyRound,
  Loader2,
  Mail,
  
  ShieldCheck,
  FileSignature,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TurnstileWidget } from '@/components/auth/TurnstileWidget';
import { OtpInput } from '@/components/finance-portal/OtpInput';
import { useSolicitorPortalAuth } from '@/hooks/useSolicitorPortalAuth';
import { safeReturnTo } from '@/lib/aml/partnerPortalHandoff';
import { BrandLockup, BrandLogo } from '@/components/branding/BrandAssets';
import { useBrand } from '@/branding/useTokens';

const FEATURES = [
  { icon: Gavel, title: 'Matter Deal Rooms', desc: 'Every conveyancing matter, party and critical date in one workspace.' },
  { icon: ShieldCheck, title: 'Secure & Auditable', desc: 'Hash-chained audit trail on every document and decision.' },
  { icon: FileSignature, title: 'Permission-based Access', desc: 'Granular per-client permissions controlled by your administrators.' },
];

type Mode = 'login' | 'forgot' | 'verify' | 'reset';

const formVariants = {
  enter: { opacity: 0, x: 24 },
  center: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -24 },
};

export default function SolicitorLogin() {
  const { user, loading, signIn, requestPasswordReset, verifyOtp, resetPassword } = useSolicitorPortalAuth();
  const { settings } = useBrand();
  const navigate = useNavigate();
  const location = useLocation();
  /* Where the visitor was going. Validated as an internal path — an open
     redirect on a login page is a phishing primitive. */
  const destination = safeReturnTo(
    (location.state as { from?: unknown } | null)?.from, '/solicitor');
  const formRef = useRef<HTMLDivElement>(null);

  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" role="status" aria-label="Loading authentication">
        <div className="flex flex-col items-center gap-3">
          <BrandLogo slot="auth" className="h-12 max-w-[200px] object-contain" fallbackClassName="h-12 w-12" />

          <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
          <span className="sr-only">Loading</span>
        </div>
      </div>
    );
  }

  if (user) {
    return <Navigate to={user.must_change_password ? '/solicitor/change-password' : destination} replace />;
  }

  const changeMode = (next: Mode) => {
    setMode(next);
    setTimeout(() => {
      formRef.current?.querySelector<HTMLInputElement>('input:not([type=hidden])')?.focus();
    }, 250);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return toast.error('Email and password required');
    if (!turnstileToken) return toast.error('Please complete the security check');
    setSubmitting(true);
    try {
      const result = await signIn(email, password, turnstileToken || undefined);
      if (result.error) {
        toast.error(result.error);
        setTurnstileToken(null);
        return;
      }
      navigate(destination, { replace: true });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return toast.error('Email required');
    setSubmitting(true);
    try {
      const { error } = await requestPasswordReset(email);
      if (error) toast.error(error);
      else {
        // A new code makes the previous one dead. Leaving its digits in the
        // boxes invites the one mistake the screen cannot recover from:
        // pressing Verify on a code that has already been replaced, and being
        // told the code is invalid.
        setOtp('');
        toast.success('If that email exists, a code has been sent.');
        changeMode('verify');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otp.length !== 6) return toast.error('Enter the 6-digit code');
    setSubmitting(true);
    try {
      const { error } = await verifyOtp(email, otp);
      if (error) {
        toast.error(error);
        // A rejected code is never going to be accepted on a second press, so
        // clear it and put the caret back at the first box rather than leaving
        // six digits the user has to delete one at a time.
        setOtp('');
        setTimeout(() => {
          formRef.current?.querySelector<HTMLInputElement>('input:not([type=hidden])')?.focus();
        }, 0);
      } else changeMode('reset');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword || newPassword.length < 10) return toast.error('Password must be at least 10 characters');
    setSubmitting(true);
    try {
      const { error } = await resetPassword(email, otp, newPassword);
      if (error) toast.error(error);
      else {
        toast.success('Password reset. Please sign in.');
        setPassword('');
        setOtp('');
        setNewPassword('');
        changeMode('login');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const modeTitle: Record<Mode, string> = {
    login: 'Welcome back',
    forgot: 'Reset password',
    verify: 'Verify your identity',
    reset: 'New password',
  };

  const modeDesc: Record<Mode, string> = {
    login: 'Sign in to manage your conveyancing matters.',
    forgot: 'Enter your email to receive a reset code.',
    verify: 'Enter the 6-digit code we emailed you.',
    reset: 'Choose a new secure password.',
  };

  const goBack = () => {
    if (mode === 'verify' || mode === 'reset') {
      // Going back leads to "send another code", which is exactly when a
      // leftover code becomes a trap.
      setOtp('');
      changeMode('forgot');
    } else changeMode('login');
  };

  return (
    <div className="min-h-screen flex">
      {/* ── Left branded panel (desktop only) ── */}
      <aside
        className="hidden lg:flex lg:w-[480px] xl:w-[520px] flex-col relative overflow-hidden border-r border-border bg-gradient-to-br from-card via-card to-primary/5"
        aria-hidden="true"
      >
        <div className="absolute top-0 right-0 h-full w-[2px] bg-gradient-to-b from-transparent via-primary/30 to-transparent" />
        <div className="absolute -top-24 -left-24 h-72 w-72 rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute -bottom-32 -right-16 h-80 w-80 rounded-full bg-primary/5 blur-3xl" />

        <div className="relative flex flex-1 flex-col justify-between p-10">
          <BrandLockup
            slot="auth"
            meta="Solicitor Portal · Legal Access"
            logoClassName="h-12 max-w-[220px] object-contain"
            fallbackClassName="h-11 w-11 border border-primary/20"
            companyClassName="text-lg font-bold tracking-tight"
            metaClassName="tracking-[0.2em]"
          />

          <div className="space-y-8">
            <div>
              <h2 className="text-3xl font-bold leading-tight tracking-tight text-foreground">
                Run conveyancing<br />
                with <span className="text-primary">certainty</span>.
              </h2>
              <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
                Your secure workspace for matters, critical dates, searches, requisitions and settlement runway tracking.
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
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <f.icon className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-foreground">{f.title}</div>
                    <div className="text-xs leading-relaxed text-muted-foreground">{f.desc}</div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/40">
            <ShieldCheck className="h-3 w-3" />
            <span>Secured portal · End-to-end encrypted · Audit logged</span>
          </div>
        </div>
      </aside>

      {/* ── Right form panel ── */}
      <main className="flex flex-1 items-center justify-center p-6 md:p-10" role="main" aria-label="Solicitor Portal authentication">
        <motion.div
          className="w-full max-w-sm"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          {/* Mobile logo */}
          <div className="mb-8 flex justify-center lg:hidden">
            <div className="flex flex-col items-center gap-3">
              <BrandLogo
                slot="auth"
                alt={settings.companyName || 'Solicitor Portal'}
                className="h-14 max-w-[220px] object-contain"
                fallbackClassName="h-14 w-14 rounded-2xl border border-primary/20"
              />
              <div className="text-center">
                <div className="text-lg font-bold tracking-tight">{settings.companyName || 'Solicitor Portal'}</div>
                <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">Solicitor Portal · Legal Access</div>
              </div>
            </div>
          </div>

          {/* Header */}
          <div className="mb-6">
            {mode !== 'login' && (
              <button
                type="button"
                onClick={goBack}
                className="mb-4 flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                aria-label={`Back to ${mode === 'verify' || mode === 'reset' ? 'forgot password' : 'sign in'}`}
              >
                <ArrowLeft className="h-3 w-3" aria-hidden="true" />
                Back
              </button>
            )}
            <h1 className="text-2xl font-bold tracking-tight" id="form-heading">{modeTitle[mode]}</h1>
            <p className="mt-1 text-sm text-muted-foreground" id="form-description">{modeDesc[mode]}</p>
          </div>

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
                      <Label htmlFor="solicitor-email" className="text-xs font-medium">Email</Label>
                      <Input
                        id="solicitor-email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@lawfirm.com.au"
                        autoComplete="email"
                        required
                        className="h-11"
                        aria-required="true"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="solicitor-password" className="text-xs font-medium">Password</Label>
                      <div className="relative">
                        <Input
                          id="solicitor-password"
                          type={showPassword ? 'text' : 'password'}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          autoComplete="current-password"
                          required
                          className="h-11 pr-10"
                          aria-required="true"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((v) => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                        </button>
                      </div>
                    </div>
                    <TurnstileWidget
                      onVerify={(token) => setTurnstileToken(token)}
                      onExpire={() => setTurnstileToken(null)}
                      onError={() => setTurnstileToken(null)}
                    />
                    <Button type="submit" className="h-11 w-full gap-2 font-semibold" disabled={submitting} aria-busy={submitting}>
                      {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                      Sign In
                    </Button>
                    <div className="text-center">
                      <button
                        type="button"
                        className="rounded px-1 py-0.5 text-xs text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        onClick={() => changeMode('forgot')}
                      >
                        Forgot password?
                      </button>
                    </div>
                  </form>
                )}

                {mode === 'forgot' && (
                  <form onSubmit={handleRequestReset} className="space-y-4" aria-labelledby="form-heading" aria-describedby="form-description">
                    <div className="space-y-1.5">
                      <Label htmlFor="solicitor-forgot-email" className="text-xs font-medium">Email</Label>
                      <Input
                        id="solicitor-forgot-email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@lawfirm.com.au"
                        required
                        className="h-11"
                        aria-required="true"
                      />
                    </div>
                    <Button type="submit" className="h-11 w-full gap-2 font-semibold" disabled={submitting} aria-busy={submitting}>
                      {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                      <Mail className="h-4 w-4" aria-hidden="true" /> Send Reset Code
                    </Button>
                  </form>
                )}

                {mode === 'verify' && (
                  <form onSubmit={handleVerify} className="space-y-5" aria-labelledby="form-heading" aria-describedby="form-description">
                    <div className="space-y-3">
                      <Label className="block text-center text-xs font-medium">Verification code</Label>
                      <OtpInput value={otp} onChange={setOtp} length={6} disabled={submitting} />
                      <p className="text-center text-xs text-muted-foreground" aria-live="polite">
                        Sent to <span className="font-medium text-foreground">{email}</span>
                      </p>
                    </div>
                    <Button type="submit" className="h-11 w-full gap-2 font-semibold" disabled={submitting || otp.length < 6} aria-busy={submitting}>
                      {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                      <KeyRound className="h-4 w-4" aria-hidden="true" /> Verify Code
                    </Button>
                  </form>
                )}

                {mode === 'reset' && (
                  <form onSubmit={handleReset} className="space-y-4" aria-labelledby="form-heading" aria-describedby="form-description">
                    <div className="space-y-1.5">
                      <Label htmlFor="solicitor-new-password" className="text-xs font-medium">New password</Label>
                      <div className="relative">
                        <Input
                          id="solicitor-new-password"
                          type={showPassword ? 'text' : 'password'}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          className="h-11 pr-10"
                          minLength={10}
                          required
                          autoFocus
                          aria-required="true"
                          aria-describedby="solicitor-password-hint"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((v) => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                        </button>
                      </div>
                      <p className="text-[11px] text-muted-foreground" id="solicitor-password-hint">Minimum 10 characters.</p>
                    </div>
                    <Button type="submit" className="h-11 w-full gap-2 font-semibold" disabled={submitting} aria-busy={submitting}>
                      {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                      Set Password
                    </Button>
                  </form>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="mt-8 flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground/40 lg:hidden">
            <ShieldCheck className="h-3 w-3" aria-hidden="true" />
            <span>Secured · End-to-end encrypted</span>
          </div>
        </motion.div>
      </main>
    </div>
  );
}

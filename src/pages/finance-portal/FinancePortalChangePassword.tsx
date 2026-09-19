import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, Eye, EyeOff, KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { validatePassword } from '@/utils/passwordValidation';
import { PasswordStrengthMeter } from '@/components/ui/password-strength-meter';
import { toast } from 'sonner';
import { useWhiteLabel } from '@/contexts/WhiteLabelContext';
import { BrandLogo } from '@/components/branding/BrandAssets';

export default function FinancePortalChangePassword() {
  const { user, changePassword, signOut } = useFinancePortalAuth();
  const { settings } = useWhiteLabel();
  const navigate = useNavigate();
  const location = useLocation();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show1, setShow1] = useState(false);
  const [show2, setShow2] = useState(false);
  const [show3, setShow3] = useState(false);
  const [err, setErr] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const forced = !!user?.must_change_password;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (next !== confirm) { setErr('New passwords do not match'); return; }
    const v = validatePassword(next);
    if (!v.isValid) { setErr(v.error || 'Password does not meet requirements'); return; }
    if (next === current) { setErr('New password must differ from current'); return; }
    setSubmitting(true);
    const { error, success } = await changePassword(current, next);
    setSubmitting(false);
    if (error || !success) { setErr(error || 'Failed to change password'); return; }
    toast.success('Password changed successfully');
    // The last gate in the chain that can still hand the partner back to the
    // link they arrived on. `state.from` is set by the route guard and by the
    // login page; both have already checked it is an in-portal path.
    const onward = (location.state as { from?: string } | null)?.from;
    navigate(
      typeof onward === 'string' && /^\/finance(\/|$|\?)/.test(onward) ? onward : '/finance',
      { replace: true },
    );
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/30 p-4">
      <Card className="w-full max-w-md shadow-xl border-primary/10">
        <CardHeader className="text-center space-y-3">
          <div className="flex justify-center mb-2">
            {settings.authLogo ? (
              <BrandLogo slot="auth" className="h-16 max-w-[240px] object-contain" fallbackClassName="h-14 w-14" />
            ) : (
              <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
                <ShieldCheck className="h-7 w-7 text-primary" />
              </div>
            )}
          </div>
          <CardTitle className="text-2xl">
            {forced ? 'Change Your Temporary Password' : 'Change Password'}
          </CardTitle>
          <CardDescription>
            {forced
              ? 'For security, please set a new password before continuing to the portal.'
              : 'Update the password on your finance portal account.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {err && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{err}</AlertDescription>
            </Alert>
          )}
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cp-cur">{forced ? 'Temporary password' : 'Current password'}</Label>
              <div className="relative">
                <Input
                  id="cp-cur" type={show1 ? 'text' : 'password'} value={current}
                  onChange={(e) => setCurrent(e.target.value)} required disabled={submitting} className="pr-10"
                />
                <Button type="button" variant="ghost" size="sm" tabIndex={-1}
                  className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                  onClick={() => setShow1(s => !s)}>
                  {show1 ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cp-new">New password</Label>
              <div className="relative">
                <Input
                  id="cp-new" type={show2 ? 'text' : 'password'} value={next}
                  onChange={(e) => setNext(e.target.value)} required disabled={submitting} className="pr-10"
                />
                <Button type="button" variant="ghost" size="sm" tabIndex={-1}
                  className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                  onClick={() => setShow2(s => !s)}>
                  {show2 ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                </Button>
              </div>
              <PasswordStrengthMeter password={next} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="cp-cf">Confirm new password</Label>
              <div className="relative">
                <Input
                  id="cp-cf" type={show3 ? 'text' : 'password'} value={confirm}
                  onChange={(e) => setConfirm(e.target.value)} required disabled={submitting} className="pr-10"
                />
                <Button type="button" variant="ghost" size="sm" tabIndex={-1}
                  className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                  onClick={() => setShow3(s => !s)}>
                  {show3 ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                </Button>
              </div>
            </div>

            <Button type="submit" className="w-full gap-2" disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              Update Password
            </Button>
            {forced && (
              <Button type="button" variant="ghost" className="w-full" onClick={async () => { await signOut(); navigate('/finance/login', { replace: true }); }}>
                Sign out instead
              </Button>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

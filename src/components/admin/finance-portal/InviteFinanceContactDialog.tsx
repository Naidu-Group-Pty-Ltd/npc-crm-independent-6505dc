import { useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Mail, KeyRound, Copy, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { invokeSecureFunction } from '@/lib/secureInvoke';

export interface InviteFinanceContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact: { id: string; name: string; email: string } | null;
  isResend?: boolean;
  onSent?: () => void;
}

type Mode = 'set_password_link' | 'temp_password';

export function InviteFinanceContactDialog({
  open, onOpenChange, contact, isResend, onSent,
}: InviteFinanceContactDialogProps) {
  const [mode, setMode] = useState<Mode>('set_password_link');
  const [customPwd, setCustomPwd] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{
    invite_link?: string;
    temp_password?: string | null;
    email_sent?: boolean;
    mode?: Mode;
  } | null>(null);

  const reset = () => {
    setMode('set_password_link');
    setCustomPwd('');
    setResult(null);
  };

  const close = (open: boolean) => {
    if (!open) reset();
    onOpenChange(open);
  };

  const handleSend = async () => {
    if (!contact) return;
    if (mode === 'temp_password' && customPwd && customPwd.length < 12) {
      toast.error('Custom password must be at least 12 characters');
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await invokeSecureFunction('finance-portal-invite', {
        action: 'invite',
        finance_contact_id: contact.id,
        resend_invite: !!isResend,
        invite_mode: mode,
        custom_password: mode === 'temp_password' && customPwd ? customPwd : undefined,
      });
      if (error) throw new Error(error.message);
      setResult({
        invite_link: data?.invite_link,
        temp_password: data?.temp_password,
        email_sent: data?.email_sent,
        mode: data?.mode || mode,
      });
      toast.success(data?.message || 'Invite processed');
      onSent?.();
    } catch (e: any) {
      toast.error(e.message || 'Failed to send invite');
    } finally {
      setSubmitting(false);
    }
  };

  const copy = async (value: string, label: string) => {
    try { await navigator.clipboard.writeText(value); toast.success(`${label} copied`); }
    catch { toast.error('Failed to copy'); }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" />
            {isResend ? 'Resend / reset invite' : 'Invite to Finance Portal'}
          </DialogTitle>
          <DialogDescription>
            {contact ? <>Sending to <span className="font-medium">{contact.name}</span> ({contact.email})</> : null}
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <div className="space-y-5">
            <div className="space-y-2">
              <Label>How should they sign in?</Label>
              <RadioGroup value={mode} onValueChange={(v) => setMode(v as Mode)} className="space-y-2">
                <label className="flex items-start gap-3 rounded-md border p-3 cursor-pointer hover:bg-accent/40">
                  <RadioGroupItem value="set_password_link" id="m1" className="mt-1" />
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2 font-medium"><Mail className="h-4 w-4" /> Email a set-password link</div>
                    <div className="text-xs text-muted-foreground">User clicks the link, sets their own password and accepts the invite. Recommended.</div>
                  </div>
                </label>
                <label className="flex items-start gap-3 rounded-md border p-3 cursor-pointer hover:bg-accent/40">
                  <RadioGroupItem value="temp_password" id="m2" className="mt-1" />
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2 font-medium"><KeyRound className="h-4 w-4" /> Issue a temporary password</div>
                    <div className="text-xs text-muted-foreground">Account is activated immediately. User is forced to change the password on first login.</div>
                  </div>
                </label>
              </RadioGroup>
            </div>

            {mode === 'temp_password' && (
              <div className="space-y-1.5">
                <Label htmlFor="custom-pwd">Custom temporary password (optional)</Label>
                <Input
                  id="custom-pwd"
                  type="text"
                  value={customPwd}
                  onChange={(e) => setCustomPwd(e.target.value)}
                  placeholder="Leave blank to auto-generate"
                  autoComplete="off"
                />
                <p className="text-xs text-muted-foreground">Min 8 characters. Leave blank for a secure auto-generated password.</p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>
                {result.email_sent ? 'Email sent successfully.' : 'Invite created — email delivery failed, share the details below manually.'}
              </AlertDescription>
            </Alert>

            {result.mode === 'temp_password' && result.temp_password ? (
              <div className="rounded-md border bg-muted/40 p-3 space-y-2">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Temporary password</Label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 font-mono text-base px-3 py-2 rounded bg-background border">{result.temp_password}</code>
                  <Button size="icon" variant="outline" onClick={() => copy(result.temp_password!, 'Password')}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">User will be forced to change this on first login.</p>
              </div>
            ) : null}

            {result.invite_link ? (
              <div className="rounded-md border bg-muted/40 p-3 space-y-2">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  {result.mode === 'temp_password' ? 'Sign-in URL' : 'Set-password link'}
                </Label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 font-mono text-xs px-3 py-2 rounded bg-background border break-all">{result.invite_link}</code>
                  <Button size="icon" variant="outline" onClick={() => copy(result.invite_link!, 'Link')}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button onClick={() => close(false)}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => close(false)} disabled={submitting}>Cancel</Button>
              <Button onClick={handleSend} disabled={submitting} className="gap-2">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                {mode === 'temp_password' ? 'Create Account & Send' : 'Send Invite'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

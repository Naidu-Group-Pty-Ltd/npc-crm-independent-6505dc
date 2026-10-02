/**
 * WP-11C — Step-up (recent reauthentication) dialog.
 *
 * Opens a password prompt bound to a capability, issues a short-lived
 * step-up token via `security-step-up`, and stores it in sessionStorage.
 * Sensitive edge-function callers pass `{ stepUpCapability }` to
 * `invokeSecureFunction` which attaches the token automatically.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ShieldCheck, Loader2, Fingerprint } from 'lucide-react';
import { requestStepUpChallenge, requestStepUpWithWebAuthn, webauthnSupported, type StepUpCapability } from '@/lib/security/stepUp';

interface StepUpDialogProps {
  open: boolean;
  capability: StepUpCapability | string;
  title?: string;
  description?: string;
  onSuccess: () => void;
  onCancel: () => void;
}

const MFA_FACTOR_PATTERN = /^(?:\d{6}|[A-HJ-NP-Z2-9]{4}-?[A-HJ-NP-Z2-9]{4}-?[A-HJ-NP-Z2-9]{4})$/;

const CAP_LABEL: Record<string, string> = {
  'role.change': 'Assign a role',
  'role.remove': 'Remove a role',
  'aml.role.set': 'Change AML compliance roles',
  'secrets.update': 'Rotate integration secrets',
  'commission.payout.generate': 'Generate a commission payout',
  'commission.payout.mark_paid': 'Mark a payout as paid',
  'docusign.send': 'Send a DocuSign envelope',
  'docusign.void': 'Void a DocuSign envelope',
  'storage.destructive': 'Delete stored files',
};

export function StepUpDialog({
  open, capability, title, description, onSuccess, onCancel,
}: StepUpDialogProps) {
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [requiresMfa, setRequiresMfa] = useState(false);
  // The account has no authenticator, and the gate accepts nothing less.
  // Distinct from `error`: it is not something typing differently can fix.
  const [needsEnrolment, setNeedsEnrolment] = useState(false);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const humanCap = CAP_LABEL[capability] ?? capability;

  useEffect(() => {
    if (!open) {
      setPassword('');
      setMfaCode('');
      setRequiresMfa(false);
      setNeedsEnrolment(false);
      setError(null);
    }
  }, [open]);

  const handleConfirm = async () => {
    if (!password) { setError('Enter your current password'); return; }
    setBusy(true);
    setError(null);
    if (requiresMfa && !MFA_FACTOR_PATTERN.test(mfaCode)) {
      setBusy(false);
      setError('Enter an authenticator or recovery code.');
      return;
    }
    const result = await requestStepUpChallenge(capability, password, requiresMfa ? mfaCode : undefined);
    setBusy(false);
    if (!result.ok) {
      const err = (result as { ok: false; error: string }).error;
      if (err === 'mfa_enrollment_required') {
        setNeedsEnrolment(true);
        setError(null);
        return;
      }
      // An enrolled account is asked for its code only once the password is
      // known to be right — that first answer is the server asking, not an
      // operator mistake, so it is not drawn as one.
      if (err === 'invalid_mfa_code' && !requiresMfa && !mfaCode) {
        setRequiresMfa(true);
        setError(null);
        return;
      }
      setError(
        err === 'invalid_credentials' ? 'Incorrect password.' :
        err === 'mfa_enrollment_required' ? 'MFA enrolment is required for this account.' :
        err === 'invalid_mfa_code' ? 'Enter an authenticator or recovery code.' :
        err || 'Verification failed.',
      );
      if (err === 'invalid_mfa_code') setRequiresMfa(true);
      return;
    }
    setPassword('');
    setMfaCode('');
    setRequiresMfa(false);
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <DialogTitle>{title ?? 'Confirm your identity'}</DialogTitle>
          </div>
          <DialogDescription>
            {description ?? `Re-enter your password to authorise: ${humanCap}. This authorisation is valid for 15 minutes.`}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {needsEnrolment ? (
          <Alert>
            <AlertDescription>
              Your password is correct, but this change also needs an authenticator code and
              your account does not have an authenticator set up yet. Set one up under
              Settings → Security (authenticator app or security key), then try again.
            </AlertDescription>
          </Alert>
        ) : null}

        {requiresMfa && !error ? (
          <p className="text-sm text-muted-foreground">
            Enter the 6-digit code from your authenticator app, or a recovery code.
          </p>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor="stepup-password">Password</Label>
          <Input
            id="stepup-password"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !busy) handleConfirm(); }}
            disabled={busy}
          />
        </div>

        {requiresMfa ? (
          <div className="space-y-2">
            <Label htmlFor="stepup-totp">Authenticator or recovery code</Label>
            <Input
              id="stepup-totp"
              autoComplete="one-time-code"
              maxLength={14}
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
              onKeyDown={(e) => { if (e.key === 'Enter' && !busy) handleConfirm(); }}
              placeholder="000000 or XXXX-XXXX-XXXX"
              disabled={busy}
            />
          </div>
        ) : null}

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
          {needsEnrolment ? (
            <Button onClick={() => { onCancel(); navigate('/settings'); }}>
              Open security settings
            </Button>
          ) : null}
          {!needsEnrolment && webauthnSupported() ? (
            <Button
              variant="secondary"
              onClick={async () => {
                if (!password) { setError('Enter your current password'); return; }
                setBusy(true); setError(null);
                const r = await requestStepUpWithWebAuthn(capability, password);
                setBusy(false);
                if (!r.ok) {
                  const err = (r as { ok: false; error: string }).error;
                  if (err === 'mfa_enrollment_required') { setNeedsEnrolment(true); return; }
                  setError(err || 'Verification failed.');
                  return;
                }
                setPassword(''); onSuccess();
              }}
              disabled={busy || !password}
            >
              <Fingerprint className="mr-2 h-4 w-4" /> Use security key
            </Button>
          ) : null}
          {!needsEnrolment ? (
          <Button onClick={handleConfirm} disabled={busy || !password || (requiresMfa && !MFA_FACTOR_PATTERN.test(mfaCode))}>
            {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Verifying…</> : 'Confirm'}
          </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Simple hook that returns a `guard(capability)` fn resolving true when a
 * live token exists, otherwise showing the dialog and awaiting the outcome.
 */
import { useCallback, useRef } from 'react';
import { getStepUpToken } from '@/lib/security/stepUp';

export function useStepUp() {
  const [state, setState] = useState<{ open: boolean; capability: string }>({ open: false, capability: '' });
  const resolverRef = useRef<((ok: boolean) => void) | null>(null);

  const guard = useCallback((capability: StepUpCapability | string): Promise<boolean> => {
    if (getStepUpToken(capability)) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setState({ open: true, capability });
    });
  }, []);

  const element = (
    <StepUpDialog
      open={state.open}
      capability={state.capability}
      onSuccess={() => { setState({ open: false, capability: '' }); resolverRef.current?.(true); resolverRef.current = null; }}
      onCancel={() => { setState({ open: false, capability: '' }); resolverRef.current?.(false); resolverRef.current = null; }}
    />
  );

  return { guard, element };
}

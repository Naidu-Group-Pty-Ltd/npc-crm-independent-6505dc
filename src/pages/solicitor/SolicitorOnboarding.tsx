import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Briefcase, CheckCircle2, Loader2, Lock, ShieldCheck, Sparkles, UserCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { useBrand } from '@/branding/useBrand';
import { useToast } from '@/hooks/use-toast';
import { useSolicitorPortalAuth } from '@/hooks/useSolicitorPortalAuth';
import { invokeSolicitorFunction } from '@/lib/solicitorPortal';
import { cn } from '@/lib/utils';

interface OnboardingStep { step_key: string; mandatory: boolean; completed_at: string | null }
interface GovernanceResponse { steps?: OnboardingStep[] }

const STEP_COPY: Record<string, { label: string; hint: string; icon: React.ElementType }> = {
  profile_confirmed: {
    label: 'Confirm your professional profile is accurate',
    hint: 'Your name, position and practising states are shown to the referring team on every matter.',
    icon: UserCheck,
  },
  privacy_acknowledged: {
    label: 'Acknowledge privacy and privileged-data handling',
    hint: 'Matter data may be privileged. Only access files shared with your practice, and never redistribute them.',
    icon: Lock,
  },
  security_reviewed: {
    label: 'Review device and session security',
    hint: 'You can review and revoke signed-in devices anytime from Settings → Session security.',
    icon: ShieldCheck,
  },
};

const buildIntroSteps = (brand: string) => [
  {
    icon: Briefcase,
    title: 'Welcome to the Solicitor Portal',
    body: `A purpose-built workspace for the conveyancing matters ${brand} has shared with your practice — critical dates, documents, requisitions and settlement coordination in one place.`,
  },
  {
    icon: Lock,
    title: 'Matter-scoped access',
    body: `You only see matters shared with your firm. Documents, communications and disbursements are scoped to each matter, and ${brand} controls what is shared.`,
  },
  {
    icon: ShieldCheck,
    title: 'Everything is audited',
    body: 'Logins, views, edits, uploads and messages are logged against your account. Keep your credentials private and report anything unexpected immediately.',
  },
];

/**
 * Mandatory onboarding for solicitor portal users. Mirrors the Finance Portal
 * onboarding wizard (`FinancePortalOnboarding`) and the Client Portal
 * welcome flow: an introductory wizard with progress dots, followed by the
 * server-driven mandatory acknowledgements.
 */
export default function SolicitorOnboarding() {
  const [steps, setSteps] = useState<OnboardingStep[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const { completeOnboarding } = useSolicitorPortalAuth();
  const { settings: brandSettings } = useBrand();
  const navigate = useNavigate();
  const { toast } = useToast();

  const brandName = (brandSettings.companyName || '').trim() || 'the operator';
  const introSteps = useMemo(() => buildIntroSteps(brandName), [brandName]);
  const totalSteps = introSteps.length + 1; // intro steps + acknowledgements
  const isAcknowledgementStep = wizardStep === totalSteps - 1;

  useEffect(() => {
    void invokeSolicitorFunction<GovernanceResponse>('solicitor-portal-verify', { action: 'get_governance' })
      .then(({ data, error }) => {
        if (error) toast({ title: 'Unable to load onboarding', description: error.message, variant: 'destructive' });
        setSteps(data?.steps ?? []);
        setLoading(false);
      });
  }, [toast]);

  const outstanding = steps.filter((step) => step.mandatory && !step.completed_at);
  const ready = steps.length > 0 && outstanding.every((step) => checked[step.step_key]);

  const complete = async () => {
    setBusy(true);
    try {
      await completeOnboarding();
      navigate('/solicitor', { replace: true });
    } catch (error) {
      toast({
        title: 'Onboarding was not completed',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally { setBusy(false); }
  };

  const intro = isAcknowledgementStep ? null : introSteps[wizardStep];
  const IntroIcon = intro?.icon;

  return (
    <main className="solicitor-portal-theme flex min-h-screen items-center justify-center p-4">
      <div className="relative z-10 w-full max-w-2xl animate-in overflow-hidden rounded-2xl border border-border bg-card shadow-2xl duration-300 fade-in zoom-in-95">
        {/* Header */}
        <div className="border-b border-border bg-primary/5 px-6 py-6 text-center md:px-8 md:py-8">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
            {isAcknowledgementStep
              ? <Sparkles className="h-7 w-7 text-primary" aria-hidden />
              : IntroIcon ? <IntroIcon className="h-7 w-7 text-primary" aria-hidden /> : null}
          </div>
          <h1 className="text-xl font-bold text-foreground md:text-2xl">
            {isAcknowledgementStep ? 'Complete portal onboarding' : intro?.title}
          </h1>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
            {isAcknowledgementStep
              ? 'Complete each mandatory acknowledgement before accessing legal matters.'
              : intro?.body}
          </p>
        </div>

        {/* Body */}
        <div className="px-6 py-6 md:px-8">
          {isAcknowledgementStep ? (
            <div className="space-y-3">
              {loading ? (
                <div className="space-y-3" aria-hidden>
                  {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
                </div>
              ) : steps.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border/70 px-4 py-10 text-center text-sm text-muted-foreground">
                  No acknowledgements are outstanding. Continue to your matters.
                </p>
              ) : steps.map((step) => {
                const copy = STEP_COPY[step.step_key];
                const StepIcon = copy?.icon ?? CheckCircle2;
                const done = Boolean(step.completed_at);
                return (
                  <label
                    key={step.step_key}
                    htmlFor={`ack-${step.step_key}`}
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors',
                      done
                        ? 'border-primary/25 bg-primary/5'
                        : 'border-border/70 bg-muted/20 hover:border-primary/25 hover:bg-primary/5',
                    )}
                  >
                    <Checkbox
                      id={`ack-${step.step_key}`}
                      className="mt-0.5"
                      checked={done || Boolean(checked[step.step_key])}
                      disabled={done}
                      onCheckedChange={(value) => setChecked((current) => ({ ...current, [step.step_key]: value === true }))}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <StepIcon className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                        {copy?.label || step.step_key}
                        {step.mandatory ? (
                          <span className="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                            Required
                          </span>
                        ) : null}
                      </span>
                      {copy?.hint ? (
                        <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{copy.hint}</span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>
          ) : null}

          {/* Progress dots */}
          <div className="flex items-center justify-center gap-2 pt-6" aria-hidden>
            {Array.from({ length: totalSteps }).map((_, i) => (
              <span
                key={i}
                className={cn(
                  'h-1.5 rounded-full transition-all duration-300',
                  i === wizardStep ? 'w-8 bg-primary' : i < wizardStep ? 'w-2 bg-primary/40' : 'w-2 bg-muted-foreground/20',
                )}
              />
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/30 px-6 py-4 md:px-8 md:py-5">
          <Button
            variant="ghost"
            onClick={() => setWizardStep((s) => Math.max(0, s - 1))}
            disabled={wizardStep === 0 || busy}
          >
            Back
          </Button>
          <p className="hidden text-xs text-muted-foreground sm:block">
            Step {wizardStep + 1} of {totalSteps}
          </p>
          {isAcknowledgementStep ? (
            <Button onClick={() => void complete()} disabled={!ready || busy} className="gap-2">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
              {busy ? 'Completing…' : 'Complete onboarding'}
            </Button>
          ) : (
            <Button onClick={() => setWizardStep((s) => Math.min(totalSteps - 1, s + 1))} disabled={busy}>
              Next
            </Button>
          )}
        </div>
      </div>
    </main>
  );
}

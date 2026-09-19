import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Loader2, Lock, ShieldCheck, Sparkles, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useBrand } from '@/branding/useBrand';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { bootFinanceAppearance, clearFinanceAppearance } from '@/lib/finance-portal/theme';
import { cn } from '@/lib/utils';

const buildWizardSteps = (brand: string) => [
  {
    icon: ShieldCheck,
    title: 'Welcome to the Finance Partner Portal',
    body: `A purpose-built workspace where you can manage the financial profiles of clients ${brand} has assigned to you. Everything you see here is gated by per-client permissions set by ${brand}.`,
  },
  {
    icon: Users,
    title: 'Per-client access',
    body: `Your client list shows only the clients you have been assigned. Inside each client you may see Properties, Income, Expenses, Assets, Liabilities, Employment, Address History, Notes and Contacts depending on the access ${brand} has granted.`,
  },
  {
    icon: Lock,
    title: 'View, Edit, Delete — clearly labelled',
    body: 'Each section displays your access level. If a button is missing, your assignment does not include that permission. Need different access? Contact your account manager.',
  },
];

/**
 * Mandatory onboarding for finance partners — the introduction that runs once
 * the agreement has been accepted and before the portal opens.
 *
 * It is a page, not a dialog, and it is a page for the same reason the terms
 * are (`FinancePortalTerms`): the dialog it used to live in was mounted inside
 * the portal layout, alongside a welcome tour that auto-starts on a timer and
 * paints above it. Sequencing the three by routing rather than by z-index is
 * what stops them colliding. Mirrors `SolicitorOnboarding`, which has always
 * been laid out this way.
 *
 * The steps are informational and client-side; the finance portal has no
 * server-driven onboarding checklist. What is server-side is the completion
 * itself — `completeOnboarding()` — and until it succeeds the guard keeps
 * sending the partner back here.
 */
export default function FinancePortalOnboarding() {
  const { completeOnboarding } = useFinancePortalAuth();
  const { settings: brandSettings } = useBrand();
  const navigate = useNavigate();
  const location = useLocation();

  const [wizardStep, setWizardStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const brandName = (brandSettings.companyName || '').trim() || 'the operator';
  const steps = useMemo(() => buildWizardSteps(brandName), [brandName]);
  const step = steps[wizardStep];
  const Icon = step.icon;
  const isLast = wizardStep === steps.length - 1;

  useEffect(() => {
    bootFinanceAppearance();
    return () => { clearFinanceAppearance(); };
  }, []);

  const handleNext = async () => {
    if (!isLast) {
      setWizardStep((s) => s + 1);
      return;
    }
    setSubmitting(true);
    try {
      await completeOnboarding();
      toast.success('Welcome aboard. You are all set.');
      // This is the last gate, so it is the one that hands the partner back to
      // wherever they were heading — an emailed deep link keeps working across
      // a first login or an amended agreement.
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from ?? '/finance', { replace: true });
    } catch (e: any) {
      toast.error(e?.message || 'Failed to complete onboarding.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="finance-portal-theme flex min-h-screen items-center justify-center p-4">
      <div className="relative z-10 w-full max-w-2xl animate-in overflow-hidden rounded-2xl border border-border bg-card shadow-2xl duration-300 fade-in zoom-in-95 motion-reduce:animate-none">
        {/* Header */}
        <div className="border-b border-border bg-primary/5 px-6 py-6 text-center md:px-8 md:py-8">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
            <Icon className="h-7 w-7 text-primary" aria-hidden />
          </div>
          <h1 className="text-xl font-bold text-foreground md:text-2xl">{step.title}</h1>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
            {step.body}
          </p>
        </div>

        {/* Progress dots */}
        <div className="flex items-center justify-center gap-2 px-6 py-6 md:px-8" aria-hidden>
          {steps.map((_, i) => (
            <span
              key={i}
              className={cn(
                'h-1.5 rounded-full transition-all duration-300',
                i === wizardStep ? 'w-8 bg-primary' : i < wizardStep ? 'w-2 bg-primary/40' : 'w-2 bg-muted-foreground/20',
              )}
            />
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/30 px-6 py-4 md:px-8 md:py-5">
          <Button
            variant="ghost"
            onClick={() => setWizardStep((s) => Math.max(0, s - 1))}
            disabled={wizardStep === 0 || submitting}
          >
            Back
          </Button>
          <p className="hidden text-xs text-muted-foreground sm:block">
            Step {wizardStep + 1} of {steps.length}
          </p>
          <Button onClick={() => void handleNext()} disabled={submitting} className="gap-2">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {isLast ? <><Sparkles className="h-4 w-4" aria-hidden /> Get Started</> : 'Next'}
          </Button>
        </div>
      </div>
    </main>
  );
}

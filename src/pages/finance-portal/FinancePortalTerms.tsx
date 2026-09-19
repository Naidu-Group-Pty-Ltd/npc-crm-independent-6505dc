import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useBrand } from '@/branding/useBrand';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { PortalAgreementConsent } from '@/components/portal/PortalAgreementConsent';
import type { PortalAcknowledgementKey, PortalTermsVersion } from '@/lib/portalAgreement';
import { bootFinanceAppearance, clearFinanceAppearance } from '@/lib/finance-portal/theme';

/**
 * Terms & privileged-data consent for the Finance Partner Portal.
 *
 * This used to be a modal (`FinancePortalOnboardingGate`) rendered inside the
 * portal layout, and both halves of that were wrong.
 *
 * LAYOUT. The agreement is longer than a dialog. The shared `DialogContent`
 * pins `sm:max-h-[85dvh] sm:overflow-visible` on every dialog at ≥640px, and a
 * `sm:` class beats the unprefixed `max-h`/`overflow-y-auto` a caller passes in
 * — so the caller's own scroll cap was silently discarded and the agreement,
 * centred with a -50% translate, ran off the top *and* the bottom of the
 * screen with no way to scroll it. A page has no such cap: the consent card is
 * `max-w-3xl`, the agreement scrolls inside its own `ScrollArea`, and anything
 * past the fold is reached by scrolling the page. This is the Solicitor and
 * Builder/Developer treatment (`SolicitorTerms`, `BuilderTerms`), which is why
 * those two contain themselves and this one did not.
 *
 * FLOW. Being inside the layout also put the consent wall in the same tree as
 * the portal's welcome tour, which auto-starts on a timer and paints at
 * `z-[60]` — above the dialog. A partner met both at once, the tour on top of
 * the agreement they had not read yet. Terms are now a route the guard sends
 * them to before the layout mounts at all, so the tour cannot exist until the
 * agreement is accepted and onboarding is done.
 *
 * Acceptance is recorded server-side against the exact version served, for the
 * authenticated partner; this page nominates neither. Where it goes next is the
 * guard's decision, not this page's — `FinancePortalProtectedRoute` routes on
 * to onboarding or the dashboard as soon as the acceptance lands in state.
 */
export default function FinancePortalTerms() {
  const { acceptTerms, invokeFinanceFunction } = useFinancePortalAuth();
  const { settings: brandSettings } = useBrand();
  const navigate = useNavigate();
  const location = useLocation();

  const [terms, setTerms] = useState<PortalTermsVersion | null>(null);
  const [termsLoading, setTermsLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const brandName = (brandSettings.companyName || '').trim() || 'the operator';

  // The palette lives on <html> (see `lib/finance-portal/theme`), so the gate
  // pages boot it themselves — they render outside the portal layout, and
  // without this a partner with a chosen palette meets the agreement in a
  // different skin from the portal it admits them to.
  useEffect(() => {
    bootFinanceAppearance();
    return () => { clearFinanceAppearance(); };
  }, []);

  const loadTerms = useCallback(async () => {
    setTermsLoading(true);
    const { data, error } = await invokeFinanceFunction('finance-portal-verify', {
      action: 'get_governance',
    });
    if (error) toast.error(error?.message || 'Unable to load the current terms.');
    setTerms((data?.terms as PortalTermsVersion | undefined) ?? null);
    setTermsLoading(false);
  }, [invokeFinanceFunction]);

  useEffect(() => { void loadTerms(); }, [loadTerms]);

  // A partner who has not accepted is still gated when the document cannot be
  // fetched. They are told why and given a way to retry, rather than shown an
  // empty panel and a dead button — and an unloadable agreement never becomes
  // a way in, because the guard, not this page, decides who passes.
  const termsUnavailable = !termsLoading && !terms;

  const handleAccept = async (acknowledgements: PortalAcknowledgementKey[]) => {
    setSubmitting(true);
    try {
      await acceptTerms(acknowledgements);
      // `state` carries wherever the partner was heading when the gate caught
      // them, for the last gate to hand back. The guard would make this same
      // move on its own once the acceptance lands in context; doing it here
      // too keeps the transition immediate.
      navigate('/finance/onboarding', { replace: true, state: location.state });
    } catch (e: any) {
      toast.error(e?.message || 'Failed to accept terms. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="finance-portal-theme flex min-h-screen items-center justify-center p-4">
      <div className="relative z-10 w-full max-w-3xl animate-in overflow-hidden rounded-2xl border border-border bg-card shadow-2xl duration-300 fade-in zoom-in-95 motion-reduce:animate-none">
        {/* Header */}
        <div className="border-b border-border bg-primary/5 px-6 py-6 md:px-8 md:py-8">
          <div className="mb-3 flex items-center gap-3">
            <div className="rounded-xl bg-primary/10 p-2.5">
              <ShieldCheck className="h-6 w-6 text-primary" aria-hidden />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-foreground md:text-2xl">
                Terms &amp; Privileged Data Consent
              </h1>
              <p className="truncate text-sm text-muted-foreground">
                {brandName} · Finance Partner Portal
              </p>
            </div>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Before accessing client financial records, review and accept the terms of use below.
            Your acceptance is recorded against this exact version.
          </p>
        </div>

        <div className="space-y-6 px-6 py-5 md:px-8 md:py-6">
          {termsUnavailable ? (
            <div className="space-y-4 rounded-xl border border-border bg-muted/20 p-6 text-sm leading-relaxed">
              <p className="text-foreground">
                The current terms could not be loaded, so they cannot be accepted yet. Nothing has
                been recorded against your account.
              </p>
              <p className="text-muted-foreground">
                Please try again in a moment. If this continues, contact {brandName}.
              </p>
              <Button variant="outline" onClick={loadTerms} disabled={termsLoading}>
                {termsLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
                Try again
              </Button>
            </div>
          ) : (
            <PortalAgreementConsent
              terms={terms}
              loading={termsLoading}
              busy={submitting}
              onAccept={(acknowledgements) => void handleAccept(acknowledgements)}
            />
          )}
        </div>
      </div>
    </main>
  );
}

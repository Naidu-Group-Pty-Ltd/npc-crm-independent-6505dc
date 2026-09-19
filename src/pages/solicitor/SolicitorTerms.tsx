import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield } from 'lucide-react';
import { useBrand } from '@/branding/useBrand';
import { useToast } from '@/hooks/use-toast';
import { useSolicitorPortalAuth } from '@/hooks/useSolicitorPortalAuth';
import { PortalAgreementConsent } from '@/components/portal/PortalAgreementConsent';
import type { PortalAcknowledgementKey, PortalTermsVersion } from '@/lib/portalAgreement';
import { invokeSolicitorFunction } from '@/lib/solicitorPortal';

interface GovernanceResponse { terms?: PortalTermsVersion }

/**
 * Terms & privileged-data consent for the Solicitor Portal.
 *
 * The agreement, the acknowledgments, the notice and the button are
 * `PortalAgreementConsent`, shared with the Builder/Developer and Finance
 * portals — one agreement presented one way. This page owns only what is
 * particular to the Solicitor Portal: its chrome, where the acceptance is sent,
 * and where the solicitor goes next.
 */
export default function SolicitorTerms() {
  const [terms, setTerms] = useState<PortalTermsVersion | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const { acceptTerms } = useSolicitorPortalAuth();
  const { settings: brandSettings } = useBrand();
  const navigate = useNavigate();
  const { toast } = useToast();

  const companyName = (brandSettings.companyName || '').trim() || 'the Operator';

  useEffect(() => {
    void invokeSolicitorFunction<GovernanceResponse>('solicitor-portal-verify', { action: 'get_governance' })
      .then(({ data, error }) => {
        if (error) toast({ title: 'Unable to load terms', description: error.message, variant: 'destructive' });
        setTerms(data?.terms ?? null);
        setLoading(false);
      });
  }, [toast]);

  const accept = async (acknowledgements: PortalAcknowledgementKey[]) => {
    setBusy(true);
    try {
      await acceptTerms(acknowledgements);
      navigate('/solicitor/onboarding', { replace: true });
    } catch (error) {
      toast({
        title: 'Acceptance was not recorded',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally { setBusy(false); }
  };

  return (
    <main className="solicitor-portal-theme flex min-h-screen items-center justify-center p-4">
      <div className="relative z-10 w-full max-w-3xl animate-in overflow-hidden rounded-2xl border border-border bg-card shadow-2xl duration-300 fade-in zoom-in-95">
        {/* Header */}
        <div className="border-b border-border bg-primary/5 px-6 py-6 md:px-8 md:py-8">
          <div className="mb-3 flex items-center gap-3">
            <div className="rounded-xl bg-primary/10 p-2.5">
              <Shield className="h-6 w-6 text-primary" aria-hidden />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground md:text-2xl">Terms &amp; Privileged Data Consent</h1>
              <p className="text-sm text-muted-foreground">{companyName} · Solicitor Portal</p>
            </div>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Before accessing legal matters, please review and accept the terms of use below. Your acceptance is
            recorded against this exact version.
          </p>
        </div>

        <div className="space-y-6 px-6 py-5 md:px-8 md:py-6">
          <PortalAgreementConsent
            terms={terms}
            loading={loading}
            busy={busy}
            onAccept={(acknowledgements) => void accept(acknowledgements)}
          />
        </div>
      </div>
    </main>
  );
}

import { useState, useMemo } from 'react';
import { usePortalAuth } from '@/hooks/usePortalAuth';
import { useNavigate } from 'react-router-dom';
import { useBrand } from '@/branding/useBrand';
import { useGlobalReportSettings } from '@/hooks/useGlobalReportSettings';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Shield, ExternalLink, FileText, Lock, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface BrandText {
  companyName: string;
  shortName: string;
  contactEmail: string;
  termsUrl: string;
  privacyUrl: string;
  year: number;
}

function buildTermsBody(b: BrandText) {
  const C = b.companyName;
  const S = b.shortName;
  return (
    <>
      <p className="font-medium text-foreground">Terms &amp; Conditions — {C}</p>
      <p>These Terms and Conditions govern your access to and use of the {C} website, consultation systems, marketing funnels, and property consulting services.</p>

      <p className="font-semibold text-foreground">1. Introduction</p>
      <p>Welcome to {C} ("{S}", "we", "our", or "us"). These Terms and Conditions govern your access to and use of our website, consultation systems, marketing funnels, and property consulting services.</p>
      <p>By accessing our website, submitting information through our enquiry forms, completing our questionnaire application, booking a consultation, or engaging with our services, you agree to be bound by these Terms and Conditions. If you do not agree with these Terms, you should discontinue use of our website and services.</p>

      <p className="font-semibold text-foreground">2. Services Provided</p>
      <p>{C} provides property consulting and strategic advisory services designed to assist individuals in planning and structuring property investment and development strategies. Our services may include consultations, strategic planning sessions, and advisory guidance relating to property investment, portfolio structuring, and project feasibility.</p>
      <p>Clients who engage with {C} may participate in a structured consulting process which may include consultations such as Discovery Calls, Strategy Sessions, financial assessments, feasibility discussions, and additional advisory stages designed to guide clients through strategic planning.</p>
      <p>All services provided by {C} are advisory in nature. {C} does not provide financial product advice, legal advice, taxation advice, mortgage broking services, or real estate agency services unless expressly stated otherwise. Clients are responsible for seeking independent advice from appropriately licensed professionals before making financial, legal, or investment decisions.</p>

      <p className="font-semibold text-foreground">3. Client Applications and Engagement</p>
      <p>Prospective clients may be required to submit a questionnaire application or provide preliminary information before consultations are scheduled. This process allows {C} to determine whether our consulting approach is suitable for the individual's circumstances and objectives.</p>
      <p>Submission of an application does not guarantee acceptance as a client, and {C} reserves the right to decline engagements at its discretion.</p>
      <p>Where consultations are scheduled, clients agree that the information provided during applications, consultations, and communications will be accurate and complete. {C} relies on information supplied by clients when offering strategic insights and guidance.</p>

      <p className="font-semibold text-foreground">4. Investment Risk and Decision Making</p>
      <p>Property investment involves financial risk and is influenced by factors including market conditions, lending requirements, regulatory changes, and economic conditions. {C} does not guarantee financial returns, investment performance, property appreciation, financing approvals, or the success of any strategy discussed during consultations.</p>
      <p>All strategies, insights, and guidance provided through {C} are intended to support strategic planning and decision-making. Clients remain solely responsible for evaluating information provided and making their own financial and investment decisions. {C} does not act as an investment manager, lender, or transaction intermediary.</p>

      <p className="font-semibold text-foreground">5. Third-Party Professionals</p>
      <p>During the course of consulting engagements, {C} may introduce or refer clients to third-party professionals whose services may assist with implementing property strategies. These professionals may include mortgage brokers, accountants, legal practitioners, property specialists, or other service providers.</p>
      <p>{C} does not control and is not responsible for the services, advice, or outcomes provided by these third parties. Any engagement with third-party providers occurs directly between the client and the provider.</p>

      <p className="font-semibold text-foreground">6. Intellectual Property</p>
      <p>All content provided through the {C} website, consultation materials, documents, frameworks, systems, and methodologies remains the intellectual property of {C}.</p>
      <p>These materials are provided solely for personal use in connection with consulting services and may not be reproduced, distributed, or used for commercial purposes without prior written consent from {C}.</p>

      <p className="font-semibold text-foreground">7. Website Use</p>
      <p>You agree to use the {C} website and communication systems only for lawful purposes. You must not attempt to gain unauthorized access to systems, interfere with the operation of the website, transmit malicious software, or otherwise disrupt the functionality of our services.</p>
      <p>{C} reserves the right to restrict access to the website or services where misuse is detected.</p>

      <p className="font-semibold text-foreground">8. Limitation of Liability</p>
      <p>To the fullest extent permitted by law, {C} shall not be liable for any direct, indirect, incidental, or consequential loss arising from reliance on information provided through consultations, communications, website content, or materials. All consulting services are provided on the basis that clients remain responsible for their own decisions and actions.</p>

      <p className="font-semibold text-foreground">9. Changes to Terms or Services</p>
      <p>{C} reserves the right to modify these Terms and Conditions or update the services provided through our website and consultation systems at any time. Updated Terms will be published on our website and will apply from the date of publication.</p>

      <p className="font-semibold text-foreground">10. Governing Law</p>
      <p>These Terms and Conditions shall be governed by and interpreted in accordance with the laws of Australia.</p>

      {b.contactEmail && (
        <p className="text-xs text-muted-foreground/70 mt-4">For questions regarding these Terms and Conditions, please contact {C} at {b.contactEmail}</p>
      )}
      <p className="text-xs text-muted-foreground/70">© {b.year} {C}. All rights reserved.</p>
    </>
  );
}

function buildPrivacyBody(b: BrandText) {
  const C = b.companyName;
  const S = b.shortName;
  return (
    <>
      <p className="font-medium text-foreground">Privacy Policy — {C}</p>
      <p>This Privacy Policy explains how {C} collects, uses, stores, and protects personal information obtained through enquiries, applications, consultations, and ongoing client engagements.</p>

      <p className="font-semibold text-foreground">1. Introduction</p>
      <p>{C} ("{S}", "we", "our", or "us") is committed to protecting the privacy and confidentiality of personal information provided by individuals who interact with our website, marketing funnels, consultation systems, and consulting services.</p>
      <p>This Privacy Policy explains how we collect, use, store, and protect personal information obtained through enquiries, applications, consultations, and ongoing client engagements.</p>
      <p>By using our website or providing personal information to {C}, you acknowledge that your information will be handled in accordance with this Privacy Policy.</p>

      <p className="font-semibold text-foreground">2. Information We Collect</p>
      <p>{C} collects personal information that is reasonably necessary to provide property consulting services and manage client relationships. Personal information may be collected when individuals submit enquiries through our website, complete our questionnaire application, book consultations such as Discovery Calls or Strategy Sessions, or communicate with {C} through email, telephone, or other communication channels.</p>
      <p>The information collected may include personal identification details, contact information, and background information relevant to property strategy and investment planning.</p>
      <p>Because our services involve strategic property planning, individuals may voluntarily provide information relating to financial circumstances, borrowing capacity indicators, property ownership, investment objectives, or development plans in order to receive more relevant consulting guidance.</p>

      <p className="font-semibold text-foreground">3. How Personal Information Is Collected</p>
      <p>Personal information is primarily collected directly from individuals when they submit forms through the {C} website, complete questionnaires, schedule consultations, or communicate with our team.</p>
      <p>Information may also be collected automatically when users interact with our website through standard website technologies that record usage data and assist with performance monitoring.</p>

      <p className="font-semibold text-foreground">4. Use of Personal Information</p>
      <p>{C} uses personal information to respond to enquiries, assess the suitability of consulting services, schedule and conduct consultations, and provide strategic property guidance.</p>
      <p>Information may also be used for internal administrative purposes, including maintaining records, managing client relationships, improving services, and operating our business systems.</p>
      <p>Where appropriate, {C} may also communicate information relating to consulting services, updates, or educational resources. Individuals may request to stop receiving marketing communications at any time.</p>

      <p className="font-semibold text-foreground">5. Third-Party Platforms and Service Providers</p>
      <p>{C} uses modern digital systems to manage communications, consultations, and operational processes. These systems may include customer relationship management platforms, scheduling tools, marketing automation systems, and secure cloud storage providers.</p>
      <p>These service providers may process or store personal information on behalf of {C} in order to support communication, consultation booking, and service delivery.</p>
      <p>{C} takes reasonable steps to ensure that service providers maintain appropriate safeguards for personal information.</p>

      <p className="font-semibold text-foreground">6. Disclosure of Personal Information</p>
      <p>{C} does not sell personal information. Personal information may be disclosed where necessary to support business operations, comply with legal obligations, or facilitate services through trusted technology providers.</p>
      <p>In some cases, clients may request referrals to third-party professionals relevant to property strategies, and information may be shared with those professionals where appropriate and with the client's knowledge.</p>

      <p className="font-semibold text-foreground">7. Data Security</p>
      <p>{C} implements reasonable administrative and technical safeguards to protect personal information from unauthorized access, misuse, loss, or disclosure.</p>
      <p>While reasonable security measures are implemented, no method of electronic transmission or storage can be guaranteed to be completely secure.</p>

      <p className="font-semibold text-foreground">8. Data Retention</p>
      <p>Personal information is retained only for as long as necessary to provide consulting services, maintain business records, and comply with applicable legal requirements.</p>
      <p>When personal information is no longer required, {C} will take reasonable steps to securely delete or anonymize the information.</p>

      <p className="font-semibold text-foreground">9. Access and Correction</p>
      <p>Individuals may request access to personal information held by {C} and request corrections where information is inaccurate or incomplete.</p>
      <p>Requests may be submitted using the contact details below.</p>

      <p className="font-semibold text-foreground">10. Changes to This Privacy Policy</p>
      <p>{C} reserves the right to update this Privacy Policy from time to time to reflect changes in operational practices, legal requirements, or services.</p>
      <p>The current version will always be available on the {C} website.</p>

      {b.contactEmail && (
        <p className="text-xs text-muted-foreground/70 mt-4">For questions regarding this Privacy Policy, please contact {C} at {b.contactEmail}</p>
      )}
      <p className="text-xs text-muted-foreground/70">© {b.year} {C}. All rights reserved.</p>
    </>
  );
}

export function PortalConsentWall() {
  const { acceptTerms } = usePortalAuth();
  const navigate = useNavigate();
  const { settings: brandSettings } = useBrand();
  const { settings: globalSettings } = useGlobalReportSettings();
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [agreedPrivacy, setAgreedPrivacy] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const brand: BrandText = useMemo(() => {
    const companyName = (brandSettings.companyName || '').trim() || 'the Operator';
    const shortName = companyName.split(/\s+/)[0] || companyName;
    const website = (globalSettings.contactDetails.website || '').trim();
    const baseUrl = website
      ? website.startsWith('http')
        ? website.replace(/\/$/, '')
        : `https://${website.replace(/\/$/, '')}`
      : '';
    return {
      companyName,
      shortName,
      contactEmail: (globalSettings.contactDetails.email || '').trim(),
      termsUrl: baseUrl ? `${baseUrl}/terms` : '',
      privacyUrl: baseUrl ? `${baseUrl}/privacy` : '',
      year: new Date().getFullYear(),
    };
  }, [brandSettings.companyName, globalSettings.contactDetails]);

  const canProceed = agreedTerms && agreedPrivacy;

  const handleAccept = async () => {
    if (!canProceed) return;
    setSubmitting(true);
    try {
      await acceptTerms();
      toast.success('Thank you for accepting. Welcome to your portal!');
      navigate('/client', { replace: true });
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl shadow-2xl max-w-3xl w-full overflow-hidden animate-in fade-in zoom-in-95 duration-300">
        {/* Header */}
        <div className="bg-primary/5 px-6 py-6 md:px-8 md:py-8 border-b border-border">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 rounded-xl bg-primary/10">
              <Shield className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-foreground">Terms & Privacy Consent</h1>
              <p className="text-sm text-muted-foreground">{brand.companyName}</p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Before accessing your Client Portal, please review and accept our Terms &amp; Conditions and Privacy Policy below.
          </p>
        </div>

        {/* Content */}
        <div className="px-6 py-5 md:px-8 md:py-6 space-y-6">
          {/* Terms & Conditions Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                <h2 className="font-semibold text-foreground text-sm">Terms &amp; Conditions</h2>
              </div>
              {brand.termsUrl && (
                <a
                  href={brand.termsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  View on website <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
            <ScrollArea className="h-48 md:h-56 rounded-xl border border-border bg-muted/20 p-4">
              <div className="prose prose-sm max-w-none text-muted-foreground space-y-4 pr-4">
                {buildTermsBody(brand)}
              </div>
            </ScrollArea>
          </div>

          <Separator />

          {/* Privacy Policy Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Lock className="h-4 w-4 text-primary" />
                <h2 className="font-semibold text-foreground text-sm">Privacy Policy</h2>
              </div>
              {brand.privacyUrl && (
                <a
                  href={brand.privacyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  View on website <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
            <ScrollArea className="h-48 md:h-56 rounded-xl border border-border bg-muted/20 p-4">
              <div className="prose prose-sm max-w-none text-muted-foreground space-y-4 pr-4">
                {buildPrivacyBody(brand)}
              </div>
            </ScrollArea>
          </div>

          <Separator />

          {/* Consent Checkboxes */}
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <Checkbox
                id="agree-terms"
                checked={agreedTerms}
                onCheckedChange={(checked) => setAgreedTerms(checked === true)}
                className="mt-0.5"
              />
              <Label htmlFor="agree-terms" className="text-sm leading-relaxed cursor-pointer text-foreground">
                I have read and agree to the{' '}
                {brand.termsUrl ? (
                  <a
                    href={brand.termsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline font-medium"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Terms &amp; Conditions
                  </a>
                ) : (
                  <span className="font-medium text-foreground">Terms &amp; Conditions</span>
                )}
                {' '}of {brand.companyName}.
              </Label>
            </div>

            <div className="flex items-start gap-3">
              <Checkbox
                id="agree-privacy"
                checked={agreedPrivacy}
                onCheckedChange={(checked) => setAgreedPrivacy(checked === true)}
                className="mt-0.5"
              />
              <Label htmlFor="agree-privacy" className="text-sm leading-relaxed cursor-pointer text-foreground">
                I have read and agree to the{' '}
                {brand.privacyUrl ? (
                  <a
                    href={brand.privacyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline font-medium"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Privacy Policy
                  </a>
                ) : (
                  <span className="font-medium text-foreground">Privacy Policy</span>
                )}
                {' '}of {brand.companyName}.
              </Label>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 md:px-8 md:py-5 bg-muted/30 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground/60">
            <Shield className="h-3 w-3" />
            <span>Your consent is recorded securely</span>
          </div>
          <Button
            onClick={handleAccept}
            disabled={!canProceed || submitting}
            size="lg"
            className="w-full sm:w-auto min-w-[200px]"
          >
            {submitting ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Processing...</>
            ) : (
              'Accept & Continue'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Loader2, ShieldCheck, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { BrandLockup } from '@/components/branding/BrandAssets';
import { usePublicConsent, usePublicConsentActions } from '@/hooks/usePartnerConsent';

/**
 * Public, token-addressed consent surface. No portal session — the token is the
 * credential, so the page shows only the statement the client must read plus the
 * minimum context needed to know who is asking.
 */
export default function PublicPartnerConsent() {
  const { token } = useParams<{ token: string }>();
  const { data: request, isLoading, error } = usePublicConsent(token);
  const { sign, decline } = usePublicConsentActions(token);

  const [name, setName] = useState('');
  const [agreed, setAgreed] = useState(false);

  useEffect(() => {
    document.title = 'Referral Consent';
  }, []);

  useEffect(() => {
    if (request?.recipient_name && !name) setName(request.recipient_name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.recipient_name]);

  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <div className="flex justify-center">
          <BrandLockup
            slot="auth"
            meta="Referral Consent"
            logoClassName="h-10 w-auto object-contain sm:h-12"
            fallbackClassName="h-10 w-10 sm:h-12 sm:w-12"
            companyClassName="text-sm sm:text-base"
          />
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error || !request ? (
          <StatusCard
            icon={XCircle}
            tone="text-destructive"
            title="This consent link is not available"
            body={
              (error as Error | undefined)?.message ||
              'The link may have expired, been revoked, or already been used. Please contact the person who sent it to you.'
            }
          />
        ) : request.status === 'signed' ? (
          <StatusCard
            icon={CheckCircle2}
            tone="text-success"
            title="Consent recorded — thank you"
            body={`Signed by ${request.signature_name ?? '—'}${
              request.signed_at ? ` on ${format(new Date(request.signed_at), 'dd MMMM yyyy')}` : ''
            }. No further action is needed.`}
          />
        ) : request.status === 'declined' ? (
          <StatusCard
            icon={XCircle}
            tone="text-destructive"
            title="You declined this referral"
            body="Your details will not be passed on. If this was a mistake, please contact us directly."
          />
        ) : ['revoked', 'expired'].includes(request.status) ? (
          <StatusCard
            icon={Clock}
            tone="text-muted-foreground"
            title="This link is no longer active"
            body="Please ask for a new consent link if you still wish to proceed."
          />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" />
                Your consent to be referred
              </CardTitle>
              <CardDescription>
                Please read the statement below carefully. Nothing is shared until you agree.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="whitespace-pre-wrap rounded-lg border border-border bg-muted/30 p-4 text-sm leading-relaxed text-foreground">
                {request.statement_text}
              </div>

              {request.disclosure_text && (
                <>
                  <Separator />
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Benefit disclosure
                    </p>
                    <p className="whitespace-pre-wrap text-sm text-muted-foreground">{request.disclosure_text}</p>
                  </div>
                </>
              )}

              <Separator />

              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="consent-agree"
                    checked={agreed}
                    onCheckedChange={(v) => setAgreed(!!v)}
                    className="mt-0.5"
                  />
                  <Label htmlFor="consent-agree" className="text-sm font-normal leading-relaxed">
                    I have read and understood the statement above, and I consent to my details being shared
                    for this purpose.
                  </Label>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="consent-name">Type your full name to sign</Label>
                  <Input
                    id="consent-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Full name"
                    autoComplete="name"
                  />
                </div>

                <p className="text-xs text-muted-foreground">
                  Link valid until {format(new Date(request.expires_at), 'dd MMMM yyyy')}. Your name, the time
                  and your IP address are recorded as evidence of consent (statement {request.statement_version}).
                </p>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  className="flex-1 gap-2"
                  disabled={!agreed || name.trim().length < 2 || sign.isPending}
                  onClick={() => sign.mutate(name.trim())}
                >
                  {sign.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  I consent
                </Button>
                <Button
                  variant="outline"
                  className="flex-1 gap-2"
                  disabled={decline.isPending}
                  onClick={() => decline.mutate()}
                >
                  {decline.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                  No thanks
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function StatusCard({
  icon: Icon, tone, title, body,
}: { icon: React.ElementType; tone: string; title: string; body: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <Icon className={`h-10 w-10 ${tone}`} />
        <p className="text-lg font-semibold text-foreground">{title}</p>
        <p className="max-w-md text-sm text-muted-foreground">{body}</p>
      </CardContent>
    </Card>
  );
}

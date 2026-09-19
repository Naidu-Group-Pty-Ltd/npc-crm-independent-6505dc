import { useState } from 'react';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Loader2, Copy, Link2, ShieldCheck, Ban, FileSignature } from 'lucide-react';
import { toast } from 'sonner';
import {
  CONSENT_STATUS_LABELS,
  consentStatusVariant,
  useConsentMutations,
  useConsentRequests,
} from '@/hooks/usePartnerConsent';
import type { PartnerReferral } from '@/hooks/usePartnerReferrals';

interface Props {
  referral: PartnerReferral;
}

/**
 * Annexure A consent capture. Two lawful routes: send the client a signing link,
 * or record consent taken verbally / on paper with an evidence reference.
 */
export default function ReferralConsentPanel({ referral }: Props) {
  const { data: requests = [], isLoading } = useConsentRequests(referral.id);
  const { issueConsentRequest, revokeConsentRequest, recordManualConsent } = useConsentMutations(referral.id);

  const [channel, setChannel] = useState<string>(referral.client_email ? 'email' : 'sms');
  const [manualMethod, setManualMethod] = useState('verbal');
  const [manualPath, setManualPath] = useState('');
  const [manualNote, setManualNote] = useState('');
  const [lastLink, setLastLink] = useState<string | null>(null);

  const copy = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Consent link copied');
    } catch {
      toast.error('Copy failed — select the link manually');
    }
  };

  const issue = async () => {
    const res = await issueConsentRequest.mutateAsync({ channel });
    setLastLink(res.consent_link);
    copy(res.consent_link);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          Client consent (Annexure A)
        </h4>
        <Badge variant={referral.consent_obtained ? 'default' : 'destructive'}>
          {referral.consent_obtained ? 'Consent recorded' : 'Not obtained'}
        </Badge>
      </div>

      {referral.consent_obtained ? (
        <p className="text-xs text-muted-foreground">
          Recorded {referral.consent_obtained_at ? format(new Date(referral.consent_obtained_at), 'dd MMM yyyy, h:mma') : '—'}
          {referral.consent_method ? ` · ${referral.consent_method.replace(/_/g, ' ')}` : ''}
        </p>
      ) : (
        <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label className="text-xs">Send signing link via</Label>
              <Select value={channel} onValueChange={setChannel}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="email" disabled={!referral.client_email}>
                    Email {referral.client_email ? `(${referral.client_email})` : '— no email on file'}
                  </SelectItem>
                  <SelectItem value="sms" disabled={!referral.client_phone}>
                    SMS {referral.client_phone ? `(${referral.client_phone})` : '— no mobile on file'}
                  </SelectItem>
                  <SelectItem value="manual">Manual — copy the link myself</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={issue} disabled={issueConsentRequest.isPending} className="gap-2">
              {issueConsentRequest.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              Issue link
            </Button>
          </div>

          {lastLink && (
            <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5">
              <code className="flex-1 truncate text-xs text-muted-foreground">{lastLink}</code>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => copy(lastLink)}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}

          <Separator />

          <div className="space-y-2">
            <Label className="text-xs">Or record consent already given</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              <Select value={manualMethod} onValueChange={setManualMethod}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="verbal">Verbal (call)</SelectItem>
                  <SelectItem value="written">Written / signed form</SelectItem>
                  <SelectItem value="email_reply">Email reply</SelectItem>
                  <SelectItem value="in_person">In person</SelectItem>
                </SelectContent>
              </Select>
              <Input
                className="h-9"
                placeholder="Evidence reference (file / recording)"
                value={manualPath}
                onChange={(e) => setManualPath(e.target.value)}
              />
            </div>
            <Textarea
              rows={2}
              placeholder="What was said, and when — required if there is no artefact reference."
              value={manualNote}
              onChange={(e) => setManualNote(e.target.value)}
            />
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              disabled={recordManualConsent.isPending || (!manualPath && manualNote.trim().length < 5)}
              onClick={() =>
                recordManualConsent.mutate({
                  consent_method: manualMethod,
                  consent_artefact_path: manualPath || undefined,
                  note: manualNote || undefined,
                })
              }
            >
              {recordManualConsent.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSignature className="h-4 w-4" />}
              Record consent
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Consent history</p>
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : requests.length === 0 ? (
          <p className="text-xs text-muted-foreground">No consent link has been issued yet.</p>
        ) : (
          <div className="space-y-2">
            {requests.map((r) => (
              <div key={r.id} className="rounded-md border border-border p-2.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={consentStatusVariant(r.status)}>{CONSENT_STATUS_LABELS[r.status]}</Badge>
                    <span className="text-muted-foreground">
                      {r.channel} · {format(new Date(r.sent_at), 'dd MMM yyyy, h:mma')}
                    </span>
                  </div>
                  {['pending', 'viewed'].includes(r.status) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1 text-xs"
                      disabled={revokeConsentRequest.isPending}
                      onClick={() => revokeConsentRequest.mutate({ consent_request_id: r.id })}
                    >
                      <Ban className="h-3 w-3" />
                      Revoke
                    </Button>
                  )}
                </div>
                {r.signed_at && (
                  <p className="mt-1 text-muted-foreground">
                    Signed by {r.signature_name} on {format(new Date(r.signed_at), 'dd MMM yyyy, h:mma')}
                    {r.signature_ip ? ` · IP ${r.signature_ip}` : ''} · statement {r.statement_version}
                  </p>
                )}
                {!r.signed_at && ['pending', 'viewed'].includes(r.status) && (
                  <p className="mt-1 text-muted-foreground">
                    Expires {format(new Date(r.expires_at), 'dd MMM yyyy')}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

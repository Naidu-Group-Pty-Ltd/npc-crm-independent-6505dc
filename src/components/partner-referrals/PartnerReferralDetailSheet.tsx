import { useState } from 'react';
import { format } from 'date-fns';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Loader2,
  Pencil,
  ShieldCheck,
  UserPlus,
  RefreshCw,
  AlertTriangle,
  Trash2,
} from 'lucide-react';
import {
  ELIGIBILITY_LABELS,
  REFERRAL_DIRECTION_LABELS,
  REFERRAL_STATUS_FLOW,
  REFERRAL_STATUS_LABELS,
  usePartnerReferral,
  usePartnerReferralMutations,
  type CommercialEligibility,
  type PartnerReferral,
  type ReferralStatus,
} from '@/hooks/usePartnerReferrals';
import ReferralConsentPanel from './ReferralConsentPanel';
import LoanWriterAssignmentCard from './LoanWriterAssignmentCard';


export function referralStatusVariant(status: ReferralStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'settled') return 'default';
  if (status === 'declined' || status === 'withdrawn') return 'destructive';
  if (status === 'draft') return 'outline';
  return 'secondary';
}

interface Props {
  referralId: string | null;
  onOpenChange: (open: boolean) => void;
  onEdit: (referral: PartnerReferral) => void;
}

export default function PartnerReferralDetailSheet({ referralId, onOpenChange, onEdit }: Props) {
  const { data, isLoading } = usePartnerReferral(referralId);
  const {
    transitionReferral, setEligibility, runPriorClientCheck, convertToClient, addNote, deleteDraft,
  } = usePartnerReferralMutations();

  const [note, setNote] = useState('');
  const [eligibilityReason, setEligibilityReason] = useState('');

  const referral = data?.referral;
  const events = data?.events ?? [];
  const agreement = data?.agreement as Record<string, any> | null;

  const nextStatuses: ReferralStatus[] = referral
    ? REFERRAL_STATUS_FLOW[referral.direction]?.[referral.status] ?? []
    : [];

  return (
    <Sheet open={!!referralId} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl p-0 flex flex-col">
        {isLoading || !referral ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <SheetHeader className="px-6 pt-6">
              <SheetTitle className="flex items-center gap-2">
                {referral.reference}
                <Badge variant={referralStatusVariant(referral.status)}>
                  {REFERRAL_STATUS_LABELS[referral.status]}
                </Badge>
              </SheetTitle>
              <SheetDescription>{REFERRAL_DIRECTION_LABELS[referral.direction]}</SheetDescription>
            </SheetHeader>

            <ScrollArea className="flex-1 min-h-0">
              <div className="space-y-6 px-6 py-4">
                {referral.prior_client_check === 'duplicate' && (
                  <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />
                    <p className="text-xs text-foreground">
                      Flagged as a potential duplicate referral. Apply the duplicate rule in the governing
                      agreement before confirming commercial eligibility.
                    </p>
                  </div>
                )}

                <Section title="Client">
                  <Row label="Name" value={[referral.client_first_name, referral.client_surname].filter(Boolean).join(' ')} />
                  <Row label="Email" value={referral.client_email} />
                  <Row label="Phone" value={referral.client_phone} />
                  <Row label="Preferred contact" value={[referral.preferred_contact_method, referral.preferred_contact_time].filter(Boolean).join(' · ')} />
                  <Row label="General purpose" value={referral.general_purpose} />
                </Section>

                <Section title="Referring party">
                  <Row label="Entity" value={referral.referring_entity_name} />
                  <Row label="Individual" value={referral.referring_individual_name} />
                  <Row label="CRN" value={referral.referring_individual_crn} />
                  <Row label="Contact" value={referral.referring_contact_email || referral.referring_contact_phone} />
                </Section>

                <Section title="Compliance">
                  <Row label="Consent obtained" value={referral.consent_obtained ? `Yes${referral.consent_method ? ` (${referral.consent_method})` : ''}` : 'No'} />
                  <Row label="Benefit disclosed" value={referral.benefit_disclosed ? 'Yes' : 'No'} />
                  <Row label="Prior-client check" value={referral.prior_client_check} />
                  <div className="pt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => runPriorClientCheck.mutate(referral.id)}
                      disabled={runPriorClientCheck.isPending}
                    >
                      <RefreshCw className={`mr-2 h-3.5 w-3.5 ${runPriorClientCheck.isPending ? 'animate-spin' : ''}`} />
                      Re-run prior-client check
                    </Button>
                  </div>
                </Section>

                <Section title="Consent">
                  <ReferralConsentPanel referral={referral} />
                </Section>

                {referral.direction === 'outbound_finance_referral' && (
                  <Section title="Loan writer assignment">
                    <LoanWriterAssignmentCard referral={referral} />
                  </Section>
                )}



                <Section title="Governing agreement">
                  {agreement ? (
                    <>
                      <Row label="Partner" value={agreement.partner_legal_name} />
                      <Row label="Version" value={`v${referral.agreement_version ?? agreement.version}`} />
                      <Row label="Qualifying event" value={agreement.qualifying_event} />
                      <Row
                        label="Commercials"
                        value={
                          referral.direction === 'inbound_property_referral'
                            ? [agreement.fee_model, agreement.fee_amount ? `$${agreement.fee_amount}` : null, agreement.fee_percentage ? `${agreement.fee_percentage}%` : null].filter(Boolean).join(' · ')
                            : [`Upfront ${agreement.upfront_share_pct ?? '—'}%`, `Trail ${agreement.trail_share_pct ?? '—'}%`, agreement.commission_basis].filter(Boolean).join(' · ')
                        }
                      />
                      <Row label="Duplicate rule" value={agreement.duplicate_referral_rule} />
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">No agreement attached to this referral.</p>
                  )}
                </Section>

                <Section title="Commercial eligibility">
                  <div className="flex items-center gap-2">
                    <Badge variant={referral.commercial_eligibility === 'eligible' ? 'default' : referral.commercial_eligibility === 'not_eligible' ? 'destructive' : 'secondary'}>
                      {ELIGIBILITY_LABELS[referral.commercial_eligibility]}
                    </Badge>
                    {referral.eligibility_reason && (
                      <span className="text-xs text-muted-foreground">{referral.eligibility_reason}</span>
                    )}
                  </div>
                  <div className="mt-3 space-y-2">
                    <Textarea
                      rows={2}
                      placeholder="Reason / basis for the decision"
                      value={eligibilityReason}
                      onChange={(e) => setEligibilityReason(e.target.value)}
                    />
                    <div className="flex flex-wrap gap-2">
                      {(['eligible', 'not_eligible', 'pending'] as CommercialEligibility[]).map((value) => (
                        <Button
                          key={value}
                          size="sm"
                          variant={value === 'eligible' ? 'default' : 'outline'}
                          disabled={setEligibility.isPending}
                          onClick={() =>
                            setEligibility.mutate({
                              id: referral.id,
                              commercial_eligibility: value,
                              eligibility_reason: eligibilityReason || undefined,
                            })
                          }
                        >
                          <ShieldCheck className="mr-2 h-3.5 w-3.5" />
                          {ELIGIBILITY_LABELS[value]}
                        </Button>
                      ))}
                    </div>
                  </div>
                </Section>

                <Section title="Conversion">
                  <Row label="Client record" value={referral.client_id ?? 'Not converted'} />
                  <Row label="Purchase file" value={referral.purchase_file_id} />
                  <div className="pt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!!referral.client_id || convertToClient.isPending}
                      onClick={() => convertToClient.mutate(referral.id)}
                    >
                      {convertToClient.isPending ? (
                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <UserPlus className="mr-2 h-3.5 w-3.5" />
                      )}
                      Convert to client
                    </Button>
                  </div>
                </Section>

                <Section title="Activity">
                  <div className="space-y-2">
                    <Textarea rows={2} placeholder="Add an internal note" value={note} onChange={(e) => setNote(e.target.value)} />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!note.trim() || addNote.isPending}
                      onClick={async () => {
                        await addNote.mutateAsync({ id: referral.id, note });
                        setNote('');
                      }}
                    >
                      Add note
                    </Button>
                  </div>
                  <Separator className="my-3" />
                  <div className="space-y-3">
                    {events.map((event) => (
                      <div key={event.id} className="text-xs">
                        <p className="text-foreground">{event.summary || event.event_type}</p>
                        <p className="text-muted-foreground">
                          {format(new Date(event.created_at), 'dd MMM yyyy HH:mm')}
                          {event.actor_label ? ` · ${event.actor_label}` : ''}
                          {event.actor_surface ? ` · ${event.actor_surface.replace(/_/g, ' ')}` : ''}
                        </p>
                      </div>
                    ))}
                    {events.length === 0 && <p className="text-xs text-muted-foreground">No activity yet.</p>}
                  </div>
                </Section>
              </div>
            </ScrollArea>

            <div className="border-t border-border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => onEdit(referral)}>
                  <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
                </Button>

                {nextStatuses.length > 0 && (
                  <div className="flex items-center gap-2">
                    <Label className="sr-only">Advance status</Label>
                    <Select
                      value=""
                      onValueChange={(v) => transitionReferral.mutate({ id: referral.id, status: v as ReferralStatus })}
                    >
                      <SelectTrigger className="w-48">
                        <SelectValue placeholder="Advance status…" />
                      </SelectTrigger>
                      <SelectContent>
                        {nextStatuses.map((s) => (
                          <SelectItem key={s} value={s}>{REFERRAL_STATUS_LABELS[s]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {referral.status === 'draft' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    disabled={deleteDraft.isPending}
                    onClick={async () => {
                      await deleteDraft.mutateAsync(referral.id);
                      onOpenChange(false);
                    }}
                  >
                    <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete draft
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right text-foreground">{value || '—'}</span>
    </div>
  );
}
